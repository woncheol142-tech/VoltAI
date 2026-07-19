# @voltai/mcp-project-files

MCP tools for reading project files under `PROJECT_ROOT`.

## `read_pdf`

Extract aggregate and page-level PDF text. `maxChars` applies to the aggregate text.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "maxChars": 50000
}
```

## `render_pdf_page`

Render one PDF page to `PROJECT_ROOT/.volt-ai/rendered/`. The default scale is `2` and the default format is `png`.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 2,
  "scale": 2,
  "format": "png"
}
```

## `index_drawing_list`

Parse coordinate-based PDF drawing-list tables into a structured JSON index.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "startPage": 2,
  "endPage": 9
}
```

Provide `outputName` to save the result under `PROJECT_ROOT/.volt-ai/indexes/`.
Without `outputName`, the tool returns the index without writing a file.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "startPage": 2,
  "endPage": 9,
  "outputName": "전기-도면목록"
}
```

This tool is a coordinate-based parser for drawing-list tables. It does not use OCR
and does not guarantee general table recognition across arbitrary vendor layouts.

## `map_drawing_pages`

Map drawing numbers from a saved Task 40 index to the PDF's drawing pages by reading
title-block coordinates.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "indexPath": ".volt-ai/indexes/전기-도면목록-08f2725e38fe-p002-p009.json",
  "startPage": 10,
  "endPage": 100,
  "outputName": "전기-페이지맵"
}
```

When the PDF is only a partial drawing set, unmatched index entries are expected.
`coverageRatio` reports the mapped portion of the index for the scanned PDF range.
The page map is a separate schema v1 document and does not change the Task 40 index.
The parser is title-block and coordinate based; OCR is not supported. Duplicate page
mappings remain ambiguous and are not reduced to an arbitrary single page in search.

## `search_drawings`

Search a saved Task 40 schema v1 drawing index.

```json
{
  "indexPath": ".volt-ai/indexes/전기-도면목록-08f2725e38fe-p002-p009.json",
  "query": "1단지 101동 전력간선"
}
```

Add a saved page map to enrich results with a drawing page when exactly one mapping exists.

```json
{
  "indexPath": ".volt-ai/indexes/전기-도면목록-08f2725e38fe-p002-p009.json",
  "pageMapPath": ".volt-ai/page-maps/전기-페이지맵-08f2725e38fe-p010-p100.json",
  "query": "E-401"
}
```

Optional hard filters are applied before query matching.

```json
{
  "indexPath": ".volt-ai/indexes/전기-도면목록-08f2725e38fe-p002-p009.json",
  "query": "피뢰",
  "limit": 20,
  "filters": {
    "complex": "2단지"
  }
}
```

The search is deterministic lexical search, not embedding or vector search. It uses
AND matching by default, performs no typo correction, and expands only a small
query-side synonym dictionary. Results include `matchedFields` and `matchReasons`
to explain why each drawing matched.

## `extract_drawing_layout`

Extract normalized text items and rotation-aware text lines from one PDF drawing
page. Coordinates use a top-left origin and include both page points and normalized
`0..1` bounding boxes. Extraction uses vector PDF.js textContent. Each valid
raw PDF.js text item remains an item, while lines are geometry-derived data that
support arbitrary text rotation.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69
}
```

Provide `outputName` to persist the schema v1 layout under
`PROJECT_ROOT/.volt-ai/layouts/`.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69,
  "outputName": "전기-도면-layout"
}
```

This Task 43A output contains text items and text lines only. It does not include
blocks, regions, drawing primitives, symbols, connections, OCR, or table inference.
A zero-text page is returned as a normal empty result, and the tool does not infer electrical
equipment meaning from the extracted text.

## `extract_drawing_primitives`

Extract painted paths from one vector PDF page while preserving paint order,
graphics state, exact curve bounds, and off-page geometry.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69
}
```

Provide `outputName` to persist compact schema v1 JSON under
`PROJECT_ROOT/.volt-ai/primitives/`.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69,
  "outputName": "E-154A-primitives"
}
```

This tool extracts painted paths only. It performs no line classification,
no rectangle classification, no polyline classification, no duplicate removal,
and no symbol or connection inference. Clipping-only paths are excluded, while
off-page geometry remains preserved without clamping. Large vector pages may
produce payloads larger than 10 MB. OCR and computer vision are not supported.

The decoder depends on the internal, non-public PDF.js 6.1.200 compressed constructPath
representation. The exact `pdfjs-dist` pin is therefore a
compatibility boundary and must be reviewed before upgrading PDF.js.

## `extract_drawing_classification`

Derive deterministic structural classification from the painted paths returned by
Task 43B-1. The primitive document and every primitive remain unchanged, and each
primitive receives exactly one primary kind using fixed precedence.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69
}
```

Provide `outputName` to persist compact schema v1 JSON under
`PROJECT_ROOT/.volt-ai/classifications/`.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69,
  "outputName": "E-154A-classification"
}
```

`confidence` reports deterministic rule satisfaction, not a semantic probability.
`rectangleCandidate` is only a structural four-edge candidate and does not confirm
drawing meaning. Duplicate diagnostics identify exact command geometry duplicates;
paint and style differences are excluded from that geometry duplicate definition.
No primitive is deleted or deduplicated. This tool performs no semantic inference,
no symbol recognition, no wire detection, and no circuit analysis. It does not use
OCR, computer vision, or AI. Large pages inherit the memory and payload limits of
painted primitive extraction.

## `extract_drawing_spatial_relations`

Build deterministic page-space bounding box relations between Task 43A text and
Task 43B primitive classifications for one PDF page. Text items and text lines are
kept as independent relation entities.

Each relation is expressed from the primitive to the text entity. Text items and
text lines remain independent entities, and inverse relation rows are not duplicated.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69
}
```

Provide `outputName` to persist compact schema v1 JSON under
`PROJECT_ROOT/.volt-ai/spatial/`.

```json
{
  "relativePath": "project-files/전기 결합_1_100.pdf",
  "page": 69,
  "outputName": "E-154A-spatial"
}
```

The tool records geometry relations from page-bbox AABB tests. Positive topology
relations are preserved, while disjoint candidates are limited to bounded nearest,
aligned, and adjacent proximity. It does not compare command geometry, and AABB
relations can include false positives for sparse or compound paths. This is not
semantic reasoning: there is no symbol recognition, no connection or circuit
inference, no OCR, and no AI classification. Large pages inherit the memory and
payload limits of layout and primitive extraction.
