import { isMainModule } from "@voltai/mcp-core";

import { probeOllamaEmbedding } from "./ollamaEmbeddingSmoke/probeOllamaEmbedding.js";
import { readOllamaEmbeddingSmokeConfig } from "./ollamaEmbeddingSmoke/readOllamaEmbeddingSmokeConfig.js";
import { serializeOllamaEmbeddingSmoke } from "./ollamaEmbeddingSmoke/serializeOllamaEmbeddingSmoke.js";
import type { OllamaEmbeddingSmokeEnvironment } from "./ollamaEmbeddingSmoke/types.js";

export type OllamaEmbeddingSmokeCliDependencies = Readonly<{
  environment: OllamaEmbeddingSmokeEnvironment;
  argv: readonly string[];
  readConfig: typeof readOllamaEmbeddingSmokeConfig;
  probe: typeof probeOllamaEmbedding;
  serialize: typeof serializeOllamaEmbeddingSmoke;
  fetch: typeof fetch;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;

const ERROR_PREFIX = "KEC_OLLAMA_EMBEDDING_SMOKE: ";
const INVALID_CONFIGURATION = `${ERROR_PREFIX}INVALID_CONFIGURATION`;
const INTERNAL_ERROR = `${ERROR_PREFIX}INTERNAL_ERROR`;
const SELECTED_ENVIRONMENT_KEYS = [
  "KEC_EMBED_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_EMBED_MODEL",
  "OLLAMA_EMBED_TIMEOUT_MS",
] as const;

function readSelectedEnvironment(
  environment: NodeJS.ProcessEnv,
): OllamaEmbeddingSmokeEnvironment {
  const selected: Record<string, unknown> = {};

  for (const key of SELECTED_ENVIRONMENT_KEYS) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(environment, key);
    } catch {
      continue;
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      continue;
    }

    Object.defineProperty(selected, key, {
      enumerable: true,
      value: descriptor.value,
    });
  }

  return selected;
}

function approvedErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return INTERNAL_ERROR;
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(error, "message");
  } catch {
    return INTERNAL_ERROR;
  }
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string"
  ) {
    return INTERNAL_ERROR;
  }

  switch (descriptor.value) {
    case INVALID_CONFIGURATION:
    case `${ERROR_PREFIX}ENDPOINT_UNAVAILABLE`:
    case `${ERROR_PREFIX}REQUEST_TIMEOUT`:
    case `${ERROR_PREFIX}REQUEST_REJECTED`:
    case `${ERROR_PREFIX}INVALID_RESPONSE`:
    case INTERNAL_ERROR:
      return descriptor.value;
    default:
      return INTERNAL_ERROR;
  }
}

export async function runOllamaEmbeddingSmokeCli(
  dependencies: OllamaEmbeddingSmokeCliDependencies,
): Promise<number> {
  if (dependencies.argv.length !== 0) {
    dependencies.writeStderr(`${INVALID_CONFIGURATION}\n`);
    return 1;
  }

  try {
    const config = dependencies.readConfig(dependencies.environment);
    const result = await dependencies.probe(config, {
      fetch: dependencies.fetch,
    });
    const output = dependencies.serialize(result);
    dependencies.writeStdout(output);
    return 0;
  } catch (error) {
    dependencies.writeStderr(`${approvedErrorMessage(error)}\n`);
    return 1;
  }
}

export async function main(): Promise<void> {
  process.exitCode = await runOllamaEmbeddingSmokeCli({
    environment: readSelectedEnvironment(process.env),
    argv: process.argv.slice(2),
    readConfig: readOllamaEmbeddingSmokeConfig,
    probe: probeOllamaEmbedding,
    serialize: serializeOllamaEmbeddingSmoke,
    fetch: globalThis.fetch,
    writeStdout: (text) => {
      process.stdout.write(text);
    },
    writeStderr: (text) => {
      process.stderr.write(text);
    },
  });
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
