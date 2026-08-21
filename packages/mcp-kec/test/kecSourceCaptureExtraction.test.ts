import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  KecCapturedRequirementSnapshot,
  KecRequirementAssemblyObservation,
  KecSourceCaptureObservation,
  KecSuppressedAssemblyObservation,
  ExpectedCaptureProducer,
} from "./fixtures/sourceCaptureContracts.js";
import {
  compareCaptureObservations,
  CONTEXT_SEARCH_TERMINATIONS,
  normalizeCapturedText,
  TASK90_EXTRACTION_CONTRACT_ID,
  TASK90_LOCATOR_SPACE,
  TASK93_CAPTURE_CONTRACT_ID,
} from "./fixtures/sourceCaptureContracts.js";
import {
  createRequirementPdfFixture,
  deterministicKoreanPdfBytes,
  explicitSourceRevision,
  type PdfTextPlacement,
  type RequirementPdfFixture,
} from "./fixtures/requirementExtractionContracts.js";

const acquisition = vi.hoisted(() => ({ readFile: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  acquisition.readFile.mockImplementation((...args: unknown[]) =>
    Reflect.apply(actual.readFile, undefined, args),
  );
  return { ...actual, readFile: acquisition.readFile };
});

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const producerPath = join(
  packageRoot,
  "src",
  "knowledge",
  "requirementExtraction.ts",
);
const capturePath = join(packageRoot, "src", "knowledge", "sourceCapture.ts");
const producerSource = readFileSync(producerPath, "utf8");
const sourceCaptureExists = existsSync(capturePath);
const captureProducerExists =
  /export\s+(?:async\s+)?function\s+extractKecRequirementSnapshotWithCapture\b/u.test(
    producerSource,
  );
const behaviorExists = sourceCaptureExists && captureProducerExists;
const fixtures: RequirementPdfFixture[] = [];

type ProducerModule = {
  readonly extractKecRequirementSnapshotWithCapture?: ExpectedCaptureProducer;
  readonly extractKecRequirementSnapshot: ExpectedCaptureProducer extends (
    input: infer Input,
  ) => Promise<KecCapturedRequirementSnapshot>
    ? (
        input: Input,
      ) => Promise<KecCapturedRequirementSnapshot["requirementSnapshot"]>
    : never;
};

async function producerModule(): Promise<ProducerModule> {
  return import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/knowledge/requirementExtraction.ts", import.meta.url),
    )
  ) as Promise<ProducerModule>;
}

function fixture(
  placements: readonly PdfTextPlacement[],
): RequirementPdfFixture {
  const created = createRequirementPdfFixture(
    deterministicKoreanPdfBytes(placements),
  );
  fixtures.push(created);
  return created;
}

function inputFor(created: RequirementPdfFixture) {
  return {
    projectRoot: created.projectRoot,
    sourceLocator: created.firstLocator,
    sourceRevision: explicitSourceRevision(),
  };
}

async function orderedFixtureTextItems(bytes: Uint8Array): Promise<
  readonly {
    readonly str: string;
    readonly x: number;
    readonly y: number;
    readonly sourceIndex: number;
  }[]
> {
  const loadingTask = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item, sourceIndex) =>
      "str" in item
        ? [
            {
              str: item.str,
              x: item.transform[4],
              y: item.transform[5],
              sourceIndex,
            },
          ]
        : [],
    );
    items.sort(
      (left, right) =>
        right.y - left.y ||
        left.x - right.x ||
        left.sourceIndex - right.sourceIndex,
    );
    return items;
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }
}

function assemblyEvents(
  captured: KecCapturedRequirementSnapshot,
): KecRequirementAssemblyObservation[] {
  return captured.captureSnapshot.observations.filter(
    (observation): observation is KecRequirementAssemblyObservation =>
      observation.kind === "requirement-assembly",
  );
}

function suppressedEvents(
  captured: KecCapturedRequirementSnapshot,
): KecSuppressedAssemblyObservation[] {
  return captured.captureSnapshot.observations.filter(
    (observation): observation is KecSuppressedAssemblyObservation =>
      observation.kind === "suppressed-assembly",
  );
}

afterEach(() => {
  for (const created of fixtures.splice(0)) created.cleanup();
  acquisition.readFile.mockClear();
});

describe("Task93 capture producer RED gates", () => {
  it("fails explicitly until the sourceCapture contract module exists", () => {
    expect(
      sourceCaptureExists,
      "Task93 source capture contracts are missing: src/knowledge/sourceCapture.ts",
    ).toBe(true);
  });

  it("fails explicitly until the capture-aware producer exists", () => {
    expect(
      captureProducerExists,
      "Task93 producer is missing: extractKecRequirementSnapshotWithCapture",
    ).toBe(true);
  });
});

