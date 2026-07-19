import { describe, expect, it } from "vitest";

import {
  assembleElectricalObjects,
  buildElectricalConstructionGraph,
  canonicalizeElectricalCandidate,
  computeElectricalConfidence,
  createElectricalEvidenceIndex,
  createElectricalObjectId,
  electricalObjectStatus,
  resolveElectricalObjectCandidates,
  runElectricalObjectRules,
  serializeElectricalObjects,
  validateElectricalCandidate,
  validateElectricalConstructionInput,
  validateElectricalObjects,
  validateElectricalRule,
  writeElectricalObjects,
} from "../src/index.js";
import type {
  BuildElectricalObjectsInput,
  CandidateConflict,
  CandidateResolution,
  ElectricalConfidenceComponents,
  ElectricalConstructionContext,
  ElectricalEvidenceIndex,
  ElectricalObjectIdentityInput,
  ElectricalObjectRule,
} from "../src/index.js";
import {
  createElectricalConstructionFixture,
  makeElectricalCandidate,
} from "./helpers/drawingElectricalObjectsFixture.js";

describe("drawing electrical package-root public API", () => {
  it("exports the approved runtime pipeline from the package root", () => {
    expect({
      canonicalizeElectricalCandidate,
      validateElectricalCandidate,
      validateElectricalRule,
      runElectricalObjectRules,
      computeElectricalConfidence,
      electricalObjectStatus,
      createElectricalObjectId,
      validateElectricalConstructionInput,
      createElectricalEvidenceIndex,
      resolveElectricalObjectCandidates,
      assembleElectricalObjects,
      buildElectricalConstructionGraph,
      validateElectricalObjects,
      serializeElectricalObjects,
      writeElectricalObjects,
    }).toEqual(expect.objectContaining(
      Object.fromEntries([
        "canonicalizeElectricalCandidate",
        "validateElectricalCandidate",
        "validateElectricalRule",
        "runElectricalObjectRules",
        "computeElectricalConfidence",
        "electricalObjectStatus",
        "createElectricalObjectId",
        "validateElectricalConstructionInput",
        "createElectricalEvidenceIndex",
        "resolveElectricalObjectCandidates",
        "assembleElectricalObjects",
        "buildElectricalConstructionGraph",
        "validateElectricalObjects",
        "serializeElectricalObjects",
        "writeElectricalObjects",
      ].map((name) => [name, expect.any(Function)])),
    ));
  });

  it("executes confidence, status, identity, validation, and evidence APIs", () => {
    const scores: ElectricalConfidenceComponents = {
      structural: 1,
      label: 1,
      spatial: 1,
      attribute: 1,
      consistency: 1,
    };
    expect(computeElectricalConfidence(scores)).toEqual({
      rawConfidence: 1,
      confidence: 1,
    });
    expect(electricalObjectStatus(0.8)).toBe("accepted");

    const fixture: BuildElectricalObjectsInput = createElectricalConstructionFixture();
    const identity: ElectricalObjectIdentityInput = {
      sourceSha256: fixture.layout.sourceSha256,
      page: fixture.layout.page,
      ruleId: "synthetic.breaker",
      primaryPrimitiveIds: ["primitive-container"],
      supportingPrimitiveIds: [],
      contextPrimitiveIds: [],
      labelIds: ["item-inside"],
    };
    expect(createElectricalObjectId(identity)).toBe(createElectricalObjectId(identity));
    expect(() => validateElectricalConstructionInput(fixture)).not.toThrow();

    const evidence: ElectricalEvidenceIndex = createElectricalEvidenceIndex(fixture);
    expect(evidence.getPrimitive("primitive-container")).toBeDefined();
  });

  it("runs Candidate through Validation using package-root runtime APIs only", () => {
    const context: ElectricalConstructionContext = createElectricalConstructionFixture();
    const rule: ElectricalObjectRule = {
      id: "synthetic.breaker",
      type: "breaker",
      priority: 100,
      generate: () => [makeElectricalCandidate()],
    };
    expect(() => validateElectricalRule(rule)).not.toThrow();

    const candidates = runElectricalObjectRules([rule], context);
    const canonical = canonicalizeElectricalCandidate(candidates[0]!, context);
    expect(() => validateElectricalCandidate(canonical, context)).not.toThrow();

    const resolution: CandidateResolution = resolveElectricalObjectCandidates(
      candidates,
      context,
    );
    const conflict: CandidateConflict | undefined = resolution.conflicts[0];
    expect(conflict).toBeUndefined();
    expect(resolution.acceptedCandidates).toHaveLength(1);

    const document = assembleElectricalObjects(resolution, context);
    expect(() => validateElectricalObjects(document)).not.toThrow();
  });
});
