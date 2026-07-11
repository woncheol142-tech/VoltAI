import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMcpMaterial } from "./helpers/materialMcpHarness.js";

describe("mcp-material embedding and database configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed when MATERIAL_EMBED_PROVIDER is missing", async () => {
    const { createMaterialEmbeddingProviderFromEnv } = await loadMcpMaterial();

    expect(() => createMaterialEmbeddingProviderFromEnv({})).toThrow(
      /MATERIAL_EMBED_PROVIDER.*required/i,
    );
  });

  it("allows deterministic placeholder only when explicitly selected", async () => {
    const { createMaterialEmbeddingProviderFromEnv } = await loadMcpMaterial();
    const provider = createMaterialEmbeddingProviderFromEnv({
      MATERIAL_EMBED_PROVIDER: "placeholder",
    });

    expect(provider.getMetadata()).toEqual({
      provider: "placeholder",
      model: "material-local-placeholder",
    });
    await expect(provider.embed("XLPE cable")).resolves.toEqual(
      await provider.embed("XLPE cable"),
    );
  });

  it("rejects unsupported providers instead of silently falling back", async () => {
    const { createMaterialEmbeddingProviderFromEnv } = await loadMcpMaterial();

    expect(() =>
      createMaterialEmbeddingProviderFromEnv({
        MATERIAL_EMBED_PROVIDER: "ollama",
      }),
    ).toThrow(/MATERIAL_EMBED_PROVIDER.*placeholder/i);
  });

  it("uses no fetch or API key for explicit placeholder embeddings", async () => {
    const { createMaterialEmbeddingProviderFromEnv } = await loadMcpMaterial();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createMaterialEmbeddingProviderFromEnv({
      MATERIAL_EMBED_PROVIDER: "placeholder",
    });

    await provider.embed("breaker catalog");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the shared knowledge DB default and ignores KEC_DB_PATH", async () => {
    const { resolveMaterialKnowledgeDbPath } = await loadMcpMaterial();

    expect(resolveMaterialKnowledgeDbPath("/project", {})).toBe(
      join("/project", ".voltai", "knowledge.sqlite"),
    );
    expect(
      resolveMaterialKnowledgeDbPath("/project", {
        KNOWLEDGE_DB_PATH: "/tmp/materials.sqlite",
        KEC_DB_PATH: "/tmp/kec.sqlite",
      }),
    ).toBe("/tmp/materials.sqlite");
  });
});
