/**
 * 按稿件版本采用（Stage 1，修复「采用不精确到版本」）。
 *
 * 采用一份 ready 草稿：提交其声明为该章正式事实 + 落正文 + 版本 +1 + 标记后续章
 * 草稿需重核。关键性质：
 *   - **只生效选中稿**：草稿在事件流之外，采用时才把这一份展开进事件流并提交，
 *     同章其它草稿从未入流，天然不受影响。
 *   - **幂等**：已采用再采用（连点/刷新/多页）返回 changed:false，不重复写入。
 *   - **修订已采用章**：commitDeclaration 内部作废旧 C5 事件（supersede），旧事实不残留。
 */

import type { ChapterNo } from "../types/primitives.js";
import type { C5Declaration } from "../types/events.js";
import type { DraftStore } from "./draft-store.js";
import type { AdoptResult, DraftId } from "./types.js";

export interface AdoptDeps {
  readonly draftStore: DraftStore;
  /**
   * 把一份声明提交为该章正式事实，返回被作废的旧 C5 事件数（首次采用为 0，
   * 修订已采用章为该章旧事件数）。由 ProjectSession 实现（触碰其私有事件流并失效缓存）。
   */
  readonly commitDeclaration: (chapter: ChapterNo, declaration: C5Declaration) => number;
  readonly putChapter: (chapter: ChapterNo, body: string) => void;
  readonly clock?: () => string;
}

export function adoptDraft(deps: AdoptDeps, chapter: ChapterNo, draftId: DraftId): AdoptResult {
  return deps.draftStore.transaction(() => adopt(deps, chapter, draftId));
}

function adopt(deps: AdoptDeps, chapter: ChapterNo, draftId: DraftId): AdoptResult {
  const now = (deps.clock ?? (() => new Date().toISOString()))();
  const draft = deps.draftStore.loadDraft(chapter, draftId);
  if (draft === undefined) throw new Error(`草稿不存在：ch${chapter}/${draftId}`);

  // 幂等：已采用直接返回，不重复展开事件或多写正文。
  if (draft.status === "adopted") {
    return { changed: false, chapter, draftId, superseded: 0, staleMarked: [] };
  }
  if (draft.status !== "ready" || !draft.acceptable || draft.declaration === null) {
    throw new Error(`草稿未就绪，不能采用：ch${chapter}/${draftId}（status=${draft.status}）`);
  }

  const superseded = deps.commitDeclaration(chapter, draft.declaration);
  deps.putChapter(chapter, draft.body);
  const newVersion = deps.draftStore.bumpWorkVersion();
  const staleMarked = markLaterDraftsStale(deps.draftStore, chapter, newVersion, now);
  deps.draftStore.saveDraft({ ...draft, status: "adopted", updatedAt: now });

  return { changed: true, chapter, draftId, superseded, staleMarked };
}

/**
 * 采用某章后，把依赖它的后续章（更大章号、基于更旧版本、未终结）草稿标记为 stale。
 * 首次顺序采用通常没有后续草稿；修订已采用章时它保证下一章草稿被要求重核。
 */
function markLaterDraftsStale(
  store: DraftStore,
  adoptedChapter: ChapterNo,
  newVersion: number,
  now: string,
): readonly ChapterNo[] {
  const marked: ChapterNo[] = [];
  for (const ch of store.chaptersWithDrafts()) {
    if (ch <= adoptedChapter) continue;
    for (const d of store.listDrafts(ch)) {
      const inFlight =
        d.status === "ready" ||
        d.status === "needs_revision" ||
        d.status === "checking" ||
        d.status === "declaring";
      if (inFlight && d.baseVersion < newVersion) {
        store.saveDraft({ ...d, status: "stale", updatedAt: now });
        if (!marked.includes(ch)) marked.push(ch);
      }
    }
  }
  return marked;
}
