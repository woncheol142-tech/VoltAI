# Retrieval Bottleneck Diagnosis — Chunking & Lexical Path

Result: **COMPLETE WITH OBSERVED READ-PATH MUTATION DEBT**. No tuning, re-indexing, production change, or empirical review run was performed.

## 1. Label correction

`LABEL_CORRECTION_APPLIED=YES` (**OBSERVED**). The prior `REGULATION_GROUNDED_EMPIRICAL_RUN_READY=YES` value remains at `enablement.json#/label_correction_history/0` and is superseded by:

```text
INDEX_BUILT: YES
RETRIEVAL_QUALITY: INSUFFICIENT (OBSERVED)
EMPIRICAL_RUN_READY: NO
RETRIEVAL_METRIC_UNINFORMATIVE: OBSERVED
```

Evidence: `.volt-ai/kec-regulation-provisional/first-run-result.json#/retrieval`; `research/empirical-readiness/enablement.json#/verdicts`.

### Record-only correction history

- `HUMAN_BOUNDARY_DECISION`: `CHUNK_RESPECTS_CLAUSE_BOUNDARY=UNVERIFIED` → `OBSERVED_FALSE`. The superseded statements that human judgment was still pending are retained here. Evidence: `.volt-ai/kec-regulation-provisional/retrieval-diagnosis-python.json#/sample` (rowids 2,3,4,5,946,947,949,950).
- `TABLE_SPLIT_ACROSS_CHUNKS_DEBT`: `NOT_RECORDED` → `OBSERVED`. Evidence: `.volt-ai/kec-regulation-provisional/retrieval-diagnosis-python.json#/sample` (rowids 949,950).
- `NEXT_STEP_ELIGIBLE_EXPANSION`: `[LEXICAL_PATH_DESIGN]` → `[CHUNKING_REVIEW, LEXICAL_PATH_DESIGN]`. Evidence: `retrieval-diagnosis.json#/cause_separation/CHUNK_GRANULARITY_TOO_COARSE` and `#/cause_separation/IDENTIFIER_NOT_SEMANTICALLY_RETRIEVABLE`.

## 2. Database integrity event and runtime merge

`DEBT=READ_PATH_MUTATES_DATABASE` is **OBSERVED**. `SqliteKnowledgeStore` construction calls `migrateKnowledgeSchema`, which runs `BEGIN IMMEDIATE`, schema validation, `PRAGMA user_version`, and `COMMIT`: `packages/knowledge-sqlite/src/sqliteKnowledgeStore.ts:140-146`; `packages/knowledge-sqlite/src/schema.ts:303-333`.

The first three-query attempt changed only the SQLite header change-counter and version-valid-for fields by +3:

```text
OLD_SHA: 5836cb4a540fffaa7d838a0e935b9f8ca5a24d7d92d8d02408b04641fe24f50a
NEW_BASELINE_SHA: 3af8e8a1c34f7e90c19bab1de1454e6791c3a912401337e6065a11bc3512fadf
```

No restoration was performed. Decrementing those fields was evaluated in memory only and reproduced the old SHA exactly. Metadata, all 1,896 stored chunk bytes, source binding, and NUL count are otherwise unchanged (**OBSERVED**; original DB and header offsets 24–27/92–95).

The accepted vector run used a byte-identical copy of the new baseline. The copy changed from `3af8…fadf` to `2f38…84ce`; the original remained `3af8…fadf`. Evidence: `.volt-ai/kec-regulation-provisional/retrieval-diagnosis-vector.json` hash fields.

Python ran at `2026-08-24T00:06:01+09:00`; TypeScript ran at `2026-08-24T00:03:43.053+09:00`. Both are bound to original SHA `3af8…fadf` (**OBSERVED**; the two retained diagnostic JSON artifacts).

A3/A4 did **not** open `.volt-ai/kec/index.db` through `SqliteKnowledgeStore`; it was hashed and path-compared only. `EXISTING_DRAWING_INDEX_MODIFIED=NO` therefore stands (**OBSERVED**; `runRegulationIndex.ts:18-22,140-164,211-250`; `regulationIndex.ts:102-118,190-213`; drawing DB SHA `a24b705e…e43f`).

## 3. Chunking characterization

