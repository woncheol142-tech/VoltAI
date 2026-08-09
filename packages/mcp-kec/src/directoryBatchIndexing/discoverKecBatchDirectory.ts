import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  KecBatchDirectoryDiscovery,
  KecBatchDirectoryDiscoveryDependencies,
} from "./types.js";

const INVALID_ARGUMENT = "KEC_BATCH_DIRECTORY: INVALID_ARGUMENT";
const INVALID_CONFIGURATION = "KEC_BATCH_DIRECTORY: INVALID_CONFIGURATION";
const INVALID_DIRECTORY = "KEC_BATCH_DIRECTORY: INVALID_DIRECTORY";
const INVALID_SOURCE = "KEC_BATCH_DIRECTORY: INVALID_SOURCE";
const NO_SOURCES = "KEC_BATCH_DIRECTORY: NO_SOURCES";
const DISCOVERY_FAILED = "KEC_BATCH_DIRECTORY: DISCOVERY_FAILED";

const DEFAULT_DEPENDENCIES: KecBatchDirectoryDiscoveryDependencies =
  Object.freeze({
    lstat: (path) => {
      const stats = lstatSync(path, { bigint: true });
      const kind = stats.isSymbolicLink()
        ? "symlink"
        : stats.isDirectory()
          ? "directory"
          : stats.isFile()
            ? "file"
            : "other";
      return Object.freeze({
        kind,
        identity: Object.freeze({
          device: stats.dev,
          inode: stats.ino,
        }),
      });
    },
    realpath: (path) => realpathSync(path),
    readDirectory: (path) => readdirSync(path),
  });

const DEPENDENCY_KEYS = Object.freeze([
  "lstat",
  "realpath",
  "readDirectory",
] as const);
const PATH_KINDS = Object.freeze([
  "directory",
  "file",
  "symlink",
  "other",
] as const);

type PathKind = (typeof PATH_KINDS)[number];
type PathIdentity = Readonly<{ device: bigint; inode: bigint }>;
type PathState = Readonly<{
  kind: PathKind;
  identity?: PathIdentity;
}>;

function failure(message: string): Error {
  return new Error(message);
}

function isPlainOrNullPrototype(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readDirectoryRequest(request: unknown): string {
  if (
    typeof request !== "object" ||
    request === null ||
    Array.isArray(request) ||
    !isPlainOrNullPrototype(request)
  ) {
    throw failure(INVALID_ARGUMENT);
  }

  try {
    if (Object.getOwnPropertySymbols(request).length !== 0) {
      throw failure(INVALID_ARGUMENT);
    }
    const names = Object.getOwnPropertyNames(request);
    if (names.length !== 1 || names[0] !== "directory") {
      throw failure(INVALID_ARGUMENT);
    }
    const descriptor = Object.getOwnPropertyDescriptor(request, "directory");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0
    ) {
      throw failure(INVALID_ARGUMENT);
    }
    if (descriptor.value.startsWith("-")) throw failure(INVALID_ARGUMENT);
    return descriptor.value;
  } catch (error) {
    if (approvedMessage(error) === INVALID_ARGUMENT) throw error;
    throw failure(INVALID_ARGUMENT);
  }
}

function validateDependencies(
  value: unknown,
): KecBatchDirectoryDiscoveryDependencies {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !isPlainOrNullPrototype(value)
  ) {
    throw failure(DISCOVERY_FAILED);
  }

  try {
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw failure(DISCOVERY_FAILED);
    }
    const names = Object.getOwnPropertyNames(value);
    if (
      names.length !== DEPENDENCY_KEYS.length ||
      DEPENDENCY_KEYS.some((key) => !names.includes(key))
    ) {
      throw failure(DISCOVERY_FAILED);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of DEPENDENCY_KEYS) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "function"
      ) {
        throw failure(DISCOVERY_FAILED);
      }
    }
    return Object.freeze({
      lstat: descriptors.lstat.value,
      realpath: descriptors.realpath.value,
      readDirectory: descriptors.readDirectory.value,
    }) as KecBatchDirectoryDiscoveryDependencies;
  } catch (error) {
    if (approvedMessage(error) === DISCOVERY_FAILED) throw error;
    throw failure(DISCOVERY_FAILED);
  }
}

