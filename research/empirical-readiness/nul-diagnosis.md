# NUL Contamination Diagnosis

Result: **COMPLETE**. Stage B gate: **RESEARCH_CONTAINABLE**.

All evidence claims below use `OBSERVED`, `UNVERIFIED`, or `NOT_ATTEMPTED`. An `OBSERVED` row includes a retained path and narrow locator.

## B0. Baseline

| Claim | Status | Observation | Evidence |
|---|---|---|---|
| Branch and starting HEAD | OBSERVED | `main` at `a5f668ba7484c7f765f65ea3ef88f031eb0e7512` | `/Users/woncheol/Documents/Volt ai/.git` — initial `git branch --show-current`; `git rev-parse HEAD` |
| Starting worktree state | OBSERVED | Only the prior `index-drawing-inventory.md` and `inventory.json` were untracked | `/Users/woncheol/Documents/Volt ai/.git` — initial `git status --short --untracked-files=all` |
| Protected index | OBSERVED | `.volt-ai/kec/index.db`, 9,437,184 bytes, SHA-256 `a24b705e74872d64f492617011ed355154cae2cbd3a523153114e126bd67e43f` | `.volt-ai/kec/index.db` — filesystem bytes and SHA-256 |

## B1. Contamination

The database was read through Python `sqlite3` using URI `mode=ro&immutable=1`. Python string lengths and positions were used because SQLite's `length()` and `substr()` stop at an embedded U+0000.

| Claim | Status | Observation | Evidence |
|---|---|---|---|
| Exact affected count | OBSERVED | 312 of 536 chunks contain at least one U+0000 | `.volt-ai/kec/index.db` — all `kec_chunks.text` values |
| Count distribution | OBSERVED | Per affected chunk: min 2, max 376, median 81.5; total 25,064 U+0000 | `.volt-ai/kec/index.db` — Python counts over all affected text values |
| Position pattern | OBSERVED | leading 16, trailing 11, interior 312, scattered 312 affected chunks; categories overlap | `.volt-ai/kec/index.db` — U+0000 index positions per affected row |
| Row/page distribution | OBSERVED | Affected rows occupy rowid 1–351 and pages 1–77; rowids 352–536/pages 78–100 contain none. The affected prefix is internally broad rather than a single-page point cluster. | `.volt-ai/kec/index.db` — affected rowid/page grouping |

## B2. Origin trace

One read-only reproduction used page 1 of `project-files/전기 결합_1_100.pdf`.

| Stage | Status | Observation | Evidence |
|---|---|---|---|
| pdfjs extraction | OBSERVED | `getTextContent()` returned 6 text items; all 6 contained U+0000, totaling 16 | `project-files/전기 결합_1_100.pdf` — page 1 `getTextContent().items[].str`; `packages/mcp-kec/src/knowledge/pdfPages.ts:19-40` |
| `readPdfPages` | OBSERVED | Joined page text retained 16 U+0000 in 98 characters | `project-files/전기 결합_1_100.pdf` — page 1; `packages/mcp-kec/src/knowledge/pdfPages.ts:32-39` |
| `createPageChunks` | OBSERVED | One 99-character chunk retained the same 16 U+0000 | `packages/mcp-kec/src/knowledge/chunk.ts:61-75,97-155` — page 1 reproduction |
| DB write | OBSERVED | Stored rowid 1 retains 16 U+0000, 99 characters, 221 UTF-8 bytes, and chunk-text SHA-256 `9eda574445c8c49e4a9318dda0f8ddb8e8f689191ce646d77034fb5d1522e645` | `.volt-ai/kec/index.db` — `kec_chunks.rowid=1:text`; `packages/mcp-kec/src/tools/indexKec.ts:237-291`; `packages/mcp-kec/src/knowledge/sqliteVectorStore.ts:48-60` |

`NUL_ORIGIN = PDFJS_TEXT_ITEM_OUTPUT` is therefore **OBSERVED**. Chunking and storage preserve the characters; they do not introduce them in this reproduction.

## B3. Impact

`NUL_IMPACT = DOWNSTREAM_ONLY` is **OBSERVED**. SQLite stores the complete TEXT bytes and Python/JavaScript return complete strings, so storage truncation was not observed. SQLite `length(text)` and `substr(text,...)` stop at the first U+0000, so downstream SQL string measurement and slicing are affected. Evidence: `.volt-ai/kec/index.db`, affected rows compared as raw returned values versus `length(text)`/`substr(text,...)`.

Whether U+0000 changes embedding or retrieval quality is **UNVERIFIED**. No same-chunk controlled embedding comparison was authorized.

## B4. Fix surface and hard gate

`FIX_SURFACE = RESEARCH_CONTAINABLE` is **OBSERVED**. The Stage A research path replaces U+0000 before production `createPageChunks` without changing production code:

- `research/empirical-readiness/scripts/nulSanitizer.ts:1-5`
- `research/empirical-readiness/scripts/regulationIndex.ts:131-153`

The selected policy is `REPLACE_WITH_U+0020`, not deletion. This preserves a boundary between formerly separated characters. The choice can alter chunk text and potentially retrieval, so it is recorded as a methodological boundary, not a proven improvement.

The acquired regulation PDF contained zero U+0000 across the full `readPdfPages` extraction, so the sanitizer was a no-op in the real Stage A run. Evidence: `.volt-ai/kec-regulation-provisional/a2-readability.json#/pagesWithNul` and `#/totalNul`.

## Required Stage B verdicts

```text
NUL_AFFECTED_CHUNK_COUNT: 312 of 536 (OBSERVED)
NUL_ORIGIN: PDFJS_TEXT_ITEM_OUTPUT
  locator: packages/mcp-kec/src/knowledge/pdfPages.ts:32-39
NUL_IMPACT: DOWNSTREAM_ONLY
FIX_SURFACE: RESEARCH_CONTAINABLE
STAGE_B_GATE: PASS_TO_STAGE_A
```

No production file or existing database was modified. The protected index's final SHA-256 remained `a24b705e74872d64f492617011ed355154cae2cbd3a523153114e126bd67e43f` (**OBSERVED**; `.volt-ai/kec/index.db`, final SHA-256).
