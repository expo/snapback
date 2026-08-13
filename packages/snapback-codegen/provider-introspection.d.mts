// Type declarations for provider-introspection.mjs — the provider-native
// neutral declaration (provider-introspection.v1), its ContractDataManifest
// projection, adapter handshakes, and the generated binding-type loop.

import type { ResultContractDescriptor } from './result-contracts.mjs';

export const PROVIDER_INTROSPECTION_SCHEMA_VERSION: 'provider-introspection.v1';
export const PROVIDER_ADAPTER_HANDSHAKE_VERSION: 'provider-adapter-handshake.v1';
export const PROVIDER_BINDING_METADATA_SCHEMA_VERSION: 'provider-binding-metadata.v1';
export const CONTRACT_DATA_MANIFEST_VERSION: 2;

/** The closed v1 data-type descriptor vocabulary. */
export type ProviderDataType =
  | Readonly<{ shape: 'unknown'; optional?: boolean }>
  | Readonly<{
      shape: 'primitive';
      name: 'string' | 'number' | 'boolean' | 'unknown';
      minimum?: number;
      maximum?: number;
      optional?: boolean;
    }>
  | Readonly<{ shape: 'object'; fields: Readonly<Record<string, ProviderDataType>>; optional?: boolean }>
  | Readonly<{ shape: 'literal'; value: string | number | boolean | null; optional?: boolean }>
  | Readonly<{
      shape: 'array';
      items: ProviderDataType;
      minItems?: number;
      maxItems?: number;
      optional?: boolean;
    }>
  | Readonly<{ shape: 'union'; variants: readonly ProviderDataType[]; optional?: boolean }>;

export type ProviderResultDescriptor =
  | Readonly<{ kind: 'list'; row: ProviderDataType; minItems?: number; maxItems?: number }>
  | Readonly<{ kind: 'single'; value: ProviderDataType; nullable: boolean }>
  | Readonly<{ kind: 'scalar'; value: ProviderDataType }>;

export interface ProviderOperationArguments {
  readonly fields: Readonly<Record<string, ProviderDataType>>;
  readonly order: readonly string[];
}

export interface ProviderOperationExecution {
  readonly serverRunnable: boolean;
  readonly localRunnable: boolean;
}

export type ProviderDeliveryMode = 'snapshot' | 'live' | 'poll' | 'reconcile-on-mutate';
export type ProviderTransportKind = 'request' | 'push' | 'poll' | 'reconcile-on-mutate';

export interface ProviderTransport {
  readonly kind: ProviderTransportKind;
  readonly role: 'primary' | 'fallback';
  readonly cadenceMs?: number;
}

export interface ProviderDelivery {
  readonly mode: ProviderDeliveryMode;
  readonly initialSnapshot: boolean;
  readonly defaultLive: boolean;
  readonly transports: readonly ProviderTransport[];
}

/** The `snapback.result-contract.v1` operation contract witness. */
export interface ProviderContractWitness {
  readonly revision: 'snapback.result-contract.v1';
  readonly implementationHash: string;
  readonly argumentsHash: string;
  readonly resultHash: string;
  readonly result: ResultContractDescriptor;
}

