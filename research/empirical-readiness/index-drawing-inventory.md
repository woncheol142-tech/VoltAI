# VoltAI Empirical Readiness — Index & Drawing Inventory

Recorded: `2026-08-23T22:23:20+09:00`

Mode: read-only inventory and observation. No database, source artifact,
production code, dependency, index, or package configuration was modified.

## Request boundary

**OBSERVED** — the supplied request artifact ends immediately after
`Required verdicts:`. No verdict list follows that label.

- evidence: `/Users/woncheol/.codex/attachments/549c14ef-0bb5-4f3f-a842-42e92d88152e/pasted-text.txt`
- locator: line 192 and EOF
- handling: this report emits only verdicts directly required by Phases 1–3;
  it does not invent the missing names.

## Phase 0 — Baseline

### Repository

| Claim | Status | Value | Evidence and locator |
| --- | --- | --- | --- |
| Starting branch | OBSERVED | `main` | `.git`; `git branch --show-current` |
| Starting HEAD | OBSERVED | `a5f668ba7484c7f765f65ea3ef88f031eb0e7512` | `.git`; `git rev-parse HEAD` |
| Starting `git status --short` | OBSERVED | empty | `.git`; `git status --short --untracked-files=all` |

### Existing PDF-reading capabilities

**OBSERVED — production index reader.**

- module and entry point:
  `packages/mcp-kec/src/knowledge/pdfPages.ts::readPdfPages`
- library: `pdfjs-dist 6.1.200`, `legacy/build/pdf.mjs`
- implementation locator: `pdfPages.ts:3,19-46`
- production call: `packages/mcp-kec/src/tools/indexKec.ts:237-246`
- MCP entry point: `createIndexKecTool`, name `index_kec`, at
  `tools/indexKec.ts:301-333`
- server registration: `packages/mcp-kec/src/index.ts:35-65`

This capability is invoked by a current production path, not only by tests.

**OBSERVED — Task90/93 structural reader.**

- module:
  `packages/mcp-kec/src/knowledge/requirementExtraction.ts`
- exported entry points: `extractKecRequirementSnapshot`,
  `extractKecRequirementSnapshotWithCapture`, and `extractKecRequirements`
- library: `pdfjs-dist 6.1.200`, loaded at
  `requirementExtraction.ts:141-142`
- PDF byte/text path: `requirementExtraction.ts:170-220,649-664`
- exports: `requirementExtraction.ts:732-749`

The bounded `src` call search found no production call to those three exports;
production modules import related types/constants only, while the test suite
invokes the exports directly. They are not exported by
`packages/mcp-kec/src/index.ts:16-33`. Therefore their current direct invocation
class is **OBSERVED: tests only within the bounded repository search**.

## Phase 1 — Index content observation

### Database identity and structure

**OBSERVED execution method:** the database was opened through SQLite URI
`mode=ro&immutable=1` with the CLI `-readonly` flag.

| Claim | Status | Value | Evidence and locator |
| --- | --- | --- | --- |
| Database path | OBSERVED | `.volt-ai/kec/index.db` | filesystem path |
| SHA-256 | OBSERVED | `a24b705e74872d64f492617011ed355154cae2cbd3a523153114e126bd67e43f` | database bytes |
| Size | OBSERVED | 9,437,184 bytes | filesystem stat |
| `index_metadata` rows | OBSERVED | 1 | `SELECT COUNT(*) FROM index_metadata` |
| `kec_chunks` rows | OBSERVED | 536 | `SELECT COUNT(*) FROM kec_chunks` |
| Total chunks | OBSERVED | 536, rowid 1–536 | `COUNT/MIN/MAX(rowid)` from `kec_chunks` |

Full `index_metadata` contents:

| id | embedding_provider | embedding_model | dimensions | indexed_at | Status / locator |
| --- | --- | --- | ---: | --- | --- |
| `kec` | `ollama` | `nomic-embed-text` | 768 | `2026-08-09T01:33:36.899Z` | OBSERVED — `SELECT * FROM index_metadata ORDER BY id` |

Distinct source paths:

| source_path | chunk_count | Status / locator |
| --- | ---: | --- |
| `전기 결합_1_100.pdf` | 536 | OBSERVED — `GROUP BY source_path` in `.volt-ai/kec/index.db` |

The `id=kec` metadata value is recorded only as metadata. It is not treated as
evidence that the indexed content is KEC regulation prose.

### Deterministic sampling rule

**OBSERVED methodology** — order all 536 chunks by rowid, then select:

