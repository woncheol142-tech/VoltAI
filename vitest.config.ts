import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "decode-absolute-file-url-spaces",
      enforce: "pre",
      resolveId(source) {
        return source.startsWith("/") && source.includes("%20")
          ? decodeURI(source)
          : undefined;
      },
    },
  ],
  resolve: {
    alias: {
      "@voltai/decision-sqlite/judgement-ledger": fileURLToPath(
        new URL(
          "./packages/decision-sqlite/src/judgementLedger.ts",
          import.meta.url,
        ),
      ),
      "@voltai/kec-source-policy-sqlite": fileURLToPath(
        new URL(
          "./packages/kec-source-policy-sqlite/src/index.ts",
          import.meta.url,
        ),
      ),
      "@voltai/kec-source-policy-judgement": fileURLToPath(
        new URL(
          "./packages/kec-source-policy-judgement/src/index.ts",
          import.meta.url,
        ),
      ),
      "@voltai/kec-source-resolution": fileURLToPath(
        new URL(
          "./packages/kec-source-resolution/src/index.ts",
          import.meta.url,
        ),
      ),
      "@voltai/kec-source-pipeline": fileURLToPath(
        new URL("./packages/kec-source-pipeline/src/index.ts", import.meta.url),
      ),
      "@voltai/kec-source-policy": fileURLToPath(
        new URL("./packages/kec-source-policy/src/index.ts", import.meta.url),
      ),
      "@voltai/agent-review": fileURLToPath(
        new URL("./packages/agent-review/src/index.ts", import.meta.url),
      ),
      "@voltai/source-core": fileURLToPath(
        new URL("./packages/source-core/src/index.ts", import.meta.url),
      ),
      "@voltai/source-admission": fileURLToPath(
        new URL("./packages/source-admission/src/index.ts", import.meta.url),
      ),
      "@voltai/source-admission-sqlite": fileURLToPath(
        new URL(
          "./packages/source-admission-sqlite/src/index.ts",
          import.meta.url,
        ),
      ),
      "@voltai/kec-source-runtime": fileURLToPath(
        // The generic workspace audit derives
        // "./packages/kec-source-runtime/src/index.ts" mechanically, while
        // this package's supported root is intentionally public.ts.
        new URL("./packages/kec-source-runtime/src/public.ts", import.meta.url),
      ),
      "@voltai/extraction-core": fileURLToPath(
        new URL("./packages/extraction-core/src/index.ts", import.meta.url),
      ),
      "@voltai/validation-core": fileURLToPath(
        new URL("./packages/validation-core/src/index.ts", import.meta.url),
      ),
      "@voltai/decision-sqlite": fileURLToPath(
        new URL("./packages/decision-sqlite/src/index.ts", import.meta.url),
      ),
      "@voltai/knowledge-core": fileURLToPath(
        new URL("./packages/knowledge-core/src/index.ts", import.meta.url),
      ),
      "@voltai/knowledge-sqlite": fileURLToPath(
        new URL("./packages/knowledge-sqlite/src/index.ts", import.meta.url),
      ),
      "@voltai/mcp-kec": fileURLToPath(
        new URL("./packages/mcp-kec/src/index.ts", import.meta.url),
      ),
      "@voltai/mcp-core": fileURLToPath(
        new URL("./packages/mcp-core/src/index.ts", import.meta.url),
      ),
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
