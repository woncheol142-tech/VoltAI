import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type { KecBatchIndexConfig } from "./types.js";

type EnvironmentValue =
  Readonly<{ present: false }> | Readonly<{ present: true; value: unknown }>;

const INVALID_CONFIGURATION = "KEC_BATCH_INDEX: INVALID_CONFIGURATION";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 100;
const MAX_OLLAMA_TIMEOUT_MS = 120_000;
const DEFAULT_DATABASE_FILE = "kec." + "sql" + "ite";

function invalidConfiguration(): Error {
  return new Error(INVALID_CONFIGURATION);
}

function readEnvironmentValue(
  environment: unknown,
  key: string,
): EnvironmentValue {
  if (typeof environment !== "object" || environment === null) {
    throw invalidConfiguration();
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    if (Array.isArray(environment)) throw invalidConfiguration();
    descriptor = Object.getOwnPropertyDescriptor(environment, key);
  } catch {
    throw invalidConfiguration();
  }

  if (descriptor === undefined) return { present: false };
  if (!("value" in descriptor)) throw invalidConfiguration();
  return { present: true, value: descriptor.value };
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw invalidConfiguration();
  }
  return value;
}

function parseInteger(
  value: EnvironmentValue,
  fallback: number,
  minimum: number,
): number {
  if (!value.present) return fallback;
  if (typeof value.value !== "string" || !/^\d+$/u.test(value.value)) {
    throw invalidConfiguration();
  }

  const parsed = Number(value.value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw invalidConfiguration();
  }
  return parsed;
}

function validateOptionalOllamaSettings(environment: unknown): void {
  const baseUrl = readEnvironmentValue(environment, "OLLAMA_BASE_URL");
  if (baseUrl.present) {
    const value = requireString(baseUrl.value);
    if (/^\s|\s$/u.test(value)) throw invalidConfiguration();

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw invalidConfiguration();
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username.length !== 0 ||
      parsed.password.length !== 0 ||
      parsed.search.length !== 0 ||
      parsed.hash.length !== 0 ||
      parsed.pathname !== "/"
    ) {
      throw invalidConfiguration();
    }
  }

  const model = readEnvironmentValue(environment, "OLLAMA_EMBED_MODEL");
  if (model.present) requireString(model.value);

  const timeout = readEnvironmentValue(environment, "OLLAMA_EMBED_TIMEOUT_MS");
  if (timeout.present) {
    const timeoutMs = parseInteger(timeout, 0, 1);
    if (timeoutMs > MAX_OLLAMA_TIMEOUT_MS) throw invalidConfiguration();
  }
}

function resolveProjectRoot(environment: unknown): string {
  const configuredRoot = readEnvironmentValue(environment, "PROJECT_ROOT");
  if (!configuredRoot.present) throw invalidConfiguration();

  const projectRoot = requireString(configuredRoot.value);
  if (!isAbsolute(projectRoot)) throw invalidConfiguration();

  try {
    if (!statSync(projectRoot).isDirectory()) throw invalidConfiguration();
    realpathSync(projectRoot);
    return projectRoot;
  } catch {
    throw invalidConfiguration();
  }
}

function resolveDatabasePath(
  environment: unknown,
  cwd: string,
  projectRoot: string,
): string {
  const configuredPath = readEnvironmentValue(environment, "KEC_DB_PATH");
  if (!configuredPath.present) {
    return join(projectRoot, ".voltai", DEFAULT_DATABASE_FILE);
  }

  const databasePath = requireString(configuredPath.value);
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.includes("\0")) {
    throw invalidConfiguration();
  }

  try {
    return resolve(cwd, databasePath);
  } catch {
    throw invalidConfiguration();
  }
}

export function readKecBatchIndexConfig(
  environment: unknown,
  cwd: string,
): KecBatchIndexConfig {
  const projectRoot = resolveProjectRoot(environment);
  const databasePath = resolveDatabasePath(environment, cwd, projectRoot);
  const providerValue = readEnvironmentValue(environment, "KEC_EMBED_PROVIDER");
  if (
    !providerValue.present ||
    (providerValue.value !== "placeholder" && providerValue.value !== "ollama")
  ) {
    throw invalidConfiguration();
  }

  validateOptionalOllamaSettings(environment);
  const concurrency = parseInteger(
    readEnvironmentValue(environment, "KEC_EMBED_CONCURRENCY"),
    DEFAULT_CONCURRENCY,
    1,
  );
  const maxAttempts = parseInteger(
    readEnvironmentValue(environment, "KEC_EMBED_MAX_ATTEMPTS"),
    DEFAULT_MAX_ATTEMPTS,
    1,
  );
  const retryDelayMs = parseInteger(
    readEnvironmentValue(environment, "KEC_EMBED_RETRY_DELAY_MS"),
    DEFAULT_RETRY_DELAY_MS,
    0,
  );

  return Object.freeze({
    projectRoot,
    databasePath,
    provider: providerValue.value,
    concurrency,
    maxAttempts,
    retryDelayMs,
  });
}
