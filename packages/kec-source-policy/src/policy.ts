import type { SourceIdentity, SourceRevisionKey } from "@voltai/source-core";

import type {
  AssertionSchemeVersion,
  KecSourcePolicyDependencies,
  PolicyOperationInput,
  PolicyReplayApplicabilityKey,
  SourceIdentityPolicy,
} from "./types.js";

type UnknownRecord = Readonly<Record<string, unknown>>;

type CanonicalAssertionClaim = Readonly<{
  schemeId: string;
  schemeVersion: string;
  canonicalValue: string;
}>;

type SchemeVersionReference = Readonly<{
  schemeId: string;
  version: string;
}>;

type CanonicalizationTransformation =
  "CASE_FOLD" | "STRIP_LEADING_ZEROES" | "STRIP_SLASH";

const supportedCanonicalizationTransformations = [
  "CASE_FOLD",
  "STRIP_LEADING_ZEROES",
  "STRIP_SLASH",
] as const satisfies readonly CanonicalizationTransformation[];

function isSupportedCanonicalizationTransformation(
  value: unknown,
): value is CanonicalizationTransformation {
  return supportedCanonicalizationTransformations.some(
    (transformation) => transformation === value,
  );
}

type IdentityFlight = {
  waiters: number;
  readonly promise: Promise<Readonly<{ identity: string; minted: boolean }>>;
};

const semanticSchemeFields = [
  "canonicalization",
  "assertingAuthorityReference",
  "identifierNamespace",
  "equalitySemantics",
  "differenceSemantics",
  "aliasesPossible",
  "renumberingPossible",
  "identifierReusePossible",
  "originIssuanceCapability",
  "bindingRule",
] as const;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function records(value: unknown): readonly UnknownRecord[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const candidate = record(entry);
        return candidate === undefined ? [] : [candidate];
      })
    : [];
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceIdentity(value: string): SourceIdentity {
  return value as SourceIdentity;
}

function revisionKey(value: string): SourceRevisionKey {
  return value as SourceRevisionKey;
}

function schemeFrom(value: unknown): AssertionSchemeVersion | undefined {
  const candidate = record(value);
  if (candidate === undefined) {
    return undefined;
  }
  return candidate as AssertionSchemeVersion;
}

function canonicalClaim(
  assertion: UnknownRecord,
): CanonicalAssertionClaim | undefined {
  const schemeId = text(assertion.schemeId);
  const schemeVersion = text(assertion.schemeVersion);
  const canonicalValue = text(assertion.canonicalValue);
  if (
    schemeId === undefined ||
    schemeVersion === undefined ||
    canonicalValue === undefined
  ) {
    return undefined;
  }
  return { schemeId, schemeVersion, canonicalValue };
}

function claimRegistryKey(claim: CanonicalAssertionClaim): string {
  return [claim.schemeId, claim.schemeVersion, claim.canonicalValue]
    .map((coordinate) => `${coordinate.length}:${coordinate}`)
    .join("|");
}

function schemeVersionReference(
  value: unknown,
): SchemeVersionReference | undefined {
  const candidate = record(value);
  const schemeId = text(candidate?.schemeId);
  const version = text(candidate?.version);
  return schemeId === undefined || version === undefined
    ? undefined
    : { schemeId, version };
}

function sameSchemeVersion(
  left: SchemeVersionReference,
  right: SchemeVersionReference,
): boolean {
  return left.schemeId === right.schemeId && left.version === right.version;
}

function declaredCanonicalizationTransformations(
  scheme: AssertionSchemeVersion,
):
  | Readonly<{
      kind: "VALID";
      transformations: readonly CanonicalizationTransformation[];
    }>
  | Readonly<{ kind: "MISSING" }>
  | Readonly<{ kind: "UNSUPPORTED" }> {
  const canonicalization = record(scheme.canonicalization);
  const declared = canonicalization?.equivalencePreservingTransformations;
  if (!Array.isArray(declared)) {
    return { kind: "MISSING" };
  }
  if (!declared.every(isSupportedCanonicalizationTransformation)) {
    return { kind: "UNSUPPORTED" };
  }
  const declaredSet = new Set<CanonicalizationTransformation>(declared);
  return {
    kind: "VALID",
    transformations: supportedCanonicalizationTransformations.filter(
      (transformation) => declaredSet.has(transformation),
    ),
  };
}

function applyDeclaredCanonicalization(
  rawValue: string,
  transformations: readonly CanonicalizationTransformation[],
): string {
  let canonicalValue = rawValue;
  for (const transformation of transformations) {
    switch (transformation) {
      case "CASE_FOLD":
        canonicalValue = canonicalValue.toUpperCase();
        break;
      case "STRIP_LEADING_ZEROES":
        canonicalValue = canonicalValue.replace(/(^|[^0-9])0+(?=[0-9])/g, "$1");
        break;
      case "STRIP_SLASH":
        canonicalValue = canonicalValue.replaceAll("/", "");
        break;
    }
  }
  return canonicalValue;
}

