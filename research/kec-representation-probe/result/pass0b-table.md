# KEC Representation Pass 0b — Authenticated Retry Structural Block

## Result

`BLOCKED`

The authenticated Phase 1 retry reached the measurement gate and returned a
successful administrative-rule history-list payload. The complete returned
13-row population contained no record whose `발령번호` is `2024-749`.
Therefore the law.go.kr historical-body path is structurally blocked at record
discovery and every downstream comparison phase in the gated run remains
`NOT_ATTEMPTED`. A separately authorized post-gate observation of the current
2025-227 B2 response is recorded below; it does not reopen the B1 gate.

This is deliberately narrower than a claim that revision 2024-749 itself does
not exist. It establishes only that the successful law.go.kr history-list
response used by this probe did not expose that record.

## Initial Attempt Correction

The first attempt used the unverified sample value `OC=test` during an
announced maintenance window. That attempt remains:

```text
INITIAL_RESULT = INCONCLUSIVE
INITIAL_PASS_0A = UNVERIFIED
INITIAL_OPTION_1_AVAILABLE = UNVERIFIED
INITIAL_BLOCK_REASON_CLASS = TRANSIENT_SERVICE_OUTAGE
```

It is retained for audit history but is not evidence for the final structural
classification.

## Credential and Response Retention

The retry read the applicant-specific OC from a local mode-0600 secret file;
the value was never written to the manifest, report, or retained request URL.
The API echoed it in response links, so every echo was replaced with the
XML-safe token `REDACTED_OC` before retention. All `Set-Cookie` values in the
retained headers were replaced with `REDACTED`.

**OBSERVED** — the sanitized retained XML remains well-formed, contains no
exact OC value, and records `resultCode=00` and `resultMsg=success`.

- response: `raw/phase1-retry-history-list.response.xml`
- locator: `/AdmRulSearch/resultCode`; `/AdmRulSearch/resultMsg`
- retained SHA-256: `manifest.json#/retained_http_artifacts/5/sha256`
- privacy record: `extracted/phase1-retry-summary.json#/request`

## Authenticated Phase 1 Observation

**OBSERVED** — the endpoint returned HTTP 200 and XML content with a successful
API result.

- HTTP evidence: `raw/phase1-retry-history-list.headers.txt`, line 1
  (`HTTP/1.1 200 OK`) and line 14 (`Content-Type: text/xml;charset=UTF-8`)
- API-result evidence: `raw/phase1-retry-history-list.response.xml`,
  `/AdmRulSearch/resultCode` and `/AdmRulSearch/resultMsg`
- evidence summary:
  `extracted/phase1-retry-summary.json#/measurement_precondition`

**OBSERVED** — the returned payload reports `totalCnt=13`, `numOfRows=13`, and
contains 13 `admrul` rows. Their revision numbers are:

```text
2018-103, 2020-738, 2021-36, 2021-509, 2022-809,
2023-364, 2023-563, 2023-768, 2023-839, 2023-875,
2025-52, 2025-198, 2025-227
```

**OBSERVED FALSE** — the count of returned records whose `발령번호` is exactly
`2024-749` is zero.

- evidence: `raw/phase1-retry-history-list.response.xml`
- locator:
  `/AdmRulSearch[resultCode='00' and totalCnt='13' and numOfRows='13']/admrul[발령번호='2024-749'] count=0`
- structured summary: `extracted/phase1-retry-summary.json#/history_list`

## PASS 0a Gate Facts

| Required fact | Status | Observation and evidence locator |
| --- | --- | --- |
| Historical record exists | OBSERVED, value `FALSE` | The successful complete returned list contains zero `2024-749` records. Evidence: `raw/phase1-retry-history-list.response.xml`, locator above. |
| Revision-specific ID exists | NOT_ATTEMPTED | No target history record existed from which to observe an ID. |
| Body retrieval by that ID succeeds | NOT_ATTEMPTED | No directly observed historical ID was available. |
| Returned representation identifies itself as 2024-749 | NOT_ATTEMPTED | No target body request was possible. |
| 조문내용 or equivalent body content is available | NOT_ATTEMPTED | No target body response was available. |
| Request was not silently substituted with the current revision | NOT_ATTEMPTED | No target body response existed to inspect. |

```text
PASS_0A = BLOCKED
OPTION_1_AVAILABLE = NO
BLOCK_REASON_CLASS = STRUCTURAL_RECORD_ABSENCE
RETRYABLE = NO
DOWNSTREAM_HALTED = YES
```

The structural classification is supported by a located
`OBSERVED value=False` claim. It is not inferred from an unavailable response
or an authentication failure.

## Filter Diagnostics Boundary

**UNVERIFIED** — bounded `nb` and `date` positive-control and target requests
returned the same 13-row population instead of visibly narrowed results. Their
filter effect was not established, so none of those diagnostics contributed
to the structural conclusion.

