export type Evidence<
  TContent extends NonNullable<unknown>,
  TOrigin extends NonNullable<unknown>,
> = {
  readonly content: TContent;
  readonly origin: TOrigin;
};
