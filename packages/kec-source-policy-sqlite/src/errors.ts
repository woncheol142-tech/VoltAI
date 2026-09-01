export type SourceResolutionStoreFailureCategory =
  "unavailable" | "transaction" | "corrupt";

export class SourceResolutionStoreFailure extends Error {
  readonly category: SourceResolutionStoreFailureCategory;

  constructor(
    category: SourceResolutionStoreFailureCategory,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SourceResolutionStoreFailure";
    this.category = category;
  }
}

export class PolicyEpochSealedFailure extends Error {
  constructor(epoch: string) {
    super(`policy epoch is sealed: ${epoch}`);
    this.name = "PolicyEpochSealedFailure";
  }
}

export class PolicyRegistrationFailure extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "PolicyRegistrationFailure";
    this.reason = reason;
  }
}
