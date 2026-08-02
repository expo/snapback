import type { MicroCoreRuntime } from './micro-core.mjs';

export interface MicroLiveDescriptor {
  readonly name: string;
  readonly kind: 'LiveQuery';
}

export interface MicroLiveHandle<Result> {
  readonly rows: Result;
  readonly version: number;
  readonly subscriptionId: string | null;
  poll(): Promise<void>;
  resnapshot(): Promise<void>;
  dispose(): Promise<void>;
}

export interface MicroRuntime extends MicroCoreRuntime {
  subscribe(descriptor: MicroLiveDescriptor, args?: Readonly<Record<string, unknown>>, options?: {
    readonly onUpdate?: (rows: unknown, detail: Readonly<{ kind: string; version: number }>) => void;
  }): Promise<MicroLiveHandle<unknown>>;
}

export function withMicroLive(core: MicroCoreRuntime): MicroRuntime;
