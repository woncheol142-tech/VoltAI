import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(testDirectory, "..", "..", "..");
const typeContractFixture = join(
  testDirectory,
  "fixtures",
  "inferenceContracts.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

describe("inference public type contract", () => {
  it("compiles the exact non-empty inference relation contract", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          typeContractFixture,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
