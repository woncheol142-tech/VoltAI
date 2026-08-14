export type ApplicabilityStatus =
  "applicable" | "not-applicable" | "undetermined";

export type RequirementApplicability<TRequirementRef, TContextRef> = {
  requirement: TRequirementRef;
  context: TContextRef;
  status: ApplicabilityStatus;
};

export type ConflictStatus = "conflict" | "no-conflict" | "undetermined";

export type RequirementConflict<TRequirementRef, TContextRef> = {
  members: readonly [TRequirementRef, TRequirementRef];
  context: TContextRef;
  status: ConflictStatus;
};
