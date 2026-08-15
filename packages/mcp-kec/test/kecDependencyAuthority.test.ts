import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertKecDependencyAuthority } from "./helpers/kecDependencyAuthority.js";

type DependencyMap = Record<string, string>;
type Manifest = Record<string, unknown>;

interface AdditionalManifest {
  readonly relativePath: string;
  readonly manifest: Manifest;
}

interface WorkspaceFixtureOptions {
  readonly rootManifest?: Manifest;
  readonly mcpKecManifest?: Manifest;
  readonly knowledgeSqliteManifest?: Manifest;
  readonly additionalManifests?: readonly AdditionalManifest[];
  readonly lockfileContent?: string;
}

const approvedRootDependencies: DependencyMap = {
  zod: "^3.25.76",
};

const approvedMcpKecDependencies: DependencyMap = {
  "@voltai/mcp-core": "workspace:*",
  "@voltai/knowledge-core": "workspace:*",
  "@voltai/knowledge-sqlite": "workspace:*",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "pdfjs-dist": "^6.1.200",
  zod: "^3.24.1",
};

const approvedKnowledgeSqliteDependencies: DependencyMap = {
  "@voltai/knowledge-core": "workspace:*",
};

const temporaryRoots: string[] = [];

function createRootManifest(): Manifest {
  return {
    name: "volt-ai",
    private: true,
    packageManager: "pnpm@9.15.4",
    scripts: {
      test: "vitest",
    },
    engines: {
      node: ">=22",
    },
    dependencies: { ...approvedRootDependencies },
    devDependencies: {
      "@types/node": "^22.0.0",
      eslint: "^9.0.0",
      prettier: "^3.0.0",
      tsx: "^4.0.0",
      typescript: "^5.0.0",
      vitest: "^2.1.8",
    },
  };
}

function createMcpKecManifest(): Manifest {
  return {
    name: "@voltai/mcp-kec",
    private: true,
    dependencies: { ...approvedMcpKecDependencies },
    devDependencies: {
      vitest: "^2.1.8",
    },
  };
}

function createKnowledgeSqliteManifest(): Manifest {
  return {
    name: "@voltai/knowledge-sqlite",
    private: true,
    dependencies: { ...approvedKnowledgeSqliteDependencies },
    devDependencies: {
      vitest: "^2.1.8",
    },
  };
}

