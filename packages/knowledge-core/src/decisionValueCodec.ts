import type { JsonValue } from "./types.js";

export type DecisionValueCodec<TValue> = {
  encode: (value: TValue) => JsonValue;
  decode: (value: unknown) => TValue;
};
