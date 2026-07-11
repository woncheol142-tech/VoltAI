import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalReviewPorts } from "../src/ports/localReviewPorts.js";

const originalProvider = process.env.KEC_EMBED_PROVIDER;
const tempRoots: string[] = [];

describe("local review KEC provider configuration", () => {
  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.KEC_EMBED_PROVIDER;
    } else {
      process.env.KEC_EMBED_PROVIDER = originalProvider;
    }
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not silently create placeholder search when KEC provider is missing", () => {
    delete process.env.KEC_EMBED_PROVIDER;
    const root = mkdtempSync(join(tmpdir(), "voltai-local-kec-config-"));
    tempRoots.push(root);
    const vectorStore = {
      close: async () => {},
    } as never;

    expect(() =>
      createLocalReviewPorts(root, {
        vectorStoreFactory: () => vectorStore,
      }),
    ).toThrow("KEC_EMBED_PROVIDER is required; set it to placeholder or ollama");
  });
});
