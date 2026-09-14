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
import type { GateFinding } from "../types/beat.js";
import type { PreparationChanges, PreparationContent, PreparationProposal, PreparationView } from "./types.js";
import { parsePreparationInput } from "./schema.js";

interface PreparationDeps {
  readonly snapshot: () => ProjectSnapshot;
  readonly apply: (content: PreparationContent) => void;
  readonly transaction: <T>(operation: () => T) => T;
  readonly checkChapter: (chapter: number) => void;
  readonly rules: Rules;
}
const DIR = "preparation";
const proposalId = /^proposal-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const accepted = (provenance: string): boolean => provenance === "committed" || provenance === "authored";

export function preparationContent(snapshot: ProjectSnapshot): PreparationContent {
  const { setting, discipline, profile, characters, settings, plotLines, beats } = snapshot;
  return { setting, discipline, profile, characters, settings, plotLines, beats };
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
  const characters = upsert(snapshot.characters, (changes.characters ?? []).map((c) => ({ ...c, provenance: "proposed" as const, introducedAt: snapshot.characters.find((old) => old.id === c.id)?.introducedAt ?? 0, updatedAt: now })), (c) => c.id);
  const settings = upsert(snapshot.settings, changes.settings ?? [], (s) => s.id);
  const plotLines = upsert(snapshot.plotLines, changes.plotLines ?? [], (p) => p.id);
  const beats = upsert(snapshot.beats, (changes.beats ?? []).map((b) => ({ ...b, provenance: "proposed" as const, updatedAt: now, budget: deriveBudget(b.plan, profile, rules, { now }) })), (b) => b.chapter).slice().sort((a, b) => a.chapter - b.chapter);
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
  const blocks = findings.filter((f) => f.level === "block");
  if (blocks.length > 0) fail(blocks.map((f) => f.message).join("\n"));
  const content = { setting, profile, characters, settings, plotLines, beats, discipline };
  return { content, findings, impacts: impacts(snapshot, changes) };
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
  for (const b of changes.beats ?? []) if (snapshot.chapters.has(b.chapter) && !same(snapshot.beats.find((old) => old.chapter === b.chapter)?.plan, b.plan)) impacts.push({ message: `第 ${b.chapter} 章已采用，计划修改需随候选修订处理`, chapters: [b.chapter] });
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
