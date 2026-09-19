export type ExportSelection =
  | { readonly scope: "all" }
  | { readonly scope: "range"; readonly from: number; readonly to: number }
  | { readonly scope: "volume"; readonly volume: number };
export type ExportKind = "manuscript" | "bible";
export type ExportArtifactFormat = "txt" | "epub" | "docx" | "json";
export interface ExportArtifact {
  readonly format: ExportArtifactFormat;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface ExportChapter {
  readonly chapter: number;
  readonly draftId: string | null;
  readonly version: string;
  readonly words: number;
  readonly sha256: string;
}
export interface TextExportPreview {
  readonly id: string | null;
  readonly kind?: ExportKind;
  readonly title: string;
  readonly filename: string | null;
  readonly selection: ExportSelection;
  readonly chapters: readonly ExportChapter[];
  readonly omitted: readonly { readonly from: number; readonly to: number }[];
  readonly pendingDrafts: readonly { readonly chapter: number; readonly count: number }[];
  readonly totalWords: number;
  readonly createdAt: string;
  readonly sha256: string | null;
  readonly artifacts?: readonly ExportArtifact[];
  readonly message: string;
}
export interface TextExportFile { readonly filename: string; readonly text: string; readonly sha256: string }
export interface ExportArtifactFile { readonly filename: string; readonly mime: string; readonly bytes: Buffer; readonly sha256: string }
