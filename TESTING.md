# Testing VoltAI

Run the full offline suite from the repository root:

```bash
npx pnpm@9.15.4 test
```

Run the project-level E2E suite directly:

```bash
npx pnpm@9.15.4 --filter @voltai/mcp-agent test:e2e
```

The E2E suite creates a temporary PDF, XLSX workbook, KEC PDF, and SQLite database for each test. It uses a deterministic embedding provider and `MockReviewLlm`, makes no external network calls, and removes its temporary project root after completion.

GLM provider smoke paths, such as an optional `smoke:glm` command, are separate from the E2E suite. They are explicitly invoked against a configured GLM environment, may contact Z.AI, and must never run as part of the normal test suite.