| Measurement | Status | Value | Evidence |
|---|---|---:|---|
| Total chunks | OBSERVED | 1,896 | Python artifact `/chunk_count` |
| Source pages | OBSERVED | 1,207 | Python artifact `/source_page_count` |
| Indexed distinct pages | OBSERVED | 1,198 | Python artifact `/indexed_distinct_page_count` |
| Single-page mappings | OBSERVED | 1,896 | Python artifact `/single_page_locator_chunks` |
| Multi-page mappings | OBSERVED | 0 | Python artifact `/multi_page_locator_chunks` |
| Chunks/source page | OBSERVED | min 0, max 14, median 1, mean 1.571 | Python artifact `/chunks_per_all_source_page` |
| Chunks/indexed page | OBSERVED | min 1, max 14, median 1, mean 1.583 | Python artifact `/chunks_per_indexed_page` |
| Chunk characters | OBSERVED | min 29, max 1,200, median 938, mean 814.300, p90 1,199 | Python artifact `/chunk_character_length` |
| Clause IDs/chunk | OBSERVED | sample median 4.5 | Python artifact `/sample_clause_identifiers_per_chunk_median` |

The nine unmapped pages are page 2 (empty) plus eight 5–16-character section headings. Page 372 splits at `3.` into sub-minimum pieces; the others are already below the 15-character minimum. This is `EMPTY_OR_FILTERED_SHORT_SECTION_HEADINGS`, not evidence that a substantive page was lost (**OBSERVED**; source PDF pages 2,30,176,372,522,545,570,1171,1203; `chunk.ts:3-5,61-75,97-132`).

```text
CHUNK_UNIT: FIXED_LENGTH
qualification: PAGE_BOUNDED_FIXED_LENGTH_WITH_OVERLAP
```

Evidence: `chunk.ts:3-5,78-132,135-155`, observed max 1,200 and p90 1,199.

### Boundary-review material

`CHUNK_RESPECTS_CLAUSE_BOUNDARY=OBSERVED_FALSE` (**HUMAN_REVIEW**). The human reviewer found boundary violations in the retained start/end/next-start material; this decision was not auto-derived. The cited basis is recorded verbatim:

```text
rowid 2 end / rowid 3 start   — same clause 113.2 split
rowid 4 end / rowid 5 start   — same clause 113.7 split
rowid 946 end / 947 start     — mid-sentence split
rowid 949 start / 950 start   — repeated table header
```

Evidence: `.volt-ai/kec-regulation-provisional/retrieval-diagnosis-python.json#/sample` (rowids 2,3,4,5,946,947,949,950).

`boundary_decision_scope: 20 of 1,896 sampled chunks`. `population_boundary_rate: UNVERIFIED`. The human decision applies only to the reviewed sample; it does not establish the rate across all 1,896 chunks. The individual table fields below remain the originally retained `INDETERMINATE` auto-classification values rather than being rewritten as automatic decisions.

| Rowid/page | Chars / IDs | Start | End | Next start |
|---|---:|---|---|---|
| 1/1 | 625 / 0 | 공고 제2024-749호… | 고압·특고압전기설비… | 공통사항 (100 총칙)… |
| 2/3 | 1200 / 3 | 공통사항…101 목적… | …113.2 감전에 대한 보호… | …113.2 감전에 대한 보호… |
| 3/3 | 1200 / 7 | …113.2 감전에 대한 보호… | 113.6 전압외란…대책… | …113.3 열 영향에 대한 보호… |
| 4/3 | 690 / 5 | …113.3 열 영향에 대한 보호… | 113.7 전원공급 중단… | …113.7 전원공급 중단… |
| 5/3 | 1200 / 7 | …113.7 전원공급 중단… | 121.2 전선의 식별… | …121.2 전선의 식별… |
| 318/46 | 113 / 0 | …록 시설할 것… | KS C IEC 60454…사용할 것 | (130 전로의 절연)… |
| 632/307 | 1095 / 10 | 235.3 옥측 또는 옥외… | 물이 고이지 아니하도록… | 하여 옥측 또는 옥외에… |
| 946/527 | 977 / 4 | 421 변전방식…421.1… | 급전계통에 적합하게… | 차단기는 계통의 장래계획… |
| 947/528 | 221 / 0 | 차단기는 계통의 장래계획… | 디지털계전기방식을… | 431 전차선로…431.1… |
| 948/529 | 821 / 6 | 431 전차선로…431.1… | 최소 절연간격보다 증가… | 시스템 종류 공칭전압… |
| 949/530 | 842 / 4 | 시스템 종류 공칭전압… | 최소 작동높이를 고려… | 시스템 종류 공칭전압… |
| 950/531 | 799 / 5 | 시스템 종류 공칭전압… | 집전범위를 벗어나지 않아야… | 431.9 지지물 설계… |
| 951/532 | 1026 / 5 | 431.9 지지물 설계… | 전기관제실에서 이루어지도록… | 원격감시제어시스템… |
| 1264/765 | 1102 / 4 | 분기관…용착금속 면적… | 다만…초과해서는 안 | 주관 및 헤더를 나타내는… |
| 1578/962 | 357 / 4 | 645.16.10-2…645.16.11… | 절차가 아래와 같다 | 순서 1…두께를 계산한다 |
| 1892/1202 | 851 / 9 | 725 기타 시설…725.1… | 방지용 도장을 하여야 한다 | 801 (재검토기한)… |
| 1893/1204 | 1124 / 7 | 801 (재검토기한)… | 종전 기준을 따를 수 있다 | 부칙…제1조… |
| 1894/1205 | 1020 / 4 | 부칙(제2022-809호)… | 합격한 것으로 본다 | 부칙(제2023-563호)… |
| 1895/1206 | 773 / 6 | 부칙(제2023-563호)… | 신축건물에 적용한다 | 부칙(제2023-875호)… |
| 1896/1207 | 419 / 3 | 부칙(제2023-875호)… | 종전 기준을 따른다 | 없음 |

