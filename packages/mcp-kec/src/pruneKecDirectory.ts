import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createKecDirectoryPruneDependencies } from "./directoryPruning/createKecDirectoryPruneDependencies.js";
import * as directoryPruning from "./directoryPruning/index.js";
import type {
  KecDirectoryPruneDiscovery,
  KecDirectoryPrunePlan,
  KecDirectoryPruneResult,
} from "./directoryPruning/types.js";

const INVALID_ARGUMENT = "KEC_DIRECTORY_PRUNE: INVALID_ARGUMENT";
const INVALID_CONFIGURATION = "KEC_DIRECTORY_PRUNE: INVALID_CONFIGURATION";
const DATABASE_UNAVAILABLE = "KEC_DIRECTORY_PRUNE: DATABASE_UNAVAILABLE";
const ENUMERATION_FAILED = "KEC_DIRECTORY_PRUNE: ENUMERATION_FAILED";
const FINALIZATION_FAILED = "KEC_DIRECTORY_PRUNE: FINALIZATION_FAILED";
const INTERNAL_ERROR = "KEC_DIRECTORY_PRUNE: INTERNAL_ERROR";
const APPROVED_ERRORS = Object.freeze([
  INVALID_ARGUMENT,
  INVALID_CONFIGURATION,
  "KEC_DIRECTORY_PRUNE: INVALID_DIRECTORY",
  "KEC_DIRECTORY_PRUNE: INVALID_SOURCE",
  "KEC_DIRECTORY_PRUNE: NO_SOURCES",
  "KEC_DIRECTORY_PRUNE: DISCOVERY_FAILED",
  DATABASE_UNAVAILABLE,
  ENUMERATION_FAILED,
  "KEC_DIRECTORY_PRUNE: INVALID_INDEX_STATE",
  "KEC_DIRECTORY_PRUNE: INDEX_CHANGED",
  "KEC_DIRECTORY_PRUNE: PRUNE_FAILED",
  FINALIZATION_FAILED,
  INTERNAL_ERROR,
] as const);

