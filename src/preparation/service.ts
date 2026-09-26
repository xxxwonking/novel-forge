import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readProjectFile, recoverFileTransaction, writeProjectFile } from "../store/transaction.js";
import type { ProjectSnapshot } from "../store/persist.js";
import { deriveBudget } from "../beat/derive.js";
import { validatePlan, validateVolume } from "../beat/validate.js";
import { project } from "../store/project.js";
import { ChapterWriteError } from "../server/chapter-input.js";
import type { Rules } from "../rules/schema.js";
import type { RelationClaim } from "../types/relations.js";
import type { PresenceScan } from "../types/presence.js";
import type { GateFinding } from "../types/beat.js";
import type { PreparationChanges, PreparationContent, PreparationProposal, PreparationView } from "./types.js";
import { parsePreparationInput } from "./schema.js";
import { automaticRevisionLimit } from "../task/automatic-revision.js";

interface PreparationDeps {
  readonly snapshot: () => ProjectSnapshot;
  readonly apply: (content: PreparationContent) => void;
  readonly transaction: <T>(operation: () => T) => T;
  readonly checkChapter: (chapter: number) => void;
  /** 把确认过的关系声明落进事件流。关系不是资料的一部分，所以不走 `apply`。 */
  readonly commitRelations: (relations: readonly RelationClaim[]) => void;
  /** 把扫正文得出的出场记录落进事件流。同理不走 `apply`：出场是故事事实，不是设定。 */
  readonly commitPresence: (scans: readonly PresenceScan[]) => void;
  readonly rules: Rules;
}
const DIR = "preparation";
const proposalId = /^proposal-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const accepted = (provenance: string): boolean => provenance === "committed" || provenance === "authored";

export function preparationContent(snapshot: ProjectSnapshot): PreparationContent {
  const { setting, discipline, profile, characters, settings, plotLines, volumes, beats } = snapshot;
  return { setting, discipline, profile, characters, settings, plotLines, volumes, beats };
}

export class PreparationService {
  constructor(private readonly root: string, private readonly deps: PreparationDeps) {}

  fingerprint(): string {
    const snapshot = this.deps.snapshot();
    return hash({ ...preparationContent(snapshot), events: snapshot.events, chapters: [...snapshot.chapters], rulesVersion: this.deps.rules.version });
  }

  view(): PreparationView {
    const snapshot = this.deps.snapshot();
    const fingerprint = this.fingerprint();
    const nextChapter = Math.max(0, ...snapshot.chapters.keys()) + 1;
    const confirmed = preparationContent(snapshot);
    const missing = [...readiness(confirmed, nextChapter).missing];
    if (missing.length === 0) {
      try { this.deps.checkChapter(nextChapter); }
      catch (error) {
        if (!(error instanceof ChapterWriteError)) throw error;
        missing.push(error.message);
      }
    }
    return { fingerprint, confirmed, nextChapter, readiness: { ready: missing.length === 0, missing },
      plannedForeshadows: project({ events: snapshot.events.filter(event => accepted(event.envelope.provenance)), currentChapter: nextChapter - 1,
        characterProfiles: [], plotLineDefs: [], plotLineGap: this.deps.rules.crossChapter.plotLineGap,
      }).foreshadows.filter(item => item.status === "planned").map(({ id, label, intent, expectedBy, weight }) => ({ id, label, intent, expectedBy, weight })),
      taskPolicy: { autoRevisionLimit: automaticRevisionLimit(this.deps.rules.task.maxAutoRevisions) },
      proposals: this.list().map((proposal) => ({ ...proposal, stale: proposal.status === "proposed" && proposal.baseFingerprint !== fingerprint })) };
  }

  propose(raw: unknown, source: "author" | "assistant" = "assistant"): PreparationProposal {
    const input = parsePreparationInput(raw);
    if (input.baseFingerprint !== this.fingerprint()) throw new ChapterWriteError(409, "方案来源版本发生变化，请先重新读取作品资料");
    const existing = this.list().find((p) => p.status === "proposed" && p.source === source && p.baseFingerprint === input.baseFingerprint && same(p.changes, input.changes));
    if (existing !== undefined) return existing;
    const now = new Date().toISOString();
    const built = build(this.deps.snapshot(), input.changes, now, this.deps.rules);
    const proposal: PreparationProposal = { ...input, id: `proposal-${randomUUID()}`, source, status: "proposed", createdAt: now, updatedAt: now, ...built };
    this.save(proposal);
    return proposal;
  }

