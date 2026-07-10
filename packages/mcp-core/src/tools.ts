import type { ZodRawShape } from "zod";

export type VoltAiTool<TResult = unknown> = {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (input?: unknown) => Promise<TResult> | TResult;
  serializeResult?: (result: TResult) => string;
};
