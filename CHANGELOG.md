# Changelog

## v0.2 Platform Foundation

VoltAI moved from MCP examples into the first platform foundation for electric-design review.

Implemented:

- Project file discovery with `list_project_files`.
- PDF text extraction with `read_pdf`.
- Excel workbook and row reading with `read_excel`.
- KEC indexing with `index_kec`.
- KEC search with `search_kec`.
- SQLite-backed KEC knowledge base.
- Replaceable embedding provider interface.
- Local placeholder embedding provider.
- Ollama `nomic-embed-text` embedding adapter.
- KEC index metadata validation for provider/model/dimensions.
- Paragraph-based KEC chunking with overlap and clause candidate extraction.
- Pure Agent Layer package `@voltai/agent-review`.
- MCP Agent package `@voltai/mcp-agent`.
- `review_project` MCP tool.
- Design item extraction with synonym rules.
- Item-level KEC search.
- Relationship-based review findings with severity, confidence, and proximity.
- Docker Compose support for MCP services.
- GitHub Actions CI for install, lint, test, build.
- Runtime Safety Fix:
  - Zod-backed MCP tool input schemas.
  - MCP protocol round-trip coverage with in-memory client/server transport.
  - `PROJECT_ROOT` realpath validation and symlink escape defense.
  - `review_project` constrained to `PROJECT_ROOT`.
  - `pathToFileURL`-based entrypoint guards.
- MIT License added for open source readiness.

Test status:

- Test Files: 18 passed
- Tests: 107 passed

## v0.1 Scaffold

Implemented:

- pnpm workspace monorepo.
- TypeScript, ESLint, Prettier, Vitest.
- Dockerfile and Docker Compose baseline.
- GitHub Actions CI.
- MCP package scaffolds:
  - `mcp-core`
  - `mcp-kec`
  - `mcp-cad`
  - `mcp-material`
  - `mcp-estimate`
  - `mcp-project-files`
- Placeholder MCP tools for initial package validation.