- first five: `1–5`
- centered five: `266–270`
- last five: `532–536`
- remove those 15, then take ranks `floor(k*(521+1)/6)`, `k=1..5`,
  from the remaining ordered rowids: `92, 179, 271, 358, 445`

This produces 20 unique rowids:

```text
1, 2, 3, 4, 5, 92, 179, 266, 267, 268,
269, 270, 271, 358, 445, 532, 533, 534, 535, 536
```

**OBSERVED measurement caveat:** 10 sampled chunks contain embedded NUL
characters: `1, 3, 4, 5, 266, 267, 268, 269, 270, 271`. SQLite
`length(text)` and `substr(text,...)` stopped at the first NUL, so those initial
SQL-derived lengths/previews were rejected. Final character lengths below are
Python Unicode code-point lengths from a read-only sqlite3 connection. Embedded
NUL and extraction-layout whitespace are normalized only for the short
classification previews. Evidence:
`.volt-ai/kec/index.db`, the named rowids' `text` values and NUL counts.

### Chunk observations

All excerpts are at most 40 characters.

| rowid | source_path | chars | Classification | Short excerpt | Status / locator |
| ---: | --- | ---: | --- | --- | --- |
| 1 | `전기 결합_1_100.pdf` | 99 | DRAWING_TEXT | `주택건설사업계획(변경)승인…신축공사` | OBSERVED — `kec_chunks.rowid=1:text` |
| 2 | `전기 결합_1_100.pdf` | 165 | DRAWING_TEXT | `여수 신기주공…아파트 신축공사` | OBSERVED — `rowid=2:text` |
| 3 | `전기 결합_1_100.pdf` | 1,200 | DRAWING_TEXT | `도면…목록표-1…전기부분` | OBSERVED — `rowid=3:text` |
| 4 | `전기 결합_1_100.pdf` | 690 | DRAWING_TEXT | `옥외…조경등설비…배치도` | OBSERVED — `rowid=4:text` |
| 5 | `전기 결합_1_100.pdf` | 1,200 | DRAWING_TEXT | `범례…주기사항…단선결선도` | OBSERVED — `rowid=5:text` |
| 92 | `전기 결합_1_100.pdf` | 165 | DRAWING_TEXT | `전기컨설턴트…아파트 신축공사` | OBSERVED — `rowid=92:text` |
| 179 | `전기 결합_1_100.pdf` | 1,172 | DRAWING_TEXT | `18kV 100A…L.B.S…MOF` | OBSERVED — `rowid=179:text` |
| 266 | `전기 결합_1_100.pdf` | 791 | DRAWING_TEXT | `기기명칭…회로번호…차단기규격` | OBSERVED — `rowid=266:text` |
| 267 | `전기 결합_1_100.pdf` | 923 | DRAWING_TEXT | `1단지…MCC…결선도-5` | OBSERVED — `rowid=267:text` |
| 268 | `전기 결합_1_100.pdf` | 815 | DRAWING_TEXT | `MCCB…MCB…CBR…RCBO…옥외…분전반` | OBSERVED — `rowid=268:text` |
| 269 | `전기 결합_1_100.pdf` | 948 | DRAWING_TEXT | `유도휀 주차장` | OBSERVED — `rowid=269:text` |
| 270 | `전기 결합_1_100.pdf` | 883 | DRAWING_TEXT | `기기명칭…회로번호…차단기규격` | OBSERVED — `rowid=270:text` |
| 271 | `전기 결합_1_100.pdf` | 923 | DRAWING_TEXT | `1단지…MCC…결선도-6` | OBSERVED — `rowid=271:text` |
| 358 | `전기 결합_1_100.pdf` | 690 | DRAWING_TEXT | `MAIN…SPD…MCCB…단위세대` | OBSERVED — `rowid=358:text` |
| 445 | `전기 결합_1_100.pdf` | 668 | DRAWING_TEXT | `SPARE…CBR…MCCB…태양광` | OBSERVED — `rowid=445:text` |
| 532 | `전기 결합_1_100.pdf` | 690 | DRAWING_TEXT | `통신장비전원…BREAKER SIZE` | OBSERVED — `rowid=532:text` |
| 533 | `전기 결합_1_100.pdf` | 1,200 | DRAWING_TEXT | `주차유도…무선통신 RACK` | OBSERVED — `rowid=533:text` |
| 534 | `전기 결합_1_100.pdf` | 689 | DRAWING_TEXT | `실내외기전원…CBR` | OBSERVED — `rowid=534:text` |
| 535 | `전기 결합_1_100.pdf` | 1,200 | DRAWING_TEXT | `전열교환기전원…BREAKER SIZE` | OBSERVED — `rowid=535:text` |
| 536 | `전기 결합_1_100.pdf` | 661 | DRAWING_TEXT | `SPD Class Ⅱ…MCCB…RCBO` | OBSERVED — `rowid=536:text` |

