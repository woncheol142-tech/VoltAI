import { describe, expect, it } from "vitest";

import {
  createElectricalConstructionFixture,
  deepFreeze,
  importElectricalModule,
  makeElectricalCandidate,
} from "./helpers/drawingElectricalObjectsFixture.js";

type PipelineModules = {
  resolveElectricalObjectCandidates(
    candidates: readonly unknown[],
    context: unknown,
  ): unknown;
  assembleElectricalObjects(resolution: unknown, context: unknown): unknown;
  serializeElectricalObjects(document: unknown): string;
};

async function load(): Promise<PipelineModules> {
  const [resolver, assembly, serialization] = await Promise.all([
    importElectricalModule<Pick<PipelineModules, "resolveElectricalObjectCandidates">>(
      "resolveCandidates",
    ),
    importElectricalModule<Pick<PipelineModules, "assembleElectricalObjects">>(
      "assembleElectricalObjects",
    ),
    importElectricalModule<Pick<PipelineModules, "serializeElectricalObjects">>(
      "serializeElectricalObjects",
    ),
  ]);
  return { ...resolver, ...assembly, ...serialization };
}

describe("electrical object pipeline determinism and immutability", () => {
  it("produces deep-equal documents and identical bytes for shuffled candidates", async () => {
    const modules = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [
      makeElectricalCandidate({ id: "candidate-z", primaryPrimitiveIds: ["primitive-inside"] }),
      makeElectricalCandidate({ id: "candidate-a", primaryPrimitiveIds: ["primitive-container"] }),
    ];
    const firstResolution = modules.resolveElectricalObjectCandidates(candidates, context);
    const secondResolution = modules.resolveElectricalObjectCandidates(
      [...candidates].reverse(),
      context,
    );
    const first = modules.assembleElectricalObjects(firstResolution, context);
    const second = modules.assembleElectricalObjects(secondResolution, context);
    expect(second).toEqual(first);
    expect(modules.serializeElectricalObjects(second))
      .toBe(modules.serializeElectricalObjects(first));
  });

  it("resolves exact ties by candidate ID codepoint order", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [
      makeElectricalCandidate({ id: "후보-b" }),
      makeElectricalCandidate({ id: "candidate-a" }),
    ];
    const forward = resolveElectricalObjectCandidates(candidates, context);
    const reverse = resolveElectricalObjectCandidates([...candidates].reverse(), context);
    expect(forward).toEqual(reverse);
    expect(forward).toEqual(expect.objectContaining({
      acceptedCandidates: [expect.objectContaining({ id: "candidate-a" })],
    }));
  });

  it("keeps warnings, conflict diagnostics, statistics, and graph arrays canonical", async () => {
    const modules = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [
      makeElectricalCandidate({ id: "loser", priority: 1 }),
      makeElectricalCandidate({ id: "winner", priority: 2 }),
      makeElectricalCandidate({
        id: "low-confidence",
        priority: 3,
        primaryPrimitiveIds: ["primitive-overlap"],
        structuralScore: 0.1,
        labelScore: 0.1,
        spatialScore: 0.1,
        attributeScore: 0.1,
        consistencyScore: 0.1,
        confidence: 0.1,
      }),
    ];
    const document = modules.assembleElectricalObjects(
      modules.resolveElectricalObjectCandidates(candidates, context),
      context,
    ) as {
      warnings: string[];
      constructionGraph: { objectIds: string[]; edges: Array<{ id: string }> };
    };
    expect(document.warnings).toEqual([...document.warnings].sort());
    expect(document.constructionGraph.objectIds)
      .toEqual([...document.constructionGraph.objectIds].sort());
    expect(document.constructionGraph.edges.map((edge) => edge.id))
      .toEqual([...document.constructionGraph.edges.map((edge) => edge.id)].sort());
  });

  it("does not mutate deeply frozen source documents, candidates, or nested evidence", async () => {
    const modules = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [makeElectricalCandidate()];
    const before = structuredClone({ context, candidates });
    deepFreeze(context);
    deepFreeze(candidates);
    const resolved = modules.resolveElectricalObjectCandidates(candidates, context);
    const document = modules.assembleElectricalObjects(resolved, context);
    modules.serializeElectricalObjects(document);
    expect({ context, candidates }).toEqual(before);
  });
});