function invalidSchemeReason(
  scheme: AssertionSchemeVersion,
): string | undefined {
  const canonicalization = record(scheme.canonicalization);
  if (
    !nonEmpty(scheme.schemeId) ||
    !nonEmpty(scheme.version) ||
    !nonEmpty(scheme.assertingAuthorityReference) ||
    !nonEmpty(scheme.identifierNamespace) ||
    !nonEmpty(scheme.bindingRule) ||
    !nonEmpty(canonicalization?.ruleId) ||
    canonicalization?.deterministic !== true ||
    declaredCanonicalizationTransformations(scheme).kind === "MISSING"
  ) {
    return "REQUIRED_SCHEME_STRUCTURE_MISSING";
  }

  if (declaredCanonicalizationTransformations(scheme).kind === "UNSUPPORTED") {
    return "UNSUPPORTED_CANONICALIZATION_TRANSFORMATION";
  }

  if (scheme.originIssuanceCapability === "YES") {
    if (scheme.aliasesPossible === "UNKNOWN") {
      return "ORIGIN_CAPABILITY_CONTRADICTS_ALIASES_POSSIBLE";
    }
    if (scheme.renumberingPossible === "UNKNOWN") {
      return "ORIGIN_CAPABILITY_CONTRADICTS_RENUMBERING_POSSIBLE";
    }
    if (scheme.identifierReusePossible === "UNKNOWN") {
      return "ORIGIN_CAPABILITY_CONTRADICTS_IDENTIFIER_REUSE_POSSIBLE";
    }
  }

  const approval = scheme.semanticApproval;
  if (
    approval === undefined ||
    !nonEmpty(approval.policyDecisionId) ||
    !nonEmpty(approval.evidenceReference) ||
    !nonEmpty(approval.approvingAuthorityRole) ||
    !nonEmpty(approval.policyEpoch)
  ) {
    return "SEMANTIC_REGISTRATION_APPROVAL_REQUIRED";
  }
  return undefined;
}

function invalidCrossVersionCorrespondenceReason(
  input: PolicyOperationInput,
  successor: SchemeVersionReference,
): string | undefined {
  if (input.predecessorAutomaticOriginSchemeVersion === undefined) {
    return undefined;
  }

  const predecessor = schemeVersionReference(
    input.predecessorAutomaticOriginSchemeVersion,
  );
  if (predecessor === undefined || sameSchemeVersion(predecessor, successor)) {
    return "INVALID_CROSS_VERSION_CORRESPONDENCE";
  }

  const correspondence = record(input.crossVersionCorrespondence);
  if (correspondence === undefined) {
    return "CROSS_VERSION_CORRESPONDENCE_REQUIRED";
  }
  const declaredPredecessor = schemeVersionReference(
    correspondence.predecessorSchemeVersion,
  );
  const declaredSuccessor = schemeVersionReference(
    correspondence.successorSchemeVersion,
  );
  if (
    declaredPredecessor === undefined ||
    declaredSuccessor === undefined ||
    !sameSchemeVersion(predecessor, declaredPredecessor) ||
    !sameSchemeVersion(successor, declaredSuccessor)
  ) {
    return "INVALID_CROSS_VERSION_CORRESPONDENCE";
  }

  if (correspondence.kind === "DISJOINT_IDENTIFIER_SPACE") {
    return undefined;
  }
  if (correspondence.kind !== "EXPLICIT_CLAIM_MAPPING") {
    return "INVALID_CROSS_VERSION_CORRESPONDENCE";
  }

  const mappings = correspondence.mappings;
  if (
    !Array.isArray(mappings) ||
    mappings.some((value) => {
      const mapping = record(value);
      return (
        mapping === undefined ||
        !nonEmpty(mapping.predecessorCanonicalValue) ||
        !nonEmpty(mapping.successorCanonicalValue)
      );
    })
  ) {
    return "INVALID_CROSS_VERSION_CORRESPONDENCE";
  }
  return undefined;
}

