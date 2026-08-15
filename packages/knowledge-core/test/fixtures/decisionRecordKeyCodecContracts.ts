import type { DecisionRecordKeyCodec } from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type DecisionRecordIdFixture = {
  recordIdentityKey: string;
};

type DecisionRecordKeyCodecFixture =
  DecisionRecordKeyCodec<DecisionRecordIdFixture>;

const decisionRecordKeyCodecShapeContract: Assert<
  Equal<
    DecisionRecordKeyCodecFixture,
    {
      encode: (value: DecisionRecordIdFixture) => string;
      decode: (value: unknown) => DecisionRecordIdFixture;
    }
  >
> = true;
const encodeContract: Assert<
  Equal<
    DecisionRecordKeyCodecFixture["encode"],
    (value: DecisionRecordIdFixture) => string
  >
> = true;
const decodeContract: Assert<
  Equal<
    DecisionRecordKeyCodecFixture["decode"],
    (value: unknown) => DecisionRecordIdFixture
  >
> = true;

declare let mutableCodec: DecisionRecordKeyCodecFixture;
declare const replacementEncode: (value: DecisionRecordIdFixture) => string;
declare const replacementDecode: (value: unknown) => DecisionRecordIdFixture;
mutableCodec.encode = replacementEncode;
mutableCodec.decode = replacementDecode;

declare const narrowCodec: DecisionRecordKeyCodec<"R1">;
// @ts-expect-error A codec for only "R1" cannot claim to encode every string ID.
const unsafeWidening: DecisionRecordKeyCodec<string> = narrowCodec;

// @ts-expect-error The DecisionRecord ID generic argument must be explicit.
type MissingGenericArgument = DecisionRecordKeyCodec;
type ExcessGenericArgument =
  // @ts-expect-error DecisionRecordKeyCodec has exactly one generic argument.
  DecisionRecordKeyCodec<DecisionRecordIdFixture, string>;

type NullDecisionRecordId =
  // @ts-expect-error A DecisionRecord key codec domain cannot be null.
  DecisionRecordKeyCodec<null>;
type UndefinedDecisionRecordId =
  // @ts-expect-error A DecisionRecord key codec domain cannot be undefined.
  DecisionRecordKeyCodec<undefined>;
type NullableDecisionRecordId =
  // @ts-expect-error A DecisionRecord key codec domain cannot include null.
  DecisionRecordKeyCodec<string | null>;
type OptionalDecisionRecordId =
  // @ts-expect-error A DecisionRecord key codec domain cannot include undefined.
  DecisionRecordKeyCodec<string | undefined>;

type StringIdCodec = DecisionRecordKeyCodec<string>;
type NumberIdCodec = DecisionRecordKeyCodec<number>;
type BooleanIdCodec = DecisionRecordKeyCodec<boolean>;
type SymbolIdCodec = DecisionRecordKeyCodec<symbol>;
type BigintIdCodec = DecisionRecordKeyCodec<bigint>;
type ObjectIdCodec = DecisionRecordKeyCodec<object>;
type CallerOwnedObjectIdCodec = DecisionRecordKeyCodec<DecisionRecordIdFixture>;

type LegacyDecisionRecordId = {
  legacyRecordKey: number;
};
type ModernDecisionRecordId = {
  modernRecordKey: string;
};
type LegacyDecisionRecordKeyCodec =
  DecisionRecordKeyCodec<LegacyDecisionRecordId>;
type ModernDecisionRecordKeyCodec =
  DecisionRecordKeyCodec<ModernDecisionRecordId>;

type ForbiddenDecisionRecordKeyCodecOwnedField =
  | "namespace"
  | "identityNamespace"
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
  | "schemaVersion";

const codecOwnsNoForbiddenFields: Assert<
  Equal<
    Extract<
      keyof DecisionRecordKeyCodecFixture,
      ForbiddenDecisionRecordKeyCodecOwnedField
    >,
    never
  >
> = true;

const extraFieldAttack: DecisionRecordKeyCodecFixture = {
  encode: replacementEncode,
  decode: replacementDecode,
  // @ts-expect-error Unlisted fields are rejected independently of the forbidden union.
  note: "not core-owned",
};

void decisionRecordKeyCodecShapeContract;
void encodeContract;
void decodeContract;
void mutableCodec;
void unsafeWidening;
void (null as MissingGenericArgument | null);
void (null as ExcessGenericArgument | null);
void (null as NullDecisionRecordId | null);
void (null as UndefinedDecisionRecordId | null);
void (null as NullableDecisionRecordId | null);
void (null as OptionalDecisionRecordId | null);
void (null as StringIdCodec | null);
void (null as NumberIdCodec | null);
void (null as BooleanIdCodec | null);
void (null as SymbolIdCodec | null);
void (null as BigintIdCodec | null);
void (null as ObjectIdCodec | null);
void (null as CallerOwnedObjectIdCodec | null);
void (null as LegacyDecisionRecordKeyCodec | null);
void (null as ModernDecisionRecordKeyCodec | null);
void codecOwnsNoForbiddenFields;
void extraFieldAttack;
