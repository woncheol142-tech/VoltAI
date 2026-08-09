import { pathToFileURL } from "node:url";

import { createKecBatchExecutionDependencies } from "./batchIndexing/createKecBatchExecutionDependencies.js";
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
import {
  discoverKecBatchDirectory,
  type KecBatchDirectoryDiscovery,
} from "./directoryBatchIndexing/index.js";

export type KecBatchDirectoryCliDependencies = Readonly<{
  cwd: string;
  readConfig: (environment: unknown, cwd: string) => KecBatchIndexConfig;
  discover: (
    projectRoot: string,
    request: unknown,
  ) => KecBatchDirectoryDiscovery;
  prepareBatch: (
    config: KecBatchIndexConfig,
    request: unknown,
  ) => PreparedKecBatchIndex;
  executeBatch: (
    prepared: PreparedKecBatchIndex,
    dependencies: KecBatchIndexExecutionDependencies,
  ) => Promise<KecBatchIndexResultV1>;
  serializeBatch: (result: KecBatchIndexResultV1) => string;
  createExecutionDependencies: (
    prepared: PreparedKecBatchIndex,
  ) => KecBatchIndexExecutionDependencies;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;

type ValidatedDependencies = KecBatchDirectoryCliDependencies;

const INVALID_ARGUMENT = "KEC_BATCH_DIRECTORY: INVALID_ARGUMENT";
const INVALID_CONFIGURATION = "KEC_BATCH_DIRECTORY: INVALID_CONFIGURATION";
const INVALID_DIRECTORY = "KEC_BATCH_DIRECTORY: INVALID_DIRECTORY";
const INVALID_SOURCE = "KEC_BATCH_DIRECTORY: INVALID_SOURCE";
const NO_SOURCES = "KEC_BATCH_DIRECTORY: NO_SOURCES";
const DISCOVERY_FAILED = "KEC_BATCH_DIRECTORY: DISCOVERY_FAILED";
const INTERNAL_ERROR = "KEC_BATCH_DIRECTORY: INTERNAL_ERROR";
const APPROVED_MESSAGES: readonly string[] = Object.freeze([
  INVALID_ARGUMENT,
  INVALID_CONFIGURATION,
  INVALID_DIRECTORY,
  INVALID_SOURCE,
  NO_SOURCES,
  DISCOVERY_FAILED,
  INTERNAL_ERROR,
]);
const TASK58_INVALID_CONFIGURATION = "KEC_BATCH_INDEX: INVALID_CONFIGURATION";
const TASK58_SOURCE_MESSAGES: readonly string[] = Object.freeze([
  "KEC_BATCH_INDEX: INVALID_ARGUMENT",
  "KEC_BATCH_INDEX: DUPLICATE_SOURCE",
  "KEC_BATCH_INDEX: SOURCE_NOT_FOUND",
  "KEC_BATCH_INDEX: SOURCE_NOT_REGULAR_FILE",
  "KEC_BATCH_INDEX: UNSUPPORTED_SOURCE",
  "KEC_BATCH_INDEX: UNSAFE_SOURCE",
]);
const DEPENDENCY_KEYS = Object.freeze([
  "cwd",
  "readConfig",
  "discover",
  "prepareBatch",
  "executeBatch",
  "serializeBatch",
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

function isMainModule(
  importMetaUrl: string,
  argvPath: string | undefined,
): boolean {
  return (
    argvPath !== undefined && importMetaUrl === pathToFileURL(argvPath).href
  );
}

function validateArgv(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    if (Object.getOwnPropertySymbols(value).length !== 0) return null;
    const names = Object.getOwnPropertyNames(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== 1 ||
      names.length !== 2 ||
      !names.includes("0") ||
      !names.includes("length")
    ) {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "0");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0 ||
      descriptor.value.startsWith("-")
    ) {
      return null;
    }
    return descriptor.value;
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

function validateDependencies(value: unknown): ValidatedDependencies | null {
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
    for (const key of DEPENDENCY_KEYS.slice(1)) {
      if (typeof descriptors[key]?.value !== "function") return null;
    }
    return Object.freeze({
      cwd: descriptors.cwd.value,
      readConfig: descriptors.readConfig.value,
      discover: descriptors.discover.value,
      prepareBatch: descriptors.prepareBatch.value,
      executeBatch: descriptors.executeBatch.value,
      serializeBatch: descriptors.serializeBatch.value,
      createExecutionDependencies:
        descriptors.createExecutionDependencies.value,
      writeStdout: descriptors.writeStdout.value,
      writeStderr: descriptors.writeStderr.value,
    }) as ValidatedDependencies;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      return null;
    }
    return descriptor.value;
  } catch {
    return null;
  }
}

function publicErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message === null) return INTERNAL_ERROR;
  if (APPROVED_MESSAGES.includes(message)) return message;
  if (message === TASK58_INVALID_CONFIGURATION) return INVALID_CONFIGURATION;
  if (TASK58_SOURCE_MESSAGES.includes(message)) return INVALID_SOURCE;
  return INTERNAL_ERROR;
}

