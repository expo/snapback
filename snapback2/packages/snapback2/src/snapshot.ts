// @ref LLP 1018.003#2-derive-never-add — a summary is a projection of facts,
// never a fact: `summarize` and `readiness` are the only places a screen's
// three-way status and one-sentence reason come from, and every fact they
// project stays on the record one property down.
import type {
  ConnectionState,
  Cursor,
  OutboxEntry,
  OutboxStatus,
  PredictedRow,
  QueryView,
  RefusalEnvelope,
  ReceiptSource,
} from "./types.js";

export type ReceiptOutcome = "complete" | "capped" | "partial" | "denied";
export type SnapshotStatus = "loading" | "ready" | "unavailable";
export type SnapshotReasonCode = "refused" | "denied" | "partial" | "stale" | "offline" | "predicted" | "held";

/** One observed query, as a screen reads it (LLP 1018.003 §1). */
export type Snapshot<T> = {
  data: T | undefined;
  /** What a certified evaluation said about this value, and whose evaluation it was. */
  receipt?: {
    outcome: ReceiptOutcome;
    source: ReceiptSource;
    seq: number;
    next: Cursor | null;
    reason?: string;
    rule?: string;
    /** A local partial's uncovered sites (LLP 1012 §6). */
    sites?: readonly { site: string; reason: string }[];
  };
  /** How current it is. Transport truth, independent of the receipt. */
  freshness: { live: boolean; staleSince?: number; connection: ConnectionState };
  /** What this device added. Offline truth. */
  local: {
    /** Rows a queued intent predicted, each with the intent that minted it; match `id` against the rows you render. */
    predicted: readonly PredictedRow[];
    retained: boolean;
    caughtUp?: boolean;
    watermark?: Cursor | null;
  };
  refusal?: RefusalEnvelope;
  /** Derived, never stored: `ready` means readable data, not server confirmation or a usable composite. */
  status: SnapshotStatus;
  /** `detail` carries the rule a denial named or the reason a partial gave; the sentence stays generic. */
  reason?: { code: SnapshotReasonCode; message: string; detail?: string };
};

/** The sentences behind `reason.message`, keyed by code; switch on `code` to supply your own. */
export const reasonMessages: Readonly<Record<Exclude<SnapshotReasonCode, "refused">, string>> = Object.freeze({
  denied: "Not visible to this account.",
  partial: "Some data is not downloaded.",
  stale: "Showing downloaded data.",
  offline: "Offline, and nothing is downloaded yet.",
  predicted: "Includes changes the server has not confirmed.",
  held: "Showing downloaded data that the server has not checked yet.",
});

const EMPTY_PREDICTED: readonly PredictedRow[] = Object.freeze([]);

function receiptOf<T>(view: QueryView<T>): Snapshot<T>["receipt"] | undefined {
  if (view.state === "complete" || view.state === "capped") {
    return { outcome: view.state, source: view.source ?? "server", seq: view.seq, next: view.next };
  }
  if (view.state === "partial") {
    return { outcome: "partial", source: view.source ?? "server", seq: view.seq, next: null, reason: view.reason, ...(view.sites === undefined ? {} : { sites: view.sites }) };
  }
  if (view.state === "denied") {
    return { outcome: "denied", source: view.source ?? "server", seq: view.seq, next: null, rule: view.rule };
  }
  if (view.state === "stale" && view.outcome !== undefined && view.seq !== undefined) {
    return {
      outcome: view.outcome,
      source: view.source ?? "server",
      seq: view.seq,
      next: view.next ?? null,
      ...(view.reason === undefined ? {} : { reason: view.reason }),
      ...(view.rule === undefined ? {} : { rule: view.rule }),
      ...(view.sites === undefined ? {} : { sites: view.sites }),
    };
  }
  return undefined;
}

/**
 * The whole summary contract, as one table (LLP 1018.003 §2). Pure: the same
 * view and connection always summarize the same way, and nothing here is a
 * fact the view did not already carry.
 */
