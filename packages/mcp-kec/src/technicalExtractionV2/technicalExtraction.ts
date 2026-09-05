import { createHash } from "node:crypto";

import type { SourceRevision } from "@voltai/source-core";

import { attachKecV2GlyphProvenance } from "./glyphProvenance.js";
import {
  attachKecV2GeometricLines,
  type KecV2GeometricTechnicalPage,
} from "./geometricLines.js";
import {
  InvalidKecV2MappingRegistry,
  type KecV2MappingRegistry,
  validateKecV2MappingRegistry,
  type ValidatedKecV2MappingRegistry,
} from "./mappingRegistry.js";
import {
  captureKecV2RawTextItemPage,
  type KecV2PdfTextContent,
} from "./rawTextItems.js";

export type {
  KecV2MappingEntry,
  KecV2MappingRegistry,
} from "./mappingRegistry.js";

export const KEC_V2_TECHNICAL_EXTRACTION_CONTRACT_ID =
  "kec:pdfjs-geometry-semantic-requirements:v2" as const;
export const KEC_V2_TECHNICAL_LOCATOR_SPACE =
  "kec:pdfjs-raw-text-item-spans:v2" as const;
export const KEC_V2_TECHNICAL_CAPTURE_CONTRACT_ID =
  "kec:pdfjs-explainable-structural-capture:v2" as const;

export type KecTechnicalFailureCode =
  | "PDF_PARSE_FAILURE"
  | "GEOMETRY_FAILURE"
  | "EXTRACTION_FAILURE"
  | "RESOURCE_FAILURE";

export class KecTechnicalExtractionFailure extends Error {
  readonly code: KecTechnicalFailureCode;

  constructor(code: KecTechnicalFailureCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = code;
    this.code = code;
  }
}

export interface KecV2ResourceLimits {
  readonly maxPages: number;
  readonly maxTextItemsPerPage: number;
}

export interface ExtractKecV2TechnicalInput {
  readonly exactBytes: Uint8Array;
  readonly sourceContext: SourceRevision;
  readonly extractionContract: typeof KEC_V2_TECHNICAL_EXTRACTION_CONTRACT_ID;
  readonly mappingRegistry: KecV2MappingRegistry;
  readonly resourceLimits: KecV2ResourceLimits;
}

export interface KecV2TechnicalExtractionResult {
  readonly byteIdentity: Readonly<{
    readonly algorithm: "sha-256";
    readonly digest: string;
    readonly byteLength: number;
  }>;
  readonly sourceContext: SourceRevision;
  readonly extractionContract: typeof KEC_V2_TECHNICAL_EXTRACTION_CONTRACT_ID;
  readonly locatorSpace: typeof KEC_V2_TECHNICAL_LOCATOR_SPACE;
  readonly captureContract: typeof KEC_V2_TECHNICAL_CAPTURE_CONTRACT_ID;
  readonly mappingRegistry: KecV2MappingRegistry;
  readonly resourceLimits: KecV2ResourceLimits;
  readonly pages: readonly KecV2GeometricTechnicalPage[];
  readonly requirements: readonly [];
  readonly observations: readonly [];
}

interface PdfJsDocument {
  readonly numPages: number;
  readonly getPage: (pageNumber: number) => Promise<{
    readonly getTextContent: () => Promise<{
      readonly items: readonly unknown[];
      readonly styles?: Readonly<Record<string, unknown>>;
    }>;
  }>;
  readonly cleanup: () => Promise<void>;
}

interface PdfJsLoadingTask {
  readonly promise: Promise<PdfJsDocument>;
  readonly destroy: () => Promise<void>;
}

interface PdfJsModule {
  readonly getDocument: (options: {
    readonly data: Uint8Array;
    readonly disableFontFace: boolean;
    readonly useSystemFonts: boolean;
  }) => PdfJsLoadingTask;
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failure(
  code: KecTechnicalFailureCode,
  cause: unknown,
): KecTechnicalExtractionFailure {
  if (cause instanceof KecTechnicalExtractionFailure) return cause;
  return new KecTechnicalExtractionFailure(code, messageFrom(cause), cause);
}

function positiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new KecTechnicalExtractionFailure(
      "EXTRACTION_FAILURE",
      `${field} must be a positive safe integer`,
    );
  }
}

