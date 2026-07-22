import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { serializeCircuitGraphDocument } from "../src/drawingCircuitGraph/serializeCircuitGraphDocument.js";
import {
  deepFreezeCircuitFixture,
  makeCircuitGraphDocument,
  refreshCircuitGraphFixture,
} from "./helpers/drawingCircuitGraphFixture.js";

describe("circuit graph deterministic serialization", () => {
  it("validates before serialization and never repairs ordering", () => {
    const document = makeCircuitGraphDocument();
    document.nodes.reverse();
    expect(() => serializeCircuitGraphDocument(document)).toThrow(
      /canonical|node/i,
    );
  });

  it("canonicalizes nested keys and negative zero without changing graph identity", () => {
    const first = makeCircuitGraphDocument();
    const second = makeCircuitGraphDocument();
    second.nodes[0]!.attributes = {
      nested: { z: 0, a: "분전반" },
      name: "LP-1",
    };
    refreshCircuitGraphFixture(second);
    const firstJson = serializeCircuitGraphDocument(first);
    const secondJson = serializeCircuitGraphDocument(second);
    expect(second.graphId).toBe(first.graphId);
    expect(secondJson).toBe(firstJson);
    expect(firstJson).toContain('"offset":0');
    expect(firstJson).not.toContain('"offset":-0');
  });

  it("writes compact UTF-8 JSON with no BOM and exactly one trailing LF", () => {
    const serialized = serializeCircuitGraphDocument(
      makeCircuitGraphDocument(),
    );
    expect(serialized.startsWith("\uFEFF")).toBe(false);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
    expect(serialized).not.toContain("\n  ");
    expect(serialized).toContain("전기 회로");
    expect(Buffer.from(serialized, "utf8").toString("utf8")).toBe(serialized);
  });

  it("produces identical bytes and SHA-256 for repeated canonical documents", () => {
    const document = makeCircuitGraphDocument();
    const first = serializeCircuitGraphDocument(document);
    const second = serializeCircuitGraphDocument(structuredClone(document));
    expect(second).toBe(first);
    expect(createHash("sha256").update(second).digest("hex")).toBe(
      createHash("sha256").update(first).digest("hex"),
    );
  });

  it("does not mutate deeply frozen input", () => {
    const document = makeCircuitGraphDocument();
    const before = structuredClone(document);
    deepFreezeCircuitFixture(document);
    expect(() => serializeCircuitGraphDocument(document)).not.toThrow();
    expect(document).toEqual(before);
  });

  it("rejects forbidden public fields instead of leaking internal state", () => {
    const document = makeCircuitGraphDocument();
    Reflect.set(document, "adjacency", new Map());
    Reflect.set(document.nodes[0]!, "sourceObjectDocument", { private: true });
    expect(() => serializeCircuitGraphDocument(document)).toThrow(
      /shape|field|document|node/i,
    );
    const baseline = serializeCircuitGraphDocument(makeCircuitGraphDocument());
    expect(baseline).not.toMatch(
      /adjacency|sourceObjectDocument|validationState|tempPath/u,
    );
  });
});
