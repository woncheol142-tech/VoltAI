# RETRIEVAL_BASELINE_V1 — Source-Only Anchor Candidates

Status: **CANDIDATES_ONLY_PENDING_HUMAN_APPROVAL**. This is source-only anchor discovery, not a retrieval evaluation and not a frozen baseline.

## Corpus and extraction

- Source: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`
- SHA-256: `56f306db5947ca4c567786e873f6de63c9a3ba7b21f175baecb4ae94da2b0f38`
- Source status: `SOURCE_PROVISIONAL`
- Pages: 1207 total; 1206 with text; 1 empty
- Characters: 1,379,576 (JavaScript string.length (UTF-16 code units))
- NUL count: 0
- Extraction: `packages/mcp-kec/src/knowledge/pdfPages.ts::readPdfPages`; pdfjs-dist 6.1.200; v25.6.1; 2026-08-24
- Working text artifact: `research/empirical-readiness/.baseline-working/retrieval-baseline-v1-text.json` (gitignored)
- Index accessed: **NONE**
- Retrieval/search functions called: **NONE**; only plain-string scans over the extracted PDF text were used.

## Candidate summary

| ID | Frozen query | Primary | Page | Acceptable | Reject | Review status |
|---:|---|---|---:|---:|---:|---|
| 1 | 241.17.3 | 241.17.3 | 339 | 0 | 1 | — |
| 2 | 접지선 굵기는 어떤 기준으로 정하나 | 142.3.1 | 59 | 1 | 1 | APPROVED |
| 3 | 전기자동차 충전설비의 이격거리 기준 | NOT_FOUND_IN_SOURCE | — | 0 | 2 | — |
| 4 | 저압 옥내배선의 공사 방법과 허용 조건 | 232.2 | 245 | 2 | 1 | — |
| 5 | 케이블트레이에 서로 다른 회로를 같이 포설할 수 있는 조건 | 232.41.1 | 273 | 1 | 1 | — |
| 6 | 변압기 2차측 과전류보호장치 설치 기준 | 212.4.2 | 209 | 2 | 1 | — |
| 7 | 피뢰설비 접지와 전기설비 접지를 공용할 수 있는 조건 | 142.6 | 66 | 1 | 1 | — |
| 8 | 다만 지중에 시설하는 경우 적용되는 예외 조건 | NONE | — | 12 | 0 | — |
| 9 | 저압 절연전선의 최소 굵기 | 231.3.1 | 240 | 0 | 1 | — |
| 10 | 접지극 | 142.2 | 57 | 1 | 1 | — |
| 11 | 특고압 가공전선로의 상시 상정하중 | 333.13 | 430 | 1 | 1 | APPROVED |
| 12 | 태양광 발전설비와 풍력 발전설비의 시설 기준 차이 | NOT_FOUND_IN_SOURCE | — | 2 | 1 | — |
| 13 | 누전차단기와 누전경보기의 설치 조건 | 211.2.4 | 192 | 1 | 1 | — |
| 14 | KEC에 규정된 태양광 패널 제조사별 인증 기준 | NOT_FOUND_IN_SOURCE | — | 0 | 3 | — |

## Correction history

Round 1, recorded 2026-08-24. Decision source for all entries: `HUMAN_REVIEW`.

1. Q6 primary reassignment
   - Before: primary `341.2`; acceptable `212.4.2`, `212.5.2`.
   - After: primary `212.4.2`; acceptable `212.5.2`, `341.2`.
   - Reason: `341.2` is scoped to extra-high-voltage distribution transformers; the frozen query is not.
2. Q13 primary reassignment
   - Before: primary `242.10.3`; acceptable `211.2.4`.
   - After: primary `211.2.4`; acceptable `242.10.3`.
   - Reason: `242.10.3` is a special-location medical provision; the frozen query asks for general installation conditions.
3. Q8 multi-match reclassification
   - Before: expected type unspecified; primary `241.14.3`; acceptable none; reject none.
   - After: `MULTI_MATCH_EXPECTED`; primary `NONE`; acceptable `142.2`, `232.3.7`, `241.5`, `241.9.1`, `241.13`, `241.14.3`, `241.16.4`, `331.11`, `334.1`, `334.4`, `334.6`, `334.7`; reject none.
   - Reason: the exhaustive source-only context scan found 12 distinct matching clauses.
4. Q3 revision qualification
   - Before: `NOT_FOUND_IN_SOURCE`; expected type, corpus revision, and revisit condition unspecified.
   - After: `NOT_FOUND_IN_SOURCE`; `NOT_IN_THIS_REVISION_CANDIDATE`; corpus `2024-749`; later-revision clearance provision `UNVERIFIED`; re-measure after any corpus revision change.
   - Reason: the negative result is qualified to this corpus; no other revision was checked.
5. Q2 and Q11 approval as recorded
   - Before: Q2 and Q11 review status `PENDING_HUMAN_REVIEW`.
   - After: Q2 `APPROVED` with primary `142.3.1`; Q11 `APPROVED` with primary `333.13`, while `333.14` remains `APPROVED_AS_REJECT_CANDIDATE`.
   - Candidate values changed: `false`.

Pending human-review items after Round 1: **NONE**.

## Per-query candidates

### 1. 241.17.3

Intent type: `IDENTIFIER`
Search terms: `241.17.3`

- PRIMARY_CANDIDATE: `241.17.3` 전기자동차의 충전장치 시설 — PDF page 339
  - anchor_text: “241.17.3 전기자동차의 충전장치 시설 1. 전기자동차의 충전장치는 다음에 따라 시설하여야 한다. 가. ”
  - anchor_normalized: “241.17.3 전기자동차의 충전장치 시설 1. 전기자동차의 충전장치는 다음에 따라 시설하여야 한다. 가.”
  - match_basis: `EXACT_STRING`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 339; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `부칙(제2023-839호) 제1조` 시행일 — PDF page 1206
  - anchor_text: “241.17.3부터 241.17.5까지의 개정 규정은 2024년 1월 1일부터 시행한다. 3. 351.6의 ”
  - anchor_normalized: “241.17.3부터 241.17.5까지의 개정 규정은 2024년 1월 1일부터 시행한다. 3. 351.6의”
  - match_basis: `EXACT_STRING`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 1206; readPdfPages extracted text; anchor_text exact
  - notes: The identifier appears only as an effective-date reference, not as the clause body.
- Notes: The clause body and an appendix reference were separated.

### 2. 접지선 굵기는 어떤 기준으로 정하나

Intent type: `TOPIC`
Review status: `APPROVED` (`HUMAN_REVIEW`)
Approval basis: the clause text itself is the entry point for conductor sizing and cross-references `142.3.2`.
Search terms: `접지선`, `굵기`, `접지도체`, `보호도체`, `단면적`, `접지도체의 최소 단면적`, `보호도체의 최소 단면적`

- PRIMARY_CANDIDATE: `142.3.1` 접지도체 — PDF page 59
  - anchor_text: “142.3.1 접지도체 1. 접지도체의 선정 가. 접지도체의 단면적은 142.3.2의 1에 의하며 큰 고장전”
  - anchor_normalized: “142.3.1 접지도체 1. 접지도체의 선정 가. 접지도체의 단면적은 142.3.2의 1에 의하며 큰 고장전”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 59; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `142.3.2` 보호도체 — PDF page 60
  - anchor_text: “142.3.2 보호도체 1. 보호도체의 최소 단면적은 다음에 의한다. 가. 보호도체의 최소 단면적은 “나”에”
  - anchor_normalized: “142.3.2 보호도체 1. 보호도체의 최소 단면적은 다음에 의한다. 가. 보호도체의 최소 단면적은 “나”에”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 60; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `362.3` 조가선 시설기준 — PDF page 513
  - anchor_text: “접지선 서비스 접속기 등을 이용하여 접지할 것 (2) 접지는 전력용 접지와 별도의 독립접지 시공을 원칙으로 ”
  - anchor_normalized: “접지선 서비스 접속기 등을 이용하여 접지할 것 (2) 접지는 전력용 접지와 별도의 독립접지 시공을 원칙으로”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 513; readPdfPages extracted text; anchor_text exact
  - notes: This is a telecommunications messenger-wire grounding provision, not the general grounding-conductor sizing rule.
- Notes: The source distinguishes grounding conductors from protective conductors.

### 3. 전기자동차 충전설비의 이격거리 기준

Intent type: `TOPIC`
Expected type: `NOT_IN_THIS_REVISION_CANDIDATE` (`HUMAN_REVIEW`)
Corpus revision: `2024-749`
Revision qualification: EV charging provisions (`241.17.3` / `241.17.5`) were amended by 기후에너지환경부 공고 제2025-227호, which is not present in this corpus. Whether a clearance provision exists in a later revision is `UNVERIFIED` and was not checked; other revisions are out of scope.
Revisit: re-measure after any corpus revision change.
Search terms: `전기자동차`, `충전설비`, `충전장치`, `이격거리`, `이격`, `거리`, `간격`

- PRIMARY_CANDIDATE: `NOT_FOUND_IN_SOURCE` (`OBSERVED`)
  - observation: 이격거리 has zero hits, and no extracted page contains an electric-vehicle/charging term together with 이격, 거리, or 간격.
  - scope: all 1,207 extracted PDF pages; near-miss pages 339, 341
  - evidence: `research/empirical-readiness/.baseline-working/retrieval-baseline-v1-text.json`; /pages (complete source-only plain-string scan); near-miss candidates in this query record
- REJECT_CANDIDATE: `241.17.3` 전기자동차의 충전장치 시설 — PDF page 339
  - anchor_text: “전기자동차의 충전장치는 부착된 충전 케이블을 거치할 수 있는 거치대 또는 수 납공간(옥내 0.45 m 이상,”
  - anchor_normalized: “전기자동차의 충전장치는 부착된 충전 케이블을 거치할 수 있는 거치대 또는 수 납공간(옥내 0.45 m 이상,”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 339; readPdfPages extracted text; anchor_text exact
  - notes: The numeric values concern holder/storage and cable outlet heights, not a separation distance.
- REJECT_CANDIDATE: `241.17.5` 충전장치 등의 방호장치 시설 — PDF page 341
  - anchor_text: “241.17.5 충전장치 등의 방호장치 시설 1. 충전장치 등의 방호장치는 다음에 따라 시설하여야 한다. 가”
  - anchor_normalized: “241.17.5 충전장치 등의 방호장치 시설 1. 충전장치 등의 방호장치는 다음에 따라 시설하여야 한다. 가”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 341; readPdfPages extracted text; anchor_text exact
  - notes: The clause requires protective measures but states no separation-distance criterion.
- Notes: No direct source answer was forced from installation-height or physical-protection provisions.

### 4. 저압 옥내배선의 공사 방법과 허용 조건

Intent type: `TOPIC`
Search terms: `저압 옥내배선`, `옥내배선`, `공사방법`, `공사 방법`, `배선설비`

- PRIMARY_CANDIDATE: `232.2` 배선설비 공사의 종류 — PDF page 245
  - anchor_text: “232.2 배선설비 공사의 종류 1. 사용하는 전선 또는 케이블의 종류에 따른 배선설비의 설치방법(버스바트렁”
  - anchor_normalized: “232.2 배선설비 공사의 종류 1. 사용하는 전선 또는 케이블의 종류에 따른 배선설비의 설치방법(버스바트렁”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 245; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `232.3` 배선설비 적용 시 고려사항 — PDF page 247
  - anchor_text: “232.3 배선설비 적용 시 고려사항 232.3.1 회로 구성 1. 하나의 회로도체는 다른 다심케이블, 다른”
  - anchor_normalized: “232.3 배선설비 적용 시 고려사항 232.3.1 회로 구성 1. 하나의 회로도체는 다른 다심케이블, 다른”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 247; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `231.3.1` 저압 옥내배선의 사용전선 — PDF page 240
  - anchor_text: “231.3.1 저압 옥내배선의 사용전선 1. 저압 옥내배선의 전선은 단면적 2.5 ㎟ 이상의 연동선 또는 이”
  - anchor_normalized: “231.3.1 저압 옥내배선의 사용전선 1. 저압 옥내배선의 전선은 단면적 2.5 ㎟ 이상의 연동선 또는 이”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 240; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `234.9.4` 옥외등의 인하선 — PDF page 294
  - anchor_text: “234.9.4 옥외등의 인하선 옥외등 또는 그의 점멸기에 이르는 인하선은 사람의 접촉과 전선피복의 손상을 방”
  - anchor_normalized: “234.9.4 옥외등의 인하선 옥외등 또는 그의 점멸기에 이르는 인하선은 사람의 접촉과 전선피복의 손상을 방”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 294; readPdfPages extracted text; anchor_text exact
  - notes: This lists methods for a specific outdoor-lighting drop wire, not general low-voltage indoor wiring.
- Notes: Method selection, application conditions, and permitted wire types are split across adjacent clauses.

### 5. 케이블트레이에 서로 다른 회로를 같이 포설할 수 있는 조건

Intent type: `TOPIC`
Search terms: `케이블트레이`, `케이블 트레이`, `서로 다른 회로`, `같이 포설`, `동일 케이블 트레이`, `복수회로`

- PRIMARY_CANDIDATE: `232.41.1` 시설 조건 — PDF page 273
  - anchor_text: “저압 케이블과 고압 또는 특고압 케이블은 동일 케이블 트레이 안에 포설하여서는 아니   된다.   다만,  ”
  - anchor_normalized: “저압 케이블과 고압 또는 특고압 케이블은 동일 케이블 트레이 안에 포설하여서는 아니 된다. 다만,”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 273; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `232.3.7` 배선설비와 다른 공급설비와의 접근 — PDF page 251
  - anchor_text: “232.3.7 배선설비와 다른 공급설비와의 접근 1. 다른 전기 공급설비의 접근 KS C IEC 60449(”
  - anchor_normalized: “232.3.7 배선설비와 다른 공급설비와의 접근 1. 다른 전기 공급설비의 접근 KS C IEC 60449(”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 251; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `232.41.2` 케이블트레이의 선정 — PDF page 275
  - anchor_text: “232.41.2 케이블트레이의 선정 1. 수용된 모든 전선을 지지할 수 있는 적합한 강도의 것이어야 한다. ”
  - anchor_normalized: “232.41.2 케이블트레이의 선정 1. 수용된 모든 전선을 지지할 수 있는 적합한 강도의 것이어야 한다.”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 275; readPdfPages extracted text; anchor_text exact
  - notes: This concerns tray strength and construction, not conditions for sharing a tray between circuits.
- Notes: The direct voltage-class rule and the broader supply-system separation rule are both retained.

### 6. 변압기 2차측 과전류보호장치 설치 기준

Intent type: `TOPIC`
Decision source: `HUMAN_REVIEW`
Search terms: `변압기`, `2차측`, `과전류보호장치`, `과전류 보호장치`, `과전류차단기`, `설치 위치`

- PRIMARY_CANDIDATE: `212.4.2` 과부하 보호장치의 설치 위치 — PDF page 209
  - anchor_text: “212.4.2 과부하 보호장치의 설치 위치 1. 설치위치 과부하 보호장치는 전로 중 도체의 단면적, 특성, ”
  - anchor_normalized: “212.4.2 과부하 보호장치의 설치 위치 1. 설치위치 과부하 보호장치는 전로 중 도체의 단면적, 특성,”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 209; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `212.5.2` 단락보호장치의 설치위치 — PDF page 211
  - anchor_text: “212.5.2 단락보호장치의 설치위치 1.   단락전류   보호장치는 분기점(O)에 설치해야 한다.   다만”
  - anchor_normalized: “212.5.2 단락보호장치의 설치위치 1. 단락전류 보호장치는 분기점(O)에 설치해야 한다. 다만”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 211; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `341.2` 특고압 배전용 변압기의 시설 — PDF page 483
  - anchor_text: “변압기의 2차측 전로에는 과전류차단기 및 2차측 전로로부터 1차측 전로에 전 류가 흐를 때에 자동적으로 2차”
  - anchor_normalized: “변압기의 2차측 전로에는 과전류차단기 및 2차측 전로로부터 1차측 전로에 전 류가 흐를 때에 자동적으로 2차”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 483; readPdfPages extracted text; anchor_text exact
  - notes: This direct secondary-side provision is scoped to the stated special-high-voltage distribution-transformer condition.
- REJECT_CANDIDATE: `234.14.5` 개폐기 및 과전류차단기 — PDF page 303
  - anchor_text: “234.14.5 개폐기 및 과전류차단기 수중조명등의   절연변압기의 2차측 전로에는 개폐기 및 과전류차단기를”
  - anchor_normalized: “234.14.5 개폐기 및 과전류차단기 수중조명등의 절연변압기의 2차측 전로에는 개폐기 및 과전류차단기를”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 303; readPdfPages extracted text; anchor_text exact
  - notes: This is limited to a swimming-pool underwater-light transformer.
- Notes: Human review selected the general overcurrent-device placement clause as primary and retained the special-high-voltage distribution-transformer provision as acceptable.

### 7. 피뢰설비 접지와 전기설비 접지를 공용할 수 있는 조건

Intent type: `TOPIC`
Search terms: `피뢰설비`, `피뢰시스템`, `접지를 공용`, `공용`, `통합접지`, `등전위본딩`

- PRIMARY_CANDIDATE: `142.6` 공통접지 및 통합접지 — PDF page 66
  - anchor_text: “피뢰설비·전자통신설비   등의   접지극을   공용하는 통합접지시스템으로 하는 경우 다음과 같이 하여야 한다”
  - anchor_normalized: “피뢰설비·전자통신설비 등의 접지극을 공용하는 통합접지시스템으로 하는 경우 다음과 같이 하여야 한다”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 66; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `153.2.2` 금속제 설비의 등전위본딩 — PDF page 76
  - anchor_text: “153.2.2 금속제 설비의 등전위본딩 1.   건축물·구조물과   분리된   외부피뢰시스템의   경우,  ”
  - anchor_normalized: “153.2.2 금속제 설비의 등전위본딩 1. 건축물·구조물과 분리된 외부피뢰시스템의 경우,”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 76; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `341.14` 피뢰기의 접지 — PDF page 490
  - anchor_text: “341.14 피뢰기의 접지 고압 및 특고압의 전로에 시설하는 피뢰기 접지저항 값은 10 Ω 이하로 하여야 한”
  - anchor_normalized: “341.14 피뢰기의 접지 고압 및 특고압의 전로에 시설하는 피뢰기 접지저항 값은 10 Ω 이하로 하여야 한”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 490; readPdfPages extracted text; anchor_text exact
  - notes: This concerns surge-arrester grounding resistance, not sharing a building lightning-protection grounding system.
- Notes: The primary candidate explicitly addresses an integrated grounding system.

### 8. 다만 지중에 시설하는 경우 적용되는 예외 조건

Intent type: `EXCEPTION`
Expected type: `MULTI_MATCH_EXPECTED` (`HUMAN_REVIEW`)
Primary candidate: `NONE` — pattern query; no single clause is the answer.
Exact search expressions: `String.includes("다만")`; `String.includes("지중")`; same-page co-occurrence over all 1,207 pages; whitespace-normalized nearest-position review; adjacent-page tail/head 700-character boundary review.
Exhaustive result: `OBSERVED`; 12 distinct clause contexts. Evidence: `research/empirical-readiness/.baseline-working/retrieval-baseline-v1-text.json`; `/pages`, with page and exact-anchor locators below.

- ACCEPTABLE_CANDIDATE: `142.2` 접지극의 시설 및 접지저항 — PDF page 58
  - anchor_text: “지중에 매설되어 있고 대지와의 전기저항 값이 3 Ω 이하의 값을 유지하고 있는 금속제 수도관로가 다”
  - anchor_normalized: “지중에 매설되어 있고 대지와의 전기저항 값이 3 Ω 이하의 값을 유지하고 있는 금속제 수도관로가 다”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 58; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `232.3.7` 배선설비와 다른 공급설비와의 접근 — PDF page 252
  - anchor_text: “다. 지중 전선이 지중 약전류전선 등과 접근하거나 교차하는 경우에 상호 간의 간격이 저압 지중 전선”
  - anchor_normalized: “다. 지중 전선이 지중 약전류전선 등과 접근하거나 교차하는 경우에 상호 간의 간격이 저압 지중 전선”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 252; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `241.5` 전기온상 등 — PDF page 315
  - anchor_text: “다만,   대지전압이 150 V 이하의 발열선을 지중에   시설하는   경우로서   발열선을   시”
  - anchor_normalized: “다만, 대지전압이 150 V 이하의 발열선을 지중에 시설하는 경우로서 발열선을 시”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 315; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `241.9.1` 전기집진 응용장치 및 전원공급 설비의 시설 — PDF page 319
  - anchor_text: “(2) 옥외에서   지중에 시설하는 것은 334.1 및 334.4,   지상에   시설하는 것은 3”
  - anchor_normalized: “(2) 옥외에서 지중에 시설하는 것은 334.1 및 334.4, 지상에 시설하는 것은 3”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 319; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `241.13` 비행장 등화(燈火)배선 — PDF page 329
  - anchor_text: “지중 의 저압 또는 고압의 배선은 334(334.3은 제외한다)의 지중전선로 규정에 따라 시설 하여”
  - anchor_normalized: “지중 의 저압 또는 고압의 배선은 334(334.3은 제외한다)의 지중전선로 규정에 따라 시설 하여”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 329; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `241.14.3` 소세력 회로의 배선 — PDF page 332
  - anchor_text: “소세력 회로의 전선을 지중에 시설하는 경우는 다음에 의하여 시설하여야 한다. 가. 전선은 450/750 V ”
  - anchor_normalized: “소세력 회로의 전선을 지중에 시설하는 경우는 다음에 의하여 시설하여야 한다. 가. 전선은 450/750 V”
  - match_basis: `EXACT_STRING`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 332; readPdfPages extracted text; anchor_text exact
  - notes: Superseded Round 0 primary retained unchanged as one member of the multi-match set.
- ACCEPTABLE_CANDIDATE: `241.16.4` 2차측 배선 — PDF page 337
  - anchor_text: “전기부식방지   회로의 전선중 지중에 시설하는 부분은   334.1의 1과 2 및   334.2의 ”
  - anchor_normalized: “전기부식방지 회로의 전선중 지중에 시설하는 부분은 334.1의 1과 2 및 334.2의”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 337; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `331.11` 지지선의 시설 — PDF page 398
  - anchor_text: “다. 지중부분 및 지표상 0.3 m 까지의 부분에는 내식성이 있는 것 또는 아연도금을 한 철봉을 사”
  - anchor_normalized: “다. 지중부분 및 지표상 0.3 m 까지의 부분에는 내식성이 있는 것 또는 아연도금을 한 철봉을 사”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 398; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `334.1` 지중전선로의 시설 — PDF page 466
  - anchor_text: “지중 전선로를 관로식 또는 암거식에 의하여 시설하는 경우에는 다음에 따라야 한다. 가. 관로식에 의”
  - anchor_normalized: “지중 전선로를 관로식 또는 암거식에 의하여 시설하는 경우에는 다음에 따라야 한다. 가. 관로식에 의”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 466; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `334.4` 지중전선의 피복금속체의 접지 — PDF page 471
  - anchor_text: “지중전선의 피복으로 사용하는 금속체에는 140의 규정에 준하여 접지공사를 하여야 한다. 다만, 이에”
  - anchor_normalized: “지중전선의 피복으로 사용하는 금속체에는 140의 규정에 준하여 접지공사를 하여야 한다. 다만, 이에”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 471; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `334.6` 지중전선과 지중약전류전선 등 또는 관과의 접근 또는 교차 — PDF page 471
  - anchor_text: “지중전선이   지중약전류   전선   등과   접근하거나   교차하는   경우에   상호   간의 ”
  - anchor_normalized: “지중전선이 지중약전류 전선 등과 접근하거나 교차하는 경우에 상호 간의”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 471; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `334.7` 지중전선 상호 간의 접근 또는 교차 — PDF page 472
  - anchor_text: “지중전선이 다른 지중전선과 접근하거나 교차하는 경우에 지중함 내 이외의 곳에서 상호 간의 간격이 저”
  - anchor_normalized: “지중전선이 다른 지중전선과 접근하거나 교차하는 경우에 지중함 내 이외의 곳에서 상호 간의 간격이 저”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 472; readPdfPages extracted text; anchor_text exact
- Notes: Human review classified this contextual pattern query as multi-match; no single clause is the answer.

### 9. 저압 절연전선의 최소 굵기

Intent type: `TOPIC`
Search terms: `저압 절연전선`, `절연전선`, `최소 굵기`, `저압 옥내배선`, `단면적`

- PRIMARY_CANDIDATE: `231.3.1` 저압 옥내배선의 사용전선 — PDF page 240
  - anchor_text: “저압 옥내배선의 전선은 단면적 2.5 ㎟ 이상의 연동선 또는 이와 동등 이상의 강도 및 굵기의 것. 2. 옥”
  - anchor_normalized: “저압 옥내배선의 전선은 단면적 2.5 ㎟ 이상의 연동선 또는 이와 동등 이상의 강도 및 굵기의 것. 2. 옥”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 240; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `142.3.1` 접지도체 — PDF page 59
  - anchor_text: “접지도체의 최소 단면적은 다음과 같다. (1) 구리는 6 ㎟ 이상 (2) 철제는 50 ㎟ 이상 나. 접지도체”
  - anchor_normalized: “접지도체의 최소 단면적은 다음과 같다. (1) 구리는 6 ㎟ 이상 (2) 철제는 50 ㎟ 이상 나. 접지도체”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 59; readPdfPages extracted text; anchor_text exact
  - notes: This minimum applies to a grounding conductor, not a general low-voltage insulated indoor wire.
- Notes: The direct rule is phrased as low-voltage indoor wiring rather than the query's exact wording.

### 10. 접지극

Intent type: `TERM`
Search terms: `접지극`, `접지시스템`, `접지저항`, `매설`

- PRIMARY_CANDIDATE: `142.2` 접지극의 시설 및 접지저항 — PDF page 57
  - anchor_text: “142.2 접지극의 시설 및 접지저항 1. 접지극은 다음에 따라 시설하여야 한다. 가.   토양   또는  ”
  - anchor_normalized: “142.2 접지극의 시설 및 접지저항 1. 접지극은 다음에 따라 시설하여야 한다. 가. 토양 또는”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 57; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `142.1.1` 접지시스템 구성요소 — PDF page 57
  - anchor_text: “142.1.1 접지시스템 구성요소 1. 접지시스템은 접지극, 접지도체, 보호도체 및 기타 설비로 구성하고, ”
  - anchor_normalized: “142.1.1 접지시스템 구성요소 1. 접지시스템은 접지극, 접지도체, 보호도체 및 기타 설비로 구성하고,”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 57; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `241.17.4` 전기자동차의 충전 케이블 및 부속품 시설 — PDF page 340
  - anchor_text: “접지극은 투입 시 제일 먼저 접속되고, 차단 시 제일 나중에 분리되는 구조일 것. (3) 의도하지 않은 부하”
  - anchor_normalized: “접지극은 투입 시 제일 먼저 접속되고, 차단 시 제일 나중에 분리되는 구조일 것. (3) 의도하지 않은 부하”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 340; readPdfPages extracted text; anchor_text exact
  - notes: Here 접지극 is the grounding contact of a connector, not an earth electrode.
- Notes: A same-word connector-contact false positive is retained explicitly.

### 11. 특고압 가공전선로의 상시 상정하중

Intent type: `TOPIC`
Review status: `APPROVED` (`HUMAN_REVIEW`)
Approval basis: `333.13` applies to 철주·철근콘크리트주·철탑, while `333.14` applies to 철탑 only. They have different scope and requirements; `333.14` remains an approved `REJECT_CANDIDATE` because adjacent pages and near-identical headings make it a boundary-preservation test case.
Search terms: `특고압 가공전선로`, `상시 상정하중`, `상정하중`, `333.13`

- PRIMARY_CANDIDATE: `333.13` 상시 상정하중 — PDF page 430
  - anchor_text: “333.13 상시 상정하중 1. 철주·철근 콘크리트주 또는 철탑의 강도계산에 사용하는 상시 상정하중은 풍압이”
  - anchor_normalized: “333.13 상시 상정하중 1. 철주·철근 콘크리트주 또는 철탑의 강도계산에 사용하는 상시 상정하중은 풍압이”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 430; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `333.12` 특고압 가공전선로의 철주 ž 철근 콘크리트주 또는 철탑의 강도 — PDF page 429
  - anchor_text: “333.12 특고압 가공전선로의 철주 ž 철근 콘크리트주 또는 철탑의 강도 1. 특고압 가공전선로의 지지물로”
  - anchor_normalized: “333.12 특고압 가공전선로의 철주 ž 철근 콘크리트주 또는 철탑의 강도 1. 특고압 가공전선로의 지지물로”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 429; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `333.14` 이상 시 상정하중 — PDF page 431
  - anchor_text: “333.14 이상 시 상정하중 1. 철탑의 강도계산에 사용하는 이상 시 상정하중은 풍압이 전선로에 직각방향으”
  - anchor_normalized: “333.14 이상 시 상정하중 1. 철탑의 강도계산에 사용하는 이상 시 상정하중은 풍압이 전선로에 직각방향으”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 431; readPdfPages extracted text; anchor_text exact
  - notes: This is the abnormal-condition load, not the normal assumed load requested.
- Notes: The normal-load definition and its structural application are both retained.

### 12. 태양광 발전설비와 풍력 발전설비의 시설 기준 차이

Intent type: `COMPARISON`
Search terms: `태양광 발전설비`, `풍력 발전설비`, `태양광발전`, `풍력발전`, `태양광`, `풍력`, `시설기준`, `차이`

- PRIMARY_CANDIDATE: `NOT_FOUND_IN_SOURCE` (`OBSERVED`)
  - observation: No single clause directly compares the two facility standards; separate solar and wind sections are present.
  - scope: all 1,207 extracted PDF pages; near-miss pages 559, 562
  - evidence: `research/empirical-readiness/.baseline-working/retrieval-baseline-v1-text.json`; /pages (complete source-only plain-string scan); near-miss candidates in this query record
- ACCEPTABLE_CANDIDATE: `522.2` 태양광설비의 시설기준 — PDF page 559
  - anchor_text: “522.2 태양광설비의 시설기준 522.2.1 태양전지 모듈의 시설 태양광설비에 시설하는 태양전지 모듈(이하”
  - anchor_normalized: “522.2 태양광설비의 시설기준 522.2.1 태양전지 모듈의 시설 태양광설비에 시설하는 태양전지 모듈(이하”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 559; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `532.2` 풍력설비의 시설기준 — PDF page 562
  - anchor_text: “532.2 풍력설비의 시설기준 532.2.1 풍력터빈의 구조 기술기준 제169조에 의한 풍력터빈의 구조에 적”
  - anchor_normalized: “532.2 풍력설비의 시설기준 532.2.1 풍력터빈의 구조 기술기준 제169조에 의한 풍력터빈의 구조에 적”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 562; readPdfPages extracted text; anchor_text exact
- REJECT_CANDIDATE: `502` 용어의 정의 — PDF page 547
  - anchor_text: “MPPT”란   태양광발전이나   풍력발전   등이   현재   조건에서   가능한   최대의   전력을 생”
  - anchor_normalized: “MPPT”란 태양광발전이나 풍력발전 등이 현재 조건에서 가능한 최대의 전력을 생”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 547; readPdfPages extracted text; anchor_text exact
  - notes: This shared MPPT definition does not compare installation standards.
- Notes: A comparison would require human synthesis of two separate sections; no direct primary was forced.

### 13. 누전차단기와 누전경보기의 설치 조건

Intent type: `TOPIC`
Decision source: `HUMAN_REVIEW`
Search terms: `누전차단기`, `누전경보기`, `지락차단장치`, `경보기`, `의료장소`

- PRIMARY_CANDIDATE: `211.2.4` 누전차단기의 시설 — PDF page 192
  - anchor_text: “211.2.4 누전차단기의 시설 1. 전원의 자동차단에 의한 저압전로의 보호대책으로 누전차단기를 시설해야할 ”
  - anchor_normalized: “211.2.4 누전차단기의 시설 1. 전원의 자동차단에 의한 저압전로의 보호대책으로 누전차단기를 시설해야할”
  - match_basis: `HEADING_MATCH`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 192; readPdfPages extracted text; anchor_text exact
- ACCEPTABLE_CANDIDATE: `242.10.3` 의료장소의 안전을 위한 보호 설비 — PDF page 362
  - anchor_text: “의료장소의 전로에는 정격 감도전류 30 mA 이하, 동작시간 0.03초 이내의 누전차 단기를 설치할 것. 다”
  - anchor_normalized: “의료장소의 전로에는 정격 감도전류 30 mA 이하, 동작시간 0.03초 이내의 누전차 단기를 설치할 것. 다”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 362; readPdfPages extracted text; anchor_text exact
  - supporting evidence, PDF page 363: “TT   계통   또는   TN   계통에서   전원자동차단에   의한   보호가   의료행위에   중대한 ”
    - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 363; readPdfPages extracted text; anchor_text exact
  - notes: Special-location application; the continuation on PDF page 363 states the 누전경보기 exception for specified medical circuits.
- REJECT_CANDIDATE: `243.1.4` 저압 직류지락차단장치 — PDF page 365
  - anchor_text: “243.1.4 저압 직류지락차단장치 211.2.4에 의하여 저압 직류전로에 지락이 생겼을 때 자동으로 전로를”
  - anchor_normalized: “243.1.4 저압 직류지락차단장치 211.2.4에 의하여 저압 직류전로에 지락이 생겼을 때 자동으로 전로를”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 365; readPdfPages extracted text; anchor_text exact
  - notes: This concerns a low-voltage DC ground-fault interrupter and does not state the breaker/alarm substitution condition.
- Notes: Human review selected the general installation clause as primary and retained the medical-location rule as a special-location acceptable candidate.

### 14. KEC에 규정된 태양광 패널 제조사별 인증 기준

Intent type: `NEGATIVE_CANDIDATE`
Search terms: `제조사`, `제작사`, `제조업체`, `인증`, `형식승인`, `KS`, `품질보증`, `태양광`, `모듈`, `패널`

- PRIMARY_CANDIDATE: `NOT_FOUND_IN_SOURCE` (`OBSERVED`)
  - observation: The exhaustive minimum-term and adjacent-compound scan found no clause establishing manufacturer-specific certification requirements for solar panels or modules.
  - scope: all 1,207 extracted PDF pages; near-miss pages 43, 558, 1205
  - evidence: `research/empirical-readiness/.baseline-working/retrieval-baseline-v1-text.json`; /pages (complete source-only plain-string scan); near-miss candidates in this query record
- REJECT_CANDIDATE: `521.2` 설비의 안전 요구사항 — PDF page 558
  - anchor_text: “521.2 설비의 안전 요구사항 1. 태양전지 모듈, 전선, 개폐기 및 기타 기구는 충전부분이 노출되지 않도”
  - anchor_normalized: “521.2 설비의 안전 요구사항 1. 태양전지 모듈, 전선, 개폐기 및 기타 기구는 충전부분이 노출되지 않도”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 558; readPdfPages extracted text; anchor_text exact
  - notes: This is solar-module safety content but does not establish manufacturer-specific certification criteria.
- REJECT_CANDIDATE: `122.2` 코드 — PDF page 43
  - anchor_text: “122.2 코드 1. 코드는   ｢ 전기용품 및 생활용품 안전관리법 ｣ 에 의한 안전인증을 취득한 것을 사용”
  - anchor_normalized: “122.2 코드 1. 코드는 ｢ 전기용품 및 생활용품 안전관리법 ｣ 에 의한 안전인증을 취득한 것을 사용”
  - match_basis: `TERM_PRESENT`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 43; readPdfPages extracted text; anchor_text exact
  - notes: This contains safety-certification vocabulary for electrical cord, not solar panels.
- REJECT_CANDIDATE: `부칙(제2023-364호) 제3조` 재사용 이차전지의 전기용품 안전확인 시험에 관한 특례 — PDF page 1205
  - anchor_text: “재사용 이차전지의 적합성 인증은 「전기 용품 및 생활안전용품 안전관리법」 또는 한국산업표준(이하 “KS”라 ”
  - anchor_normalized: “재사용 이차전지의 적합성 인증은 「전기 용품 및 생활안전용품 안전관리법」 또는 한국산업표준(이하 “KS”라”
  - match_basis: `CONTEXTUAL`; status: `OBSERVED`
  - evidence: `.volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf`; PDF page 1205; readPdfPages extracted text; anchor_text exact
  - notes: This combines certification and manufacturer-set criteria for reused batteries, not solar panels.
- Notes: Negative verification is recorded separately and does not substitute another query.

## Query 14 negative verification

Result: **NO_SUPPORTED_ANSWER (OBSERVED)**.
No candidate clause connects a solar panel/module term to a manufacturer-specific certification requirement. Solar-module safety content, unrelated product certification, and reused-battery manufacturer/certification content are retained as rejects rather than treated as answers.
Scope: all 1,207 extracted PDF pages; case-sensitive plain-string scan.

Every non-zero occurrence is retained below with its PDF page and exact extracted-text excerpt.

### Term: 제조사

Hit count: 16; pages: 11.

1. PDF page 148: “제조사 일련번호 포함) (2) 탐촉자 식별(제조사 일련번호, 주파수, 크기 포함) (3) 사용한 빔 각도 (”
2. PDF page 148: “제조사 일련번호, 주파수, 크기 포함) (3) 사용한 빔 각도 (4) 사용한 접촉매질, 상표명 또는 종류 (”
3. PDF page 172: “제조사가 명시한   정확도에 있어야 하고, 오류가 있으면 재교정하여야 한다. 2. 만약 누설시험 방법 또는 ”
4. PDF page 173: “제조사, 모델, 범위 및 식별번호 차. 온도측정 기기 및 식별번호 카. 방법 또는 기법의 설정을 나타내는 스”
5. PDF page 287: “제조사의   지침과   관련   KS   표준(KS   C   IEC   60598)   및   아래   항”
6. PDF page 550: “제조사가   권장하는   온도 ･ 습도 ･ 수분 ･ 먼지   등의   운영환경을   상시   유지하여야 한다”
7. PDF page 552: “제조사가 정하는 적합성 요구사항 511.2.6 전력변환장치의 시설 1. 전력변환장치는 전기 공급에 지장을 주”
8. PDF page 552: “제조사가 정하는 절연저항 기준치 이하일 경우 관리자 에게 경보하고 자동으로 전로를 차단하는 장치를 시설하여야”
9. PDF page 553: “제조사가 제시한 정격으로 충전할 수 있어야 한다. 나. 충전할 때에는 전기저장장치의 충전상태 또는 이차전지 ”
10. PDF page 553: “제조사가   제시한   정격으로   방전할 수 있어야 한다. 나. 방전할 때에는 전기저장장치의 방전상태 또는”
11. PDF page 553: “제조사가 제시한 기준 이상의 가연성가스 농도 및 내부압력이 발생하는 경우 파열 또는 폭발을 방지하기 위한 급”
12. PDF page 554: “제조사가 정하는 정격 이상의 과충전, 과방전, 과전압, 과전류, 지락전류 및 온도 상 승, 냉각장치 고장, ”
13. PDF page 554: “제조사가 정한 거리를 이격한   경우에는 예외로 할 수 있으며, 컨테이너 및 인클로저의 면적은 42 m 2 ”
14. PDF page 633: “제조사가 정한 최저 허용 수위보다 50 mm 이상이고 75 mm 이하이어야 한다. (2) 여러   튜브 부분”
15. PDF page 652: “제조사 및 로트번호, 관리 또는 히트번호 이어야 한다. 강판의 용접은 다음의 방법 중 하나로 용접하여야 한다”
16. PDF page 1205: “제조사가 정한 기준에 적합한 것을 전기용품 안전확인시험에 합격한 것으 로 본다.”

### Term: 제작사

Hit count: 1; pages: 1.

1. PDF page 1201: “제작사와 협의하여 결정할 수 있다. 720.3.9 정지 및 경보 설비는 715.3.8을 준용한다.”

### Term: 제조업체

Hit count: 0; pages: 0.

No hits.

### Term: 인증

Hit count: 27; pages: 20.

1. PDF page 43: “인증을 취득한 것을 사용하 여야 한다. 2. 코드는 이 규정에서 허용된 경우에 한하여 사용할 수 있다. 12”
2. PDF page 77: “에 사용될 실제 용접변수의 소범위 내에 있다. 제조자 는 절차인정기록서를 정확하게 확인하여 인증하여야 한다.”
3. PDF page 92: “인증시험을 받아야 한다. P-No.21에 서 P-No.26 사이의 어떤 하나의 금속에 대한 자격시험을 통과한”
4. PDF page 98: “인증은 실제로 시험한 자세와 아래보기 자세에 대하여 유효하나 별 도그림 1과 별도그림 2에 명시된 바와 같이”
5. PDF page 98: “인증은   1S   자세를   인정한다.   4S   와   2S   자세의   인정은   모든   자세에 ”
6. PDF page 98: “인증한다. 161.9.5 튜브와 튜브시트 용접사 및 자동용접사 인증 적용되는 규격에서 튜브 와 튜브시트 실증”
7. PDF page 98: “인증 적용되는 규격에서 튜브 와 튜브시트 실증 인증시험이 요구될 때에는 161.6.5의 1.을 적용하여야  ”
8. PDF page 98: “인증시험이 요구될 때에는 161.6.5의 1.을 적용하여야   한다.   만약   특수한 인증시험   요건이”
9. PDF page 98: “인증시험   요건이 적용되는 규격에   규정되지 않았다면”
10. PDF page 126: “인증 요건 2. 절차서 요건/증명, 인정, 합격기준 3. 검사시스템 특성 4. 교정시험편의 보존 및 관리 5”
11. PDF page 160: “인증되어 야 한다. 173.6.8 탈자 부품내의 잔류자장이 후속공정 또는 후속사용을 방해할 우려가 있는 경우”
12. PDF page 166: “준의 요건을 만족하 여야 한다. LED UV-A 광원은 관련 표준의 요건을 만족하는 것으로 인증되어야 한다.”
13. PDF page 170: “인증 요건 나. 기법/교정 표준 다. 검사의 범위 라. 허용 가능한 검사감도 또는 누설율”
14. PDF page 173: “인증 자격등급 및 성명 다. 시험절차서(번호) 및 개정번호 라. 시험방법 또는 기법 마. 시험결과 바. 기기”
15. PDF page 259: “인증 된 경우, 도체 또는 케이블 제조자의 규격에 따라 최대허용온도 한계(범위)를 가질 수 있다. 표 232”
16. PDF page 270: “인증을 받은 등기구로서 다음에 의하여 시설하 는 경우는 예외로 한다. (1) 이웃 연결 설치 등기구는 KS ”
17. PDF page 628: “인증시험을 하여야 한다. 이 견본들의 최 대 블로우다운은 다음 표 605.36에 명시된 값을 초과하지 말아야”
18. PDF page 735: “인증해야한다. 가. 핀장치를 단독 방출장치로 사용하는 압력방출계통의 정격 용량은 아래 1) 또는 2) 요건에”
19. PDF page 736: “인증용량과,   계통유체   및   핀장치   상하단   계통부품의   특성을   고려하여   결정해야 한다”
20. PDF page 868: “인증을 위하여 사용되고 확인되는 용접이음형상과 비파괴검사에 근 거하여 대안적인 기준결함크기를 사용할 수 있다”
21. PDF page 898: “인증 가. 재료 제조자가 인증한 충격시험 보고서는 그 재료가 이 호의 요건을 만족시 킨다는 것을 보증하려면 ”
22. PDF page 898: “인증한 충격시험 보고서는 그 재료가 이 호의 요건을 만족시 킨다는 것을 보증하려면 아래 요건을 충족해야한다.”
23. PDF page 916: “인증 재료로 만들 수 있으며, 압력부품에 직접 용접할 수 있다. (1) 재료가 식별되어 있으며 용접에 적당하”
24. PDF page 916: “인증 재료 로 만들 수 있다. 마. 표 645.15.4-1의 재료 형식 1 및 4의 압력부품부착용접- 압력부”
25. PDF page 1076: “인증시험보고서 또는 재료확인서와 부호화된 표시와 함께 재료의 각 부재를 식별할 수 있어야 한다. 아래 제2호”
26. PDF page 1127: “인증 받을 수 있다. 이 계산식에서 사용된 측정 치는 규정된 부식여유를 반영하여 계산하여야 한다.    ”
27. PDF page 1205: “인증은 「전기 용품 및 생활안전용품 안전관리법」 또는 한국산업표준(이하 “KS”라 한다)이 시행 전까지는 제”

### Term: 형식승인

Hit count: 0; pages: 0.

No hits.

### Term: KS

Hit count: 452; pages: 165.

1. PDF page 42: “KS”라 한다)에 적합하거나 동등 이상의 성능을 만족하는 것을 사용하여 야 한다. 다만, KS가 없는 경우에”
2. PDF page 42: “KS가 없는 경우에는 국제적으로 통용되는 IEC, EN, NEC 등의 표준 을 기준으로 동등 이상의 성능을 ”
3. PDF page 42: “KS   C IEC 60445(인간과 기계   간 인터페이스, 표시 식별의 기본 및 안전원칙－장비단자, 도체”
4. PDF page 42: “KS에 적합하거나 동등 이상의 성능을 만족하는 것을 사용하여야 한다.”
5. PDF page 43: “KS C IEC 60502-1[정격 전압 1 kV~30 kV 압출 성형 절연 전력 케이블 및 그 부속품-제1”
6. PDF page 43: “KS에 적 합하거나 동등 이상의 성능을 만족하는 것을 사용하여야 한다. 다만, 다음의 케이블 을 사용하는 경”
7. PDF page 43: “KS   C   3339(2012)[CATV용(급전겸용)   알 루미늄파이프형 동축케이블]에 적합한 것을 사”
8. PDF page 44: “KS에 적합하거나 동등 이상의 성능을 만족하는 것을 사용하여야 한다. 다 만,   전로의   전선으로   절”
9. PDF page 44: “KS에 적합하거나   동등 이상 의 성능을 만족하는 것을 사용하여야 한다. 123 전선의 접속 전선을 접속하”
10. PDF page 45: “KS C   IEC   60998-1(가정용 및 이와   유사한   용도의   저전압용   접속기구)의   ”
11. PDF page 46: “KS C IEC 60454(전기용 점착 테이프)에 적합한 것을 사용할 것.”
12. PDF page 54: “KS C 1706(2013)[계기용변성기 (표준용 및 일반 계기용)]의 “6.2.3 내전압” 또는 KS C ”
13. PDF page 54: “KS C 1707(2011)[계기용변성기 (전력수급용)]의 “6.2.4 내전압”에 적합할 것. 나. 단서의 ”
14. PDF page 54: “KS C 1706(2013)[계기용변성기 (표준용 및 일반   계기용)]의   “6.2.3 내전압”에   규”
15. PDF page 57: “KS C IEC 60364-5-54(저압전기설비-제5-54부:전기기기의 선정 및 설치 －접지설비 및 보호도체”
16. PDF page 57: “KS   C   IEC 60364-5-54(저압전기설비-제5-54부:전기기기의 선정 및 설치－접지설비 및 보”
17. PDF page 61: “KS C IEC 60364-5-54(저압전기설비-제5-54부:전기기기의 선정 및   설치－접지설비 및   보”
18. PDF page 61: “KS   C   IEC 60364-4-43(저압전기설비-제4-43부:안전을   위한   보호－과전류에   대”
19. PDF page 61: “KS C IEC 60364-5-54(저압전기설비-제5-54부:전기기기의 선정 및 설치－접지설비 및 보호도 체”
20. PDF page 61: “KS C IEC 60364-5-52(저압전기설비-제 5-52부:전기기기의 선정 및 설치－배선설비) 참조]. ”
21. PDF page 61: “KS   C   IEC   60364-5-54(저압전기설비-제5-54부:전기기기의   선정   및   설 치”
22. PDF page 63: “KS   C   IEC 60439-2(저전압 개폐장치 및 제어장치 부속품－제2부：버스바 트렁킹 시스템의 개 ”
23. PDF page 63: “KS C IEC 61534-1(전원 트랙－제1부: 일반요구사항) 에 의한 것은 제외한다. 4. 겸용도체는 다”
24. PDF page 66: “KS C IEC 61936-1(교류 1 kV 초과 전력설비－제1 부:공통규정)의 “10 접지시스템”에 의한다”
25. PDF page 70: “KS C   IEC 62305-1(피뢰시스템-제1부:일반원 칙)의   “8.2   피뢰레벨”,   KS   ”
26. PDF page 70: “KS   C   IEC   62305-2(피뢰시스템-제2부:리스크관리),   KS C   IEC 62305-”
27. PDF page 70: “KS C   IEC 62305-3(피뢰시스템-제3부:구조물의   물리적   손상   및   인명위험)의   ”
28. PDF page 70: “KS   C   IEC 62305-3(피뢰시스템-제3부:구조물의 물리적 손상 및   인명위험)의“표 6(수뢰”
29. PDF page 70: “KS C IEC 62305-3(피뢰시스템-제3부:구조물의 물리적 손상 및 인명위험)의   “5.2.5   자”
30. PDF page 70: “피뢰시스템의   보호각,   회전구체   반경,   그물망   크기의   최대값은   KS   C   IEC”
31. PDF page 71: “KS   C IEC 62305-3(피뢰시스템-제3부:구조물의 물리적 손 상 및 인명위험)의“표 6(수뢰도체,”
32. PDF page 72: “KS   C   IEC   62305-3(피뢰시스템-제3부:구조물의   물리적   손상   및   인명위험)”
33. PDF page 72: “KS C IEC 62305-3(피뢰시스템-제3부:구 조물의 물리적 손상 및 인명위험)의 “4.3 철근콘크리트”
34. PDF page 73: “KS C IEC 62305-3(피뢰시스템－제3부:구조물의 물리적 손 상 및 인명위험)의“표 7(접지극의 재료”
35. PDF page 73: “KS   C   IEC 62305-3(피뢰시스템-제3부:구조물의 물리적 손상 및 인명위험)의 “5.4.2.1”
36. PDF page 73: “KS C IEC 62305-3(피뢰시스템- 제3부:구조물의 물리적 손상 및 인명위험)의“그림 3(LPS 등급”
37. PDF page 73: “KS C IEC 62305-3(피뢰시스템-제3부:구조물의 물 리적 손상 및 인명위험)의“표 6(수뢰도체, 피”
38. PDF page 73: “KS   C   IEC   62305-3(구조물의   물리적   손상   및   인명위험)   표 5(피뢰시”
39. PDF page 74: “KS   C   IEC 62305-4(피뢰시스템-제4부:구조물 내부의 전기전자 시스템)의“4.3 피뢰구역(L”
40. PDF page 74: “KS   C   IEC   62305-3(피뢰시스템-제3부:구조물의   물리적   손상   및   인명위험)”
41. PDF page 75: “KS C IEC 61643-12(저전압 서지 보호 장치-제12부:저전압 배 전 계통에 접속한 서지보호 장치-”
42. PDF page 75: “KS C IEC 60364-5-53(건 축 전기 설비-제5-53부:전기 기기의 선정 및 시공－절연, 개폐 및”
43. PDF page 75: “KS C IEC 61643-11(저압 서지보호장치-제11부:저압전력 계통의 저압 서지보호장치 -요구사항 및 ”
44. PDF page 75: “KS C IEC 61643-22(저전압 서지보 호장치-제22부:통신망과 신호망 접속용 서지보호장치－선정 및 ”
45. PDF page 76: “KS C IEC 62305-3(피뢰시스템-제3부:구 조물의 물리적 손상 및 인명위험)의 “5.6 재료 및 치”
46. PDF page 76: “KS   C IEC 62305-3(피뢰시스템-제3부:구조물의 물리적 손상 및 인명위험)의“6.2 피뢰등전위본”
47. PDF page 197: “KS C IEC 60439-1(저전압 개폐 장치 및 제어 장 치 부속품 – 제1부:형식 시험 및 부분 형식 ”
48. PDF page 198: “KS C IEC 61084(전기설비용 케이블 트렁킹 및 덕트 시 스템) 시리즈] 또는 비금속 전선관[KS C”
49. PDF page 198: “KS C IEC 60614(전선관) 시리즈 또는 KS C IEC 61386(전기설비용 전선관 시스템) 시리즈”
50. PDF page 198: “KS C IEC 61386(전기설비용 전선관 시스템) 시리즈] 다. 배선계통은   기호나   기호에 의해 식”
51. PDF page 199: “KS   C   IEC   60449(건축전기설비의   전압밴드)에   의한 전압밴드 I의 상한 값인 교류 ”
52. PDF page 200: “KS C IEC 61558-2-6(전력용 변압기, 전원 공급 장치 및 유사 기기의 안전 – 제2부:범용 절연”
53. PDF page 203: “KS C IEC 60364-6(검증)에 규정된 조건으로 매 측정 점에서의 절연성 바닥과 벽 의 저항 값은  ”
54. PDF page 206: “KS   C 또는   KS   C IEC 관련 표준(배선차단기,   누전차단기,   퓨즈 등의 표준)의 동작”
55. PDF page 206: “KS   C IEC 관련 표준(배선차단기,   누전차단기,   퓨즈 등의 표준)의 동작특성에 적합하여야 한다”
56. PDF page 214: “KS C IEC 60724(정격전압 1 kV 및 3 kV 전기케이블의 단락 온도 한계)에 근거한다. 4) 계”
57. PDF page 215: “KS”라 한 다)에 적합하여야 하며, 다음에 따라 시설할 것. (1)   과부하   보호장치로   전자접촉기”
58. PDF page 216: “KS C 4204(2013)의 표준정격의 것을 말한다]로써 그 전원측 전로에 시 설하는 과전류 차단기의 정격”
59. PDF page 220: “KS C IEC 62606에 적합한 장치를 각각 시설할 수 있다. 214.2.2 전기기기에 의한 화상 방지 ”
60. PDF page 233: “KS C IEC 60364-5-54에 따라 시설하여야 한다. 3. 전로에 지락이 생겼을 때에는 자동으로 전선”
61. PDF page 237: “외부 영향 1. 전기설비의 외부 영향과 특성의 요구사항은 KS C IEC 60364-5-51(전기기기의 선정”
62. PDF page 238: “KS C IEC 60073(인간-컴퓨터 간 인터페이스, 표시와 확인 을 위한 기본과 안전 지침 - 표시기와 ”
63. PDF page 238: “KS C IEC 60447 [인간과 기계간 인터페이스(MMI), 표시, 식별의 기본 및 안전 원칙   –  ”
64. PDF page 239: “KS C IEC 60364-6(검증)에서 요구하는 검증에 취약한 모든 회로나 장비 나. 사용되는 기호는 IE”
65. PDF page 239: “KS M ISO 9772(발포 플라스틱－소형 화염에 의한 수평 연소성의 측정)에 따른 재료성능 등급 HF-1”
66. PDF page 239: “KS   C   IEC 60364-5-51(전기기기의   선정   및   시공－공통규칙)의“표   51A”의”
67. PDF page 239: “KS   C   IEC 61140(감전보호－설비   및   기기의   공통사항)의“7.5.2   보호도체전류”
68. PDF page 240: “KS C IEC 60364-7-715(특수설비 또는 특 수장소에 관한 요구사항-특별 저전압 조명설비) 참조한”
69. PDF page 240: “KS C IEC 60364-5-52(저압전기설비-제5-52부：전기기기의 선정 및 설치-배선설 비)의“부속서 ”
70. PDF page 246: “KS C IEC 60364-5-52(전기기기 의 선정 및 시공－배선설비)“부속서 A(설치방법)”에 따른 설치”
71. PDF page 247: “KS C IEC 60998(가정용 및 이와 유사한 용도의 저전압용 접속기구) 시리즈에 따른 접 속기 및 KS”
72. PDF page 247: “KS C IEC 60947-7-1(저전압 개폐장치 및 제어장치)에 따른 단자블록에 관 한 것을 제외하고 절연”
73. PDF page 249: “KS C IEC 60228(절연케이블용 도체)의 5등급과 6등급의 요구사 항에 적합하여야 한다. 9. 전선관”
74. PDF page 249: “KS   C   IEC   60332-1-2(화재 조건에서의 전기/광섬유케이블 시험)에   적합한 케이블 및”
75. PDF page 250: “KS C IEC 60332-1-2(화재 조건에서의 전기/광섬유케이블 시험)의 화염 확산을 저 지하는 요구사항”
76. PDF page 250: “KS C IEC 60439-2(저전압 개폐장치 및 제어장치 부속품), KS C IEC 61537-A(케이 블”
77. PDF page 250: “KS C IEC 61537-A(케이 블 관리 - 케이블 트레이 시스템 및 케이블 래더 시스템), KS C I”
78. PDF page 250: “KS C IEC 61084(전기설 비용 케이블 트렁킹 및 덕트시스템) 시리즈 및 KS C IEC 61386(”
79. PDF page 250: “KS C IEC 61386(전기설비용 전선 관 시스템) 시리즈 표준에서 자기소화성으로 분류되는 제품은 특별한”
80. PDF page 250: “KS C IEC 60439-2(저전압 개폐장치 및 제어장치 부속품), KS C IEC 60570(등기구 전원”
81. PDF page 250: “KS C IEC 60570(등기구 전원 공급용 트랙 시스템), KS C IEC 61537-A(케이블 관리 -”
82. PDF page 250: “KS C IEC 61537-A(케이블 관리 - 케이블 트레이 시스 템 및 케이블 래더 시스템), KS C I”
83. PDF page 250: “KS C IEC 61084(전기설비용 케이블 트렁킹 및 덕트시 스템) 시리즈 및 KS C IEC 61386(”
84. PDF page 250: “KS C IEC 61386(전기설비용 전선관 시스템) 시리즈 및 KS C IEC 61534(파워트랙시스템) ”
85. PDF page 250: “KS C IEC 61534(파워트랙시스템) 시리즈 표준에서 자기소화성으로 분류되지 않은 케이블 이 외의 배선”
86. PDF page 250: “KS   C   IEC   60529(외곽의   방진   보호   및   방수   보호   등 급)의 시험에”
87. PDF page 250: “KS C IEC 60529(외함의 밀폐 보호등급 구분(IP코 드))의 시험에 합격한 경우 라. 배선설비는 그”
88. PDF page 251: “KS C IEC 60449(건축전기설비의 전압 밴드)에 의한 전압밴드Ⅰ과 전압밴드Ⅱ 회로는 다음의 경우를 제”
89. PDF page 259: “KS C IEC 60364-5-52(저압전기설비-제5-52부: 전 기기기의 선정 및 설치－배선설비)의“부속서”
90. PDF page 259: “KS C IEC 60502(정격전압 1 kV ~ 30 kV 압출 성형 절연 전력케이블 및 그 부속품) 및 I”
91. PDF page 259: “KS C IEC 60439-2(저전압 개폐장치 및 제어장치 부속품 – 제2부:부스바 트렁킹 시스템의 개별 요”
92. PDF page 259: “KS C IEC 61534-1(전원 트랙 – 제1부：일반 요구사 항) 등에 따라 제조자가 허용전류 범위를 제”
93. PDF page 259: “KS C IEC 60364-5-52(저압전기설비-제5-52 부:전기기기의   선정   및   설치-배선설비)”
94. PDF page 260: “KS   C   IEC   60364-5-52(저압전기설비-제5-52부：전기기기의 선정   및   설치-배선”
95. PDF page 260: “KS   C   IEC 60364-5-52(저압전기설비-제5-52부：전기기기의   선정   및   설치-배선”
96. PDF page 260: “KS C IEC 60287(전기 케이블-전류 정격 계산) 시리즈에서 규정한 방법, 시험 또는 방법이 정해진 ”
97. PDF page 260: “KS   C IEC   60364-5-52(저압전기설비-제5-52부：전기기기의 선정 및 설치-배선설비) 의“”
98. PDF page 260: “  열의   영향   및   고차   고조파   전류에   대응하는   감소계수를   KS   C   IEC”
99. PDF page 261: “KS C 8431(경질 폴리염화비닐 전선관)의“7 성능” 및 “8 구조”또는 KS C 8454[합성 수지제 ”
100. PDF page 261: “KS C 8454[합성 수지제 휨(가요) 전선관]의 “4 일반 요 구사항”, “7 성능”, “8 구조” 및 ”
101. PDF page 261: “KS C 8455(파상형 경 질 폴리에틸렌 전선관)의 “7 재료 및 제조방법”, “8 치수”, “10 성능””
102. PDF page 261: “KS C 8436(합성수지제 박스 및 커버)의 “5 성능”, “6 겉모양 및 모양”, “7 치수” 및 “8 ”
103. PDF page 262: “KS C IEC 61386-21-A(전기설비용 전선관 시스템-제21부：경질 전 선관 시스템의 개별 요구사항)”
104. PDF page 263: “KS F ISO 1182(건축재료의 불연성 시험 방법)에 따른 불연 성능이 있는 것의 내부, 전용의 불연성 ”
105. PDF page 263: “KS C 8401(강제전선관)의“4 굽힘성”, “5 내식성”, “7 치수, 무게 및 유효 나사부의 길이와 바”
106. PDF page 263: “KS C IEC 60614-2-1-A(전선관-제2-1부：금속제 전선관의 개별규정)의 “7 치 수”, “8 구”
107. PDF page 263: “KS C 8458(금속제 박스 및 커버)의“4 성능”, “5 구조”, “6 모양 및 치수” 및 “7 재료” ”
108. PDF page 263: “KS C 8460(금속제 전선관용 부속품)의“7 성능”, “8 구조”, “9 모양 및 치 수”, 및 “10 ”
109. PDF page 265: “KS C 8422(금속제 가요전선관)의“7. 성능” 표 1의 “내식성, 인 장, 굽힘”, “8.1 가요관의 ”
110. PDF page 265: “KS   C   8422(금속제   가요전선관)의   “7.   성능”   표   1의   “내식성, 인장,”
111. PDF page 265: “KS   C   8459(금속제   가요전선관용   부속품)의   “7.   성능”,   “8.   구 조””
112. PDF page 265: “KS C IEC 60079-1(폭발성 분위기-제1 부：내압 방폭구조“d”) “5. 방폭접합”의 “5.1 일반”
113. PDF page 265: “KS C IEC   60079-1(폭발성   분위기 – 제1부：내압   방폭구조“d”)   “5.2.2   ”
114. PDF page 265: “KS C IEC 60079-1(폭발성 분위기 – 제1부：내압 방폭 구조“d”)의 “5.3 나사 접합”의 “표”
115. PDF page 265: “KS   C   IEC   60079-1(폭발성   분위기 – 제1부：내압   방폭구조“d”)의 “15.1.”
116. PDF page 267: “KS C 8436(합성수지제 박스 및 커버)의“5 성능”, “6 겉모양 및 모양”, “7 치수” 및 “8 재”
117. PDF page 267: “KS C 8436(합성수지제 박스 및 커버)에 적합한 것일 것. 다만, 부속품 중 콘크리트 안에 시설하는 금”
118. PDF page 270: “KS C 8465)로 사용할 수 없다. 다만,   ｢ 전기용품 및 생활용품 안전관리법 ｣ 에 의한 안전인증을”
119. PDF page 270: “KS C IEC 60598-1(등기구 – 제1부：일반 요구사항 및 시험)의“12 내구성 시험과 열 시험”에 ”
120. PDF page 270: “KS C 8465(레이스웨이)에 규정된 “6.3 정하중”에 적합한 것일 것. (3)   이웃   연결   설”
121. PDF page 270: “KS C IEC 61084-1(전기설비용 케이블 트렁킹 및 덕 트   시스템 – 제1부：일반   요구사항)의”
122. PDF page 271: “KS C 8457(플로어 덕트용의 부속품)에 적합한 것이 어야 한다. 232.32.3 플로어덕트 및 부속품의”
123. PDF page 272: “KS D 3602(강제갑판) 중 SDP 3에 적합한 것은 그러하지 아니하다. 4. 셀룰러덕트의 판 두께는 표”
124. PDF page 272: “KS D 3602(강제 갑판) 중 SDP2, SDP3 또는 SDP2G에 적합한 것은 1.2 ㎜] 200 ㎜ ”
125. PDF page 273: “KS C IEC 60364-5-52(전기기기의 선정 및 설치-배선설비) 표 B.52.17 또는 B.52.20”
126. PDF page 274: “KS C IEC 60364-5-52(전기기기의 선정 및 설치-배선설비) 표 B.52.17 또는 B.52.21”
127. PDF page 274: “KS C IEC 60364-5-52(전기기기의 선정 및 설치 – 배선설비) 표 B.52.17 또는 B.52.”
128. PDF page 275: “KS C IEC 60364-5-52(전기기기의 선정 및 설치-배선설비) 표 B.52.17 또는 B.52.21”
129. PDF page 275: “KS   C   8464(케이블   트레이),   KS   C   IEC 61537-A(케이블   관리   ”
130. PDF page 275: “KS   C   IEC 61537-A(케이블   관리   -   케이블   트레이   시스템   및   케이”
131. PDF page 277: “KS C IEC 60502(정격전압 1 kV ~ 30 kV 압출 성형 절연 전력케이블 및 그 부 속품)   ”
132. PDF page 277: “KS C IEC 60502(정격전압 1 kV ~ 30 kV 압출 성형 절연 전력케이블 및 그 부 속품)시리즈”
133. PDF page 279: “KS C IEC 60439-2(버스바 트렁킹 시스템의 개별 요구사항)의 구조에 적합할 것. 5. 완성품은 K”
134. PDF page 279: “KS C IEC 60439-2(버스바 트렁킹 시스템의 개별 요구사항)의 시험방법에 의하여 시험하였을 때에 “”
135. PDF page 279: “KS   C IEC 60570(등기구전원공급 용트랙시스템)에 적합할 것.”
136. PDF page 282: “KS C 8449(2007)(트롤리버스관로)의 “6 구조”에 적합한 것일 것. (5) 완성품은 KS C 84”
137. PDF page 282: “KS C 8449(2007)(트롤리버스관로)의 “8 시험방법”에 의하여 시험하 였을 때에 “5 성능”에 적합”
138. PDF page 282: “KS C   8449(2002)(트롤리버스관로)의 “6 구조[나충전부와 비충전 금속부 및 이극   나충전부(”
139. PDF page 282: “KS C 8449(2002)(트롤리버스관로)의 “8 시험방법(금속제 관로와 트롤 리의 금속 프레임간의 접촉저”
140. PDF page 283: “KS C 3134(2008)(절연트롤리장치)의 “7 재료”에 적합할 것. (3) 구조는 KS C 3134(2”
141. PDF page 283: “KS C 3134(2008)(절연트롤리장치)의 “6 구조”에 적합할 것. (4) 완성품은 KS C 3134(”
142. PDF page 283: “KS C 3134(2008)(절연트롤리장치)의 “8 시험방법”에 의하여 시험하 였을 때에 “5 성능”에 적합”
143. PDF page 285: “KS C IEC 60092-350(2006)(선박용 전기설비-제350부：선박용 케이 블의 구조 및 시험에 관”
144. PDF page 285: “KS C IEC 60092-350(2006)(선박용 전기설비-제350부：선박용 케이블의 구 조 및 시험에 관”
145. PDF page 285: “KS C 8326 “7 구조, 치수 및 재료”에 의한 것으로 앞면 판은 탈락되지 않는 구조일 것. 라.   ”
146. PDF page 285: “KS   C   8326의   “8.10 캐비닛의 내연성 시험”에 합격한 것을 말한다)이 있도록 시설할 것.”
147. PDF page 286: “KS C 8326 “7.20 재료”와 동등 이상의 것으로서 KS C 8326 “6.8 내연 성”에 적합한 재”
148. PDF page 286: “KS C 8326 “6.8 내연 성”에 적합한 재료를 사용하여야 한다.”
149. PDF page 287: “KS   표준(KS   C   IEC   60598)   및   아래   항목을   고려하여 설치하여야 한다”
150. PDF page 287: “KS   C   IEC   60598)   및   아래   항목을   고려하여 설치하여야 한다. 가. 등기구”
151. PDF page 288: “KS C IEC 60670-1-A(가정용 및 이와 유사한 용도의 고정 전기 설비용 부속품 의 박스와 외함 –”
152. PDF page 288: “KS C IEC 60998-2-3(가정용 및 이와 유사한 용도의 저전압용 접속 기구 – 제2-3 부：절연 관”
153. PDF page 288: “KS   C   IEC   60598(등기구)에   따른   등기구   및   발광다이오드(이하   “LED”
154. PDF page 288: “KS C IEC 60598(등기구)에 따른 등기구 및 LED 등기구로서 제조자의 지침 에 명확히 요구되지 않”
155. PDF page 288: “KS C IEC 60245-3(정격 전압 450/750 V 이하 고무 절연 케 이블 – 제3부：내열 실리콘 ”
156. PDF page 288: “KS C IEC 61048(램프 보조장치－형 광 램프 및 방전 램프용 커패시터－일반 및 안전 요구사항)의 요”
157. PDF page 289: “KS C IEC 60598-1) 및 이동전선으로만 사용할 수 있으며, 고정배선으로 사용하여서는 안 된다. 다”
158. PDF page 292: “KS C 8305(배선용 꽂음 접속기)에 적 합한 제품을 사용하고 다음에 의하여 시설하여야 한다. 가. 노출”
159. PDF page 295: “KS C 7658(LED 가로등 및 보 안등기구의 안전 및 성능요구사항)에 적합한 것을 시설할 것. 234.”
160. PDF page 299: “KS C IEC 60684-3-100(플렉시블 절연 슬리빙-제3부：슬리빙의 개별 형태에 대한 사양-제100~”
161. PDF page 302: “KS C IEC 60598-2-18(등기구 제2-18부：수영장용 및 이와 유사한 등기구-개별요구사항)에 적합”
162. PDF page 303: “KS   C   IEC   60245(정격전압   450/750   V   이하   고무   절연케이블)  ”
163. PDF page 305: “ 조명기구 LED를 광원으로 사용하는 교통신호등의 설치는 KS C 7528(LED 교통신호등)에 적합할 것.”
164. PDF page 306: “KS   C   8324(2007)(가로등용   분전함)의“7.10   외부분진에   대한   보호”, “7”
165. PDF page 309: “KS C 7658(LED 가로등 및 보 안등기구)에 적합한 것을 시설할 것. 5. 옥측 또는 옥외에 시설하는”
166. PDF page 310: “KS   C   IEC 60335-2-76(가정용 및 이와 유사한 전기기기의 안전성 – 제2-76부：전기 울”
167. PDF page 310: “KS   C IEC 60335-2-76(가정용   및   이와   유사한   전기기기의   안전성   –  ”
168. PDF page 311: “KS C IEC 60335-2-76(가정용 및 이와 유사한 전기기기의 안전성 – 제2-76부：전기 울타리의 ”
169. PDF page 316: “KS C 3612(엑스선용 고전압 케이블)의“5 재료ㆍ구조 및 가공방법”에 적합한 것일 것. (2) 완성품은”
170. PDF page 316: “KS C 3612(엑스선용 고전압 케이블)의“4 특성”에 적합한 것일 것. 다.   엑스선관 회로의 배선이 ”
171. PDF page 320: “KS C IEC 60245-6(정격전압 450/750 V 이하 고무 절연 케이블-제6부：아크 용접용 케이블)”
172. PDF page 322: “KS D 3507 KS D 3562 KS D 3583 KS D 3576 배관용 탄소 강관 압력 배관용 탄소 ”
173. PDF page 322: “KS D 3562 KS D 3583 KS D 3576 배관용 탄소 강관 압력 배관용 탄소 강관 배관용 아크 ”
174. PDF page 322: “KS D 3583 KS D 3576 배관용 탄소 강관 압력 배관용 탄소 강관 배관용 아크 용접 탄소강 강관 ”
175. PDF page 322: “KS D 3576 배관용 탄소 강관 압력 배관용 탄소 강관 배관용 아크 용접 탄소강 강관 배관용 스테인리스 ”
176. PDF page 322: “KS C IEC 60394-2 KS C 2344 KS C 2347 KS C IEC 60811-1-1 전기용 ”
177. PDF page 322: “KS C 2344 KS C 2347 KS C IEC 60811-1-1 전기용 바니시 처리된 직물류   —  ”
178. PDF page 322: “KS C 2347 KS C IEC 60811-1-1 전기용 바니시 처리된 직물류   —   제2부: 시험방법”
179. PDF page 322: “KS C IEC 60811-1-1 전기용 바니시 처리된 직물류   —   제2부: 시험방법 전기용 폴리에스테”
180. PDF page 322: “KS M 3337 (열 경화성 수지 적층판) 유리섬유 천 기재 규소 수지 적층판 유리섬유 천 기재 에폭시 수”
181. PDF page 322: “KS C IEC 60800(정격전압 300/500 V 이하 보온 및 결빙 방지용 발열 케이블)의“8.2.2.”
182. PDF page 323: “KS D 3507(배관용 탄소강관)에 적합한 것일 것. (2) 소구경관에 부속하는 박스는 강판으로 견고하게 ”
183. PDF page 323: “KS C IEC 60800(정격전압 300/500 V 이하 보온 및 결 빙 방지용 발열 케이블)의 ‘4 기계”
184. PDF page 325: “KS   C   IEC   60800(정격전압   300/500   V   이하   보 온 및 결빙 방지용 ”
185. PDF page 325: “KS C IEC 60800(정격전압 300/500 V 이하 보온 및 결빙 방지용 발열 케이블)의“7 케이 블”
186. PDF page 325: “KS C IEC 60079-30-1(방폭 전기기계 기구-제30-1부: 전기저항 트레이스 히터-일반 및 시험 ”
187. PDF page 325: “KS C IEC 60228(절연 케이블용 도체)에 적합한 연동선 또는 이 를   소선으로   한   연선(절”
188. PDF page 325: “KS C IEC 60800(정격전압 300/500 V 이하 보온 및 결빙 방지용 발열 케 이블)의“8.2.2”
189. PDF page 327: “KS C IEC 60800에서 정한 시험 방법에 적합한 것일 것. 다. 발열선을 콘크리트 속에 매입하여 시설”
190. PDF page 327: “KS D 3507(배관용 탄소강관)에 규정하는“배관용 탄소강관”에 적 합한 것일 것. (2) 소구경관은 그 ”
191. PDF page 328: “KS C IEC 60228(절연 케이블용 도체) 또는 적합한 연동선 또는 이를 소선으로 한   연선(절연체에”
192. PDF page 328: “KS   C   IEC   60811-1-1(전기케이블의   절연체 및 시스 재료의 공통시험방법 – 제1부：”
193. PDF page 328: “KS   C   IEC   60811-1-1(전기케이블 의 절연체 및 시스 재료의 공통시험방법 – 제1부：시”
194. PDF page 329: “KS M ISO 1874-2[플라스틱-폴리아미드(PA) 성형 및 압출 재료-제2부：시험편 제작 및 물성 측정”
195. PDF page 329: “KS C 3006(에 나멜 동선 및 에나멜 알루미늄선 시험방법)의“10 내마모”시험방법에 의하 여 추의 질량”
196. PDF page 333: “KS   C   IEC 60811-1-1(전기케이블의 절연체 및 시스 재료의 공통시험방법 – 제1부：시험방법”
197. PDF page 333: “KS C IEC 60228(절연 케이블용 도체)에 적합한 연동선 또는 이것을 소선 으로   한   연선(절연”
198. PDF page 334: “KS C IEC 60811-1-1 (전기케이블의   절연체   및   시스   재료의   공통시험방법 – 제”
199. PDF page 334: “KS C IEC 60811-1-1(전기케이블의 절연체 및 시스 재료의 공통시험방법 – 제1부：시험방법 총칙 ”
200. PDF page 337: “KS C 8431(경질 폴리 염화 비닐전선관)에 적합한 합성수지관이나 이와 동등 이상의 절연성능 및 강도를 ”
201. PDF page 339: “KS   C   8311(커버 나이프 스위치)의“3.1 온도상승”,   “3.5 단락차 단”, “3.6 내열”
202. PDF page 339: “KS R IEC 61851-1(전기자동 차 전도성 충전 시스템 – 제1부: 일반 요구사항)에 따라 방진 ･ ”
203. PDF page 340: “KS R IEC 61851-1(전기자동차 전도 성   충전   시스템-제1부:   일반   요구사항)의   ”
204. PDF page 340: “KS   R   IEC   61851-1,   KS   R   IEC 61851-21-1, KS R IEC ”
205. PDF page 340: “KS   R   IEC 61851-21-1, KS R IEC 61851-21-2 및 KS R IEC 6185”
206. PDF page 340: “KS R IEC 61851-21-2 및 KS R IEC 61851-23 표준을 참조한다. 241.17.4 전”
207. PDF page 340: “KS R IEC 61851-23 표준을 참조한다. 241.17.4 전기자동차의 충전 케이블 및 부속품 시설 ”
208. PDF page 340: “KS R IEC 61851-1(전기자동차 전도성 충전 시스템 – 제1부 : 일반 요구사항) 12.4.2에 적”
209. PDF page 341: “KS R IEC 61980-1[전기자동차 무선전력 전송(WPT)   시스템   —   제1부:   일반 요구”
210. PDF page 341: “KS   S   ISO   3864-1(2011)   “11.   안전   표 시의 배치”에 따른 잠재적 위”
211. PDF page 341: “KS A 3011(조도 기준)의 “표 5 교통” 에 따른 주차장의 기준에 적합한 조명설비를 설치할 것. 2.”
212. PDF page 344: “KS L 2002(강화유리)에 적합한“강화유리”ㆍ KS L 2004(접합유 리)에 적합한“접합유리”나 이들과”
213. PDF page 344: “KS L 2004(접합유 리)에 적합한“접합유리”나 이들과 동등 이상의 강도를 가지는 것일 경우 또는 그 부”
214. PDF page 345: “KS B ISO 4287[제품 의   형상   명세(GPS)－표면조직－프로파일법－용어,   정의   및   ”
215. PDF page 346: “KS L 2002(강화유리)에 적합한“강화유리”ㆍ KS L 2004(접합유리) 에 적합한 “접합유리”나 이와”
216. PDF page 346: “KS L 2004(접합유리) 에 적합한 “접합유리”나 이와 동등 이상의 강도를 가지는 것일 경우 또는 그곳이”
217. PDF page 346: “KS B ISO 4287[제품 의   형상   명세(GPS)－표면조직－프로파일법－용어,   정의   및   ”
218. PDF page 346: “KS   B   ISO   4287[제품의   형상   명세(GPS)－표면조직－프로파일법－용어,   정의  ”
219. PDF page 347: “KS   C   IEC   61241-1-1(분진   방폭   전기기계ㆍ기구   제1-1부：용기   및   ”
220. PDF page 347: “KS   C   IEC   61241-14(분진   방폭   전기기계ㆍ기구   제14 부：선정   및   설”
221. PDF page 348: “KS   C   IEC   60079-1(폭발성   분위기 – 제1부：내 압 방폭구조 “d”)의 기기의 구조”
222. PDF page 348: “KS   C   IEC   60079-2(폭발성   분위기 – 제2부：압력   방폭 구조 “p”)의 전기기기”
223. PDF page 348: “KS   C   IEC   60079-6(방폭기기 – 제6부：유입   방 폭구조)의 폭발성가스·증기·입자 등”
224. PDF page 348: “KS   C   IEC   60079-7(폭발성   분위기 – 제7부：안전증”
225. PDF page 349: “KS   C   IEC   60079-14(방폭   기기 – 제14부：폭발   위험   장소에서의   전기 ”
226. PDF page 350: “KS C IEC 60227-1(정격전 압   450/750   V   이하   염화비닐   절연   케이블 ”
227. PDF page 350: “KS   C   IEC 60245-1(정격전압   450/750   V   이하   고무   절연케이블 – ”
228. PDF page 351: “KS C IEC 60332-1 시리즈(화재 조건에서 전기/광섬유 케이블 시험 – 제1부:단심 절 연 전선 또”
229. PDF page 351: “KS C IEC 60332-3 시리즈(화재조건 에서의   전기케이블   난연성   시험 – 제3부:   수직”
230. PDF page 351: “KS C IEC 61034 시리즈(케이블 연소시 발생하는 연 기밀도 측정)에 따른 저발연 케이블 나. KS ”
231. PDF page 351: “KS C IEC 60614 시리즈(전선관) 또는 KS C IEC 61084 시리즈(전기설비용 케이블 트렁킹 ”
232. PDF page 351: “KS C IEC 61084 시리즈(전기설비용 케이블 트렁킹 및 덕트시스템)에 따른 화재방호 및 IP4X 이상”
233. PDF page 351: “KS C IEC 표준에 따르는 접속기를 사용 또는 IP4X 또는 IPXXD 이상의 보호등급을 갖춘 폐쇄함 내”
234. PDF page 353: “KS C IEC 60364-5-54(전기기기의 선정 및 시공 －접지설비 및 보호도체)의“542.1 일반 요구”
235. PDF page 353: “KS   C   IEC   60364-5-54(전기기기의   선정 및   시공－접지설비 및 보호도체)의“54”
236. PDF page 356: “KS C IEC 60529(외곽의 방진 보호 및 방수 보호 등급)를 따 르는 IPX4 이상의 보호등급 나. ”
237. PDF page 356: “KS C IEC 60529(외곽의 방진 보호 및 방수 보호 등급)를 따르는 IP4X 이상의 보호등급 다. 충”
238. PDF page 356: “KS C IEC 62262(외부 기계적 충격에 대한 전기기기용 외곽의 보 호 등급)를 따르는 IK07 이상의”
239. PDF page 357: “KS C IEC 60309-2(산업용 플러그, 콘센트 및 커플러-제2부：핀 및 핀받이의 치수 요구사항)에 적”
240. PDF page 358: “KS C IEC 61558-2-4(전력용변압기, 전원공급장치 및 유사기기의 안전-제2 부：범용   절연변압기”
241. PDF page 359: “KS C IEC 60364-5-52(전기기기의 선정 및 설치－배선설비)의“표 A.52.3”의 35번 과   ”
242. PDF page 359: “KS C IEC 60364-5-52(전기기기의 선정 및 설치－배선설비)의“표 A.52.3”의 4번 과 6번의”
243. PDF page 360: “KS C IEC 60309-2(산업용 플러그,   콘센트 및 커플러-제2부: 핀 및 핀받이의 치수 요구사항)”
244. PDF page 360: “KS C IEC 60309-1(산업용 플러그, 콘센트 및 커플러 제1 부: 일반요구사항)에 적합하여야 한다.”
245. PDF page 361: “KS C IEC 61558-2-15(전력용 변압기, 리액터, 전원공급장치 및 이와 유사한 기기의 안전 제2-”
246. PDF page 362: “KS C IEC 60364-7-710(특수설비 또는 특수장소에 대한 요구사항－의료장소) 에 따라   절연감시”
247. PDF page 362: “KS   C IEC 61557-8(교류 1000   V 및 직류 1500 V 이하의 저압 배전 계통의 전기 ”
248. PDF page 362: “KS C IEC 61557-9(교류 1000 V 및 직류 1500 V 이하 저 압 배전 계통의 전기 안전－보”
249. PDF page 362: “KS C 8305(배선용 꽂음 접속기)에 따른 배선용 콘센트를 사용할 것. 다만, 플러그가 빠지지 않는 구조”
250. PDF page 363: “KS C IEC 60364-7-710(특수설비 또는 특수장소에 대한 요구사항-의료장소)에 따라 비상전원을 공”
251. PDF page 364: “KS C IEC 60227-6(비닐 리프트 케이블) 또는 KS C IEC 60245-5(2005)(고무 리 ”
252. PDF page 364: “KS C IEC 60245-5(2005)(고무 리 프트 케이블)를 사용하여야 한다.”
253. PDF page 365: “KS C lEC 60364-4-41(안전을   위한   보호-감전에   대한   보호)의“410.3.1”에 ”
254. PDF page 365: “KS   C   9610-3-2[전자파적합성 (EMC) - 제3-2부: 허용기준 - 고조파 전류의 허용기준(”
255. PDF page 365: “KS C 9610-3-12[전자파적합성(EMC)   —   제3-12부: 허용기준   —   공공 저압 배 ”
256. PDF page 366: “KS C IEC 60364-5-53(전기기기의 선정 및 시공－절연, 개폐 및 제어)의“534 과전압 보호장치”
257. PDF page 368: “KS   C   IEC   60702-1(정격   전압   750   V   이하   무기물   절연   케”
258. PDF page 369: “KS   C   IEC   60702-2(정격전압   750   V   이하   무기물   절연케이 블 및 ”
259. PDF page 369: “KS   C   IEC   60331-11(화재   조건에서의   전기   케이블   시험-회로   보전성-”
260. PDF page 369: “KS   C   IEC   60331-21(화재   조건 에서의   전기   케이블   시험-회로보전성-제2”
261. PDF page 369: “KS   C   IEC   60332-1-2(화재   조건에서의   전기/광섬유   케 이블   시험 – 제”
262. PDF page 370: “KS C IEC 62040-1(무정전전원장치-제1부 일반 및 안전요구사항)에 따라 시설하여야 한다. 2.  ”
263. PDF page 377: “KS C IEC 61936-1(교류 1kV 초과 전력설비-제1부: 공통규정)의“10 접지시스 템”에 의한다.”
264. PDF page 378: “KS C IEC 61936-1(교류 1kV 초과 전력설비－공통규정) “그림 12 (허용접촉전압     ”
265. PDF page 387: “KS D 3503(2018)에 규정하는“일반구조용 압연강재” 중 SS275, SS315 또는 SS410 (나”
266. PDF page 387: “KS D 3515(2018)에 규정하는“용접구조용 압연강재” (다) KS D 3529(2018)에 규정하는“”
267. PDF page 387: “KS D 3529(2018)에 규정하는“용접구조용 내후성( 耐候性 ) 열간 압연강재” (라) KS D 375”
268. PDF page 387: “KS D 3752(2019)에 규정하는“기계구조용 탄소강재” 중 SM 55C (마) KS D 3867(201”
269. PDF page 387: “KS D 3867(2015)에 규정하는“크롬 강재” 중 SCr 430 (바) KS D 3867(2015)에 ”
270. PDF page 387: “KS D 3867(2015)에 규정하는“크롬몰리브덴강 강재” 중 SCM 435 (2) 두께는 다음 값 이상의”
271. PDF page 388: “KS D 3515(2018)에 규정하는“용접구조용 압연강재”를 관상으로 용접한 것 (나)   KS   D  ”
272. PDF page 388: “KS   D   3632(2019)에   규정하는“건축구조용   탄소강   강관”중   SNT275, SNT”
273. PDF page 388: “KS D 3777(2018)에 규정하는“철탑용 고장력강 강관” (2) 두께는 다음 값 이상의 것일 것. (가”
274. PDF page 388: “KS D 3557(2007)에 규정하는“리벳 용 원형강”중 SV 400에 관계되는 것으로 한다. 라. 강관주”
275. PDF page 388: “KS   D   3503(2018)에   규정하는“일반구조용   압연강재”중   SS275,   SS315 ”
276. PDF page 388: “KS D 3515(2018)에 규정하는“용접구조용 압연강재”를 관상으로 용접한 것. (다)   KS   D ”
277. PDF page 388: “KS   D   3632(2019)에   규정하는“건축구조용   탄소   강관”중   SNT275,   SN”
278. PDF page 388: “KS   D   3517(2008)에   규정하는“기계구조용   탄소   강관”중   13종·14종·15 종”
279. PDF page 392: “KS D 3503(2018)에 규정하는 “일반구조용 압연강재” 중 SS275 또는 SS315 (2) KS D”
280. PDF page 392: “KS D 3504(2011)에 규정하는 “철근 콘크리트용 봉강” 중 열간 압연봉강 또는 열간 나. 공장제조 ”
281. PDF page 392: “KS F 4304(2015)(프리텐션방식 원심력 PC전 주)의   “4.2   휨강도”,   “6.   재료”
282. PDF page 392: “KS   D 3503(2018)에 규정하는 “일반구조용   압연강재” 중 SS275, SS315 또 는 SS”
283. PDF page 392: “KS D 3515(2018)에 규정하는 “용접구조용 압연강재” (다) KS D 3632(2019)에 규정하는”
284. PDF page 392: “KS D 3632(2019)에 규정하는 “건축구조용 탄소강관”중 SNT275, SNT355 또 는 SNT46”
285. PDF page 392: “KS   D   3517(2018)에   규정하는   “기계구조용   탄소강관”중   13종·14종·15 종”
286. PDF page 393: “KS F 4304(2015)(프리텐션방식 원심력 PC전주)의 “6 재료” 및 “7 제조방법”에 적합한 것일 ”
287. PDF page 393: “KS F 2405에 규정한 콘크리트의 압축강도 시험방법에 의하여 시험을 구한 압축강도의 평균값으로 한다. 표”
288. PDF page 393: “KS F 2405에 규정한 콘크리트의 압축강도 시험방법에 의하여 시험을 하여 구한 압축강도의 평균값으로 한다”
289. PDF page 394: “KS D 3503 SS275   16 이하   161.8   161.8 16 초과 40 이하   156.9 ”
290. PDF page 394: “KS D 3504 열간압연 봉강 SR 240   -   156.9   156.9 SR 300   -   19”
291. PDF page 409: “KS   C   IEC 61235(활선작업－전기용   절연   중공관)에   적합한   방호구이거나   방호”
292. PDF page 410: “KS   C   IEC 61235(활선작업－전기용   절연   중공관)에   적합한   방호구이거나   방호”
293. PDF page 470: “KS D 4040에 적합하여야 하며, 저압지중함의 경우에는 절연성능 이 있는 고무판을 주철(강)재의 뚜껑 아”
294. PDF page 470: “KS B 6750(2012)(압력용기-설계 및 제조 일반)의 “5 재료”에 적합한 것일 것. 사. “마”(1”
295. PDF page 470: “KS B 6750(2012)(압력용기-설계 및 제조 일반)의“6 설계” 또는 “최대 허용 응력 값”에 적합할”
296. PDF page 471: “KS B 6750-1(2012)(고압가 스 및 전기설비용 압력용기)의 “11 동체-튜브식 열교환기” 및 KS”
297. PDF page 471: “KS B 6281(2008) (냉동용 압력 용기의 구조)의 “5.4.9 관의 강도” 또는 341.16의“나””
298. PDF page 471: “KS B 6216(2008)(증기용 및 가스 용 스프링 안전밸브)에 적합할 것 334.4 지중전선의 피복금속”
299. PDF page 472: “KS C 3341 (2020)의 “6” 또는 KS   C   IEC   60332-3-24   (2018)(”
300. PDF page 472: “KS   C   IEC   60332-3-24   (2018)(화재조건에서의   전기   및   광섬유   ”
301. PDF page 472: “KS C 3404(2000)의“부속서 2” (다) 사용전압 154 kV 케이블: KS C 3405(2000)”
302. PDF page 472: “KS C 3405(2000)의“부속서 2” (2) 견고한 난연성의 관에 넣어 시설하는 경우 나. 어느 한쪽의”
303. PDF page 476: “KS   C   IEC   60228(절연   케이블용   도체)에서 정하는   연동선을   소선으로 한 연”
304. PDF page 476: “KS   C IEC 60811-1-1(시험 방법 총칙－두께   및 완성품 바깥지름 측정)의 “9 절연체 및 ”
305. PDF page 477: “KS C IEC 60228(절연 케이블용 도체)에서 정하는 연동선을 소 선으로 한 연선(절연체에 부틸고무 혼”
306. PDF page 477: “KS C IEC 60811-1-1의(시험 방법 총칙   –   두께 및 완성품 바깥지름 측정)의 “9 절연체”
307. PDF page 477: “KS C IEC 60502-2[정격전압 1 kV ~ 30 kV 압출 절연 전력케이블 및 그 부속품－케이블(6”
308. PDF page 487: “KS C IEC 60502-2[정격전압 1 kV ~ 30 kV 압출   절연   전력케이블   및   그  ”
309. PDF page 488: “KS C 4612(2011)(고압전류제한퓨즈)의“7 구조”에 적합한 것일 것. 나.   완성품은   KS  ”
310. PDF page 488: “KS   C   4612(2011)(고압전류제한퓨즈)의“8   시험방법”에   의해서   시험하 였을 때 “”
311. PDF page 491: “KS   B   6750(2012)(압력용기－설계   및   제조   일반)의“5   재료”에   적합한 것”
312. PDF page 491: “KS B 6750(2012)(압력용기－설계 및 제조 일 반)의“6 설계” 또는 “최대 허용 응력 값”에 적합”
313. PDF page 491: “KS   B   6750(2012)(압력용기－설계   및   제조 일반)의“7.1.6 원통형,   원뿔형 및”
314. PDF page 491: “KS B 6750(2012)(압력용기－설계 및 제조 일반)의“6.1.1 일반 사항 (b) 압력 유지 구성품의”
315. PDF page 491: “KS B 6750(2012)(압력용기－설계 및 제조 일반)의 “7.1.7 성 형 경판의 허용오차”에 적합할 ”
316. PDF page 491: “KS B 6750(2012)(압력용기－설계 및 제조 일반)의 “6.3.2 경 판 설계”에 적합할 것. (마)”
317. PDF page 491: “KS B 6750(2012)(압력용기－설계 및 제조 일반)의“6.1.9 스테이”
318. PDF page 492: “KS B 6750(2012)(압력용기－설계 및 제조 일반)의“6.1.21 구멍 및 보 강”에 적합할 것. (”
319. PDF page 492: “KS B 6750(2012)(압력용기－설계 및 제조 일반)의“6.2.5 용접 이음 효율”에 준할 것. (아)”
320. PDF page 492: “KS   B   6750(2012)(압력용기－설계   및   제조 일반)의“6.1.1   일반사항   c)판”
321. PDF page 492: “KS   B 6750(2012)(압력용기－설계 및 제조 일반)의“11 동체-튜브식 열교환기”및 KS B 62”
322. PDF page 492: “KS B 6281(냉동용   압력용기의 구조)의“5.4.9   관의   강도”   또는   “나”(2)(바)”
323. PDF page 492: “KS B 6216“증기용 및 가스용 스프링 안전 밸브”에 적합한 안전밸브를 시설할 것. 다만, 압력 1 ㎫ ”
324. PDF page 493: “KS   B 6216(증기용 및 가스용 스프링 안전밸브)에 적합한 안전밸브를 설치 할 것. 342 고압 ž ”
325. PDF page 513: “KS C 3101)과 접지선 서비스 접속기 등을 이용하여 접지할 것 (2) 접지는 전력용 접지와 별도의 독립”
326. PDF page 552: “KS”라 한다)에 적합 하거나 동등 이상의 성능의 것을 사용하여야 한다. 2. 이차전지의 절연파괴가 일어나지”
327. PDF page 553: “KS”라 한다)에 적합하거나 동등 이상의 성능의 것을 사용하여야 한 다. 3. 이차전지 모듈 또는 랙에 화재”
328. PDF page 557: “KS C IEC 62660-2(전기자 동차용 리튬이차전지 셀-제2부: 신뢰성 및 오용 시험) 또는 동등 이상”
329. PDF page 560: “KS제품 또는 동등이상의 성능의 제품일 것 다. 모듈 지지대와 그 연결부재의 경우 용융아연도금처리 또는 녹방”
330. PDF page 565: “KS   C   IEC   61400-24(풍력발전기－낙뢰보호)에서   정하고   있는   피뢰 구역(Lig”
331. PDF page 568: “KS B 6750 “부표 1”, “부표 2” 및 ASME Sec Ⅱ, Part D Table 1A, 1B에 ”
332. PDF page 572: “KS 재료규격을 사용할 경우에는 별표1 대비 표에 따라 사용할 수 있다. 605.2.2 이 기준에서 규정하는”
333. PDF page 573: “KS 재료를 사용 하는 경우에는 별표 3의 대비표에 따라 사용할 수 있다. [표 605.3] 판재 규격 규격”
334. PDF page 574: “KS 재료를 사용하는 경우에는 별표 1의 대비표에 따라 사용할 수 있다. 1.   원격   수위감지   장치”
335. PDF page 574: “KS 재료를 사용하는 경우에는 별표 1의 대비표에 따라 사용할 수 있 다. 605.4.3   전기저항용접(E”
336. PDF page 610: “KS B 1511 철강제관 플랜지의 기본치수 2. ASME B16.1, Cast Iron Pipe Flang”
337. PDF page 658: “KS   B 6750 부표 1, 부표 2 및 ASME Sec Ⅱ, Part D Table 1A, 1B에서 열”
338. PDF page 658: “KS B 6750 부표 1, 부표 2 및 ASME Sec Ⅱ, Part D Table 1A, 1B에서 확인되”
339. PDF page 658: “KS B 6750 부표 1, 부표 2 및 ASME Sec Ⅱ, Part D Table 1A,   1B에서  ”
340. PDF page 658: “KS B 6750 부표 1, 부표 2 및 ASME Sec Ⅱ, Part D Table 1A, 1B의 재료규격”
341. PDF page 658: “   사용할   수   있다.   단조재료에   대한   재료규격   및   최대허용응력값은   KS   B”
342. PDF page 659: “KS B 6750 부표 1, 부표 2 및 ASME Sec Ⅱ, Part D Table 1A, 1B에 따른다.”
343. PDF page 659: “KS B 6750 부표 1, 부표 2 및 ASME Sec Ⅱ, Part D Table 1A, 1B에서 규정하”
344. PDF page 668: “KS B 6750 부도를 사용한다. [그림 610.10] 외압을 받는 원통형 용기의 설계 변수를 나타내는 개”
345. PDF page 679: “KS B 6750 부표1, 부표2 및   ASME   Sec   Ⅱ,   Part   D   1A,   1B”
346. PDF page 680: “KS   B   6750   부표1,   부표2   및   ASME   Sec   Ⅱ,   Part   D ”
347. PDF page 680: “KS   B 6750 부표1, 부표2   및 ASME Sec Ⅱ, Part D   1A, 1B 해당온도에서 ”
348. PDF page 681: “KS   B   6750   부표1,   부표2   및   ASME   Sec   Ⅱ,   Part   D ”
349. PDF page 681: “KS   B 6750 부표1, 부표2   및 ASME Sec Ⅱ, Part D   1A, 1B에서의 해당온도”
350. PDF page 704: “KS B 6750 부도2 참조, ㎫ 바. 제작 세부사항과 큰 구멍에 대한 검사는 특별한 주의를 하여야 한다.”
351. PDF page 737: “KS 및 ASME Section II의 규격에 열거된 재료이어야 한다. 탄소강 및 저합 금강   밸브   몸”
352. PDF page 758: “KS   B 6750 부표 1 및 ASME B31.1 Appendix A의 표에 열거한 재료, 또는 ASTM”
353. PDF page 768: “KS B 6750 부표 1 및   ASME B 31.1 Appendix A 에 열거한 재료(호환성 ASTM ”
354. PDF page 784: “KS B 0704(기계적 진동- 기계의 불평형변화감도 및 기계진동의 불평형민감도)에 준한 축계 설계로 공진배”
355. PDF page 819: “KS B 6750 부표 1, 부표 2 및 ASME Sec Ⅱ, Part D Table 1A, 1B에서 규정하”
356. PDF page 1176: “KS L 5201    포틀랜드 시멘트  2. 한국산업표준 KS L 5210    "고로 슬래그 시멘트”
357. PDF page 1176: “KS L 5210    "고로 슬래그 시멘트  3. 한국산업표준 KS L 5211    플라이애시 시멘”
358. PDF page 1176: “KS L 5211    플라이애시 시멘트  4. 한국산업표준 KS L 5401    포틀랜드 포졸란 시”
359. PDF page 1176: “KS L 5401    포틀랜드 포졸란 시멘트  5. 한국산업표준 KS L 5204   “백색 포틀랜드 ”
360. PDF page 1176: “ 5401    포틀랜드 포졸란 시멘트  5. 한국산업표준 KS L 5204   “백색 포틀랜드 시멘트””
361. PDF page 1177: “KS F 4009 “레디믹스 콘크리트” 7. 한국산업표준 KS F 2405 “콘크리트 압축강도 시험방법” 8”
362. PDF page 1177: “KS F 2405 “콘크리트 압축강도 시험방법” 8. 한국산업표준 KS F 2402 “콘크리트 슬럼프 시험방”
363. PDF page 1177: “KS F 2402 “콘크리트 슬럼프 시험방법” 705.5 매설계기 기술기준 제135조에 규정하는 댐의 건전성”
364. PDF page 1178: “KS D 3503    일반구조용 압연강재    중 SS275 나.   한국산업표준   KS   D   ”
365. PDF page 1178: “KS   D   3515    "용접구조용   압연강재    중   SM400A,   SM400B, SM”
366. PDF page 1178: “KS   D   3529    "용접구조용   내후성   열간   압연강재    중   1종 (SMA40”
367. PDF page 1178: “KS D 3710    탄소강 단강품    중 SF440A 바. 한국산업표준 KS D 4106    용”
368. PDF page 1178: “KS D 4106    용접구조용 주강품    중 SCW410 및 SCW480 사. 한국산업표준 KS D”
369. PDF page 1178: “KS D 3752    기계구조용 탄소강재    중 SM25C, SM35C 및 SM45C 2.   705”
370. PDF page 1178: “KS D 3503    일반 구조용 압연강재  나. 한국산업표준 KS D 3505    PC 강봉  ”
371. PDF page 1178: “KS D 3505    PC 강봉  다. 한국산업표준 KS D 3507    배관용 탄소강관  라. ”
372. PDF page 1178: “KS D 3507    배관용 탄소강관  라. 한국산업표준 KS D 3514    와이어 로프  마.”
373. PDF page 1178: “KS D 3514    와이어 로프  마. 한국산업표준 KS D 3515    용접 구조용 압연 강재 ”
374. PDF page 1178: “KS D 3515    용접 구조용 압연 강재  바. 한국산업표준 KS D 3529    용접 구조용 ”
375. PDF page 1178: “KS D 3529    용접 구조용 내후성 열간 압연 강재  사. 한국산업표준 KS D 3557    ”
376. PDF page 1178: “    용접 구조용 내후성 열간 압연 강재  사. 한국산업표준 KS D 3557    리벳용 원형강 ”
377. PDF page 1179: “KS D 3560    보일러 및 압력 용기용 탄소강 및 몰리브덴강 강판  자. 한국산업표준 KS D 3”
378. PDF page 1179: “KS D 3561    마봉강  차. 한국산업표준 KS D 3562    압력 배관용 탄소강관  카.”
379. PDF page 1179: “KS D 3562    압력 배관용 탄소강관  카. 한국산업표준 KS D 3564    고압 배관용 탄”
380. PDF page 1179: “KS D 3564    고압 배관용 탄소강관  타. 한국산업표준 KS D 3566    일반 구조용 탄”
381. PDF page 1179: “KS D 3566    일반 구조용 탄소강관  파. 한국산업표준 KS D 3576    배관용 스테인리”
382. PDF page 1179: “KS D 3576    배관용 스테인리스 강관  하. 한국산업표준 KS D 3693    스테인리스 클”
383. PDF page 1179: “KS D 3693    스테인리스 클래드강  갸. 한국산업표준 KS D 3698    냉간 압연 스테인”
384. PDF page 1179: “KS D 3698    냉간 압연 스테인리스강판 및 강대  냐. 한국산업표준 KS D 3705    열”
385. PDF page 1179: “KS D 3705    열간 압연 스테인리스강판 및 강대  댜. 한국산업표준 KS D 3706    스”
386. PDF page 1179: “KS D 3706    스테인리스 강봉  랴. 한국산업표준 KS D 3707    크롬강재  먀. 한”
387. PDF page 1179: “KS D 3707    크롬강재  먀. 한국산업표준 KS D 3708    니켈크롬강 강재  뱌. 한”
388. PDF page 1179: “KS D 3708    니켈크롬강 강재  뱌. 한국산업표준 KS D 3709    니켈크롬 몰리브덴강재”
389. PDF page 1179: “KS D 3709    니켈크롬 몰리브덴강재  샤. 한국산업표준 KS D 3710    탄소강 단강품 ”
390. PDF page 1179: “KS D 3710    탄소강 단강품  야. 한국산업표준 KS D 3711    크롬 몰리브덴강재  ”
391. PDF page 1179: “KS D 3711    크롬 몰리브덴강재  쟈. 한국산업표준 KS D 3752    기계구조용 탄소강재”
392. PDF page 1179: “KS D 3752    기계구조용 탄소강재  챠. 한국주물공업협동조합 SPS-KFCA-D4101-5004”
393. PDF page 1179: “KS D 4106    용접 구조용 주강품  햐. 한국주물공업협동조합 SPS-KFCA-D4301-5015”
394. PDF page 1179: “KS D 5201    구리 및 구리합금의 판 및 띠  더. 한국산업표준 KS D 6024    구리 ”
395. PDF page 1179: “KS D 6024    구리 및 구리합금 주물  러. 한국산업표준 KS D 7002    PC 강선 및”
396. PDF page 1179: “KS D 7002    PC 강선 및 PC 강연선  머. 한국산업표준 KS R 9106    보통 레일”
397. PDF page 1179: “KS R 9106    보통 레일  버. 한국산업표준 KS R 9221    철도차량용 차륜  705”
398. PDF page 1179: “KS R 9221    철도차량용 차륜  705.10 여수로 수문에 사용하는 재료의 허용응력 및 용접기준”
399. PDF page 1182: “KS 또는 AWS D 1.1(American Welding Society)과 동등 이상의 기준에 따른다. 7”
400. PDF page 1182: “KS F 2405 " 콘크리트의 압축강도   시험방법"에   의하여   시험을   하여   얻은   콘크리트”
401. PDF page 1184: “KS M 2201 “스트레이트 아스팔트” 종류 중 40∼60, 60∼80, 80∼100을 적용할 것 나. 골”
402. PDF page 1184: “KS F 3501 “역청 포장용 채움재”에 적합하고, 쓰레기, 진”
403. PDF page 1186: “KS D 3503 “일반 구조용 압연강재” 중 SS275인 것 2. 한국산업표준 KS D 3515 “용접 구”
404. PDF page 1186: “KS D 3515 “용접 구조용 압연강재” 중 SM400A, SM400B, SM400C, SM490A, SM”
405. PDF page 1186: “KS D 3521 “압력 용기용 강판” SPPV 235, SPPV 315, SPPV 355 및 SPPV 45”
406. PDF page 1186: “KS   D   3529   “용접   구조용   내후성   열간   압연강재”   중   1종 (SMA40”
407. PDF page 1186: “KS D 3507 “배관용 탄소강관” 6. 한국산업표준 KS D 3537 “수도용 아연도 강관” 7. 한국산”
408. PDF page 1186: “KS D 3537 “수도용 아연도 강관” 7. 한국산업표준 KS D 3562 “압력배관용 탄소강관” 중 SP”
409. PDF page 1186: “KS D 3562 “압력배관용 탄소강관” 중 SPPS38 및 SPPS42 8. 한국산업표준 KS D 3564”
410. PDF page 1186: “KS D 3564 “고압배관용 탄소강관” 중 SPPH38, SPPH42 및   SPPH49 9. 한국산업표준”
411. PDF page 1186: “KS D 3565 “상수도용 도복장 강관” 10. 한국산업표준 KS D 3576 “배관용 스테인리스 강관” ”
412. PDF page 1186: “KS D 3576 “배관용 스테인리스 강관” 중 STS304TP 11. 한국산업표준 KS D 3611 “용접”
413. PDF page 1186: “KS D 3611 “용접 구조용 고항복점 강판” 중 SHY685NS 12. 한국산업표준 KS D 3583 “”
414. PDF page 1186: “KS D 3583 “배관용 아크용접 탄소강 강관” 중 SPW400 13. 한국산업표준 KS D 3588 “배”
415. PDF page 1186: “KS D 3588 “배관용 용접 대구경 스테인리스 강관” 중 STS304TPY 14. 한국산업표준 KS D ”
416. PDF page 1186: “KS D 3589 “압출식 폴리에틸렌 피복강관" 중 P1H, P1F 및 P2S 15. 한국산업표준 KS D ”
417. PDF page 1186: “KS D 3693 “스테인리스 클래드강” 16. 한국산업표준 KS D 3698 “냉연 압연 스테인리스강판 및”
418. PDF page 1186: “KS D 3698 “냉연 압연 스테인리스강판 및 강대” 17. 한국산업표준 KS D 3705 “열간 압연 스”
419. PDF page 1186: “KS D 3705 “열간 압연 스테인리스강판 및 강대” 18. 한국산업표준 KS D 3710 “탄소강 단강품”
420. PDF page 1186: “S D 3705 “열간 압연 스테인리스강판 및 강대” 18. 한국산업표준 KS D 3710 “탄소강 단강품””
421. PDF page 1187: “KS D 4106 “용접 구조용 주강품” 21. 한국주물공업협동조합 SPS-KFCA-D4301-5015 “회”
422. PDF page 1187: “KS D 4308 “수도용 덕타일 주철 이형관” 23. 한국산업표준 KS D 4311 “덕타일 주철관” 24”
423. PDF page 1187: “KS D 4311 “덕타일 주철관” 24.   한국산업표준   KS   M   3370   “수도용   플라”
424. PDF page 1187: “KS   M   3370   “수도용   플라스틱   배관계－불포화   폴리에스테르   수지 유리섬유 강화 ”
425. PDF page 1187: “KS D 3003 “항만 및 해 양 구조용 내식성 강재(HSM500)”와 KS D 3300 “항만 및 해양 ”
426. PDF page 1187: “KS D 3300 “항만 및 해양 구조용 내식성 강관 (STKM500)” 또는 동등 이상의 성질을 갖는 것으”
427. PDF page 1189: “KS D 3503 “일반 구조용 압연강재“ SS 275 16이하   135   135   75   225 1”
428. PDF page 1189: “KS D 3515 “용접구조용 압연강재“ 및 KS D 3529 “용접구조용 내후성 열간압 연강재“ SM 40”
429. PDF page 1189: “KS D 3529 “용접구조용 내후성 열간압 연강재“ SM 400A SM 400B SM 400C SMA 40”
430. PDF page 1190: “KS D 3521 “압력용기용 강판“ SPPV 235 6이상 50이하   130   130   75   22”
431. PDF page 1190: “KS D 3611 “용접 구조용 SHY 685NS 50이하   330   330   190   560 50초”
432. PDF page 1191: “KS D 3698 “냉간압연 스테인레스강 판 및 강대” KS D 3705 “열간압연 스테인리스강 판 및 강대”
433. PDF page 1191: “KS D 3705 “열간압연 스테인리스강 판 및 강대” STS 304   110   110   60   18”
434. PDF page 1191: “KS D 3693 “스테인리스 클래드강” ϭ a (1) 허용인장응 력과 동일 ϭ a ×1/√3 ϭ a   x”
435. PDF page 1191: “KS D 3507 “배관용 탄소강관” SPP   70   70   40   115 한국산업표준 KS D 35”
436. PDF page 1191: “KS D 3562 “압력배관용 탄소강관” SPPS 38   115   115   65   195 SPPS 4”
437. PDF page 1191: “KS D 3564 “고압배관용 탄소강관” SPPH 38   115   115   65   195 SPPH 4”
438. PDF page 1191: “KS D 3565 “상수도용 도복장 강관” STWW 290   70   70   40   115 STWW 3”
439. PDF page 1191: “KS D 3583 “배관용 아크용접 탄소강관“ SPW 400   125   125   70   210 한국산”
440. PDF page 1191: “KS D 3576 “배관용 STS 304TP STS 304TPY   110   110   60   185”
441. PDF page 1192: “KS D 3588 “배관용 용접 대구경 스테인리스강관 “ 한국산업표준 KS D 4311 “덕타일주철 관” 1”
442. PDF page 1192: “KS D 4311 “덕타일주철 관” 120   120   70   200 한국산업표준 KS D 4308 “덕”
443. PDF page 1192: “KS D 4308 “덕타일주철이 형관” 105   105   60   175 한국주물공업 협동조합 SPS-K”
444. PDF page 1192: “KS D 4106 “용접구조용 주강품” SCW 410   100   100   55   170 SCW 480”
445. PDF page 1192: “KS D 3710 “탄소강 단강품” SF 390A   105   105   60   175 SF 440A  ”
446. PDF page 1193: “KS   또는   AWS   D   1.1(American Welding Society)과 동등 이상의 기준”
447. PDF page 1195: “KS   또는 ASTM 규격에 적합하거나 동등 이상의 재료를 사용하여야 한다. 표 715.1-1 설비별 AS”
448. PDF page 1195: “KS/단체표준 규격 구분   ASTM 규격   KS/단체표준 규격 번호   명칭 수차날개 Runner Bla”
449. PDF page 1195: “KS/단체표준 규격 번호   명칭 수차날개 Runner Blade   A743 Gr.CA-6NM   SPS-”
450. PDF page 1196: “KS B 6750 “압력용기의 내압시험 및 누수 발전기 전단 덮개판 Bulb Nose   A283 Gr. C”
451. PDF page 1197: “KS B 6750 “압력용기(기반규격)”를 준용 할 것 6. 소수력발전에서는 블래더형이나 전동 서보 모터식으”
452. PDF page 1205: “KS”라 한다)이 시행 전까지는 제조사가 정한 기준에 적합한 것을 전기용품 안전확인시험에 합격한 것으 로 본”

### Term: 품질보증

Hit count: 0; pages: 0.

No hits.

### Term: 태양광

Hit count: 21; pages: 7.

1. PDF page 19: “태양광발전설비) 521 일반사항 ··········································”
2. PDF page 19: “태양광설비의 시설 ··················································”
3. PDF page 19: “태양광설비의 시설기준 ················································”
4. PDF page 293: “태양광선이 들어오는 창과 가장 가까운 전등은 따로 점멸이 가능하도록 할 것. 다만, 다음의 경우는 적용하지 ”
5. PDF page 293: “태양광선이 들어오는 창문을 말한다)이 없거나 공장의 경우 제품 의 생산 공정이 연속으로 되는 곳에 설치되어 ”
6. PDF page 547: “태양광발전이나   풍력발전   등이   현재   조건에서   가능한   최대의   전력을 생산할 수 있도록 ”
7. PDF page 547: “태양광발전(BIPV : Building-Integrated Photovoltaic)”이란 태양광모듈 을 건축”
8. PDF page 547: “태양광모듈 을 건축물에 설치하여 건축 부자재의 역할 및 기능과 전력생산을 동시에 할 수 있 는 설비로 창호,”
9. PDF page 547: “태양광 설비의 유형을 말한다. 7. “건물부착형 태양광발전(BAPV :   Building-Attached ”
10. PDF page 547: “태양광발전(BAPV :   Building-Attached Photovoltaic)”이란 건축물 경사 지붕 ”
11. PDF page 547: “태양광설비의 유형을 말한다. 8.   “전지관리시스템(BMS,   Battery   Management   ”
12. PDF page 558: “태양광발전설비) 521 일반사항 521.1 설치장소의 요구사항 1. 인버터, 제어반, 배전반 등의 시설은 기”
13. PDF page 558: “태양광설비의 고장이나 외부 환경요인으로 인하여 계통연계에 문제가 있을 경우 회 로분리를 위한 안전시스템이 있”
14. PDF page 559: “태양광설비의 시설 522.1 간선의 시설기준 522.1.1 전기배선 1. 전선은 다음에 의하여 시설하여야 한”
15. PDF page 559: “태양광설비의 시설기준 522.2.1 태양전지 모듈의 시설 태양광설비에 시설하는 태양전지 모듈(이하 “모듈”이”
16. PDF page 559: “태양광설비에 시설하는 태양전지 모듈(이하 “모듈”이라 한다)은 다음에 따라 시설하여 야 한다. 가. 모듈은 ”
17. PDF page 560: “태양광발전소의 시설 상주감시를 하지 아니하는 태양광발전소의 시설은 351.8에 따른다. 522.3.4 접지설”
18. PDF page 560: “태양광발전소의 시설은 351.8에 따른다. 522.3.4 접지설비 1. 태양전지 모듈의 프레임은 지지물과 전”
19. PDF page 561: “태양광설비의 외부피뢰시스템은 150의 규정에 따라 시설한다. 522.3.6 태양광설비의 계측장치 태양광설비에”
20. PDF page 561: “태양광설비의 계측장치 태양광설비에는 전압과 전류 또는 전압과 전력을 계측하는 장치를 시설하여야 한다.”
21. PDF page 561: “태양광설비에는 전압과 전류 또는 전압과 전력을 계측하는 장치를 시설하여야 한다.”

### Term: 모듈

Hit count: 42; pages: 13.

1. PDF page 4: “모듈의 절연내력   ·················································”
2. PDF page 48: “모듈의 전로, 변 압기의 전로, 기구 등의 전로 및 직류식 전기철도용 전차선을 제외한다)는 표 132-1 에”
3. PDF page 50: “모듈의 절연내력 연료전지 및 태양전지 모듈은 최대사용전압의 1.5배의 직류전압 또는 1배의 교류전압 (500”
4. PDF page 50: “모듈은 최대사용전압의 1.5배의 직류전압 또는 1배의 교류전압 (500 V 미만으로 되는 경우에는 500 V”
5. PDF page 501: “모듈(복수의 태양전지 모듈을 설치하는 경우에 는 그 집합체)의 전압 및 전류 또는 전력 나. 발전기의 베어링”
6. PDF page 501: “모듈을 설치하는 경우에 는 그 집합체)의 전압 및 전류 또는 전력 나. 발전기의 베어링(수중 메탈을 제외한다”
7. PDF page 546: “모듈의 절연내력은 134에 따른다. 502 용어의 정의 1.   “풍력터빈”이란   바람의 운동에너지를   ”
8. PDF page 547: “모듈 을 건축물에 설치하여 건축 부자재의 역할 및 기능과 전력생산을 동시에 할 수 있 는 설비로 창호, 스팬”
9. PDF page 547: “모듈이 제거될 경우 건물 외장재의 핵심 기능이 상실 또는 훼손될 수 있어 다른 건축자재로 대체되어야 하는 구”
10. PDF page 552: “모듈의 내부 온도가 상승할 경우 5. 212.3.4에 의하여 직류 전로에 과전류차단기를 설치하는 경우 직류 ”
11. PDF page 553: “모듈 또는 랙에 화재확산을 방지할 수 있는 구조이거나 소화장치를 시설 하여야 한다.”
12. PDF page 555: “모듈의 직렬 연결체(이하 512에서 ‘이차전지랙’)의 용량은 50 kWh 이하 로 하고 건물 내 시설 가능한”
13. PDF page 558: “모듈을 지붕에 시설하는 경우 취급자에게 추락의 위험이 없도록 점검통로 를 안전하게 시설하여야 한다. 5.  ”
14. PDF page 558: “모듈의   직렬군   최대개방전압이   직류   750 V   초과   1500   V   이하인   시설장”
15. PDF page 558: “모듈을 지상에 설치하는 경우는 351.1의 1에 의하여 울타리·담 등을 시 설하여야 한다. 나. 태양전지 모”
16. PDF page 558: “모듈을 일반인이 쉽게 출입할 수 있는 옥상 등에 시설하는 경우는 “가” 또는 341.8의 1의“바”에 의하여”
17. PDF page 558: “모듈을 일반인이 쉽게 출입할 수 없는 옥상·지붕에 설치하는 경우는 모 듈 프레임 등 쉽게 식별할 수 있는 위”
18. PDF page 558: “모듈을 주차장 상부에 시설하는 경우는 “나”와 같이 시설하고 차량의 출 입 등에 의한 구조물, 모듈 등의 손”
19. PDF page 558: “모듈 등의 손상이 없도록 하여야 한다. 마. 태양전지 모듈을 수상에 설치하는 경우는 “다”와 같이 시설하여야”
20. PDF page 558: “모듈을 수상에 설치하는 경우는 “다”와 같이 시설하여야 한다. 521.2 설비의 안전 요구사항 1. 태양전지”
21. PDF page 558: “모듈, 전선, 개폐기 및 기타 기구는 충전부분이 노출되지 않도록 시설하여 야 한다. 2. 모든 접속함에는 내”
22. PDF page 559: “모듈에 접속하는 부하측 옥내배선(복수의 태양전지모듈을 시설하는 경 우에는 그 집합체에 접속하는 부하 측의 배”
23. PDF page 559: “모듈을 시설하는 경 우에는 그 집합체에 접속하는 부하 측의 배선)의 대지전압 제한은 511.1.3에 따른다.”
24. PDF page 559: “모듈 및 기타 기구에 전선을 접속하는 경우는 나사로 조이거나 기타 이와 동등 이상의   효력이   있는   ”
25. PDF page 559: “모듈의 출력배선은 극성별로 확인할 수 있도록 표시할 것 라. 직렬 연결된 태양전지모듈의 배선은 과도과전압의 ”
26. PDF page 559: “모듈의 배선은 과도과전압의 유도에 의한 영향을 줄이기 위 하여 스트링 양극간의 배선간격이 최소가 되도록 배치”
27. PDF page 559: “모듈의 시설 태양광설비에 시설하는 태양전지 모듈(이하 “모듈”이라 한다)은 다음에 따라 시설하여 야 한다. ”
28. PDF page 559: “모듈(이하 “모듈”이라 한다)은 다음에 따라 시설하여 야 한다. 가. 모듈은 자체중량, 적설, 풍압, 지진 ”
29. PDF page 559: “모듈”이라 한다)은 다음에 따라 시설하여 야 한다. 가. 모듈은 자체중량, 적설, 풍압, 지진 및 기타의 진”
30. PDF page 559: “모듈은 자체중량, 적설, 풍압, 지진 및 기타의 진동과 충격에 대하여 탈락하지 아 니하도록 지지물에 의하여 ”
31. PDF page 559: “모듈의 각 직렬군은 동일한 단락전류를 가진 모듈로 구성하여야 하며 1대의 인버 터(멀티스트링   인버터의  ”
32. PDF page 559: “모듈로 구성하여야 하며 1대의 인버 터(멀티스트링   인버터의   경우   1대의   MPPT   제어기)에”
33. PDF page 559: “모듈   직렬군이   2병 렬   이상일   경우에는   각   직렬군의   출력전압   및   출력전류가 ”
34. PDF page 560: “모듈을 지지하는 구조물 모듈의 지지물은 다음에 의하여 시설하여야 한다. 가. 자체중량, 적재하중, 적설 또는”
35. PDF page 560: “모듈의 지지물은 다음에 의하여 시설하여야 한다. 가. 자체중량, 적재하중, 적설 또는 풍압, 지진 및 기타의”
36. PDF page 560: “모듈 지지대와 그 연결부재의 경우 용융아연도금처리 또는 녹방지 처리를 하여야 하며, 절단가공 및 용접부위는 ”
37. PDF page 560: “모듈-지지대의 고정 볼트에는 스프링 와셔 또는 풀림방지너트 등으로 체결할 것 522.3 제어 및 보호장치 등”
38. PDF page 560: “모듈에 접속하는 부하측의 태양전지 어레이에서 전력변환장치에 이르는 전로(복수의 태양전지 모듈을 시설한 경우에”
39. PDF page 560: “모듈을 시설한 경우에는 그 집합체에 접속하는 부하측의 전 로)에는 그 접속점에 근접하여 개폐기 기타 이와 유”
40. PDF page 560: “모듈을 병렬로 접속하는 전로에는 그 전로에 단락전류가 발생할 경우에 전로를 보 호하는 과전류차단기 또는 기타”
41. PDF page 560: “모듈의 프레임은 지지물과 전기적으로 완전하게 접속하여야 한다.”
42. PDF page 561: “모듈 등의 금속제는 접지를 해야하고, 접지시 접지극을 수중에 띄우거나, 수중 바닥에 노출된 상태로 시설하여서”

### Term: 패널

Hit count: 0; pages: 0.

No hits.

### Term: 제조사별

Hit count: 0; pages: 0.

No hits.

### Term: 제작사별

Hit count: 0; pages: 0.

No hits.

### Term: 제조업체별

Hit count: 0; pages: 0.

No hits.

### Term: 태양전지 모듈

Hit count: 20; pages: 9.

1. PDF page 4: “태양전지 모듈의 절연내력   ············································”
2. PDF page 48: “태양전지 모듈의 전로, 변 압기의 전로, 기구 등의 전로 및 직류식 전기철도용 전차선을 제외한다)는 표 13”
3. PDF page 50: “태양전지 모듈의 절연내력 연료전지 및 태양전지 모듈은 최대사용전압의 1.5배의 직류전압 또는 1배의 교류전압”
4. PDF page 50: “태양전지 모듈은 최대사용전압의 1.5배의 직류전압 또는 1배의 교류전압 (500 V 미만으로 되는 경우에는 ”
5. PDF page 501: “태양전지 모듈(복수의 태양전지 모듈을 설치하는 경우에 는 그 집합체)의 전압 및 전류 또는 전력 나. 발전기”
6. PDF page 501: “태양전지 모듈을 설치하는 경우에 는 그 집합체)의 전압 및 전류 또는 전력 나. 발전기의 베어링(수중 메탈을”
7. PDF page 546: “태양전지 모듈의 절연내력은 134에 따른다. 502 용어의 정의 1.   “풍력터빈”이란   바람의 운동에너”
8. PDF page 558: “태양전지 모듈을 지붕에 시설하는 경우 취급자에게 추락의 위험이 없도록 점검통로 를 안전하게 시설하여야 한다.”
9. PDF page 558: “태양전지 모듈을 지상에 설치하는 경우는 351.1의 1에 의하여 울타리·담 등을 시 설하여야 한다. 나. 태”
10. PDF page 558: “태양전지 모듈을 일반인이 쉽게 출입할 수 있는 옥상 등에 시설하는 경우는 “가” 또는 341.8의 1의“바””
11. PDF page 558: “태양전지 모듈을 일반인이 쉽게 출입할 수 없는 옥상·지붕에 설치하는 경우는 모 듈 프레임 등 쉽게 식별할 수”
12. PDF page 558: “태양전지 모듈을 주차장 상부에 시설하는 경우는 “나”와 같이 시설하고 차량의 출 입 등에 의한 구조물, 모듈”
13. PDF page 558: “태양전지 모듈을 수상에 설치하는 경우는 “다”와 같이 시설하여야 한다. 521.2 설비의 안전 요구사항 1.”
14. PDF page 558: “태양전지 모듈, 전선, 개폐기 및 기타 기구는 충전부분이 노출되지 않도록 시설하여 야 한다. 2. 모든 접속”
15. PDF page 559: “태양전지 모듈의 시설 태양광설비에 시설하는 태양전지 모듈(이하 “모듈”이라 한다)은 다음에 따라 시설하여 야”
16. PDF page 559: “태양전지 모듈(이하 “모듈”이라 한다)은 다음에 따라 시설하여 야 한다. 가. 모듈은 자체중량, 적설, 풍압”
17. PDF page 560: “태양전지 모듈에 접속하는 부하측의 태양전지 어레이에서 전력변환장치에 이르는 전로(복수의 태양전지 모듈을 시설”
18. PDF page 560: “태양전지 모듈을 시설한 경우에는 그 집합체에 접속하는 부하측의 전 로)에는 그 접속점에 근접하여 개폐기 기타”
19. PDF page 560: “태양전지 모듈의 프레임은 지지물과 전기적으로 완전하게 접속하여야 한다.”
20. PDF page 561: “태양전지 모듈 등의 금속제는 접지를 해야하고, 접지시 접지극을 수중에 띄우거나, 수중 바닥에 노출된 상태로 ”

### Term: 태양광모듈

Hit count: 1; pages: 1.

1. PDF page 547: “태양광모듈 을 건축물에 설치하여 건축 부자재의 역할 및 기능과 전력생산을 동시에 할 수 있 는 설비로 창호,”

### Term: 태양광 모듈

Hit count: 0; pages: 0.

No hits.

### Term: 모듈 제조사

Hit count: 0; pages: 0.

No hits.

### Term: 모듈 제작사

Hit count: 0; pages: 0.

No hits.

### Term: 모듈 제조업체

Hit count: 0; pages: 0.

No hits.

### Term: 모듈 인증

Hit count: 0; pages: 0.

No hits.

### Term: 태양광 인증

Hit count: 0; pages: 0.

No hits.

### Term: 태양전지 인증

Hit count: 0; pages: 0.

No hits.

### Term: 인증 기준

Hit count: 0; pages: 0.

No hits.

### Term: 인증기준

Hit count: 0; pages: 0.

No hits.

### Term: 제품인증

Hit count: 0; pages: 0.

No hits.

### Term: 안전인증

Hit count: 2; pages: 2.

1. PDF page 43: “안전인증을 취득한 것을 사용하 여야 한다. 2. 코드는 이 규정에서 허용된 경우에 한하여 사용할 수 있다. ”
2. PDF page 270: “안전인증을 받은 등기구로서 다음에 의하여 시설하 는 경우는 예외로 한다. (1) 이웃 연결 설치 등기구는 K”

### Term: 적합성 인증

Hit count: 1; pages: 1.

1. PDF page 1205: “적합성 인증은 「전기 용품 및 생활안전용품 안전관리법」 또는 한국산업표준(이하 “KS”라 한다)이 시행 전까”

### Term: 인증시험

Hit count: 5; pages: 4.

1. PDF page 92: “인증시험을 받아야 한다. P-No.21에 서 P-No.26 사이의 어떤 하나의 금속에 대한 자격시험을 통과한”
2. PDF page 98: “인증시험이 요구될 때에는 161.6.5의 1.을 적용하여야   한다.   만약   특수한 인증시험   요건이”
3. PDF page 98: “인증시험   요건이 적용되는 규격에   규정되지 않았다면”
4. PDF page 628: “인증시험을 하여야 한다. 이 견본들의 최 대 블로우다운은 다음 표 605.36에 명시된 값을 초과하지 말아야”
5. PDF page 1076: “인증시험보고서 또는 재료확인서와 부호화된 표시와 함께 재료의 각 부재를 식별할 수 있어야 한다. 아래 제2호”

### Term: KS제품

Hit count: 1; pages: 1.

1. PDF page 560: “KS제품 또는 동등이상의 성능의 제품일 것 다. 모듈 지지대와 그 연결부재의 경우 용융아연도금처리 또는 녹방”

### Term: 제조사가 정한

Hit count: 3; pages: 3.

1. PDF page 554: “제조사가 정한 거리를 이격한   경우에는 예외로 할 수 있으며, 컨테이너 및 인클로저의 면적은 42 m 2 ”
2. PDF page 633: “제조사가 정한 최저 허용 수위보다 50 mm 이상이고 75 mm 이하이어야 한다. (2) 여러   튜브 부분”
3. PDF page 1205: “제조사가 정한 기준에 적합한 것을 전기용품 안전확인시험에 합격한 것으 로 본다.”

### Term: 제조자가 인증

Hit count: 1; pages: 1.

1. PDF page 898: “제조자가 인증한 충격시험 보고서는 그 재료가 이 호의 요건을 만족시 킨다는 것을 보증하려면 아래 요건을 충족”

## Evidence limits and stop

- UNVERIFIED: Human approval of every primary, acceptable, and reject classification.
- UNVERIFIED: Whether Query 3 intends equipment-to-equipment clearance rather than the mounting dimensions present in clause 241.17.3.
- UNVERIFIED: Whether Query 6 is intended to be limited to the special-high-voltage distribution-transformer condition in clause 341.2.
- UNVERIFIED: A synthesized comparison answer for Query 12; the source provides separate sections but no direct comparison clause.

- Production files modified: **NONE**
- Index accessed: **NONE**
- Retrieval/search functions called: **NONE**
- Baseline frozen: **NO**
- Commit or push: **NOT_ATTEMPTED**
- STOP: candidates await human approval.
