import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AnchorLocatorSpace,
  ExtractionContractId,
  ExtractionLineage,
} from "../../../extraction-core/src/index.js";
import type { Requirement } from "../../../knowledge-core/src/index.js";
import type {
  ExternalSourceLocator,
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "../../../source-core/src/index.js";
import type {
  ExtractKecRequirementsInput,
  KecRequirementExtraction,
  KecRequirementId,
  KecRequirementLocator,
  extractKecRequirements,
} from "../../src/knowledge/requirementExtraction.js";

// @ts-expect-error pdf.js TextItems are private implementation details.
import type { KecPdfTextItem } from "../../src/knowledge/requirementExtraction.js";
// @ts-expect-error parsed PDF pages are private implementation details.
import type { KecPdfTextPage } from "../../src/knowledge/requirementExtraction.js";
// @ts-expect-error production callers cannot replace v1 extraction semantics.
import type { KecRequirementExtractionSeams } from "../../src/knowledge/requirementExtraction.js";

export type RejectedTestOnlyProductionExports = readonly [
  KecPdfTextItem,
  KecPdfTextPage,
  KecRequirementExtractionSeams,
];

type Expect<Value extends true> = Value;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <
        Value,
      >() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

type RequirementIdIsOpaqueString = Expect<
  Equal<KecRequirementId extends string ? true : false, true>
>;
type PlainStringIsNotRequirementId = Expect<
  Equal<string extends KecRequirementId ? true : false, false>
>;
type InputKeysAreExact = Expect<
  Equal<
    keyof ExtractKecRequirementsInput,
    "projectRoot" | "sourceLocator" | "sourceRevision"
  >
>;
type InputUsesExplicitSourceRevision = Expect<
  Equal<ExtractKecRequirementsInput["sourceRevision"], SourceRevision>
>;
type InputUsesExternalSourceLocator = Expect<
  Equal<ExtractKecRequirementsInput["sourceLocator"], ExternalSourceLocator>
>;
type LocatorKeysAreExact = Expect<
  Equal<
    keyof KecRequirementLocator,
    "endItemIndexExclusive" | "pageNumber" | "startItemIndex"
  >
>;
type RequirementUsesKnowledgeCore = Expect<
  Equal<
    KecRequirementExtraction["requirement"],
    Requirement<KecRequirementId, string>
  >
>;
type ProvenanceKeysAreExact = Expect<
  Equal<
    keyof KecRequirementExtraction["provenance"],
    "lineage" | "locators" | "locatorSpace" | "sourceRevision"
  >
>;
type ProvenanceUsesSourceRevision = Expect<
  Equal<
    KecRequirementExtraction["provenance"]["sourceRevision"],
    SourceRevision
  >
>;
type ProvenanceUsesOneLineage = Expect<
  Equal<KecRequirementExtraction["provenance"]["lineage"], ExtractionLineage>
>;
type ProvenanceUsesOneLocatorSpace = Expect<
  Equal<
    KecRequirementExtraction["provenance"]["locatorSpace"],
    AnchorLocatorSpace
  >
>;
type ProvenanceLocatorsAreNonEmpty = Expect<
  Equal<
    KecRequirementExtraction["provenance"]["locators"],
    readonly [KecRequirementLocator, ...KecRequirementLocator[]]
  >
>;
type LocatorDoesNotRepeatLineage = Expect<
  Equal<Extract<keyof KecRequirementLocator, "lineage">, never>
>;
type LocatorDoesNotRepeatLocatorSpace = Expect<
  Equal<Extract<keyof KecRequirementLocator, "locatorSpace">, never>
>;
type ProducerSignatureIsExact = Expect<
  Equal<
    typeof extractKecRequirements,
    (input: ExtractKecRequirementsInput) => Promise<
      readonly KecRequirementExtraction[]
    >
  >
>;
type ContractIdRemainsExistingFoundation = Expect<
  Equal<ExtractionContractId extends string ? true : false, true>
>;
type BlobHashRemainsExistingFoundation = Expect<
  Equal<
    SourceBlobHash,
    { readonly algorithm: "sha-256"; readonly digest: string }
  >
>;

export type RequirementExtractionContractChecks =
  | RequirementIdIsOpaqueString
  | PlainStringIsNotRequirementId
  | InputKeysAreExact
  | InputUsesExplicitSourceRevision
  | InputUsesExternalSourceLocator
  | LocatorKeysAreExact
  | RequirementUsesKnowledgeCore
  | ProvenanceKeysAreExact
  | ProvenanceUsesSourceRevision
  | ProvenanceUsesOneLineage
  | ProvenanceUsesOneLocatorSpace
  | ProvenanceLocatorsAreNonEmpty
  | LocatorDoesNotRepeatLineage
  | LocatorDoesNotRepeatLocatorSpace
  | ProducerSignatureIsExact
  | ContractIdRemainsExistingFoundation
  | BlobHashRemainsExistingFoundation;

export const TASK90_EXTRACTION_CONTRACT_ID =
  "kec:pdfjs-structural-normative-paragraphs:v1";
export const TASK90_LOCATOR_SPACE = "kec:pdf-text-item-span:v1";
export const LIVE_PDF_REQUIREMENT = "실시간 설비는 시설하여야 한다";

export const EXPECTED_AUTHORED_REQUIREMENTS = [
  "전기설비는 시설하여야 한다",
  "점검을 생략할 수 있다",
  "충전부를 노출하여서는 아니 된다",
  "정기 점검을 권장한다",
  "정격전류는 80 A 이하이어야 한다",
  "조건 X에서는 보호장치를 시설하여야 한다",
  "다만 비상시에는 수동으로 조작할 수 있다",
  "고장이 발생한 경우에는 전원을 차단하여야 한다",
] as const;

export const DUPLICATE_AUTHORED_REQUIREMENT = "보호장치를 설치하여야 한다";
export const TABLE_ONLY_NORMATIVE_TEXT = "접지하여야 한다";
export const CONTEXTUAL_REQUIREMENTS = [
  "욕실 전기기기는 방수형으로 시설하여야 한다",
  "다음의 경우에는 보호장치를 설치하여야 한다",
  "조건 X에서는 A 방식을 사용할 수 있다",
  "다만 다음 조건에서는 설치하여서는 아니 된다",
] as const;
export const CHAINED_CONTEXT_REQUIREMENT =
  "욕실 다음의 경우에는 전기기기는 방수형으로 시설하여야 한다";
export const NON_NORMATIVE_MODAL_REFERENCES = [
  "시설하여야 한다고 설명한다",
  "시설하여야 한다고 명시되어 있다",
  '"시설하여야 한다"라는 문구를 삭제한다',
  "권장한다는 표현을 사용하지 않는다",
  "할 수 있다는 의미는 아니다",
  "시설하여야 하는 것은 아니다.",
] as const;

export type PdfTextItemFixture = {
  readonly str: string;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly hasEOL: boolean;
};

export type PdfTextPageFixture = {
  readonly pageNumber: number;
  readonly items: readonly PdfTextItemFixture[];
};

function textItem(
  str: string,
  x: number,
  y: number,
  options: { readonly hasEOL?: boolean; readonly size?: number } = {},
): PdfTextItemFixture {
  const size = options.size ?? 12;

  return {
    str,
    transform: [size, 0, 0, size, x, y],
    width: Math.max(str.length * size * 0.5, 1),
    height: size,
    hasEOL: options.hasEOL ?? false,
  };
}

export function structuralKecPages(): readonly PdfTextPageFixture[] {
  return [
    {
      pageNumber: 1,
      items: [
        textItem("시설하여야 한다", 190, 700, { hasEOL: true }),
        textItem("제1조 일반사항", 72, 748, { hasEOL: true, size: 16 }),
        textItem("전기설비는 ", 72, 700),
        textItem("점검을 생략할 수 있다", 72, 660, { hasEOL: true }),
        textItem(" 아니 된다", 225, 620, { hasEOL: true }),
        textItem("충전부를 노출하여서는", 72, 620),
        textItem("정기 점검을 권장한다", 72, 580, { hasEOL: true }),
        textItem(" 이하이어야 한다", 195, 540, { hasEOL: true }),
        textItem("정격전류는 80 A", 72, 540),
        textItem("시설하여야 한다", 72, 486, { hasEOL: true }),
        textItem("조건 X에서는 보호장치를", 72, 500, { hasEOL: true }),
        textItem("다만 비상시에는 수동으로 조작할 수 있다", 72, 446, {
          hasEOL: true,
        }),
        textItem("전원을 차단하여야 한다", 72, 392, { hasEOL: true }),
        textItem("고장이 발생한 경우에는", 72, 406, { hasEOL: true }),
        textItem("이 문장은 제도의 배경을 설명한다", 72, 352, {
          hasEOL: true,
        }),
      ],
    },
    {
      pageNumber: 2,
      items: [
        textItem(DUPLICATE_AUTHORED_REQUIREMENT, 72, 700, { hasEOL: true }),
        textItem(DUPLICATE_AUTHORED_REQUIREMENT, 72, 650, { hasEOL: true }),
      ],
    },
    {
      pageNumber: 3,
      items: [
        textItem("항목", 72, 700),
        textItem("요구사항", 300, 700, { hasEOL: true }),
        textItem("배선", 72, 675),
        textItem(TABLE_ONLY_NORMATIVE_TEXT, 300, 675, { hasEOL: true }),
        textItem("보호", 72, 650),
        textItem("80 A 이하이어야 한다", 300, 650, { hasEOL: true }),
      ],
    },
  ];
}

function utf16BeHex(value: string): string {
  return Array.from(value)
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("")
    .toUpperCase();
}

export type PdfTextPlacement = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
};

