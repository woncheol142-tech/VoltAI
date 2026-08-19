import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AnchorLocatorSpace,
  ExtractionContractId,
  ExtractionLineage,
} from "../../extraction-core/src/index.js";
import type { Requirement } from "../../knowledge-core/src/index.js";
import type {
  ExternalSourceLocator,
  SourceRevision,
} from "../../source-core/src/index.js";
import * as ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAINED_CONTEXT_REQUIREMENT,
  CONTEXTUAL_REQUIREMENTS,
  createRequirementPdfFixture,
  DUPLICATE_AUTHORED_REQUIREMENT,
  EXPECTED_AUTHORED_REQUIREMENTS,
  explicitSourceRevision,
  LIVE_PDF_REQUIREMENT,
  NON_NORMATIVE_MODAL_REFERENCES,
  type PdfTextPlacement,
  type RequirementPdfFixture,
  TABLE_ONLY_NORMATIVE_TEXT,
  TASK90_EXTRACTION_CONTRACT_ID,
  TASK90_LOCATOR_SPACE,
  deterministicKoreanPdfBytes,
} from "./fixtures/requirementExtractionContracts.js";

const infrastructure = vi.hoisted(() => ({
  acquiredSnapshots: [] as Uint8Array[],
  parsedSnapshots: [] as Uint8Array[],
  parsedSnapshotCopies: [] as Uint8Array[],
  parsedSnapshotConstructors: [] as Array<Uint8ArrayConstructor>,
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  infrastructure.readFile.mockImplementation(async (...args: unknown[]) => {
    const bytes = (await Reflect.apply(actual.readFile, undefined, args)) as
      | Uint8Array
      | string;
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("Task90 tests expect byte-based file acquisition");
    }
    infrastructure.acquiredSnapshots.push(bytes);
    return bytes;
  });

  return { ...actual, readFile: infrastructure.readFile };
});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();

  return {
    ...actual,
    getDocument: (source: Parameters<typeof actual.getDocument>[0]) => {
      if (
        typeof source === "object" &&
        source !== null &&
        "data" in source &&
        source.data instanceof Uint8Array
      ) {
        infrastructure.parsedSnapshots.push(source.data);
        infrastructure.parsedSnapshotCopies.push(source.data.slice());
        infrastructure.parsedSnapshotConstructors.push(source.data.constructor);
      }
      return actual.getDocument(source);
    },
  };
});

type KecRequirementLocatorContract = {
  readonly pageNumber: number;
  readonly startItemIndex: number;
  readonly endItemIndexExclusive: number;
};

type KecRequirementExtractionContract = {
  readonly requirement: Requirement<string, string>;
  readonly provenance: {
    readonly sourceRevision: SourceRevision;
    readonly lineage: ExtractionLineage;
    readonly locatorSpace: AnchorLocatorSpace;
    readonly locators: readonly [
      KecRequirementLocatorContract,
      ...KecRequirementLocatorContract[],
    ];
  };
};

type ExtractInputContract = {
  readonly projectRoot: string;
  readonly sourceRevision: SourceRevision;
  readonly sourceLocator: ExternalSourceLocator;
};

type RequirementExtractionModule = {
  readonly KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID: ExtractionContractId;
  readonly KEC_REQUIREMENT_LOCATOR_SPACE: AnchorLocatorSpace;
  readonly extractKecRequirements: (
    input: ExtractInputContract,
  ) => Promise<readonly KecRequirementExtractionContract[]>;
};

type ObservedPdfTextItem = {
  readonly str: string;
  readonly x: number;
  readonly width: number;
  readonly height: number;
};

const persistenceMutationPatterns = [
  /\bCREATE\s+(?:TABLE|INDEX|TRIGGER)\b/iu,
  /\bALTER\s+TABLE\b/iu,
  /\bDROP\s+(?:TABLE|INDEX|TRIGGER)\b/iu,
  /\bINSERT\s+INTO\b/iu,
  /\bDELETE\s+FROM\b/iu,
  /\bREPLACE\s+INTO\b/iu,
  /\bUPDATE\s+[A-Za-z_][A-Za-z0-9_.]*\s+SET\b/iu,
] as const;

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const producerPath = join(
  packageRoot,
  "src",
  "knowledge",
  "requirementExtraction.ts",
);
const contractFixturePath = join(
  testDirectory,
  "fixtures",
  "requirementExtractionContracts.ts",
);
const producerExists = existsSync(producerPath);
const tempFixtures: RequirementPdfFixture[] = [];

