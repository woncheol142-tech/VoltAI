import type { DrawingElectricalObjectDocument } from "../drawingElectricalObjects/types.js";
import { validateElectricalObjects } from "../drawingElectricalObjects/validateElectricalObjects.js";

export function validateRelationshipInferenceInput(
  input: unknown,
): asserts input is DrawingElectricalObjectDocument {
  if (typeof input !== "object" || input === null) {
    throw new Error("Relationship inference input must be an electrical object document");
  }
  validateElectricalObjects(input);
}
