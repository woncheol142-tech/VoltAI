import { createHash } from "node:crypto";

import type { ValidatedKecV2MappingRegistry } from "./mappingRegistry.js";
import type {
  KecV2RawItemAnomaly,
  KecV2RawTextItem,
  KecV2RawTextItemPage,
} from "./rawTextItems.js";

export interface KecV2FontEvidence {
  readonly fontName: string;
  readonly fingerprint?: string;
}

export type KecV2GlyphProvenance =
  | Readonly<{
      state: "UNICODE";
      rawText: string;
      rawCodePoint: number;
    }>
  | Readonly<{
      state: "VERIFIED_MAPPING";
      rawText: string;
      rawCodePoint: number;
      mappedText: string;
      mappingId: string;
      fontFingerprint: string;
      evidenceDigest: string;
    }>
  | Readonly<{
      state: "UNRESOLVED_PUA";
      rawText: string;
      rawCodePoint: number;
      fontEvidence: KecV2FontEvidence;
    }>;

export type KecV2SemanticText =
  | Readonly<{ state: "UNICODE"; text: string }>
  | Readonly<{
      state: "VERIFIED_MAPPING";
      text: string;
      mappings: readonly Readonly<{
        mappingId: string;
        fontFingerprint: string;
        evidenceDigest: string;
      }>[];
      mappingId?: string;
      fontFingerprint?: string;
      evidenceDigest?: string;
    }>
  | Readonly<{
      state: "UNRESOLVED_PUA";
      rawCodePoints: readonly number[];
      fontEvidence: KecV2FontEvidence;
    }>;

export interface KecV2ProvenanceTextItem extends Omit<
  KecV2RawTextItem,
  "fontName"
> {
  readonly fontEvidence: KecV2FontEvidence;
  readonly glyphs: readonly KecV2GlyphProvenance[];
  readonly semanticText: KecV2SemanticText;
}

export interface KecV2ProvenanceTextItemPage {
  readonly pageNumber: number;
  readonly items: readonly KecV2ProvenanceTextItem[];
  readonly anomalies: readonly KecV2RawItemAnomaly[];
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStyleValue(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function stableParserFontName(fontName: string): string {
  const generatedName = /^g_d\d+_f(\d+)$/u.exec(fontName);
  return generatedName === null ? fontName : `pdfjs-font-${generatedName[1]}`;
}

function fontEvidence(
  fontName: string,
  styles: Readonly<Record<string, unknown>>,
): KecV2FontEvidence {
  const style = styles[fontName];
  const stableFontName = stableParserFontName(fontName);
  if (!isRecord(style)) return Object.freeze({ fontName: stableFontName });

  const canonicalEvidence = JSON.stringify([
    "task98:r1:font-evidence:v1",
    stableFontName,
    stableStyleValue(style.fontFamily),
    stableStyleValue(style.ascent),
    stableStyleValue(style.descent),
    stableStyleValue(style.vertical),
  ]);
  return Object.freeze({
    fontName: stableFontName,
    fingerprint: createHash("sha256").update(canonicalEvidence).digest("hex"),
  });
}

function privateUse(codePoint: number): boolean {
  return (
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
    (codePoint >= 0x100000 && codePoint <= 0x10fffd)
  );
}

function glyphsFor(
  item: KecV2RawTextItem,
  evidence: KecV2FontEvidence,
  registry: ValidatedKecV2MappingRegistry,
): readonly KecV2GlyphProvenance[] {
  return Object.freeze(
    Array.from(item.rawText, (rawText) => {
      const rawCodePoint = rawText.codePointAt(0)!;
      if (!privateUse(rawCodePoint)) {
        return Object.freeze({
          state: "UNICODE" as const,
          rawText,
          rawCodePoint,
        });
      }

      const mapping =
        evidence.fingerprint === undefined
          ? undefined
          : registry.find(evidence.fingerprint, rawCodePoint);
      if (mapping === undefined) {
        return Object.freeze({
          state: "UNRESOLVED_PUA" as const,
          rawText,
          rawCodePoint,
          fontEvidence: evidence,
        });
      }
      return Object.freeze({
        state: "VERIFIED_MAPPING" as const,
        rawText,
        rawCodePoint,
        mappedText: mapping.mappedText,
        mappingId: mapping.mappingId,
        fontFingerprint: mapping.fontFingerprint,
        evidenceDigest: mapping.evidenceDigest,
      });
    }),
  );
}

function semanticText(
  rawText: string,
  glyphs: readonly KecV2GlyphProvenance[],
  evidence: KecV2FontEvidence,
): KecV2SemanticText {
  const unresolved = glyphs.filter((glyph) => glyph.state === "UNRESOLVED_PUA");
  if (unresolved.length > 0) {
    return Object.freeze({
      state: "UNRESOLVED_PUA" as const,
      rawCodePoints: Object.freeze(
        unresolved.map((glyph) => glyph.rawCodePoint),
      ),
      fontEvidence: evidence,
    });
  }

  const mapped = glyphs.filter(
    (
      glyph,
    ): glyph is Extract<KecV2GlyphProvenance, { state: "VERIFIED_MAPPING" }> =>
      glyph.state === "VERIFIED_MAPPING",
  );
  if (mapped.length === 0) {
    return Object.freeze({ state: "UNICODE" as const, text: rawText });
  }

  const mappings = Object.freeze(
    mapped.map((glyph) =>
      Object.freeze({
        mappingId: glyph.mappingId,
        fontFingerprint: glyph.fontFingerprint,
        evidenceDigest: glyph.evidenceDigest,
      }),
    ),
  );
  const mappedText = glyphs
    .map((glyph) =>
      glyph.state === "VERIFIED_MAPPING" ? glyph.mappedText : glyph.rawText,
    )
    .join("");
  const onlyMapping = mapped.length === 1 ? mapped[0] : undefined;
  return Object.freeze({
    state: "VERIFIED_MAPPING" as const,
    text: mappedText,
    mappings,
    ...(onlyMapping === undefined
      ? {}
      : {
          mappingId: onlyMapping.mappingId,
          fontFingerprint: onlyMapping.fontFingerprint,
          evidenceDigest: onlyMapping.evidenceDigest,
        }),
  });
}

export function attachKecV2GlyphProvenance(
  page: KecV2RawTextItemPage,
  styles: Readonly<Record<string, unknown>>,
  registry: ValidatedKecV2MappingRegistry,
): KecV2ProvenanceTextItemPage {
  const items = page.items.map((item): KecV2ProvenanceTextItem => {
    const evidence = fontEvidence(item.fontName, styles);
    const glyphs = glyphsFor(item, evidence, registry);
    return Object.freeze({
      pageNumber: item.pageNumber,
      originalItemIndex: item.originalItemIndex,
      rawText: item.rawText,
      rawGeometry: item.rawGeometry,
      bbox: item.bbox,
      quantizedGeometry: item.quantizedGeometry,
      fontEvidence: evidence,
      glyphs,
      semanticText: semanticText(item.rawText, glyphs, evidence),
    });
  });
  return Object.freeze({
    pageNumber: page.pageNumber,
    items: Object.freeze(items),
    anomalies: page.anomalies,
  });
}
