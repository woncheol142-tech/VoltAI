import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@voltai/agent-review": fileURLToPath(
        new URL("./packages/agent-review/src/index.ts", import.meta.url),
      ),
      "@voltai/knowledge-core": fileURLToPath(
        new URL("./packages/knowledge-core/src/index.ts", import.meta.url),
      ),
      "@voltai/knowledge-sqlite": fileURLToPath(
        new URL("./packages/knowledge-sqlite/src/index.ts", import.meta.url),
      ),
      "@voltai/mcp-kec": fileURLToPath(new URL("./packages/mcp-kec/src/index.ts", import.meta.url)),
      "@voltai/mcp-core": fileURLToPath(new URL("./packages/mcp-core/src/index.ts", import.meta.url)),
      "@voltai/knowledge-company": fileURLToPath(
        new URL("./packages/knowledge-company/src/index.ts", import.meta.url),
      ),
      "@voltai/knowledge-material": fileURLToPath(
        new URL("./packages/knowledge-material/src/index.ts", import.meta.url),
      ),
      "@voltai/mcp-company": fileURLToPath(
        new URL("./packages/mcp-company/src/index.ts", import.meta.url),
      ),
      "@voltai/mcp-project-files": fileURLToPath(
        new URL("./packages/mcp-project-files/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
});
