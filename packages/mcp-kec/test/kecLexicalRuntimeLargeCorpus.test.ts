import { describe, expect, it, vi } from "vitest";

import { searchKecLexically } from "../src/searchLexical/index.js";
import { createLargeKecLexicalSource } from "./helpers/kecLexicalRuntimeFixture.js";

describe("KEC lexical runtime large-corpus contract", () => {
  it("processes 20,000 persisted chunks deterministically without cache or mutation", async () => {
    const source = createLargeKecLexicalSource(20_000);
    const firstChunkId = source[0].chunkId;
    const lastChunkId = source.at(-1)?.chunkId;
    const listChunks = vi.fn(async () => source);

    const first = await searchKecLexically("접지", 25, { listChunks });
    const second = await searchKecLexically("접지", 25, { listChunks });

    expect(listChunks).toHaveBeenCalledTimes(2);
    expect(first).toHaveLength(25);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.map((result) => result.chunkId)).toEqual(
      Array.from(
        { length: 25 },
        (_, index) => `kec:large#chunk=${String(index).padStart(5, "0")}`,
      ),
    );
    expect(first.every((result) => Number.isFinite(result.lexicalScore))).toBe(
      true,
    );
    expect(source).toHaveLength(20_000);
    expect(source[0].chunkId).toBe(firstChunkId);
    expect(source.at(-1)?.chunkId).toBe(lastChunkId);
    expect(Object.isFrozen(source)).toBe(false);
  });
});