function crossVersionDecision(
  input: PolicyOperationInput,
  successorClaim: CanonicalAssertionClaim,
): unknown {
  if (input.predecessorAutomaticOriginSchemeVersion === undefined) {
    return { kind: "FIRST_ORIGIN_VERSION" };
  }

  const correspondence = record(input.crossVersionCorrespondence);
  if (correspondence?.kind === "DISJOINT_IDENTIFIER_SPACE") {
    return { kind: "DISJOINT_IDENTIFIER_SPACE" };
  }
  if (correspondence?.kind !== "EXPLICIT_CLAIM_MAPPING") {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "CROSS_VERSION_CORRESPONDENCE_REQUIRED",
      automaticOrigin: "UNAVAILABLE",
    };
  }

  const predecessor = schemeVersionReference(
    correspondence.predecessorSchemeVersion,
  );
  const matchingMappings = records(correspondence.mappings).filter(
    (mapping) =>
      mapping.successorCanonicalValue === successorClaim.canonicalValue,
  );
  const predecessorValues = [
    ...new Set(
      matchingMappings.flatMap((mapping) => {
        const value = text(mapping.predecessorCanonicalValue);
        return value === undefined ? [] : [value];
      }),
    ),
  ];
  if (predecessor === undefined || predecessorValues.length !== 1) {
    return {
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      reason: "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
    };
  }

  return {
    kind: "CROSS_VERSION_REUSE_REQUIRED",
    canonicalAssertionClaim: successorClaim,
    predecessorCanonicalAssertionClaim: {
      schemeId: predecessor.schemeId,
      schemeVersion: predecessor.version,
      canonicalValue: predecessorValues[0],
    },
  };
}

function validateSchemeActivation(input: PolicyOperationInput): unknown {
  const active = records(input.activeAutomaticOriginSchemeVersions);
  if (active.length === 0) {
    return {
      kind: "POLICY_VALID",
      automaticOrigin: "UNAVAILABLE",
      reason: "NO_ACTIVE_ORIGIN_SCHEME",
      automation: "POLICY_LOOKUP_REQUIRED",
    };
  }
  if (active.length > 1) {
    return {
      kind: "INVALID_POLICY_CONFIGURATION",
      reason: "MULTIPLE_ACTIVE_ORIGIN_SCHEMES",
      automaticOrigin: "GLOBALLY_DISABLED",
    };
  }

  const designation = active[0];
  const schemes = records(input.registeredSchemes)
    .map(schemeFrom)
    .filter((scheme): scheme is AssertionSchemeVersion => scheme !== undefined);
  const scheme = schemes.find(
    (candidate) =>
      candidate.schemeId === designation.schemeId &&
      candidate.version === designation.version,
  );
  if (scheme === undefined) {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "ACTIVE_SCHEME_VERSION_NOT_REGISTERED",
      automaticOrigin: "UNAVAILABLE",
    };
  }

  const reason = invalidSchemeReason(scheme);
  if (reason !== undefined) {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason,
      automaticOrigin: "UNAVAILABLE",
    };
  }
  const correspondenceReason = invalidCrossVersionCorrespondenceReason(input, {
    schemeId: scheme.schemeId,
    version: scheme.version,
  });
  if (correspondenceReason !== undefined) {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: correspondenceReason,
      automaticOrigin: "UNAVAILABLE",
    };
  }
  return { kind: "POLICY_VALID", automaticOrigin: "AVAILABLE" };
}

