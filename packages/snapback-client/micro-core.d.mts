export interface MicroGeneration {
  readonly schemaVersion: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly bundleHash: string;
  readonly inputsHash: string;
}

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
}

export function createMicroCoreRuntime(options: MicroRuntimeOptions): MicroCoreRuntime;
