import type { ChapterDraft } from "../task/types.js";
import type { ProjectSession } from "./state.js";
import { draftRevisionToken } from "../task/revision.js";
import { countWords } from "../text/measure.js";
import { canContinueBody } from "./draft-rewrite.js";

/** Web 和主 Agent 共用同一份结果；不暴露内部模型历史。 */
export function toDraftView(draft: ChapterDraft, session: ProjectSession) {
  const { session: _session, writeContext: _writeContext, generation: _generation, ...view } = draft;
  return { ...view, canContinueBody: canContinueBody(draft), words: countWords(draft.body), preparationProposalId: draft.writeContext?.proposalId ?? null,
    revisionToken: draftRevisionToken(draft), isCurrentAdopted: draft.status === "adopted" && session.currentAdoptedDraftId(draft.chapter) === draft.draftId };
}
