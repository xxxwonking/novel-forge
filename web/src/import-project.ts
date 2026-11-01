import type { ImportResult, ImportSource } from "./import-types.js";
export interface CompletedImport extends ImportResult {
  analysis?: { proposalId?: string; error?: string };
}
export type ImportStage = "importing" | "analyzing";
export interface ImportActions {
  importApply: (source: ImportSource & { overwrite?: boolean }) => Promise<ImportResult>;
  draftPreparation: (input: { focus: "materials"; apply: true }) => Promise<{ proposalId?: string }>;
}
export async function importProject(
  source: ImportSource & { overwrite?: boolean },
  actions: ImportActions,
  stage: (stage: ImportStage) => void,
  analyze = true,
): Promise<CompletedImport> {
  stage("importing");
  const saved = await actions.importApply(source);
  if (!analyze || saved.materials.length === 0) return saved;
  stage("analyzing");
  try {
    const draft = await actions.draftPreparation({ focus: "materials", apply: true });
    if (!draft.proposalId) throw new Error("资料已保存，但整理未返回待确认方案");
    return { ...saved, analysis: { proposalId: draft.proposalId } };
  } catch (error) {
    return { ...saved, analysis: { error: error instanceof Error ? error.message : String(error) } };
  }
}