Full 60-character materials: `.volt-ai/kec-regulation-provisional/retrieval-diagnosis-python.json#/sample`.

### Observed debt: table split across chunks

`DEBT_ID=TABLE_SPLIT_ACROSS_CHUNKS`; `STATUS=OBSERVED`.

Rowid 949 and rowid 950 both begin with the same table header text (`"시스템 종류 공칭전압…"`), indicating a table divided at a chunk boundary with the header repeated. Evidence: `.volt-ai/kec-regulation-provisional/retrieval-diagnosis-python.json#/sample` (rowids 949,950). Scope: a single observed instance; population frequency is **UNVERIFIED**.

`POTENTIAL_IMPACT=UNVERIFIED`: KEC normative values for clearances, conductor sizes, and ratings are frequently expressed in tables. If tables are divided at fixed-length chunk boundaries, row-to-column correspondence may not survive into a single chunk. Whether this actually degrades requirement lookup has **NOT** been measured.

`PIPELINE_DIVERGENCE=OBSERVED`: the provisional regulation index was built with page-bounded fixed-length chunking (`chunk.ts`), not with the Task90/Task93 geometry-aware extraction path (`requirementExtraction.ts` / `sourceCapture.ts`). These are two different treatments of table structure. No claim is made here about which is correct. Evidence: `research/empirical-readiness/scripts/regulationIndex.ts:9,153`; `packages/mcp-kec/src/knowledge/chunk.ts:135-155`; `packages/mcp-kec/src/knowledge/requirementExtraction.ts:651-749`; `packages/mcp-kec/src/knowledge/sourceCapture.ts:78-125`.

## 4. Ground truth existence

Python full-string comparison read all 1,896 chunks with `mode=ro&immutable=1`. NUL chunks and total NUL are both zero.

| Query | Status | Exact chunks | Example rowids/pages |
|---|---|---:|---|
| `241.17.3` | OBSERVED | 2 | 681/339, 1895/1206 |
| `접지` | OBSERVED | 221 | 12/4, 13/4, 14/4 |
| `다만` | OBSERVED | 377 | 312/42, 313/43, 314/44 |

None of the three top-3 failures can be explained by exact-string absence from the index.

## 5. Unchanged vector top-10

Path: existing `searchProvisionalRegulationIndex`; model: `nomic-embed-text`; query text unchanged; top-k 10; accepted-run retries 0.

| Query | Ranked rowids | Exact flags | Exact / ground truth | First exact |
|---|---|---|---|---|
| `241.17.3` | 101,102,765,100,639,679,91,99,637,632 | N,N,N,N,N,N,N,N,N,N | 0/2 | NOT_IN_TOP_10 |
| `다만` | 789,1146,611,1212,831,875,512,846,821,315 | Y,N,Y,N,Y,Y,Y,N,Y,N | 6/377 | 1 |
| `접지` | 631,682,915,564,772,865,651,1498,921,320 | N,N,N,N,N,N,N,N,N,Y | 1/221 | 10 |

