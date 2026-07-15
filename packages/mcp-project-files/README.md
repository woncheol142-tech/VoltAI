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

## `search_drawings`

Search a saved Task 40 schema v1 drawing index.

```json
{
  "indexPath": ".volt-ai/indexes/전기-도면목록-08f2725e38fe-p002-p009.json",
  "query": "1단지 101동 전력간선"
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
