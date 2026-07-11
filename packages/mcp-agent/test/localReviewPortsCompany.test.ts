import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalReviewPorts } from "../src/ports/localReviewPorts.js";

const tempRoots: string[] = [];

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-company-local-ports-"));
  tempRoots.push(root);
  return root;
}

describe("createLocalReviewPorts Company Knowledge wiring", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  it("keeps KEC-only local review ports when Company embedding is not configured", async () => {
    vi.stubEnv("COMPANY_EMBED_PROVIDER", "");
    const ports = createLocalReviewPorts(createTempProject());

    expect(ports.searchCompany).toBeUndefined();
    await ports.close?.();
  });

  it("defers invalid Company setup to the optional Company search path", async () => {
    vi.stubEnv("COMPANY_EMBED_PROVIDER", "unsupported");

    const ports = createLocalReviewPorts(createTempProject());

    expect(ports.searchCompany).toEqual(expect.any(Function));
    await expect(ports.searchCompany!("Cable grounding")).rejects.toThrow(
      "COMPANY_EMBED_PROVIDER must be placeholder",
    );
    await ports.close?.();
  });

  it("wires an optional Company search without changing KEC search", async () => {
    const root = createTempProject();
    const companyVectorStore = {
      getIndexMetadata: vi.fn().mockResolvedValue({
        embeddingProvider: "test",
        embeddingModel: "company-test",
        dimensions: 2,
        indexedAt: "2026-01-01T00:00:00.000Z",
      }),
      search: vi.fn().mockResolvedValue([
        {
          chunkId: "company-row-1",
          documentId: "company:standards/electrical-standard.pdf",
          sourcePath: "standards/electrical-standard.pdf",
          chunkIndex: 0,
          locator: { kind: "page", page: 2 },
          metadata: {
            standardId: "CS-ELEC-001",
            title: "Electrical Design Standard",
            section: "Grounding",
            revision: null,
            effectiveDate: null,
            department: null,
          },
          text: "Cable grounding shall follow the company standard.",
          similarity: 0.9,
        },
      ]),
      close: vi.fn(),
    };
    const companyEmbeddingProvider = {
      getMetadata: () => ({ provider: "test", model: "company-test" }),
      embed: vi.fn().mockResolvedValue([1, 0]),
    };
    const ports = createLocalReviewPorts(root, {
      companyEmbeddingProvider,
      companyVectorStoreFactory: () => companyVectorStore,
    });

    expect(ports.searchCompany).toEqual(expect.any(Function));
    await expect(ports.searchCompany!("Cable grounding")).resolves.toEqual([
      expect.objectContaining({
        chunkId: "company-row-1",
        standardId: "CS-ELEC-001",
      }),
    ]);
    expect(ports.searchKec).toEqual(expect.any(Function));

    await ports.close?.();
    expect(companyVectorStore.close).toHaveBeenCalledTimes(1);
  });
});
