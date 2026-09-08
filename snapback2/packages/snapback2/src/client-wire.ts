// @ref LLP 1002#4-the-wire — every owner response is validated before public client code observes it.
import type {
  AuthMe,
  AuthSession,
  ChannelEntry,
  ChannelWriteResult,
  Cursor,
  LiveQueryDelivery,
  Manifest,
  MutationResult,
  Principal,
  QueryRefusedDelivery,
  RefusalEnvelope,
  RefusedDelivery,
  ServerQueryResult,
} from "./types.js";

export function fallbackRefusal(code: string, message: string): RefusalEnvelope {
  return { code, family: "owner", message, guide: "owner/connect" };
}

const snapbackRefusalBrand = Symbol.for("snapback2.SnapbackRefusal");

export class SnapbackRefusal extends Error {
  readonly [snapbackRefusalBrand] = true;
  readonly envelope: RefusalEnvelope;
  readonly code: string;

  constructor(envelope: RefusalEnvelope, readonly retryable = false, readonly status?: number) {
    super(envelope.message);
    this.name = "SnapbackRefusal";
    this.envelope = envelope;
    this.code = envelope.code;
  }
}

export function isSnapbackRefusal(value: unknown): value is SnapbackRefusal {
  return typeof value === "object"
    && value !== null
    && (value as { name?: unknown }).name === "SnapbackRefusal"
    && (value as Record<symbol, unknown>)[snapbackRefusalBrand] === true;
}

export function wireShape(message: string): SnapbackRefusal {
  return new SnapbackRefusal({ code: "E_WIRE_SHAPE", family: "op", message, guide: "op/wire-shape" });
}

export function wireObject(value: unknown, surface: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw wireShape(`${surface} must be an object`);
  return value as Record<string, unknown>;
}

function has(record: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(record, field);
}

function present(record: Record<string, unknown>, field: string, surface: string): unknown {
  if (!has(record, field)) throw wireShape(`${surface} is missing ${field}`);
  return record[field];
}

function stringField(record: Record<string, unknown>, field: string, surface: string): string {
  const value = present(record, field, surface);
  if (typeof value !== "string" || value.length === 0) throw wireShape(`${surface}.${field} must be a non-empty string`);
  return value;
}

function numberField(record: Record<string, unknown>, field: string, surface: string): number {
  const value = present(record, field, surface);
  if (typeof value !== "number" || !Number.isFinite(value)) throw wireShape(`${surface}.${field} must be a number`);
  return value;
}

