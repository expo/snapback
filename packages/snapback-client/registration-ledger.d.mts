// Typed surface for the LLP 0166 registration ledger (the OQ8 seam). The
// runtime module is the authority; these declarations mirror its record
// shapes without widening the internal seam into product API.

export declare const QUERY_REGISTRATION_FORMAT_V1: 'snapback.query-registration.v1';
export declare const DURABLE_REGISTRATION_RECORD_CEILING: number;
export declare const DURABLE_REGISTRATION_BYTE_CEILING: number;
export declare const ESTABLISHMENT_CONCURRENCY: number;

export interface QueryRegistrationV1 {
  format: typeof QUERY_REGISTRATION_FORMAT_V1;
  registrationId: string;
  address: readonly unknown[];
  authorityPartitionDigest: string;
  [key: string]: unknown;
}

export declare function prepareQueryRegistrationV1(value: unknown): QueryRegistrationV1;

export interface RegistrationLedger {
  applyContextDemands(input: {
    contextId: string;
    authorityPartitionDigest: string;
    revision: number;
    demands: readonly unknown[];
  }): unknown;
  releaseContextDemands(input: unknown): unknown;
  registerDurable(input: unknown): unknown | Promise<unknown>;
  releaseDurable(input: { registrationId: string }): unknown | Promise<unknown>;
  effectivePolicy(addressKey: string): unknown;
  demandState(addressKey: string): unknown;
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
