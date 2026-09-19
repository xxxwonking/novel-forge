# Work Backup and Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portable, integrity-checked `.nforge` backup that can export active or archived works and atomically import them under a chosen work ID.

**Architecture:** A focused workspace backup module owns the versioned gzip/JSON container, recursive file inventory, credential exclusion, hashes, and hostile-path validation. `Workspace` resolves active and `.trash/` sources, gates live writers, and imports into a private staging directory before validating with `ProjectStore` and publishing with one rename. The HTTP layer exposes binary download/upload endpoints, while the Works page adds backup and import controls without changing the existing project APIs.

**Tech Stack:** TypeScript, Node.js built-in `fs`/`crypto`/`zlib`/`http`, Vitest, React 19, Ant Design, Vite

---

## Chunk 1: Portable package and atomic workspace operations

### Task 1: Define and verify the portable package format

**Files:**
- Create: `src/workspace/backup.ts`
- Create: `test/workspace-backup.test.ts`

- [ ] **Step 1: Write a failing round-trip test**

Create a real project with `ProjectStore`, add representative nested drafts, event/conversation files, an unknown future file, and `.env.local`. Call the intended pack/unpack API and assert every normal file is byte-identical while credentials and transaction-temporary files are absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run test/workspace-backup.test.ts`

Expected: FAIL because `src/workspace/backup.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal versioned package codec**

Implement a deterministic manifest shaped as:

```ts
interface BackupManifest {
  readonly format: "novel-forge-work";
  readonly version: 1;
  readonly sourceId: string;
  readonly createdAt: string;
  readonly files: readonly {
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
    readonly data: string;
  }[];
}
```

Encode the JSON with `gzipSync`; enumerate only regular files without following symlinks; use sorted POSIX-relative paths; omit `.env`, `.env.*`, `.pending-write.json`, and transaction temp files. Decode with a bounded `gunzipSync`, validate the exact format/version, duplicate paths, safe relative path segments, base64 size, and SHA-256 before returning any file.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run test/workspace-backup.test.ts`

Expected: PASS for the round trip and exclusion assertions.

- [ ] **Step 5: Add hostile-package tests**

Add cases for invalid gzip, malformed JSON, unsupported version, path traversal (`../`, absolute paths, Windows drive/backsplash paths), duplicate paths including case-only duplicates, corrupted hashes, symlinks, too many files, and oversized expanded manifests.

- [ ] **Step 6: Run tests and verify RED for each new behavior**

Run after each case: `npx vitest run test/workspace-backup.test.ts`

Expected: each new case initially FAILS for the missing validation, not for fixture errors.

- [ ] **Step 7: Implement the minimum validation needed for each case**

Use named package safety limits and actionable `ChapterWriteError` messages. Never write decoded content during validation.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `npx vitest run test/workspace-backup.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the package codec**

```bash
git add src/workspace/backup.ts test/workspace-backup.test.ts
git commit -m "feat(workspace): 定义可校验的作品备份格式"
```

### Task 2: Add active/archive backup and atomic import to Workspace

**Files:**
- Modify: `src/workspace/service.ts`
- Modify: `test/workspace-backup.test.ts`

- [ ] **Step 1: Write failing workspace behavior tests**

Cover active-work backup, `.trash/` archive backup through the same format, default import ID, explicit new ID, same-ID collision refusal, invalid target ID, active writer refusal, and cleanup of `.importing-*` staging directories after validation/write failure.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run test/workspace-backup.test.ts`

Expected: FAIL because `Workspace.backup` and `Workspace.importBackup` are missing.

- [ ] **Step 3: Implement source resolution and live-write gating**

Resolve either `{ id }` or `{ archive }`; reuse archive parsing; refuse backup while chapter tasks are `running`, `pausing`, or `ending`, or continuous writing is running. Return bytes, a safe filename, and a SHA-256 digest.

- [ ] **Step 4: Implement staged import**

Validate the complete package in memory, validate the target ID, reject an occupied target, create `.importing-*`, write only validated paths, load the staged project with `ProjectStore`, summarize it, then publish using one `renameSync`. Always remove unpublished staging in `finally` and never modify an existing work.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run test/workspace-backup.test.ts`

Expected: PASS with no partial target or staging directory after failures.