export function deterministicKoreanPdfBytes(
  source: string | readonly PdfTextPlacement[] = LIVE_PDF_REQUIREMENT,
): Uint8Array {
  const placements =
    typeof source === "string"
      ? [{ text: source, x: 72, y: 720, size: 12 }]
      : source;
  const content = placements
    .map(
      ({ text, x, y, size = 12 }) =>
        `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm <${utf16BeHex(text)}> Tj ET`,
    )
    .join("\n");
  const toUnicode = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    "1 beginbfrange",
    "<0000> <FFFF> <0000>",
    "endbfrange",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /Task90Korean /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Task90Korean /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 1000 /CIDToGIDMap /Identity >>",
    "<< /Type /FontDescriptor /FontName /Task90Korean /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>",
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

export type RequirementPdfFixture = {
  readonly projectRoot: string;
  readonly firstLocator: ExternalSourceLocator;
  readonly renamedLocator: ExternalSourceLocator;
  readonly bytes: Uint8Array;
  readonly cleanup: () => void;
};

export function createRequirementPdfFixture(
  bytes = deterministicKoreanPdfBytes(),
): RequirementPdfFixture {
  const projectRoot = mkdtempSync(join(tmpdir(), "voltai-task90-red-"));
  const pdfDirectory = join(projectRoot, "kec");
  const firstLocator = {
    scheme: "file",
    value: "kec/requirements.pdf",
  } satisfies ExternalSourceLocator;
  const renamedLocator = {
    scheme: "file",
    value: "kec/renamed-requirements.pdf",
  } satisfies ExternalSourceLocator;

  mkdirSync(pdfDirectory, { recursive: true });
  writeFileSync(join(projectRoot, firstLocator.value), bytes);
  writeFileSync(join(projectRoot, renamedLocator.value), bytes);

  return {
    projectRoot,
    firstLocator,
    renamedLocator,
    bytes,
    cleanup: () => rmSync(projectRoot, { recursive: true, force: true }),
  };
}

export function explicitSourceRevision(): SourceRevision {
  return {
    sourceIdentity: "kec:official-standard" as SourceIdentity,
    revisionKey: "2026-08-19-approved" as SourceRevisionKey,
  };
}