function optionalString(record: Record<string, unknown>, field: string, surface: string): string | undefined {
  if (!has(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== "string") throw wireShape(`${surface}.${field} must be a string`);
  return value;
}

function optionalNumber(record: Record<string, unknown>, field: string, surface: string): number | undefined {
  if (!has(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) throw wireShape(`${surface}.${field} must be a number`);
  return value;
}

function nullableString(record: Record<string, unknown>, field: string, surface: string): string | null {
  const value = present(record, field, surface);
  if (value !== null && typeof value !== "string") throw wireShape(`${surface}.${field} must be a string or null`);
  return value;
}

export function wireRefusalEnvelope(value: unknown, surface: string): RefusalEnvelope {
  const record = wireObject(value, surface);
  const envelope: RefusalEnvelope = {
    code: stringField(record, "code", surface),
    family: stringField(record, "family", surface),
    message: stringField(record, "message", surface),
    guide: stringField(record, "guide", surface),
  };
  for (const field of ["site", "rule", "rewrite", "reason", "op", "shape"] as const) {
    const item = optionalString(record, field, surface);
    if (item !== undefined) envelope[field] = item;
  }
  const which = optionalString(record, "which", surface);
  if (which !== undefined) envelope.which = which;
  const cap = optionalNumber(record, "cap", surface);
  if (cap !== undefined) envelope.cap = cap;
  return envelope;
}

export function copyRefusal(envelope: RefusalEnvelope): RefusalEnvelope {
  const refusal: RefusalEnvelope = {
    code: envelope.code, family: envelope.family, message: envelope.message, guide: envelope.guide,
  };
  if (envelope.site !== undefined) refusal.site = envelope.site;
  if (envelope.rule !== undefined) refusal.rule = envelope.rule;
  if (envelope.rewrite !== undefined) refusal.rewrite = envelope.rewrite;
  for (const field of ["reason", "op", "shape"] as const) if (envelope[field] !== undefined) refusal[field] = envelope[field];
  if (envelope.which !== undefined) refusal.which = envelope.which;
  if (envelope.cap !== undefined) refusal.cap = envelope.cap;
  return refusal;
}

export function isTerminalSession(envelope: Pick<RefusalEnvelope, "code" | "family">): boolean {
  return envelope.code === "E_AUTH_SESSION" && envelope.family === "auth";
}

export function wireQuery<Result>(value: unknown, surface = "query response"): ServerQueryResult<Result> {
  const record = wireObject(value, surface);
  switch (stringField(record, "state", surface)) {
    case "complete":
      return {
        state: "complete", data: present(record, "data", surface) as Result,
        seq: numberField(record, "seq", surface), next: nullableString(record, "next", surface) as Cursor | null,
      };
    case "capped":
      for (const field of ["site", "take", "reason"]) {
        if (has(record, field)) throw wireShape(`${surface}.capped must not carry ${field}`);
      }
      return {
        state: "capped", data: present(record, "data", surface) as Result,
        seq: numberField(record, "seq", surface), next: nullableString(record, "next", surface) as Cursor | null,
      };
    case "partial": {
      if (has(record, "next")) throw wireShape(`${surface}.partial must not carry next`);
      const partial = {
        state: "partial" as const,
        seq: numberField(record, "seq", surface),
        reason: stringField(record, "reason", surface),
      };
      return has(record, "data") ? { ...partial, data: record.data as Result } : partial;
    }
    case "denied":
      if (has(record, "next")) throw wireShape(`${surface}.denied must not carry next`);
      return { state: "denied", seq: numberField(record, "seq", surface), rule: stringField(record, "rule", surface) };
    default:
      throw wireShape(`${surface}.state must be complete, capped, partial, or denied`);
  }
}

export function wireMutation<Result>(value: unknown): MutationResult<Result> {
  const surface = "mutation response";
  const record = wireObject(value, surface);
  if (has(record, "next")) throw wireShape(`${surface} must not carry next`);
  switch (stringField(record, "state", surface)) {
    case "committed":
      return { state: "committed", data: present(record, "data", surface) as Result, seq: numberField(record, "seq", surface) };
    case "rejected":
      return { state: "rejected", ...wireRefusalEnvelope(record, "mutation rejected response") };
    default:
      throw wireShape(`${surface}.state must be committed or rejected`);
  }
}

export function wireSubscription<Result>(data: string, connected?: (value: boolean) => void): LiveQueryDelivery<Result> | QueryRefusedDelivery {
  const surface = "subscription delivery";
  const record = sseObject(data, surface);
  if (record.connected !== undefined && record.connected !== true) throw wireShape(`${surface}.connected must be true when present`);
  connected?.(record.connected === true);
  if (stringField(record, "state", surface) === "refused") {
    if (has(record, "next")) throw wireShape(`${surface}.refused must not carry next`);
    const refusal = wireRefusalEnvelope(record, `${surface} refusal`);
    const seq = optionalNumber(record, "seq", surface);
    return { state: "refused", live: false, ...refusal, ...(seq === undefined ? {} : { seq }) };
  }
  return { ...wireQuery<Result>(record, surface), live: true };
}

/** Private transport data. The lease must never reach a public snapshot. */
export type ChannelFrame<Value> = {
  state: "snapshot"; key: string; lease: string; entries: readonly ChannelEntry<Value>[];
} | RefusedDelivery;

export function wireChannelFrame<Value>(data: string): ChannelFrame<Value> {
  const surface = "channel delivery";
  const record = sseObject(data, surface);
  if (record.state === "refused") {
    return { state: "refused", ...wireRefusalEnvelope(record, `${surface} refusal`) } as RefusedDelivery;
  }
  if (record.state !== "snapshot" || !Array.isArray(record.entries) || record.entries.length > 64) {
    throw wireShape(`${surface} requires a bounded snapshot`);
  }
  const key = stringField(record, "key", surface), lease = stringField(record, "lease", surface);
  if (!key || !lease) throw wireShape(`${surface} requires a key and lease`);
  const keys = new Set<string>();
  const entries = record.entries.map((value): ChannelEntry<Value> => {
    const entry = wireObject(value, "channel entry");
    const key = stringField(entry, "key", surface);
    const from = stringField(entry, "from", surface) as Principal;
    const expiresAt = numberField(entry, "expiresAt", surface);
    const payload = wireObject(present(entry, "value", surface), "channel value") as Value;
    if (!key || keys.has(key) || !from || !Number.isSafeInteger(expiresAt)) throw wireShape("invalid channel entry");
    keys.add(key);
    return { key, from, value: payload, expiresAt };
  });
  return { state: "snapshot", key, lease, entries };
}

export function wireChannelWrite(value: unknown): ChannelWriteResult {
  const surface = "channel write response";
  const record = wireObject(value, surface);
  if (record.ok === true) return { ok: true };
  if (record.state !== "refused") throw wireShape(`${surface} must contain ok: true or state: refused`);
  return { state: "refused", ...wireRefusalEnvelope(record, `${surface} refusal`) };
}

export function terminalSessionEnvelope(value: unknown): RefusalEnvelope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.state !== "rejected" && record.state !== "refused") return undefined;
  // A replayed write's trace conflict carries no code (LLP 1012 §7); it is never a session terminal.
  if (record.state === "rejected" && record.reason === "conflict") return undefined;
  const refusal = wireRefusalEnvelope(record, "terminal session response");
  return isTerminalSession(refusal) ? refusal : undefined;
}

