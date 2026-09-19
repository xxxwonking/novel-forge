# Rich Export Formats Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend fixed-version export from TXT-only to EPUB and DOCX manuscripts, volume-scoped export, and human-readable plus JSON setting-bible export.

**Architecture:** Keep the existing export snapshot as the trust boundary: selected committed content is rendered once during preview and all artifacts are saved atomically with hashes, so later adoption never changes an old download. Focused pure renderers create deterministic EPUB/DOCX/JSON/TXT bytes, while the service owns selection, fixed-version manifests, backward-compatible TXT reads, and artifact persistence. A binary HTTP endpoint streams saved artifacts and the React page selects export content, scope, and format.

**Tech Stack:** TypeScript, Node.js, `fflate` for deterministic ZIP containers, OOXML/EPUB XML, Vitest, React 19, Ant Design, bundled LibreOffice DOCX renderer for visual QA

---

## Chunk 1: Deterministic manuscript artifacts

### Task 1: Create deterministic EPUB and DOCX renderers

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/export/archive.ts`
- Create: `src/export/manuscript.ts`
- Create: `test/rich-export.test.ts`

- [x] **Step 1: Write failing renderer tests**

Define a two-chapter manuscript containing Chinese text and XML-sensitive characters. Assert that EPUB bytes contain an uncompressed first `mimetype` entry, valid container/OPF/navigation/chapter XHTML, escaped text, and stable bytes across repeated calls. Assert that DOCX bytes contain content types, relationships, styles, a Letter portrait section, title/heading/body styles, explicit chapter page breaks, escaped text, and stable bytes.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run test/rich-export.test.ts`

Expected: FAIL because `src/export/manuscript.ts` does not exist.

- [x] **Step 3: Add the ZIP dependency**

Run: `npm install fflate@0.8.3`

Expected: `package.json` and `package-lock.json` record the MIT-licensed dependency resolved from its official npm package.

- [x] **Step 4: Implement deterministic archive and XML helpers**

Wrap `fflate.zipSync` with fixed ZIP entry times, explicit compression levels, UTF-8 encoding, XML/HTML escaping, safe filenames, and stable insertion order. EPUB must write `mimetype` first with no compression.

- [x] **Step 5: Implement manuscript renderers**

Use one `Manuscript` input:

```ts
interface Manuscript {
  readonly title: string;
  readonly identifier: string;
  readonly chapters: readonly { chapter: number; title: string; body: string }[];
}
```

TXT retains the existing BOM and chapter headings. EPUB 3 contains a title page, nav, one XHTML file per chapter, readable CSS, and valid OPF metadata. DOCX contains a title page, Heading 1 chapter titles, 11–12 pt Chinese-friendly body text with first-line indent and natural paragraph spacing, and Letter portrait page settings.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run test/rich-export.test.ts && npm run typecheck`

Expected: PASS.

- [x] **Step 7: Commit the pure renderers**

```bash
git add package.json package-lock.json src/export/archive.ts src/export/manuscript.ts test/rich-export.test.ts
git commit -m "feat(export): 生成确定性的 EPUB 与 DOCX 正文"
```

### Task 2: Visually verify a generated DOCX

**Files:**
- Test artifact only: a temporary DOCX generated from `test/rich-export.test.ts` fixtures

- [x] **Step 1: Resolve the bundled document runtime and mark one create operation**

Use `load_workspace_dependencies`, then run the bundled Node executable with `container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format docx` exactly once immediately before generating the QA DOCX.

- [x] **Step 2: Generate the QA DOCX outside tracked source**

Run the product renderer against a representative Chinese title, multiple paragraphs, punctuation, and two chapter breaks; write it under a temporary directory.

- [x] **Step 3: Render to PNG with the bundled document tools**

Run the bundled Python executable and `documents/render_docx.py` with a temporary output directory.

- [x] **Step 4: Inspect every rendered page at 100%**

Verify title, Chinese glyphs, margins, heading hierarchy, paragraph indentation/spacing, page breaks, and absence of clipping or overlap. Iterate renderer styles and repeat render/inspection if needed.

## Chunk 2: Fixed multi-format snapshots and setting bible

### Task 3: Extend selection with volume scope and preserve snapshot semantics

**Files:**
- Modify: `src/export/types.ts`
- Modify: `src/export/service.ts`
- Modify: `test/text-export.test.ts`
- Modify: `test/rich-export.test.ts`

- [x] **Step 1: Write failing volume-selection and fixed-artifact tests**

Cover `{ scope: "volume", volume }`, bounds derived only from `Beat.volume`, missing/unplanned volume rejection, gaps reported through `omitted`, artifact metadata and hashes, repeated preview reuse, later chapter adoption not changing saved files, atomic rollback across all artifact files, and v1 TXT snapshot readability.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run test/text-export.test.ts test/rich-export.test.ts`

Expected: FAIL because volume selection and saved artifacts are absent.

- [x] **Step 3: Implement version 2 export manifests**