function evaluateOriginAuthorization(input: PolicyOperationInput): unknown {
  const assertion = record(input.assertion);
  const active = records(input.activeAutomaticOriginSchemeVersions);

  if (assertion === undefined) {
    if (active.length > 0) {
      return {
        kind: "NOT_ESTABLISHED",
        automation: "POLICY_LOOKUP_REQUIRED",
        reason: "BOUND_IDENTITY_ASSERTION_REQUIRED",
      };
    }
    if (input.discoveryResult === "CANDIDATE_MISS") {
      return {
        kind: "NOT_ESTABLISHED",
        automation: "POLICY_LOOKUP_REQUIRED",
        reason: "NO_ACTIVE_ORIGIN_SCHEME",
      };
    }
    return {
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      discoveryEvidence: "NO_RELATION_EVIDENCE_FROM_DISCOVERY",
    };
  }

  if (assertion.bindingStatus !== "BOUND") {
    return {
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      reason: "BOUND_IDENTITY_ASSERTION_REQUIRED",
    };
  }

  if (active.length === 0) {
    const schemes = records(input.registeredSchemes)
      .map(schemeFrom)
      .filter(
        (scheme): scheme is AssertionSchemeVersion => scheme !== undefined,
      );
    const assertedScheme = schemes.find(
      (scheme) =>
        scheme.schemeId === assertion.schemeId &&
        scheme.version === assertion.schemeVersion,
    );
    if (assertedScheme?.originIssuanceCapability === "NO") {
      const assessments = records(input.relationAssessments);
      const discoveryOnly =
        assessments.length > 0 &&
        assessments.every((assessment) => record(assessment.candidate));
      return discoveryOnly
        ? {
            kind: "NOT_ESTABLISHED",
            automation: "HUMAN_JUDGEMENT_REQUIRED",
            reason: "NO_POSITIVE_ORIGIN_ASSERTION",
          }
        : {
            kind: "NOT_ESTABLISHED",
            automation: "HUMAN_JUDGEMENT_REQUIRED",
            relationEvidenceRetained: true,
            reason: "SCHEME_NOT_ORIGIN_CAPABLE",
          };
    }
    return {
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      reason: "NO_ACTIVE_ORIGIN_SCHEME",
    };
  }

  const activation = record(validateSchemeActivation(input));
  if (activation?.kind !== "POLICY_VALID") {
    return activation;
  }
  const designation = active[0];
  if (
    designation.schemeId !== assertion.schemeId ||
    designation.version !== assertion.schemeVersion
  ) {
    return {
      kind: "NOT_ESTABLISHED",
      automation: "HUMAN_JUDGEMENT_REQUIRED",
      reason: "ASSERTION_NOT_ACTIVE_FOR_AUTOMATIC_ORIGIN",
    };
  }
  const claim = canonicalClaim(assertion);
  if (claim === undefined) {
    return {
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      reason: "INVALID_ASSERTION_CLAIM",
    };
  }
  if (input.relationConflict === true) {
    return { kind: "CONFLICTING_ASSERTION_RELATIONS" };
  }
  if (input.canonicalizationCollision === true) {
    return { kind: "ASSERTION_CANONICALIZATION_COLLISION" };
  }

  const canonicalizationObservations = records(input.observations);
  if (canonicalizationObservations.length > 0) {
    const assertedScheme = records(input.registeredSchemes)
      .map(schemeFrom)
      .find(
        (scheme) =>
          scheme?.schemeId === claim.schemeId &&
          scheme.version === claim.schemeVersion,
      );
    const canonicalization = record(
      canonicalizeAssertionClaims({
        scheme: assertedScheme,
        observations: canonicalizationObservations,
      }),
    );
    if (canonicalization?.kind !== "ASSERTION_CLAIMS_CANONICALIZED") {
      return canonicalization;
    }
  }

  const transition = record(crossVersionDecision(input, claim));
  if (
    transition?.kind === "INVALID_ASSERTION_SCHEME" ||
    transition?.kind === "NOT_ESTABLISHED" ||
    transition?.kind === "CROSS_VERSION_REUSE_REQUIRED"
  ) {
    return transition;
  }
  return { kind: "AUTO_ORIGIN_AUTHORIZED", canonicalAssertionClaim: claim };
}

function changedSemanticField(
  current: AssertionSchemeVersion,
  proposed: AssertionSchemeVersion,
): (typeof semanticSchemeFields)[number] | undefined {
  return semanticSchemeFields.find(
    (field) => !sameValue(current[field], proposed[field]),
  );
}

function replaceOriginSchemeVersion(input: PolicyOperationInput): unknown {
  const current = schemeFrom(input.activeUsedScheme);
  const proposed = schemeFrom(input.proposedScheme);
  if (current === undefined || proposed === undefined) {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "REQUIRED_SCHEME_STRUCTURE_MISSING",
      automaticOrigin: "UNAVAILABLE",
    };
  }

  const changedField = changedSemanticField(current, proposed);
  if (
    current.schemeId === proposed.schemeId &&
    current.version === proposed.version &&
    changedField !== undefined
  ) {
    return {
      kind: "ASSERTION_SCHEME_VERSION_CONFLICT",
      reason: "SEMANTIC_FIELDS_IMMUTABLE_AFTER_ACTIVATION",
      changedField,
      requiredVersion: "S2",
    };
  }

  if (
    current.version !== proposed.version &&
    input.proposedDesignation === "ACTIVE_FOR_AUTOMATIC_ORIGIN" &&
    input.crossVersionCorrespondence === undefined
  ) {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "CROSS_VERSION_CORRESPONDENCE_REQUIRED",
      automaticOrigin: "UNAVAILABLE",
    };
  }
  return { kind: "SCHEME_VERSION_REPLACEMENT_VALID" };
}

function interpretHistoricalClaim(input: PolicyOperationInput): unknown {
  const claim = record(input.historicalClaim);
  return {
    kind: "HISTORICAL_CLAIM_INTERPRETED",
    governingSchemeVersion: claim?.schemeVersion,
    canonicalValue: claim?.canonicalValue,
    sourceIdentity: claim?.sourceIdentity,
    reminted: false,
  };
}

