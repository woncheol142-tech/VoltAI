import { describe, expect, it } from "vitest";

import {
  createElectricalConstructionFixture,
  importElectricalModule,
} from "./helpers/drawingElectricalObjectsFixture.js";

type ValidationModule = {
  validateElectricalConstructionInput(input: unknown): unknown;
};

async function validator() {
  return importElectricalModule<ValidationModule>(
    "validateElectricalConstructionInput",
  );
}

function set(target: object, key: PropertyKey, value: unknown): void {
  Reflect.set(target, key, value);
}

describe("electrical construction input validation", () => {
  it("accepts matching schema-v1 source documents", async () => {
    const { validateElectricalConstructionInput } = await validator();
    expect(() =>
      validateElectricalConstructionInput(createElectricalConstructionFixture())
    ).not.toThrow();
  });

  it.each([
    ["source", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.spatial.source = "other.pdf";
    }],
    ["sourceSha256", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.classification.sourceSha256 = "f".repeat(64);
    }],
    ["page", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.primitive.page += 1;
    }],
    ["pageWidth", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.spatial.pageWidth += 1;
    }],
    ["pageHeight", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.layout.pageHeight += 1;
    }],
  ])("fails fast for %s identity mismatch", async (field, corrupt) => {
    const { validateElectricalConstructionInput } = await validator();
    const fixture = createElectricalConstructionFixture();
    corrupt(fixture);
    expect(() => validateElectricalConstructionInput(fixture)).toThrow(
      new RegExp(field, "i"),
    );
  });

  it("rejects unsupported input schema versions", async () => {
    const { validateElectricalConstructionInput } = await validator();
    const fixture = createElectricalConstructionFixture();
    set(fixture.layout, "schemaVersion", 2);
    expect(() => validateElectricalConstructionInput(fixture)).toThrow(
      /schema|version/i,
    );
  });

  it.each([
    ["primitive", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.spatial.relations[0]!.primitiveId = "missing-primitive";
    }],
    ["text", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.spatial.relations[0]!.textEntityId = "missing-text";
    }],
    ["classification", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.classification.classifications.pop();
      fixture.classification.classificationCount -= 1;
    }],
    ["relation", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.spatial.relationCount += 1;
    }],
  ])("rejects missing %s references", async (_name, corrupt) => {
    const { validateElectricalConstructionInput } = await validator();
    const fixture = createElectricalConstructionFixture();
    corrupt(fixture);
    expect(() => validateElectricalConstructionInput(fixture)).toThrow(
      /missing|reference|count|classification|relation/i,
    );
  });

  it.each([
    ["primitive", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.primitive.primitives[1]!.id = fixture.primitive.primitives[0]!.id;
    }],
    ["text entity", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.layout.lines[0]!.id = fixture.layout.items[0]!.id;
    }],
    ["relation", (fixture: ReturnType<typeof createElectricalConstructionFixture>) => {
      fixture.spatial.relations[1]!.id = fixture.spatial.relations[0]!.id;
    }],
  ])("rejects duplicate %s IDs", async (_name, corrupt) => {
    const { validateElectricalConstructionInput } = await validator();
    const fixture = createElectricalConstructionFixture();
    corrupt(fixture);
    expect(() => validateElectricalConstructionInput(fixture)).toThrow(
      /duplicate|duplicated|unique/i,
    );
  });

  it("rejects corrupt document counts", async () => {
    const { validateElectricalConstructionInput } = await validator();
    const fixture = createElectricalConstructionFixture();
    fixture.primitive.primitiveCount += 1;
    expect(() => validateElectricalConstructionInput(fixture)).toThrow(/count/i);
  });

  it.each([
    [Number.NaN, /finite|bbox/i],
    [Number.POSITIVE_INFINITY, /finite|bbox/i],
  ])("rejects non-finite bbox coordinate %s", async (value, message) => {
    const { validateElectricalConstructionInput } = await validator();
    const fixture = createElectricalConstructionFixture();
    fixture.layout.items[0]!.pageBBox.x = value;
    expect(() => validateElectricalConstructionInput(fixture)).toThrow(message);
  });

  it.each([0, -1])("rejects non-positive page dimensions %s", async (dimension) => {
    const { validateElectricalConstructionInput } = await validator();
    const fixture = createElectricalConstructionFixture();
    fixture.layout.pageWidth = dimension;
    fixture.primitive.pageWidth = dimension;
    fixture.spatial.pageWidth = dimension;
    expect(() => validateElectricalConstructionInput(fixture)).toThrow(
      /dimension|positive|width/i,
    );
  });
});
