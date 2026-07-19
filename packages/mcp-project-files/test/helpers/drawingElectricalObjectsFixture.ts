import { fileURLToPath } from "node:url";

import { buildDrawingSpatialRelations } from "../../src/drawingSpatial/buildDrawingSpatialRelations.js";
import { createDrawingSpatialFixture } from "./drawingSpatialFixture.js";

export type ElectricalConstructionFixture = ReturnType<
  typeof createElectricalConstructionFixture
>;

export function createElectricalConstructionFixture() {
  const fixture = createDrawingSpatialFixture();
  return {
    layout: fixture.layout,
    primitive: fixture.primitive,
    classification: fixture.classification,
    spatial: buildDrawingSpatialRelations(fixture),
  };
}

export function makeElectricalAttribute(
  value: string,
  overrides: Partial<{
    rawText: string;
    confidence: number;
    textEntityIds: string[];
    sourceRelationIds: string[];
    parserRuleId: string;
  }> = {},
) {
  return {
    value,
    rawText: overrides.rawText ?? value,
    confidence: overrides.confidence ?? 1,
    textEntityIds: overrides.textEntityIds ?? ["item-inside"],
    sourceRelationIds: overrides.sourceRelationIds ?? [],
    parserRuleId: overrides.parserRuleId ?? "synthetic.attribute",
  };
}

export function makeElectricalCandidate(
  overrides: Partial<{
    id: string;
    ruleId: string;
    type: string;
    priority: number;
    primaryPrimitiveIds: string[];
    supportingPrimitiveIds: string[];
    contextPrimitiveIds: string[];
    labelIds: string[];
    sourceRelationIds: string[];
    attributes: Record<string, unknown>;
    structuralScore: number;
    labelScore: number;
    spatialScore: number;
    attributeScore: number;
    consistencyScore: number;
    confidence: number;
    hardGatePassed: boolean;
    spatialSpecificity: string;
    exactLexicalMatch: boolean;
    primaryPrimitiveSourceOrder: number;
    shareSupportingPrimitives: boolean;
    diagnostics: Record<string, unknown>;
  }> = {},
) {
  return {
    id: overrides.id ?? "candidate-a",
    ruleId: overrides.ruleId ?? "synthetic.breaker",
    type: overrides.type ?? "breaker",
    priority: overrides.priority ?? 100,
    primaryPrimitiveIds: overrides.primaryPrimitiveIds ?? ["primitive-container"],
    supportingPrimitiveIds: overrides.supportingPrimitiveIds ?? [],
    contextPrimitiveIds: overrides.contextPrimitiveIds ?? [],
    labelIds: overrides.labelIds ?? ["item-inside"],
    sourceRelationIds: overrides.sourceRelationIds ?? [],
    attributes: overrides.attributes ?? {
      rating: makeElectricalAttribute("100A"),
      breakerKind: makeElectricalAttribute("MCCB", {
        parserRuleId: "synthetic.breaker-kind",
      }),
    },
    structuralScore: overrides.structuralScore ?? 1,
    labelScore: overrides.labelScore ?? 1,
    spatialScore: overrides.spatialScore ?? 1,
    attributeScore: overrides.attributeScore ?? 1,
    consistencyScore: overrides.consistencyScore ?? 1,
    confidence: overrides.confidence ?? 1,
    hardGatePassed: overrides.hardGatePassed ?? true,
    spatialSpecificity: overrides.spatialSpecificity ?? "contains",
    exactLexicalMatch: overrides.exactLexicalMatch ?? true,
    primaryPrimitiveSourceOrder:
      overrides.primaryPrimitiveSourceOrder ?? 0,
    shareSupportingPrimitives: overrides.shareSupportingPrimitives ?? false,
    diagnostics: overrides.diagnostics ?? { reasons: [] },
  };
}

export function makeElectricalObjectDocument() {
  const object = {
    id: "a".repeat(24),
    type: "breaker",
    status: "accepted",
    bbox: { x: 10, y: 10, width: 20, height: 10 },
    primitiveIds: ["primitive-container"],
    labels: [
      {
        textEntityType: "item",
        textEntityId: "item-inside",
        role: "name",
      },
    ],
    attributes: {
      name: makeElectricalAttribute("MCCB"),
      tag: null,
      rating: makeElectricalAttribute("100A"),
      phase: null,
      capacity: null,
      circuit: null,
      voltage: null,
      remarks: null,
      breakerKind: makeElectricalAttribute("MCCB"),
      poles: null,
      frameAmpere: null,
      tripAmpere: null,
    },
    confidence: 1,
    sourceRelationIds: [],
    diagnostics: {
      ruleId: "synthetic.breaker",
      confidenceComponents: {
        structural: 1,
        label: 1,
        spatial: 1,
        attribute: 1,
        consistency: 1,
      },
      conflicts: [],
    },
  };
  return {
    schemaVersion: 1,
    source: "docs/electrical.pdf",
    sourceSha256: "a".repeat(64),
    page: 15,
    pageWidth: 200,
    pageHeight: 200,
    objectCount: 1,
    objects: [object],
    constructionGraph: {
      objectIds: [object.id],
      edges: [],
      components: [
        { id: "component-000001", objectIds: [object.id], edgeIds: [] },
      ],
    },
    statistics: {
      candidateCount: 1,
      acceptedObjectCount: 1,
      reviewObjectCount: 0,
      excludedCandidateCount: 0,
      conflictCount: 0,
      objectCountByType: {
        lighting: 0,
        outlet: 0,
        panel: 0,
        breaker: 1,
        transformer: 0,
        ground: 0,
        cable: 0,
        conduit: 0,
        equipment: 0,
        annotation: 0,
        unknown: 0,
      },
      warningCount: 0,
    },
    warnings: [],
  };
}

export function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

export async function importElectricalModule<T>(fileName: string): Promise<T> {
  const moduleUrl = new URL(
    `../../src/drawingElectricalObjects/${fileName}.ts`,
    import.meta.url,
  );
  return import(/* @vite-ignore */ fileURLToPath(moduleUrl)) as Promise<T>;
}