function writeError(
  dependencies: ValidatedDependencies,
  message: string,
): number {
  try {
    dependencies.writeStderr(`${message}\n`);
  } catch {
    // The CLI cannot safely report a writer failure through the same writer.
  }
  return 1;
}

function readProjectRoot(config: unknown): string {
  if (typeof config !== "object" || config === null) {
    throw new Error(INVALID_CONFIGURATION);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(config, "projectRoot");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      throw new Error(INVALID_CONFIGURATION);
    }
    return descriptor.value;
  } catch (error) {
    if (errorMessage(error) === INVALID_CONFIGURATION) throw error;
    throw new Error(INVALID_CONFIGURATION);
  }
}

function readDiscoveredSources(discovery: unknown): readonly string[] {
  if (
    typeof discovery !== "object" ||
    discovery === null ||
    Array.isArray(discovery) ||
    !isPlainOrNullPrototype(discovery)
  ) {
    throw new Error(INTERNAL_ERROR);
  }
  try {
    if (
      Object.getOwnPropertySymbols(discovery).length !== 0 ||
      Object.getOwnPropertyNames(discovery).length !== 1
    ) {
      throw new Error(INTERNAL_ERROR);
    }
    const descriptor = Object.getOwnPropertyDescriptor(discovery, "sources");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !Array.isArray(descriptor.value)
    ) {
      throw new Error(INTERNAL_ERROR);
    }
    const sources = descriptor.value as unknown[];
    if (
      Object.getPrototypeOf(sources) !== Array.prototype ||
      Object.getOwnPropertySymbols(sources).length !== 0
    ) {
      throw new Error(INTERNAL_ERROR);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(sources, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 1 ||
      Object.getOwnPropertyNames(sources).length !== lengthDescriptor.value + 1
    ) {
      throw new Error(INTERNAL_ERROR);
    }
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const sourceDescriptor = Object.getOwnPropertyDescriptor(
        sources,
        String(index),
      );
      if (
        sourceDescriptor === undefined ||
        !("value" in sourceDescriptor) ||
        typeof sourceDescriptor.value !== "string"
      ) {
        throw new Error(INTERNAL_ERROR);
      }
    }
    return descriptor.value;
  } catch (error) {
    if (errorMessage(error) === INTERNAL_ERROR) throw error;
    throw new Error(INTERNAL_ERROR);
  }
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

export async function runKecBatchDirectoryCli(
  argv: readonly string[],
  environment: unknown,
  dependencies: KecBatchDirectoryCliDependencies,
): Promise<number> {
  const directory = validateArgv(argv);
  const validatedDependencies = validateDependencies(dependencies);
  if (validatedDependencies === null) return 1;
  if (directory === null) {
    return writeError(validatedDependencies, INVALID_ARGUMENT);
  }
  if (!validateEnvironment(environment)) {
    return writeError(validatedDependencies, INVALID_CONFIGURATION);
  }

  try {
    const config = validatedDependencies.readConfig(
      environment,
      validatedDependencies.cwd,
    );
    const discovery = validatedDependencies.discover(readProjectRoot(config), {
      directory,
    });
    const sources = readDiscoveredSources(discovery);
    const prepared = validatedDependencies.prepareBatch(config, { sources });
    const executionDependencies =
      validatedDependencies.createExecutionDependencies(prepared);
    const result = await validatedDependencies.executeBatch(
      prepared,
      executionDependencies,
    );
    const exitCode = resultExitCode(result);
    if (exitCode === null) {
      return writeError(validatedDependencies, INTERNAL_ERROR);
    }
    const output = validatedDependencies.serializeBatch(result);
    try {
      validatedDependencies.writeStdout(output);
    } catch {
      return writeError(validatedDependencies, INTERNAL_ERROR);
    }
    return exitCode;
  } catch (error) {
    return writeError(validatedDependencies, publicErrorMessage(error));
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

export async function main(): Promise<void> {
  process.exitCode = await runKecBatchDirectoryCli(
    process.argv.slice(2),
    readSelectedEnvironment(process.env),
    Object.freeze({
      cwd: process.cwd(),
      readConfig: readKecBatchIndexConfig,
      discover: discoverKecBatchDirectory,
      prepareBatch: prepareKecBatchIndex,
      executeBatch: executeKecBatchIndex,
      serializeBatch: serializeKecBatchIndexResult,
      createExecutionDependencies: createKecBatchExecutionDependencies,
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