Classification counts:

```text
REGULATION_TEXT = 0
DRAWING_TEXT    = 20
MIXED           = 0
INDETERMINATE   = 0
```

`ANY_REGULATION_TEXT_CHUNK_OBSERVED = NO` is **OBSERVED** for these named 20
rowids only.

**Sampling limit:** 20 samples do not establish the composition of the other
516 chunks or of the 536-chunk index as a whole.

## Phase 2 — Drawing artifact observation

### Identity and reader

| Claim | Status | Value | Evidence and locator |
| --- | --- | --- | --- |
| Path | OBSERVED | `project-files/전기 결합_1_100.pdf` | filesystem path |
| SHA-256 | OBSERVED | `94bd23c711bf289986fe20307e9243ddf85fa4e8c4106c4006b2c2a3f76dfbd1` | PDF bytes |
| Size | OBSERVED | 61,087,700 bytes | filesystem stat |
| PDF version | OBSERVED | 1.3 | PDF header / `file(1)` |
| Page count | OBSERVED | 100 | `pdfjs document.numPages` |
| Reader | OBSERVED | production `readPdfPages`, `pdfjs-dist 6.1.200` | `pdfPages.ts:3,19-46` |

**OBSERVED execution boundary:** no new PDF dependency was installed. The
already installed workspace `tsx` and `pdfjs-dist` were used read-only.

### Metadata

| Field | Status | Value | Locator |
| --- | --- | --- | --- |
| Producer | OBSERVED | `macOS 버전 26.5.1(빌드 25F80) Quartz PDFContext` | `pdfjs getMetadata().info.Producer` |
| Creator | OBSERVED | `미리보기` | `pdfjs getMetadata().info.Creator` |
| Title | OBSERVED | `전기 결합` | `pdfjs getMetadata().info.Title` |

### Deterministic page sample

The sample is pages `1–3`, `49–51`, and `98–100`.

| Page | Text layer | Chars | Characterization | Short excerpt | Dimensions | Status / locator |
| ---: | --- | ---: | --- | --- | --- | --- |
| 1 | TEXT_PRESENT | 98 | project cover/title fields | `주택건설사업계획(변경)승인…신축공사` | 595×842 pt, portrait | OBSERVED — page 1 textContent/viewport |
| 2 | TEXT_PRESENT | 4,151 | drawing title-block fields | `등록번호…전기컨설턴트…신축공사` | 595×842 pt, portrait | OBSERVED — page 2 |
| 3 | TEXT_PRESENT | 5,104 | drawing title-block fields | `전기컨설턴트…아파트 신축공사` | 595×842 pt, portrait | OBSERVED — page 3 |
| 49 | TEXT_PRESENT | 4,693 | electrical block-diagram labels | `1단지 전력간선설비 BLOCK DIAGRAM` | 595×842 pt, portrait | OBSERVED — page 49 |
| 50 | TEXT_PRESENT | 2,743 | drawing title-block fields | `등록번호…전기컨설턴트…신축공사` | 595×842 pt, portrait | OBSERVED — page 50 |
| 51 | TEXT_PRESENT | 3,197 | MCC wiring-diagram labels | `1단지 MCC 결선도-1 SCALE:A1` | 595×842 pt, portrait | OBSERVED — page 51 |
| 98 | TEXT_PRESENT | 3,029 | panel/load labels and ratings | `부하명 BREAKER SIZE…3Ø4W 380/220V` | 595×842 pt, portrait | OBSERVED — page 98 |
| 99 | TEXT_PRESENT | 1,412 | distribution-board diagram labels | `1단지 분전반 결선도-22` | 595×842 pt, portrait | OBSERVED — page 99 |
| 100 | TEXT_PRESENT | 3,940 | title-block and schedule fields | `등록번호…전기컨설턴트…신축공사` | 595×842 pt, portrait | OBSERVED — page 100 |

**OBSERVED:** all nine sampled pages have a text layer. This establishes sampled
machine readability only. Whole-document machine readability is
**UNVERIFIED** because page-level status was required and retained for nine of
100 pages.

