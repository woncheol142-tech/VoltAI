import { afterEach, describe, expect, it, vi } from "vitest";

const cryptoMock = vi.hoisted(() => ({
  forceCollision: false,
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    createHash(...args: Parameters<typeof actual.createHash>) {
      const hash = actual.createHash(...args);
      if (!cryptoMock.forceCollision) return hash;
      return {
        update() {
          return this;
        },
        digest(encoding?: string) {
          if (encoding === "hex") return "0".repeat(64);
          return Buffer.alloc(32);
        },
      };
    },
  };
});

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import { createDrawingSpatialFixture } from "./helpers/drawingSpatialFixture.js";

describe("drawing spatial relation ID collision defense", () => {
  afterEach(() => {
    cryptoMock.forceCollision = false;
  });

  it("fails closed when two distinct pairs receive the same public ID", () => {
    cryptoMock.forceCollision = true;

    expect(() =>
      buildDrawingSpatialRelations(createDrawingSpatialFixture())
    ).toThrow(/relation.*collision|collision.*relation/i);
  });
});