describe.runIf(behaviorExists)("Task93 source-first capture semantics", () => {
  it("uses one byte acquisition and preserves the v1 extraction snapshot exactly", async () => {
    const created = fixture([
      { text: "욕실", x: 72, y: 740, size: 14 },
      { text: "전기기기는 방수형으로 시설하여야 한다", x: 72, y: 712 },
    ]);
    const producer = await producerModule();
    const captured = await producer.extractKecRequirementSnapshotWithCapture!(
      inputFor(created),
    );
    expect(acquisition.readFile).toHaveBeenCalledTimes(1);
    expect(captured.requirementSnapshot.binding.extractionContract).toBe(
      TASK90_EXTRACTION_CONTRACT_ID,
    );
    expect(captured.requirementSnapshot.binding.locatorSpace).toBe(
      TASK90_LOCATOR_SPACE,
    );
    expect(captured.captureSnapshot.binding).toEqual(
      captured.requirementSnapshot.binding,
    );
    expect(captured.captureSnapshot.captureContract).toBe(
      TASK93_CAPTURE_CONTRACT_ID,
    );

    acquisition.readFile.mockClear();
    const legacy = await producer.extractKecRequirementSnapshot(
      inputFor(created),
    );
    expect(acquisition.readFile).toHaveBeenCalledTimes(1);
    expect(captured.requirementSnapshot).toEqual(legacy);
    expect(
      captured.requirementSnapshot.requirements.map(
        ({ requirement }) => requirement.id,
      ),
    ).toEqual(legacy.requirements.map(({ requirement }) => requirement.id));
  });

  it("creates exactly one assembly per Requirement with exact text and locator joins", async () => {
    const created = fixture([
      { text: "욕실", x: 72, y: 740, size: 14 },
      { text: "전기기기는 방수형으로 시설하여야 한다", x: 72, y: 712 },
      { text: "점검을 생략할 수 있다", x: 72, y: 660 },
    ]);
    const producer = await producerModule();
    const captured = await producer.extractKecRequirementSnapshotWithCapture!(
      inputFor(created),
    );
    const assemblies = assemblyEvents(captured);
    const requirements = captured.requirementSnapshot.requirements;

    expect(assemblies).toHaveLength(requirements.length);
    expect(assemblies.map(({ requirementId }) => requirementId)).toEqual(
      requirements.map(({ requirement }) => requirement.id),
    );
    expect(
      new Set(assemblies.map(({ requirementId }) => requirementId)).size,
    ).toBe(requirements.length);
    for (const [index, assembly] of assemblies.entries()) {
      const requirement = requirements[index]!;
      expect(assembly.fragments.at(-1)?.role).toBe(
        "normative-pattern-fragment",
      );
      expect(assembly.fragments.slice(0, -1).map(({ role }) => role)).toEqual(
        assembly.fragments.slice(0, -1).map(() => "attached-context-fragment"),
      );
      expect(
        normalizeCapturedText(
          assembly.fragments.map(({ observedText }) => observedText).join(" "),
        ),
      ).toBe(requirement.requirement.statement);
      expect(assembly.fragments.map(({ span }) => span)).toEqual(
        requirement.provenance.locators,
      );
    }
  });

  it("records both overlapping context detectors in canonical order without changing emission", async () => {
    const created = fixture([
      { text: "다만", x: 72, y: 740, size: 14 },
      { text: "보호장치를 설치하여야 한다", x: 72, y: 712 },
    ]);
    const producer = await producerModule();
    const captured = await producer.extractKecRequirementSnapshotWithCapture!(
      inputFor(created),
    );
    expect(captured.requirementSnapshot.requirements).toHaveLength(1);
    const assembly = assemblyEvents(captured)[0]!;
    expect(assembly.fragments[0]).toMatchObject({
      role: "attached-context-fragment",
      observedText: "다만",
      detectors: ["explicit-context-lead", "short-heading-adjacent"],
    });
  });

  it.each([
    ["page-start", [{ text: "보호장치를 설치하여야 한다", x: 72, y: 740 }], 0],
    [
      "preceding-normative-paragraph",
      [
        { text: "전기설비는 시설하여야 한다", x: 72, y: 740 },
        { text: "보호장치를 설치하여야 한다", x: 72, y: 690 },
      ],
      1,
    ],
    [
      "preceding-non-context-candidate",
      [
        { text: "설명 자료", x: 72, y: 740 },
        { text: "보호장치를 설치하여야 한다", x: 72, y: 712 },
      ],
      0,
    ],
    [
      "structural-region-boundary",
      [
        { text: "욕실", x: 72, y: 760, size: 14 },
        { text: "항목", x: 72, y: 720 },
        { text: "요구사항", x: 300, y: 720 },
        { text: "배선", x: 72, y: 695 },
        { text: "접지하여야 한다", x: 300, y: 695 },
        { text: "보호장치를 설치하여야 한다", x: 72, y: 640 },
      ],
      0,
    ],
  ] as const)(
    "records exact context termination %s",
    async (termination, placements, assemblyIndex) => {
      const created = fixture(placements);
      const producer = await producerModule();
      const captured = await producer.extractKecRequirementSnapshotWithCapture!(
        inputFor(created),
      );
      expect(
        assemblyEvents(captured)[assemblyIndex]?.contextSearchTermination,
      ).toBe(termination);
      expect(CONTEXT_SEARCH_TERMINATIONS).toContain(termination);
      if (termination === "structural-region-boundary") {
        const capturedFragments = captured.captureSnapshot.observations.flatMap(
          (observation) =>
            observation.kind === "column-gap-region-excluded"
              ? []
              : observation.kind === "suppressed-assembly"
                ? [...observation.fragments, observation.blockingCandidate]
                : observation.fragments,
        );
        expect(
          capturedFragments.some(({ observedText }) => observedText === "욕실"),
          "structural-region breaks must not evaluate context candidacy",
        ).toBe(false);
      }
    },
  );

  it("captures one composite suppressed assembly owning the normative and blocker sides", async () => {
    const created = fixture([
      { text: "다음의 경우에는", x: 72, y: 740 },
      { text: "보호장치를 설치하여야 한다", x: 72, y: 680 },
    ]);
    const producer = await producerModule();
    const captured = await producer.extractKecRequirementSnapshotWithCapture!(
      inputFor(created),
    );
    expect(captured.requirementSnapshot.requirements).toEqual([]);
    expect(suppressedEvents(captured)).toEqual([
      {
        kind: "suppressed-assembly",
        fragments: [
          expect.objectContaining({
            role: "normative-pattern-fragment",
            observedText: "보호장치를 설치하여야 한다",
            detectors: ["normative-sentence-ending"],
          }),
        ],
        blockingCandidate: expect.objectContaining({
          role: "unattached-context-candidate",
          observedText: "다음의 경우에는",
          detectors: ["explicit-context-lead"],
        }),
        blockedBy: "gap-above-window",
      },
    ]);
  });

  it("captures one exact maximal column-gap span without normative classification", async () => {
    const excludedLineYs = new Set([720, 695]);
    const created = fixture([
      { text: "항목", x: 72, y: 720 },
      { text: "요구사항", x: 300, y: 720 },
      { text: "배선", x: 72, y: 695 },
      { text: "접지하여야 한다", x: 300, y: 695 },
      { text: "정격전류는 80 A 이하이어야 한다", x: 72, y: 630 },
    ]);
    const orderedItems = await orderedFixtureTextItems(created.bytes);
    const excludedItemIndexes = orderedItems.flatMap(({ y }, index) =>
      excludedLineYs.has(y) ? [index] : [],
    );
    const expectedSpan = {
      pageNumber: 1,
      startItemIndex: Math.min(...excludedItemIndexes),
      endItemIndexExclusive: Math.max(...excludedItemIndexes) + 1,
    };
    const meaningfulRightItems = (y: number) =>
      orderedItems.filter(
        (item) => item.y === y && item.x >= 300 && item.str.trim().length > 0,
      );
    expect(meaningfulRightItems(720).map(({ str }) => str)).toEqual([
      "요구사항",
    ]);
    expect(meaningfulRightItems(695).map(({ str }) => str)).toEqual([
      "접지하여야",
      "한다",
    ]);

    const producer = await producerModule();
    const captured = await producer.extractKecRequirementSnapshotWithCapture!(
      inputFor(created),
    );
    const excluded = captured.captureSnapshot.observations.filter(
      (observation) => observation.kind === "column-gap-region-excluded",
    );
    expect(excluded).toEqual([
      {
        kind: "column-gap-region-excluded",
        span: expectedSpan,
        observedText: "항목 요구사항 배선 접지하여야 한다",
      },
    ]);
    expect(Object.keys(excluded[0]!).sort()).toEqual([
      "kind",
      "observedText",
      "span",
    ]);
  });

  it("returns observations in canonical anchor and kind order", async () => {
    const created = fixture([
      { text: "항목", x: 72, y: 740 },
      { text: "요구사항", x: 300, y: 740 },
      { text: "배선", x: 72, y: 715 },
      { text: "접지하여야 한다", x: 300, y: 715 },
      { text: "보호장치를 설치하여야 한다", x: 72, y: 650 },
    ]);
    const producer = await producerModule();
    const captured = await producer.extractKecRequirementSnapshotWithCapture!(
      inputFor(created),
    );
    const observations: readonly KecSourceCaptureObservation[] =
      captured.captureSnapshot.observations;
    expect(observations).toEqual(
      [...observations].sort(compareCaptureObservations),
    );
  });
});
