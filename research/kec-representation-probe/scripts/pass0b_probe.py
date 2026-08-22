"""Fail-closed contracts for the KEC representation Pass 0b probe.

This module is research-only.  It uses no project package and keeps no
mutable module-level state.  Synthetic callers and real evidence acquisition
remain separate: these functions classify supplied observations but never
turn fixtures, parser failures, or missing values into source facts.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from typing import Any


EVIDENCE_STATUSES = frozenset(("OBSERVED", "UNVERIFIED", "NOT_ATTEMPTED"))
PASS0A_FACT_NAMES = (
    "historical_record_exists",
    "revision_specific_id_exists",
    "body_retrieval_succeeds",
    "response_identifies_2024_749",
    "body_content_available",
    "no_silent_current_substitution",
)
TRANSIENT_BLOCK_REASON_CLASSES = frozenset(
    (
        "TRANSIENT_SERVICE_OUTAGE",
        "TRANSIENT_NETWORK_UNAVAILABLE",
        "TRANSIENT_API_CREDENTIALS_UNAVAILABLE",
        "TRANSIENT_BODY_FETCH_FAILURE",
        "TRANSIENT_UNVERIFIED_EVIDENCE",
    )
)
STRUCTURAL_BLOCK_REASON_CLASSES = frozenset(
    (
        "STRUCTURAL_RECORD_ABSENCE",
        "STRUCTURAL_ID_ABSENCE",
        "STRUCTURAL_BODY_FIELD_ABSENCE",
        "STRUCTURAL_CURRENT_REVISION_SUBSTITUTION",
    )
)
C_PROVENANCE_FIELDS = (
    "revision",
    "origin",
    "local_identity",
    "source_relationship",
    "task_baseline_binding",
)
MANIFEST_TOP_LEVEL_FIELDS = frozenset(
    ("git_head", "runtime_tool_versions", "sources")
)
MANIFEST_SOURCE_FIELDS = frozenset(
    (
        "source_role",
        "revision",
        "issuer_or_source",
        "acquisition_method",
        "source_url",
        "canonical_local_path",
        "sha256",
        "acquisition_timestamp",
        "parser_or_script",
        "evidence_status",
    )
)
CLAUSE_OBSERVATION_VALUES = frozenset(("TRUE", "FALSE", "INCONCLUSIVE"))
DISCREPANCY_CLASSES = frozenset(
    (
        "NONE",
        "LAYOUT_ONLY",
        "TYPOGRAPHIC_NORMALIZATION",
        "EDITORIAL_NORMALIZATION",
        "SUBSTANTIVE",
        "UNVERIFIED",
    )
)
HUMAN_REVIEW_FIELDS = (
    "extraction_path_asymmetry",
    "generalization_warning",
    "candidate_selection_bias",
)


def _is_nonblank(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _unverified(reason: str) -> dict[str, Any]:
    return {
        "status": "UNVERIFIED",
        "observation": reason,
        "reason": reason,
    }


def _is_positive_observation(claim: Any) -> bool:
    if not isinstance(claim, Mapping):
        return False
    try:
        validate_claim(claim)
    except (TypeError, ValueError):
        return False
    if claim.get("status") != "OBSERVED":
        return False
    value = claim.get("value")
    if value is False or value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    return True


def _is_observed_true(claim: Any) -> bool:
    return _is_positive_observation(claim) and claim.get("value") is True


def _is_observed_false(claim: Any) -> bool:
    if not isinstance(claim, Mapping):
        return False
    try:
        validate_claim(claim)
    except (TypeError, ValueError):
        return False
    return claim.get("status") == "OBSERVED" and claim.get("value") is False


def _is_observed_nonblank_text(claim: Any) -> bool:
    return _is_positive_observation(claim) and _is_nonblank(claim.get("value"))


def _is_observed_sha256(claim: Any) -> bool:
    if not _is_positive_observation(claim):
        return False
    try:
        _validate_sha256(claim.get("value"))
    except ValueError:
        return False
    return True


def validate_claim(claim: Mapping[str, Any]) -> None:
    """Reject claims that cannot satisfy the global evidence discipline."""

    if not isinstance(claim, Mapping):
        raise TypeError("evidence claim must be a mapping")

    status = claim.get("status")
    if not isinstance(status, str):
        raise TypeError("evidence status must be exactly one string")
    if status not in EVIDENCE_STATUSES:
        raise ValueError(f"unsupported evidence status: {status}")
    if not _is_nonblank(claim.get("observation")):
        raise ValueError(f"{status} claim requires a nonblank observation")

    if status == "OBSERVED":
        if not _is_nonblank(claim.get("evidence_path")):
            raise ValueError("OBSERVED claim requires an evidence file path")
        if not _is_nonblank(claim.get("locator")):
            raise ValueError("OBSERVED claim requires a narrow evidence locator")


def run_phase1_gate(
    *,
    facts: Mapping[str, Mapping[str, Any]],
    failure_kind: str | None = None,
    block_reason_class: str | None = None,
    continue_after_phase1: Callable[[], Any],
) -> dict[str, Any]:
    """Stop before Phase 2 and distinguish retryable from structural failure."""

    unresolved = tuple(
        name
        for name in PASS0A_FACT_NAMES
        if not _is_observed_true(facts.get(name))
    )
    if unresolved:
        if failure_kind is None:
            raise TypeError("failure_kind is required when Phase 1 is unresolved")
        if not isinstance(failure_kind, str):
            raise TypeError("failure_kind must be TRANSIENT or STRUCTURAL")
        if failure_kind not in ("TRANSIENT", "STRUCTURAL"):
            raise ValueError("failure_kind must be TRANSIENT or STRUCTURAL")
        if block_reason_class is None:
            raise TypeError("block_reason_class is required when Phase 1 is unresolved")
        if not isinstance(block_reason_class, str):
            raise TypeError("block_reason_class must be text")

        allowed_reasons = (
            TRANSIENT_BLOCK_REASON_CLASSES
            if failure_kind == "TRANSIENT"
            else STRUCTURAL_BLOCK_REASON_CLASSES
        )
        if block_reason_class not in allowed_reasons:
            raise ValueError("block_reason_class does not match failure_kind")

        if failure_kind == "STRUCTURAL" and not any(
            _is_observed_false(facts.get(name)) for name in unresolved
        ):
            raise ValueError(
                "STRUCTURAL failure requires at least one located OBSERVED false fact"
            )

        if failure_kind == "TRANSIENT":
            return {
                "result": "INCONCLUSIVE",
                "pass_0a": "UNVERIFIED",
                "option_1_available": "UNVERIFIED",
                "block_reason_class": block_reason_class,
                "retryable": True,
                "stop": True,
                "remaining_phases": "NOT_ATTEMPTED",
                "unresolved_facts": unresolved,
            }

        return {
            "result": "BLOCKED",
            "pass_0a": "BLOCKED",
            "option_1_available": "NO",
            "block_reason_class": block_reason_class,
            "retryable": False,
            "stop": True,
            "remaining_phases": "NOT_ATTEMPTED",
            "unresolved_facts": unresolved,
        }

    continuation_result = continue_after_phase1()
    return {
        "result": "PASS",
        "pass_0a": "COMPLETE",
        "option_1_available": "YES",
        "stop": False,
        "remaining_phases": "AVAILABLE",
        "continuation_result": continuation_result,
    }


def run_c_provenance_gate(
    *,
    candidates: Sequence[Mapping[str, Any]],
    extract_c: Callable[[Mapping[str, Any]], Any],
    continue_ab: Callable[[], Any],
) -> dict[str, Any]:
    """Use C only when one candidate has complete direct provenance evidence."""

    eligible = tuple(
        candidate
        for candidate in candidates
        if _is_nonblank(candidate.get("path"))
        and all(
            _is_observed_nonblank_text(candidate.get(field))
            for field in C_PROVENANCE_FIELDS
        )
        and _is_observed_sha256(candidate.get("sha256"))
    )

    if len(eligible) != 1:
        continue_ab()
        return {
            "c_input_status": "UNVERIFIED",
            "c_status": "NOT_ATTEMPTED",
            "reason": "exact Task90/93 PDF input provenance was not uniquely established",
        }

    selected = eligible[0]
    try:
        extraction_result = extract_c(selected)
    except Exception as error:
        continue_ab()
        return {
            "c_input_status": "OBSERVED",
            "c_status": "UNVERIFIED",
            "path": selected["path"],
            "reason": f"C extraction failed: {type(error).__name__}",
        }

    continue_ab()
    try:
        validate_claim(extraction_result)
    except (TypeError, ValueError):
        return {
            "c_input_status": "OBSERVED",
            "c_status": "UNVERIFIED",
            "path": selected["path"],
            "reason": "C extraction did not produce a valid evidence claim",
        }
    if extraction_result.get("status") != "OBSERVED":
        return {
            "c_input_status": "OBSERVED",
            "c_status": "UNVERIFIED",
            "path": selected["path"],
            "reason": extraction_result.get("reason")
            or "C extraction did not produce OBSERVED evidence",
            "extraction_result": extraction_result,
        }
    return {
        "c_input_status": "OBSERVED",
        "c_status": "OBSERVED",
        "path": selected["path"],
        "extraction_result": extraction_result,
    }


def _candidate_score(candidate: Mapping[str, Any]) -> int:
    criteria = candidate.get("criteria")
    if not isinstance(criteria, Mapping):
        return 0
    return sum(
        1
        for name in ("C1", "C2", "C3", "C4")
        if _is_observed_true(criteria.get(name))
    )


def _candidate_identifier(candidate: Mapping[str, Any]) -> str:
    identifier = candidate.get("identifier")
    if not _is_nonblank(identifier):
        raise ValueError("candidate identifier must be nonblank")
    return identifier.strip()


def rank_and_select_candidate(
    *,
    candidates: Sequence[Mapping[str, Any]],
    confirm_a: Callable[[str], Mapping[str, Any]],
    scan_source: str = "B2",
    scan_scope: str = "bounded B2 scan using observed C1-C4 predicates",
) -> dict[str, Any]:
    """Rank B2 candidates deterministically and inspect no more than three in A."""

    if not _is_nonblank(scan_source) or scan_source.strip() != "B2":
        raise ValueError("candidate scan source must be exactly B2")
    if not _is_nonblank(scan_scope):
        raise ValueError("candidate scan scope must be nonblank")

    scored = tuple(
        sorted(
            (
                (_candidate_identifier(item), _candidate_score(item), item)
                for item in candidates
            ),
            key=lambda row: (-row[1], row[0]),
        )
    )
    top_three = scored[:3]
    scores = {identifier: score for identifier, score, _ in scored}

    selected_row = None
    for identifier, score, item in top_three:
        confirmation = confirm_a(identifier)
        if _is_observed_true(confirmation):
            selected_row = (identifier, score, item)
            break

    common = {
        "ranked_top_three": tuple(identifier for identifier, _, _ in top_three),
        "scores": scores,
        "scan_source": scan_source.strip(),
        "scan_scope": scan_scope.strip(),
    }
    if selected_row is None:
        return {
            **common,
            "target_clause": "UNVERIFIED",
            "result": "INCONCLUSIVE",
            "stop": True,
            "all_four_satisfied": False,
            "missing_criteria": tuple(),
            "notes": ("TARGET_CLAUSE_UNVERIFIED",),
        }

    identifier, _, selected = selected_row
    criteria = selected.get("criteria")
    missing = tuple(
        name
        for name in ("C1", "C2", "C3", "C4")
        if not isinstance(criteria, Mapping)
        or not _is_observed_true(criteria.get(name))
    )
    notes = (
        tuple()
        if not missing
        else ("NO_SINGLE_CLAUSE_SATISFIES_ALL_4",)
    )
    return {
        **common,
        "target_clause": identifier,
        "result": "PASS",
        "stop": False,
        "all_four_satisfied": not missing,
        "missing_criteria": list(missing),
        "notes": notes,
    }


def _require_manifest_keys(mapping: Mapping[str, Any], required: frozenset[str]) -> None:
    missing = required.difference(mapping)
    if missing:
        raise ValueError(f"manifest fields missing: {', '.join(sorted(missing))}")


def _validate_sha256(value: Any) -> None:
    if not _is_nonblank(value) or re.fullmatch(r"[0-9a-fA-F]{64}", value) is None:
        raise ValueError("observed source SHA-256 must be 64 hexadecimal characters")


def _validate_timestamp(value: Any) -> None:
    if not _is_nonblank(value):
        raise ValueError("observed source acquisition timestamp is required")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("acquisition timestamp must be ISO-8601") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("acquisition timestamp must include a timezone")


def validate_manifest(manifest: Mapping[str, Any]) -> None:
    """Validate required identity keys without inventing unresolved values."""

    if not isinstance(manifest, Mapping):
        raise TypeError("manifest must be a mapping")
    _require_manifest_keys(manifest, MANIFEST_TOP_LEVEL_FIELDS)

    git_head = manifest.get("git_head")
    if not _is_nonblank(git_head) or re.fullmatch(r"[0-9a-fA-F]{40}", git_head) is None:
        raise ValueError("manifest git_head must be a 40-character SHA")
    versions = manifest.get("runtime_tool_versions")
    if not isinstance(versions, Mapping) or not versions:
        raise ValueError("runtime_tool_versions must be a non-empty mapping")
    if any(not _is_nonblank(name) or not _is_nonblank(value) for name, value in versions.items()):
        raise ValueError("runtime_tool_versions keys and values must be nonblank text")
    sources = manifest.get("sources")
    if not isinstance(sources, Sequence) or isinstance(sources, (str, bytes)) or not sources:
        raise ValueError("manifest sources must be a non-empty sequence")

    for source in sources:
        if not isinstance(source, Mapping):
            raise TypeError("each manifest source must be a mapping")
        _require_manifest_keys(source, MANIFEST_SOURCE_FIELDS)
        if not _is_nonblank(source.get("source_role")):
            raise ValueError("source_role must be nonblank")

        status = source.get("evidence_status")
        if status not in EVIDENCE_STATUSES:
            raise ValueError("manifest source evidence_status is invalid")
        if status != "OBSERVED":
            if not _is_nonblank(source.get("reason")):
                raise ValueError("unresolved manifest source requires a reason")
            for field in (
                "revision",
                "issuer_or_source",
                "acquisition_method",
                "source_url",
                "canonical_local_path",
                "parser_or_script",
            ):
                value = source.get(field)
                if value is not None and not _is_nonblank(value):
                    raise ValueError(
                        f"provided unresolved manifest field must be nonblank: {field}"
                    )
            if source.get("sha256") is not None:
                _validate_sha256(source.get("sha256"))
            if source.get("acquisition_timestamp") is not None:
                _validate_timestamp(source.get("acquisition_timestamp"))
            continue

        for field in (
            "revision",
            "issuer_or_source",
            "acquisition_method",
            "canonical_local_path",
            "parser_or_script",
        ):
            if not _is_nonblank(source.get(field)):
                raise ValueError(f"observed manifest source requires {field}")

        method = source["acquisition_method"].lower()
        if any(token in method for token in ("http", "api", "url", "download")):
            if not _is_nonblank(source.get("source_url")):
                raise ValueError("remote acquisition requires source_url")

        _validate_sha256(source.get("sha256"))
        _validate_timestamp(source.get("acquisition_timestamp"))


def validate_observation_value(observation_id: str, value: str) -> None:
    """Keep O1-O3 truth values separate from O4 discrepancy classes."""

    if observation_id in ("O1", "O2", "O3"):
        if value not in CLAUSE_OBSERVATION_VALUES:
            raise ValueError(f"{observation_id} requires TRUE/FALSE/INCONCLUSIVE")
        return
    if observation_id == "O4":
        if value not in DISCREPANCY_CLASSES:
            raise ValueError("O4 requires a same-revision discrepancy class")
        return
    raise ValueError(f"unknown observation identifier: {observation_id}")


def validate_human_review_fields(metadata: Mapping[str, Any]) -> None:
    """Check presence only; meaning and adequacy require human review."""

    if not isinstance(metadata, Mapping):
        raise TypeError("human-review metadata must be a mapping")
    for field in HUMAN_REVIEW_FIELDS:
        if not _is_nonblank(metadata.get(field)):
            raise ValueError(f"human-review field must be nonblank: {field}")


def observe_clause_from_xml(
    *,
    xml_bytes: bytes,
    clause_identifier: str,
    evidence_path: str,
) -> dict[str, Any]:
    """Locate an exact clause token and return its direct XML text-node path."""

    if not _is_nonblank(clause_identifier):
        return _unverified("target clause identifier is missing")
    if not _is_nonblank(evidence_path):
        return _unverified("XML evidence path is missing")

    try:
        root = ET.fromstring(xml_bytes)
    except (ET.ParseError, TypeError, ValueError) as error:
        return _unverified(f"XML could not be parsed: {type(error).__name__}")

    token = re.compile(
        rf"(?<![0-9.]){re.escape(clause_identifier.strip())}(?![0-9.])"
    )

    def local_name(tag: Any) -> str:
        if not isinstance(tag, str):
            return "node"
        return tag.rsplit("}", 1)[-1]

    def text_nodes(element: ET.Element, path: str):
        if element.text is not None:
            yield element.text, f"{path}/text()"

        sibling_counts: dict[str, int] = {}
        for child in element:
            name = local_name(child.tag)
            sibling_counts[name] = sibling_counts.get(name, 0) + 1
            child_path = f"{path}/{name}[{sibling_counts[name]}]"
            yield from text_nodes(child, child_path)
            if child.tail is not None:
                yield child.tail, f"{child_path}/tail()"

    root_path = f"/{local_name(root.tag)}[1]"
    for text, locator in text_nodes(root, root_path):
        if token.search(text):
            return {
                "status": "OBSERVED",
                "value": True,
                "observation": "exact clause identifier occurs in a parsed XML text node",
                "evidence_path": evidence_path,
                "locator": locator,
            }
    return _unverified(
        "target clause was not located; this does not establish structural absence"
    )


def observe_law_body(
    *,
    response_bytes: bytes | None,
    expected_revision: str,
    evidence_path: str,
) -> dict[str, Any]:
    """Verify the response revision and distinguish empty from absent body XML."""

    if not response_bytes:
        return _unverified("law.go.kr API returned no response body")
    if not _is_nonblank(expected_revision):
        return _unverified("expected revision is missing")
    if not _is_nonblank(evidence_path):
        return _unverified("law.go.kr response evidence path is missing")

    try:
        root = ET.fromstring(response_bytes)
    except (ET.ParseError, TypeError, ValueError) as error:
        return _unverified(
            f"law.go.kr response could not be parsed: {type(error).__name__}"
        )

    def local_name(tag: Any) -> str:
        if not isinstance(tag, str):
            return "node"
        return tag.rsplit("}", 1)[-1]

    if local_name(root.tag) != "AdmRulService":
        return _unverified("response root is not AdmRulService")

    def direct_children_with_paths(
        parent: ET.Element, parent_path: str
    ) -> list[tuple[ET.Element, str]]:
        sibling_counts: dict[str, int] = {}
        located: list[tuple[ET.Element, str]] = []
        for child in parent:
            name = local_name(child.tag)
            sibling_counts[name] = sibling_counts.get(name, 0) + 1
            located.append(
                (child, f"{parent_path}/{name}[{sibling_counts[name]}]")
            )
        return located

    root_path = f"/{local_name(root.tag)}[1]"
    root_children = direct_children_with_paths(root, root_path)
    basic_info = [
        (element, path)
        for element, path in root_children
        if local_name(element.tag) == "행정규칙기본정보"
    ]
    if len(basic_info) != 1:
        return _unverified(
            "response does not contain exactly one 행정규칙기본정보 element"
        )

    basic_info_element, basic_info_path = basic_info[0]
    revision_elements = [
        (element, path)
        for element, path in direct_children_with_paths(
            basic_info_element, basic_info_path
        )
        if local_name(element.tag) == "발령번호"
    ]
    if len(revision_elements) != 1:
        return _unverified("response does not contain exactly one 발령번호 field")

    revision_element, revision_path = revision_elements[0]
    actual_revision = (revision_element.text or "").strip()
    normalized_expected_revision = expected_revision.strip()
    if actual_revision != normalized_expected_revision:
        return _unverified(
            "response 발령번호 does not match the expected revision; "
            "silent substitution cannot be excluded"
        )

    body_elements = [
        (element, path)
        for element, path in root_children
        if local_name(element.tag) == "조문내용"
    ]
    if not body_elements:
        return _unverified(
            "조문내용 element is absent; tag absence is not an observed empty body"
        )
    if len(body_elements) != 1:
        return _unverified("response contains multiple 조문내용 elements")

    body_element, body_path = body_elements[0]
    body_text = "".join(body_element.itertext()).strip()
    child_count = len(body_element)
    text_chars = len(body_text)
    body_available = child_count > 0 or text_chars > 0
    body_state = "nonempty" if body_available else "explicitly present but empty"

    return {
        "status": "OBSERVED",
        "value": body_available,
        "observation": (
            "response self-identifies as the expected revision and its "
            f"조문내용 element is {body_state}"
        ),
        "evidence_path": evidence_path,
        "locator": (
            f"{revision_path} (text={actual_revision!r}); "
            f"{body_path} (child_count={child_count}; text_chars={text_chars})"
        ),
    }