export interface ProviderQueryOperation {
  readonly name: string;
  readonly arguments: ProviderOperationArguments;
  readonly result: ProviderResultDescriptor;
  readonly execution: ProviderOperationExecution;
  readonly dependencies: Readonly<{ reads: readonly string[] }>;
  readonly delivery: ProviderDelivery;
  readonly retainable?: boolean;
  readonly contract?: ProviderContractWitness;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface ProviderMutationOperation {
  readonly name: string;
  readonly arguments: ProviderOperationArguments;
  readonly execution: ProviderOperationExecution;
  readonly effects: Readonly<{ writes: readonly string[]; invalidates: readonly string[] }>;
  readonly optimistic: Readonly<{
    supported: boolean;
    source: 'none' | 'provider-plan' | 'consumer';
  }>;
  readonly contract?: ProviderContractWitness;
  readonly extensions?: Readonly<{
    snapback?: Readonly<{
      contractPlan?: unknown;
      atomicOptimisticWithholding?: true;
    }>;
    [extension: string]: unknown;
  }>;
}

export interface ProviderActionOperation {
  readonly name: string;
  readonly arguments: ProviderOperationArguments;
  readonly execution: ProviderOperationExecution;
  readonly effects: Readonly<{ writes: readonly string[] }>;
  readonly contract?: ProviderContractWitness;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface ProviderEphemeralChannel {
  readonly keyMode?: string;
  readonly scopeFields?: readonly string[];
  readonly routingFields?: readonly string[];
  readonly defaultTtlMs?: number;
  readonly maxTtlMs?: number;
  readonly withdrawalVisibilityDeadlineMs?: number;
  readonly deliveryMode?: string;
  readonly maxDeltaRateHz?: number;
  readonly coalesce?: boolean;
  readonly publish?: Readonly<{ sustainedHz: number; burst: number; maxValueBytes: number }>;
}

export interface ProviderEphemeralOperation {
  readonly name: string;
  readonly arguments: ProviderOperationArguments;
  readonly result: ProviderResultDescriptor;
  readonly execution: ProviderOperationExecution;
  readonly delivery: ProviderDelivery;
  readonly channel: ProviderEphemeralChannel;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** The neutral `provider-introspection.v1` artifact. */
export interface ProviderIntrospection {
  readonly artifactKind: 'providerIntrospection';
  readonly schemaVersion: 'provider-introspection.v1';
  readonly provider: Readonly<{ id: string; version: string }>;
  readonly source: Readonly<{
    inputsHash: string;
    schemaHash?: string;
    implementationHash?: string;
    authoredSourceHash?: string;
  }>;
  readonly capabilities: Readonly<{
    claims: Readonly<Record<string, boolean>>;
    receipts: Readonly<{ mutation: boolean; subscription: boolean }>;
  }>;
  readonly operations: Readonly<{
    queries: readonly ProviderQueryOperation[];
    mutations: readonly ProviderMutationOperation[];
    actions: readonly ProviderActionOperation[];
    ephemeral: readonly ProviderEphemeralOperation[];
  }>;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface ProviderIntrospectionDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly subsystem: 'contract';
  readonly message: string;
  readonly problems?: readonly string[];
  readonly path?: string;
  readonly schema?: string;
  readonly received?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** One Snapback-native binding record as the producer observes it. */
export interface SnapbackOperationBinding {
  readonly args?: Readonly<Record<string, ProviderDataType>>;
  readonly argOrder?: readonly string[];
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly invalidates?: readonly string[];
  readonly result?: ProviderResultDescriptor;
  readonly serverRunnable?: boolean;
  readonly localRunnable?: boolean;
  readonly retainable?: boolean;
  readonly optimistic?: boolean;
  readonly atomicOptimisticWithholding?: true;
  readonly ephemeral?: boolean;
  readonly mode?: string;
  readonly livePush?: boolean;
  readonly initialSnapshot?: boolean;
  readonly defaultLive?: boolean;
  readonly pollCadenceMs?: number;
  readonly plan?: unknown;
  readonly implementationHash?: string;
  readonly argsHash?: string;
  readonly resultHash?: string;
  readonly resultContract?: ResultContractDescriptor;
  readonly [fact: string]: unknown;
}

export interface SnapbackEphemeralSection {
  readonly keyMode?: string;
  readonly scopeFields?: readonly string[];
  readonly routingFields?: readonly string[];
  readonly defaultTtlMs?: number;
  readonly maxTtlMs?: number;
  readonly withdrawalVisibilityDeadlineMs?: number;
  readonly deliveryMode?: string;
  readonly maxDeltaRateHz?: number;
  readonly coalesce?: boolean;
  readonly publishBudget?: Readonly<{ sustainedHz: number; burst: number; maxValueBytes: number }>;
  readonly [fact: string]: unknown;
}

/**
 * Deterministically derives the neutral declaration from Snapback's native
 * codegen facts (recursively sorted keys; operations sorted by name).
 */
export function createSnapbackProviderIntrospection(options: Readonly<{
  artifactVersion: string;
  inputsHash: string;
  schemaHash?: string;
  bundleHash?: string;
  authoredSourceHash?: string;
  capabilities: Readonly<Record<string, boolean>>;
  receipts: 'none' | 'mutation' | 'mutation+subscription';
  queries: Readonly<Record<string, SnapbackOperationBinding>>;
  mutations: Readonly<Record<string, SnapbackOperationBinding>>;
  actions?: Readonly<Record<string, SnapbackOperationBinding>>;
  ephemeral?: Readonly<Record<string, SnapbackEphemeralSection>>;
}>): ProviderIntrospection;

/** Exact's ContractDataManifest v2 as projected from the neutral declaration. */
export interface ContractDataManifest {
  readonly artifactKind: 'contractDataManifest';
  readonly schemaVersion?: string;
  readonly manifestVersion: 2;
  readonly provider?: string;
  readonly inputsHash?: string;
  readonly schemaHash?: string;
  readonly bundleHash?: string;
  readonly authoredSourceHash?: string;
  readonly capabilities?: Readonly<Record<string, boolean>>;
  readonly receipts: 'none' | 'mutation' | 'mutation+subscription';
  readonly queries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly mutations: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly ephemeral: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export function projectContractDataManifest(
  introspection: ProviderIntrospection,
): ContractDataManifest;

/** Schema/invariant validation; empty for a valid declaration. */
export function validateProviderIntrospection(
  introspection: unknown,
): ProviderIntrospectionDiagnostic[];

/** Emit-both migration guard: expected projection vs the independently built manifest. */
export function validateContractDataManifestProjection(
  introspection: ProviderIntrospection,
  actual: unknown,
): ProviderIntrospectionDiagnostic[];

export function serializeProviderIntrospection(introspection: ProviderIntrospection): string;

export interface ProviderAdapterHandshake {
  readonly handshakeVersion: 'provider-adapter-handshake.v1';
  readonly adapter: string;
  readonly supportedIntrospectionVersions: readonly string[];
  readonly supportedProviderVersions: Readonly<Record<string, readonly string[]>>;
  readonly requiredCapabilities?: readonly string[];
  readonly expectedSource?: Readonly<{
    inputsHash?: string;
    schemaHash?: string;
    implementationHash?: string;
  }>;
}

export function validateProviderAdapterHandshake(
  introspection: unknown,
  handshake: ProviderAdapterHandshake | unknown,
): ProviderIntrospectionDiagnostic[];

/** Throws (with `.code`/`.diagnostic`) on incompatibility; returns the introspection. */
export function assertProviderAdapterHandshake(
  introspection: ProviderIntrospection,
  handshake: ProviderAdapterHandshake,
): ProviderIntrospection;

export interface ProviderQueryBindingMetadata {
  readonly name: string;
  readonly argumentsType: string;
  readonly resultType: string;
  readonly delivery: ProviderDelivery;
  readonly dependencies?: Readonly<{ reads: readonly string[] }>;
}

export interface ProviderMutationBindingMetadata {
  readonly name: string;
  readonly argumentsType: string;
  readonly resultType: string;
  readonly effects: Readonly<{ writes: readonly string[]; invalidates: readonly string[] }>;
  readonly optimistic: Readonly<{ supported: boolean; source: 'none' | 'provider-plan' | 'consumer' }>;
}

export interface ProviderActionBindingMetadata {
  readonly name: string;
  readonly argumentsType: string;
  readonly resultType: string;
  readonly effects: Readonly<{ writes: readonly string[] }>;
}

export interface ProviderBindingMetadata {
  readonly artifactKind: 'providerBindingMetadata';
  readonly schemaVersion: 'provider-binding-metadata.v1';
  readonly provider: Readonly<{ id: string; version: string }>;
  readonly source: Readonly<{ introspectionSchemaVersion: string; inputsHash: string }>;
  readonly bindings: Readonly<{
    queries: readonly ProviderQueryBindingMetadata[];
    mutations: readonly ProviderMutationBindingMetadata[];
    actions: readonly ProviderActionBindingMetadata[];
    ephemeral: readonly ProviderQueryBindingMetadata[];
  }>;
}

export type ProviderBindingMetadataResult =
  | Readonly<{
      ok: true;
      diagnostics: readonly ProviderIntrospectionDiagnostic[];
      metadata: ProviderBindingMetadata;
    }>
  | Readonly<{
      ok: false;
      diagnostics: readonly ProviderIntrospectionDiagnostic[];
      metadata: null;
    }>;

/**
 * Closes the generated type loop over the declaration. Explicit `unknown`
 * shapes stay consumable with a degraded warning; anything outside the v1
 * vocabulary fails with error diagnostics and no metadata.
 */
export function createProviderBindingMetadata(
  introspection: ProviderIntrospection,
): ProviderBindingMetadataResult;

export function validateProviderBindingTypeNames(
  introspection: unknown,
): ProviderIntrospectionDiagnostic[];

export function validateProviderResultShapeVocabulary(
  introspection: unknown,
): ProviderIntrospectionDiagnostic[];

export function serializeProviderBindingMetadata(metadata: ProviderBindingMetadata): string;

/** Renders the generated provider-bindings.d.ts module text. */
export function renderProviderBindingTypes(metadata: ProviderBindingMetadata): string;

/**
 * Detects Snapback binding fields the v1 producer does not yet map; a new
 * backend shape can never disappear silently during projection.
 */
export function validateSnapbackIntrospectionSource(source: Readonly<{
  queries: Readonly<Record<string, SnapbackOperationBinding>>;
  mutations: Readonly<Record<string, SnapbackOperationBinding>>;
  actions?: Readonly<Record<string, SnapbackOperationBinding>>;
  ephemeral?: Readonly<Record<string, SnapbackEphemeralSection>>;
}>): ProviderIntrospectionDiagnostic[];
