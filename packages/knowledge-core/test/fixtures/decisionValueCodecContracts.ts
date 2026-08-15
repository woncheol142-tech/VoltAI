import type {
  DecisionValueCodec,
  JsonPrimitive,
  JsonValue,
} from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type DecisionValueFixture = {
  storedValueSentinel: string;
};

type DecisionValueCodecFixture = DecisionValueCodec<DecisionValueFixture>;

const decisionValueCodecShapeContract: Assert<
  Equal<
    DecisionValueCodecFixture,
    {
      encode: (value: DecisionValueFixture) => JsonValue;
      decode: (value: unknown) => DecisionValueFixture;
    }
  >
> = true;
const encodeContract: Assert<
  Equal<
    DecisionValueCodecFixture["encode"],
    (value: DecisionValueFixture) => JsonValue
  >
> = true;
const decodeContract: Assert<
  Equal<
    DecisionValueCodecFixture["decode"],
    (value: unknown) => DecisionValueFixture
  >
> = true;
const encodeOutputIsNotMerelyJsonPrimitive: Assert<
  Equal<
    ReturnType<DecisionValueCodecFixture["encode"]>,
    JsonPrimitive
  > extends false
    ? true
    : false
> = true;

declare let mutableCodec: DecisionValueCodecFixture;
declare const replacementEncode: (value: DecisionValueFixture) => JsonValue;
declare const replacementDecode: (value: unknown) => DecisionValueFixture;
mutableCodec.encode = replacementEncode;
mutableCodec.decode = replacementDecode;

declare const narrowCodec: DecisionValueCodec<"A">;
// @ts-expect-error A codec for only "A" cannot claim to encode every string value.
const unsafeWidening: DecisionValueCodec<string> = narrowCodec;

// @ts-expect-error The decision value generic argument must be explicit.
type MissingGenericArgument = DecisionValueCodec;
type ExcessGenericArgument =
  // @ts-expect-error DecisionValueCodec has exactly one generic argument.
  DecisionValueCodec<DecisionValueFixture, JsonValue>;

type NullValueCodec = DecisionValueCodec<null>;
type UndefinedValueCodec = DecisionValueCodec<undefined>;
type StringValueCodec = DecisionValueCodec<string>;
type NumberValueCodec = DecisionValueCodec<number>;
type BooleanValueCodec = DecisionValueCodec<boolean>;
type SymbolValueCodec = DecisionValueCodec<symbol>;
type BigintValueCodec = DecisionValueCodec<bigint>;
type ObjectValueCodec = DecisionValueCodec<object>;
type FunctionValueCodec = DecisionValueCodec<() => void>;
type VoidValueCodec = DecisionValueCodec<void>;
type NeverValueCodec = DecisionValueCodec<never>;

type CallerOwnedValueFixture = {
  namespace: string;
  projectId: string;
  authority: "caller-owned";
  model: string;
};
type CallerOwnedObjectValueCodec = DecisionValueCodec<CallerOwnedValueFixture>;

type ForbiddenDecisionValueCodecOwnedField =
  | "namespace"
  | "identityNamespace"
  | "key"
  | "recordKey"
  | "decisionRecordId"
  | "scope"
  | "searchScope"
  | "projectScope"
  | "collection"
  | "membership"
  | "projectId"
  | "tenantId"
  | "sourceId"
  | "table"
  | "column"
  | "schema"
  | "repository"
  | "store"
  | "sqlite"
  | "rowId"
  | "surrogateId"
  | "primaryKey"
  | "foreignKey"
  | "index"
  | "migration"
  | "path"
  | "filename"
  | "vaultPath"
  | "noteId"
  | "authority"
  | "authorityClass"
  | "applicability"
  | "recommendation"
  | "precedence"
  | "current"
  | "isCurrent"
  | "active"
  | "latest"
  | "valid"
  | "correct"
  | "confidence"
  | "score"
  | "similarity"
  | "rank"
  | "provenance"
  | "actor"
  | "timestamp"
  | "model"
  | "provider"
  | "reasoning"
  | "chainOfThought"
  | "consensus"
  | "codecId"
  | "codecVersion"
  | "version"
  | "schemaVersion"
  | "selection"
  | "context"
  | "basis";

const codecOwnsNoForbiddenFields: Assert<
  Equal<
    Extract<
      keyof DecisionValueCodecFixture,
      ForbiddenDecisionValueCodecOwnedField
    >,
    never
  >
> = true;

const extraFieldAttack: DecisionValueCodecFixture = {
  encode: replacementEncode,
  decode: replacementDecode,
  // @ts-expect-error Unlisted fields are rejected independently of the forbidden union.
  note: "not core-owned",
};

void decisionValueCodecShapeContract;
void encodeContract;
void decodeContract;
void encodeOutputIsNotMerelyJsonPrimitive;
void mutableCodec;
void unsafeWidening;
void (null as MissingGenericArgument | null);
void (null as ExcessGenericArgument | null);
void (null as NullValueCodec | null);
void (null as UndefinedValueCodec | null);
void (null as StringValueCodec | null);
void (null as NumberValueCodec | null);
void (null as BooleanValueCodec | null);
void (null as SymbolValueCodec | null);
void (null as BigintValueCodec | null);
void (null as ObjectValueCodec | null);
void (null as FunctionValueCodec | null);
void (null as VoidValueCodec | null);
void (null as NeverValueCodec | null);
void (null as CallerOwnedObjectValueCodec | null);
void codecOwnsNoForbiddenFields;
void extraFieldAttack;