function validateAssertionRelations(input: PolicyOperationInput): unknown {
  const claims = strings(input.claims);
  const edges = records(input.edges);
  const parent = new Map(claims.map((claim) => [claim, claim]));

  const find = (claim: string): string => {
    const current = parent.get(claim) ?? claim;
    if (current === claim) {
      return claim;
    }
    const root = find(current);
    parent.set(claim, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot);
    }
  };

  for (const edge of edges) {
    const left = text(edge.left);
    const right = text(edge.right);
    if (edge.relation === "SAME" && left !== undefined && right !== undefined) {
      union(left, right);
    }
  }

  const conflictingRoots = new Set<string>();
  for (const edge of edges) {
    const left = text(edge.left);
    const right = text(edge.right);
    if (
      edge.relation === "DIFFERENT" &&
      left !== undefined &&
      right !== undefined &&
      find(left) === find(right)
    ) {
      conflictingRoots.add(find(left));
    }
  }
  if (conflictingRoots.size === 0) {
    return { kind: "ASSERTION_RELATIONS_VALID" };
  }

  const affectedClaims = claims.filter((claim) =>
    conflictingRoots.has(find(claim)),
  );
  const unaffectedClaims = claims.filter(
    (claim) => !conflictingRoots.has(find(claim)),
  );
  return {
    kind: "CONFLICTING_ASSERTION_RELATIONS",
    affectedClaims,
    automaticDecisions: "DISABLED_FOR_AFFECTED_COMPONENT",
    ...(unaffectedClaims.length > 0 ? { unaffectedClaims } : {}),
    winner: undefined,
  };
}

function canonicalizeAssertionClaims(input: PolicyOperationInput): unknown {
  const scheme = schemeFrom(input.scheme);
  if (scheme === undefined) {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "REQUIRED_SCHEME_STRUCTURE_MISSING",
      automaticOrigin: "UNAVAILABLE",
    };
  }
  const declaration = declaredCanonicalizationTransformations(scheme);
  if (declaration.kind === "MISSING") {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "REQUIRED_SCHEME_STRUCTURE_MISSING",
      automaticOrigin: "UNAVAILABLE",
    };
  }
  if (declaration.kind === "UNSUPPORTED") {
    return {
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "UNSUPPORTED_CANONICALIZATION_TRANSFORMATION",
      automaticOrigin: "UNAVAILABLE",
    };
  }

  const observations = records(input.observations);
  const groups = new Map<
    string,
    Array<
      Readonly<{
        rawValue: string;
        expectedCanonical: string;
      }>
    >
  >();
  for (const observation of observations) {
    const raw = text(observation.rawValue);
    const canonical = text(observation.producedCanonical);
    if (raw === undefined || canonical === undefined) {
      continue;
    }
    const entries = groups.get(canonical) ?? [];
    if (!entries.some((entry) => entry.rawValue === raw)) {
      entries.push({
        rawValue: raw,
        expectedCanonical: applyDeclaredCanonicalization(
          raw,
          declaration.transformations,
        ),
      });
    }
    groups.set(canonical, entries);
  }

  for (const [canonicalValue, entries] of groups) {
    const rawValues = entries.map((entry) => entry.rawValue);
    if (
      rawValues.length > 1 &&
      entries.some((entry) => entry.expectedCanonical !== canonicalValue)
    ) {
      return {
        kind: "ASSERTION_CANONICALIZATION_COLLISION",
        canonicalValue,
        rawValues,
        automaticOrigin: "DISABLED_FOR_CLAIM",
      };
    }
  }

  for (const [canonicalValue, entries] of groups) {
    const mismatch = entries.find(
      (entry) => entry.expectedCanonical !== canonicalValue,
    );
    if (mismatch !== undefined) {
      return {
        kind: "INVALID_ASSERTION_CLAIM",
        reason: "CANONICAL_VALUE_NOT_PRODUCED_BY_DECLARED_TRANSFORMATIONS",
        rawValue: mismatch.rawValue,
        producedCanonical: canonicalValue,
      };
    }
  }
  return { kind: "ASSERTION_CLAIMS_CANONICALIZED" };
}

function validateAssertionClaim(input: PolicyOperationInput): unknown {
  if (record(input.forbiddenMetadataCoordinates) !== undefined) {
    return {
      kind: "INVALID_ASSERTION_CLAIM",
      reason: "ASSERTION_CLAIM_CONTAINS_NON_SCHEME_COORDINATES",
    };
  }
  return { kind: "ASSERTION_CLAIM_VALID" };
}

function immutableOutcome(input: PolicyOperationInput): unknown {
  return input.proposedOutcome;
}

