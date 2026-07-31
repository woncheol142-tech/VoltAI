import { isAbsolute, join, resolve } from "node:path";

import { isMainModule } from "@voltai/mcp-core";

import {
  inspectKecIndex,
  serializeKecIndexDiagnostics,
  type KecIndexDiagnosticsV1,
} from "./indexDiagnostics/index.js";
import { assertProjectRoot } from "./knowledge/projectPath.js";

export type InspectIndexCliDependencies = Readonly<{
  environment: Readonly<Record<string, unknown>>;
  cwd: string;
  argv: readonly string[];
  inspect: (databasePath: string) => Promise<KecIndexDiagnosticsV1>;
  serialize: (diagnostics: KecIndexDiagnosticsV1) => string;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;

type EnvironmentValue =
  Readonly<{ present: false }> | Readonly<{ present: true; value: unknown }>;

const ERROR_PREFIX = "KEC_INDEX_DIAGNOSTICS: ";
const INVALID_CONFIGURATION = `${ERROR_PREFIX}INVALID_CONFIGURATION`;
const DATABASE_UNAVAILABLE = `${ERROR_PREFIX}DATABASE_UNAVAILABLE`;

function readEnvironmentValue(
  environment: Readonly<Record<string, unknown>>,
  key: "KEC_DB_PATH" | "PROJECT_ROOT",
): EnvironmentValue {
  if (typeof environment !== "object" || environment === null) {
    throw new Error(INVALID_CONFIGURATION);
  }

  const descriptor = Object.getOwnPropertyDescriptor(environment, key);
  if (descriptor === undefined) {
    return { present: false };
  }
  if (!("value" in descriptor)) {
    throw new Error(INVALID_CONFIGURATION);
  }
  if (descriptor.value === undefined) {
    return { present: false };
  }

  return { present: true, value: environment[key] };
}

function requireNonemptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(INVALID_CONFIGURATION);
  }
  return value;
}

function resolveDatabasePath(
  environment: Readonly<Record<string, unknown>>,
  cwd: string,
): string {
  const configuredPath = readEnvironmentValue(environment, "KEC_DB_PATH");
  if (configuredPath.present) {
    const databasePath = requireNonemptyString(configuredPath.value);
    return isAbsolute(databasePath) ? databasePath : resolve(cwd, databasePath);
  }

  const configuredRoot = readEnvironmentValue(environment, "PROJECT_ROOT");
  if (!configuredRoot.present) {
    throw new Error(INVALID_CONFIGURATION);
  }

  const projectRoot = requireNonemptyString(configuredRoot.value);
  try {
    const resolvedProjectRoot = isAbsolute(projectRoot)
      ? projectRoot
      : resolve(cwd, projectRoot);
    assertProjectRoot(resolvedProjectRoot);
    return join(resolvedProjectRoot, ".voltai", "kec.sqlite");
  } catch {
    throw new Error(INVALID_CONFIGURATION);
  }
}

function approvedErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return DATABASE_UNAVAILABLE;
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string"
  ) {
    return DATABASE_UNAVAILABLE;
  }

  switch (descriptor.value) {
    case INVALID_CONFIGURATION:
    case `${ERROR_PREFIX}UNSAFE_DATABASE_PATH`:
    case DATABASE_UNAVAILABLE:
    case `${ERROR_PREFIX}DATABASE_INVALID`:
      return descriptor.value;
    default:
      return DATABASE_UNAVAILABLE;
  }
}

export async function runInspectIndexCli(
  dependencies: InspectIndexCliDependencies,
): Promise<number> {
  if (dependencies.argv.length !== 0) {
    dependencies.writeStderr(`${INVALID_CONFIGURATION}\n`);
    return 1;
  }

  try {
    const databasePath = resolveDatabasePath(
      dependencies.environment,
      dependencies.cwd,
    );
    const diagnostics = await dependencies.inspect(databasePath);
    const output = dependencies.serialize(diagnostics);
    dependencies.writeStdout(output);
    return 0;
  } catch (error) {
    dependencies.writeStderr(`${approvedErrorMessage(error)}\n`);
    return 1;
  }
}

export async function main(): Promise<void> {
  process.exitCode = await runInspectIndexCli({
    environment: {
      KEC_DB_PATH: process.env.KEC_DB_PATH,
      PROJECT_ROOT: process.env.PROJECT_ROOT,
    },
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    inspect: inspectKecIndex,
    serialize: serializeKecIndexDiagnostics,
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
