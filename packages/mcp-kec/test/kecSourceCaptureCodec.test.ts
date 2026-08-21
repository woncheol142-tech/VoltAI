import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { KecSourceCaptureObservation } from "./fixtures/sourceCaptureContracts.js";
import {
  canonicalCodecPayloads,
  codecObservations,
} from "./fixtures/sourceCaptureContracts.js";

const codecPath = fileURLToPath(
  new URL("../src/requirementSnapshot/captureCodec.ts", import.meta.url),
);
const codecExists = existsSync(codecPath);

type CaptureCodecModule = {
  readonly encodeKecSourceCaptureObservation: (
    observation: KecSourceCaptureObservation,
  ) => string;
  readonly decodeKecSourceCaptureObservation: (
    storedText: string,
  ) => KecSourceCaptureObservation;
};

async function captureCodec(): Promise<CaptureCodecModule> {
  return import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/requirementSnapshot/captureCodec.ts", import.meta.url),
    )
  ) as Promise<CaptureCodecModule>;
}

describe("Task93 canonical capture codec RED gate", () => {
  it("fails explicitly until the closed capture codec exists", () => {
    expect(
      codecExists,
      "Task93 canonical codec is missing: requirementSnapshot/captureCodec.ts",
    ).toBe(true);
  });
});

describe.runIf(codecExists)("Task93 closed canonical capture codec", () => {
  it("encodes every union variant with fixed key order", async () => {
    const codec = await captureCodec();
    expect(
      codecObservations.map(codec.encodeKecSourceCaptureObservation),
    ).toEqual(canonicalCodecPayloads);
  });

  it("round-trips all variants and requires canonical byte equality", async () => {
    const codec = await captureCodec();
    for (const [index, payload] of canonicalCodecPayloads.entries()) {
      const decoded = codec.decodeKecSourceCaptureObservation(payload);
      expect(decoded).toEqual(codecObservations[index]);
      expect(codec.encodeKecSourceCaptureObservation(decoded)).toBe(payload);
    }
  });

  it("preserves fragment order and overlapping detector set order", async () => {
    const codec = await captureCodec();
    const decoded = codec.decodeKecSourceCaptureObservation(
      canonicalCodecPayloads[2],
    );
    expect(decoded).toMatchObject({
      kind: "requirement-assembly",
      fragments: [
        {
          role: "attached-context-fragment",
          observedText: "다만",
          detectors: ["explicit-context-lead", "short-heading-adjacent"],
        },
        {
          role: "normative-pattern-fragment",
          observedText: "전기설비는 시설하여야 한다",
          detectors: ["normative-sentence-ending"],
        },
      ],
    });
  });

  it("rejects noncanonical detector sets, spans, and observed text on encode", async () => {
    const codec = await captureCodec();
    const assembly = codecObservations[2];
    const column = codecObservations[0];
    if (
      assembly?.kind !== "requirement-assembly" ||
      column?.kind !== "column-gap-region-excluded"
    ) {
      throw new Error("Task93 codec fixtures are incomplete");
    }
    const firstFragment = assembly.fragments[0]!;
    const invalid: readonly KecSourceCaptureObservation[] = [
      {
        ...assembly,
        fragments: [
          {
            ...firstFragment,
            detectors: ["short-heading-adjacent", "explicit-context-lead"],
          },
          ...assembly.fragments.slice(1),
        ],
      },
      {
        ...assembly,
        fragments: [
          {
            ...firstFragment,
            detectors: ["explicit-context-lead", "explicit-context-lead"],
          },
          ...assembly.fragments.slice(1),
        ],
      },
      { ...column, span: { ...column.span, startItemIndex: -0 } },
      {
        ...column,
        span: {
          ...column.span,
          endItemIndexExclusive: column.span.startItemIndex,
        },
      },
      { ...column, observedText: "항목  요구사항" },
    ];
    for (const observation of invalid) {
      expect(() =>
        codec.encodeKecSourceCaptureObservation(observation),
      ).toThrow();
    }
  });

  it.each([
    [
      "unknown field",
      canonicalCodecPayloads[0].replace(
        ',"observedText"',
        ',"unknown":true,"observedText"',
      ),
    ],
    [
      "unknown kind",
      canonicalCodecPayloads[0].replace(
        "column-gap-region-excluded",
        "unknown-observation",
      ),
    ],
    [
      "unknown role",
      canonicalCodecPayloads[2].replace(
        "attached-context-fragment",
        "scope-fragment",
      ),
    ],
    [
      "unknown detector",
      canonicalCodecPayloads[2].replace(
        "explicit-context-lead",
        "winner-detector",
      ),
    ],
    [
      "missing field",
      canonicalCodecPayloads[0].replace(
        ',"observedText":"항목 요구사항 배선 접지하여야 한다"',
        "",
      ),
    ],
    [
      "wrong type",
      canonicalCodecPayloads[0].replace('"pageNumber":1', '"pageNumber":"1"'),
    ],
    [
      "nonnormalized observed text",
      canonicalCodecPayloads[0].replace("항목 요구사항", "항목  요구사항"),
    ],
    [
      "null filler",
      canonicalCodecPayloads[0].replace(
        ',"observedText"',
        ',"detectors":null,"observedText"',
      ),
    ],
    [
      "noncanonical key order",
      '{"observedText":"항목 요구사항 배선 접지하여야 한다","kind":"column-gap-region-excluded","span":{"pageNumber":1,"startItemIndex":0,"endItemIndexExclusive":6}}',
    ],
    [
      "noncanonical detector order",
      canonicalCodecPayloads[2].replace(
        '["explicit-context-lead","short-heading-adjacent"]',
        '["short-heading-adjacent","explicit-context-lead"]',
      ),
    ],
    [
      "duplicate detector",
      canonicalCodecPayloads[2].replace(
        '["explicit-context-lead","short-heading-adjacent"]',
        '["explicit-context-lead","explicit-context-lead"]',
      ),
    ],
    [
      "negative coordinate",
      canonicalCodecPayloads[0].replace('"pageNumber":1', '"pageNumber":-1'),
    ],
    [
      "negative zero",
      canonicalCodecPayloads[0].replace(
        '"startItemIndex":0',
        '"startItemIndex":-0',
      ),
    ],
    [
      "non-integer coordinate",
      canonicalCodecPayloads[0].replace('"pageNumber":1', '"pageNumber":1.5'),
    ],
    [
      "unsafe coordinate",
      canonicalCodecPayloads[0].replace(
        '"pageNumber":1',
        `"pageNumber":${Number.MAX_SAFE_INTEGER + 1}`,
      ),
    ],
    [
      "empty span",
      canonicalCodecPayloads[0].replace(
        '"endItemIndexExclusive":6',
        '"endItemIndexExclusive":0',
      ),
    ],
    [
      "unknown termination",
      canonicalCodecPayloads[2].replace(
        "preceding-non-context-candidate",
        "non-candidate-paragraph",
      ),
    ],
    [
      "unknown suppression reason",
      canonicalCodecPayloads[1].replace(
        "gap-above-window",
        "structural-region-boundary",
      ),
    ],
  ])("rejects %s", async (_name, payload) => {
    const codec = await captureCodec();
    expect(() => codec.decodeKecSourceCaptureObservation(payload)).toThrow();
  });
});