function writeJson(root: string, relativePath: string, value: Manifest): void {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createWorkspaceFixture(options: WorkspaceFixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-kec-dependency-authority-"));
  temporaryRoots.push(root);

  writeJson(root, "package.json", options.rootManifest ?? createRootManifest());
  writeJson(
    root,
    "packages/mcp-kec/package.json",
    options.mcpKecManifest ?? createMcpKecManifest(),
  );
  writeJson(
    root,
    "packages/knowledge-sqlite/package.json",
    options.knowledgeSqliteManifest ?? createKnowledgeSqliteManifest(),
  );

  for (const additional of options.additionalManifests ?? []) {
    writeJson(root, additional.relativePath, additional.manifest);
  }

  if (options.lockfileContent !== undefined) {
    writeFileSync(
      join(root, "pnpm-lock.yaml"),
      options.lockfileContent,
      "utf8",
    );
  }

  return root;
}

function dependenciesWithout(
  dependencies: DependencyMap,
  dependencyName: string,
): DependencyMap {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => name !== dependencyName),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("assertKecDependencyAuthority", () => {
  it("accepts exactly the three approved dependency maps", () => {
    const workspaceRoot = createWorkspaceFixture();

    expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
  });

  describe("root protected dependencies", () => {
    it("rejects an added dependency", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          dependencies: {
            ...approvedRootDependencies,
            "left-pad": "^1.3.0",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });

    it("rejects removal of zod", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          dependencies: dependenciesWithout(approvedRootDependencies, "zod"),
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });

    it("rejects a changed zod declared specifier", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          dependencies: {
            ...approvedRootDependencies,
            zod: "^3.26.0",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });
  });

  describe("mcp-kec protected dependencies", () => {
    it("rejects an added dependency", () => {
      const workspaceRoot = createWorkspaceFixture({
        mcpKecManifest: {
          ...createMcpKecManifest(),
          dependencies: {
            ...approvedMcpKecDependencies,
            "left-pad": "^1.3.0",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });

    it("rejects removal of an approved dependency", () => {
      const workspaceRoot = createWorkspaceFixture({
        mcpKecManifest: {
          ...createMcpKecManifest(),
          dependencies: dependenciesWithout(
            approvedMcpKecDependencies,
            "pdfjs-dist",
          ),
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });

    it("rejects a changed approved declared specifier", () => {
      const workspaceRoot = createWorkspaceFixture({
        mcpKecManifest: {
          ...createMcpKecManifest(),
          dependencies: {
            ...approvedMcpKecDependencies,
            "@voltai/knowledge-core": "workspace:^",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });
  });

  describe("knowledge-sqlite protected dependencies", () => {
    it("rejects an added dependency", () => {
      const workspaceRoot = createWorkspaceFixture({
        knowledgeSqliteManifest: {
          ...createKnowledgeSqliteManifest(),
          dependencies: {
            ...approvedKnowledgeSqliteDependencies,
            "left-pad": "^1.3.0",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });

    it("rejects removal of @voltai/knowledge-core", () => {
      const workspaceRoot = createWorkspaceFixture({
        knowledgeSqliteManifest: {
          ...createKnowledgeSqliteManifest(),
          dependencies: dependenciesWithout(
            approvedKnowledgeSqliteDependencies,
            "@voltai/knowledge-core",
          ),
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });

    it("rejects a changed @voltai/knowledge-core declared specifier", () => {
      const workspaceRoot = createWorkspaceFixture({
        knowledgeSqliteManifest: {
          ...createKnowledgeSqliteManifest(),
          dependencies: {
            ...approvedKnowledgeSqliteDependencies,
            "@voltai/knowledge-core": "workspace:^",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).toThrow();
    });
  });

  describe("negative-space authority", () => {
    it("ignores complete root devDependencies changes", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          devDependencies: {
            "@types/node": "^99.0.0",
            eslint: "^99.0.0",
            prettier: "^99.0.0",
            tsx: "^99.0.0",
            typescript: "^99.0.0",
            vitest: "^99.0.0",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores root packageManager changes", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          packageManager: "pnpm@99.0.0",
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores root scripts changes", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          scripts: {
            build: "completely-different-build-command",
            test: "completely-different-test-command",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores root engines changes", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          engines: {
            node: ">=99",
            pnpm: ">=99",
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores unrelated root metadata", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          ...createRootManifest(),
          voltAiUnrelatedMetadata: {
            owner: "future-team",
            revision: 99,
          },
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores JSON property order when dependency maps are identical", () => {
      const workspaceRoot = createWorkspaceFixture({
        rootManifest: {
          dependencies: { ...approvedRootDependencies },
          engines: { node: ">=22" },
          scripts: { test: "vitest" },
          private: true,
          name: "volt-ai",
        },
        mcpKecManifest: {
          dependencies: { ...approvedMcpKecDependencies },
          private: true,
          name: "@voltai/mcp-kec",
        },
        knowledgeSqliteManifest: {
          dependencies: { ...approvedKnowledgeSqliteDependencies },
          private: true,
          name: "@voltai/knowledge-sqlite",
        },
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores an unrelated workspace package", () => {
      const workspaceRoot = createWorkspaceFixture({
        additionalManifests: [
          {
            relativePath: "packages/example-future-package/package.json",
            manifest: {
              name: "@voltai/example-future-package",
              private: true,
            },
          },
        ],
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores dependencies and devDependencies in an unrelated package", () => {
      const workspaceRoot = createWorkspaceFixture({
        additionalManifests: [
          {
            relativePath: "packages/example-future-package/package.json",
            manifest: {
              name: "@voltai/example-future-package",
              dependencies: {
                "left-pad": "^1.3.0",
              },
              devDependencies: {
                vitest: "^99.0.0",
              },
            },
          },
        ],
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("does not read or require pnpm-lock.yaml", () => {
      const workspaceRoot = createWorkspaceFixture();

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });

    it("ignores arbitrary unrelated pnpm-lock.yaml content", () => {
      const workspaceRoot = createWorkspaceFixture({
        lockfileContent:
          "this is deliberately not a pnpm lockfile and must not be parsed\n",
      });

      expect(() => assertKecDependencyAuthority(workspaceRoot)).not.toThrow();
    });
  });
});