function approvedMessage(error: unknown): string | null {
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

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function isWithinRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function validateDirectorySpelling(directory: string): void {
  if (
    directory.includes("\0") ||
    directory.includes("\\") ||
    isAbsolute(directory)
  ) {
    throw failure(INVALID_DIRECTORY);
  }
  if (directory === ".") return;
  const parts = directory.split("/");
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw failure(INVALID_DIRECTORY);
  }
}

function readPathState(
  path: string,
  dependencies: KecBatchDirectoryDiscoveryDependencies,
  invalidStateMessage: string,
  missingDirectoryIsInvalid: boolean,
): PathState {
  let value: unknown;
  try {
    value = dependencies.lstat(path);
  } catch (error) {
    if (
      missingDirectoryIsInvalid &&
      (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR")
    ) {
      throw failure(INVALID_DIRECTORY);
    }
    throw failure(DISCOVERY_FAILED);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !isPlainOrNullPrototype(value)
  ) {
    throw failure(invalidStateMessage);
  }
  try {
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw failure(invalidStateMessage);
    }
    const names = Object.getOwnPropertyNames(value);
    if (
      (names.length !== 1 && names.length !== 2) ||
      !names.includes("kind") ||
      (names.length === 2 && !names.includes("identity"))
    ) {
      throw failure(invalidStateMessage);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptor = descriptors.kind;
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !PATH_KINDS.includes(descriptor.value)
    ) {
      throw failure(invalidStateMessage);
    }

    const identityDescriptor = descriptors.identity;
    if (identityDescriptor === undefined) {
      return Object.freeze({ kind: descriptor.value as PathKind });
    }
    if (!("value" in identityDescriptor)) {
      throw failure(invalidStateMessage);
    }
    const identityValue: unknown = identityDescriptor.value;
    if (
      typeof identityValue !== "object" ||
      identityValue === null ||
      Array.isArray(identityValue) ||
      !isPlainOrNullPrototype(identityValue) ||
      Object.getOwnPropertySymbols(identityValue).length !== 0
    ) {
      throw failure(invalidStateMessage);
    }
    const identityNames = Object.getOwnPropertyNames(identityValue);
    if (
      identityNames.length !== 2 ||
      !identityNames.includes("device") ||
      !identityNames.includes("inode")
    ) {
      throw failure(invalidStateMessage);
    }
    const identityDescriptors = Object.getOwnPropertyDescriptors(identityValue);
    const deviceDescriptor = identityDescriptors.device;
    const inodeDescriptor = identityDescriptors.inode;
    if (
      deviceDescriptor === undefined ||
      !("value" in deviceDescriptor) ||
      typeof deviceDescriptor.value !== "bigint" ||
      inodeDescriptor === undefined ||
      !("value" in inodeDescriptor) ||
      typeof inodeDescriptor.value !== "bigint"
    ) {
      throw failure(invalidStateMessage);
    }
    return Object.freeze({
      kind: descriptor.value as PathKind,
      identity: Object.freeze({
        device: deviceDescriptor.value,
        inode: inodeDescriptor.value,
      }),
    });
  } catch (error) {
    if (approvedMessage(error) === invalidStateMessage) throw error;
    throw failure(invalidStateMessage);
  }
}

function sameIdentity(
  expected: PathIdentity,
  actual: PathIdentity | undefined,
): boolean {
  return (
    actual !== undefined &&
    actual.device === expected.device &&
    actual.inode === expected.inode
  );
}

