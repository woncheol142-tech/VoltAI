export function mapToolError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown MCP tool error";
}
