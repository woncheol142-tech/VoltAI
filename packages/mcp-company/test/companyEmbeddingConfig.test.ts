import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMcpCompany } from "./helpers/companyMcpHarness.js";

describe("mcp-company embedding and database configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed when COMPANY_EMBED_PROVIDER is not configured", async () => {
    const { createCompanyEmbeddingProviderFromEnv } = await loadMcpCompany();

    expect(() => createCompanyEmbeddingProviderFromEnv({})).toThrow(
      /COMPANY_EMBED_PROVIDER.*required/i,
    );
  });

  it("creates the deterministic placeholder only when explicitly selected", async () => {
    const { createCompanyEmbeddingProviderFromEnv } = await loadMcpCompany();
    const provider = createCompanyEmbeddingProviderFromEnv({
      COMPANY_EMBED_PROVIDER: "placeholder",
    });

    expect(provider.getMetadata()).toEqual({
      provider: "placeholder",
      model: "company-local-placeholder",
    });
    await expect(provider.embed("grounding requirement")).resolves.toEqual(
      await provider.embed("grounding requirement"),
    );
  });

  it("rejects unsupported embedding providers instead of silently using placeholder", async () => {
    const { createCompanyEmbeddingProviderFromEnv } = await loadMcpCompany();

    expect(() =>
      createCompanyEmbeddingProviderFromEnv({
        COMPANY_EMBED_PROVIDER: "ollama",
      }),
    ).toThrow(/COMPANY_EMBED_PROVIDER.*placeholder/i);
  });

  it("runs explicit placeholder embedding without fetch or API keys", async () => {
    const { createCompanyEmbeddingProviderFromEnv } = await loadMcpCompany();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createCompanyEmbeddingProviderFromEnv({
      COMPANY_EMBED_PROVIDER: "placeholder",
    });

    const embedding = await provider.embed("company grounding standard");

    expect(embedding.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("defaults to PROJECT_ROOT/.voltai/knowledge.sqlite", async () => {
    const { resolveCompanyKnowledgeDbPath } = await loadMcpCompany();

    expect(resolveCompanyKnowledgeDbPath("/project", {})).toBe(
      join("/project", ".voltai", "knowledge.sqlite"),
    );
  });

  it("uses KNOWLEDGE_DB_PATH override and ignores KEC_DB_PATH", async () => {
    const { resolveCompanyKnowledgeDbPath } = await loadMcpCompany();

    expect(
      resolveCompanyKnowledgeDbPath("/project", {
        KNOWLEDGE_DB_PATH: "/tmp/company-knowledge.sqlite",
        KEC_DB_PATH: "/tmp/legacy-kec.sqlite",
      }),
    ).toBe("/tmp/company-knowledge.sqlite");
    expect(
      resolveCompanyKnowledgeDbPath("/project", {
        KEC_DB_PATH: "/tmp/legacy-kec.sqlite",
      }),
    ).toBe(join("/project", ".voltai", "knowledge.sqlite"));
  });
});
