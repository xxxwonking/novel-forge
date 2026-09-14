import type { ProjectSnapshot } from "../store/persist.js";
import type { ChapterPlan, GateFinding, WorkProfile } from "../types/beat.js";
import type { WorkSetting } from "../types/work.js";

export type PreparationContent = Pick<ProjectSnapshot, "setting" | "discipline" | "profile" | "characters" | "settings" | "plotLines" | "beats">;
export type CharacterInput = Omit<ProjectSnapshot["characters"][number], "provenance" | "updatedAt" | "introducedAt">;

/** 只允许修改资料与规划；来源、预算、正式故事事件均不能由模型填写。数组按 ID/章号更新。 */
export interface PreparationChanges {
  readonly setting?: Partial<WorkSetting>;
  readonly profile?: Partial<WorkProfile>;
  readonly writingRules?: readonly string[];
  readonly characters?: readonly CharacterInput[];
  readonly settings?: ProjectSnapshot["settings"];
  readonly plotLines?: ProjectSnapshot["plotLines"];
  readonly beats?: readonly { readonly chapter: number; readonly volume: number; readonly plan: ChapterPlan }[];
}

export interface PreparationInput {
  readonly summary: string;
  readonly baseFingerprint: string;
  readonly changes: PreparationChanges;
}

export interface PreparationProposal extends PreparationInput {
  readonly id: string;
  readonly source: "author" | "assistant";
  readonly status: "proposed" | "confirmed" | "rejected";
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 完整候选资料仅供预览，不是正式作品快照。 */
  readonly content: PreparationContent;
  readonly impacts: readonly { readonly message: string; readonly chapters: readonly number[] }[];
  readonly findings: readonly GateFinding[];
}

export interface PreparationView {
  readonly taskPolicy: { readonly autoRevisionLimit: number };
  readonly fingerprint: string;
  readonly confirmed: PreparationContent;
  readonly nextChapter: number;
  readonly readiness: { readonly ready: boolean; readonly missing: readonly string[] };
  readonly proposals: readonly (PreparationProposal & { readonly stale: boolean })[];
}
