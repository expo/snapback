import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { type ClientSnapshot, type Operation, type Op, type QueryResource, type ResourceSnapshot, type SnapbackClient } from './client.js';

const ClientContext = createContext<SnapbackClient | null>(null);

export function SnapbackProvider({ client, children }: { client: SnapbackClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): SnapbackClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('Wrap this component in <SnapbackProvider client={client}>.');
  return client;
}

export function useClientState(): ClientSnapshot {
  const client = useClient();
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}

export function useResource<T>(resource: QueryResource<T>): ResourceSnapshot<T> {
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
}

// @ref LLP 2000#5-ownership-before-abstraction — the React arm renders the headless
// external store; it owns no parallel cache, retries, or optimistic side effects.
export function useQuery<A, T>(op: Op<A, T, any>, args: A): ResourceSnapshot<T>;
export function useQuery<T = unknown>(op: string, args?: Record<string, unknown>): ResourceSnapshot<T>;
export function useQuery<T>(op: string | Op<any, T, any>, args: any = {}): ResourceSnapshot<T> {
  const client = useClient();
  // watch canonicalizes and shares by value. Merely rendering acquires no live
  // demand, so abandoned renders and Strict Mode do not create subscriptions.
  return useResource(client.watch<T>(typeof op === 'string' ? op : op.op, args));
}

export function useMutation<A, T>(op: Op<A, T, any>): (args: A) => Operation<T>;
export function useMutation<T = unknown>(op: string): (args?: Record<string, unknown>) => Operation<T>;
export function useMutation<T>(op: string | Op<any, T, any>): (args?: any) => Operation<T> {
  const client = useClient(), name = typeof op === 'string' ? op : op.op;
  return useCallback((args: any = {}) => client.mutate<T>(name, args), [client, name]);
}

export function useOperation<T>(operation: Operation<T>): ReturnType<Operation<T>['getSnapshot']> {
  return useSyncExternalStore(operation.subscribe, operation.getSnapshot, operation.getSnapshot);
}