function readChildNames(
  directoryPath: string,
  dependencies: KecBatchDirectoryDiscoveryDependencies,
): readonly string[] {
  let value: unknown;
  try {
    value = dependencies.readDirectory(directoryPath);
  } catch {
    throw failure(DISCOVERY_FAILED);
  }
  if (!Array.isArray(value)) throw failure(DISCOVERY_FAILED);

  try {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw failure(DISCOVERY_FAILED);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      throw failure(DISCOVERY_FAILED);
    }
    const length = lengthDescriptor.value as number;
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== length + 1) throw failure(DISCOVERY_FAILED);

    const children: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      ) {
        throw failure(DISCOVERY_FAILED);
      }
      children.push(descriptor.value);
    }
    children.sort();
    return children;
  } catch (error) {
    if (approvedMessage(error) === DISCOVERY_FAILED) throw error;
    throw failure(DISCOVERY_FAILED);
  }
}

export function discoverKecBatchDirectory(
  projectRoot: string,
  request: unknown,
  dependencies?: KecBatchDirectoryDiscoveryDependencies,
): KecBatchDirectoryDiscovery {
  if (
    typeof projectRoot !== "string" ||
    projectRoot.length === 0 ||
    projectRoot.includes("\0") ||
    !isAbsolute(projectRoot)
  ) {
    throw failure(INVALID_CONFIGURATION);
  }
  const directory = readDirectoryRequest(request);
  validateDirectorySpelling(directory);
  const fileSystem =
    dependencies === undefined
      ? DEFAULT_DEPENDENCIES
      : validateDependencies(dependencies);

  let lexicalProjectRoot: string;
  let lexicalDirectory: string;
  try {
    lexicalProjectRoot = resolve(projectRoot);
    lexicalDirectory = resolve(lexicalProjectRoot, directory);
  } catch {
    throw failure(INVALID_DIRECTORY);
  }
  if (!isWithinRoot(lexicalProjectRoot, lexicalDirectory)) {
    throw failure(INVALID_DIRECTORY);
  }

  const directoryState = readPathState(
    lexicalDirectory,
    fileSystem,
    INVALID_DIRECTORY,
    true,
  );
  if (directoryState.kind !== "directory") throw failure(INVALID_DIRECTORY);

  let boundaryRoot = lexicalProjectRoot;
  let realDirectory: string;
  try {
    if (dependencies === undefined) {
      boundaryRoot = fileSystem.realpath(lexicalProjectRoot);
    }
    realDirectory = fileSystem.realpath(lexicalDirectory);
  } catch {
    throw failure(DISCOVERY_FAILED);
  }
  if (!isWithinRoot(boundaryRoot, realDirectory)) {
    throw failure(INVALID_DIRECTORY);
  }

  const sources: string[] = [];
  for (const name of readChildNames(realDirectory, fileSystem)) {
    if (name === ".pdf" || !name.endsWith(".pdf")) continue;
    if (
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0")
    ) {
      throw failure(INVALID_SOURCE);
    }

    const absoluteSource = resolve(realDirectory, name);
    const sourceState = readPathState(
      absoluteSource,
      fileSystem,
      DISCOVERY_FAILED,
      false,
    );
    if (sourceState.kind !== "file") throw failure(INVALID_SOURCE);

    let realSource: string;
    try {
      realSource = fileSystem.realpath(absoluteSource);
    } catch {
      throw failure(DISCOVERY_FAILED);
    }
    if (!isWithinRoot(boundaryRoot, realSource)) {
      throw failure(INVALID_SOURCE);
    }
    const sourcePath = relative(boundaryRoot, realSource).split(sep).join("/");
    if (
      sourcePath.length === 0 ||
      sourcePath === ".." ||
      sourcePath.startsWith("../") ||
      isAbsolute(sourcePath)
    ) {
      throw failure(INVALID_SOURCE);
    }
    sources.push(sourcePath);
  }

  if (directoryState.identity !== undefined) {
    const finalDirectoryState = readPathState(
      realDirectory,
      fileSystem,
      DISCOVERY_FAILED,
      false,
    );
    if (
      finalDirectoryState.kind !== "directory" ||
      !sameIdentity(directoryState.identity, finalDirectoryState.identity)
    ) {
      throw failure(DISCOVERY_FAILED);
    }
  }

  if (sources.length === 0) throw failure(NO_SOURCES);
  return Object.freeze({ sources: Object.freeze(sources) });
}
