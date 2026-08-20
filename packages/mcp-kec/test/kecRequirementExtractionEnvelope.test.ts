import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRequirementPdfFixture,
  deterministicKoreanPdfBytes,
  explicitSourceRevision,
  type RequirementPdfFixture,
} from "./fixtures/requirementExtractionContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const producerPath = join(
  packageRoot,
  "src",
  "knowledge",
  "requirementExtraction.ts",
);
const producerSource = readFileSync(producerPath, "utf8");
const hasEnvelopeApi =
  /export\s+(?:async\s+)?function\s+extractKecRequirementSnapshot\b/u.test(
    producerSource,
  ) &&
  /export\s+type\s+KecRequirementExtractionBinding\b/u.test(producerSource) &&
  /export\s+type\s+KecRequirementExtractionSnapshot\b/u.test(producerSource);
const fixtures: RequirementPdfFixture[] = [];

type ProducerModule = {
  readonly KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID: string;
  readonly KEC_REQUIREMENT_LOCATOR_SPACE: string;
  readonly extractKecRequirements: (
    input: unknown,
  ) => Promise<readonly unknown[]>;
  readonly extractKecRequirementSnapshot?: (input: unknown) => Promise<{
    readonly binding: Record<string, unknown>;
    readonly requirements: readonly {
      readonly provenance: {
        readonly sourceRevision: unknown;
        readonly lineage: {
          readonly input: unknown;
          readonly contract: unknown;
        };
        readonly locatorSpace: unknown;
      };
    }[];
  }>;
};

async function loadProducer(): Promise<ProducerModule> {
  return import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/knowledge/requirementExtraction.ts", import.meta.url),
    )
  ) as Promise<ProducerModule>;
}

function createFixture(bytes: Uint8Array): RequirementPdfFixture {
  const fixture = createRequirementPdfFixture(bytes);
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe("Task91 additive extraction-envelope RED gate", () => {
  it("fails explicitly until all additive producer exports exist", async () => {
    const producer = await loadProducer();
    const missing = [
      typeof producer.extractKecRequirementSnapshot === "function"
        ? null
        : "extractKecRequirementSnapshot",
      /export\s+type\s+KecRequirementExtractionBinding\b/u.test(producerSource)
        ? null
        : "KecRequirementExtractionBinding",
      /export\s+type\s+KecRequirementExtractionSnapshot\b/u.test(producerSource)
        ? null
        : "KecRequirementExtractionSnapshot",
    ].filter(Boolean);

    expect(
      missing,
      "Task91 additive extraction-envelope API is missing from packages/mcp-kec/src/knowledge/requirementExtraction.ts",
    ).toEqual([]);
  });

  it("keeps the Task90 API and frozen identifiers intact", async () => {
    const producer = await loadProducer();
    expect(producer.extractKecRequirements).toBeTypeOf("function");
    expect(producer.KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID).toBe(
      "kec:pdfjs-structural-normative-paragraphs:v1",
    );
    expect(producer.KEC_REQUIREMENT_LOCATOR_SPACE).toBe(
      "kec:pdf-text-item-span:v1",
    );
  });

  it("freezes one bytes acquisition feeding both hash and parse", () => {
    expect(existsSync(producerPath)).toBe(true);
    expect(
      producerSource.match(/readKecPdfBytes\(absolutePdfPath\)/gu),
    ).toHaveLength(1);
    expect(producerSource.match(/sourceBlobHash\(bytes\)/gu)).toHaveLength(1);
    expect(
      producerSource.match(/parseKecPdfTextItems\(bytes\)/gu),
    ).toHaveLength(1);
    expect(producerSource).toMatch(
      /const bytes = await readKecPdfBytes\(absolutePdfPath\);\s*const blobHash = sourceBlobHash\(bytes\);\s*const pages = await parseKecPdfTextItems\(bytes\);/u,
    );
  });
});

describe.runIf(hasEnvelopeApi)("Task91 extraction envelope behavior", () => {
  it("returns exact binding and snapshot keys for an empty extraction", async () => {
    const producer = await loadProducer();
    const fixture = createFixture(
      deterministicKoreanPdfBytes("이 문장은 설명 자료일 뿐이다"),
    );
    const sourceRevision = explicitSourceRevision();
    const snapshot = await producer.extractKecRequirementSnapshot!({
      projectRoot: fixture.projectRoot,
      sourceLocator: fixture.firstLocator,
      sourceRevision,
    });

    expect(Object.keys(snapshot).sort()).toEqual(["binding", "requirements"]);
    expect(Object.keys(snapshot.binding).sort()).toEqual([
      "blobHash",
      "extractionContract",
      "locatorSpace",
      "sourceRevision",
    ]);
    expect(snapshot.binding).toEqual({
      sourceRevision,
      blobHash: {
        algorithm: "sha-256",
        digest: createHash("sha256").update(fixture.bytes).digest("hex"),
      },
      extractionContract: "kec:pdfjs-structural-normative-paragraphs:v1",
      locatorSpace: "kec:pdf-text-item-span:v1",
    });
    expect(snapshot.requirements).toEqual([]);
  });

  it("deep-equals legacy extraction and preserves every member binding", async () => {
    const producer = await loadProducer();
    const fixture = createFixture(deterministicKoreanPdfBytes());
    const input = {
      projectRoot: fixture.projectRoot,
      sourceLocator: fixture.firstLocator,
      sourceRevision: explicitSourceRevision(),
    };
    const snapshot = await producer.extractKecRequirementSnapshot!(input);
    const legacy = await producer.extractKecRequirements(input);

    expect(snapshot.requirements).toEqual(legacy);
    for (const member of snapshot.requirements) {
      expect(member.provenance.sourceRevision).toEqual(
        snapshot.binding.sourceRevision,
      );
      expect(member.provenance.lineage.input).toEqual(
        snapshot.binding.blobHash,
      );
      expect(member.provenance.lineage.contract).toBe(
        snapshot.binding.extractionContract,
      );
      expect(member.provenance.locatorSpace).toBe(
        snapshot.binding.locatorSpace,
      );
    }
  });
});
