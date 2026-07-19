import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  BreakerElectricalObject,
  CableElectricalObject,
  DrawingElectricalObjectDocument,
  ElectricalAttribute,
  ElectricalObject,
  ElectricalObjectStatus,
  ElectricalObjectType,
  PanelElectricalObject,
  TransformerElectricalObject,
  UnknownElectricalObject,
} from "../src/drawingElectricalObjects/types.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

const attribute = {
  value: "MCCB",
  rawText: "MCCB",
  confidence: 1,
  textEntityIds: ["item-1"],
  sourceRelationIds: ["relation-1"],
  parserRuleId: "breaker.kind",
} satisfies ElectricalAttribute<string>;

const breaker = {
  id: "a".repeat(24),
  type: "breaker",
  status: "accepted",
  bbox: { x: 0, y: 0, width: 10, height: 10 },
  primitiveIds: ["primitive-1"],
  labels: [],
  attributes: {
    name: attribute,
    tag: null,
    rating: attribute,
    phase: null,
    capacity: null,
    circuit: null,
    voltage: null,
    remarks: null,
    breakerKind: attribute,
    poles: null,
    frameAmpere: null,
    tripAmpere: null,
  },
  confidence: 1,
  sourceRelationIds: ["relation-1"],
  diagnostics: {
    ruleId: "breaker.rule",
    confidenceComponents: {
      structural: 1,
      label: 1,
      spatial: 1,
      attribute: 1,
      consistency: 1,
    },
    conflicts: [],
  },
} satisfies BreakerElectricalObject;

function assertNever(value: never): never {
  throw new Error(`Unexpected object: ${String(value)}`);
}

function objectType(value: ElectricalObject): ElectricalObjectType {
  switch (value.type) {
    case "lighting":
    case "outlet":
    case "panel":
    case "breaker":
    case "transformer":
    case "ground":
    case "cable":
    case "conduit":
    case "equipment":
    case "annotation":
    case "unknown":
      return value.type;
    default:
      return assertNever(value);
  }
}

describe("drawing electrical object public type contract", () => {
  it("compiles the schema-v1 discriminated-union contract", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          testFile,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      )
    ).not.toThrow();
  });

  it("fixes object type and status as closed unions", () => {
    expectTypeOf<ElectricalObjectType>().toEqualTypeOf<
      | "lighting" | "outlet" | "panel" | "breaker" | "transformer"
      | "ground" | "cable" | "conduit" | "equipment" | "annotation"
      | "unknown"
    >();
    expectTypeOf<ElectricalObjectStatus>().toEqualTypeOf<
      "accepted" | "review"
    >();
  });

  it("narrows type-specific attributes and supports exhaustive switches", () => {
    const object: ElectricalObject = breaker;
    if (object.type === "breaker") {
      expect(object.attributes.breakerKind.value).toBe("MCCB");
    }
    expect(objectType(object)).toBe("breaker");
    expectTypeOf<PanelElectricalObject["attributes"]>().not.toHaveProperty(
      "breakerKind",
    );
    expectTypeOf<UnknownElectricalObject["attributes"]>().not.toHaveProperty(
      "rating",
    );
    expectTypeOf<TransformerElectricalObject["type"]>().toEqualTypeOf<
      "transformer"
    >();
    expectTypeOf<CableElectricalObject["type"]>().toEqualTypeOf<"cable">();
  });

  it("fixes the schema-v1 document shape without raw source payloads", () => {
    expectTypeOf<DrawingElectricalObjectDocument>().toHaveProperty("objects");
    expectTypeOf<DrawingElectricalObjectDocument>().toHaveProperty(
      "constructionGraph",
    );
    expectTypeOf<DrawingElectricalObjectDocument>().not.toHaveProperty(
      "primitives",
    );
    expectTypeOf<DrawingElectricalObjectDocument>().not.toHaveProperty(
      "textItems",
    );
  });

  it("rejects invalid object and attribute shapes at compile time", () => {
    // @ts-expect-error unsupported electrical object type
    const invalidType: ElectricalObjectType = "motor-control-center";
    // @ts-expect-error unsupported status
    const invalidStatus: ElectricalObjectStatus = "excluded";
    // @ts-expect-error attribute provenance is required
    const invalidAttribute: ElectricalAttribute<string> = { value: "100A" };
    // @ts-expect-error schema version 2 is not supported
    const invalidDocument: DrawingElectricalObjectDocument = { schemaVersion: 2 };
    // @ts-expect-error numeric IDs are forbidden
    const invalidId: BreakerElectricalObject = { ...breaker, id: 1 };
    const { diagnostics, ...withoutDiagnostics } = breaker;
    expect(diagnostics).toBeDefined();
    // @ts-expect-error diagnostics are required
    const missingDiagnostics: BreakerElectricalObject = withoutDiagnostics;
    expect([
      invalidType,
      invalidStatus,
      invalidAttribute,
      invalidDocument,
      invalidId,
      missingDiagnostics,
    ]).toHaveLength(6);
  });
});
