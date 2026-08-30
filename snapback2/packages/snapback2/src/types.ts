import type { Channel as ChannelRef, Op } from "./api.js";

export interface RefusalEnvelope {
  code: string;
  family: string;
  message: string;
  site?: string;
  rule?: string;
  rewrite?: string;
  guide?: string;
}

export type QueryComplete<Result> = { state: "complete"; data: Result; seq: number };
export type QueryCapped<Result> = {
  state: "capped";
  data: Result;
  seq: number;
  take: number;
  site: string;
};
export type QueryPartial<Result> = {
  state: "partial";
  data?: Result;
  seq: number;
  reason: string;
};
export type QueryDenied = {
  state: "denied";
  seq: number;
  rule: string;
};
export type QueryResult<Result> =
  | QueryComplete<Result>
  | QueryCapped<Result>
  | QueryPartial<Result>
  | QueryDenied;

export type MutationCommitted<Result> = { state: "committed"; seq: number; data: Result };
export type MutationRejected = {
  state: "rejected";
  code: string;
  family: string;
  message: string;
  rewrite?: string;
  site?: string;
  rule?: string;
  guide?: string;
};
export type MutationResult<Result> = MutationCommitted<Result> | MutationRejected;

export type LiveDelivery<Result> = { state: "live"; data: Result; seq: number };
export type PartialDelivery<Result> = {
  state: "partial";
  data?: Result;
  seq: number;
  take?: number;
  site?: string;
  reason: string;
};
export type StaleDelivery<Result> = {
  state: "stale";
  since: number;
  data?: Result;
  seq: number;
};
export type RefusedDelivery = {
  state: "refused";
  code: string;
  family?: string;
  message?: string;
  site?: string;
  rule?: string;
  rewrite?: string;
  guide?: string;
  seq?: number;
};
export type SubscriptionDelivery<Result> =
  | LiveDelivery<Result>
  | PartialDelivery<Result>
  | StaleDelivery<Result>
  | RefusedDelivery;

export interface Subscription<Event> {
  close(): void;
  until(predicate: (event: Event) => boolean, timeoutMs?: number): Promise<Event>;
}

export interface AuthSession { token: string; viewer: string }
export interface AuthMe { viewer: string; kind: string }
export interface AuthApi {
  signup(input: { email: string; password: string }): Promise<AuthSession>;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  guest(): Promise<AuthSession>;
  logout(): Promise<{ ok: boolean }>;
  me(): Promise<AuthMe>;
}

export interface ChannelEvent<Payload = unknown> { from: string; payload: Payload; at: number }
export type ChannelDelivery<Payload = unknown> = ChannelEvent<Payload> | RefusedDelivery;
export type ChannelPublishResult =
  | { ok: true }
  | ({ state: "refused" } & Partial<RefusalEnvelope> & { code: string });
export interface ChannelHandle<Payload = unknown> {
  publish(payload: Payload): Promise<ChannelPublishResult>;
  subscribe(callback: (event: ChannelDelivery<Payload>) => void): Subscription<ChannelDelivery<Payload>>;
}

export interface ManifestOperation { kind: string; args: unknown }
export interface Manifest {
  generation: number;
  ops: Record<string, ManifestOperation>;
  channels: Record<string, unknown>;
  auth: Record<string, unknown>;
}

export type ConnectionState = "connected" | "reconnecting" | "offline";
export interface ClientSnapshot {
  token?: string;
  persona?: string;
  connection: ConnectionState;
  generation?: number;
  lastRefusal?: RefusalEnvelope;
}

export type PersistToken = (token: string | null) => void | Promise<void>;
export interface CreateClientOptions {
  url: string;
  token?: string;
  as?: string;
  fetch?: typeof globalThis.fetch;
  persist?: PersistToken;
}

export interface SnapbackClient {
  readonly auth: AuthApi;
  readonly snapshot: ClientSnapshot;
  query<Args, Result>(ref: Op<Args, Result>, args: NoInfer<Args>): Promise<QueryResult<Result>>;
  mutation<Args, Result>(ref: Op<Args, Result>, args: NoInfer<Args>): Promise<MutationResult<Result>>;
  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: NoInfer<Args>,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>>;
  channel<Args, Payload = unknown>(ref: ChannelRef<Args, Payload>, args: NoInfer<Args>): ChannelHandle<Payload>;
  manifest(): Promise<Manifest>;
  subscribeStatus(callback: (snapshot: ClientSnapshot) => void): () => void;
  close(): void;
}

export type QueryView<Result> =
  | { state: "complete"; data: Result; seq: number }
  | { state: "capped"; data: Result; seq: number; take: number; site: string }
  | { state: "partial"; data?: Result; seq: number; reason: string }
  | { state: "denied"; rule: string; seq: number }
  | { state: "refused"; refusal: RefusalEnvelope }
  | { state: "stale"; data?: Result; seq: number; since: number }
  | { state: "live"; data: Result; seq: number }
  | { state: "hydrating" };
export type QueryViewState = QueryView<unknown>["state"];
export type QueryHookResult<Result> = QueryView<Result> & { connection: ConnectionState };
export type QueryMachineEvent<Result> = QueryResult<Result> | SubscriptionDelivery<Result>;

export function initialQueryState<Result>(): QueryView<Result> {
  return { state: "hydrating" };
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function stableSerialize(value: unknown): string {
  return canonical(value);
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — React preserves data identity while exposing every receipt-backed state.
export function reduceQueryState<Result>(
  current: QueryView<Result>,
  event: QueryMachineEvent<Result>,
): QueryView<Result> {
  const eventData = "data" in event ? event.data : undefined;
  const currentData = "data" in current ? current.data : undefined;
  const data = canonical(eventData) === canonical(currentData) ? currentData : eventData;
  let next: QueryView<Result>;
  switch (event.state) {
    case "complete":
      next = { state: "complete", data: data as Result, seq: event.seq };
      break;
    case "capped":
      next = { state: "capped", data: data as Result, seq: event.seq, take: event.take, site: event.site };
      break;
    case "partial":
      next = data === undefined
        ? { state: "partial", seq: event.seq, reason: event.reason }
        : { state: "partial", data: data as Result, seq: event.seq, reason: event.reason };
      break;
    case "denied":
      next = { state: "denied", rule: event.rule, seq: event.seq };
      break;
    case "refused": {
      const refusal: RefusalEnvelope = {
        code: event.code,
        family: event.family ?? "owner",
        message: event.message ?? event.code,
      };
      if (event.site !== undefined) refusal.site = event.site;
      if (event.rule !== undefined) refusal.rule = event.rule;
      if (event.rewrite !== undefined) refusal.rewrite = event.rewrite;
      if (event.guide !== undefined) refusal.guide = event.guide;
      next = { state: "refused", refusal };
      break;
    }
    case "stale":
      next = data === undefined
        ? { state: "stale", seq: event.seq, since: event.since }
        : { state: "stale", data: data as Result, seq: event.seq, since: event.since };
      break;
    case "live":
      next = { state: "live", data: data as Result, seq: event.seq };
      break;
  }
  return canonical(current) === canonical(next) ? current : next;
}
