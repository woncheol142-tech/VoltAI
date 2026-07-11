import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEmbeddingProviderFromEnv,
  LocalPlaceholderEmbeddingProvider,
  OllamaEmbeddingProvider,
} from "../src/knowledge/embedding.js";
import { createIndexKecTool } from "../src/tools/indexKec.js";
import { createSearchKecTool } from "../src/tools/searchKec.js";

const originalProvider = process.env.KEC_EMBED_PROVIDER;
const originalProjectRoot = process.env.PROJECT_ROOT;
const tempRoots: string[] = [];
const missingProviderError =
  "KEC_EMBED_PROVIDER is required; set it to placeholder or ollama";

function restoreEnvironment(): void {
  if (originalProvider === undefined) {
    delete process.env.KEC_EMBED_PROVIDER;
  } else {
    process.env.KEC_EMBED_PROVIDER = originalProvider;
  }
  if (originalProjectRoot === undefined) {
    delete process.env.PROJECT_ROOT;
  } else {
    process.env.PROJECT_ROOT = originalProjectRoot;
  }
}

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-kec-config-"));
  tempRoots.push(root);
  return root;
}

describe("KEC embedding provider fail-closed configuration", () => {
  afterEach(() => {
    restoreEnvironment();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails clearly when KEC_EMBED_PROVIDER is not configured", () => {
    delete process.env.KEC_EMBED_PROVIDER;

    expect(() => createEmbeddingProviderFromEnv()).toThrow(missingProviderError);
  });

  it("allows placeholder and ollama only when explicitly selected", () => {
    process.env.KEC_EMBED_PROVIDER = "placeholder";
    expect(createEmbeddingProviderFromEnv()).toBeInstanceOf(LocalPlaceholderEmbeddingProvider);

    process.env.KEC_EMBED_PROVIDER = "ollama";
    expect(createEmbeddingProviderFromEnv()).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it("rejects unsupported providers without placeholder fallback", () => {
    process.env.KEC_EMBED_PROVIDER = "unsupported";

    expect(() => createEmbeddingProviderFromEnv()).toThrow(
      "KEC_EMBED_PROVIDER must be placeholder or ollama",
    );
  });

  it("applies the same missing-provider policy to index_kec and search_kec", async () => {
    delete process.env.KEC_EMBED_PROVIDER;
    process.env.PROJECT_ROOT = createTempRoot();
    const vectorStore = {
      close: async () => {},
    } as never;

    await expect(
      createIndexKecTool({ vectorStore }).handler({ relativePath: "knowledge/kec.pdf" }),
    ).rejects.toThrow(missingProviderError);
    await expect(
      createSearchKecTool({ vectorStore }).handler({ query: "cable" }),
    ).rejects.toThrow(missingProviderError);
  });
});
