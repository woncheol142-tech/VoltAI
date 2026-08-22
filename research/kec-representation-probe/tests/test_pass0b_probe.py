"""Red contracts for the KEC representation Pass 0b research probe.

These tests deliberately use only Python's standard library.  Inputs are
synthetic contract data except for the explicitly named retained-response
integration regression.  Derived mutations in that regression remain test
data and must never be cited as OBSERVED source facts.

The implementation target intentionally does not exist during Step 2:
``research/kec-representation-probe/scripts/pass0b_probe.py``.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import itertools
import json
import re
import sys
import types
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import Mock


RESEARCH_ROOT = Path(__file__).resolve().parents[1]
IMPLEMENTATION_PATH = RESEARCH_ROOT / "scripts" / "pass0b_probe.py"
ACTUAL_MANIFEST_PATH = RESEARCH_ROOT / "manifest.json"
RESULT_REPORT_PATH = RESEARCH_ROOT / "result" / "pass0b-table.md"
PHASE0_INVENTORY_PATH = RESEARCH_ROOT / "extracted" / "phase0-inventory.json"

EVIDENCE_STATUSES = ("OBSERVED", "UNVERIFIED", "NOT_ATTEMPTED")
CLAUSE_OBSERVATION_VALUES = ("TRUE", "FALSE", "INCONCLUSIVE")
DISCREPANCY_CLASSES = (
    "NONE",
    "LAYOUT_ONLY",
    "TYPOGRAPHIC_NORMALIZATION",
    "EDITORIAL_NORMALIZATION",
    "SUBSTANTIVE",
    "UNVERIFIED",
)
PASS0A_FACT_NAMES = (
    "historical_record_exists",
    "revision_specific_id_exists",
    "body_retrieval_succeeds",
    "response_identifies_2024_749",
    "body_content_available",
    "no_silent_current_substitution",
)


def load_probe():
    """Load a fresh implementation module for every test."""

    if not IMPLEMENTATION_PATH.is_file():
        raise AssertionError(
            "RED: missing research implementation "
            "research/kec-representation-probe/scripts/pass0b_probe.py"
        )

    spec = importlib.util.spec_from_file_location("pass0b_probe", IMPLEMENTATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError(f"RED: cannot load {IMPLEMENTATION_PATH}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def observed(value=True, *, suffix="fact"):
    return {
        "status": "OBSERVED",
        "value": value,
        "observation": f"synthetic {suffix}",
        "evidence_path": f"raw/synthetic-{suffix}.json",
        "locator": f"/synthetic/{suffix}",
    }


def unverified(reason="synthetic evidence is insufficient"):
    return {
        "status": "UNVERIFIED",
        "observation": reason,
        "reason": reason,
    }


def complete_pass0a_facts():
    return {name: observed(True, suffix=name) for name in PASS0A_FACT_NAMES}


def c_candidate(
    *,
    path="project-files/synthetic-kec.pdf",
    revision=None,
    origin=None,
    local_identity=None,
    sha256=None,
    source_relationship=None,
    task_baseline_binding=None,
):
    return {
        "path": path,
        "revision": revision
        if revision is not None
        else observed("2024-749", suffix="c-revision"),
        "origin": origin
        if origin is not None
        else observed("synthetic ministry source", suffix="c-origin"),
        "local_identity": local_identity
        if local_identity is not None
        else observed("synthetic identity", suffix="c-identity"),
        "sha256": sha256
        if sha256 is not None
        else observed("a" * 64, suffix="c-sha256"),
        "source_relationship": source_relationship
        if source_relationship is not None
        else observed(
            "synthetic relationship to evaluated source", suffix="c-relationship"
        ),
        "task_baseline_binding": task_baseline_binding
        if task_baseline_binding is not None
        else observed("synthetic Task90/93 baseline binding", suffix="c-baseline"),
    }


def candidate(identifier, statuses):
    assert len(statuses) == 4
    return {
        "identifier": identifier,
        "criteria": {
            name: (
                observed(True, suffix=f"candidate-{identifier}-{name}")
                if status == "OBSERVED"
                else {"status": status, "observation": f"synthetic {name}"}
            )
            for name, status in zip(("C1", "C2", "C3", "C4"), statuses)
        },
    }


def valid_manifest():
    return {
        "git_head": "a" * 40,
        "runtime_tool_versions": {"python": "3.x synthetic"},
        "sources": [
            {
                "source_role": "A",
                "revision": "2024-749",
                "issuer_or_source": "synthetic issuer",
                "acquisition_method": "existing-local-artifact",
                "source_url": None,
                "canonical_local_path": "/synthetic/source.hwpx",
                "sha256": "b" * 64,
                "acquisition_timestamp": "2026-08-22T00:00:00+09:00",
                "parser_or_script": "scripts/pass0b_probe.py",
                "evidence_status": "OBSERVED",
            }
        ],
    }


class Phase1HardGateContractTests(unittest.TestCase):
    def test_structural_absence_blocks_and_rules_out_option1(self):
        probe = load_probe()
        facts = complete_pass0a_facts()
        facts["body_content_available"] = observed(
            False, suffix="structural-body-field-absence"
        )
        continue_after_phase1 = Mock(
            side_effect=AssertionError("Phase 2+ must not run after the hard gate")
        )

        result = probe.run_phase1_gate(
            facts=facts,
            failure_kind="STRUCTURAL",
            block_reason_class="STRUCTURAL_BODY_FIELD_ABSENCE",
            continue_after_phase1=continue_after_phase1,
        )

        self.assertEqual(result["result"], "BLOCKED")
        self.assertEqual(result["pass_0a"], "BLOCKED")
        self.assertEqual(result["option_1_available"], "NO")
        self.assertEqual(
            result["block_reason_class"], "STRUCTURAL_BODY_FIELD_ABSENCE"
        )
        self.assertFalse(result["retryable"])
        self.assertTrue(result["stop"])
        self.assertEqual(result["remaining_phases"], "NOT_ATTEMPTED")
        continue_after_phase1.assert_not_called()

    def test_failure_kind_and_reason_class_pair_must_be_valid(self):
        probe = load_probe()
        facts = complete_pass0a_facts()
        facts["body_retrieval_succeeds"] = unverified("synthetic fetch failure")

        with self.assertRaises(TypeError):
            probe.run_phase1_gate(
                facts=facts,
                failure_kind=None,
                block_reason_class="TRANSIENT_SERVICE_OUTAGE",
                continue_after_phase1=Mock(),
            )

        for failure_kind in ("", "MAYBE", "BLOCKED"):
            with self.subTest(failure_kind=failure_kind):
                with self.assertRaises(ValueError):
                    probe.run_phase1_gate(
                        facts=facts,
                        failure_kind=failure_kind,
                        block_reason_class="TRANSIENT_SERVICE_OUTAGE",
                        continue_after_phase1=Mock(),
                    )

        for failure_kind, reason_class in (
            ("TRANSIENT", "STRUCTURAL_BODY_FIELD_ABSENCE"),
            ("STRUCTURAL", "TRANSIENT_SERVICE_OUTAGE"),
        ):
            with self.subTest(
                failure_kind=failure_kind,
                block_reason_class=reason_class,
            ):
                with self.assertRaises(ValueError):
                    probe.run_phase1_gate(
                        facts=facts,
                        failure_kind=failure_kind,
                        block_reason_class=reason_class,
                        continue_after_phase1=Mock(),
                    )

    def test_structural_requires_observed_false_evidence(self):
        probe = load_probe()
        facts = complete_pass0a_facts()
        facts["body_content_available"] = unverified("synthetic response absent")

        with self.assertRaises(ValueError):
            probe.run_phase1_gate(
                facts=facts,
                failure_kind="STRUCTURAL",
                block_reason_class="STRUCTURAL_BODY_FIELD_ABSENCE",
                continue_after_phase1=Mock(),
            )

    def test_phase1_rejects_silent_current_revision_substitution(self):
        probe = load_probe()
        facts = complete_pass0a_facts()
        facts["response_identifies_2024_749"] = observed(
            False, suffix="response-identifies-2024-749"
        )
        facts["no_silent_current_substitution"] = observed(
            False, suffix="silent-substitution"
        )
        continue_after_phase1 = Mock()

        result = probe.run_phase1_gate(
            facts=facts,
            failure_kind="STRUCTURAL",
            block_reason_class="STRUCTURAL_CURRENT_REVISION_SUBSTITUTION",
            continue_after_phase1=continue_after_phase1,
        )

        self.assertEqual(result["result"], "BLOCKED")
        self.assertEqual(result["pass_0a"], "BLOCKED")
        self.assertEqual(result["option_1_available"], "NO")
        continue_after_phase1.assert_not_called()

    def test_phase1_complete_invokes_continuation_once(self):
        probe = load_probe()
        continue_after_phase1 = Mock(return_value={"phase": 2})

        result = probe.run_phase1_gate(
            facts=complete_pass0a_facts(),
            continue_after_phase1=continue_after_phase1,
        )

        self.assertEqual(result["pass_0a"], "COMPLETE")
        self.assertEqual(result["option_1_available"], "YES")
        self.assertFalse(result["stop"])
        continue_after_phase1.assert_called_once_with()

    def test_phase1_locator_free_observed_claim_cannot_pass_the_gate(self):
        probe = load_probe()
        facts = complete_pass0a_facts()
        facts["historical_record_exists"] = {
            "status": "OBSERVED",
            "value": True,
            "observation": "synthetic but unlocated claim",
        }
        continue_after_phase1 = Mock()

        result = probe.run_phase1_gate(
            facts=facts,
            failure_kind="TRANSIENT",
            block_reason_class="TRANSIENT_UNVERIFIED_EVIDENCE",
            continue_after_phase1=continue_after_phase1,
        )

        self.assertEqual(result["result"], "INCONCLUSIVE")
        self.assertEqual(result["pass_0a"], "UNVERIFIED")
        self.assertEqual(result["option_1_available"], "UNVERIFIED")
        self.assertIn("historical_record_exists", result["unresolved_facts"])
        continue_after_phase1.assert_not_called()


class CProvenanceGateContractTests(unittest.TestCase):
    def test_c_gate_rejects_each_unproven_identity_dimension_but_ab_continues(self):
        probe = load_probe()
        cases = {
            "revision_unknown_despite_filename": c_candidate(
                path="project-files/KEC-2024-749.pdf",
                revision=unverified("filename is not independent revision evidence"),
            ),
            "revision_is_not_text": c_candidate(
                revision=observed(2024749, suffix="numeric-c-revision")
            ),
            "origin_ambiguous": c_candidate(
                origin=unverified("origin is ambiguous")
            ),
            "local_identity_missing": c_candidate(
                local_identity=unverified("local artifact identity is missing")
            ),
            "sha256_missing": c_candidate(
                sha256=unverified("SHA-256 is missing")
            ),
            "sha256_malformed": c_candidate(
                sha256=observed("not-a-sha256", suffix="malformed-c-sha256")
            ),
            "source_relationship_missing": c_candidate(
                source_relationship=unverified("source relationship is missing")
            ),
            "task_baseline_binding_missing": c_candidate(
                task_baseline_binding=unverified(
                    "Task90/93 baseline relationship is missing"
                )
            ),
        }

        for name, item in cases.items():
            with self.subTest(name=name):
                extract_c = Mock(
                    side_effect=AssertionError("ineligible C must not be extracted")
                )
                continue_ab = Mock()
                result = probe.run_c_provenance_gate(
                    candidates=[item],
                    extract_c=extract_c,
                    continue_ab=continue_ab,
                )
                self.assertEqual(result["c_status"], "NOT_ATTEMPTED")
                extract_c.assert_not_called()
                continue_ab.assert_called_once_with()

    def test_c_gate_rejects_multiple_unbound_pdfs(self):
        probe = load_probe()
        candidates = [
            c_candidate(
                path="project-files/synthetic-one.pdf",
                task_baseline_binding=unverified("no binding evidence"),
            ),
            c_candidate(
                path="project-files/synthetic-two.pdf",
                task_baseline_binding=unverified("no binding evidence"),
            ),
        ]
        extract_c = Mock()
        continue_ab = Mock()

        result = probe.run_c_provenance_gate(
            candidates=candidates,
            extract_c=extract_c,
            continue_ab=continue_ab,
        )

        self.assertEqual(result["c_status"], "NOT_ATTEMPTED")
        extract_c.assert_not_called()
        continue_ab.assert_called_once_with()

    def test_c_gate_accepts_one_fully_evidenced_baseline(self):
        probe = load_probe()
        eligible = c_candidate()
        extraction_claim = observed(True, suffix="c-extraction")
        extract_c = Mock(return_value=extraction_claim)
        continue_ab = Mock()

        result = probe.run_c_provenance_gate(
            candidates=[eligible],
            extract_c=extract_c,
            continue_ab=continue_ab,
        )

        self.assertEqual(result["c_status"], "OBSERVED")
        self.assertEqual(result["path"], eligible["path"])
        extract_c.assert_called_once_with(eligible)
        continue_ab.assert_called_once_with()

    def test_c_extraction_failure_or_unverified_output_never_blocks_ab(self):
        probe = load_probe()
        eligible = c_candidate()

        cases = (
            Mock(return_value=unverified("synthetic C extraction was inconclusive")),
            Mock(side_effect=ValueError("synthetic C parser failure")),
        )
        for extract_c in cases:
            with self.subTest(side_effect=type(extract_c.side_effect).__name__):
                continue_ab = Mock()
                result = probe.run_c_provenance_gate(
                    candidates=[eligible],
                    extract_c=extract_c,
                    continue_ab=continue_ab,
                )
                self.assertEqual(result["c_input_status"], "OBSERVED")
                self.assertEqual(result["c_status"], "UNVERIFIED")
                continue_ab.assert_called_once_with()


class CandidateSelectionContractTests(unittest.TestCase):
    def setUp(self):
        self.candidates = [
            candidate("241.17.3", ("OBSERVED",) * 4),
            candidate(
                "241.18.1",
                ("OBSERVED", "OBSERVED", "OBSERVED", "UNVERIFIED"),
            ),
            candidate(
                "242.1.2",
                ("OBSERVED", "OBSERVED", "OBSERVED", "NOT_ATTEMPTED"),
            ),
            candidate(
                "242.2.1",
                ("OBSERVED", "OBSERVED", "UNVERIFIED", "UNVERIFIED"),
            ),
            candidate(
                "243.1.1",
                ("OBSERVED", "UNVERIFIED", "UNVERIFIED", "UNVERIFIED"),
            ),
        ]

    def test_a_side_confirmation_never_exceeds_ranked_top_three(self):
        probe = load_probe()
        inspected = []

        def confirm_a(identifier):
            inspected.append(identifier)
            return unverified("corresponding A-side clause was not established")

        result = probe.rank_and_select_candidate(
            candidates=self.candidates,
            confirm_a=confirm_a,
        )

        self.assertEqual(inspected, ["241.17.3", "241.18.1", "242.1.2"])
        self.assertLessEqual(len(inspected), 3)
        self.assertEqual(result["target_clause"], "UNVERIFIED")
        self.assertEqual(result["result"], "INCONCLUSIVE")
        self.assertTrue(result["stop"])

    def test_ranking_and_selection_are_deterministic_across_input_permutations(self):
        probe = load_probe()
        selections = set()
        rankings = set()

        def confirm_a(identifier):
            if identifier in {"241.17.3", "241.18.1"}:
                return observed(True, suffix=f"a-confirm-{identifier}")
            return unverified("not established in A")

        for permuted in itertools.permutations(self.candidates):
            result = probe.rank_and_select_candidate(
                candidates=list(permuted),
                confirm_a=confirm_a,
            )
            selections.add(result["target_clause"])
            rankings.add(tuple(result["ranked_top_three"]))

        self.assertEqual(selections, {"241.17.3"})
        self.assertEqual(
            rankings,
            {("241.17.3", "241.18.1", "242.1.2")},
        )

    def test_only_observed_criteria_contribute_to_score(self):
        probe = load_probe()
        result = probe.rank_and_select_candidate(
            candidates=self.candidates,
            confirm_a=lambda identifier: observed(
                True, suffix=f"a-confirm-{identifier}"
            ),
        )

        self.assertEqual(result["scores"]["241.17.3"], 4)
        self.assertEqual(result["scores"]["241.18.1"], 3)
        self.assertEqual(result["scores"]["242.1.2"], 3)
        self.assertEqual(result["scores"]["242.2.1"], 2)
        self.assertEqual(result["scores"]["243.1.1"], 1)

    def test_false_or_unlocated_observed_criteria_do_not_contribute_to_score(self):
        probe = load_probe()
        observed_false = candidate("300.1", ("OBSERVED",) * 4)
        observed_false["criteria"]["C4"] = observed(
            False, suffix="criterion-observed-false"
        )
        unlocated = candidate("300.2", ("OBSERVED",) * 4)
        del unlocated["criteria"]["C4"]["locator"]

        result = probe.rank_and_select_candidate(
            candidates=[observed_false, unlocated],
            confirm_a=lambda identifier: observed(
                True, suffix=f"a-confirm-{identifier}"
            ),
        )

        self.assertEqual(result["scores"]["300.1"], 3)
        self.assertEqual(result["scores"]["300.2"], 3)
        self.assertEqual(result["target_clause"], "300.1")
        self.assertIs(result["all_four_satisfied"], False)
        self.assertEqual(result["missing_criteria"], ["C4"])
        self.assertIn("NO_SINGLE_CLAUSE_SATISFIES_ALL_4", result["notes"])

    def test_selection_skips_an_unverified_a_match_without_expanding_past_top_three(self):
        probe = load_probe()
        inspected = []

        def confirm_a(identifier):
            inspected.append(identifier)
            if identifier == "241.18.1":
                return observed(True, suffix="a-confirm-second-ranked")
            return unverified("A-side correspondence not established")

        result = probe.rank_and_select_candidate(
            candidates=self.candidates,
            confirm_a=confirm_a,
        )

        self.assertEqual(result["target_clause"], "241.18.1")
        self.assertEqual(inspected, ["241.17.3", "241.18.1"])
        self.assertLessEqual(len(inspected), 3)

    def test_three_of_four_selection_records_missing_criterion_and_warning(self):
        probe = load_probe()

        def confirm_a(identifier):
            if identifier == "241.18.1":
                return observed(True, suffix="a-confirm-three-of-four")
            return unverified("A-side correspondence not established")

        result = probe.rank_and_select_candidate(
            candidates=self.candidates,
            confirm_a=confirm_a,
        )

        self.assertEqual(result["target_clause"], "241.18.1")
        self.assertIs(result["all_four_satisfied"], False)
        self.assertEqual(result["missing_criteria"], ["C4"])
        self.assertIn("NO_SINGLE_CLAUSE_SATISFIES_ALL_4", result["notes"])

    def test_candidate_result_records_b2_scan_source_and_nonblank_scope(self):
        probe = load_probe()
        result = probe.rank_and_select_candidate(
            candidates=self.candidates,
            confirm_a=lambda identifier: observed(
                True, suffix=f"a-confirm-{identifier}"
            ),
            scan_source="B2",
            scan_scope="synthetic bounded scan over specified fields and predicates",
        )

        self.assertEqual(result["scan_source"], "B2")
        self.assertTrue(result["scan_scope"].strip())

    def test_candidate_scan_source_must_be_b2(self):
        probe = load_probe()
        with self.assertRaises(ValueError):
            probe.rank_and_select_candidate(
                candidates=self.candidates,
                confirm_a=lambda identifier: observed(
                    True, suffix=f"a-confirm-{identifier}"
                ),
                scan_source="A",
                scan_scope="synthetic scope",
            )


class EvidenceDisciplineContractTests(unittest.TestCase):
    def test_status_is_exactly_one_allowed_scalar(self):
        probe = load_probe()
        invalid_statuses = (
            None,
            "",
            "FALSE",
            "INFERRED",
            ["OBSERVED", "UNVERIFIED"],
        )

        for status in invalid_statuses:
            with self.subTest(status=status):
                claim = {
                    "status": status,
                    "observation": "synthetic claim",
                    "evidence_path": "raw/synthetic.json",
                    "locator": "/synthetic",
                }
                with self.assertRaises((TypeError, ValueError)):
                    probe.validate_claim(claim)

        for status in EVIDENCE_STATUSES:
            with self.subTest(valid_status=status):
                claim = {
                    "status": status,
                    "observation": "synthetic claim",
                }
                if status == "OBSERVED":
                    claim.update(
                        evidence_path="raw/synthetic.json",
                        locator="/synthetic",
                    )
                probe.validate_claim(claim)

    def test_observed_claim_requires_path_and_narrow_locator(self):
        probe = load_probe()
        complete = {
            "status": "OBSERVED",
            "observation": "synthetic structural observation",
            "evidence_path": "extracted/A-structure.json",
            "locator": "/tables/0/rows/0/cells/0",
        }
        probe.validate_claim(complete)

        for missing in ("evidence_path", "locator"):
            with self.subTest(missing=missing):
                claim = dict(complete)
                del claim[missing]
                with self.assertRaises(ValueError):
                    probe.validate_claim(claim)

        for blank in ("evidence_path", "locator"):
            with self.subTest(blank=blank):
                claim = dict(complete)
                claim[blank] = "   "
                with self.assertRaises(ValueError):
                    probe.validate_claim(claim)

    def test_unverified_and_not_attempted_require_a_nonblank_explanation(self):
        probe = load_probe()
        for status in ("UNVERIFIED", "NOT_ATTEMPTED"):
            with self.subTest(status=status):
                probe.validate_claim(
                    {"status": status, "observation": "synthetic reason"}
                )
                for missing_or_blank in (None, "", "   "):
                    claim = {"status": status}
                    if missing_or_blank is not None:
                        claim["observation"] = missing_or_blank
                    with self.assertRaises(ValueError):
                        probe.validate_claim(claim)


class ManifestContractTests(unittest.TestCase):
    def test_manifest_requires_every_common_identity_field(self):
        probe = load_probe()
        probe.validate_manifest(valid_manifest())

        top_level_fields = ("git_head", "runtime_tool_versions", "sources")
        for field in top_level_fields:
            with self.subTest(scope="top", field=field):
                manifest = valid_manifest()
                del manifest[field]
                with self.assertRaises(ValueError):
                    probe.validate_manifest(manifest)

        source_fields = (
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
        for field in source_fields:
            with self.subTest(scope="source", field=field):
                manifest = valid_manifest()
                del manifest["sources"][0][field]
                with self.assertRaises(ValueError):
                    probe.validate_manifest(manifest)

    def test_manifest_requires_remote_url_and_local_canonical_path_when_applicable(self):
        probe = load_probe()

        remote = valid_manifest()
        remote["sources"][0].update(
            acquisition_method="https-api",
            source_url="https://example.invalid/synthetic-response",
            canonical_local_path="raw/synthetic-response.xml",
        )
        probe.validate_manifest(remote)

        for field in ("source_url", "canonical_local_path"):
            with self.subTest(field=field):
                manifest = copy.deepcopy(remote)
                manifest["sources"][0][field] = "   "
                with self.assertRaises(ValueError):
                    probe.validate_manifest(manifest)

    def test_observed_manifest_identity_requires_typed_hash_time_and_versions(self):
        probe = load_probe()
        invalid_mutations = {
            "bad_sha": lambda manifest: manifest["sources"][0].update(
                sha256="not-a-sha"
            ),
            "timezone_free_time": lambda manifest: manifest["sources"][0].update(
                acquisition_timestamp="2026-08-22T00:00:00"
            ),
            "empty_versions": lambda manifest: manifest.update(
                runtime_tool_versions={}
            ),
        }

        for name, mutate in invalid_mutations.items():
            with self.subTest(name=name):
                manifest = valid_manifest()
                mutate(manifest)
                with self.assertRaises(ValueError):
                    probe.validate_manifest(manifest)

    def test_unresolved_source_keeps_required_keys_without_inventing_values(self):
        probe = load_probe()
        manifest = valid_manifest()
        manifest["sources"][0].update(
            source_role="C",
            revision=None,
            issuer_or_source=None,
            acquisition_method=None,
            source_url=None,
            canonical_local_path=None,
            sha256=None,
            acquisition_timestamp=None,
            parser_or_script=None,
            evidence_status="NOT_ATTEMPTED",
            reason="Task90/93 baseline PDF identity was not established",
        )

        probe.validate_manifest(manifest)

    def test_unresolved_source_validates_any_hash_or_timestamp_it_does_provide(self):
        probe = load_probe()
        for field, invalid_value in (
            ("sha256", "not-a-sha"),
            ("acquisition_timestamp", "2026-08-22T00:00:00"),
        ):
            with self.subTest(field=field):
                manifest = valid_manifest()
                manifest["sources"][0].update(
                    evidence_status="UNVERIFIED",
                    reason="synthetic unresolved source",
                )
                manifest["sources"][0][field] = invalid_value
                with self.assertRaises(ValueError):
                    probe.validate_manifest(manifest)


class ReconstructionSafetyContractTests(unittest.TestCase):
    def test_local_gitignore_has_every_required_reconstruction_guard(self):
        ignore_path = RESEARCH_ROOT / ".gitignore"
        self.assertTrue(ignore_path.is_file(), f"RED: missing {ignore_path}")

        active_lines = {
            line.strip()
            for line in ignore_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        required = {
            "/raw/",
            "/extracted/A-visible.txt",
            "/extracted/B1-visible.txt",
            "/extracted/*raw*",
            "/extracted/*verbatim*",
        }
        self.assertEqual(required - active_lines, set())
        self.assertEqual(
            [line for line in active_lines if line.startswith("!")],
            [],
            "research-local guards must not be neutralized by negation patterns",
        )


class ObservationValueContractTests(unittest.TestCase):
    def test_o1_o3_accept_clause_values_and_reject_discrepancy_classes(self):
        probe = load_probe()
        for observation_id in ("O1", "O2", "O3"):
            for value in CLAUSE_OBSERVATION_VALUES:
                with self.subTest(observation_id=observation_id, accepted=value):
                    probe.validate_observation_value(observation_id, value)
            for value in DISCREPANCY_CLASSES:
                with self.subTest(observation_id=observation_id, rejected=value):
                    with self.assertRaises(ValueError):
                        probe.validate_observation_value(observation_id, value)

    def test_o4_rejects_true_false_and_inconclusive(self):
        probe = load_probe()
        for value in CLAUSE_OBSERVATION_VALUES:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    probe.validate_observation_value("O4", value)

    def test_o4_accepts_only_discrepancy_classes(self):
        probe = load_probe()
        for value in DISCREPANCY_CLASSES:
            with self.subTest(value=value):
                probe.validate_observation_value("O4", value)


class ModuleIsolationContractTests(unittest.TestCase):
    def test_probe_module_has_no_mutable_module_level_state(self):
        probe = load_probe()
        mutable_globals = {
            name: type(value).__name__
            for name, value in vars(probe).items()
            if not name.startswith("__")
            and not isinstance(value, types.ModuleType)
            and isinstance(value, (dict, list, set, bytearray))
        }
        self.assertEqual(mutable_globals, {})


class UnverifiedFailurePathContractTests(unittest.TestCase):
    """Synthetic failures test status handling, never real-source evidence."""

    def test_missing_clause_yields_unverified_not_false(self):
        probe = load_probe()
        xml_bytes = (
            b'<hs:section xmlns:hs="urn:synthetic">'
            b"<hs:p><hs:t>241.1 synthetic</hs:t></hs:p>"
            b"</hs:section>"
        )

        result = probe.observe_clause_from_xml(
            xml_bytes=xml_bytes,
            clause_identifier="241.17.3",
            evidence_path="raw/synthetic-section.xml",
        )

        self.assertEqual(result["status"], "UNVERIFIED")
        self.assertTrue(result["reason"].strip())
        self.assertNotIn(result.get("observation"), (False, "FALSE"))

    def test_malformed_xml_yields_unverified_not_structural_absence(self):
        probe = load_probe()

        result = probe.observe_clause_from_xml(
            xml_bytes=b"<root><broken>",
            clause_identifier="241.17.3",
            evidence_path="raw/synthetic-broken.xml",
        )

        self.assertEqual(result["status"], "UNVERIFIED")
        self.assertTrue(result["reason"].strip())
        self.assertNotIn(result.get("observation"), (False, "FALSE"))

    def test_clause_identifier_does_not_match_a_longer_identifier_prefix(self):
        probe = load_probe()
        xml_bytes = (
            b'<hs:section xmlns:hs="urn:synthetic">'
            b"<hs:p><hs:t>241.17.30 synthetic</hs:t></hs:p>"
            b"</hs:section>"
        )

        result = probe.observe_clause_from_xml(
            xml_bytes=xml_bytes,
            clause_identifier="241.17.3",
            evidence_path="raw/synthetic-section.xml",
        )

        self.assertEqual(result["status"], "UNVERIFIED")

    def test_exact_clause_match_uses_a_text_node_path_not_an_ancestor_index(self):
        probe = load_probe()
        xml_bytes = (
            b'<hs:section xmlns:hs="urn:synthetic">'
            b"<hs:p><hs:t>prefix</hs:t><hs:t>241.17.3 synthetic</hs:t></hs:p>"
            b"</hs:section>"
        )

        result = probe.observe_clause_from_xml(
            xml_bytes=xml_bytes,
            clause_identifier="241.17.3",
            evidence_path="raw/synthetic-section.xml",
        )

        self.assertEqual(result["status"], "OBSERVED")
        self.assertIn("/t[2]/text()", result["locator"])
        self.assertNotIn("element-iteration-index", result["locator"])

    def test_transient_outage_keeps_phase1_and_option1_unverified(self):
        probe = load_probe()
        body_claim = probe.observe_law_body(
            response_bytes=None,
            expected_revision="2024-749",
            evidence_path="raw/synthetic-no-response.xml",
        )
        self.assertEqual(body_claim["status"], "UNVERIFIED")
        self.assertTrue(body_claim["reason"].strip())

        facts = complete_pass0a_facts()
        facts["body_retrieval_succeeds"] = body_claim
        facts["response_identifies_2024_749"] = body_claim
        facts["body_content_available"] = body_claim
        facts["no_silent_current_substitution"] = body_claim
        continue_after_phase1 = Mock()

        result = probe.run_phase1_gate(
            facts=facts,
            failure_kind="TRANSIENT",
            block_reason_class="TRANSIENT_SERVICE_OUTAGE",
            continue_after_phase1=continue_after_phase1,
        )

        self.assertEqual(result["result"], "INCONCLUSIVE")
        self.assertEqual(result["pass_0a"], "UNVERIFIED")
        self.assertEqual(result["option_1_available"], "UNVERIFIED")
        self.assertEqual(
            result["block_reason_class"], "TRANSIENT_SERVICE_OUTAGE"
        )
        self.assertTrue(result["retryable"])
        self.assertTrue(result["stop"])
        continue_after_phase1.assert_not_called()


class RealLawBodyResponseRegressionTests(unittest.TestCase):
    def test_actual_2025_227_xml_enforces_identity_and_body_states(self):
        """One retained response crosses the parser; mutations are test-only."""

        probe = load_probe()
        response_path = RESEARCH_ROOT / "raw" / "body-probe-2025-227.response.xml"
        evidence_path = (
            "research/kec-representation-probe/raw/"
            "body-probe-2025-227.response.xml"
        )
        response_bytes = response_path.read_bytes()
        self.assertEqual(
            hashlib.sha256(response_bytes).hexdigest(),
            "c16a0f4261149502b2175f21e6e0d9ec7afcb8d79e730eb37e5b414df0f75f56",
        )

        empty_body = probe.observe_law_body(
            response_bytes=response_bytes,
            expected_revision="2025-227",
            evidence_path=evidence_path,
        )

        self.assertEqual(empty_body["status"], "OBSERVED")
        self.assertIs(empty_body["value"], False)
        self.assertEqual(empty_body["evidence_path"], evidence_path)
        self.assertIn("발령번호", empty_body["locator"])
        self.assertIn("조문내용", empty_body["locator"])
        self.assertIn("child_count=0", empty_body["locator"])
        self.assertIn("text_chars=0", empty_body["locator"])
        probe.validate_claim(empty_body)

        wrong_revision = probe.observe_law_body(
            response_bytes=response_bytes,
            expected_revision="2024-749",
            evidence_path=evidence_path,
        )
        self.assertEqual(wrong_revision["status"], "UNVERIFIED")
        self.assertNotIn("value", wrong_revision)
        probe.validate_claim(wrong_revision)

        wrong_root = ET.fromstring(response_bytes)
        wrong_root.tag = "UnexpectedService"
        wrong_root_result = probe.observe_law_body(
            response_bytes=ET.tostring(wrong_root, encoding="utf-8"),
            expected_revision="2025-227",
            evidence_path="raw/derived-contract-wrong-root.xml",
        )
        self.assertEqual(wrong_root_result["status"], "UNVERIFIED")
        self.assertNotIn("value", wrong_root_result)
        probe.validate_claim(wrong_root_result)

        root_without_body = ET.fromstring(response_bytes)
        body_element = next(
            child
            for child in root_without_body
            if child.tag.rsplit("}", 1)[-1] == "조문내용"
        )
        root_without_body.remove(body_element)
        missing_body = probe.observe_law_body(
            response_bytes=ET.tostring(root_without_body, encoding="utf-8"),
            expected_revision="2025-227",
            evidence_path="raw/derived-contract-missing-body.xml",
        )

        self.assertEqual(missing_body["status"], "UNVERIFIED")
        self.assertIn("조문내용", missing_body["reason"])
        self.assertNotIn("value", missing_body)
        probe.validate_claim(missing_body)

        root_with_whitespace_body = ET.fromstring(response_bytes)
        whitespace_body_element = next(
            child
            for child in root_with_whitespace_body
            if child.tag.rsplit("}", 1)[-1] == "조문내용"
        )
        whitespace_body_element.text = " \n\t "
        whitespace_body = probe.observe_law_body(
            response_bytes=ET.tostring(
                root_with_whitespace_body, encoding="utf-8"
            ),
            expected_revision="2025-227",
            evidence_path="raw/derived-contract-whitespace-body.xml",
        )
        self.assertEqual(whitespace_body["status"], "OBSERVED")
        self.assertIs(whitespace_body["value"], False)
        self.assertIn("text_chars=0", whitespace_body["locator"])
        probe.validate_claim(whitespace_body)

        root_with_body = ET.fromstring(response_bytes)
        body_element = next(
            child
            for child in root_with_body
            if child.tag.rsplit("}", 1)[-1] == "조문내용"
        )
        body_element.text = "synthetic contract body"
        nonempty_body = probe.observe_law_body(
            response_bytes=ET.tostring(root_with_body, encoding="utf-8"),
            expected_revision="2025-227",
            evidence_path="raw/derived-contract-nonempty-body.xml",
        )

        self.assertEqual(nonempty_body["status"], "OBSERVED")
        self.assertIs(nonempty_body["value"], True)
        self.assertEqual(
            nonempty_body["evidence_path"],
            "raw/derived-contract-nonempty-body.xml",
        )
        self.assertIn("text='2025-227'", nonempty_body["locator"])
        self.assertIn("/조문내용[1]", nonempty_body["locator"])
        self.assertIn("text_chars=23", nonempty_body["locator"])
        probe.validate_claim(nonempty_body)


class HumanReviewBoundaryContractTests(unittest.TestCase):
    def test_asymmetry_generalization_and_selection_bias_fields_are_nonblank_only(self):
        """Green proves presence only; humans must judge truth and adequacy."""

        probe = load_probe()
        metadata = {
            "extraction_path_asymmetry": "any nonblank human-authored record",
            "generalization_warning": "any nonblank human-authored warning",
            "candidate_selection_bias": "any nonblank human-authored bias record",
        }
        probe.validate_human_review_fields(metadata)

        for field in metadata:
            for missing_or_blank in (None, "", "   "):
                with self.subTest(field=field, value=missing_or_blank):
                    invalid = dict(metadata)
                    if missing_or_blank is None:
                        del invalid[field]
                    else:
                        invalid[field] = missing_or_blank
                    with self.assertRaises(ValueError):
                        probe.validate_human_review_fields(invalid)


class EvidencePackIntegrationContractTests(unittest.TestCase):
    def test_actual_manifest_validates_and_retained_hashes_match(self):
        probe = load_probe()
        manifest = json.loads(ACTUAL_MANIFEST_PATH.read_text(encoding="utf-8"))
        probe.validate_manifest(manifest)
        self.assertEqual(manifest["result"], "BLOCKED")
        self.assertEqual(manifest["pass_0a"], "BLOCKED")
        self.assertEqual(manifest["option_1_available"], "NO")
        self.assertEqual(
            manifest["block_reason_class"], "STRUCTURAL_RECORD_ABSENCE"
        )
        self.assertFalse(manifest["retryable"])
        self.assertEqual(
            manifest["harness_validation"]["real_input_gate_verified"],
            "YES (AUTHENTICATED API HISTORY LIST)",
        )
        self.assertEqual(
            manifest["harness_validation"]["harness_accuracy"], "UNVERIFIED"
        )
        self.assertEqual(
            manifest["observed_research_debts"][0]["id"],
            "C_BASELINE_INPUT_IDENTITY_UNRESOLVED",
        )

        retry_summary = manifest["phase1_retry_summary"]
        retry_summary_path = Path(retry_summary["path"])
        self.assertTrue(retry_summary_path.is_file())
        self.assertEqual(
            hashlib.sha256(retry_summary_path.read_bytes()).hexdigest(),
            retry_summary["sha256"],
        )

        retry_data = json.loads(retry_summary_path.read_text(encoding="utf-8"))
        workspace_root = RESEARCH_ROOT.parents[1]
        for retained in retry_data["retained_artifacts"]:
            retained_path = Path(retained["path"])
            if not retained_path.is_absolute():
                retained_path = workspace_root / retained_path
            with self.subTest(retry_artifact=retained["path"]):
                self.assertTrue(retained_path.is_file())
                retained_bytes = retained_path.read_bytes()
                self.assertEqual(
                    hashlib.sha256(retained_bytes).hexdigest(),
                    retained["sha256"],
                )
                retained_text = retained_bytes.decode("utf-8", errors="ignore")
                self.assertNotIn("<REDACTED_OC>", retained_text)
                for echo in re.findall(r"OC=([^&<\"'\s]+)", retained_text):
                    self.assertEqual(echo, "REDACTED_OC")
                if retained_path.name.endswith(".headers.txt"):
                    for line in retained_text.splitlines():
                        if line.startswith("Set-Cookie:"):
                            self.assertEqual(line, "Set-Cookie: REDACTED")

        artifacts = tuple(manifest["retained_http_artifacts"]) + tuple(
            manifest["phase0_c_pdf_candidates"]
        )
        for artifact in artifacts:
            with self.subTest(path=artifact["path"]):
                path = Path(artifact["path"])
                self.assertTrue(path.is_file())
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                self.assertEqual(digest, artifact["sha256"])

    def test_retained_http_artifacts_record_their_request_urls(self):
        manifest = json.loads(ACTUAL_MANIFEST_PATH.read_text(encoding="utf-8"))
        for artifact in manifest["retained_http_artifacts"]:
            with self.subTest(role=artifact["role"]):
                self.assertTrue(artifact["source_url"].strip())

    def test_phase0_inventory_is_hashed_and_records_bounded_baseline_facts(self):
        manifest = json.loads(ACTUAL_MANIFEST_PATH.read_text(encoding="utf-8"))
        retained = manifest["phase0_inventory"]
        self.assertEqual(Path(retained["path"]), PHASE0_INVENTORY_PATH)
        self.assertEqual(
            hashlib.sha256(PHASE0_INVENTORY_PATH.read_bytes()).hexdigest(),
            retained["sha256"],
        )

        inventory = json.loads(PHASE0_INVENTORY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(inventory["repository"]["starting_git_status_short"], [])
        self.assertTrue(inventory["task90"]["implementation_paths"])
        self.assertTrue(inventory["task93"]["implementation_paths"])
        self.assertEqual(inventory["bounded_hwpx_hwp_search"]["matches"], [])
        self.assertEqual(
            inventory["bounded_hwpx_hwp_search"]["interpretation_status"],
            "UNVERIFIED",
        )
        for artifact in inventory["existing_pdf_extraction_artifacts"]:
            with self.subTest(path=artifact["path"]):
                self.assertEqual(
                    artifact["tables"], ["index_metadata", "kec_chunks"]
                )
                self.assertEqual(
                    artifact["task90_93_binding_status"], "UNVERIFIED"
                )
        self.assertIn(
            "extracted/phase0-inventory.json#/",
            RESULT_REPORT_PATH.read_text(encoding="utf-8"),
        )

    def test_blocked_report_retains_required_status_boundaries(self):
        report = RESULT_REPORT_PATH.read_text(encoding="utf-8")
        required_fragments = (
            "PASS_0A = BLOCKED",
            "OPTION_1_AVAILABLE = NO",
            "BLOCK_REASON_CLASS = STRUCTURAL_RECORD_ABSENCE",
            "RETRYABLE = NO",
            "C_STATUS = NOT_ATTEMPTED",
            "CONTRACT_VERIFIED = YES (SYNTHETIC CONTRACTS + ONE RETAINED-XML REGRESSION)",
            "REAL_INPUT_VERIFIED = PARTIAL",
            "B2_XML_PARSE = SUCCESS (OBSERVED)",
            "B2_CLAUSE_CONTENT_AVAILABLE = FALSE (OBSERVED)",
            "B2_XML_FLAG_BODY_CLASS = RETRIEVAL_METHOD_MISMATCH (OBSERVED)",
            "STRUCTURAL_BODY_FIELD_ABSENCE_REASON_CLASS_APPLIES =",
            "NO (OBSERVED; BODY TAG PRESENT)",
            "일부개정 전문",
            "HARNESS_ACCURACY = UNVERIFIED",
            "C_BASELINE_INPUT_IDENTITY_UNRESOLVED",
            "O1 STRUCTURED_REPRESENTATION = INCONCLUSIVE",
            "O2 LAW_BODY_CONDITIONAL_STRUCTURE = INCONCLUSIVE",
            "O3 CONDITION_TABLE_INDEPENDENCE = INCONCLUSIVE",
            "O4 SAME_REVISION_DISCREPANCY = UNVERIFIED",
            "Candidate Selection Bias",
            "A/B1 Extraction Asymmetry",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, report)


if __name__ == "__main__":
    unittest.main()
