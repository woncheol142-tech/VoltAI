import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");

describe("GLM smoke script wiring", () => {
  it("exposes smoke:glm outside the normal test suite", () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["smoke:glm"]).toBe(
      "tsc -p tsconfig.json && node dist/smoke/glm.js",
    );
    expect(packageJson.scripts?.test).not.toContain("smoke");
  });
});
