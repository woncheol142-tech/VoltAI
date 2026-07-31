import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(testDirectory, "..", "..", "..");
const readmePath = join(workspaceRoot, "README.md");
const environmentExamplePath = join(workspaceRoot, ".env.example");

const semanticWeightName = "KEC_HYBRID_SEMANTIC_WEIGHT";
const lexicalWeightName = "KEC_HYBRID_LEXICAL_WEIGHT";
const developmentCommand = "pnpm --filter @voltai/mcp-kec dev:hybrid";
const builtCommand = "pnpm --filter @voltai/mcp-kec start:hybrid";

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function paragraphMatching(
  text: string,
  patterns: readonly RegExp[],
): string | undefined {
  return paragraphs(text).find((paragraph) =>
    patterns.every((pattern) => pattern.test(paragraph)),
  );
}

function markdownSectionContaining(text: string, needle: string): string {
  const needleIndex = text.indexOf(needle);
  if (needleIndex < 0) {
    return "";
  }

  const headingMatches = [...text.matchAll(/^#{1,6}\s+.+$/gmu)];
  const heading = headingMatches.findLast(
    (candidate) => candidate.index <= needleIndex,
  );
  const start = heading?.index ?? 0;
  const headingLevel = heading?.[0].match(/^#+/u)?.[0].length ?? 0;
  const end =
    headingMatches.find(
      (candidate) =>
        candidate.index > needleIndex &&
        (candidate[0].match(/^#+/u)?.[0].length ?? 0) <= headingLevel,
    )?.index ?? text.length;

  return text.slice(start, end);
}

describe("explicit KEC hybrid runtime environment documentation", () => {
  it("provides the approved commented semantic-weight example", () => {
    const lines = readText(environmentExamplePath).split(/\r?\n/u);

    expect(lines).toContain(`# ${semanticWeightName}=0.7`);
  });

  it("provides the approved commented lexical-weight example", () => {
    const lines = readText(environmentExamplePath).split(/\r?\n/u);

    expect(lines).toContain(`# ${lexicalWeightName}=0.3`);
  });

  it("documents no unsupported hybrid environment names", () => {
    const environmentExample = readText(environmentExamplePath);
    const documentedHybridNames = [
      ...new Set(environmentExample.match(/\bKEC_HYBRID_[A-Z0-9_]+\b/gu) ?? []),
    ].sort();

    expect(documentedHybridNames).toEqual(
      [lexicalWeightName, semanticWeightName].sort(),
    );
  });

  it("does not activate hybrid mode or publish unsafe configuration", () => {
    const environmentExample = readText(environmentExamplePath);
    const activeLines = environmentExample
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    expect(activeLines.some((line) => /^KEC_HYBRID_/u.test(line))).toBe(false);
    expect(environmentExample).not.toContain("KEC_HYBRID_ENABLED");
    expect(environmentExample).not.toMatch(
      /\bKEC_HYBRID_(?:WEIGHT|NORMALIZE|NORMALIZED)\b/u,
    );
    expect(environmentExample).not.toMatch(
      /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\s*=/u,
    );
    expect(environmentExample).not.toMatch(/\/Users\/|[A-Za-z]:\\/u);
  });
});

describe("explicit KEC hybrid runtime README contract", () => {
  it("documents both opt-in launch commands and an executable example", () => {
    const readme = readText(readmePath);

    expect(readme).toContain(developmentCommand);
    expect(readme).toContain(builtCommand);
    expect(readme).toMatch(
      /KEC_HYBRID_SEMANTIC_WEIGHT=0\.7\s*\\\s*\nKEC_HYBRID_LEXICAL_WEIGHT=0\.3\s*\\\s*\npnpm --filter @voltai\/mcp-kec dev:hybrid/u,
    );
  });

  it("separates the legacy three-tool runtime from the explicit four-tool runtime", () => {
    const readme = readText(readmePath);
    const defaultStatement = paragraphMatching(readme, [
      /default/iu,
      /legacy[- ]only/iu,
      /kec_placeholder/u,
      /index_kec/u,
      /search_kec/u,
    ]);
    const hybridSection = markdownSectionContaining(readme, developmentCommand);

    expect(defaultStatement).toBeDefined();
    expect(defaultStatement).not.toContain("search_kec_hybrid");
    expect(hybridSection).toContain("kec_placeholder");
    expect(hybridSection).toContain("index_kec");
    expect(hybridSection).toContain("search_kec");
    expect(hybridSection).toContain("search_kec_hybrid");
  });

  it("defines fail-closed weight validation without normalization", () => {
    const readme = readText(readmePath);

    expect(readme).toContain(semanticWeightName);
    expect(readme).toContain(lexicalWeightName);
    expect(
      paragraphMatching(readme, [
        /both/iu,
        /weight|value/iu,
        /required/iu,
        /finite/iu,
        /non-?negative/iu,
        /decimal/iu,
        /at least one/iu,
        /positive|greater than zero/iu,
        /not normalized|no automatic normalization/iu,
      ]),
    ).toBeDefined();
    expect(
      paragraphMatching(readme, [
        /invalid/iu,
        /fail/iu,
        /before|prior to/iu,
        /stdio|transport/iu,
      ]),
    ).toBeDefined();
  });

  it("documents existing provider authority without implying installation", () => {
    const readme = readText(readmePath);

    expect(
      paragraphMatching(readme, [
        /provider selection/iu,
        /existing/iu,
        /configuration/iu,
      ]),
    ).toBeDefined();
    expect(
      paragraphMatching(readme, [
        /placeholder/iu,
        /transport|pipeline/iu,
        /only/iu,
      ]),
    ).toBeDefined();
    expect(
      paragraphMatching(readme, [
        /ollama/iu,
        /real local embedding/iu,
        /separately configured|separate configuration/iu,
      ]),
    ).toBeDefined();
    expect(readme).toMatch(/does not install ollama|ollama is not installed/iu);
    expect(readme).toMatch(
      /does not (?:install ollama or )?validate (?:ollama )?model availability/iu,
    );
  });

  it("states that runtime availability is not retrieval-quality evidence", () => {
    const readme = readText(readmePath);

    expect(
      paragraphMatching(readme, [
        /runtime availability/iu,
        /does not establish|is not/iu,
        /retrieval quality/iu,
      ]),
    ).toBeDefined();
    expect(
      paragraphMatching(readme, [
        /placeholder/iu,
        /semantic score/iu,
        /not.*(?:quality )?evidence|does not.*evidence/iu,
      ]),
    ).toBeDefined();
    expect(
      paragraphMatching(readme, [
        /meaningful quality evaluation/iu,
        /representative KEC corpus/iu,
        /real embedding provider/iu,
      ]),
    ).toBeDefined();
    expect(
      paragraphMatching(readme, [
        /no |does not make/iu,
        /recall/iu,
        /MRR/u,
        /NDCG/u,
        /ranking threshold/iu,
        /production[- ]quality claim/iu,
      ]),
    ).toBeDefined();
  });

  it("documents opt-in operation and existing per-call lifecycle safety", () => {
    const readme = readText(readmePath);

    expect(
      paragraphMatching(readme, [
        /hybrid runtime/iu,
        /opt[- ]in/iu,
        /default runtime/iu,
        /legacy[- ]only/iu,
      ]),
    ).toBeDefined();
    expect(readme).toMatch(
      /no automatic reindex|does not automatically reindex/iu,
    );
    expect(
      paragraphMatching(readme, [
        /database/iu,
        /provider/iu,
        /per tool call|per-call/iu,
        /existing|Task 53/iu,
      ]),
    ).toBeDefined();
    expect(readme).not.toContain("KEC_HYBRID_ENABLED");
    expect(readme).not.toMatch(/\/Users\/|[A-Za-z]:\\/u);
    expect(readme).not.toMatch(/\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\s*=\S+/u);
  });
});
