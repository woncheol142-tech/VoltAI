import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CONTEXT_SEARCH_TERMINATIONS,
  DETECTOR_ORDER,
  FRAGMENT_ROLES,
  OBSERVATION_KINDS,
  SUPPRESSED_BLOCKS,
} from "./fixtures/sourceCaptureContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedNewProductionPaths = [
  join(packageRoot, "src", "knowledge", "sourceCapture.ts"),
  join(packageRoot, "src", "requirementSnapshot", "captureCodec.ts"),
  join(packageRoot, "src", "requirementSnapshot", "migrate.ts"),
] as const;
const existingTask93ProductionPaths = [
  join(packageRoot, "src", "knowledge", "requirementExtraction.ts"),
  join(packageRoot, "src", "requirementSnapshot", "schema.ts"),
  join(packageRoot, "src", "requirementSnapshot", "store.ts"),
  join(packageRoot, "src", "requirementSnapshot", "errors.ts"),
  join(packageRoot, "src", "requirementSnapshot", "index.ts"),
] as const;
const completeProductionExists = expectedNewProductionPaths.every(existsSync);

function combinedProductionSource(): string {
  return [...existingTask93ProductionPaths, ...expectedNewProductionPaths]
    .filter(existsSync)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

describe("Task93 frozen mechanical vocabulary", () => {
  it("freezes exactly three observation kinds", () => {
    expect(OBSERVATION_KINDS).toEqual([
      "column-gap-region-excluded",
      "suppressed-assembly",
      "requirement-assembly",
    ]);
  });

  it("freezes detector set order without precedence or winner", () => {
    expect(DETECTOR_ORDER).toEqual([
      "normative-sentence-ending",
      "explicit-context-lead",
      "short-heading-adjacent",
    ]);
  });

  it("freezes exact fragment, termination, and barrier vocabularies", () => {
    expect(FRAGMENT_ROLES).toEqual([
      "normative-pattern-fragment",
      "attached-context-fragment",
      "unattached-context-candidate",
    ]);
    expect(CONTEXT_SEARCH_TERMINATIONS).toEqual([
      "page-start",
      "structural-region-boundary",
      "preceding-normative-paragraph",
      "preceding-non-context-candidate",
    ]);
    expect(CONTEXT_SEARCH_TERMINATIONS).not.toContain(
      "non-candidate-paragraph",
    );
    expect(SUPPRESSED_BLOCKS).toEqual(["gap-not-positive", "gap-above-window"]);
  });
});

describe.runIf(completeProductionExists)("Task93 production firewalls", () => {
  it("adds only mechanical capture infrastructure and no query or Task86 implementation", () => {
    const source = combinedProductionSource();
    expect(source).not.toMatch(
      /KnowledgeQueryPort|Task86|searchKec|search_kec|\bLIKE\b|\bMATCH\b|\bFTS\b|embedding|vector|similarity|topK|score|rank|weight|relevance/iu,
    );
  });

  it("adds no applicability or structured-condition interpretation", () => {
    const source = combinedProductionSource();
    expect(source).not.toMatch(
      /RequirementApplicability|condition AST|scope ontology|exception model|context dimensions|numeric predicate|unit predicate|StructuredCondition/iu,
    );
    expect(source).not.toMatch(/Task94/iu);
  });

  it("adds no governance, resolution, or current-state semantics", () => {
    const source = combinedProductionSource();
    expect(source).not.toMatch(
      /RequirementAuthority|RequirementPrecedence|RequirementWinner|CurrentRequirement|LatestRequirement|EffectiveRequirement|PromotionGate|ResolutionJudgement|\bDecision\b|Llm(?:Client|Port|Service)|@voltai\/(?:resolution-core|validation-core|promotion-core|decision-sqlite)/u,
    );
  });

  it("adds no synthetic identity, timestamp, SourceRegistry, or raw-source payload", () => {
    const source = combinedProductionSource();
    expect(source).not.toMatch(
      /CaptureRunId|RequirementPopulationId|RequirementCandidate|SourceRegistry|randomUUID|Math\.random|Date\.now|created_at|timestamp|rawPdfBytes|characterOffset|glyphGeometry/iu,
    );
  });

  it("keeps acquisition out of capture persistence", () => {
    const persistenceSource = [
      ...expectedNewProductionPaths.slice(1),
      ...existingTask93ProductionPaths.slice(1),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(persistenceSource).not.toMatch(
      /pdfjs-dist|projectPath|readFile|readKecPdfBytes|parseKecPdfTextItems|SourceRegistry/iu,
    );
  });

  it("uses one physical DB without ATTACH or a second capture DB owner", () => {
    const source = combinedProductionSource();
    expect(source).not.toMatch(
      /ATTACH\s+DATABASE|DETACH\s+DATABASE|CaptureDatabase|captureDbPath/iu,
    );
  });

  it("uses no FK, CHECK, or trigger for v2 semantic enforcement", () => {
    const schemaSource = readFileSync(
      join(packageRoot, "src", "requirementSnapshot", "schema.ts"),
      "utf8",
    );
    expect(schemaSource).not.toMatch(
      /CREATE\s+TRIGGER|FOREIGN\s+KEY|CHECK\s*\(/iu,
    );
  });

  it("keeps explicit migration free of CLI, default paths, and discovery", () => {
    const migrationSource = readFileSync(expectedNewProductionPaths[2], "utf8");
    expect(migrationSource).not.toMatch(
      /process\.argv|PROJECT_ROOT|\.volt-ai|\.voltai|readdir|glob|defaultPath|commander|yargs/iu,
    );
  });

  it("bounds each constructor integrity audit with LIMIT 1", () => {
    const storeSource = readFileSync(
      join(packageRoot, "src", "requirementSnapshot", "store.ts"),
      "utf8",
    );
    expect(storeSource).toMatch(
      /FROM\s+kec_requirement_snapshot_members\b[\s\S]*?LEFT\s+JOIN\s+kec_requirement_snapshots\b[\s\S]*?LIMIT\s+1/iu,
    );
    expect(storeSource).toMatch(
      /FROM\s+kec_requirement_snapshot_captures\b[\s\S]*?LEFT\s+JOIN\s+kec_requirement_snapshots\b[\s\S]*?LIMIT\s+1/iu,
    );
    expect(storeSource).toMatch(
      /FROM\s+kec_requirement_snapshot_capture_observations\b[\s\S]*?LEFT\s+JOIN\s+kec_requirement_snapshot_captures\b[\s\S]*?LIMIT\s+1/iu,
    );
    expect(storeSource).toMatch(
      /FROM\s+kec_requirement_snapshot_capture_observations\b[\s\S]*?\bkind\b[\s\S]*?LIMIT\s+1/iu,
    );
  });
});
