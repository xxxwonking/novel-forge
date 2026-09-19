/** 作品设定集的确定性 JSON 与 DOCX 渲染。 */
import type { ProjectSession } from "../server/state.js";
import { volumeRanges, type VolumeRange } from "../beat/volumes.js";
import { renderManuscriptDocx, type ManuscriptChapter } from "./manuscript.js";

export type SettingBibleSource = ProjectSession["meta"];

export interface SettingBibleDocument {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly setting: SettingBibleSource["setting"];
  readonly profile: SettingBibleSource["profile"];
  readonly discipline: SettingBibleSource["discipline"];
  readonly characters: SettingBibleSource["characters"];
  readonly settings: SettingBibleSource["settings"];
  readonly plotLines: SettingBibleSource["plotLines"];
  readonly volumes: SettingBibleSource["volumes"];
  readonly volumeRanges: readonly VolumeRange[];
  readonly beats: SettingBibleSource["beats"];
}

export function settingBible(source: SettingBibleSource): SettingBibleDocument {
  return {
    schemaVersion: 1,
    title: source.setting.title,
    setting: source.setting,
    profile: source.profile,
    discipline: source.discipline,
    characters: source.characters,
    settings: source.settings,
    plotLines: source.plotLines,
    volumes: source.volumes,
    volumeRanges: volumeRanges(source.beats),
    beats: source.beats,
  };
}

export function renderSettingBibleJson(source: SettingBibleSource): string {
  return `${JSON.stringify(settingBible(source), null, 2)}\n`;
}

const list = (values: readonly string[]): string => values.length === 0 ? "无" : values.join("、");
const bullets = (values: readonly string[]): string => values.length === 0 ? "无" : values.map(value => `• ${value}`).join("\n");

function settingBody(source: SettingBibleSource): string {
  const value = source.setting;
  return [
    `书名：${value.title}\n类型：${value.genre}\n平台：${value.platform}\n叙事：${value.pov} · ${value.tense}`,
    `一句话：${value.premise}\n核心冲突：${value.centralConflict}\n故事起点：${value.openingSituation}`,
    `主角特质：${list(value.protagonistTraits)}\n主角禁区：${list(value.protagonistForbidden)}`,
    `特殊能力：${value.specialAbility}\n能力限制：\n${bullets(value.abilityLimits)}`,
    `世界规则：\n${bullets(value.worldRules)}`,
    `风格关键词：${list(value.styleKeywords)}\n感情线：${value.romanceLine}\n内容禁忌：${list(value.taboos)}`,
  ].join("\n\n");
}

function disciplineBody(source: SettingBibleSource): string {
  return [
    `作品类型：${source.profile.genre}\n发布平台：${source.profile.platform}\n目标字数：${source.profile.targetWords.toLocaleString("zh-CN")}`,
    `纪律版本：${source.discipline.version}\n${bullets(source.discipline.rules)}`,
  ].join("\n\n");
}

function characterBody(source: SettingBibleSource): string {
  if (source.characters.length === 0) return "尚未建立人物档案。";
  return source.characters.map(character => {
    const profile = character.profile;
    const speech = character.speech;
    const appearance = profile.appearance.map(item => `${item.key}：${item.value}${item.immutable ? "（固定）" : ""}`);
    const forms = speech.addressForms.map(item => `${item.target ?? "默认"} → ${item.form}${item.condition === undefined ? "" : `（${item.condition}）`}`);
    return [
      `【${character.name} · ${character.id}】${profile.role}\n层级：${character.tier} · 首次出场：第 ${character.introducedAt} 章${character.aliases.length === 0 ? "" : ` · 别名：${list(character.aliases)}`}`,
      `性格：${list(profile.traits)}\n禁止行为：${list(profile.forbiddenBehaviors)}\n诉求：${profile.wants}\n恐惧：${profile.fears}\n背景：${profile.background}`,
      `外貌与属性：\n${bullets(appearance)}`,
      `说话方式：${speech.register} · ${speech.emotionalExpression} · 句长 ${speech.sentenceLength.min}–${speech.sentenceLength.max} 字\n口头习惯：${list(speech.verbalTics)}\n专属词汇：${list(speech.signatureLexicon)}\n禁用词：${list(speech.forbiddenLexicon)}\n称谓：${list(forms)}\n正例：${list(speech.exemplars)}\n反例：${list(speech.counterExemplars)}`,
    ].join("\n\n");
  }).join("\n\n");
}