All 30 short excerpts and page locators are retained at `.volt-ai/kec-regulation-provisional/retrieval-diagnosis-vector.json#/queries` and summarized in `retrieval-diagnosis.json#/vector_retrieval/queries`.

`VECTOR_RETRIEVAL_MISSES_EXACT_MATCH=OBSERVED`: both indexed `241.17.3` chunks are absent from top 10.

For `접지`, random sampling without replacement would have expected exact counts 0.350 at top 3 and 1.166 at top 10; the vector observations were 0 and 1. This single query does **not** establish below-random retrieval or absence of signal; that comparison remains **UNVERIFIED**.

## 6. Cause separation

| Candidate | Status | Evidence for / against | Boundary |
|---|---|---|---|
| (a) Embedding-model Korean weakness | UNVERIFIED | `접지` first exact at rank 10; `다만` exact 6/10 | No comparison model run |
| (b) Chunk granularity too coarse | SUPPORTED | median 938 chars, p90 1199; sampled median 4.5 clause IDs/chunk; human-reviewed sample contains boundary violations | Structural contributor supported; sufficient causality and population boundary rate unverified |
| (c) Identifier not semantically retrievable | SUPPORTED | `241.17.3` exists in 2/1,896 but exact 0/10; `다만` exact 6/10 | Does not exclude other causes |
| (d) Query/document length asymmetry | UNVERIFIED | queries 2–8 chars versus median 938; two-character `다만` nevertheless succeeds 6/10 | No controlled length comparison |

No single cause is selected.

## 7. Lexical-path necessity

```text
LEXICAL_PATH_REQUIRED_FOR_IDENTIFIER_LOOKUP: OBSERVED_TRUE
```

Evidence: the exact identifier exists in two chunks, while unchanged vector top-10 retrieves neither. This is a necessity finding for reliable exact identifier lookup, not authorization or design of a lexical path.

## 8. Verdicts

```text
LABEL_CORRECTION_APPLIED: YES
CHUNK_UNIT: FIXED_LENGTH
CHUNK_RESPECTS_CLAUSE_BOUNDARY: OBSERVED_FALSE
decision_source: HUMAN_REVIEW
boundary_decision_scope: 20 of 1,896 sampled chunks
population_boundary_rate: UNVERIFIED
CLAUSE_IDENTIFIERS_PER_CHUNK: sample median 4.5

GROUND_TRUTH_PRESENT_241_17_3: 2 chunks (OBSERVED)
GROUND_TRUTH_PRESENT_접지:      221 chunks (OBSERVED)
GROUND_TRUTH_PRESENT_다만:      377 chunks (OBSERVED)

VECTOR_RETRIEVAL_MISSES_EXACT_MATCH: OBSERVED
CAUSE_STATUS: (a) UNVERIFIED / (b) SUPPORTED /
              (c) SUPPORTED / (d) UNVERIFIED
LEXICAL_PATH_REQUIRED_FOR_IDENTIFIER_LOOKUP: OBSERVED_TRUE
NEXT_STEP_ELIGIBLE:
  CHUNKING_REVIEW       — justified by (b) SUPPORTED
  LEXICAL_PATH_DESIGN   — justified by (c) SUPPORTED
SUGGESTED_ORDER: CHUNKING_REVIEW first
```

Rationale for the suggested order:

- Chunk granularity is a precondition for isolating (a); comparing embedding models before chunking is settled would not yield a single-variable comparison.
- `TABLE_SPLIT_ACROSS_CHUNKS` sits at the same layer.
- Identifier lookup (c) is a narrower need than topic retrieval, which the review use case depends on more.

`NEXT_STEP_ELIGIBLE` names what the evidence justifies investigating. It does **not** authorize starting either. `SUGGESTED_ORDER` is a recommendation, not a decision.

## 9. Evidence limits and stop

**UNVERIFIED:** population-wide boundary behavior and table-split frequency; table-split impact on requirement lookup; comparative model performance; length-asymmetry causality; below-random performance over a representative query set.

**NOT_ATTEMPTED:** model comparison, re-chunking, query rewriting/retry, reranking, lexical/FTS5/hybrid implementation or design, empirical review run, production changes, commit, push.

The boundary sample covers 20 of 1,896 chunks. Three queries and 30 top-10 hits do not establish general retrieval performance.

Production files modified: **NONE**. Existing drawing database modified: **NO**. The provisional DB has an **OBSERVED header-mutation event** and was rebaselined without restoration; after the new baseline, only the diagnostic copy changed. STOP.
