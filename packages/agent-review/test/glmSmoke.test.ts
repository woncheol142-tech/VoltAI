import { describe, expect, it, vi } from "vitest";

import { runGlmSmokeTest } from "../src/smoke/runGlmSmoke.js";

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("GLM smoke test", () => {
  it("skips without fetch when provider is not glm", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const result = await runGlmSmokeTest({
      env: {},
      fetch,
    });

    expect(result).toEqual({
      status: "skipped",
      message: "GLM smoke test skipped: set REVIEW_LLM_PROVIDER=glm and ZAI_API_KEY to run.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips without fetch when API key is missing", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const result = await runGlmSmokeTest({
      env: { REVIEW_LLM_PROVIDER: "glm" },
      fetch,
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("ZAI_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails empty responses", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(" ")) as unknown as typeof globalThis.fetch;
    const result = await runGlmSmokeTest({
      env: {
        REVIEW_LLM_PROVIDER: "glm",
        ZAI_API_KEY: "secret-key",
      },
      fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toBe("GLM smoke test failed: response was empty.");
    expect(result.message).not.toContain("secret-key");
    expect(result.message).not.toContain("Bearer");
  });

  it("passes non-empty responses without exposing secrets", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse("# ok")) as unknown as typeof globalThis.fetch;
    const result = await runGlmSmokeTest({
      env: {
        REVIEW_LLM_PROVIDER: "glm",
        ZAI_API_KEY: "secret-key",
      },
      fetch,
    });

    expect(result).toEqual({
      status: "passed",
      message: "GLM smoke test passed: received non-empty markdown response.",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.message).not.toContain("secret-key");
    expect(result.message).not.toContain("Bearer");
  });
});
