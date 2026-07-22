import type {
  CommonElectricalAttributes,
  ElectricalAttribute,
  ElectricalObject,
  ElectricalObjectType,
} from "../drawingElectricalObjects/types.js";
import {
  canonicalizeCircuitJsonValue,
  isCircuitJsonObject,
} from "./jsonValue.js";
import {
  CircuitNodeType,
  type CircuitJsonObject,
  type CircuitJsonValue,
} from "./types.js";

function unreachable(value: never): never {
  throw new Error(`Unsupported electrical object type: ${String(value)}`);
}

export function mapElectricalObjectType(
  type: ElectricalObjectType,
): CircuitNodeType {
  switch (type) {
    case "lighting":
      return CircuitNodeType.LIGHTING;
    case "outlet":
      return CircuitNodeType.OUTLET;
    case "panel":
      return CircuitNodeType.PANEL;
    case "breaker":
      return CircuitNodeType.BREAKER;
    case "transformer":
      return CircuitNodeType.TRANSFORMER;
    case "ground":
      return CircuitNodeType.GROUND;
    case "cable":
      return CircuitNodeType.CABLE;
    case "conduit":
      return CircuitNodeType.CONDUIT;
    case "equipment":
      return CircuitNodeType.EQUIPMENT;
    case "annotation":
      return CircuitNodeType.ANNOTATION;
    case "unknown":
      return CircuitNodeType.UNKNOWN_OBJECT;
    default:
      return unreachable(type);
  }
}

export function cloneCircuitJsonObject(value: unknown): CircuitJsonObject {
  const canonical = canonicalizeCircuitJsonValue(value as CircuitJsonValue);
  if (!isCircuitJsonObject(canonical)) {
    throw new Error("Projected JSON value must be an object");
  }
  return canonical;
}

function projectAttribute(
  attribute: ElectricalAttribute<string> | null,
): CircuitJsonObject | null {
  if (attribute === null) return null;
  return cloneCircuitJsonObject({
    value: attribute.value,
    rawText: attribute.rawText,
    confidence: attribute.confidence,
    textEntityIds: attribute.textEntityIds,
    sourceRelationIds: attribute.sourceRelationIds,
    parserRuleId: attribute.parserRuleId,
  });
}

function projectCommonAttributes(
  attributes: CommonElectricalAttributes,
): CircuitJsonObject {
  return cloneCircuitJsonObject({
    name: projectAttribute(attributes.name),
    tag: projectAttribute(attributes.tag),
    phase: projectAttribute(attributes.phase),
    capacity: projectAttribute(attributes.capacity),
    circuit: projectAttribute(attributes.circuit),
    voltage: projectAttribute(attributes.voltage),
    remarks: projectAttribute(attributes.remarks),
  });
}

export function projectPublicObjectAttributes(
  object: ElectricalObject,
): CircuitJsonObject {
  switch (object.type) {
    case "unknown":
      return cloneCircuitJsonObject({
        name: projectAttribute(object.attributes.name),
        tag: projectAttribute(object.attributes.tag),
        remarks: projectAttribute(object.attributes.remarks),
      });
    case "breaker": {
      const common = projectCommonAttributes(object.attributes);
      return cloneCircuitJsonObject({
        ...common,
        rating: projectAttribute(object.attributes.rating),
        breakerKind: projectAttribute(object.attributes.breakerKind),
        poles: projectAttribute(object.attributes.poles),
        frameAmpere: projectAttribute(object.attributes.frameAmpere),
        tripAmpere: projectAttribute(object.attributes.tripAmpere),
      });
    }
    case "panel":
    case "transformer":
    case "cable":
      return cloneCircuitJsonObject({
        ...projectCommonAttributes(object.attributes),
        rating: projectAttribute(object.attributes.rating),
      });
    case "lighting":
    case "outlet":
    case "ground":
    case "conduit":
    case "equipment":
    case "annotation":
      return projectCommonAttributes(object.attributes);
    default:
      return unreachable(object);
  }
}

export function createNodeDetails(object: ElectricalObject): CircuitJsonObject {
  return cloneCircuitJsonObject({
    objectStatus: object.status,
    objectConfidence: object.confidence,
    primitiveIds: object.primitiveIds,
    labelIds: object.labels.map(({ textEntityId }) => textEntityId),
    sourceRelationIds: object.sourceRelationIds,
  });
}
