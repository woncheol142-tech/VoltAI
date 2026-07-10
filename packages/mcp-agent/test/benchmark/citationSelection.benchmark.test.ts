import { expect, it } from "vitest";

import { evaluateReview } from "./helpers/evaluateReview.js";
import { reviewQualityManifest } from "./fixtures/reviewQualityManifest.js";
import { prepareBenchmarkFixture } from "./fixtures/prepareBenchmarkFixture.js";

it("turns the unchanged review-quality manifest into a strict pass after citation selection", async () => {
  const benchmark = await prepareBenchmarkFixture();

  try {
    const result = evaluateReview(await benchmark.runReview(), reviewQualityManifest);

    expect(result.citations).toMatchObject({
      matched: 1,
      unexpected: [],
      wrongLocations: [],
    });
    expect(result.forbiddenCitations).toEqual([]);
    expect(result.passed).toBe(true);
  } finally {
    await benchmark.cleanup();
  }
});
