// Typed surface for the LLP 0166 §D4 answer table derivations. The runtime
// module is the authority; these declarations mirror its closed vocabularies.

export type LocalAnswerClassV1 =
  | 'authoritative'
  | 'lease-authorized-retained'
  | 'labeled-retained'
  | 'unknown'
  | 'refused';

export declare const LOCAL_ANSWER_CLASSES_V1: readonly LocalAnswerClassV1[];

export interface LocalAnswerV1 {
  readonly answerClass: LocalAnswerClassV1;
  readonly freshness: 'current' | 'retained' | null;
  readonly storeMutation: string;
  readonly resumeAction: string;
}

export interface Qmk1AnswerInputV1 {
  completenessStatus?: string;
  freshness?: string | null;
  renderable?: boolean;
  connected: boolean;
  integrity?: 'valid' | 'invalid';
  activation?: 'current' | 'mismatch';
  lease?: 'valid' | 'invalid';
  witness?: 'valid' | 'invalid' | 'newer-epoch';
  scope?: 'current' | 'superseded';
}

export declare function deriveQmk1AnswerV1(input?: Qmk1AnswerInputV1): LocalAnswerV1;

export interface LegacyResumeAnswerInputV1 {
  connected: boolean;
  verified?: boolean;
  outboxPending?: boolean;
  tokenExpired?: boolean;
  clearRetained?: boolean;
}

export declare function deriveLegacyResumeAnswerV1(
  input?: LegacyResumeAnswerInputV1,
): LocalAnswerV1;

export interface LegacyLeaseOwnerFactsV1 {
  protectedRetainable?: boolean;
  identityWitnessMatch?: boolean;
  completeLeaseCustody?: boolean;
  beforeDeadline?: boolean;
  clockMonotone?: boolean;
  cursorTargetValid?: boolean;
  blockingFence?: boolean;
}

export interface LegacyLeaseAnswerInputV1 {
  connected: boolean;
  ownerFacts?: LegacyLeaseOwnerFactsV1;
}

export declare function deriveLegacyLeaseAnswerV1(
  input?: LegacyLeaseAnswerInputV1,
): LocalAnswerV1;

export type LocalAnswerInputV1 =
  | ({ family: 'qmk1' } & Qmk1AnswerInputV1)
  | ({ family: 'legacy-resume' } & LegacyResumeAnswerInputV1)
  | ({ family: 'legacy-lease' } & LegacyLeaseAnswerInputV1);

export declare function deriveLocalAnswerV1(input: LocalAnswerInputV1): LocalAnswerV1;
