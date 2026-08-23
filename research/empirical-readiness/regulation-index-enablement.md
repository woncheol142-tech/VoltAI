# Regulation Index Enablement

Result: **COMPLETE**. The Stage B hard gate passed as `RESEARCH_CONTAINABLE`; Stage A completed without touching the existing drawing index.

## A1. Provisional regulation artifact

| Claim | Status | Observation | Evidence |
|---|---|---|---|
| Artifact acquired | OBSERVED | KEA-distributed PDF for announcement `2024-749` | `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf` — filesystem bytes; PDF page 1 |
| Source | OBSERVED | [KEA announcement page](https://kec.kea.kr/sub_tech/regulation_all.php?b_name=report2&mode=view&number=2381); direct attachment endpoint `download.v2.php?b_name=report2&bd_number=2381&seq=1` | `.volt-ai/kec-regulation-provisional/raw/kea-2024-749-source-page.html:1447,1460,1469` — announcement number and PDF endpoint/label; SHA-256 `0a4743f5370001c24959e41f2d079b7fa95018039d85822d0680f928eacc2314` |
| Identity | OBSERVED | SHA-256 `56f306db5947ca4c567786e873f6de63c9a3ba7b21f175baecb4ae94da2b0f38`; 22,542,443 bytes; 1,207 pages | PDF filesystem bytes; `.volt-ai/kec-regulation-provisional/first-run-result.json#/source` |
| Publication layer | OBSERVED | `OFFICIAL_REPUBLICATION` | retained source page lines 1447–1469 |
| Document scope | OBSERVED | `CONSOLIDATED_FULL_TEXT` | retained source page line 1469 `개정전문`; PDF page 1; contents and clause/provision samples on pages 3–5, 602–606, 1203–1207 |
| Source policy | OBSERVED | `SOURCE_PROVISIONAL=YES` | This report — citation policy remains undecided |

`SOURCE_PROVISIONAL=YES` means this artifact enables an empirical run only. It is not designated `KEC_CITABLE_SOURCE`.

### Future discrepancy pair

The retained issuer attachment and the KEA republication are both listed under the same 2024-749 announcement as `개정전문` artifacts. `SAME_REVISION=YES`, `SAME_DOCUMENT_SCOPE=YES`, and `DISCREPANCY_AUDIT_ELIGIBLE=YES` are **OBSERVED** from `.volt-ai/kec-regulation-provisional/raw/kea-2024-749-source-page.html:1447,1460,1469`, the prior representation manifest, and the PDF's self-identification/coverage. Publication layers differ: `ISSUER_ATTACHMENT` versus `OFFICIAL_REPUBLICATION`. The discrepancy audit itself is **NOT_ATTEMPTED**.

## A2. Machine readability

The existing `packages/mcp-kec/src/knowledge/pdfPages.ts::readPdfPages` capability was used with no new dependency.

| Claim | Status | Observation | Evidence |
|---|---|---|---|
| Deterministic sample | OBSERVED | Pages 1–5, 602–606, and 1203–1207 | `.volt-ai/kec-regulation-provisional/a2-readability.json#/samplePages` |
| Text layer | OBSERVED | `TEXT_PRESENT` on 14 of 15 pages; page 2 had no extracted text | same artifact `#/sample`, `#/textPresentCount`, `#/noTextCount` |
| Clause prose | OBSERVED | Contents, numbered clauses, normative prose, formulas/figures, and closing provisions appear in the distributed sample | same artifact `#/sample` |
| Clause identifier | OBSERVED | `241.17.3` occurs in sampled page 1206 | same artifact `#/sample/13/clauseIdentifiers` |
| U+0000 | OBSERVED | Zero pages with U+0000 and zero total U+0000 across the full 1,207-page extraction | same artifact `#/pagesWithNul`, `#/totalNul` |
| Readability verdict | OBSERVED | `TEXT_NATIVE` | the named sample and full-extraction NUL count |

One blank sampled page does not change the document-level `TEXT_NATIVE` classification because distributed beginning, middle, and end pages expose native clause text. It also does not establish that every page has text.

## A3. Separate index

The only sanitizer is `research/empirical-readiness/scripts/nulSanitizer.ts:1-5`; it replaces U+0000 with U+0020. The real input contained no U+0000, so the policy was a no-op for this artifact (**OBSERVED**; first-run result `#/sanitization`).

Exactly three approved tests ran Green: 3 passed, 0 failed. Their assertions cover the protected DB's existence and immutability, research-only sanitizer isolation, collection/path separation, persisted U+0000 removal with U+0020 boundary preservation, and stored `sourceSha256` binding. They remain synthetic contract tests and do not prove real-input retrieval accuracy. Evidence: `research/empirical-readiness/tests/regulationIndex.test.ts:24-126` and the `node:test` output.

| Claim | Status | Observation | Evidence |
|---|---|---|---|
| Index built | OBSERVED | `YES`; 1,896 chunks | `.volt-ai/kec-regulation-provisional/index.db` — `kec_chunks WHERE collection='kec-regulation-provisional'`; first-run result `#/index/total` |
| Index identity | OBSERVED | `kec-regulation-provisional`, distinct from `kec` | new DB `index_metadata`; first-run result `#/index/metadata/0` |
| Embedding | OBSERVED | `ollama` / `nomic-embed-text` / 768 dimensions | same metadata row |
| Model choice | OBSERVED | `PRODUCTION_DEFAULT_INTENTIONAL`; model was warm before the run | `research/empirical-readiness/scripts/runRegulationIndex.ts:135-180,232-238`; `ollama ps` preflight |
| Source binding | OBSERVED | All 1,896 chunks use the provisional PDF path and SHA-256 binding | new DB `kec_chunks` metadata/source path; first-run result `#/index/sources` |
| NUL after sanitizer | OBSERVED | 0 | first-run result `#/sanitization/nulCountAfterSanitization`; new DB `instr(text,char(0))` count |
| Existing drawing index | OBSERVED | Unmodified; before/after SHA-256 both `a24b705e74872d64f492617011ed355154cae2cbd3a523153114e126bd67e43f` | first-run result `#/drawingIndex`; `.volt-ai/kec/index.db` final SHA-256 |

Embedding-policy boundary:

```text
EMBEDDING_MODEL: nomic-embed-text
EMBEDDING_MODEL_CHOICE: PRODUCTION_DEFAULT_INTENTIONAL
KNOWN_LIMITATION: Korean retrieval performance unverified for this model on regulation text
ALTERNATIVE_NOT_TESTED: BGE-M3 (deferred to a separate run)
```

No fallback, model swap, chunk/retrieval tuning, query reformulation, or retry was used.

## A4. Deterministic sample

The sample uses first 5, centered 5, last 5, and 5 evenly spaced remaining rowids. Excerpts are at most approximately 40 characters.

| Rowid | Page | Classification | Short excerpt |
|---:|---:|---|---|
| 1 | 1 | INDETERMINATE | 산업통상자원부 공고 제2024-749호… |
| 2 | 3 | REGULATION_TEXT | 공통사항 (100 총칙) 101 목적… |
| 3 | 3 | REGULATION_TEXT | 113.2 감전에 대한 보호…113.3 열 영향에 대한 보호 |
| 4 | 3 | REGULATION_TEXT | 113.3 열 영향에 대한 보호…113.4 과전류에 대한 보호 |
| 5 | 3 | REGULATION_TEXT | 113.7 전원공급 중단에 대한 보호…114 전기설비의 유지·보수 |
| 318 | 46 | REGULATION_TEXT | 시설할 것…절연 피복은 KS C IEC 60454에 적합 |
| 632 | 307 | REGULATION_TEXT | 235.3 옥측 또는 옥외의 먼지가 많은 장소 등의 시설 |
| 946 | 527 | REGULATION_TEXT | 421 변전방식의 일반사항 |
| 947 | 528 | REGULATION_TEXT | 차단기는…용량을 결정하고… |
| 948 | 529 | REGULATION_TEXT | 431 전차선로의 일반사항 |
| 949 | 530 | REGULATION_TEXT | 시스템 종류 공칭전압…동적…정적… |
| 950 | 531 | REGULATION_TEXT | 시스템 종류 공칭전압…동적…정적… |
| 951 | 532 | REGULATION_TEXT | 431.9…고려하여야 하는 하중 |
| 1264 | 765 | REGULATION_TEXT | 615.8…유효 보강면적 ≥ 요구 보강면적 |
| 1578 | 962 | REGULATION_TEXT | 645.16.11…다음의 요건을 적용할 수 있다 |
| 1892 | 1202 | REGULATION_TEXT | 725 기타 시설…725.1 발전소 |
| 1893 | 1204 | REGULATION_TEXT | 801 (재검토기한)… |
| 1894 | 1205 | REGULATION_TEXT | 부칙…제1조… |
| 1895 | 1206 | REGULATION_TEXT | 부칙…241.17.3… |
| 1896 | 1207 | REGULATION_TEXT | 부칙(제2023-875호)…제1조… |

Reviewed counts: `REGULATION_TEXT=19`, `DRAWING_TEXT=0`, `MIXED=0`, `INDETERMINATE=1` (**OBSERVED**; `.volt-ai/kec-regulation-provisional/index.db`, the 20 named rowids).

The first-run keyword classifier initially reported 18 regulation and 2 indeterminate chunks. Direct review changed rowid 318 to `REGULATION_TEXT` because the stored text contains prescriptive clause prose (`시설할 것` and a standards-compliance obligation). The adjustment is explicit so automated Green output is not mistaken for human content validation.

## A4. First-run retrieval

Each fixed query was issued exactly once with top-3, using `nomic-embed-text`. All hits use `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`.

| Query | Rowid/page | Class | Similarity | Short excerpt |
|---|---|---|---:|---|
| `241.17.3` | 101 / 11 | REGULATION_TEXT | 0.6164 | 온천승온기…241.5 전기온상 등… |
| `241.17.3` | 102 / 11 | REGULATION_TEXT | 0.6124 | 241.8 놀이용 전차… |
| `241.17.3` | 765 / 401 | REGULATION_TEXT | 0.6004 | 331.13.1의 2… |
| `다만` | 789 / 416 | REGULATION_TEXT | 0.6754 | 다만, 교류 전차선 등과 가공전선… |
| `다만` | 1146 / 673 | REGULATION_TEXT | 0.6708 | 보강링 또는 보강링과 동체… |
| `다만` | 611 / 291 | REGULATION_TEXT | 0.6643 | 터미널러그…다만, 단선을… |
| `접지` | 631 / 306 | REGULATION_TEXT | 0.6885 | 적설 또는 빙결을 방지…전열 장치… |
| `접지` | 682 / 339 | REGULATION_TEXT | 0.6462 | 충전장치를 시설한 장소… |
| `접지` | 915 / 502 | REGULATION_TEXT | 0.6405 | 무효 전력 보상 장치…배전반의 시설 |

`RETRIEVAL_RETURNS_REGULATION = OBSERVED_TRUE`: 9 of 9 returned chunks are regulation text. Evidence: `.volt-ai/kec-regulation-provisional/first-run-result.json#/retrieval` and the named DB rowids.

Relevance quality is weak in this run: the exact literal occurs in 0/3 clause-identifier hits, 2/3 conditional-phrase hits, and 0/3 topic hits (**OBSERVED**; full stored text for the nine rowids). The cause is **UNVERIFIED**. The run does not isolate embedding-model behavior from chunking, extraction layout, query characteristics, or another cause; it does not attribute the result solely to `nomic-embed-text`.

## Verdicts

### Label correction

The prior `REGULATION_GROUNDED_EMPIRICAL_RUN_READY=YES` value is retained in `enablement.json#/label_correction_history/0` for audit history and is superseded by the following **OBSERVED** correction. Evidence: `.volt-ai/kec-regulation-provisional/first-run-result.json#/retrieval` and the full stored text of the six hits for `241.17.3` and `접지`.

```text
INDEX_BUILT: YES
RETRIEVAL_QUALITY: INSUFFICIENT (OBSERVED)
EMPIRICAL_RUN_READY: NO
reason: clause-identifier and topic queries returned 0/3 exact-string
        presence; running end-to-end in this state would let retrieval
        failure mask downstream observation

RETRIEVAL_METRIC_UNINFORMATIVE: OBSERVED
reason: the bounded index sample is 19/20 regulation text, so "returns
        regulation text 3/3" does not discriminate retrieval quality
        from an in-index baseline
```

```text
NUL_AFFECTED_CHUNK_COUNT: 312 of 536 (OBSERVED)
NUL_ORIGIN: PDFJS_TEXT_ITEM_OUTPUT
NUL_IMPACT: DOWNSTREAM_ONLY
FIX_SURFACE: RESEARCH_CONTAINABLE

REGULATION_ARTIFACT_ACQUIRED: OBSERVED
REGULATION_ARTIFACT_SCOPE: CONSOLIDATED_FULL_TEXT
REGULATION_ARTIFACT_READABLE: TEXT_NATIVE
SOURCE_PROVISIONAL: YES

REGULATION_INDEX_BUILT: YES
REGULATION_INDEX_PATH: .volt-ai/kec-regulation-provisional/index.db
EXISTING_DRAWING_INDEX_MODIFIED: NO
REGULATION_TEXT_SAMPLE_COUNT: 19 of 20
RETRIEVAL_RETURNS_REGULATION: OBSERVED_TRUE

REGULATION_GROUNDED_EMPIRICAL_RUN_READY: NO (CORRECTED; PRIOR YES RETAINED)
reason: index construction succeeded, but retrieval quality is insufficient
        for an empirical end-to-end run.
```

## Unverified and not attempted

**UNVERIFIED:** Korean retrieval quality beyond this first run; a single cause for weak relevance; U+0000's embedding impact in the drawing index; `KEC_CITABLE_SOURCE`; the 1,876 unsampled chunks; HWP internal structure; PDF rendition lineage.

**NOT_ATTEMPTED:** BGE-M3; FTS5; placeholder embeddings; query reformulation; tuning; discrepancy audit; empirical review pipeline; Task94 reopening; Task90/93/94/95 changes; commit/push.

## Sampling limit and stop

The deterministic sample covers 20 of 1,896 chunks. It does not establish the content of the other 1,876 chunks or the entire index. Nine retrieval hits from three fixed queries do not establish general retrieval quality.

Production files modified: **NONE**. Existing databases modified: **NONE**. The newly created provisional DB is separate. The empirical review run is **NOT_ATTEMPTED**. STOP after these verdicts.