function authEpoch(record: Record<string, unknown>, surface: string): { authEpoch?: number } {
  if (record.authEpoch === undefined) return {};
  if (!Number.isSafeInteger(record.authEpoch) || Number(record.authEpoch) < 0) throw wireShape(`${surface}.authEpoch must be a non-negative safe integer`);
  return { authEpoch: Number(record.authEpoch) };
}

export function wireAuthSession(value: unknown, surface: string): AuthSession {
  const record = wireObject(value, surface);
  return { token: stringField(record, "token", surface), viewer: stringField(record, "viewer", surface) as Principal, kind: stringField(record, "kind", surface), ...authEpoch(record, surface) };
}

export function wireAuthMe(value: unknown): AuthMe {
  const surface = "auth me response";
  const record = wireObject(value, surface);
  return { viewer: stringField(record, "viewer", surface) as Principal, kind: stringField(record, "kind", surface), ...authEpoch(record, surface) };
}

export function wireLogout(value: unknown): { ok: boolean } {
  const surface = "auth logout response";
  const record = wireObject(value, surface);
  if (typeof present(record, "ok", surface) !== "boolean") throw wireShape(`${surface}.ok must be a boolean`);
  return { ok: record.ok as boolean };
}

export function wireManifest(value: unknown): Manifest {
  const surface = "manifest response";
  const record = wireObject(value, surface);
  const ops = wireObject(present(record, "ops", surface), `${surface}.ops`);
  for (const [name, operation] of Object.entries(ops)) {
    const item = wireObject(operation, `${surface}.ops.${name}`);
    stringField(item, "kind", `${surface}.ops.${name}`);
    stringField(item, "planHash", `${surface}.ops.${name}`);
    present(item, "args", `${surface}.ops.${name}`);
  }
  const manifest: Manifest = {
    generation: stringField(record, "generation", surface),
    programGeneration: stringField(record, "programGeneration", surface),
    ops: ops as unknown as Manifest["ops"],
    channels: wireObject(present(record, "channels", surface), `${surface}.channels`),
    auth: wireObject(present(record, "auth", surface), `${surface}.auth`),
  };
  if (typeof record.schemaHash === "string") manifest.schemaHash = record.schemaHash;
  if (record.tables && typeof record.tables === "object" && !Array.isArray(record.tables)) {
    manifest.tables = record.tables as Manifest["tables"];
  }
  if (record.schema && typeof record.schema === "object" && !Array.isArray(record.schema)) {
    manifest.schema = record.schema as Manifest["schema"];
  }
  return manifest;
}