- [ ] **Step 6: Run workspace regression tests**

Run: `npx vitest run test/workspace.test.ts test/workspace-backup.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit workspace operations**

```bash
git add src/workspace/service.ts test/workspace-backup.test.ts
git commit -m "feat(workspace): 支持作品备份与原子导入"
```

## Chunk 2: Binary HTTP boundary

### Task 3: Expose download and upload endpoints

**Files:**
- Modify: `src/server/http.ts`
- Modify: `test/http-boundary.test.ts`

- [ ] **Step 1: Write failing binary endpoint tests**

Assert `GET /api/works/backup?id=...` and `?archive=...` return the vendor media type, attachment filename, digest, and non-JSON bytes. Assert `POST /api/works/import?targetId=...` accepts that media type and returns a work summary. Also cover missing selectors, wrong content type, oversized body, hostile Origin/Host, corrupt package, and collision.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run test/http-boundary.test.ts`

Expected: FAIL because the binary routes do not exist and generic POST handling only accepts JSON.

- [ ] **Step 3: Implement the binary route boundary**

Handle the two routes after localhost/origin checks but before generic JSON parsing. Read upload bytes with a named compressed-size limit, return JSON errors through the existing error path, and emit explicit `content-length`, `content-disposition`, `content-type`, and `x-content-sha256` headers for downloads.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run test/http-boundary.test.ts`

Expected: PASS.

- [ ] **Step 5: Run server/workspace regression tests and typecheck**

Run: `npx vitest run test/http-boundary.test.ts test/workspace.test.ts test/workspace-backup.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the HTTP boundary**

```bash
git add src/server/http.ts test/http-boundary.test.ts
git commit -m "feat(server): 提供作品备份迁移接口"
```

## Chunk 3: Works-page controls and full verification

### Task 4: Add browser API helpers and the Works-page UI

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/pages/Works.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Add a failing compile-time/UI contract**

Add typed `downloadWorkBackup` and `importWorkBackup` call sites in the Works page before defining them; use a visible import button, file picker modal, optional target ID, active/archive backup buttons, per-action loading state, and status/error feedback.

- [ ] **Step 2: Run typecheck and verify RED**

Run: `npm run typecheck`

Expected: FAIL because the binary API helpers are undefined.

- [ ] **Step 3: Implement binary browser helpers**

Use `fetch` directly so downloads are read as `Blob` and uploads send the selected `File` with the vendor media type. Parse JSON error bodies consistently; prefer the server-provided attachment filename and revoke object URLs after download.

- [ ] **Step 4: Complete the accessible Works-page controls**

Keep backup buttons outside card links, label icon-only controls, disable competing mutations while busy, allow backups for archived entries, and reload the workspace after import.

- [ ] **Step 5: Run typecheck and production build**

Run: `npm run typecheck && npm run web:build`

Expected: PASS; the existing Vite chunk-size warning is acceptable.

- [ ] **Step 6: Commit the UI**

```bash
git add web/src/api.ts web/src/pages/Works.tsx web/src/styles.css
git commit -m "feat(web): 增加作品备份与导入入口"
```

### Task 5: Document the contract and perform final verification

**Files:**
- Modify: `README.md`
- Modify: `MEMORY.md`

- [ ] **Step 1: Document backup contents, exclusions, collision policy, and recovery guarantees**

Explain that `.nforge` includes normal project files, excludes credentials/transient transaction files, validates before writing, imports atomically, and requires a new ID when the original ID is occupied.

- [ ] **Step 2: Run focused security and portability tests**

Run: `npx vitest run test/workspace-backup.test.ts test/http-boundary.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS with only explicitly skipped tests.

- [ ] **Step 4: Run static and production verification**

Run: `npm run typecheck && npm run web:build`

Expected: PASS; no new warnings beyond the known Vite bundle-size warning.

- [ ] **Step 5: Inspect the final diff and workspace status**

Run: `git diff --check && git status --short && git log --oneline --decorate -5`

Expected: no whitespace errors; `.ace-tool/` remains untouched and untracked.

- [ ] **Step 6: Commit documentation and verification notes**

```bash
git add README.md MEMORY.md docs/superpowers/plans/2026-09-19-work-backup-migration.md
git commit -m "docs: 说明作品备份迁移契约"
```