function createPdfFixture(
  bytes = deterministicKoreanPdfBytes(),
): RequirementPdfFixture {
  const fixture = createRequirementPdfFixture(bytes);
  tempFixtures.push(fixture);
  return fixture;
}

function fixtureFromPlacements(
  placements: readonly PdfTextPlacement[],
): RequirementPdfFixture {
  return createPdfFixture(deterministicKoreanPdfBytes(placements));
}

function containsPersistenceMutation(source: string): boolean {
  return persistenceMutationPatterns.some((pattern) => pattern.test(source));
}

async function observeRealPdfTextItems(
  bytes: Uint8Array,
): Promise<readonly ObservedPdfTextItem[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;

  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();

    return content.items.flatMap((item): ObservedPdfTextItem[] => {
      if (!("str" in item)) return [];

      return [
        {
          str: item.str,
          x: item.transform[4]!,
          width: item.width,
          height: item.height,
        },
      ];
    });
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }
}

async function loadProducer(): Promise<RequirementExtractionModule> {
  return import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/knowledge/requirementExtraction.ts", import.meta.url),
    )
  ) as Promise<RequirementExtractionModule>;
}

function inputFor(
  fixture: RequirementPdfFixture,
  sourceRevision = explicitSourceRevision(),
  sourceLocator = fixture.firstLocator,
): ExtractInputContract {
  return {
    projectRoot: fixture.projectRoot,
    sourceRevision,
    sourceLocator,
  };
}

function statements(
  results: readonly KecRequirementExtractionContract[],
): string[] {
  return results.map(({ requirement }) => requirement.statement);
}

function ids(results: readonly KecRequirementExtractionContract[]): string[] {
  return results.map(({ requirement }) => requirement.id);
}

function diagnosticsText(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      if (!diagnostic.file || diagnostic.start === undefined) return message;
      const position = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      return `${relative(workspaceRoot, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`;
    })
    .join("\n");
}

function packageManifest(packageName: string): {
  readonly dependencies?: Readonly<Record<string, string>>;
} {
  return JSON.parse(
    readFileSync(
      join(workspaceRoot, "packages", packageName, "package.json"),
      "utf8",
    ),
  ) as { readonly dependencies?: Readonly<Record<string, string>> };
}

afterEach(() => {
  for (const fixture of tempFixtures.splice(0)) fixture.cleanup();
  infrastructure.acquiredSnapshots.splice(0);
  infrastructure.parsedSnapshots.splice(0);
  infrastructure.parsedSnapshotCopies.splice(0);
  infrastructure.parsedSnapshotConstructors.splice(0);
  vi.clearAllMocks();
});

describe("Task90 production Requirement extraction RED gate", () => {
  it("fails non-vacuously until the source-first production module exists", () => {
    expect(
      producerExists,
      "Task90 production Requirement extraction module/function is absent: packages/mcp-kec/src/knowledge/requirementExtraction.ts",
    ).toBe(true);
  });
});

