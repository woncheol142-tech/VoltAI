# Testing VoltAI

Run the full offline suite from the repository root:

```bash
npx pnpm@9.15.4 test
```

Run the project-level E2E suite directly:

```bash
npx pnpm@9.15.4 --filter @voltai/mcp-agent test:e2e
```

Run the deterministic review-quality benchmark directly:

```bash
npx pnpm@9.15.4 --filter @voltai/mcp-agent test:benchmark
```

| Suite | Purpose | Network policy |
| --- | --- | --- |
| Unit | Isolated component behavior and contracts. | Offline. |
| E2E | Project files, SQLite lifecycle, local ports, and MCP transport wiring. | Offline with temporary fixture data. |
| Benchmark | Typed `ReviewReport` semantic quality, provenance, citations, coverage, and structured diagnostics. | Offline with deterministic Mock LLM and embeddings. |
| Provider smoke | Explicit provider connectivity check only. | May contact the configured provider. |

The E2E and benchmark suites create temporary PDF/XLSX/KEC/SQLite data and remove their project roots after completion. They use deterministic embedding and `MockReviewLlm`; no API key is required.

Current deterministic benchmark baseline:

- Design items: precision `1.0`, recall `1.0`
- Relations: precision `1.0`, recall `1.0`
- Citations: hit rate `1.0`; unexpected/forbidden `KEC 999.1` is recorded
- Coverage: `2/2` matched with no missing or unexpected finding
- Required report sections: `7/7`
- Overall strict `passed`: `false`, intentionally reflecting the distractor citation baseline

GLM provider smoke paths, such as an optional `smoke:glm` command, are separate from the E2E suite. They are explicitly invoked against a configured GLM environment, may contact Z.AI, and must never run as part of the normal test suite.