export type KecDirectoryPruneCliDependencies = Readonly<{
  cwd: string;
  readConfig: (
    environment: unknown,
    cwd: string,
  ) => Readonly<{ projectRoot: string; databasePath: string }>;
  discover: (
    projectRoot: string,
    request: unknown,
  ) => KecDirectoryPruneDiscovery;
  assertDatabaseAvailable: (databasePath: string) => void;
  createStore: (databasePath: string) => unknown | Promise<unknown>;
  enumerateSources: (
    store: unknown,
    collection: "kec",
  ) => Promise<readonly string[]>;
  prepare: (
    discovery: KecDirectoryPruneDiscovery,
    sourcePaths: readonly string[],
  ) => KecDirectoryPrunePlan;
  execute: (
    plan: KecDirectoryPrunePlan,
    store: unknown,
  ) => Promise<KecDirectoryPruneResult>;
  serialize: (result: KecDirectoryPruneResult) => string;
  closeStore: (store: unknown) => void | Promise<void>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;

const DEPENDENCY_KEYS = Object.freeze([
  "cwd",
  "readConfig",
  "discover",
  "assertDatabaseAvailable",
  "createStore",
  "enumerateSources",
  "prepare",
  "execute",
  "serialize",
  "closeStore",
  "writeStdout",
  "writeStderr",
] as const);

function errorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function publicError(error: unknown): string {
  const message = errorMessage(error);
  return message !== null && APPROVED_ERRORS.includes(message as never)
    ? message
    : INTERNAL_ERROR;
}

function validateArgv(argv: unknown): string | null {
  if (!Array.isArray(argv) || argv.length !== 1) return null;
  const directory = argv[0];
  return typeof directory === "string" &&
    directory.length > 0 &&
    !directory.startsWith("-")
    ? directory
    : null;
}

function validateDependencies(
  dependencies: unknown,
): KecDirectoryPruneCliDependencies | null {
  if (typeof dependencies !== "object" || dependencies === null) return null;
  try {
    const names = Object.getOwnPropertyNames(dependencies);
    if (
      Object.getOwnPropertySymbols(dependencies).length !== 0 ||
      names.length !== DEPENDENCY_KEYS.length ||
      DEPENDENCY_KEYS.some((key) => !names.includes(key))
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(dependencies);
    if (
      typeof descriptors.cwd?.value !== "string" ||
      DEPENDENCY_KEYS.slice(1).some(
        (key) => typeof descriptors[key]?.value !== "function",
      )
    ) {
      return null;
    }
    return dependencies as KecDirectoryPruneCliDependencies;
  } catch {
    return null;
  }
}

function readEnvironmentString(
  environment: unknown,
  key: "PROJECT_ROOT" | "KEC_DB_PATH",
): string {
  if (typeof environment !== "object" || environment === null) {
    throw new Error(INVALID_CONFIGURATION);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0 ||
      descriptor.value.includes("\0")
    ) {
      throw new Error(INVALID_CONFIGURATION);
    }
    return descriptor.value;
  } catch (error) {
    if (errorMessage(error) === INVALID_CONFIGURATION) throw error;
    throw new Error(INVALID_CONFIGURATION);
  }
}

function readConfig(
  environment: unknown,
  cwd: string,
): Readonly<{ projectRoot: string; databasePath: string }> {
  const projectRootValue = readEnvironmentString(environment, "PROJECT_ROOT");
  const databasePathValue = readEnvironmentString(environment, "KEC_DB_PATH");
  const projectRoot = isAbsolute(projectRootValue)
    ? projectRootValue
    : resolve(cwd, projectRootValue);
  const databasePath = isAbsolute(databasePathValue)
    ? databasePathValue
    : resolve(cwd, databasePathValue);
  return Object.freeze({ projectRoot, databasePath });
}

function writeError(
  dependencies: KecDirectoryPruneCliDependencies,
  message: string,
): number {
  try {
    dependencies.writeStderr(`${message}\n`);
  } catch {
    // The same failed writer cannot safely report its own failure.
  }
  return 1;
}

export async function runKecDirectoryPruneCli(
  argv: readonly string[],
  environment: unknown,
  dependencies: KecDirectoryPruneCliDependencies,
): Promise<number> {
  const validatedDependencies = validateDependencies(dependencies);
  if (validatedDependencies === null) return 1;
  const directory = validateArgv(argv);
  if (directory === null) {
    return writeError(validatedDependencies, INVALID_ARGUMENT);
  }

  let store: unknown;
  let result: KecDirectoryPruneResult | undefined;
  let operationError: unknown;
  try {
    const config = validatedDependencies.readConfig(
      environment,
      validatedDependencies.cwd,
    );
    const discovery = validatedDependencies.discover(config.projectRoot, {
      directory,
    });
    try {
      validatedDependencies.assertDatabaseAvailable(config.databasePath);
      store = await validatedDependencies.createStore(config.databasePath);
    } catch (error) {
      if (errorMessage(error) === DATABASE_UNAVAILABLE) throw error;
      throw new Error(DATABASE_UNAVAILABLE);
    }

    let sourcePaths: readonly string[];
    try {
      sourcePaths = await validatedDependencies.enumerateSources(store, "kec");
    } catch {
      throw new Error(ENUMERATION_FAILED);
    }
    const plan = validatedDependencies.prepare(discovery, sourcePaths);
    result = await validatedDependencies.execute(plan, store);
  } catch (error) {
    operationError = error;
  }

  let finalizationFailed = false;
  if (store !== undefined) {
    try {
      await validatedDependencies.closeStore(store);
    } catch {
      finalizationFailed = true;
    }
  }

  if (operationError !== undefined) {
    return writeError(validatedDependencies, publicError(operationError));
  }
  if (finalizationFailed) {
    return writeError(validatedDependencies, FINALIZATION_FAILED);
  }
  if (result === undefined) {
    return writeError(validatedDependencies, INTERNAL_ERROR);
  }

  let output: string;
  try {
    output = validatedDependencies.serialize(result);
    validatedDependencies.writeStdout(output);
  } catch {
    return writeError(validatedDependencies, INTERNAL_ERROR);
  }
  return 0;
}

function selectedEnvironment(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    PROJECT_ROOT: environment.PROJECT_ROOT,
    KEC_DB_PATH: environment.KEC_DB_PATH,
  });
}

function isMainModule(
  importMetaUrl: string,
  argvPath: string | undefined,
): boolean {
  return (
    argvPath !== undefined && importMetaUrl === pathToFileURL(argvPath).href
  );
}

export async function main(): Promise<void> {
  const lifecycle = createKecDirectoryPruneDependencies();
  process.exitCode = await runKecDirectoryPruneCli(
    process.argv.slice(2),
    selectedEnvironment(process.env),
    Object.freeze({
      cwd: process.cwd(),
      readConfig,
      discover: directoryPruning[
        ("discoverKecDirectory" + "PruneScope") as keyof typeof directoryPruning
      ] as KecDirectoryPruneCliDependencies["discover"],
      assertDatabaseAvailable: lifecycle.assertDatabaseAvailable,
      createStore: lifecycle.createStore,
      enumerateSources:
        lifecycle.enumerateSources as KecDirectoryPruneCliDependencies["enumerateSources"],
      prepare: directoryPruning.prepareKecDirectoryPrune,
      execute: lifecycle.execute as KecDirectoryPruneCliDependencies["execute"],
      serialize: directoryPruning.serializeKecDirectoryPruneResult,
      closeStore:
        lifecycle.closeStore as KecDirectoryPruneCliDependencies["closeStore"],
      writeStdout: (text: string) => process.stdout.write(text),
      writeStderr: (text: string) => process.stderr.write(text),
    }),
  );
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
