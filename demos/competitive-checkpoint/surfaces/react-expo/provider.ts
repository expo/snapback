import { Platform } from 'react-native';

import type { SnapbackReactProvider } from '@expo/snapback-react';

import { api, SnapbackClient } from './generated/runtime.mjs';

type ApiName = Exclude<keyof typeof api, 'ephemeral'>;
type ApiReference = (typeof api)[ApiName];
type Delivery = { kind: 'authoritative' | 'connection' | 'error'; error?: unknown };
type LiveHandle<Row> = { rows: Row[]; connection: string; dispose(): void };
type CheckpointClient = {
  liveQuery<Row>(ref: unknown, options: {
    args: Record<string, unknown>;
    userId?: string;
    transport: 'stream';
    fallbackToPoll: false;
    connectionId: string;
    onUpdate(rows: Row[]): void;
    onConnectionChange(connection: string, detail: { error?: unknown }): void;
  }): Promise<LiveHandle<Row>>;
  mutate(ref: unknown, options: { args: Record<string, unknown>; userId?: string }): Promise<{ result: unknown }>;
  action(ref: unknown, options: { args: Record<string, unknown>; userId?: string }): Promise<{
    ok: boolean;
    result: unknown;
    diagnostic?: { message?: string };
  }>;
};

export type CheckpointProvider = SnapbackReactProvider & {
  action<Result>(reference: ApiReference, args: Record<string, unknown>, userId: string): Promise<Result>;
};

const defaultHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? `http://${defaultHost}:4425`;
const client = new SnapbackClient(origin) as unknown as CheckpointClient;
let connectionSequence = 0;

// @ref LLP 0074#priority-7-reactexpo-adoption-and-contract-depth — web and
// Expo consume the same generated references and external-store lifecycle.
// The native carrier is Online-class only; it does not claim local execution.
export const checkpointProvider: CheckpointProvider = {
  backend: `snapback-checkpoint-${Platform.OS}`,
  externalStoreProtocol: 'snapback.external-store.v1',
  async subscribe<Row>(
    name: string,
    args: Record<string, unknown>,
    userId: string | undefined,
    observer: (rows: Row[], connection: any, delivery?: Delivery) => void,
  ) {
    const ref = api[name as ApiName];
    if (!ref || ref === api.ephemeral) throw new Error(`unknown generated query ${name}`);
    let rows: Row[] = [];
    const handle = await client.liveQuery<Row>(ref, {
      args,
      userId,
      transport: 'stream',
      fallbackToPoll: false,
      connectionId: `checkpoint_${Platform.OS}_${connectionSequence += 1}`,
      onUpdate(next: Row[]) {
        rows = [...next];
        observer(rows, 'live', { kind: 'authoritative' });
      },
      onConnectionChange(connection: string, detail: { error?: unknown }) {
        observer(
          rows,
          connection,
          detail?.error ? { kind: 'error', error: detail.error } : { kind: 'connection' },
        );
      },
    });
    rows = [...handle.rows];
    observer(rows, handle.connection, { kind: 'authoritative' });
    return { rows, dispose: () => handle.dispose() };
  },
  async mutate<Result>(name: string, args: Record<string, unknown>, userId: string | undefined) {
    const ref = api[name as ApiName];
    if (!ref || ref === api.ephemeral) throw new Error(`unknown generated mutation ${name}`);
    const result = await client.mutate(ref, { args, userId });
    return result.result as Result;
  },
  async action<Result>(reference: ApiReference, args: Record<string, unknown>, userId: string) {
    const result = await client.action(reference, { args, userId });
    if (!result.ok) throw Object.assign(new Error(result.diagnostic?.message ?? `${reference.name} failed`), result);
    return result.result as Result;
  },
};

export const deterministicStreamOrigin = process.env.EXPO_PUBLIC_STREAM_ORIGIN ?? origin;
