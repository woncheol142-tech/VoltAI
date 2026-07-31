type KecHybridRuntimeEnvironmentName =
  "KEC_HYBRID_SEMANTIC_WEIGHT" | "KEC_HYBRID_LEXICAL_WEIGHT";

export type KecHybridRuntimeEnvironment = Readonly<
  Partial<Record<KecHybridRuntimeEnvironmentName, string | undefined>>
>;

export type KecHybridRuntimeConfig = Readonly<{
  rankingOptions: Readonly<{
    semanticWeight: number;
    lexicalWeight: number;
  }>;
}>;

const errorPrefix = "INVALID_HYBRID_RUNTIME_CONFIG:";
const decimalWeightPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function fail(reason: string): never {
  throw new Error(`${errorPrefix} ${reason}`);
}

function readOwnString(
  environment: KecHybridRuntimeEnvironment,
  name: KecHybridRuntimeEnvironmentName,
): string {
  if (environment === null || typeof environment !== "object") {
    fail("environment must be an object");
  }

  let descriptor: PropertyDescriptor | undefined;

  try {
    descriptor = Object.getOwnPropertyDescriptor(environment, name);
  } catch {
    fail(`${name} could not be read safely`);
  }

  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string"
  ) {
    fail(`${name} must be an own string data property`);
  }

  return descriptor.value;
}

function parseWeight(
  environment: KecHybridRuntimeEnvironment,
  name: KecHybridRuntimeEnvironmentName,
): number {
  const raw = readOwnString(environment, name);

  if (!decimalWeightPattern.test(raw)) {
    fail(`${name} must be a finite non-negative decimal string`);
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`${name} must be a finite non-negative decimal string`);
  }

  return parsed;
}

export function readKecHybridRuntimeConfig(
  environment: KecHybridRuntimeEnvironment,
): KecHybridRuntimeConfig {
  const semanticWeight = parseWeight(environment, "KEC_HYBRID_SEMANTIC_WEIGHT");
  const lexicalWeight = parseWeight(environment, "KEC_HYBRID_LEXICAL_WEIGHT");

  if (semanticWeight === 0 && lexicalWeight === 0) {
    fail("at least one weight must be positive");
  }

  return {
    rankingOptions: {
      semanticWeight,
      lexicalWeight,
    },
  };
}