export function wireAssetSession(value: unknown): { token: string; expiresAt: number } {
  const surface = "asset session response";
  const record = wireObject(value, surface);
  return { token: stringField(record, "token", surface), expiresAt: numberField(record, "expiresAt", surface) };
}

export async function responseRefusal(response: Response): Promise<SnapbackRefusal> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SnapbackRefusal(
      fallbackRefusal("E_TRANSPORT", `HTTP ${response.status} did not contain a refusal envelope`),
      true,
      response.status,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["code", "family", "guide"].some((field) => has(value as Record<string, unknown>, field))) {
    throw new SnapbackRefusal(
      fallbackRefusal("E_TRANSPORT", `HTTP ${response.status} did not contain a refusal envelope`),
      true,
      response.status,
    );
  }
  return new SnapbackRefusal(wireRefusalEnvelope(value, `HTTP ${response.status} refusal`), false, response.status);
}

export function sseObject(data: string, surface: string): Record<string, unknown> {
  try {
    return wireObject(JSON.parse(data), surface);
  } catch (error) {
    if (isSnapbackRefusal(error)) throw error;
    throw wireShape(`${surface} must contain valid JSON`);
  }
}

/**
 * `AbortSignal.prototype.throwIfAborted` does not exist on React Native's AbortSignal
 * (Hermes, RN 0.81 / Expo SDK 54), so every abort check goes through this helper.
 */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  const reason: unknown = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) throw reason;
  const error = new Error(typeof reason === "string" ? reason : "The operation was aborted");
  error.name = "AbortError";
  throw error;
}

/** Release every waiter on cancellation, even when the transport ignores its signal. */
export async function withAbort<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  throwIfAborted(signal);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => { try { throwIfAborted(signal); } catch (error) { reject(error); } };
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([run(), cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Named policy at JSON request boundaries; onSend is the exact wire-custody handoff. */
export interface JsonRequestOptions {
  enforceAuthority?: boolean;
  /** typed-result defers typed receipts to their caller; after-cleanup also defers HTTP errors. */
  terminalSession?: "expire" | "typed-result" | "after-cleanup" | "keep";
  authRestoration?: boolean;
  onSend?: () => void;
}

// @ref LLP 1018#3-move-one-one-coherent-reactive-client — a follower tab's
// write is refused before any bytes leave: a plain write landing ahead of the
// writer tab's queued intents would invert their order once the queue is inherited.
export function followerRefusal(site = "client.mutation"): SnapbackRefusal {
  return new SnapbackRefusal({
    code: "E_OFFLINE_FOLLOWER",
    family: "offline",
    message: "this account is open for writing in another tab; this tab reads live and takes over when that tab closes",
    site,
    rewrite: "send from the tab that holds this account, or close it; queued writes are kept there and inherited here",
    guide: "offline",
  });
}

export function supersededRefusal(): SnapbackRefusal {
  return new SnapbackRefusal({
    code: "E_AUTH_SUPERSEDED",
    family: "auth",
    message: "operation belonged to a previous authentication generation",
    guide: "auth/session",
  });
}
