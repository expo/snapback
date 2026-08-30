import type { AnyOp, Op } from "./api.js";

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
  take?: number;
  site?: string;
};
export type QueryPartial<Result> = {
  state: "partial";
  data: Result;
  seq: number;
  take?: number;
  site?: string;
  reason?: string;
};
export type QueryDenied<Result> = {
  state: "denied";
  data: Result;
  seq: number;
  rule?: string;
  reason?: string;
};
export type QueryRefused = RefusalEnvelope & { state: "refused"; seq?: number; data?: never };
export type QueryResult<Result> =
  | QueryComplete<Result>
  | QueryCapped<Result>
  | QueryPartial<Result>
  | QueryDenied<Result>
  | QueryRefused;

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
export type MutationQueued = { state: "queued"; reason: string; position: number };
export type MutationResult<Result> = MutationCommitted<Result> | MutationRejected;
export type MutationView<Result> = MutationResult<Result> | MutationQueued;

export type LiveDelivery<Result> = { state: "live"; data: Result; seq: number };
export type PartialDelivery<Result> = {
  state: "partial";
  data: Result;
  seq: number;
  take?: number;
  site?: string;
  reason?: string;
};
export type StaleDelivery<Result> = {
  state: "stale";
  since: number;
  data?: Result;
  seq?: number;
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
export type ChannelPublishResult =
  | { ok: true }
  | ({ state: "refused" } & Partial<RefusalEnvelope> & { code: string });
export interface Channel<Payload = unknown> {
  publish(payload: Payload): Promise<ChannelPublishResult>;
  subscribe(callback: (event: ChannelEvent<Payload>) => void): Subscription<ChannelEvent<Payload>>;
}

export interface ManifestOperation { kind: string; args: unknown }
export interface Manifest {
  generation: number;
  ops: Record<string, ManifestOperation>;
  channels: unknown;
  auth: unknown;
}

export type ConnectionState = "connecting" | "live" | "stale" | "refused" | "closed";
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
  query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>>;
  mutation<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<MutationResult<Result>>;
  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>>;
  channel<Payload = unknown>(ref: AnyOp, args: unknown): Channel<Payload>;
  manifest(): Promise<Manifest>;
  subscribeStatus(callback: (snapshot: ClientSnapshot) => void): () => void;
  close(): void;
}

export type QueryViewState =
  | "hydrating"
  | "live"
  | "stale"
  | "partial"
  | "denied"
  | "refused"
  | "capped"
  | "complete";
export interface QueryView<Result> {
  state: QueryViewState;
  data: Result | undefined;
  seq: number | undefined;
  refusal: RefusalEnvelope | undefined;
}
export type QueryMachineEvent<Result> = QueryResult<Result> | SubscriptionDelivery<Result>;

export function initialQueryState<Result>(): QueryView<Result> {
  return { state: "hydrating", data: undefined, seq: undefined, refusal: undefined };
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
  const nextData = "data" in event && event.data !== undefined ? event.data : current.data;
  const data = canonical(nextData) === canonical(current.data) ? current.data : nextData;
  const refusal = event.state === "refused"
    ? {
        code: event.code,
        family: event.family ?? "owner",
        message: event.message ?? event.code,
        site: event.site,
        rule: event.rule,
        rewrite: event.rewrite,
        guide: event.guide,
      }
    : undefined;
  const seq = "seq" in event && event.seq !== undefined ? event.seq : current.seq;
  const next: QueryView<Result> = { state: event.state, data, seq, refusal };
  return current.state === next.state && current.data === next.data && current.seq === next.seq
    && canonical(current.refusal) === canonical(next.refusal)
    ? current
    : next;
}
