import { isMainModule } from "@voltai/mcp-core";

import {
  executeKecBatchIndex,
  prepareKecBatchIndex,
  readKecBatchIndexConfig,
  serializeKecBatchIndexResult,
  type KecBatchIndexConfig,
  type KecBatchIndexExecutionDependencies,
  type KecBatchIndexResultV1,
  type PreparedKecBatchIndex,
} from "./batchIndexing/index.js";
import type { EmbeddingProvider } from "./knowledge/embedding.js";
import type { VectorStore } from "./knowledge/vectorStore.js";

export type KecBatchIndexCliDependencies = Readonly<{
  cwd: string;
  readConfig: (environment: unknown, cwd: string) => KecBatchIndexConfig;
  prepare: (
    config: KecBatchIndexConfig,
    request: unknown,
  ) => PreparedKecBatchIndex;
  execute: (
    prepared: PreparedKecBatchIndex,
    dependencies: KecBatchIndexExecutionDependencies,
  ) => Promise<KecBatchIndexResultV1>;
  serialize: (result: KecBatchIndexResultV1) => string;
  createExecutionDependencies: (
    prepared: PreparedKecBatchIndex,
  ) => KecBatchIndexExecutionDependencies;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;

type ValidatedCliDependencies = KecBatchIndexCliDependencies;

const INVALID_CONFIGURATION = "KEC_BATCH_INDEX: INVALID_CONFIGURATION";
const INVALID_ARGUMENT = "KEC_BATCH_INDEX: INVALID_ARGUMENT";
const INTERNAL_ERROR = "KEC_BATCH_INDEX: INTERNAL_ERROR";
const APPROVED_ERROR_MESSAGES: readonly string[] = Object.freeze([
  INVALID_CONFIGURATION,
  INVALID_ARGUMENT,
  "KEC_BATCH_INDEX: DUPLICATE_SOURCE",
  "KEC_BATCH_INDEX: SOURCE_NOT_FOUND",
  "KEC_BATCH_INDEX: SOURCE_NOT_REGULAR_FILE",
  "KEC_BATCH_INDEX: UNSUPPORTED_SOURCE",
  "KEC_BATCH_INDEX: UNSAFE_SOURCE",
  "KEC_BATCH_INDEX: DATABASE_UNAVAILABLE",
  "KEC_BATCH_INDEX: FINALIZATION_FAILED",
  INTERNAL_ERROR,
]);
const DEPENDENCY_KEYS = Object.freeze([
  "cwd",
  "readConfig",
  "prepare",
  "execute",
  "serialize",
  "createExecutionDependencies",
  "writeStdout",
  "writeStderr",
] as const);
const SELECTED_ENVIRONMENT_KEYS = Object.freeze([
  "PROJECT_ROOT",
  "KEC_DB_PATH",
  "KEC_EMBED_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_EMBED_MODEL",
  "OLLAMA_EMBED_TIMEOUT_MS",
  "KEC_EMBED_CONCURRENCY",
  "KEC_EMBED_MAX_ATTEMPTS",
  "KEC_EMBED_RETRY_DELAY_MS",
] as const);

function isPlainOrNullPrototype(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function validateArgv(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    if (Object.getOwnPropertySymbols(value).length !== 0) return null;

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 1
    ) {
      return null;
    }

    const length = lengthDescriptor.value as number;
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== length + 1 || !names.includes("length")) return null;

    const copy: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!names.includes(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string" ||
        descriptor.value.length === 0 ||
        descriptor.value.startsWith("-")
      ) {
        return null;
      }
      copy.push(descriptor.value);
    }
    return copy;
  } catch {
    return null;
  }
}

function validateEnvironment(value: unknown): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isPlainOrNullPrototype(value)
  );
}

function validateDependencies(value: unknown): ValidatedCliDependencies | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !isPlainOrNullPrototype(value)
  ) {
    return null;
  }

  try {
    if (Object.getOwnPropertySymbols(value).length !== 0) return null;
    const names = Object.getOwnPropertyNames(value);
    if (
      names.length !== DEPENDENCY_KEYS.length ||
      DEPENDENCY_KEYS.some((key) => !names.includes(key))
    ) {
      return null;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of DEPENDENCY_KEYS) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return null;
    }
    if (typeof descriptors.cwd?.value !== "string") return null;
    if (
      typeof descriptors.readConfig?.value !== "function" ||
      typeof descriptors.prepare?.value !== "function" ||
      typeof descriptors.execute?.value !== "function" ||
      typeof descriptors.serialize?.value !== "function" ||
      typeof descriptors.createExecutionDependencies?.value !== "function" ||
      typeof descriptors.writeStdout?.value !== "function" ||
      typeof descriptors.writeStderr?.value !== "function"
    ) {
      return null;
    }

    return {
      cwd: descriptors.cwd.value,
      readConfig: descriptors.readConfig.value,
      prepare: descriptors.prepare.value,
      execute: descriptors.execute.value,
      serialize: descriptors.serialize.value,
      createExecutionDependencies:
        descriptors.createExecutionDependencies.value,
      writeStdout: descriptors.writeStdout.value,
      writeStderr: descriptors.writeStderr.value,
    } as ValidatedCliDependencies;
  } catch {
    return null;
  }
}

function approvedErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return INTERNAL_ERROR;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      !APPROVED_ERROR_MESSAGES.includes(descriptor.value)
    ) {
      return INTERNAL_ERROR;
    }
    return descriptor.value;
  } catch {
    return INTERNAL_ERROR;
  }
}

function writeError(
  dependencies: ValidatedCliDependencies,
  message: string,
): number {
  try {
    dependencies.writeStderr(`${message}\n`);
  } catch {
    // The CLI cannot safely report a writer failure through the same writer.
  }
  return 1;
}

function resultExitCode(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(result, "status");
    if (descriptor === undefined || !("value" in descriptor)) return null;
    if (descriptor.value === "SUCCEEDED") return 0;
    if (descriptor.value === "PARTIAL" || descriptor.value === "FAILED") {
      return 2;
    }
    return null;
  } catch {
    return null;
  }
}

export async function runKecBatchIndexCli(
  argv: readonly string[],
  environment: unknown,
  dependencies: KecBatchIndexCliDependencies,
): Promise<number> {
  const argvCopy = validateArgv(argv);
  const validatedDependencies = validateDependencies(dependencies);
  if (validatedDependencies === null) return 1;
  if (argvCopy === null)
    return writeError(validatedDependencies, INVALID_ARGUMENT);
  if (!validateEnvironment(environment)) {
    return writeError(validatedDependencies, INVALID_CONFIGURATION);
  }

  try {
    const config = validatedDependencies.readConfig(
      environment,
      validatedDependencies.cwd,
    );
    const prepared = validatedDependencies.prepare(config, {
      sources: argvCopy,
    });
    const executionDependencies =
      validatedDependencies.createExecutionDependencies(prepared);
    const result = await validatedDependencies.execute(
      prepared,
      executionDependencies,
    );
    const exitCode = resultExitCode(result);
    if (exitCode === null)
      return writeError(validatedDependencies, INTERNAL_ERROR);
    const output = validatedDependencies.serialize(result);
    try {
      validatedDependencies.writeStdout(output);
    } catch {
      return writeError(validatedDependencies, INTERNAL_ERROR);
    }
    return exitCode;
  } catch (error) {
    return writeError(validatedDependencies, approvedErrorMessage(error));
  }
}

function readSelectedEnvironment(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, unknown>> {
  const selected: Record<string, unknown> = {};
  for (const key of SELECTED_ENVIRONMENT_KEYS) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(environment, key);
    } catch {
      continue;
    }
    if (descriptor === undefined || !("value" in descriptor)) continue;
    Object.defineProperty(selected, key, {
      enumerable: true,
      value: descriptor.value,
    });
  }
  return selected;
}

function createExecutionDependencies(
  prepared: PreparedKecBatchIndex,
): KecBatchIndexExecutionDependencies {
  return Object.freeze({
    createProvider: async (provider) => {
      if (provider !== prepared.provider) {
        throw new Error(INVALID_CONFIGURATION);
      }
      const { createEmbeddingProviderFromEnv } =
        await import("./knowledge/embedding.js");
      return createEmbeddingProviderFromEnv();
    },
    createStore: async (databasePath) => {
      const { SqliteVectorStore } =
        await import("./knowledge/sqliteVectorStore.js");
      return new SqliteVectorStore(databasePath);
    },
    indexSource: async (projectRoot, input, dependencies) => {
      const { indexKec } = await import("./tools/indexKec.js");
      const result = await indexKec(projectRoot, input, {
        embeddingProvider: dependencies.embeddingProvider as EmbeddingProvider,
        vectorStore: dependencies.vectorStore as VectorStore,
      });
      return Object.freeze({ indexedChunks: result.indexedChunks });
    },
    closeStore: async (store) => {
      const { SqliteVectorStore } =
        await import("./knowledge/sqliteVectorStore.js");
      if (!(store instanceof SqliteVectorStore)) {
        throw new Error(INTERNAL_ERROR);
      }
      await store.close();
    },
    closeProvider: () => {},
  });
}

export async function main(): Promise<void> {
  process.exitCode = await runKecBatchIndexCli(
    process.argv.slice(2),
    readSelectedEnvironment(process.env),
    Object.freeze({
      cwd: process.cwd(),
      readConfig: readKecBatchIndexConfig,
      prepare: prepareKecBatchIndex,
      execute: executeKecBatchIndex,
      serialize: serializeKecBatchIndexResult,
      createExecutionDependencies,
      writeStdout: (text) => {
        process.stdout.write(text);
      },
      writeStderr: (text) => {
        process.stderr.write(text);
      },
    }),
  );
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