- record: `extracted/phase1-retry-summary.json#/filter_diagnostics`
- retained diagnostic responses:
  `raw/phase1-filter-control-2023-875.response.xml` and
  `raw/phase1-filter-target-2024-749.response.xml`

## Harness Validation Boundary

```text
CONTRACT_VERIFIED = YES (SYNTHETIC CONTRACTS + ONE RETAINED-XML REGRESSION)
REAL_INPUT_VERIFIED = PARTIAL
  (AUTHENTICATED HISTORY LIST + ONE CURRENT 2025-227 BODY RESPONSE)
REAL_INPUT_GATE_VERIFIED = YES
REAL_INPUT_BODY_RESPONSE_PARSED = YES (2025-227)
REAL_INPUT_BODY_CONTENT_AVAILABLE = FALSE (OBSERVED)
PACKAGED_REAL_RESPONSE_PARSER = YES
  (RESEARCH-ONLY observe_law_body; CURRENT AdmRulService SCHEMA ONLY)
HARNESS_ACCURACY = UNVERIFIED
```

One real authenticated XML list was parsed with Python stdlib, and its located
false claim traversed the existing Phase 1 gate. Separately, the retained
current 2025-227 `AdmRulService` XML passed `observe_law_body`; revision identity
was verified and its explicit empty `조문내용` produced located
`OBSERVED value=False`. No 2024-749 historical body or HWP/CFB structure has
traversed the harness, so 42 Green tests do not establish overall real-input
accuracy.

The retained response is intentionally ignored under `raw/`. This regression
is therefore local and evidence-backed; a clean reconstruction must reacquire
and hash-match that response before the test can run.

The first real-input breakage was retention-layer specific: an initial
angle-bracket redaction token made the saved XML unparsable. It was replaced
with `REDACTED_OC`, and only the corrected, well-formed sanitized XML was
retained.

## Post-Gate Current B2 XML Observation

```text
B2_XML_TRANSPORT = OBSERVED (HTTP 200, text/xml, 3,120 bytes)
B2_XML_PARSE = SUCCESS (OBSERVED)
B2_REVISION_IDENTITY = 2025-227 (OBSERVED)
B2_CLAUSE_BODY_TAG = PRESENT (OBSERVED)
B2_CLAUSE_CONTENT_AVAILABLE = FALSE (OBSERVED)
B2_XML_FLAG_BODY_CLASS = RETRIEVAL_METHOD_MISMATCH (OBSERVED)
STRUCTURAL_BODY_FIELD_ABSENCE_REASON_CLASS_APPLIES =
  NO (OBSERVED; BODY TAG PRESENT)
```

The retained XML crossed the research-only parser. After matching
`/AdmRulService[1]/행정규칙기본정보[1]/발령번호[1]` with text `2025-227`,
the parser observed the present `/AdmRulService[1]/조문내용[1]` element with
`child_count=0` and `text_chars=0`, and returned `OBSERVED value=False`. A
missing `조문내용` tag instead returns `UNVERIFIED`; tag absence is not converted
into an observed empty body.

- transport evidence: `raw/body-probe-2025-227.headers.txt`, lines 1, 13, and 14
- body evidence: `raw/body-probe-2025-227.response.xml`
- parser locator:
  `/AdmRulService[1]/행정규칙기본정보[1]/발령번호[1] (text='2025-227'); /AdmRulService[1]/조문내용[1] (child_count=0; text_chars=0)`
- manifest record: `manifest.json#/sources/2/clause_content_observation`

`RETRIEVAL_METHOD_MISMATCH` classifies only the observed XML flag/body
mismatch: `조문형식여부=Y` while the present `조문내용` is empty. It is not
`STRUCTURAL_BODY_FIELD_ABSENCE`, because the field exists. The working alternate
method and the backend cause of the empty content remain `UNVERIFIED`. This is a
current B2 observation, not the missing historical B1 body, and it does not
reopen the Phase 1 gate or establish O2/O3.

**OBSERVED** — the two attachment filenames label themselves as
`[전문] ... 일부개정 전문` for the electric-vehicle-charging amendment and end
in `.hwp` and `.pdf`.

- evidence: `raw/body-probe-2025-227.response.xml`
- locator: `/AdmRulService/첨부파일/첨부파일명[1..2]`

**UNVERIFIED** — filename metadata does not establish that either attachment
contains the full KEC corpus. **NOT_ATTEMPTED** — neither attachment was
downloaded or parsed.

## Phase 0 C Provenance Inventory

**OBSERVED** — the read-only Phase 0 inventory recorded the starting branch,
HEAD, clean status, Task90/93 implementation paths, bounded HWPX/HWP search,
local PDF identities, and the structure of two existing SQLite extraction
artifacts.