function createKecPolicy(
  dependencies: KecSourcePolicyDependencies,
): SourceIdentityPolicy {
  const inFlightClaims = new Map<string, IdentityFlight>();

  const establishIdentityAtomically = async (
    input: PolicyOperationInput,
  ): Promise<unknown> => {
    const authorization = record(evaluateOriginAuthorization(input));
    if (authorization?.kind === "CROSS_VERSION_REUSE_REQUIRED") {
      const successorClaim = record(authorization.canonicalAssertionClaim);
      const predecessorClaim = record(
        authorization.predecessorCanonicalAssertionClaim,
      );
      const successor =
        successorClaim === undefined
          ? undefined
          : canonicalClaim(successorClaim);
      const predecessor =
        predecessorClaim === undefined
          ? undefined
          : canonicalClaim(predecessorClaim);
      if (successor === undefined || predecessor === undefined) {
        return {
          kind: "NOT_ESTABLISHED",
          automation: "POLICY_LOOKUP_REQUIRED",
          reason: "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
        };
      }

      const predecessorIdentity =
        dependencies.assertionClaimRegistry.identityFor(
          claimRegistryKey(predecessor),
        );
      if (predecessorIdentity === undefined) {
        return {
          kind: "NOT_ESTABLISHED",
          automation: "POLICY_LOOKUP_REQUIRED",
          reason: "CROSS_VERSION_PREDECESSOR_CLAIM_NOT_ESTABLISHED",
        };
      }

      const successorRegistryKey = claimRegistryKey(successor);
      const existingSuccessorIdentity =
        dependencies.assertionClaimRegistry.identityFor(successorRegistryKey);
      if (
        existingSuccessorIdentity !== undefined &&
        existingSuccessorIdentity !== predecessorIdentity
      ) {
        return {
          kind: "ASSERTION_CLAIM_CONFLICT",
          automaticOrigin: "DISABLED_FOR_CLAIM",
        };
      }
      if (existingSuccessorIdentity === undefined) {
        const associated =
          dependencies.assertionClaimRegistry.associateAtomically(
            successorRegistryKey,
            predecessorIdentity,
          );
        if (associated !== predecessorIdentity) {
          return {
            kind: "ASSERTION_CLAIM_CONFLICT",
            automaticOrigin: "DISABLED_FOR_CLAIM",
          };
        }
      }

      const outcome = {
        kind: "REUSE_ESTABLISHED_IDENTITY",
        sourceIdentity: predecessorIdentity,
      };
      const durable = dependencies.issuanceRequestRegistry.register(
        text(input.requestKey) ?? "",
        input.immutableRequestContent,
        outcome,
      );
      return record(durable)?.kind === "ISSUANCE_REQUEST_COLLISION"
        ? durable
        : outcome;
    }
    if (authorization?.kind !== "AUTO_ORIGIN_AUTHORIZED") {
      return authorization;
    }
    const claim = record(authorization.canonicalAssertionClaim);
    if (claim === undefined) {
      return { kind: "NOT_ESTABLISHED", reason: "INVALID_ASSERTION_CLAIM" };
    }
    const registryKey = claimRegistryKey({
      schemeId: text(claim.schemeId) ?? "",
      schemeVersion: text(claim.schemeVersion) ?? "",
      canonicalValue: text(claim.canonicalValue) ?? "",
    });
    const existing =
      dependencies.assertionClaimRegistry.identityFor(registryKey);
    if (existing !== undefined) {
      const outcome = {
        kind: "REUSE_ESTABLISHED_IDENTITY",
        sourceIdentity: existing,
      };
      dependencies.issuanceRequestRegistry.register(
        text(input.requestKey) ?? "",
        input.immutableRequestContent,
        outcome,
      );
      return outcome;
    }

    const activeFlight = inFlightClaims.get(registryKey);
    if (activeFlight !== undefined) {
      activeFlight.waiters += 1;
      const completed = await activeFlight.promise;
      const outcome = {
        kind: "REUSE_ESTABLISHED_IDENTITY",
        sourceIdentity: completed.identity,
      };
      dependencies.issuanceRequestRegistry.register(
        text(input.requestKey) ?? "",
        input.immutableRequestContent,
        outcome,
      );
      return outcome;
    }

    const flight: IdentityFlight = {
      waiters: 0,
      promise: Promise.resolve().then(async () => {
        const establishedBeforeIssue =
          dependencies.assertionClaimRegistry.identityFor(registryKey);
        if (establishedBeforeIssue !== undefined) {
          return { identity: establishedBeforeIssue, minted: false };
        }
        const issued = await dependencies.opaqueIdentityIssuer.issue();
        const established =
          dependencies.assertionClaimRegistry.associateAtomically(
            registryKey,
            issued,
          );
        return { identity: established, minted: established === issued };
      }),
    };
    inFlightClaims.set(registryKey, flight);
    try {
      const completed = await flight.promise;
      const baseOutcome = {
        kind: completed.minted
          ? "AUTO_ESTABLISH_NEW_IDENTITY"
          : "REUSE_ESTABLISHED_IDENTITY",
        sourceIdentity: completed.identity,
      };
      const outcome =
        completed.minted && flight.waiters === 0
          ? { ...baseOutcome, canonicalAssertionClaim: claim }
          : baseOutcome;
      const durable = dependencies.issuanceRequestRegistry.register(
        text(input.requestKey) ?? "",
        input.immutableRequestContent,
        outcome,
      );
      return record(durable)?.kind === "ISSUANCE_REQUEST_COLLISION"
        ? durable
        : outcome;
    } finally {
      if (inFlightClaims.get(registryKey) === flight) {
        inFlightClaims.delete(registryKey);
      }
    }
  };

  const registerIssuanceRequest = (input: PolicyOperationInput): unknown => {
    const proposed = record(immutableOutcome(input));
    const normalized =
      proposed?.kind === "REQUEST_REGISTERED"
        ? { ...proposed, semanticIdentityDecision: "NOT_APPLICABLE" }
        : input.proposedOutcome;
    return dependencies.issuanceRequestRegistry.register(
      text(input.requestKey) ?? "",
      input.immutableContent,
      normalized,
    );
  };

  const establishIdentityFromResolvedJudgement = async (
    input: PolicyOperationInput,
  ): Promise<unknown> => {
    const questionKey = text(input.questionKey);
    const policyCaseId = text(input.policyCaseId);
    const evidenceSnapshotId = text(input.evidenceSnapshotId);
    const policyEpoch = text(input.policyEpoch);
    const assertion = record(input.assertion);
    const claim =
      assertion === undefined ? undefined : canonicalClaim(assertion);
    const recordId = text(input.judgementRecordId);
    if (
      questionKey !== "kec.source.identity.origin/v1" ||
      policyCaseId === undefined ||
      evidenceSnapshotId === undefined ||
      policyEpoch === undefined ||
      assertion?.bindingStatus !== "BOUND" ||
      claim === undefined ||
      recordId === undefined ||
      dependencies.resolvedJudgementAuthority === undefined
    ) {
      return {
        kind: "NOT_ESTABLISHED",
        automation: "HUMAN_JUDGEMENT_REQUIRED",
        reason: "AUTHORITATIVE_JUDGEMENT_REQUIRED",
      };
    }
    const candidateCoordinate = claimRegistryKey(claim);
    const expectedApplicabilityKey = [
      questionKey,
      policyCaseId,
      evidenceSnapshotId,
      candidateCoordinate,
      policyEpoch,
    ]
      .map((coordinate) => `${coordinate.length}:${coordinate}`)
      .join("|");
    if (text(input.applicabilityKey) !== expectedApplicabilityKey) {
      return {
        kind: "NOT_ESTABLISHED",
        automation: "HUMAN_JUDGEMENT_REQUIRED",
        reason: "JUDGEMENT_APPLICABILITY_MISMATCH",
      };
    }
    const authoritative =
      await dependencies.resolvedJudgementAuthority.resolveReference({
        recordId,
        applicabilityKey: expectedApplicabilityKey,
        questionKey,
      });
    if (
      authoritative.kind !== "AUTHORITATIVE_JUDGEMENT" ||
      authoritative.decision !== "ESTABLISH_NEW_IDENTITY" ||
      authoritative.recordId !== recordId ||
      authoritative.applicabilityKey !== expectedApplicabilityKey
    ) {
      return {
        kind: "NOT_ESTABLISHED",
        automation: "HUMAN_JUDGEMENT_REQUIRED",
        reason: "AUTHORITATIVE_JUDGEMENT_REQUIRED",
      };
    }
    const existing =
      dependencies.assertionClaimRegistry.identityFor(candidateCoordinate);
    if (existing !== undefined) {
      return { kind: "REUSE_ESTABLISHED_IDENTITY", sourceIdentity: existing };
    }
    const issued = await dependencies.opaqueIdentityIssuer.issue();
    const established = dependencies.assertionClaimRegistry.associateAtomically(
      candidateCoordinate,
      issued,
    );
    const outcome = {
      kind:
        established === issued
          ? "JUDGEMENT_ESTABLISHED_NEW_IDENTITY"
          : "REUSE_ESTABLISHED_IDENTITY",
      sourceIdentity: established,
      canonicalAssertionClaim: claim,
    };
    const durable = dependencies.issuanceRequestRegistry.register(
      text(input.requestKey) ?? "",
      input.immutableRequestContent,
      outcome,
    );
    return record(durable)?.kind === "ISSUANCE_REQUEST_COLLISION"
      ? durable
      : outcome;
  };

  const establishRevision = async (
    input: PolicyOperationInput,
  ): Promise<unknown> => {
    const revisionScheme = record(input.revisionAssertionScheme);
    const revisionAssertion = record(input.revisionAssertion);
    if (
      revisionScheme !== undefined &&
      revisionAssertion !== undefined &&
      sameValue(revisionScheme, revisionAssertion)
    ) {
      return {
        kind: "REVISION_NOT_ESTABLISHED",
        reason: "IDENTITY_REVISION_COORDINATE_REUSE",
        sourceRevisionKey: undefined,
      };
    }
    if (revisionScheme === undefined || revisionAssertion === undefined) {
      return {
        kind: "REVISION_NOT_ESTABLISHED",
        reason: "INSUFFICIENT_REVISION_EVIDENCE",
        sourceRevisionKey: undefined,
      };
    }
    const validRevisionEvidence =
      revisionScheme.kind === "SOURCE_REVISION_ASSERTION_SCHEME" &&
      nonEmpty(revisionScheme.schemeId) &&
      nonEmpty(revisionScheme.schemeVersion) &&
      nonEmpty(revisionScheme.assertingAuthorityReference) &&
      nonEmpty(revisionScheme.revisionStateNamespace) &&
      revisionAssertion.bindingStatus === "BOUND" &&
      revisionAssertion.schemeId === revisionScheme.schemeId &&
      revisionAssertion.schemeVersion === revisionScheme.schemeVersion &&
      nonEmpty(revisionAssertion.revisionState);
    if (!validRevisionEvidence) {
      return {
        kind: "REVISION_NOT_ESTABLISHED",
        reason: "INSUFFICIENT_REVISION_EVIDENCE",
        sourceRevisionKey: undefined,
      };
    }
    const identityText = text(input.sourceIdentity);
    if (
      identityText === undefined ||
      dependencies.opaqueRevisionKeyIssuer === undefined ||
      dependencies.sourceRevisionRegistry === undefined
    ) {
      return {
        kind: "REVISION_NOT_ESTABLISHED",
        reason: "INSUFFICIENT_REVISION_EVIDENCE",
        sourceRevisionKey: undefined,
      };
    }
    const issued = await dependencies.opaqueRevisionKeyIssuer.issue(
      sourceIdentity(identityText),
    );
    await dependencies.sourceRevisionRegistry.register(
      sourceIdentity(identityText),
      revisionKey(issued),
    );
    return {
      kind: "SOURCE_REVISION_ESTABLISHED",
      sourceIdentity: identityText,
      sourceRevisionKey: revisionKey(issued),
    };
  };

  return {
    evaluateOriginAuthorization,
    validateSchemeActivation,
    replaceOriginSchemeVersion,
    interpretHistoricalClaim,
    validateAssertionRelations,
    canonicalizeAssertionClaims,
    validateAssertionClaim,
    establishIdentityAtomically,
    establishIdentityFromResolvedJudgement,
    registerIssuanceRequest,
    createEvidenceSnapshot: (input) => {
      if (
        input.proposedSourceIdentity !== undefined &&
        input.proposedSourceIdentity === input.integrityDigest
      ) {
        return {
          kind: "INVALID_EVIDENCE_IDENTITY_CONFLATION",
          reason: "EVIDENCE_DIGEST_IS_INTEGRITY_METADATA_ONLY",
        };
      }
      return Object.freeze({
        kind: "EVIDENCE_SNAPSHOT_CREATED",
        snapshotId: input.snapshotId,
        members: Object.freeze([...strings(input.members)]),
        membership: "IMMUTABLE",
      });
    },
    createReplayApplicabilityKey: (input) => {
      const context = record(input.context);
      const coordinates = [
        text(input.questionKey) ?? "",
        text(input.subject) ?? "",
        text(context?.evidenceSnapshotId) ?? "",
        text(context?.candidateCoordinate) ?? "",
        text(input.policyEpoch) ?? "",
      ];
      return coordinates
        .map((coordinate) => `${coordinate.length}:${coordinate}`)
        .join("|") as PolicyReplayApplicabilityKey;
    },
    resolveJudgement: (input) => ({
      kind: "POLICY_QUESTION_RESOLVED",
      outcome: input.outcome,
      policyCaseId: input.policyCaseId,
      evidenceSnapshotId: input.evidenceSnapshotId,
    }),
    establishRevision,
    evaluateCurrentKecCase: (input) => {
      if (
        record(input.left) !== undefined &&
        record(input.right) !== undefined
      ) {
        return {
          identity: "UNKNOWN_RELATIONSHIP",
          revision: "NOT_APPLICABLE",
          automation: "POLICY_LOOKUP_REQUIRED",
        };
      }
      return {
        identityEstablishment: "NOT_ESTABLISHED",
        pairwiseIdentityRelation: "NOT_APPLICABLE",
        revision: "NOT_ESTABLISHED",
        automation: "POLICY_LOOKUP_REQUIRED",
      };
    },
  };
}

export function createKecSourcePolicy(
  dependencies: KecSourcePolicyDependencies,
): SourceIdentityPolicy {
  return createKecPolicy(dependencies);
}
