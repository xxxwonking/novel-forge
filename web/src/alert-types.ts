/** 提示的 JSON 数据契约；不依赖浏览器，可用于纯逻辑测试。 */
export interface TextAnchor {
  chapter: number;
  quote: string;
  offsetHint: number;
  occurrence: number;
}

export type AlertAction =
  | { kind: "add_resolution_to_beat"; targetChapter: number; foreshadowId: string; weight: "main" | "sub" | "detail"; completeness: "full" | "partial" }
  | { kind: "add_advance_to_beat"; targetChapter: number; plotLine: string }
  | { kind: "add_character_to_beat"; targetChapter: number; characterId: string }
  | { kind: "reschedule"; foreshadowId: string; expectedBy: number }
  | { kind: "abandon"; foreshadowId: string }
  | { kind: "confirm_exit"; characterId: string }
  | { kind: "acknowledge" }
  | { kind: "open_view"; view: "foreshadow" | "plotline" | "arc" | "relation" }
  | { kind: "jump_to_anchor"; anchor: TextAnchor };

export type AlertSubject =
  | { kind: "foreshadow"; id: string }
  | { kind: "plotline"; id: string }
  | { kind: "character"; id: string }
  | { kind: "chapter"; chapter: number }
  | { kind: "anchor"; anchor: TextAnchor };

export type PlanningAction = Extract<AlertAction, { kind: "add_resolution_to_beat" | "add_advance_to_beat" | "add_character_to_beat" | "reschedule" | "abandon" | "confirm_exit" }>;

export interface Alert {
  id: string;
  category: string;
  direction: "forward" | "backward";
  impact: number;
  decay: number;
  score: number;
  title: string;
  detail: string;
  subject: AlertSubject;
  fatigueCount: number;
  acknowledged: boolean;
  migratedTo: "suggest_abandon" | "confirm_exit" | null;
  actions: AlertAction[];
  createdAt: string;
  lastEvaluatedAt: string;
}

export interface AlertEvidence {
  coverageKnown?: boolean;
  source: { chapter: number; quote: string | null; status: "exact" | "shifted" | "stale" | "record" } | null;
  unrecorded: number[];
  pending: number[];
}
