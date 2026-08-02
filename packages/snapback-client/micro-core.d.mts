export interface MicroGeneration {
  readonly schemaVersion: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly bundleHash: string;
  readonly inputsHash: string;
}

/** Internal linking key shared with the optional `./micro/live` module. */
export const MICRO_CORE_INTERNALS: unique symbol;

export interface MicroDiagnostic {
  readonly code: string;
  readonly severity: 'error';
  readonly subsystem: 'micro-client';
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface MicroCodedError extends Error {
  code: string;
  diagnostic: MicroDiagnostic;
  status?: number;
  receipt?: unknown;
}

export function microCodedError(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  cause?: unknown,
): MicroCodedError;

export function microIsObject(value: unknown): value is Record<string, unknown>;
export function microFiniteVersion(value: unknown): value is number;

export interface MicroAuthInput {
  readonly principal: string | null;
  readonly session_id: null;
  readonly user_id: string | null;
  readonly permissions: readonly never[];
}

export function microAuthInput(userId: string | null | undefined): MicroAuthInput;

export interface MicroRuntimeOptions {
  readonly endpoint: string;
  readonly expectedGeneration: MicroGeneration;
  readonly userId?: string | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly requireGenerationFacts?: boolean;
  readonly queryRetries?: number;
}

export interface MicroOperationDescriptor {
  readonly name: string;
  readonly kind: 'Query' | 'Mutation' | 'Action';
}

export interface MicroQueryOutput<Result> {
  readonly version: number;
  readonly rows: Result;
  readonly cursor?: string | null;
  readonly facts?: Readonly<{ activeGeneration: MicroGeneration }>;
}

export interface MicroMutationOutput<Result> {
  readonly version: number;
  readonly changed_count: number;
  readonly result: Result;
  readonly authorityDescriptor: Readonly<Record<string, unknown>>;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly facts?: Readonly<{ activeGeneration: MicroGeneration }>;
}

export interface MicroActionOutput<Result> {
  readonly ok: true;
  readonly result: Result;
  readonly facts?: Readonly<{ activeGeneration: MicroGeneration }>;
}

export interface MicroCoreRuntime {
  invoke(descriptor: MicroOperationDescriptor, args?: Readonly<Record<string, unknown>>): Promise<unknown>;
  setIdentity(userId: string | null): Promise<void>;
  dispose(): Promise<void>;
  readonly [MICRO_CORE_INTERNALS]: unknown;
}

export function createMicroCoreRuntime(options: MicroRuntimeOptions): MicroCoreRuntime;
