import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import ts from "typescript";

export type TechnicalDependencyAudit = Readonly<{
  rootFile: string;
  visitedFiles: readonly string[];
}>;

export class Task98TechnicalDependencyError extends Error {
  constructor(
    readonly code:
      | "MISSING_V2_TECHNICAL_ROOT"
      | "FORBIDDEN_TECHNICAL_DEPENDENCY"
      | "FORBIDDEN_AUTHORITY_CAPABILITY",
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "Task98TechnicalDependencyError";
  }
}

const forbiddenModulePatterns = [
  /(?:^|\/)source-admission(?:-sqlite)?(?:\/|$)/u,
  /(?:^|\/)kec-source-policy(?:-sqlite|-judgement)?(?:\/|$)/u,
  /(?:^|\/)decision-sqlite(?:\/|$)/u,
  /(?:^|\/)kec-source-runtime(?:\/|$)/u,
  /(?:^|\/)knowledge-sqlite(?:\/|$)/u,
  /requirementSnapshot\/store/u,
  /internal\/(?:receiptStore|task93Bridge)/u,
] as const;

const forbiddenCapabilityNames = [
  "KecSourceBindingVerifier",
  "verifyObservedBinding",
  "admitBinding",
  "AdmissionRecordReference",
  "receiptStore",
  "snapshotStore",
] as const;

function typescriptFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
    })
    .sort();
}

function declaresTechnicalRoot(path: string): boolean {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return file.statements.some((statement) => {
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    if (
      !modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      return false;
    }
    if (ts.isFunctionDeclaration(statement)) {
      return statement.name?.text === "extractKecV2Technical";
    }
    return (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "extractKecV2Technical",
      )
    );
  });
}

export function findTechnicalRoot(sourceRoot: string): string {
  const matches = typescriptFiles(sourceRoot).filter(declaresTechnicalRoot);
  if (matches.length !== 1) {
    throw new Task98TechnicalDependencyError(
      "MISSING_V2_TECHNICAL_ROOT",
      `expected exactly one extractKecV2Technical declaration under ${sourceRoot}; found ${matches.length}`,
    );
  }
  return matches[0]!;
}

function moduleSpecifiers(path: string): readonly string[] {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

function relativeModule(path: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const candidate = resolve(dirname(path), specifier);
  const withoutJs = candidate.replace(/\.js$/u, "");
  for (const resolved of [
    candidate,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    join(withoutJs, "index.ts"),
  ]) {
    if (existsSync(resolved)) return resolved;
  }
  return undefined;
}

function workspaceRootFrom(path: string): string | undefined {
  let current = resolve(path);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function workspaceModule(
  workspaceRoot: string | undefined,
  specifier: string,
): string | undefined {
  if (workspaceRoot === undefined) return undefined;
  const match = specifier.match(/^@voltai\/([^/]+)(?:\/(.+))?$/u);
  if (match === null) return undefined;
  const packageRoot = join(workspaceRoot, "packages", match[1]!);
  if (!existsSync(join(packageRoot, "package.json"))) return undefined;
  const subpath = match[2];
  const candidates =
    subpath === undefined
      ? [join(packageRoot, "src/index.ts")]
      : [
          join(packageRoot, "src", `${subpath}.ts`),
          join(packageRoot, "src", subpath, "index.ts"),
        ];
  return candidates.find(existsSync);
}

function assertAllowedModule(path: string, specifier: string): void {
  if (forbiddenModulePatterns.some((pattern) => pattern.test(specifier))) {
    throw new Task98TechnicalDependencyError(
      "FORBIDDEN_TECHNICAL_DEPENDENCY",
      `${path} imports ${specifier}`,
    );
  }
}

function assertNoAuthorityCapability(path: string): void {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let forbiddenName: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      forbiddenName === undefined &&
      ts.isIdentifier(node) &&
      forbiddenCapabilityNames.some((name) => name === node.text)
    ) {
      forbiddenName = node.text;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (forbiddenName !== undefined) {
    throw new Task98TechnicalDependencyError(
      "FORBIDDEN_AUTHORITY_CAPABILITY",
      `${path} contains authority capability ${forbiddenName}`,
    );
  }
}

export function assertTechnicalDependencyAuthority(
  sourceRoot: string,
  explicitRootFile?: string,
): TechnicalDependencyAudit {
  const rootFile = explicitRootFile ?? findTechnicalRoot(sourceRoot);
  const workspaceRoot = workspaceRootFrom(sourceRoot);
  const pending = [rootFile];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    assertNoAuthorityCapability(path);
    for (const specifier of moduleSpecifiers(path)) {
      assertAllowedModule(path, specifier);
      const dependency =
        relativeModule(path, specifier) ??
        workspaceModule(workspaceRoot, specifier);
      if (dependency !== undefined) pending.push(dependency);
    }
  }

  return Object.freeze({
    rootFile,
    visitedFiles: Object.freeze([...visited].sort()),
  });
}
