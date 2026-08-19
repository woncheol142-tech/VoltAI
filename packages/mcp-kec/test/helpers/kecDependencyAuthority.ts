import { readFileSync } from "node:fs";
import { join } from "node:path";

type DependencyMap = Readonly<Record<string, string>>;

interface ProtectedManifest {
  readonly relativePath: string;
  readonly dependencies: DependencyMap;
}

const protectedManifests: readonly ProtectedManifest[] = [
  {
    relativePath: "package.json",
    dependencies: {
      zod: "^3.25.76",
    },
  },
  {
    relativePath: "packages/mcp-kec/package.json",
    dependencies: {
      "@voltai/extraction-core": "workspace:*",
      "@voltai/mcp-core": "workspace:*",
      "@voltai/knowledge-core": "workspace:*",
      "@voltai/knowledge-sqlite": "workspace:*",
      "@voltai/source-core": "workspace:*",
      "@modelcontextprotocol/sdk": "^1.29.0",
      "pdfjs-dist": "^6.1.200",
      zod: "^3.24.1",
    },
  },
  {
    relativePath: "packages/knowledge-sqlite/package.json",
    dependencies: {
      "@voltai/knowledge-core": "workspace:*",
    },
  },
];

function manifestDependencies(manifest: unknown): unknown {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    return undefined;
  }

  return (manifest as Readonly<Record<string, unknown>>).dependencies;
}

function assertExactDependencies(
  actual: unknown,
  expected: DependencyMap,
  relativePath: string,
): void {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    throw new Error(`Dependency authority mismatch in ${relativePath}`);
  }

  const actualDependencies = actual as Readonly<Record<string, unknown>>;
  const actualNames = Object.keys(actualDependencies).sort();
  const expectedNames = Object.keys(expected).sort();
  const namesMatch =
    actualNames.length === expectedNames.length &&
    actualNames.every((name, index) => name === expectedNames[index]);

  if (
    !namesMatch ||
    expectedNames.some((name) => actualDependencies[name] !== expected[name])
  ) {
    throw new Error(`Dependency authority mismatch in ${relativePath}`);
  }
}

export function assertKecDependencyAuthority(workspaceRoot: string): void {
  for (const protectedManifest of protectedManifests) {
    const manifest = JSON.parse(
      readFileSync(join(workspaceRoot, protectedManifest.relativePath), "utf8"),
    ) as unknown;

    assertExactDependencies(
      manifestDependencies(manifest),
      protectedManifest.dependencies,
      protectedManifest.relativePath,
    );
  }
}
