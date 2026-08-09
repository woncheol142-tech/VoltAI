import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import type {
  KecBatchIndexConfig,
  PreparedKecBatchIndex,
  PreparedKecBatchSource,
} from "./types.js";

const INVALID_CONFIGURATION = "KEC_BATCH_INDEX: INVALID_CONFIGURATION";
const INVALID_ARGUMENT = "KEC_BATCH_INDEX: INVALID_ARGUMENT";
const DUPLICATE_SOURCE = "KEC_BATCH_INDEX: DUPLICATE_SOURCE";
const SOURCE_NOT_FOUND = "KEC_BATCH_INDEX: SOURCE_NOT_FOUND";
const SOURCE_NOT_REGULAR_FILE = "KEC_BATCH_INDEX: SOURCE_NOT_REGULAR_FILE";
const UNSUPPORTED_SOURCE = "KEC_BATCH_INDEX: UNSUPPORTED_SOURCE";
const UNSAFE_SOURCE = "KEC_BATCH_INDEX: UNSAFE_SOURCE";

const CONFIG_KEYS = Object.freeze([
  "projectRoot",
  "databasePath",
  "provider",
  "concurrency",
  "maxAttempts",
  "retryDelayMs",
] as const);

type ValidatedConfig = Readonly<{
  projectRoot: string;
  databasePath: string;
  provider: "placeholder" | "ollama";
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
}>;

type SourceCandidate = Readonly<{
  sourcePath: string;
  realPath: string;
}>;

function failure(message: string): Error {
  return new Error(message);
}

function inspectObject(
  value: unknown,
  expectedKeys: readonly string[],
  errorMessage: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    throw failure(errorMessage);
  }

  let prototype: object | null;
  let names: string[];
  let symbols: symbol[];
  try {
    if (Array.isArray(value)) throw failure(errorMessage);
    prototype = Object.getPrototypeOf(value);
    names = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    throw failure(errorMessage);
  }

  if (
    (prototype !== Object.prototype && prototype !== null) ||
    symbols.length !== 0 ||
    names.length !== expectedKeys.length ||
    !expectedKeys.every((key) => names.includes(key))
  ) {
    throw failure(errorMessage);
  }

  const properties: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of expectedKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw failure(errorMessage);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw failure(errorMessage);
    }
    properties[key] = descriptor.value;
  }
  return properties;
}

function validateConfig(config: KecBatchIndexConfig): ValidatedConfig {
  const values = inspectObject(config, CONFIG_KEYS, INVALID_CONFIGURATION);
  const projectRoot = values.projectRoot;
  const databasePath = values.databasePath;
  const provider = values.provider;
  const concurrency = values.concurrency;
  const maxAttempts = values.maxAttempts;
  const retryDelayMs = values.retryDelayMs;

  if (
    typeof projectRoot !== "string" ||
    projectRoot.length === 0 ||
    projectRoot.includes("\0") ||
    !isAbsolute(projectRoot) ||
    typeof databasePath !== "string" ||
    databasePath.length === 0 ||
    databasePath.includes("\0") ||
    (provider !== "placeholder" && provider !== "ollama") ||
    typeof concurrency !== "number" ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    typeof maxAttempts !== "number" ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    typeof retryDelayMs !== "number" ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 0
  ) {
    throw failure(INVALID_CONFIGURATION);
  }

  let realProjectRoot: string;
  try {
    if (!statSync(projectRoot).isDirectory()) {
      throw failure(INVALID_CONFIGURATION);
    }
    realProjectRoot = realpathSync(projectRoot);
  } catch {
    throw failure(INVALID_CONFIGURATION);
  }

  return {
    projectRoot: realProjectRoot,
    databasePath,
    provider,
    concurrency,
    maxAttempts,
    retryDelayMs,
  };
}

function readSourceValues(request: unknown): readonly unknown[] {
  const requestValues = inspectObject(request, ["sources"], INVALID_ARGUMENT);
  const sources = requestValues.sources;

  let prototype: object | null;
  let names: string[];
  let symbols: symbol[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    if (!Array.isArray(sources)) throw failure(INVALID_ARGUMENT);
    prototype = Object.getPrototypeOf(sources);
    names = Object.getOwnPropertyNames(sources);
    symbols = Object.getOwnPropertySymbols(sources);
    lengthDescriptor = Object.getOwnPropertyDescriptor(sources, "length");
  } catch {
    throw failure(INVALID_ARGUMENT);
  }

  if (
    prototype !== Array.prototype ||
    symbols.length !== 0 ||
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    names.length !== lengthDescriptor.value + 1
  ) {
    throw failure(INVALID_ARGUMENT);
  }

  const values: unknown[] = [];
  const nameSet = new Set(names);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    if (!nameSet.has(key)) throw failure(INVALID_ARGUMENT);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(sources, key);
    } catch {
      throw failure(INVALID_ARGUMENT);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw failure(INVALID_ARGUMENT);
    }
    values.push(descriptor.value);
  }

  return values;
}

function isUnsafeSourceSpelling(sourcePath: string): boolean {
  if (isAbsolute(sourcePath) || sourcePath.includes("\\")) return true;

  const parts = sourcePath.split("/");
  return parts.some(
    (part) => part.length === 0 || part === "." || part === "..",
  );
}

