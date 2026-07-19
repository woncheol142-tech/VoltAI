import type { PageBBox } from "../drawingLayout/types.js";
import type { BuildElectricalObjectsInput } from "./types.js";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Electrical construction input: ${message}`);
}

function assertFiniteBBox(bbox: PageBBox, label: string): void {
  for (const [key, value] of Object.entries(bbox)) {
    assertCondition(Number.isFinite(value), `${label} bbox ${key} must be finite`);
  }
  assertCondition(bbox.width >= 0 && bbox.height >= 0, `${label} bbox size is invalid`);
}

function assertUnique(values: readonly string[], label: string): void {
  assertCondition(new Set(values).size === values.length, `duplicate ${label} ID`);
}

export function validateElectricalConstructionInput(
  input: BuildElectricalObjectsInput,
): void {
  const documents = [input.layout, input.primitive, input.classification, input.spatial];
  for (const document of documents) {
    assertCondition(document.schemaVersion === 1, "unsupported schema version");
    assertCondition(document.source === input.layout.source, "source mismatch");
    assertCondition(
      document.sourceSha256 === input.layout.sourceSha256,
      "sourceSha256 mismatch",
    );
    assertCondition(document.page === input.layout.page, "page mismatch");
  }

  for (const [label, value] of [
    ["pageWidth", input.layout.pageWidth],
    ["pageHeight", input.layout.pageHeight],
    ["pageWidth", input.primitive.pageWidth],
    ["pageHeight", input.primitive.pageHeight],
    ["pageWidth", input.spatial.pageWidth],
    ["pageHeight", input.spatial.pageHeight],
  ] as const) {
    assertCondition(Number.isFinite(value) && value > 0, `${label} dimension must be positive`);
  }
  assertCondition(input.primitive.pageWidth === input.layout.pageWidth, "pageWidth mismatch");
  assertCondition(input.primitive.pageHeight === input.layout.pageHeight, "pageHeight mismatch");
  assertCondition(input.spatial.pageWidth === input.layout.pageWidth, "pageWidth mismatch");
  assertCondition(input.spatial.pageHeight === input.layout.pageHeight, "pageHeight mismatch");

  assertCondition(input.layout.itemCount === input.layout.items.length, "item count mismatch");
  assertCondition(input.layout.lineCount === input.layout.lines.length, "line count mismatch");
  assertCondition(
    input.primitive.primitiveCount === input.primitive.primitives.length,
    "primitive count mismatch",
  );
  assertCondition(
    input.classification.primitiveCount === input.primitive.primitiveCount,
    "classification primitive count mismatch",
  );
  assertCondition(
    input.classification.classificationCount === input.classification.classifications.length,
    "classification count mismatch",
  );
  assertCondition(
    input.spatial.textItemCount === input.layout.itemCount &&
      input.spatial.textLineCount === input.layout.lineCount,
    "spatial text count mismatch",
  );
  assertCondition(
    input.spatial.primitiveCount === input.primitive.primitiveCount,
    "spatial primitive count mismatch",
  );
  assertCondition(
    input.spatial.relationCount === input.spatial.relations.length,
    "spatial relation count mismatch",
  );

  const primitiveIds = input.primitive.primitives.map(({ id }) => id);
  const textIds = [
    ...input.layout.items.map(({ id }) => id),
    ...input.layout.lines.map(({ id }) => id),
  ];
  const relationIds = input.spatial.relations.map(({ id }) => id);
  assertUnique(primitiveIds, "primitive");
  assertUnique(textIds, "text entity");
  assertUnique(relationIds, "relation");
  assertUnique(
    input.classification.classifications.map(({ primitiveId }) => primitiveId),
    "classification primitive",
  );

  const primitiveIdSet = new Set(primitiveIds);
  const textIdSet = new Set(textIds);
  assertCondition(
    input.classification.classifications.length === primitiveIds.length,
    "missing classification reference",
  );
  for (const classification of input.classification.classifications) {
    assertCondition(
      primitiveIdSet.has(classification.primitiveId),
      `missing primitive classification reference ${classification.primitiveId}`,
    );
    assertFiniteBBox(classification.geometry.bbox, "classification");
    assertFiniteBBox(classification.geometry.pageBBox, "classification page");
  }
  for (const primitive of input.primitive.primitives) {
    assertFiniteBBox(primitive.bbox, `primitive ${primitive.id}`);
    assertFiniteBBox(primitive.pageBBox, `primitive ${primitive.id} page`);
  }
  for (const text of [...input.layout.items, ...input.layout.lines]) {
    assertFiniteBBox(text.bbox, `text ${text.id}`);
    assertFiniteBBox(text.pageBBox, `text ${text.id} page`);
  }
  for (const relation of input.spatial.relations) {
    assertCondition(
      primitiveIdSet.has(relation.primitiveId),
      `missing primitive relation reference ${relation.primitiveId}`,
    );
    assertCondition(
      textIdSet.has(relation.textEntityId),
      `missing text relation reference ${relation.textEntityId}`,
    );
    for (const value of Object.values(relation.geometry)) {
      if (typeof value === "number") {
        assertCondition(Number.isFinite(value), "relation geometry must be finite");
      }
    }
    assertCondition(Number.isFinite(relation.distancePt), "relation distance must be finite");
  }
}