**OBSERVED:** all nine sampled viewports are 595×842pt portrait. Large-format
landscape geometry was not observed; geometry does not support that drawing
sheet hypothesis.

**OBSERVED — drawing-set classification:** the distributed sample contains a
project cover, drawing title blocks, block/wiring diagram labels, panel/load
schedules, equipment tags, and ratings rather than KEC clause prose. Evidence:
the named nine PDF pages and `getMetadata().info.Title`. This document-level
classification does not classify each unsampled page.

**NOT_ATTEMPTED:** drawing-semantic interpretation and full-page-text
retention.

## Phase 3 — KEC regulation source recount

**OBSERVED bounded method:** the candidate set is the two `project-files` PDFs,
the retained official 2024-749 CFB artifact advertised as `.hwpx`, and the
retained successful current 2025-227 law.go.kr XML response.
History/filter/error responses and SQLite indexes are diagnostics or derived
stores, not candidate source texts. Evidence: bounded `find` under
`project-files`, `.volt-ai/kec`, and `research/kec-representation-probe/raw`.

| Candidate | SHA-256 / size | artifact_type | document_scope | Usable consolidated source? | Status and locator |
| --- | --- | --- | --- | --- | --- |
| `project-files/전기 결합_1_100.pdf` | `94bd…fbd1`; 61,087,700 | DRAWING — OBSERVED | UNKNOWN — NOT_ATTEMPTED | No — OBSERVED | PDF pages 1–3,49–51,98–100; scope is not applicable to a drawing |
| `project-files/한국전기설비규정(기후에너지환경부공고)(제2025-227호)(20260105).pdf` | `58ab…d7a`; 35,518 | REGULATION — OBSERVED | NOTICE_ONLY — OBSERVED | No — OBSERVED | pdfjs page count 1; page 1 has 129 chars of law.go.kr header/amendment metadata, not clause text |
| `research/kec-representation-probe/raw/ministry-2024-749-kec-full.hwpx` | `3d6d…c375`; 39,796,224 | UNKNOWN — UNVERIFIED | UNKNOWN — UNVERIFIED | UNVERIFIED | Bytes 0x00–0x07 are CFB signature; internal content was not opened or parsed |
| `research/kec-representation-probe/raw/body-probe-2025-227.response.xml` | `c16a…f56`; 3,120 | REGULATION — OBSERVED | UNKNOWN — UNVERIFIED | No — OBSERVED for this response | Self-identifying KEC metadata; `/AdmRulService/조문내용` exists with zero children/text |

The CFB row remains `UNKNOWN/UNVERIFIED`: its advertised filename and prior
source-role record are not treated as proof of internal content or scope.

```text
USABLE_CONSOLIDATED_KEC_SOURCE_COUNT = 0
STATUS = OBSERVED
```

Count definition: confirmed candidates with `artifact_type=REGULATION`,
`document_scope=CONSOLIDATED_FULL_TEXT`, and content readable by the currently
approved existing capability. This is a bounded count of confirmed usable
sources, not proof that the unparsed CFB artifact lacks consolidated KEC
content.

## Phase-derived verdicts

| Verdict | Status | Value | Boundary |
| --- | --- | --- | --- |
| Index sample content | OBSERVED | `DRAWING_TEXT_OBSERVED` | 20 drawing, 0 indeterminate, 0 regulation among the named 20 rowids |
| Any regulation chunk observed | OBSERVED | `NO` | The other 516 chunks remain unclassified |
| Local `전기 결합_1_100.pdf` type | OBSERVED | `DRAWING` | Based on the named page sample and metadata; not every page individually classified |
| Sampled PDF text layer | OBSERVED | `TEXT_PRESENT_9_OF_9` | Nine required pages only |
| Whole-document machine readability | UNVERIFIED | — | 100-page whole-document page-level claim not established |
| Usable consolidated KEC source count | OBSERVED | `0` | Confirmed usable sources in bounded workspace only; CFB internals remain unknown |
| Regulation-grounded empirical run readiness | OBSERVED | `NOT_READY` | No confirmed readable consolidated KEC source; no regulation text in the named index sample |

## Stop confirmation

- Task90/93 production logic: NOT_ATTEMPTED
- database mutation or re-index: NOT_ATTEMPTED
- drawing or KEC artifact modification: NOT_ATTEMPTED
- dependency addition: NOT_ATTEMPTED
- end-to-end review run: NOT_ATTEMPTED
- commit or push: NOT_ATTEMPTED
