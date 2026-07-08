import type { ZodRawShape } from "zod";

export type VoltAiTool = {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (input?: unknown) => Promise<string> | string;
};