function settingsBody(source: SettingBibleSource): string {
  if (source.settings.length === 0) return "尚未建立地点或组织设定。";
  return source.settings.map(item => `【${item.name} · ${item.id}】${item.kind === "location" ? "地点" : "组织"}\n${item.description}\n${bullets(item.facts)}`).join("\n\n");
}

function plotLinesBody(source: SettingBibleSource): string {
  if (source.plotLines.length === 0) return "尚未建立情节线。";
  return source.plotLines.map(item => `• ${item.label}（${item.id} · ${item.weight}）`).join("\n");
}

function volumesBody(source: SettingBibleSource): string {
  const ranges = volumeRanges(source.beats);
  const cards = new Map(source.volumes.map(item => [item.volume, item]));
  const volumes = [...new Set([...ranges.map(item => item.volume), ...source.volumes.map(item => item.volume)])].sort((a, b) => a - b);
  if (volumes.length === 0) return "尚未建立分卷信息。卷的章节边界由节拍表决定。";
  return volumes.map(volume => {
    const card = cards.get(volume);
    const range = ranges.find(item => item.volume === volume);
    const title = card?.title === undefined ? `第 ${volume} 卷` : `第 ${volume} 卷 · ${card.title}`;
    const chapters = range === undefined ? "章节边界尚未写入节拍表。" : `章节：第 ${range.from}–${range.to} 章`;
    return `【${title}】\n${chapters}\n${card?.summary || "尚未填写卷纲。"}`;
  }).join("\n\n");
}

function beatsBody(source: SettingBibleSource): string {
  if (source.beats.length === 0) return "尚未建立章节规划。";
  return [...source.beats].sort((a, b) => a.chapter - b.chapter).map(beat => {
    const plan = beat.plan;
    const events = plan.events.map(event => `${event.summary}${event.plotLine === null ? "" : `（${event.plotLine}）`}`);
    const resolves = plan.resolves.map(item => `${item.foreshadowId} · ${item.completeness}`);
    const plants = plan.plants.map(item => `${item.label} · ${item.weight}`);
    return `【第 ${beat.chapter} 章 · 第 ${beat.volume} 卷 · ${plan.chapterType}】\n核心事件：${plan.coreEvent}\n次线：${plan.secondaryThread ?? "无"}\n阶段反馈：${plan.stageFeedback}\n章末钩子：${plan.hook}\n事件：${list(events)}\n回收伏笔：${list(resolves)}\n新埋伏笔：${list(plants)}\n人物：${list(plan.characters)}\n地点：${list(plan.locations)}`;
  }).join("\n\n");
}

export function renderSettingBibleDocx(source: SettingBibleSource, identifier: string): Buffer {
  const sections: readonly ManuscriptChapter[] = [
    { chapter: 1, title: "作品设定", body: settingBody(source) },
    { chapter: 2, title: "写作配置与纪律", body: disciplineBody(source) },
    { chapter: 3, title: "人物档案", body: characterBody(source) },
    { chapter: 4, title: "地点与组织", body: settingsBody(source) },
    { chapter: 5, title: "情节线", body: plotLinesBody(source) },
    { chapter: 6, title: "分卷", body: volumesBody(source) },
    { chapter: 7, title: "章节规划", body: beatsBody(source) },
  ];
  return renderManuscriptDocx({ title: `${source.setting.title} · 设定集`, identifier, chapters: sections });
}