  /** 明确的作者设定直接应用；触及已有正文则留下可见修改建议。 */
  recordAuthor(raw: unknown): PreparationProposal {
    const proposal = this.propose(raw, "author");
    if (proposal.impacts.length === 0) this.confirm(proposal.id);
    return this.get(proposal.id);
  }

  confirm(id: string): { readonly changed: boolean; readonly proposal: PreparationProposal } {
    return this.deps.transaction(() => {
      const proposal = this.get(id);
      if (proposal.status === "confirmed") return { changed: false, proposal };
      const content = this.preview(id);
      this.deps.apply(content);
      // 关系落进事件流（而不是资料文件）：它是故事事实，不是设定。
      // 放在 apply 之后：资料写不进去时不该先留下一批关系。
      this.deps.commitRelations(proposal.changes.relations ?? []);
      // 出场记录同理。只扫本方案动过的人 —— 确认一份无关方案不该翻动所有人的出场轴，
      // 与「已有人物的 introducedAt 原值不动」是同一个分寸。扫的是 apply 之后的
      // 人物卡与当前正文，所以改名、加别名会立刻反映到轴上。
      const touched = new Set((proposal.changes.characters ?? []).map((c) => c.id));
      const applied = this.deps.snapshot();
      this.deps.commitPresence(applied.characters.filter((c) => touched.has(c.id))
        .map((c) => ({ characterId: c.id, chapters: appearances(applied, c) })));
      const confirmed: PreparationProposal = { ...proposal, status: "confirmed", updatedAt: new Date().toISOString() };
      this.save(confirmed);
      return { changed: true, proposal: confirmed };
    });
  }

  reject(id: string): PreparationProposal {
    const proposal = this.get(id);
    if (proposal.status === "confirmed") throw new ChapterWriteError(409, "已确认方案不能丢弃，请提出新的修改方案");
    const rejected: PreparationProposal = { ...proposal, status: "rejected", updatedAt: new Date().toISOString() };
    this.save(rejected);
    return rejected;
  }

  /** 试写使用独立资料视图；不写正式文件。已确认方案使用当前资料，供旧草稿校验来源。 */
  preview(id: string): PreparationContent {
    const proposal = this.get(id);
    if (proposal.status === "confirmed") return preparationContent(this.deps.snapshot());
    if (proposal.status === "rejected") throw new ChapterWriteError(409, "该方案已丢弃");
    if (proposal.baseFingerprint !== this.fingerprint()) throw new ChapterWriteError(409, "方案基于较早版本，作品资料或已采用正文发生变化，请先重新整理方案");
    const built = build(this.deps.snapshot(), proposal.changes, proposal.createdAt, this.deps.rules);
    if (built.impacts.length > 0) throw new ChapterWriteError(409, `方案影响已采用正文，先处理相关章节：${built.impacts.map((i) => i.message).join("；")}`);
    const changedCharacters = new Set(proposal.changes.characters?.map((c) => c.id));
    const changedBeats = new Set(proposal.changes.beats?.map((b) => b.chapter));
    const provenance = proposal.source === "author" ? "authored" : "committed";
    return { ...built.content,
      characters: built.content.characters.map((c) => changedCharacters.has(c.id) ? { ...c, provenance } : c),
      beats: built.content.beats.map((b) => changedBeats.has(b.chapter) ? { ...b, provenance } : b),
    };
  }