- inventory: `extracted/phase0-inventory.json#/`
- Task90/93 paths: `extracted/phase0-inventory.json#/task90` and
  `extracted/phase0-inventory.json#/task93`
- bounded HWPX/HWP result:
  `extracted/phase0-inventory.json#/bounded_hwpx_hwp_search`

**UNVERIFIED** — no retained Task90/93 snapshot, capture, or other direct
evidence binds either local PDF candidate to the current Task90/93 baseline.
No exact C input artifact was selected.

```text
C_STATUS = NOT_ATTEMPTED
```

## C Baseline Provenance Debt

**OBSERVED** — the bounded repository inventory cannot identify which exact
PDF artifact is the current Task90/93 baseline input.

```text
DEBT_ID = C_BASELINE_INPUT_IDENTITY_UNRESOLVED
EVIDENCE_STATUS = OBSERVED
```

- evidence: `extracted/phase0-inventory.json#/task90`,
  `extracted/phase0-inventory.json#/task93`, and
  `extracted/phase0-inventory.json#/existing_pdf_extraction_artifacts`
- boundary: this records research debt only; it does not authorize a Task93
  provenance-contract change.

## Required Main Table

| Check | A: 2024-749 HWPX | B2: law.go.kr 2025-227 | C: Task90/93 | Observation |
| --- | --- | --- | --- | --- |
| KEC identifier | NOT_ATTEMPTED — structural Phase 1 stop | UNVERIFIED — rule/revision identity is observed, but no clause text exists to identify a target clause | NOT_ATTEMPTED — C provenance unestablished | UNVERIFIED — no clause-local comparison was possible. |
| Conditional prose | NOT_ATTEMPTED — structural Phase 1 stop | UNVERIFIED — explicit `조문내용` is empty | NOT_ATTEMPTED — C provenance unestablished | UNVERIFIED — no clause-local comparison was possible. |
| 호/목 hierarchy | NOT_ATTEMPTED — structural Phase 1 stop | UNVERIFIED — no clause body was returned from which hierarchy could be assessed | NOT_ATTEMPTED — C provenance unestablished | UNVERIFIED — no clause-local comparison was possible. |
| Inline/body table | NOT_ATTEMPTED — structural Phase 1 stop | UNVERIFIED — no clause body was returned from which tables could be assessed | NOT_ATTEMPTED — C provenance unestablished | UNVERIFIED — no clause-local comparison was possible. |
| Cross-reference | NOT_ATTEMPTED — structural Phase 1 stop | UNVERIFIED — no clause body was returned from which references could be assessed | NOT_ATTEMPTED — C provenance unestablished | UNVERIFIED — no clause-local comparison was possible. |
| Requirement-extraction-relevant structure | NOT_ATTEMPTED — structural Phase 1 stop | UNVERIFIED — response schema and empty-body state are observed, but clause structure is unavailable | NOT_ATTEMPTED — C provenance unestablished | UNVERIFIED — no clause-local comparison was possible. |

| Same-revision discrepancy | Result |
| --- | --- |
| A 2024-749 ↔ B1 law.go.kr 2024-749 | UNVERIFIED — no B1 history record/body was exposed, so no same-revision diff exists. |

## Candidate Discovery Method

`NOT_ATTEMPTED` — Phase 1 structurally stopped before B2 candidate discovery.

## Candidate Discovery Scope

`NOT_ATTEMPTED` — no B2 scan and no A-side candidate confirmation occurred;
zero A candidates were inspected.

## Candidate Selection Bias

`NOT_ATTEMPTED` — the continuation contract fixes `scan_source = B2`, but the
scan did not run and `scan_scope = NOT_ATTEMPTED`. If resumed under a different
source path, B2-first discovery could favor provisions that are easier to find
or structurally clearer in that representation and could affect O2/O3
interpretation. This field records the required human-review boundary; its
presence does not prove the statement's truth or adequacy.

## A-visible Extraction Method

`NOT_ATTEMPTED` — structural Phase 1 stop.

## B1-visible Extraction Method

`NOT_ATTEMPTED` — no B1 record or body existed in the returned history list.

## A/B1 Extraction Asymmetry

`NOT_ATTEMPTED` — neither extraction path ran. The automated contract verifies
only that this field is nonblank; a human must judge its truth and adequacy.

## Clause-local Observations

```text
O1 STRUCTURED_REPRESENTATION = INCONCLUSIVE
O2 LAW_BODY_CONDITIONAL_STRUCTURE = INCONCLUSIVE
O3 CONDITION_TABLE_INDEPENDENCE = INCONCLUSIVE
O4 SAME_REVISION_DISCREPANCY = UNVERIFIED
```

## Generalization Warning

