import type { CharacterRecord, CharacterTier } from "./preparation-changes.js";

export type PreparationSection = "basics" | "characters" | "plans" | "materials";
export const PREPARATION_SECTIONS: { key: PreparationSection; label: string }[] = [
  { key: "basics", label: "基本设定" },
  { key: "characters", label: "人物档案" },
  { key: "plans", label: "剧情计划" },
  { key: "materials", label: "资料导入" },
];
export const CHARACTER_TIERS: Record<CharacterTier, string> = {
  protagonist: "主角", major: "重要角色", minor: "次要角色", extra: "背景角色",
};

/** 搜索支持姓名、别名和身份，多词取交集，保留原档案次序与内容。 */
export function filterCharacters(characters: readonly CharacterRecord[], query: string, tier: CharacterTier | "all"): CharacterRecord[] {
  const terms = query.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return characters.filter(character => {
    if (tier !== "all" && character.tier !== tier) return false;
    const text = [character.name, ...character.aliases, character.profile.role].join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
