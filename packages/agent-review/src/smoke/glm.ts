import { pathToFileURL } from "node:url";

import { runGlmSmokeTest } from "./runGlmSmoke.js";

async function main(): Promise<void> {
  const result = await runGlmSmokeTest();

  console.log(result.message);

  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
