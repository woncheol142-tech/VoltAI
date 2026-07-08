# Next Steps

## P0

### Task 15 Candidate: Structured Evidence

Replace string-only evidence with structured evidence:

- `sourceType`
- `sourcePath`
- `page`
- `sheetName`
- `rowIndex`
- `excerpt`

Why:

- Improves proximity analysis accuracy.
- Makes reports traceable back to source files.
- Prepares the agent for page/row citations.

### Task 16 Candidate: DWG Metadata

Add DWG/DXF metadata analysis.

Initial scope:

- file metadata
- layer names
- block names
- drawing units if available
- text entity counts if accessible

Why:

- Moves VoltAI closer to actual electrical drawing review.
- Enables later DWG text extraction and design-item detection from drawings.

### Task 17 Candidate: Excel Parser Security

Review and replace the current `xlsx` dependency strategy.

Initial scope:

- Evaluate SheetJS authoritative distribution options versus npm `xlsx`.
- Decide whether to pin a non-npm tarball, replace the parser, or sandbox Excel parsing.
- Add file size, row count, and formula handling limits as explicit security controls.

Why:

- npm `xlsx@0.18.5` has known security advisories without a fixed npm release.
- Excel parsing is exposed through MCP tools and should have a clear dependency and input-safety policy.

## P1

### Estimate Analyzer

Analyze Excel estimate sheets for quantities, units, missing values, abnormal rows, and design-item links.

### Material Catalog

Create a material catalog knowledge source for common electrical materials, ratings, units, and vendor/catalog references.

### Project Memory

Persist project-level review history, decisions, recurring issues, and previous reports.

## P2

### Real LLM

Replace `MockReviewLlm` with a configurable local or hosted LLM adapter while keeping tests deterministic.

### Company Knowledge

Add company design standards as a separate knowledge base alongside KEC.

### Change Impact Analysis

Compare design revisions and estimate changes to identify affected circuits, materials, and report sections.
