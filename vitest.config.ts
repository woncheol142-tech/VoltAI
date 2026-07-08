import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@voltai/agent-review": fileURLToPath(
        new URL("./packages/agent-review/src/index.ts", import.meta.url),
      ),
      "@voltai/mcp-kec": fileURLToPath(new URL("./packages/mcp-kec/src/index.ts", import.meta.url)),
      "@voltai/mcp-project-files": fileURLToPath(
        new URL("./packages/mcp-project-files/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
});