export function summarize<T>(view: QueryView<T>, connection: ConnectionState): Snapshot<T> {
  const data = "data" in view ? view.data : undefined;
  const receipt = receiptOf(view);
  const staleSince = view.state === "stale" ? view.since : "stale" in view ? view.stale?.since : undefined;
  const local: Snapshot<T>["local"] = {
    predicted: "predicted" in view && view.predicted !== undefined ? view.predicted : EMPTY_PREDICTED,
    retained: "retained" in view && view.retained === true,
    ...("caughtUp" in view && view.caughtUp !== undefined ? { caughtUp: view.caughtUp } : {}),
    ...("watermark" in view && view.watermark !== undefined ? { watermark: view.watermark } : {}),
  };
  const base = {
    data,
    ...(receipt === undefined ? {} : { receipt }),
    freshness: { live: view.live, ...(staleSince === undefined ? {} : { staleSince }), connection },
    local,
  };
  if (view.state === "refused") {
    const { refusal } = view;
    return { ...base, refusal, status: "unavailable", reason: { code: "refused", message: refusal.rewrite ?? refusal.message } };
  }
  const detail = (value: string | undefined) => (value === undefined ? {} : { detail: value });
  if (receipt?.outcome === "denied") {
    return { ...base, status: "unavailable", reason: { code: "denied", message: reasonMessages.denied, ...detail(receipt.rule) } };
  }
  if (receipt?.outcome === "partial" && data === undefined) {
    return { ...base, status: "unavailable", reason: { code: "partial", message: reasonMessages.partial, ...detail(receipt.reason) } };
  }
  if (data !== undefined && receipt !== undefined) {
    const code: SnapshotReasonCode | undefined = receipt.outcome === "partial" ? "partial"
      : staleSince !== undefined ? "stale"
        : local.predicted.length > 0 ? "predicted"
          : undefined;
    return {
      ...base,
      status: "ready",
      ...(code === undefined ? {} : { reason: { code, message: reasonMessages[code], ...(code === "partial" ? detail(receipt.reason) : {}) } }),
    };
  }
  if (data !== undefined) {
    return { ...base, status: "ready", reason: { code: "held", message: reasonMessages.held } };
  }
  // The twin reported nothing held while the device is not connected: nothing
  // will arrive until it is. The same marker with a live connection is a fetch
  // in flight, so it stays loading.
  if (view.state === "hydrating" && view.offline === true && connection !== "connected") {
    return { ...base, status: "unavailable", reason: { code: "offline", message: reasonMessages.offline } };
  }
  return { ...base, status: "loading" };
}

export type ReadinessAction = "sign-in" | "connect" | "other-tab" | "wait";
export type ReadinessCode = OutboxStatus["reason"] | "fence" | "pending" | (string & {});
/** Whether a write can be accepted now, and what the user can do if not (LLP 1018.003 §2). */
export type Readiness = {
  send: boolean;
  action?: ReadinessAction;
  reason?: { code: ReadinessCode; message: string };
};

/** The sentences behind `can.reason.message`, keyed by code; `pending` is composed from the queue and connection. */
export const readinessMessages: Readonly<Record<string, string>> = Object.freeze({
  sealed: "Sign in again to send your saved messages.",
  "grant-missing": "Connect to enable sending. Queued messages stay saved.",
  "grant-expired": "Reconnect to enable new messages. Queued messages stay saved.",
  "ids-exhausted": "Reconnect to continue sending. Queued messages stay saved.",
  "program-missing": "Connect to download this conversation before sending.",
  follower: "Another tab holds this account and this one cannot reach it. Send from that tab, or close it to send here.",
  fence: "Queued until the next sync.",
  forwarding: "Another tab sends for this account. Messages are saved here first.",
  "inbox-full": "This device holds as many unsent messages as it can. Wait for the sending tab.",
  "writer-unresponsive": "The sending tab is not responding. Your message stays saved.",
});

/**
 * `queued` is the op-scoped count the hook computes, not the partition-wide
 * `remaining`; active replay decides whether waiting is useful on the writer.
 * `connect` offers `client.online()`: a connected read alone replays nothing.
 */
export function readiness(status: OutboxStatus, connection: ConnectionState, queued: number): Readiness {
  const reason = status.reason as string;
  const message = (code: string) => readinessMessages[code] ?? `Sending is unavailable (${code}).`;
  if (reason === "follower") return { send: false, action: "other-tab", reason: { code: reason, message: message(reason) } };
  if (reason === "sealed") return { send: false, action: "sign-in", reason: { code: reason, message: message(reason) } };
  if (!status.ready) {
    return { send: false, action: reason === "inbox-full" ? "wait" : "connect", reason: { code: reason, message: message(reason) } };
  }
  // @ref LLP 1018.004#3-readiness-on-a-follower — a follower's rows are durable
  // and FIFO: an unresponsive writer is a reason on a sendable status, and the
  // pending sentence names the sending tab rather than the server.
  if (reason === "writer-unresponsive") return { send: true, action: "wait", reason: { code: reason, message: message(reason) } };
  if (status.fence === "past") return { send: true, action: "connect", reason: { code: "fence", message: message("fence") } };
  if (queued > 0) {
    const waiting = reason === "forwarding" ? "Waiting for the sending tab."
      : status.draining ? "Waiting for the server."
        : connection === "connected" ? "Sync to resume delivery." : "Waiting for connection.";
    return { send: true, action: reason === "forwarding" || status.draining ? "wait" : "connect",
      reason: { code: "pending", message: `${queued} queued · ${waiting}` } };
  }
  return { send: true };
}

/** The label a queued or settled intent shows; never a client clock (LLP 1012 §7). */
export function intentLabel(entry: OutboxEntry): string {
  switch (entry.state) {
    case "queued": return entry.reason === "fence" ? "Will be checked by the server"
      : entry.predicted ? "Sending… · Preview" : "Sending… · Awaiting confirmation";
    case "committed": return "Sent";
    case "expired": return "Expired";
    case "rejected": {
      const response = entry.response as { reason?: string; code?: string; rewrite?: string; message?: string } | undefined;
      // A trace conflict, or a recipe's own compare-and-set (`require msg.body = baseBody else CONFLICT`), reads the same.
      if (response?.reason === "conflict" || response?.code === "CONFLICT") return "Not sent · Message changed";
      return `Not sent · ${response?.rewrite ?? response?.message ?? response?.code ?? "refused"}`;
    }
    default: return String((entry as { state: string }).state);
  }
}
