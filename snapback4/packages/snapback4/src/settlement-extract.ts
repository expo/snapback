import { validPreserved } from "./change-evidence.ts";
import type { RefusalFacts } from "./refusal-decision.ts";

// @ref LLP 3000.002.000.000#2.1 — the caller pins values; extraction never reads a client.
export interface Snapshot {
  closed: boolean;
  sessionDead: boolean;
  credentialRevision: number;
  incarnation: number;
  storeIdentity: string | undefined;
  onlineStore: string | undefined;
  generation: number | undefined;
  onlineHead: number;
  onlineGeneration: number | undefined;
  dispatchWatermark: number;
  dispatchSendRevision: number;
  dispatchStore: string | undefined;
  dispatchIncarnation: number;
  requestRevision: number;
  requestStore: string | undefined;
}
export interface ExtractionRequest {
  kind: "response" | "observed";
  source: RefusalFacts["source"];
  id: string;
  op: string | undefined;
  footprintKnown: boolean;
  restoreConfirmed: boolean;
}
// Live owner delivery keeps the full outcome. Receipt persistence separately
// strips result values and refusal details in app-online's receiptOf.
export type Outcome = { state: "sent"; id: string; seq: number; replayed?: boolean; result?: unknown }
  | { state: "failed"; id: string; why: Record<string, unknown> };
export type Relation = "same" | "other" | "unknown";
export type GenerationRelation = "same" | "differs" | "unknown";
export interface Certificate {
  outcome: Outcome;
  storeId: string | undefined;
  generation: number | undefined;
  preserved: readonly string[] | undefined;
  op: string | undefined;
  /** May be evaluated with a later pinned snapshot; never closes over a client. */
  authorityCurrent(snapshot?: Snapshot): boolean;
}
export interface Facts extends RefusalFacts {
  kind: ExtractionRequest["kind"];
  snapshot: Snapshot;
  capture: { store_id: string | null; watermark: number; send_revision: number };
  onlineMetadata: { storeId: string | undefined; head: number | undefined; generation: number | undefined };
  refusal: Record<string, unknown> | undefined;
  outcome: Outcome | undefined;
  certificate: Certificate | undefined;
  storeId: string | undefined;
  namedStoreId: string | undefined;
  head: number | undefined;
  generation: number | undefined;
  storeRelation: Relation;
  generationRelation: GenerationRelation;
  authorityCurrent(snapshot?: Snapshot): boolean;
  authorityParts: { lifetimeLive: boolean; credentialCurrent: boolean; incarnationCurrent: boolean; dispatchStoreCurrent: boolean };
  preservedKind: "list" | "empty" | "absent";
  footprintKnown: boolean;
  op: string | undefined;
}
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const named = (v: unknown): string | undefined => typeof v === "string" && v.length > 0 ? v : undefined;
const sequence = (v: unknown): number | undefined => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : undefined;
export const storeRelation = (store: string | undefined, current: string | undefined): Relation => store === undefined || current === undefined ? "unknown" : store === current ? "same" : "other";
export const generationRelation = (generation: number | undefined, current: number | undefined): GenerationRelation => generation === undefined || current === undefined ? "unknown" : generation === current ? "same" : "differs";

export function extract(value: unknown, request: ExtractionRequest, pinned: Snapshot): Facts {
  const json = record(value), snapshot = { ...pinned }, why = record(json.denied ?? json.why);
  const source = request.source, own = request.kind === "response";
  const parts = (now: Snapshot) => ({ lifetimeLive: !now.closed && !now.sessionDead,
    credentialCurrent: snapshot.requestRevision === now.credentialRevision,
    incarnationCurrent: snapshot.dispatchIncarnation === now.incarnation,
    dispatchStoreCurrent: snapshot.dispatchStore === (now.storeIdentity ?? now.onlineStore) });
  const authorityParts = parts(snapshot);
  const authorityCurrent = (now = snapshot) => own && Object.values(parts(now)).every(Boolean);
  const storeId = own ? named(json.store_id) ?? snapshot.dispatchStore : named(json.storeId) ?? snapshot.requestStore;
  const generation = sequence(json.generation);
  // Null/absent is unknown. Malformed non-null evidence conservatively revokes.
  const preserved = json.preserved == null ? undefined
    : validPreserved(json.preserved) ? [...json.preserved] : [];
  const op = own ? request.op : named(json.op) ?? request.op;
  const seq = sequence(json.seq);
  const outcome: Outcome | undefined = why.retryable === true ? undefined : json.state === "sent" && seq !== undefined ? { state: "sent", id: request.id, seq,
    ...(typeof json.replayed === "boolean" ? { replayed: json.replayed } : {}),
    ...(json.replayed !== true && Object.hasOwn(json, "result") ? { result: json.result } : {}) }
    : json.state === "failed" || typeof why.code === "string" ? { state: "failed", id: request.id, why: { ...why } } : undefined;
  // A legacy inspected receipt supplies an outcome, not an execution certificate.
  const certificate = outcome && (own || named(json.storeId) !== undefined && generation !== undefined && named(json.op) !== undefined)
    ? { outcome, storeId, generation, preserved: own && outcome.state === "sent" ? preserved : undefined, op, authorityCurrent } : undefined;
  const code: RefusalFacts["code"] = ["E_STORE_REPLACED", "E_DEV_RESET", "E_STORE_RESTORE", "E_AUTH"].includes(String(why.code)) ? why.code as RefusalFacts["code"] : "other";
  const relation = (store: string | undefined): RefusalFacts["storeNamed"] => store === undefined ? "absent" : store === snapshot.dispatchStore ? "equals-dispatch" : "differs";
  const capture = { store_id: snapshot.dispatchStore ?? null, watermark: snapshot.dispatchWatermark, send_revision: snapshot.dispatchSendRevision };
  const onlineMetadata = { storeId: named(json.store_id), head: sequence(json.head ?? (json.replayed === true ? undefined : json.seq)), generation };
  return { kind: request.kind, snapshot, capture, onlineMetadata, refusal: typeof why.code === "string" ? { ...why } : undefined, outcome, certificate, storeId, namedStoreId: named(json.store_id), head: sequence(json.head), generation,
    storeRelation: storeRelation(storeId, snapshot.storeIdentity),
    generationRelation: generationRelation(certificate?.generation, snapshot.generation), authorityCurrent, authorityParts,
    preservedKind: certificate?.preserved === undefined ? "absent" : certificate.preserved.length ? "list" : "empty", footprintKnown: request.footprintKnown, op,
    source, code, retryable: why.retryable === true, storeNamed: relation(own ? named(json.store_id) : undefined), requestStore: relation(snapshot.requestStore),
    // E_AUTH is credential-scoped even across incarnation/program adoption.
    authority: !authorityParts.lifetimeLive ? "lifetime-ended" : (code === "E_AUTH" ? authorityParts.credentialCurrent : authorityCurrent()) ? "current" : "obsolete",
    restoreConfirmed: request.restoreConfirmed };
}
