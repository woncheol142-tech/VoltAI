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