describe.runIf(producerExists)(
  "Task90 KEC Requirement extraction contract",
  () => {
    it("exports only the live producer and result-domain contracts", async () => {
      const producer = await loadProducer();
      const source = readFileSync(producerPath, "utf8");

      expect(producer.extractKecRequirements).toBeTypeOf("function");
      expect(producer.extractKecRequirements).toHaveLength(1);
      expect(producer.KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID).toBe(
        TASK90_EXTRACTION_CONTRACT_ID,
      );
      expect(producer.KEC_REQUIREMENT_LOCATOR_SPACE).toBe(TASK90_LOCATOR_SPACE);
      expect(source).not.toMatch(
        /export\s+type\s+(?:KecRequirementExtractionSeams|KecPdfTextItem|KecPdfTextPage)\b/u,
      );
      expect(source).not.toMatch(
        /__testSeams|TestHooks|InternalRequirementExtractor|RequirementExtractionFactory|createExtractorForTesting|RequirementExtractionPort|RequirementExtractor\s*</u,
      );
    });

    it("type-checks the corrected source-first public contract against actual foundation types", () => {
      expect(existsSync(contractFixturePath)).toBe(true);

      const program = ts.createProgram({
        rootNames: [contractFixturePath],
        options: {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ES2022,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          customConditions: ["voltai-source"],
        },
      });

      expect(program.getRootFileNames()).toContain(contractFixturePath);
      expect(program.getSourceFile(contractFixturePath)).toBeDefined();
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics, diagnosticsText(diagnostics)).toEqual([]);
    });

    it("freezes the allowed mcp-kec dependency direction without predecessor cycles", () => {
      const mcpKec = packageManifest("mcp-kec");
      const sourceCore = packageManifest("source-core");
      const extractionCore = packageManifest("extraction-core");

      expect(mcpKec.dependencies).toMatchObject({
        "@voltai/extraction-core": "workspace:*",
        "@voltai/knowledge-core": "workspace:*",
        "@voltai/source-core": "workspace:*",
      });
      expect(sourceCore.dependencies ?? {}).not.toHaveProperty(
        "@voltai/mcp-kec",
      );
      expect(extractionCore.dependencies ?? {}).not.toHaveProperty(
        "@voltai/mcp-kec",
      );
    });

    it("uses one internal pdf.js TextItem implementation and excludes flattened, chunk, and search seams", () => {
      const source = readFileSync(producerPath, "utf8");

      expect(source).toMatch(/pdfjs-dist\/legacy\/build\/pdf\.mjs/u);
      expect(source).toMatch(/getDocument/u);
      expect(source).toMatch(/getTextContent/u);
      expect(source).toMatch(/\.items\b/u);
      expect(source).toMatch(/\.transform\b/u);
      expect(source).not.toMatch(
        /readPdfPages|createPageChunks|\bKecChunk\b|\bchunkIndex\b|KnowledgeSearchResult|KecSearchResult|similarity|semanticScore|lexicalScore|\brank\b|\btopK\b|\bquery\b/iu,
      );
    });

    it("extracts a live Requirement through real filesystem acquisition and real pdf.js parsing", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const sourceRevision = explicitSourceRevision();
      const results = await producer.extractKecRequirements(
        inputFor(fixture, sourceRevision),
      );

      expect(statements(results)).toContain(LIVE_PDF_REQUIREMENT);
      const result = results.find(
        ({ requirement }) => requirement.statement === LIVE_PDF_REQUIREMENT,
      );
      expect(result).toBeDefined();
      expect(result?.provenance.sourceRevision).toEqual(sourceRevision);
      expect(result?.provenance.locators.length).toBeGreaterThan(0);
      expect(infrastructure.acquiredSnapshots).toHaveLength(1);
      expect(infrastructure.parsedSnapshots).toHaveLength(1);
    });

    it("treats a file locator only as safe acquisition input", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const invalidLocators: ExternalSourceLocator[] = [
        { scheme: "https", value: "example.invalid/kec.pdf" },
        { scheme: "file", value: "../outside.pdf" },
        {
          scheme: "file",
          value: join(fixture.projectRoot, "kec", "requirements.pdf"),
        },
      ];

      expect(isAbsolute(invalidLocators[2]!.value)).toBe(true);
      for (const sourceLocator of invalidLocators) {
        await expect(
          producer.extractKecRequirements(
            inputFor(fixture, explicitSourceRevision(), sourceLocator),
          ),
        ).rejects.toThrow(/file|locator|relative|project|path|source/i);
      }
      expect(infrastructure.readFile).not.toHaveBeenCalled();
      expect(infrastructure.parsedSnapshots).toHaveLength(0);
    });

    it("reads the canonical path returned by validation for an in-root symlink", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const aliasRelativePath = "kec/canonical-alias.pdf";
      const aliasPath = join(fixture.projectRoot, aliasRelativePath);
      const canonicalTarget = realpathSync(
        join(fixture.projectRoot, fixture.firstLocator.value),
      );
      const source = readFileSync(producerPath, "utf8");

      symlinkSync("requirements.pdf", aliasPath);
      await producer.extractKecRequirements(
        inputFor(fixture, explicitSourceRevision(), {
          scheme: "file",
          value: aliasRelativePath,
        }),
      );

      expect(infrastructure.readFile).toHaveBeenCalledTimes(1);
      expect(infrastructure.readFile.mock.calls[0]?.[0]).toBe(canonicalTarget);
      expect(infrastructure.readFile.mock.calls[0]?.[0]).not.toBe(aliasPath);
      expect(source).toMatch(
        /const absolutePdfPath = resolveKecPdfPath\(\s*projectRoot,\s*input\.sourceLocator\.value,\s*\);/u,
      );
      expect(source).not.toMatch(
        /resolve\(input\.projectRoot,\s*input\.sourceLocator\.value\)/u,
      );
    });

    it("acquires once, hashes exact bytes with sha-256, and passes the same snapshot to pdf.js", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const source = readFileSync(producerPath, "utf8");
      const results = await producer.extractKecRequirements(inputFor(fixture));
      const expectedDigest = createHash("sha256")
        .update(fixture.bytes)
        .digest("hex");

      expect(infrastructure.readFile).toHaveBeenCalledTimes(1);
      expect(infrastructure.acquiredSnapshots).toHaveLength(1);
      expect(infrastructure.parsedSnapshots).toHaveLength(1);
      expect(Array.from(infrastructure.parsedSnapshotCopies[0]!)).toEqual(
        Array.from(infrastructure.acquiredSnapshots[0]!),
      );
      expect(infrastructure.parsedSnapshotConstructors[0]).toBe(Uint8Array);
      expect(source).toMatch(
        /const bytes = await readKecPdfBytes\(absolutePdfPath\);\s*const blobHash = sourceBlobHash\(bytes\);\s*const pages = await parseKecPdfTextItems\(bytes\);/u,
      );
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.provenance.lineage.input).toEqual({
          algorithm: "sha-256",
          digest: expectedDigest,
        });
      }
    });

    it("binds every Requirement to explicit revision, one lineage/space, and non-empty concrete locators", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const sourceRevision = explicitSourceRevision();
      const results = await producer.extractKecRequirements(
        inputFor(fixture, sourceRevision),
      );

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(Object.keys(result).sort()).toEqual([
          "provenance",
          "requirement",
        ]);
        expect(Object.keys(result.requirement).sort()).toEqual([
          "id",
          "statement",
        ]);
        expect(result.provenance.sourceRevision).toBe(sourceRevision);
        expect(result.provenance.lineage.contract).toBe(
          producer.KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
        );
        expect(result.provenance.locatorSpace).toBe(
          producer.KEC_REQUIREMENT_LOCATOR_SPACE,
        );
        expect(result.provenance.locators.length).toBeGreaterThan(0);
        for (const locator of result.provenance.locators) {
          expect(Object.keys(locator).sort()).toEqual([
            "endItemIndexExclusive",
            "pageNumber",
            "startItemIndex",
          ]);
          expect(locator.pageNumber).toBeGreaterThan(0);
          expect(locator.startItemIndex).toBeGreaterThanOrEqual(0);
          expect(locator.endItemIndexExclusive).toBeGreaterThan(
            locator.startItemIndex,
          );
          expect(locator).not.toHaveProperty("lineage");
          expect(locator).not.toHaveProperty("locatorSpace");
        }
      }
    });

    it("preserves all positive modal and conditional authored wording", async () => {
      const fixture = fixtureFromPlacements(
        EXPECTED_AUTHORED_REQUIREMENTS.map((text, index) => ({
          text,
          x: 72,
          y: 740 - index * 48,
        })),
      );
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));
      const extractedStatements = statements(results);

      for (const authoredStatement of EXPECTED_AUTHORED_REQUIREMENTS) {
        expect(extractedStatements).toContain(authoredStatement);
      }
    });

    it("preserves immediate heading and explicit condition context with multi-locator provenance", async () => {
      const fixture = fixtureFromPlacements([
        { text: "욕실", x: 72, y: 740, size: 14 },
        { text: "전기기기는 방수형으로 시설하여야 한다", x: 72, y: 712 },
        { text: "다음의 경우에는", x: 72, y: 650 },
        { text: "보호장치를 설치하여야 한다", x: 72, y: 622 },
        { text: "조건 X에서는", x: 72, y: 560 },
        { text: "A 방식을 사용할 수 있다", x: 72, y: 532 },
        { text: "다만", x: 72, y: 470 },
        { text: "다음 조건에서는 설치하여서는 아니 된다", x: 72, y: 442 },
      ]);
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));
      const extractedStatements = statements(results);

      expect(extractedStatements).toEqual(CONTEXTUAL_REQUIREMENTS);
      expect(extractedStatements).not.toContain(
        "전기기기는 방수형으로 시설하여야 한다",
      );
      expect(extractedStatements).not.toContain("보호장치를 설치하여야 한다");
      for (const result of results) {
        expect(result.provenance.locators).toHaveLength(2);
        expect(result.provenance.lineage.contract).toBe(
          producer.KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
        );
      }
    });

    it("walks a pairwise-adjacent heading and condition chain in source order", async () => {
      const fixture = fixtureFromPlacements([
        { text: "욕실", x: 72, y: 740, size: 14 },
        { text: "다음의 경우에는", x: 72, y: 712 },
        { text: "전기기기는 방수형으로 시설하여야 한다", x: 72, y: 684 },
      ]);
      const producer = await loadProducer();
      const first = await producer.extractKecRequirements(inputFor(fixture));
      const second = await producer.extractKecRequirements(inputFor(fixture));

      expect(statements(first)).toEqual([CHAINED_CONTEXT_REQUIREMENT]);
      expect(first[0]!.provenance.locators).toHaveLength(3);
      const locatorStarts = first[0]!.provenance.locators.map(
        ({ startItemIndex }) => startItemIndex,
      );
      expect(locatorStarts).toEqual(
        [...locatorStarts].sort((left, right) => left - right),
      );
      expect(new Set(locatorStarts).size).toBe(3);
      expect(first[0]!.requirement.id).toBe(second[0]!.requirement.id);
      expect(readFileSync(producerPath, "utf8")).toMatch(
        /locators\.map\(\(locator\)\s*=>/u,
      );
    });

    it("suppresses a permitted clause behind an unresolved explicit condition barrier", async () => {
      const fixture = fixtureFromPlacements([
        { text: "조건 X에서는", x: 72, y: 740 },
        { text: "A 방식을 사용할 수 있다", x: 72, y: 680 },
      ]);
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));

      expect(results).toEqual([]);
      expect(statements(results)).not.toContain("A 방식을 사용할 수 있다");
    });

    it("suppresses a required clause behind an unresolved explicit condition barrier", async () => {
      const fixture = fixtureFromPlacements([
        { text: "다음의 경우에는", x: 72, y: 740 },
        { text: "보호장치를 설치하여야 한다", x: 72, y: 680 },
      ]);
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));

      expect(results).toEqual([]);
      expect(statements(results)).not.toContain("보호장치를 설치하여야 한다");
    });

    it.each(["참고", "예시"])(
      "does not attach the meta label %s as normative scope",
      async (metaLabel) => {
        const independentClause = "전기기기는 방수형으로 시설하여야 한다";
        const fixture = fixtureFromPlacements([
          { text: metaLabel, x: 72, y: 740 },
          { text: independentClause, x: 72, y: 712 },
        ]);
        const producer = await loadProducer();
        const results = await producer.extractKecRequirements(
          inputFor(fixture),
        );

        expect(statements(results)).toEqual([independentClause]);
        expect(results[0]!.provenance.locators).toHaveLength(1);
      },
    );

    it("rejects quoted, descriptive, and metalinguistic modal substrings", async () => {
      const fixture = fixtureFromPlacements(
        NON_NORMATIVE_MODAL_REFERENCES.map((text, index) => ({
          text,
          x: 72,
          y: 720 - index * 48,
        })),
      );
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));

      expect(results).toEqual([]);
    });

    it("reconstructs and emits a normative modal split across TextItems", async () => {
      const fixture = fixtureFromPlacements([
        { text: "배선은 시설하여야", x: 72, y: 720 },
        { text: "한다", x: 210, y: 720 },
      ]);
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));

      expect(statements(results)).toEqual(["배선은 시설하여야 한다"]);
      expect(
        results[0]!.provenance.locators[0].endItemIndexExclusive -
          results[0]!.provenance.locators[0].startItemIndex,
      ).toBeGreaterThanOrEqual(2);
    });

    it("is deterministic for the same bytes, SourceRevision, and ExtractionContract", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const sourceRevision = explicitSourceRevision();

      const first = await producer.extractKecRequirements(
        inputFor(fixture, sourceRevision),
      );
      const second = await producer.extractKecRequirements(
        inputFor(fixture, sourceRevision),
      );

      expect(ids(second)).toEqual(ids(first));
      expect(statements(second)).toEqual(statements(first));
    });

    it("does not derive Requirement identity from path renames", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const sourceRevision = explicitSourceRevision();

      const original = await producer.extractKecRequirements(
        inputFor(fixture, sourceRevision, fixture.firstLocator),
      );
      const renamed = await producer.extractKecRequirements(
        inputFor(fixture, sourceRevision, fixture.renamedLocator),
      );

      expect(ids(renamed)).toEqual(ids(original));
      expect(statements(renamed)).toEqual(statements(original));
    });

    it("keeps query, topK, and embedding changes outside extraction identity", async () => {
      const fixture = createPdfFixture();
      const producer = await loadProducer();
      const sourceRevision = explicitSourceRevision();
      const firstInput = {
        ...inputFor(fixture, sourceRevision),
        query: "접지",
        topK: 1,
        embedding: { provider: "first", model: "alpha" },
      } as ExtractInputContract;
      const secondInput = {
        ...inputFor(fixture, sourceRevision),
        query: "차단기",
        topK: 99,
        embedding: { provider: "second", model: "omega" },
      } as ExtractInputContract;

      const first = await producer.extractKecRequirements(firstInput);
      const second = await producer.extractKecRequirements(secondInput);

      expect(ids(second)).toEqual(ids(first));
      expect(statements(second)).toEqual(statements(first));
    });

    it("distinguishes duplicate authored text at different structural positions", async () => {
      const fixture = fixtureFromPlacements([
        { text: DUPLICATE_AUTHORED_REQUIREMENT, x: 72, y: 720 },
        { text: DUPLICATE_AUTHORED_REQUIREMENT, x: 72, y: 670 },
      ]);
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));

      expect(statements(results)).toEqual([
        DUPLICATE_AUTHORED_REQUIREMENT,
        DUPLICATE_AUTHORED_REQUIREMENT,
      ]);
      expect(results[0]?.requirement.id).not.toBe(results[1]?.requirement.id);
      expect(results[0]?.provenance.locators).not.toEqual(
        results[1]?.provenance.locators,
      );
    });

    it("suppresses real pdf.js table rows despite whitespace bridge TextItems", async () => {
      const tableNumericRequirement = "표 전류는 70 A 이하이어야 한다";
      const fixture = fixtureFromPlacements([
        { text: "항목", x: 72, y: 720 },
        { text: "요구사항", x: 300, y: 720 },
        { text: "배선", x: 72, y: 695 },
        { text: TABLE_ONLY_NORMATIVE_TEXT, x: 300, y: 695 },
        { text: "보호", x: 72, y: 670 },
        { text: tableNumericRequirement, x: 300, y: 670 },
        { text: "정격전류는 80 A 이하이어야 한다", x: 72, y: 610 },
      ]);
      const producer = await loadProducer();
      const observedItems = await observeRealPdfTextItems(fixture.bytes);
      const extractedStatements = statements(
        await producer.extractKecRequirements(inputFor(fixture)),
      );

      expect(observedItems.slice(0, 3)).toEqual([
        { str: "항목", x: 72, width: 24, height: 12 },
        { str: " ", x: 96, width: 204, height: 0 },
        { str: "요구사항", x: 300, width: 48, height: 12 },
      ]);
      expect(
        extractedStatements.some((statement) =>
          statement.includes(TABLE_ONLY_NORMATIVE_TEXT),
        ),
      ).toBe(false);
      expect(
        extractedStatements.some((statement) =>
          statement.includes(tableNumericRequirement),
        ),
      ).toBe(false);
      expect(extractedStatements).toEqual([
        "정격전류는 80 A 이하이어야 한다",
      ]);
    });

    it("keeps an excluded table region as a heading-context barrier", async () => {
      const tableRequiredText = "표 전용 접지장치를 시설하여야 한다";
      const tableNumericText = "표 전용 전류는 70 A 이하이어야 한다";
      const independentClause = "전기기기는 방수형으로 시설하여야 한다";
      const fixture = fixtureFromPlacements([
        { text: "욕실", x: 72, y: 760, size: 14 },
        { text: "항목", x: 72, y: 720 },
        { text: "요구사항", x: 300, y: 720 },
        { text: "배선", x: 72, y: 695 },
        { text: tableRequiredText, x: 300, y: 695 },
        { text: "보호", x: 72, y: 670 },
        { text: tableNumericText, x: 300, y: 670 },
        { text: independentClause, x: 72, y: 610 },
      ]);
      const producer = await loadProducer();
      const results = await producer.extractKecRequirements(inputFor(fixture));
      const extractedStatements = statements(results);

      expect(extractedStatements).toEqual([independentClause]);
      expect(extractedStatements[0]).not.toContain("욕실");
      expect(
        extractedStatements.some((statement) =>
          statement.includes(tableRequiredText),
        ),
      ).toBe(false);
      expect(
        extractedStatements.some((statement) =>
          statement.includes(tableNumericText),
        ),
      ).toBe(false);
      expect(results[0]!.provenance.locators).toHaveLength(1);
    });

    it("does not introduce deferred ontology, persistence, retrieval, governance, or a generic extractor port", () => {
      const source = readFileSync(producerPath, "utf8");

      expect(source).not.toMatch(
        /SourceRequirementAssertion|RequirementCandidate|RequirementRevision|LogicalRequirement|CanonicalRequirement|RequirementModality|RequirementProvenance|SourceRegistry|ExtractionContractVersion|RequirementExtractor\s*</u,
      );
      expect(source).not.toMatch(
        /RequirementApplicability|RequirementConflict|ResolutionJudgement|\bDecision\b|precedence|authority|winner|constraint intersection/iu,
      );
      expect(source).not.toMatch(
        /node:sqlite|knowledge-sqlite|SqliteKnowledgeStore|SqliteVectorStore|user_version/iu,
      );
      expect(containsPersistenceMutation(source)).toBe(false);
      expect(source).not.toMatch(
        /searchKec|search_kec|RequirementSearch|RequirementRetrieval|embedRequirements|Task86|generic query port/iu,
      );
    });

    it("distinguishes readable hash updates from actual SQL persistence mutations", () => {
      expect(containsPersistenceMutation('createHash("sha256").update(value)'))
        .toBe(false);
      expect(containsPersistenceMutation("hash.update(value) ")).toBe(false);
      expect(
        containsPersistenceMutation("UPDATE requirements SET value = ?"),
      ).toBe(true);
      expect(
        containsPersistenceMutation("insert into requirements(value) values (?)"),
      ).toBe(true);
      expect(
        containsPersistenceMutation("DELETE FROM requirements WHERE id = ?"),
      ).toBe(true);
      expect(
        containsPersistenceMutation("create table requirements (id text)"),
      ).toBe(true);

      const source = readFileSync(producerPath, "utf8");
      expect(source).toMatch(/hash\.update\(value\)/u);
      expect(source).not.toMatch(
        /Reflect\.(?:get|apply)|\["up",\s*"date"\]\.join/u,
      );
    });
  },
);