function validateInput(
  input: ExtractKecV2TechnicalInput,
): ValidatedKecV2MappingRegistry {
  if (!(input.exactBytes instanceof Uint8Array)) {
    throw new KecTechnicalExtractionFailure(
      "EXTRACTION_FAILURE",
      "exactBytes must be a Uint8Array",
    );
  }
  if (input.extractionContract !== KEC_V2_TECHNICAL_EXTRACTION_CONTRACT_ID) {
    throw new KecTechnicalExtractionFailure(
      "EXTRACTION_FAILURE",
      `unsupported extraction contract: ${String(input.extractionContract)}`,
    );
  }
  if (
    typeof input.sourceContext?.sourceIdentity !== "string" ||
    input.sourceContext.sourceIdentity.length === 0 ||
    typeof input.sourceContext.revisionKey !== "string" ||
    input.sourceContext.revisionKey.length === 0
  ) {
    throw new KecTechnicalExtractionFailure(
      "EXTRACTION_FAILURE",
      "technical source context must be explicit",
    );
  }
  positiveSafeInteger(input.resourceLimits?.maxPages, "maxPages");
  positiveSafeInteger(
    input.resourceLimits?.maxTextItemsPerPage,
    "maxTextItemsPerPage",
  );
  try {
    return validateKecV2MappingRegistry(input.mappingRegistry);
  } catch (cause) {
    if (!(cause instanceof InvalidKecV2MappingRegistry)) throw cause;
    throw new KecTechnicalExtractionFailure(
      "EXTRACTION_FAILURE",
      cause.message,
      cause,
    );
  }
}

async function loadPdfJs(): Promise<PdfJsModule> {
  try {
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
  } catch (cause) {
    throw failure("RESOURCE_FAILURE", cause);
  }
}

export async function extractKecV2Technical(
  input: ExtractKecV2TechnicalInput,
): Promise<KecV2TechnicalExtractionResult> {
  const mappingRegistry = validateInput(input);
  const pdfjs = await loadPdfJs();
  let loadingTask: PdfJsLoadingTask;
  try {
    loadingTask = pdfjs.getDocument({
      data: input.exactBytes.slice(),
      disableFontFace: true,
      useSystemFonts: true,
    });
  } catch (cause) {
    throw failure("PDF_PARSE_FAILURE", cause);
  }

  let document: PdfJsDocument;
  try {
    document = await loadingTask.promise;
  } catch (cause) {
    await loadingTask.destroy().catch(() => undefined);
    throw failure("PDF_PARSE_FAILURE", cause);
  }

  try {
    if (document.numPages > input.resourceLimits.maxPages) {
      throw new KecTechnicalExtractionFailure(
        "RESOURCE_FAILURE",
        `PDF page count ${document.numPages} exceeds maxPages ${input.resourceLimits.maxPages}`,
      );
    }
    const pages: KecV2GeometricTechnicalPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      let content: KecV2PdfTextContent;
      try {
        const page = await document.getPage(pageNumber);
        content = await page.getTextContent();
      } catch (cause) {
        throw failure("GEOMETRY_FAILURE", cause);
      }
      if (content.items.length > input.resourceLimits.maxTextItemsPerPage) {
        throw new KecTechnicalExtractionFailure(
          "RESOURCE_FAILURE",
          `PDF page ${pageNumber} text item count ${content.items.length} exceeds maxTextItemsPerPage ${input.resourceLimits.maxTextItemsPerPage}`,
        );
      }
      pages.push(
        attachKecV2GeometricLines(
          attachKecV2GlyphProvenance(
            captureKecV2RawTextItemPage(pageNumber, content),
            content.styles ?? Object.freeze({}),
            mappingRegistry,
          ),
        ),
      );
    }

    return Object.freeze({
      byteIdentity: Object.freeze({
        algorithm: "sha-256" as const,
        digest: createHash("sha256").update(input.exactBytes).digest("hex"),
        byteLength: input.exactBytes.byteLength,
      }),
      sourceContext: Object.freeze({ ...input.sourceContext }),
      extractionContract: KEC_V2_TECHNICAL_EXTRACTION_CONTRACT_ID,
      locatorSpace: KEC_V2_TECHNICAL_LOCATOR_SPACE,
      captureContract: KEC_V2_TECHNICAL_CAPTURE_CONTRACT_ID,
      mappingRegistry: mappingRegistry.value,
      resourceLimits: Object.freeze({ ...input.resourceLimits }),
      pages: Object.freeze(pages),
      requirements: Object.freeze([]) as readonly [],
      observations: Object.freeze([]) as readonly [],
    });
  } finally {
    await document.cleanup().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
}
