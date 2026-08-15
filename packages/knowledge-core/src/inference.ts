export type Inference<TClaimRef, TContextRef, TPremise> = {
  claim: TClaimRef;
  context: TContextRef;
  premises: readonly [TPremise, ...TPremise[]];
};