  get(id: string): PreparationProposal {
    if (!proposalId.test(id)) throw new ChapterWriteError(400, "方案编号无效");
    const name = join(DIR, `${id}.json`);
    const text = readProjectFile(this.root, name);
    if (text === undefined) throw new ChapterWriteError(404, "方案不存在");
    try {
      const proposal = JSON.parse(text) as PreparationProposal;
      if (proposal === null || proposal.id !== id || !["proposed", "confirmed", "rejected"].includes(proposal.status) || !["author", "assistant"].includes(proposal.source) || typeof proposal.createdAt !== "string" || typeof proposal.updatedAt !== "string" || proposal.content === null || typeof proposal.content !== "object" || !Array.isArray(proposal.impacts) || !Array.isArray(proposal.findings)) throw new Error("方案记录无效");
      parsePreparationInput({ summary: proposal.summary, baseFingerprint: proposal.baseFingerprint, changes: proposal.changes });
      return proposal;
    } catch (error) {
      throw new Error(`${name} 读取失败，已保留原文件：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  private list(): readonly PreparationProposal[] {
    recoverFileTransaction(this.root);
    const directory = join(this.root, DIR);
    return !existsSync(directory) ? [] : readdirSync(directory).filter((name) => name.endsWith(".json"))
      .map((name) => this.get(name.slice(0, -5))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  private save(proposal: PreparationProposal): void {
    writeProjectFile(this.root, join(DIR, `${proposal.id}.json`), `${JSON.stringify(proposal, null, 2)}\n`);
  }
}

/**
 * 这个人的名字或别名在哪几章正文里出现过，按章号有序。
 *
 * 这是**确定性**判断，所以由代码做：模型给不出更准的答案，却可能给一个错的。
 * 名字与别名都算 —— 作者常把化名写在 aliases 里。
 */
function appearances(snapshot: ProjectSnapshot, character: { readonly name: string; readonly aliases: readonly string[] }): readonly number[] {
  const names = [character.name, ...character.aliases].map((n) => n.trim()).filter((n) => n !== "");
  if (names.length === 0) return [];
  return [...snapshot.chapters].filter(([, text]) => names.some((name) => text.includes(name)))
    .map(([chapter]) => chapter).sort((a, b) => a - b);
}

/** 这个人在正文里第一次出现在第几章。0 = 从未出现（筹备期建卡）。 */
function firstAppearance(snapshot: ProjectSnapshot, character: { readonly name: string; readonly aliases: readonly string[] }): number {
  return appearances(snapshot, character)[0] ?? 0;
}

function upsert<T>(before: readonly T[], patch: readonly T[], key: (item: T) => string | number): readonly T[] {
  const ids = patch.map(key);
  if (new Set(ids).size !== ids.length) throw new ChapterWriteError(400, "同一方案里的 ID 或章号不能重复");
  const changes = new Map(patch.map((item) => [key(item), item]));
  return [...before.map((item) => { const value = changes.get(key(item)) ?? item; changes.delete(key(item)); return value; }), ...changes.values()];
}

function build(snapshot: ProjectSnapshot, changes: PreparationChanges, now: string, rules: Rules): Pick<PreparationProposal, "content" | "impacts" | "findings"> {
  const fail = (message: string): never => { throw new ChapterWriteError(400, message); };
  for (const key of ["genre", "platform"] as const) if (changes.setting?.[key] !== undefined && changes.profile?.[key] !== undefined && changes.setting[key] !== changes.profile[key]) fail(`作品设定与发布配置的 ${key} 不一致`);
  const profile = { ...snapshot.profile, ...changes.profile, ...(changes.setting?.genre === undefined ? {} : { genre: changes.setting.genre }), ...(changes.setting?.platform === undefined ? {} : { platform: changes.setting.platform }) };
  const setting = { ...snapshot.setting, ...changes.setting, genre: profile.genre, platform: profile.platform };
  const removals = changes.removals ?? {};
  const drop = <T>(list: readonly T[], ids: readonly (string | number)[] | undefined, key: (item: T) => string | number, label: string, patched: readonly (string | number)[]): readonly T[] => {
    if (ids === undefined) return list;
    for (const id of ids) {
      if (!list.some((item) => key(item) === id)) fail(`要删除的${label} ${id} 不存在`);
      if (patched.includes(id)) fail(`同一方案里不能又改又删${label} ${id}`);
    }
    return list.filter((item) => !ids.includes(key(item)));
  };
  const characters = drop(upsert(snapshot.characters, (changes.characters ?? []).map((c) => ({ ...c, provenance: "proposed" as const,
    // 新人物按正文扫出首次出场章；已有人物一律不动 —— 那是一份已经用过的事实，
    // 不会因为这次提交而改变，改了反而会让依赖它的东西莫名其妙地过期。
    introducedAt: snapshot.characters.find((old) => old.id === c.id)?.introducedAt ?? firstAppearance(snapshot, c), updatedAt: now })), (c) => c.id),
    removals.characters, (c) => c.id, "人物", (changes.characters ?? []).map((c) => c.id));
  const settings = drop(upsert(snapshot.settings, changes.settings ?? [], (s) => s.id), removals.settings, (s) => s.id, "地点／组织", (changes.settings ?? []).map((s) => s.id));
  const plotLines = drop(upsert(snapshot.plotLines, changes.plotLines ?? [], (p) => p.id), removals.plotLines, (p) => p.id, "情节线", (changes.plotLines ?? []).map((p) => p.id));
  const volumes = drop(upsert(snapshot.volumes, (changes.volumes ?? []).map((v) => ({ ...v, updatedAt: now })), (v) => v.volume), removals.volumes, (v) => v.volume, "卷", (changes.volumes ?? []).map((v) => v.volume))
    .slice().sort((a, b) => a.volume - b.volume);
  const beats = drop(upsert(snapshot.beats, (changes.beats ?? []).map((b) => ({ ...b, provenance: "proposed" as const, updatedAt: now, budget: deriveBudget(b.plan, profile, rules, { now }) })), (b) => b.chapter),
    removals.beats, (b) => b.chapter, "章节计划", (changes.beats ?? []).map((b) => b.chapter)).slice().sort((a, b) => a.chapter - b.chapter);
  const discipline = changes.writingRules === undefined ? snapshot.discipline : { rules: changes.writingRules, version: `author-${hash(changes.writingRules).slice(0, 12)}` };
  const findings: GateFinding[] = [];
  const projection = project({ events: snapshot.events, currentChapter: Math.max(0, ...snapshot.chapters.keys()), characterProfiles: [], plotLineDefs: plotLines, plotLineGap: rules.crossChapter.plotLineGap });

  for (const c of changes.characters ?? []) {
    if (c.speech.sentenceLength.min > c.speech.sentenceLength.max) fail(`人物 ${c.id} 的台词句长区间无效`);
    for (const address of c.speech.addressForms) if (address.target !== null && !characters.some((candidate) => candidate.id === address.target)) fail(`人物 ${c.id} 的称谓引用了不存在的人物 ${address.target}`);
  }
  for (const b of changes.beats ?? []) {
    for (const id of b.plan.characters) if (!characters.some((c) => c.id === id && (accepted(c.provenance) || changes.characters?.some((p) => p.id === id)))) fail(`第 ${b.chapter} 章引用的人物 ${id} 未确认且不在本方案中`);
    for (const id of b.plan.locations) if (!settings.some((s) => s.id === id)) fail(`第 ${b.chapter} 章引用的地点/组织 ${id} 不存在`);
    for (const event of b.plan.events) if (event.plotLine !== null && !plotLines.some((p) => p.id === event.plotLine)) fail(`第 ${b.chapter} 章引用的情节线 ${event.plotLine} 不存在`);
    for (const resolve of b.plan.resolves) {
      const f = projection.foreshadows.find((item) => item.id === resolve.foreshadowId);
      if (f === undefined || f.status !== "open" || f.weight !== resolve.weight || f.plantedAt >= b.chapter) fail(`第 ${b.chapter} 章收束的伏笔 ${resolve.foreshadowId} 尚未正式埋设、已结束或权重不一致`);
    }
    findings.push(...validatePlan(b.plan, rules));
  }
  if ((changes.beats?.length ?? 0) > 0) findings.push(...validateVolume({ beats: beats.filter((b) => (changes.beats ?? []).some((p) => p.chapter === b.chapter)), dueInVolume: projection.foreshadows.filter((f) => f.status === "open").map((f) => ({ foreshadowId: f.id, label: f.label, expectedBy: f.expectedBy })) }, rules));
  assertRemovable(snapshot, removals, { characters, settings, beats }, fail);
  // 关系两端必须是这本书里真有的人 —— 否则关系图上会出现一条指向空处的边。
  for (const r of changes.relations ?? []) {
    for (const [端, who] of [["起点", r.from], ["终点", r.to]] as const) {
      if (!characters.some((c) => c.id === who)) fail(`关系「${r.note}」的${端}人物 ${who} 不存在`);
    }
  }
  const blocks = findings.filter((f) => f.level === "block");
  if (blocks.length > 0) fail(blocks.map((f) => f.message).join("\n"));
  // 卷纲只描述已经写完的卷。给还没写到的卷写纲，等于把规划当成已发生的剧情喂进 L2。
  const lastChapter = Math.max(0, ...snapshot.chapters.keys());
  for (const v of changes.volumes ?? []) {
    if (v.summary.trim() === "") continue;
    const covered = beats.filter((b) => b.volume === v.volume).map((b) => b.chapter);
    if (covered.length === 0) fail(`卷 ${v.volume} 还没有任何章节，不能写卷纲`);
    if (Math.min(...covered) > lastChapter) fail(`卷 ${v.volume} 一章都还没写出来，卷纲只写已经发生的事`);
  }
  const content = { setting, profile, characters, settings, plotLines, volumes, beats, discipline };
  return { content, findings, impacts: impacts(snapshot, changes) };
}

/**
 * 删除的引用完整性。
 *
 * 分两类，这条线是这一批的核心判断：**结构引用**（节拍表点名、他人称谓、已确认事件）
 * 硬拒 —— 留下去资料会自相矛盾，节拍表会指向不存在的 ID；而**正文提及**只是散文里
 * 出现过这个名字，不是结构引用，走 `impacts()` 的既有通道 —— 它本来就挡住确认，
 * 且作者改完正文后自己消失，硬拒反而是死路（只能改名绕过）。
 */
function assertRemovable(
  snapshot: ProjectSnapshot,
  removals: NonNullable<PreparationChanges["removals"]>,
  final: { characters: readonly ProjectSnapshot["characters"][number][]; settings: ProjectSnapshot["settings"]; beats: ProjectSnapshot["beats"] },
  fail: (message: string) => never,
): void {
  // 扫正文得出的出场记录不算结构引用 —— 它就是「正文里提到了这个名字」的机器表示，
  // 而那条路径本就走 impacts（作者改完正文自己消失）。拿它硬拒等于用一条派生事实
  // 推翻上面那条判断，把作者逼回「只能改名绕过」的死路。
  const committed = snapshot.events
    .filter((event) => accepted(event.envelope.provenance) && event.envelope.origin !== "text_scan")
    .map((event) => event.payload);
  const chapters = (list: readonly number[]): string => [...list].sort((a, b) => a - b).join("、");

  for (const id of removals.characters ?? []) {
    const who = `人物「${snapshot.characters.find((c) => c.id === id)?.name ?? id}」`;
    const named = final.beats.filter((b) => b.plan.characters.some((c) => c === id)).map((b) => b.chapter);
    if (named.length > 0) fail(`${who}还是第 ${chapters(named)} 章计划里的出场人物，先改掉那几章的出场再删`);
    const holder = final.characters.find((c) => c.speech.addressForms.some((address) => address.target === id));
    if (holder !== undefined) fail(`${who}还被「${holder.name}」的称谓指着，先改掉那条称谓再删`);
    if (committed.some((payload) => referencesCharacter(payload, id))) fail(`${who}已经写进正式事件，是既成的故事事实；要让他退场请改写相关章节，而不是删掉档案`);
  }
  for (const id of removals.settings ?? []) {
    const what = `地点／组织「${snapshot.settings.find((s) => s.id === id)?.name ?? id}」`;
    const named = final.beats.filter((b) => b.plan.locations.some((s) => s === id)).map((b) => b.chapter);
    if (named.length > 0) fail(`${what}还是第 ${chapters(named)} 章计划里的地点，先改掉那几章的地点再删`);
  }
  for (const id of removals.plotLines ?? []) {
    const what = `情节线「${snapshot.plotLines.find((p) => p.id === id)?.label ?? id}」`;
    const named = final.beats.filter((b) => b.plan.events.some((event) => event.plotLine === id)).map((b) => b.chapter);
    if (named.length > 0) fail(`${what}还挂在第 ${chapters(named)} 章计划的事件上，先改掉那几章再删`);
    if (committed.some((payload) => referencesPlotLine(payload, id))) fail(`${what}已经写进正式事件，是既成的故事事实，不能删`);
  }
  for (const chapter of removals.beats ?? []) {
    if (snapshot.chapters.has(chapter)) fail(`第 ${chapter} 章已经有采用的正文，这份计划是它的依据，不能删`);
  }
}

function referencesCharacter(payload: ProjectSnapshot["events"][number]["payload"], id: string): boolean {
  switch (payload.type) {
    case "plot_event": return payload.participants.some((c) => c === id);
    case "character_state_changed":
    case "character_presence": return payload.characterId === id;
    case "relation_changed": return payload.from === id || payload.to === id;
    default: return false;
  }
}

function referencesPlotLine(payload: ProjectSnapshot["events"][number]["payload"], id: string): boolean {
  switch (payload.type) {
    case "plot_event": return payload.plotLine === id;
    case "plot_advance": return payload.plotLine === id;
    default: return false;
  }
}

function impacts(snapshot: ProjectSnapshot, changes: PreparationChanges): PreparationProposal["impacts"] {
  const all = [...snapshot.chapters.keys()].sort((a, b) => a - b);
  const impacts: { message: string; chapters: readonly number[] }[] = [];
  if (all.length === 0) return impacts;
  const pastSetting = ["premise", "centralConflict", "protagonistTraits", "protagonistForbidden", "specialAbility", "abilityLimits", "worldRules", "openingSituation", "romanceLine"] as const;
  if (pastSetting.some((key) => changes.setting?.[key] !== undefined && !same(changes.setting[key], snapshot.setting[key]))) impacts.push({ message: "核心设定变化需要核对既有章节", chapters: all });
  for (const c of changes.characters ?? []) {
    const before = snapshot.characters.find((old) => old.id === c.id);
    if (before === undefined || (before.name === c.name && same(before.profile, c.profile))) continue;
    const chapters = [...snapshot.chapters].filter(([, text]) => [before.name, ...before.aliases].some((name) => text.includes(name))).map(([n]) => n);
    if (chapters.length > 0) impacts.push({ message: `人物「${before.name}」的身份或背景变更需核对正文`, chapters });
  }
  for (const s of changes.settings ?? []) {
    const before = snapshot.settings.find((old) => old.id === s.id);
    if (before === undefined || same(before, s)) continue;
    const chapters = [...snapshot.chapters].filter(([, text]) => text.includes(before.name)).map(([n]) => n);
    if (chapters.length > 0) impacts.push({ message: `「${before.name}」的设定变化需核对正文`, chapters });
  }
  // 删除的条目只被正文提到名字：不是结构引用，交给作者先处理那几章（impacts 本就挡确认）。
  for (const id of changes.removals?.characters ?? []) {
    const before = snapshot.characters.find((c) => c.id === id);
    if (before === undefined) continue;
    const mentioned = [...snapshot.chapters].filter(([, text]) => [before.name, ...before.aliases].some((name) => text.includes(name))).map(([n]) => n);
    if (mentioned.length > 0) impacts.push({ message: `要删除的人物「${before.name}」在正文里出现过，先改写这些章节`, chapters: mentioned });
  }
  for (const id of changes.removals?.settings ?? []) {
    const before = snapshot.settings.find((s) => s.id === id);
    if (before === undefined) continue;
    const mentioned = [...snapshot.chapters].filter(([, text]) => text.includes(before.name)).map(([n]) => n);
    if (mentioned.length > 0) impacts.push({ message: `要删除的「${before.name}」在正文里出现过，先改写这些章节`, chapters: mentioned });
  }
  for (const b of changes.beats ?? []) if (snapshot.chapters.has(b.chapter) && !same(snapshot.beats.find((old) => old.chapter === b.chapter)?.plan, b.plan)) impacts.push({ message: `第 ${b.chapter} 章已采用，计划修改需随候选修订处理`, chapters: [b.chapter] });
  // 改卷界会让已写好的卷纲描述错的章段：那份纲是按旧范围写的。
  const moved = (changes.beats ?? []).filter((b) => {
    const before = snapshot.beats.find((old) => old.chapter === b.chapter);
    return before !== undefined && before.volume !== b.volume;
  });
  for (const volume of new Set(moved.flatMap((b) => [b.volume, snapshot.beats.find((old) => old.chapter === b.chapter)!.volume]))) {
    if (snapshot.volumes.find((card) => card.volume === volume)?.summary.trim()) {
      impacts.push({ message: `卷 ${volume} 的范围变了，它的卷纲要重写`, chapters: moved.map((b) => b.chapter).sort((x, y) => x - y) });
    }
  }
  return impacts;
}

function readiness(content: PreparationContent, nextChapter: number): PreparationView["readiness"] {
  const missing: string[] = [];
  if (!content.setting.centralConflict.trim()) missing.push("核心冲突");
  if (!content.setting.openingSituation.trim()) missing.push("故事起点");
  if (!content.characters.some((c) => c.tier === "protagonist" && accepted(c.provenance))) missing.push("已确认的主角档案");
  const beat = content.beats.find((b) => b.chapter === nextChapter && accepted(b.provenance));
  if (beat === undefined) missing.push(`第 ${nextChapter} 章的已确认计划`);
  else {
    if (beat.plan.characters.some((id) => !content.characters.some((c) => c.id === id && accepted(c.provenance)))) missing.push("计划中人物的档案");
    if (beat.plan.locations.some((id) => !content.settings.some((s) => s.id === id))) missing.push("计划中地点／组织的设定");
  }
  return { ready: missing.length === 0, missing };
}