Add `kind: "manuscript"`, volume selection, and artifact descriptors for TXT, DOCX, and EPUB. Compute the export identity from committed content metadata, check for an existing snapshot before rendering, save text plus base64 binary artifacts inside the existing file transaction, and verify every artifact hash when reading. Preserve the v1 TXT reader and its existing failure behavior.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run test/text-export.test.ts test/rich-export.test.ts`

Expected: PASS.

- [x] **Step 5: Commit fixed multi-format manuscript snapshots**

```bash
git add src/export/types.ts src/export/service.ts test/text-export.test.ts test/rich-export.test.ts
git commit -m "feat(export): 固定多格式正文与分卷快照"
```

### Task 4: Add a setting-bible snapshot and renderers

**Files:**
- Create: `src/export/bible.ts`
- Modify: `src/export/types.ts`
- Modify: `src/export/service.ts`
- Modify: `test/rich-export.test.ts`

- [x] **Step 1: Write failing setting-bible tests**

Assert that `{ kind: "bible" }` exports confirmed work setting, writing discipline, profile, character cards, locations/organizations, plot lines, volume cards with derived chapter ranges, and chapter plans. It must exclude drafts, proposals, runtime task state, credentials, and derived character state. JSON must be structured and deterministic; DOCX must have a title and readable section hierarchy.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run test/rich-export.test.ts`

Expected: FAIL because bible export is unsupported.

- [x] **Step 3: Implement normalized bible data and renderers**

Create a stable `SettingBible` value from `source.meta`, derive volume ranges from beats, render pretty UTF-8 JSON and a structured DOCX, and store both as version 2 artifacts under the same atomic/hash guarantees as manuscripts.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run test/text-export.test.ts test/rich-export.test.ts && npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit setting-bible export**

```bash
git add src/export/bible.ts src/export/types.ts src/export/service.ts test/rich-export.test.ts
git commit -m "feat(export): 支持固定版本设定集"
```

## Chunk 3: Binary delivery and Web workflow

### Task 5: Stream saved export artifacts over HTTP

**Files:**
- Modify: `src/server/http.ts`
- Modify: `src/server/api.ts`
- Modify: `test/http-boundary.test.ts`
- Modify: `test/text-export.test.ts`

- [x] **Step 1: Write failing binary-download tests**

Create a fixed snapshot, download TXT/DOCX/EPUB/JSON from `/api/export/download?id=...&format=...`, and assert media type, attachment filename, length, digest, and exact saved bytes. Cover invalid format, wrong work header, corrupt/missing artifact, Host/Origin boundaries, and existing `/api/export/file` TXT compatibility.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run test/http-boundary.test.ts test/text-export.test.ts`

Expected: FAIL because the binary download route is absent.

- [x] **Step 3: Implement project-scoped binary download**

Resolve the selected work exactly like other project APIs, then stream the already-saved artifact with `content-type`, RFC 5987 attachment filename, `content-length`, and `x-content-sha256`. Do not regenerate from current project data.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run test/http-boundary.test.ts test/text-export.test.ts test/rich-export.test.ts && npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit binary delivery**

```bash
git add src/server/http.ts src/server/api.ts test/http-boundary.test.ts test/text-export.test.ts
git commit -m "feat(server): 下载固定的多格式导出产物"
```

### Task 6: Add content, scope, and format controls to the Export page

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/pages/Export.tsx`
- Modify: `web/src/styles.css`

- [x] **Step 1: Add typed call sites before helpers and verify RED**

Add manuscript/setting-bible choice, all/range/volume scope controls, artifact cards, and one download button per available format. Run `npm run typecheck` and confirm it fails because the new request/preview/download types and helpers are absent.

- [x] **Step 2: Implement browser types and binary helper**

Download `Blob` data from the binary endpoint with the current work header, parse JSON error responses, use the server filename, trigger a browser download, and revoke object URLs.

- [x] **Step 3: Complete accessible responsive controls**

Explain that previews freeze committed versions, show skipped/pending chapters, label volume selection clearly, disable stale-preview downloads after selection changes, and present format names and intended uses without hiding icon-only actions.

- [x] **Step 4: Run typecheck and production build**

Run: `npm run typecheck && npm run web:build`

Expected: PASS with only the existing Vite chunk-size warning.

- [x] **Step 5: Commit the Web workflow**

```bash
git add web/src/api.ts web/src/pages/Export.tsx web/src/styles.css
git commit -m "feat(web): 提供 EPUB DOCX 分卷与设定集导出"
```

## Chunk 4: Documentation and final verification

### Task 7: Document formats and close the queue item

**Files:**
- Modify: `README.md`
- Modify: `MEMORY.md`

- [x] **Step 1: Document format purposes and snapshot guarantees**

Explain TXT for plain text, EPUB for e-readers, DOCX for editing/printing, JSON setting bible for machine-readable archival, volume selection rules, and that all downloads use the fixed preview rather than current content.

- [x] **Step 2: Run focused export and HTTP suites**

Run: `npx vitest run test/text-export.test.ts test/rich-export.test.ts test/http-boundary.test.ts`

Expected: PASS.

- [x] **Step 3: Run the full suite**

Run: `npm test`

Expected: PASS with only explicitly skipped tests.

- [x] **Step 4: Run static and production verification**

Run: `npm run typecheck && npm run web:build && git diff --check`

Expected: PASS; no new build warnings beyond the known Vite chunk warning.

- [x] **Step 5: Audit dependency and repository state**

Run: `npm audit --registry=https://registry.npmjs.org && git status --short && git diff --stat master...HEAD`

Expected: no known dependency vulnerabilities; `.ace-tool/` remains untouched and untracked.

- [x] **Step 6: Commit documentation**

```bash
git add README.md MEMORY.md docs/superpowers/plans/2026-09-19-rich-export-formats.md
git commit -m "docs: 说明多格式导出契约"
```
