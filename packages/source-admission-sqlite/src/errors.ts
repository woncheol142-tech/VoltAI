export type BindingStoreFailureCategory =
  "unavailable" | "transaction" | "corrupt";

export class BindingStoreFailure extends Error {
  readonly category: BindingStoreFailureCategory;

  constructor(
    category: BindingStoreFailureCategory,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BindingStoreFailure";
    this.category = category;
  }
}

export class BindingCorruptionFailure extends BindingStoreFailure {
  constructor(message: string) {
    super("corrupt", message);
    this.name = "BindingCorruptionFailure";
  }
}
