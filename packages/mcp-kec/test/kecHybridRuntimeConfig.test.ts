import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readKecHybridRuntimeConfig,
  type KecHybridRuntimeEnvironment,
} from "../src/runtime/hybridRuntimeConfig.js";

const semanticName = "KEC_HYBRID_SEMANTIC_WEIGHT";
const lexicalName = "KEC_HYBRID_LEXICAL_WEIGHT";
const errorPrefix = "INVALID_HYBRID_RUNTIME_CONFIG:";

function environment(
  semanticWeight: unknown,
  lexicalWeight: unknown,
): KecHybridRuntimeEnvironment {
  return {
    [semanticName]: semanticWeight,
    [lexicalName]: lexicalWeight,
  } as unknown as KecHybridRuntimeEnvironment;
}

function captureConfigError(
  value: KecHybridRuntimeEnvironment,
  expectedReason: string,
): string {
  let thrown: unknown;

  try {
    readKecHybridRuntimeConfig(value);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  const message = (thrown as Error).message;
  expect(message.startsWith(errorPrefix)).toBe(true);
  expect(message).toContain(expectedReason);
  return message;
}

describe("explicit KEC hybrid runtime configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["1", "1", 1, 1],
    ["0", "1", 0, 1],
    ["1", "0", 1, 0],
    ["0.7", "0.3", 0.7, 0.3],
    ["2", "1", 2, 1],
  ])(
    "parses semantic=%s and lexical=%s without normalization",
    (semantic, lexical, expectedSemantic, expectedLexical) => {
      expect(
        readKecHybridRuntimeConfig(environment(semantic, lexical)),
      ).toEqual({
        rankingOptions: {
          semanticWeight: expectedSemantic,
          lexicalWeight: expectedLexical,
        },
      });
    },
  );

  it("returns equal, independently allocated configurations", () => {
    const input = Object.freeze(environment("0.7", "0.3"));
    const first = readKecHybridRuntimeConfig(input);
    const second = readKecHybridRuntimeConfig(input);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.rankingOptions).not.toBe(second.rankingOptions);
    expect(input).toEqual(environment("0.7", "0.3"));
  });

  it.each([
    [{}, semanticName],
    [{ [lexicalName]: "1" }, semanticName],
    [{ [semanticName]: "1" }, lexicalName],
    [environment("", "1"), semanticName],
    [environment("1", ""), lexicalName],
    [environment("   ", "1"), semanticName],
    [environment(" 1", "1"), semanticName],
    [environment("1 ", "1"), semanticName],
    [environment("+1", "1"), semanticName],
    [environment("-0", "1"), semanticName],
    [environment("-1", "1"), semanticName],
    [environment("NaN", "1"), semanticName],
    [environment("Infinity", "1"), semanticName],
    [environment("-Infinity", "1"), semanticName],
    [environment("0x10", "1"), semanticName],
    [environment("1_000", "1"), semanticName],
    [environment("50%", "1"), semanticName],
    [environment(".", "1"), semanticName],
    [environment("1.", "1"), semanticName],
    [environment(".5", "1"), semanticName],
    [environment("1.2.3", "1"), semanticName],
    [environment("1e309", "1"), semanticName],
    [environment(undefined, "1"), semanticName],
    [environment(null, "1"), semanticName],
    [environment(1, "1"), semanticName],
    [environment(true, "1"), semanticName],
    [environment(Symbol("weight"), "1"), semanticName],
  ] satisfies ReadonlyArray<readonly [KecHybridRuntimeEnvironment, string]>)(
    "rejects invalid configuration %# deterministically",
    (input, field) => {
      captureConfigError(input, field);
    },
  );

  it("rejects zero total weight with a stable rule error", () => {
    const first = captureConfigError(environment("0", "0"), "positive");
    const second = captureConfigError(environment("0", "0"), "positive");

    expect(first).toBe(second);
  });

  it("reports semantic errors before lexical errors", () => {
    const message = captureConfigError(
      environment("bad-semantic", "bad-lexical"),
      semanticName,
    );

    expect(message).not.toContain("bad-semantic");
    expect(message).not.toContain("bad-lexical");
  });

  it("reads only approved names without enumerating unrelated secrets", () => {
    const secretKey = "do-not-read-api-key-7a308";
    const touched: PropertyKey[] = [];
    const target = {
      [semanticName]: "0.7",
      [lexicalName]: "0.3",
      OPENAI_API_KEY: secretKey,
    };
    const input = new Proxy(target, {
      get(current, property, receiver) {
        touched.push(property);
        return Reflect.get(current, property, receiver);
      },
      getOwnPropertyDescriptor(current, property) {
        touched.push(property);
        return Reflect.getOwnPropertyDescriptor(current, property);
      },
      ownKeys() {
        throw new Error("environment enumeration is forbidden");
      },
    }) as KecHybridRuntimeEnvironment;

    expect(readKecHybridRuntimeConfig(input)).toEqual({
      rankingOptions: { semanticWeight: 0.7, lexicalWeight: 0.3 },
    });
    expect(touched.length).toBeGreaterThanOrEqual(2);
    expect(
      touched.every((key) => key === semanticName || key === lexicalName),
    ).toBe(true);
    expect(touched).toContain(semanticName);
    expect(touched).toContain(lexicalName);
    expect(touched).not.toContain("OPENAI_API_KEY");
  });

  it("does not reveal hostile values or dump the environment", () => {
    const secretWeight = "do-not-leak-weight-4f827";
    const secretKey = "do-not-leak-api-key-8b193";
    const touched: PropertyKey[] = [];
    const target = {
      [semanticName]: secretWeight,
      [lexicalName]: "1",
      OPENAI_API_KEY: secretKey,
    };
    const input = new Proxy(target, {
      get(current, property, receiver) {
        touched.push(property);
        return Reflect.get(current, property, receiver);
      },
      getOwnPropertyDescriptor(current, property) {
        touched.push(property);
        return Reflect.getOwnPropertyDescriptor(current, property);
      },
      ownKeys() {
        throw new Error("environment enumeration is forbidden");
      },
    }) as KecHybridRuntimeEnvironment;

    const message = captureConfigError(input, semanticName);

    expect(message).not.toContain(secretWeight);
    expect(message).not.toContain(secretKey);
    expect(touched.length).toBeGreaterThan(0);
    expect(
      touched.every((key) => key === semanticName || key === lexicalName),
    ).toBe(true);
    expect(touched).not.toContain("OPENAI_API_KEY");
  });

  it("rejects inherited weights and does not execute accessors", () => {
    let getterCalls = 0;
    const inherited = Object.create({ [semanticName]: "1" }) as Record<
      string,
      unknown
    >;
    Object.defineProperty(inherited, lexicalName, {
      configurable: true,
      enumerable: true,
      value: "1",
    });
    captureConfigError(inherited as KecHybridRuntimeEnvironment, semanticName);

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, semanticName, {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "1";
      },
    });
    Object.defineProperty(accessor, lexicalName, {
      configurable: true,
      enumerable: true,
      value: "1",
    });
    captureConfigError(accessor as KecHybridRuntimeEnvironment, semanticName);

    expect(getterCalls).toBe(0);
  });

  it("does not coerce hostile runtime values", () => {
    let coercionCalls = 0;
    const hostile = {
      toString: () => {
        coercionCalls += 1;
        throw new Error("toString executed");
      },
      valueOf: () => {
        coercionCalls += 1;
        throw new Error("valueOf executed");
      },
    };

    captureConfigError(environment(hostile, "1"), semanticName);

    expect(coercionCalls).toBe(0);
  });

  it("uses only the explicit environment object and performs no network call", () => {
    vi.stubEnv(semanticName, "99");
    vi.stubEnv(lexicalName, "98");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(readKecHybridRuntimeConfig(environment("1", "0"))).toEqual({
      rankingOptions: { semanticWeight: 1, lexicalWeight: 0 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
