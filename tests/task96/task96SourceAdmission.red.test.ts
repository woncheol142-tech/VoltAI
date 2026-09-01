import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  admissionReference,
  bindingFixture,
  blobHashFixture,
  invoke,
  loadSourceAdmission,
  loadSourceAdmissionSqlite,
  requiredFunction,
  requiredJson,
  requiredText,
  sourceRevisionFixture,
  TASK96_RED_FAMILY_MAP,
  task96Paths,
  verdictKind,
} from "./fixtures/task96ArchitectureContract.js";

type Family = keyof typeof TASK96_RED_FAMILY_MAP;
type Repository = Readonly<Record<string, unknown>>;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function family(label: Family, run: () => unknown | Promise<unknown>): void {
  const contract = TASK96_RED_FAMILY_MAP[label];
  it(`[${label}] ${contract.case}`, run);
}

function typescriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory()
      ? typescriptFiles(path)
      : extname(entry.name) === ".ts"
        ? [path]
        : [];
  });
}

async function withRepository<Result>(
  run: (repository: Repository, dbPath: string) => Result | Promise<Result>,
): Promise<Result> {
  const sqlite = await loadSourceAdmissionSqlite();
  const Constructor = sqlite.SqliteBindingRepository;
  if (typeof Constructor !== "function") {
    throw new Error(
      "MISSING_TASK96_CONTRACT: SqliteBindingRepository is not exported",
    );
  }
  const directory = mkdtempSync(join(tmpdir(), "task96-admission-"));
  const dbPath = join(directory, "admission.sqlite");
  const repository = new (Constructor as new (path: string) => Repository)(
    dbPath,
  );
  try {
    return await run(repository, dbPath);
  } finally {
    const close = repository.close;
    if (typeof close === "function") {
      try {
        await close.call(repository);
      } catch {
        // Preserve the contract failure from the test body.
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

async function admit(
  repository: Repository,
  binding = bindingFixture(),
  authority = "task96:authority:A",
  basis = "task96:basis:A",
): Promise<unknown> {
  return invoke(
    requiredFunction(repository, "admitBinding"),
    binding,
    authority,
    basis,
  );
}

async function withdraw(
  repository: Repository,
  reference: unknown,
  authority = "task96:authority:withdrawal",
  basis = "task96:basis:withdrawal",
): Promise<unknown> {
  return invoke(
    requiredFunction(repository, "withdrawAdmission"),
    reference,
    authority,
    basis,
  );
}

async function verify(
  repository: Repository,
  binding = bindingFixture(),
): Promise<unknown> {
  return invoke(requiredFunction(repository, "verifyBinding"), binding);
}

async function failureOf(run: () => unknown | Promise<unknown>) {
  try {
    await run();
    return undefined;
  } catch (failure) {
    return failure;
  }
}

describe("Task96 V4 source-admission RED contracts", () => {
  family("A", async () => {
    await withRepository(async (repository) => {
      const failure = await failureOf(() =>
        admit(repository, {
          sourceRevision: {
            identityState: "UNKNOWN_RELATIONSHIP",
            automation: "POLICY_LOOKUP_REQUIRED",
          },
          blobHash: blobHashFixture(),
        } as never),
      );
      expect(failure).toBeDefined();
      expect(verdictKind(await verify(repository))).toBe(
        "BINDING_NOT_ADMITTED",
      );
    });
  });

  family("B", async () => {
    await withRepository(async (repository) => {
      const failure = await failureOf(() =>
        admit(repository, {
          sourceRevision: {
            sourceIdentity: "task96:source:A",
            revisionState: "NOT_ESTABLISHED",
            automation: "POLICY_LOOKUP_REQUIRED",
          },
          blobHash: blobHashFixture(),
        } as never),
      );
      expect(failure).toBeDefined();
      expect(verdictKind(await verify(repository))).toBe(
        "BINDING_NOT_ADMITTED",
      );
    });
  });

  family("C", async () => {
    await withRepository(async (repository) => {
      await admit(repository);
      const otherRevision = bindingFixture(
        sourceRevisionFixture("task96:source:A", "task96:revision:2"),
      );
      expect(verdictKind(await verify(repository, otherRevision))).toBe(
        "BINDING_NOT_ADMITTED",
      );
    });
  });

  family("D", async () => {
    await withRepository(async (repository) => {
      await admit(repository);
      const otherBlob = bindingFixture(
        sourceRevisionFixture(),
        blobHashFixture("b".repeat(64)),
      );
      expect(verdictKind(await verify(repository, otherBlob))).toBe(
        "BINDING_NOT_ADMITTED",
      );
    });
  });

  family("E", async () => {
    await withRepository(async (repository) => {
      const sameBlob = blobHashFixture();
      const bindings = [
        bindingFixture(
          sourceRevisionFixture("task96:source:A", "rev:1"),
          sameBlob,
        ),
        bindingFixture(
          sourceRevisionFixture("task96:source:B", "rev:2"),
          sameBlob,
        ),
        bindingFixture(
          sourceRevisionFixture("task96:source:A", "rev:1"),
          blobHashFixture("c".repeat(64)),
        ),
      ];
      for (const binding of bindings) await admit(repository, binding);
      for (const binding of bindings) {
        expect(verdictKind(await verify(repository, binding))).toBe(
          "BINDING_ADMITTED",
        );
      }
    });
  });

  family("F", async () => {
    await withRepository(async (repository) => {
      const blob = blobHashFixture();
      await admit(
        repository,
        bindingFixture(sourceRevisionFixture("task96:source:A", "rev:1"), blob),
      );
      expect(
        verdictKind(
          await verify(
            repository,
            bindingFixture(
              sourceRevisionFixture("task96:source:B", "rev:1"),
              blob,
            ),
          ),
        ),
      ).toBe("BINDING_NOT_ADMITTED");
    });
  });

  family("G", async () => {
    const source = requiredText(
      task96Paths.sourceAdmissionEntrypoint,
      "MISSING_SOURCE_ADMISSION",
    );
    expect(source).not.toMatch(
      /verifyBinding\s*\([^)]*(?:locator|path|publisher)/isu,
    );
  });

  family("H", async () => {
    await withRepository(async (repository) => {
      const result = await verify(repository);
      expect(verdictKind(result)).toBe("BINDING_NOT_ADMITTED");
      expect(JSON.stringify(result)).not.toContain("SOURCE_NONEXISTENCE");
    });
  });

  family("I", async () => {
    await withRepository(async (repository) => {
      expect(verdictKind(await verify(repository))).toBe(
        "BINDING_NOT_ADMITTED",
      );
      await invoke(requiredFunction(repository, "close"));
      const failure = await failureOf(() => verify(repository));
      expect(failure).toBeInstanceOf(Error);
      expect(verdictKind(failure)).toBeUndefined();
    });
  });

  family("J", async () => {
    await withRepository(async (repository) => {
      const first = admissionReference(await admit(repository));
      const second = admissionReference(await admit(repository));
      expect(first).toEqual(second);
      expect(first?.admissionSequence).toBe(1);
    });
  });

  family("K", async () => {
    await withRepository(async (repository) => {
      let release: (() => void) | undefined;
      const start = new Promise<void>((resolve) => {
        release = resolve;
      });
      const attempts = ["A", "B"].map(async () => {
        await start;
        return admissionReference(await admit(repository));
      });
      release?.();
      const results = await Promise.all(attempts);
      expect(results[0]).toEqual(results[1]);
      expect(verdictKind(await verify(repository))).toBe("BINDING_ADMITTED");
    });
  });

  family("S", async () => {
    await withRepository(async (_repository, dbPath) => {
      const database = new DatabaseSync(dbPath);
      try {
        const indexes = database
          .prepare("PRAGMA index_list(source_binding_admission_events)")
          .all() as Array<{ name: string; unique: number; origin: string }>;
        const uniqueShapes = indexes
          .filter(({ unique }) => unique === 1)
          .map(({ name }) =>
            (
              database.prepare(`PRAGMA index_info('${name}')`).all() as Array<{
                seqno: number;
                name: string;
              }>
            )
              .sort((left, right) => left.seqno - right.seqno)
              .map(({ name: column }) => column),
          );
        expect(uniqueShapes).toEqual([
          [
            "source_identity",
            "revision_key",
            "blob_algorithm",
            "blob_digest",
            "admission_sequence",
          ],
        ]);
      } finally {
        database.close();
      }
    });
  });

  family("T", async () => {
    const admission = await loadSourceAdmission();
    const source = requiredText(
      task96Paths.sourceAdmissionEntrypoint,
      "MISSING_SOURCE_ADMISSION",
    );
    const manifest = requiredJson(
      task96Paths.sourceAdmissionManifest,
      "MISSING_SOURCE_ADMISSION",
    );
    expect(Object.keys((manifest.exports ?? {}) as object)).toEqual(["."]);
    for (const symbol of [
      "admitBinding",
      "withdrawAdmission",
      "verifyBinding",
    ]) {
      expect(admission).toHaveProperty(symbol);
    }
    for (const publicType of [
      "SourceBinding",
      "AdmissionRecordReference",
      "VerifyBindingSemanticResult",
    ]) {
      expect(source).toMatch(new RegExp(`\\b${publicType}\\b`, "u"));
    }
  });

  family("U", () => {
    const core = requiredJson(
      task96Paths.sourceAdmissionManifest,
      "MISSING_SOURCE_ADMISSION",
    );
    const sqlite = requiredJson(
      task96Paths.sourceAdmissionSqliteManifest,
      "MISSING_SOURCE_ADMISSION_SQLITE",
    );
    expect(core.dependencies).toEqual({ "@voltai/source-core": "workspace:*" });
    expect(sqlite.dependencies).toEqual({
      "@voltai/source-admission": "workspace:*",
    });
  });

  family("W", () => {
    const source = requiredText(
      task96Paths.sourceAdmissionEntrypoint,
      "MISSING_SOURCE_ADMISSION",
    );
    const signature = source.match(/verifyBinding[\s\S]{0,500}/u)?.[0] ?? "";
    expect(signature).not.toMatch(/locator|publisher|filePath/iu);
  });

  family("X", () => {
    requiredText(
      task96Paths.sourceAdmissionEntrypoint,
      "MISSING_SOURCE_ADMISSION",
    );
    const source = typescriptFiles(join(task96Paths.sourceAdmissionRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bSourceBindingId\b/u);
  });

  family("Y", async () => {
    await withRepository(async (repository) => {
      const first = admissionReference(
        await admit(repository, bindingFixture(), "authority:A", "basis:A"),
      );
      const second = admissionReference(
        await admit(repository, bindingFixture(), "authority:B", "basis:B"),
      );
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      await withdraw(repository, first);
      expect(verdictKind(await verify(repository))).toBe("BINDING_ADMITTED");
      await withdraw(repository, second);
      expect(verdictKind(await verify(repository))).toBe("BINDING_WITHDRAWN");
    });
  });

  family("AB", async () => {
    await withRepository(async (repository) => {
      const withdrawn = admissionReference(
        await admit(repository, bindingFixture(), "authority:A", "basis:A"),
      );
      await admit(repository, bindingFixture(), "authority:B", "basis:B");
      await withdraw(repository, withdrawn);
      const verdict = await verify(repository);
      expect(verdictKind(verdict)).toBe("BINDING_ADMITTED");
      expect(JSON.stringify(verdict)).toContain("authority:B");
    });
  });

  family("AC", async () => {
    await withRepository(async (repository) => {
      const admitted = admissionReference(await admit(repository));
      await withdraw(repository, admitted);
      expect(verdictKind(await verify(repository))).toBe("BINDING_WITHDRAWN");
      expect(
        verdictKind(
          await verify(
            repository,
            bindingFixture(
              sourceRevisionFixture("task96:never", "task96:never-revision"),
            ),
          ),
        ),
      ).toBe("BINDING_NOT_ADMITTED");
    });
  });

  family("AG", async () => {
    await withRepository(async (repository) => {
      await invoke(requiredFunction(repository, "close"));
      const failure = await failureOf(() => verify(repository));
      expect(failure).toBeInstanceOf(Error);
      expect([
        "BINDING_ADMITTED",
        "BINDING_NOT_ADMITTED",
        "BINDING_WITHDRAWN",
        "BINDING_CONTRADICTION",
      ]).not.toContain(verdictKind(failure));
    });
  });

  family("AH", () => {
    const manifest = requiredJson(
      task96Paths.sourceAdmissionManifest,
      "MISSING_SOURCE_ADMISSION",
    );
    expect(manifest.dependencies).toEqual({
      "@voltai/source-core": "workspace:*",
    });
    expect(JSON.stringify(manifest)).not.toContain("@voltai/extraction-core");
  });

  family("AI", () => {
    requiredText(
      task96Paths.sourceAdmissionEntrypoint,
      "MISSING_SOURCE_ADMISSION",
    );
    const source = typescriptFiles(join(task96Paths.sourceAdmissionRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/citab|publisherRank|preferredAuthority/iu);
  });

  family("AJ", () => {
    const admission = requiredJson(
      task96Paths.sourceAdmissionManifest,
      "MISSING_SOURCE_ADMISSION",
    );
    const adapter = requiredJson(
      task96Paths.sourceAdmissionSqliteManifest,
      "MISSING_SOURCE_ADMISSION_SQLITE",
    );
    const runtime = requiredJson(
      task96Paths.kecSourceRuntimeManifest,
      "MISSING_KEC_SOURCE_RUNTIME",
    );
    expect(admission.dependencies).toEqual({
      "@voltai/source-core": "workspace:*",
    });
    expect(adapter.dependencies).toEqual({
      "@voltai/source-admission": "workspace:*",
    });
    expect(runtime.dependencies).toMatchObject({
      "@voltai/source-admission": "workspace:*",
      "@voltai/source-admission-sqlite": "workspace:*",
      "@voltai/mcp-kec": "workspace:*",
      "@voltai/extraction-core": "workspace:*",
    });
  });

  family("AS", async () => {
    const admission = await loadSourceAdmission();
    for (const name of [
      "recordVerifiedExtraction",
      "appendVerificationReceipt",
      "saveVerifiedExecution",
      "appendReceipt",
    ]) {
      expect(admission).not.toHaveProperty(name);
    }
  });

  family("AT", () => {
    requiredText(
      task96Paths.sourceAdmissionSqliteEntrypoint,
      "MISSING_SOURCE_ADMISSION_SQLITE",
    );
    const source = typescriptFiles(
      join(task96Paths.sourceAdmissionSqliteRoot, "src"),
    )
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).toContain("source_binding_admission_events");
    expect(source).not.toMatch(
      /receipt|result_commitment|extraction_contract|locator_space|requirement|capture|Task9[03]|KEC/iu,
    );
  });
});
