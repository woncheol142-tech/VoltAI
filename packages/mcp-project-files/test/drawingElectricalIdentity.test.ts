import { describe, expect, it } from "vitest";

import { importElectricalModule } from "./helpers/drawingElectricalObjectsFixture.js";

type IdentityInput = {
  sourceSha256: string;
  page: number;
  ruleId: string;
  primaryPrimitiveIds: string[];
  supportingPrimitiveIds: string[];
  contextPrimitiveIds: string[];
  labelIds: string[];
};

type IdentityModule = {
  createElectricalObjectId(input: IdentityInput): string;
};

const base = (): IdentityInput => ({
  sourceSha256: "a".repeat(64),
  page: 15,
  ruleId: "synthetic.breaker",
  primaryPrimitiveIds: ["primitive-2", "primitive-1"],
  supportingPrimitiveIds: ["support-2", "support-1"],
  contextPrimitiveIds: ["문맥-2", "문맥-1"],
  labelIds: ["label-2", "label-1"],
});

async function load() {
  return importElectricalModule<IdentityModule>("objectIdentity");
}

describe("deterministic electrical object identity", () => {
  it("is independent of primitive and label input order", async () => {
    const { createElectricalObjectId } = await load();
    const first = base();
    const second = structuredClone(first);
    second.primaryPrimitiveIds.reverse();
    second.supportingPrimitiveIds.reverse();
    second.contextPrimitiveIds.reverse();
    second.labelIds.reverse();
    expect(createElectricalObjectId(second)).toBe(createElectricalObjectId(first));
  });

  it.each([
    ["sourceSha256", (value: IdentityInput) => { value.sourceSha256 = "b".repeat(64); }],
    ["page", (value: IdentityInput) => { value.page += 1; }],
    ["ruleId", (value: IdentityInput) => { value.ruleId = "synthetic.panel"; }],
    ["primary", (value: IdentityInput) => { value.primaryPrimitiveIds.push("primitive-3"); }],
    ["supporting", (value: IdentityInput) => { value.supportingPrimitiveIds.push("support-3"); }],
    ["context", (value: IdentityInput) => { value.contextPrimitiveIds.push("문맥-3"); }],
    ["label", (value: IdentityInput) => { value.labelIds.push("label-3"); }],
  ])("changes when %s identity input changes", async (_name, mutate) => {
    const { createElectricalObjectId } = await load();
    const first = base();
    const second = structuredClone(first);
    mutate(second);
    expect(createElectricalObjectId(second)).not.toBe(createElectricalObjectId(first));
  });

  it("preserves Unicode code points and returns lowercase 24-hex IDs", async () => {
    const { createElectricalObjectId } = await load();
    const unicode = base();
    unicode.labelIds = ["분전반-A", "ＭＣＣＢ"];
    const normalized = structuredClone(unicode);
    normalized.labelIds = unicode.labelIds.map((value) => value.normalize("NFKC"));
    expect(createElectricalObjectId(unicode)).toMatch(/^[a-f0-9]{24}$/u);
    expect(createElectricalObjectId(unicode)).not.toBe(
      createElectricalObjectId(normalized),
    );
  });

  it("rejects duplicate IDs before canonicalization", async () => {
    const { createElectricalObjectId } = await load();
    const duplicate = base();
    duplicate.primaryPrimitiveIds = ["primitive-1", "primitive-1"];
    expect(() => createElectricalObjectId(duplicate)).toThrow(/duplicate|id/i);
  });

  it("does not include confidence, bbox, attributes, or candidate order", async () => {
    const { createElectricalObjectId } = await load();
    const input = base();
    expect(createElectricalObjectId({ ...input })).toBe(
      createElectricalObjectId(structuredClone(input)),
    );
  });
});