function readSourceStrings(values: readonly unknown[]): readonly string[] {
  const sourcePaths: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw failure(INVALID_ARGUMENT);
    }
    if (value.includes("\0")) throw failure(UNSAFE_SOURCE);
    sourcePaths.push(value);
  }
  return sourcePaths;
}

function rejectLexicalDuplicates(
  projectRoot: string,
  sourcePaths: readonly string[],
): readonly string[] {
  const seenInputs = new Set<string>();
  const seenAbsolutePaths = new Set<string>();
  const absolutePaths: string[] = [];

  for (const sourcePath of sourcePaths) {
    if (seenInputs.has(sourcePath)) throw failure(DUPLICATE_SOURCE);
    seenInputs.add(sourcePath);

    let absolutePath: string;
    try {
      absolutePath = resolve(projectRoot, sourcePath);
    } catch {
      throw failure(UNSAFE_SOURCE);
    }
    if (seenAbsolutePaths.has(absolutePath)) throw failure(DUPLICATE_SOURCE);
    seenAbsolutePaths.add(absolutePath);
    absolutePaths.push(absolutePath);
  }

  return absolutePaths;
}

function isWithinRoot(projectRoot: string, targetPath: string): boolean {
  const relativePath = relative(projectRoot, targetPath);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function resolveSourceCandidates(
  projectRoot: string,
  sourcePaths: readonly string[],
  absolutePaths: readonly string[],
): readonly SourceCandidate[] {
  for (const sourcePath of sourcePaths) {
    if (isUnsafeSourceSpelling(sourcePath)) throw failure(UNSAFE_SOURCE);
    if (extname(sourcePath) !== ".pdf") throw failure(UNSUPPORTED_SOURCE);
  }

  const candidates: SourceCandidate[] = [];
  for (let index = 0; index < sourcePaths.length; index += 1) {
    let realPath: string;
    try {
      realPath = realpathSync(absolutePaths[index]);
    } catch {
      throw failure(SOURCE_NOT_FOUND);
    }

    let isRegularFile: boolean;
    try {
      isRegularFile = statSync(realPath).isFile();
    } catch {
      throw failure(SOURCE_NOT_FOUND);
    }
    if (!isRegularFile) throw failure(SOURCE_NOT_REGULAR_FILE);

    candidates.push({
      sourcePath: sourcePaths[index],
      realPath,
    });
  }
  return candidates;
}

function createPreparedSources(
  projectRoot: string,
  candidates: readonly SourceCandidate[],
): readonly PreparedKecBatchSource[] {
  const seenRealPaths = new Set<string>();
  for (const candidate of candidates) {
    if (seenRealPaths.has(candidate.realPath)) throw failure(DUPLICATE_SOURCE);
    seenRealPaths.add(candidate.realPath);
  }

  const prepared: PreparedKecBatchSource[] = [];
  const seenSourcePaths = new Set<string>();
  const seenSourceIds = new Set<string>();
  for (const candidate of candidates) {
    if (!isWithinRoot(projectRoot, candidate.realPath)) {
      throw failure(UNSAFE_SOURCE);
    }

    const canonicalPath = relative(projectRoot, candidate.realPath)
      .split(sep)
      .join("/");
    if (candidate.sourcePath !== canonicalPath) throw failure(UNSAFE_SOURCE);
    if (seenSourcePaths.has(canonicalPath)) throw failure(DUPLICATE_SOURCE);
    seenSourcePaths.add(canonicalPath);

    const sourceId = `kecsrc_${createHash("sha256")
      .update(canonicalPath, "utf8")
      .digest("hex")}`;
    if (seenSourceIds.has(sourceId)) throw failure(DUPLICATE_SOURCE);
    seenSourceIds.add(sourceId);
    prepared.push(Object.freeze({ sourcePath: canonicalPath, sourceId }));
  }

  prepared.sort((left, right) =>
    left.sourceId < right.sourceId
      ? -1
      : left.sourceId > right.sourceId
        ? 1
        : 0,
  );
  return Object.freeze(prepared);
}

export function prepareKecBatchIndex(
  config: KecBatchIndexConfig,
  request: unknown,
): PreparedKecBatchIndex {
  const validatedConfig = validateConfig(config);
  const sourcePaths = readSourceStrings(readSourceValues(request));
  const absolutePaths = rejectLexicalDuplicates(
    validatedConfig.projectRoot,
    sourcePaths,
  );
  const candidates = resolveSourceCandidates(
    validatedConfig.projectRoot,
    sourcePaths,
    absolutePaths,
  );
  const sources = createPreparedSources(
    validatedConfig.projectRoot,
    candidates,
  );

  return Object.freeze({
    projectRoot: validatedConfig.projectRoot,
    databasePath: validatedConfig.databasePath,
    provider: validatedConfig.provider,
    sources,
    concurrency: validatedConfig.concurrency,
    maxAttempts: validatedConfig.maxAttempts,
    retryDelayMs: validatedConfig.retryDelayMs,
  });
}
