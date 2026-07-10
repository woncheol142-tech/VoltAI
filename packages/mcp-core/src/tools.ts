import type { ZodRawShape } from "zod";

type ToolResultSerializer<TResult> = {
  serialize(result: TResult): string;
}["serialize"];

export type VoltAiTool<TResult = unknown> = {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (input?: unknown) => Promise<TResult> | TResult;
  serializeResult?: ToolResultSerializer<TResult>;
};
