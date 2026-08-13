export const CLIENT_LIFECYCLE_MANIFEST_FILE: 'client-lifecycle.v1.json';
export const CLIENT_LIFECYCLE_MANIFEST_VERSION: 'snapback.client-lifecycle.v1';
export const CLIENT_REFERENCE_GUIDE: '/_snapback/guide/clients/headless.md#generated-reference-kinds-and-legal-verbs';
export const CLIENT_REFERENCE_KIND_MISMATCH_CODE: 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH';

export interface ClientCompatibilityAlias {
  readonly current: string;
  readonly plannedCanonical: string;
  readonly emittedInRollout1: false;
  readonly removalEpoch: 'declared-major-after-stage-2-measurement';
}
export const CLIENT_COMPATIBILITY_ALIASES: readonly ClientCompatibilityAlias[];

export type ClientReferenceKind = 'Query' | 'LiveQuery' | 'Mutation' | 'Action' | 'Command';
export interface ClientReferenceLifecycle {
  readonly kind: ClientReferenceKind;
  readonly runtimeDiscriminant: string;
  readonly acceptedBy: readonly string[];
  readonly correctVerb: string;
  readonly auth: string;
  readonly freshness: string;
  readonly retention: string;
  readonly stateCarrier: string;
  readonly guideAnchor: string;
}

export const CLIENT_REFERENCE_LIFECYCLES: readonly ClientReferenceLifecycle[];
export function lifecycleForReferenceKind(kind: ClientReferenceKind): ClientReferenceLifecycle;
export function buildClientLifecycleManifest(input: Readonly<{
  appId: string;
  inputsHash: string;
  authoredSourceHash: string;
  targetProfile: string;
  functions: readonly Readonly<Record<string, unknown>>[];
  commands?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}>): Readonly<Record<string, unknown>>;
export function renderReferenceJSDoc(
  reference: Readonly<{ kind: ClientReferenceKind; id?: string; name: string }>,
  manifest: Readonly<Record<string, any>>,
  authoringProfile?: 'snapback-explicit-v1' | 'snapback-familiar-ts-v1',
): string;