No target clause was selected and no clause-local observation was made. The
current B2 response schema, identity, and empty-body state were observed, but
that does not establish clause-local structure or content availability through
another method. The structural history-list result must not be generalized
into a claim about the existence of revision 2024-749, the KEC corpus, HWPX
structure, law-body sufficiency, or Task90/93 extraction quality. The automated
contract checks only that this warning is nonblank; a human must assess its
adequacy.

## Stop Confirmation

- no Task90 production change
- no Task93 production or provenance change
- no Task94 reopen or implementation
- no Task95 redesign
- no geometry calibration
- no second sample
- no unbounded corpus scan
- no HWP/HWPX conversion dependency
- no commit
- no push

## Post-Pass 0b Diagnostic Closure — 2026-08-22

This post-gate B2 diagnostic does not change the Phase 1/B1 structural
`BLOCKED` result above and does not establish an O2/O3 result.

```text
OC_APPROVAL_STATUS = APPROVED (OBSERVED)
PORTAL_UI_NONAPPROVAL_CAUSE = EXCLUDED (OBSERVED)
BACKEND_PERMISSION_CAUSE = UNVERIFIED
HTML_ABSENCE_CAUSE_CLASS = PROPAGATION_OR_PARAMETER_OR_INSTABILITY (UNVERIFIED)

NEXT_ACTION_STATUS = COMPLETED (OBSERVED)
PLANNED_ACTION = ONE_TIME_DELAYED_HTML_RETRY
EXECUTED_ACTION = USER_AUTHORIZED_EARLY_FINAL_HTML_RETRY
NEXT_ACTION_PURPOSE = TEST WHETHER HTML EXPOSES CLAUSE CONTENT
  ABSENT FROM THE SUCCESSFUL XML RESPONSE
PLANNED_DELAY_SATISFIED = NO
  (OBSERVED FROM RESPONSE DATE HEADERS; 51 MINUTES 5 SECONDS)
CLIENT_REQUEST_START_TIMESTAMP = UNVERIFIED
MAX_ADDITIONAL_REQUESTS = 1
REQUESTS_CONSUMED = 1
REMAINING_REQUESTS = 0
STOP_AFTER_ATTEMPT = YES

FINAL_HTML_HTTP = 200 (OBSERVED)
FINAL_HTML_SEMANTIC_RESULT = APPLICATION_ERROR (OBSERVED)
FINAL_HTML_BODY_EQUALS_PRIOR_AUTHORIZED_RESPONSE = YES (OBSERVED)
HTML_CLAUSE_CONTENT_MEASUREMENT = NOT_ESTABLISHED

ARCHITECTURE_DECISION = DEFERRED
PRODUCTION_CHANGE_AUTHORIZED = NO
```

- approval-status evidence:
  `extracted/open-api-approval-observation.json#/application_state` and
  `#/current_administrative_rule_formats`
- portal-layer nonapproval exclusion evidence:
  `extracted/open-api-approval-observation.json#/application_state/approval_status`
  and `#/current_administrative_rule_formats/body_html_checked`

The approval observation is retained without the credential value or personal
account fields in `extracted/open-api-approval-observation.json`. It proves the
provider-portal configuration only. Backend propagation and credential
acceptance at the DRF endpoint remain `UNVERIFIED`.

The 42-test suite contains synthetic contracts plus one retained-response XML
regression. It still does not reference this approval artifact or its manifest
hash. The approval artifact's JSON shape, hash linkage, credential/PII absence,
and locators were verified manually; Green must not be read as regression
coverage for this post-gate approval evidence.

The final response Date header corresponds to `2026-08-22T13:21:24+09:00`,
3,065 seconds after the prior authorized response Date header. Exact client
request-start timing is `UNVERIFIED`. The final attempt was executed at the
user's explicit request and returned HTTP 200 with the same 1,657-byte body and SHA-256
`c57a3e8c11f0b414f430f54cda8874b32d4b495eb0ea33db4c33da7640cc58f8`
as the prior generic application-error response. HTTP access therefore did not
count as success, and the sole measurement question—whether HTML exposes clause
content absent from the successful XML response—was not reached.

- transport evidence: `raw/body-probe-2025-227-html-final.headers.txt`, lines
  1, 2, 8-9, 13, and 14
- elapsed-time evidence:
  `raw/body-probe-2025-227-html-authorized.headers.txt`, line 2
  (`03:30:19 GMT`), and
  `raw/body-probe-2025-227-html-final.headers.txt`, line 2
  (`04:21:24 GMT`); difference `3,065 seconds`
- response evidence:
  `raw/body-probe-2025-227-html-final.response.html`, line 21 and SHA-256 above

Because the two response Date headers are only 3,065 seconds apart, the planned
hours-long interval was not satisfied. This attempt does not exclude approval
propagation delay. It also does not distinguish request
parameter or endpoint mismatch from provider instability. No requests remain
authorized, and the architecture decision remains deferred.
