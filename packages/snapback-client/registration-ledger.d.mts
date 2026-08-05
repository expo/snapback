// Typed surface for the LLP 0166 registration ledger. Product callers use
// SnapbackClient.registerQuery; this module exposes the closed machinery to
// package-owned producers and tests.

export declare const QUERY_REGISTRATION_FORMAT_V1: 'snapback.query-registration.v1';
export declare const DURABLE_REGISTRATION_RECORD_CEILING: number;
export declare const DURABLE_REGISTRATION_BYTE_CEILING: number;
export declare const ESTABLISHMENT_CONCURRENCY: number;

export interface QueryRegistrationV1 {
  format: typeof QUERY_REGISTRATION_FORMAT_V1;
  registrationId: string;
  source: 'active' | 'preload' | 'programmatic';
  ownerContext:
    | { kind: 'subscription'; contextId: string }
    | { kind: 'route'; routeId: string }
    | { kind: 'api'; label: string | null };
  functionReference: Readonly<Record<string, unknown>>;
  canonicalArgs: unknown;
  requestedScope:
    | { kind: 'page'; input: Readonly<Record<string, unknown>> }
    | { kind: 'page-set'; from: 'first'; through: 'terminal' };
  retentionRequest: 'none' | 'durable';
  idleTtlClass: 'none' | 'default' | 'pinned';
}

export declare function prepareQueryRegistrationV1(value: unknown): QueryRegistrationV1;

export declare function derivePreloadQueryRegistrationsV1(
  payload: Readonly<Record<string, unknown>>,
  options: {
    readonly authorityPartitionDigest: `sha256:${string}`;
    readonly bootId: string;
    readonly functionReferences?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null;
    readonly entryFunctionReferences?: readonly (Readonly<Record<string, unknown>> | null)[] | null;
    readonly persist?: boolean;
  },
): Readonly<{
  manifestRevision: string;
  registrations: readonly QueryRegistrationV1[];
}>;

export interface RegistrationLedger {
  applyContextDemands(input: {
    contextId: string;
    authorityPartitionDigest: string;
    revision: number;
    demands: readonly unknown[];
  }): unknown;
  replacePreloadManifest(input: {
    manifestRevision: string;
    registrations: readonly QueryRegistrationV1[];
  }):
    | { committed: true; added: number; retired: number; duplicate: boolean }
    | { refused: { code: string } };
  releaseContextDemands(input: unknown): unknown;
  registerDurable(input: unknown): unknown | Promise<unknown>;
  releaseDurable(input: { registrationId: string }): unknown | Promise<unknown>;
  effectivePolicy(addressKey: string): unknown;
  demandState(addressKey: string): unknown;
  resolveRegistration(registration: unknown): Readonly<Record<string, unknown>>;
  publishLiveRegistrationAnswer(input: {
    registrationId: string;
    rows: readonly Readonly<Record<string, unknown>>[];
    version: number;
    subscriptionId: string;
    materialization: Readonly<Record<string, unknown>>;
  }): boolean;
  clearLiveRegistrationAnswer(registrationId: string): boolean;
  awaitHydrationIdle?(): Promise<void>;
  [key: string]: unknown;
}

export declare function createRegistrationLedger(options: {
  [key: string]: unknown;
}): Promise<RegistrationLedger>;

export declare function installRegistrationLedger(ledger: RegistrationLedger): void;

export declare const applyContextDemands: RegistrationLedger['applyContextDemands'];
export declare const releaseContextDemands: RegistrationLedger['releaseContextDemands'];
export declare const registerDurable: RegistrationLedger['registerDurable'];
export declare const releaseDurable: RegistrationLedger['releaseDurable'];
export declare const effectivePolicy: RegistrationLedger['effectivePolicy'];
export declare const demandState: RegistrationLedger['demandState'];
