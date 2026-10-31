// @ref LLP 3000.002.000.000#2.3 — one decision over the three existing actors.
export interface RefusalFacts {
  source: "journal-wrapper" | "raw-onWrite" | "dispatch-binding";
  code: "E_STORE_REPLACED" | "E_DEV_RESET" | "E_STORE_RESTORE" | "E_AUTH" | "other";
  retryable: boolean;
  storeNamed: "equals-dispatch" | "differs" | "absent";
  requestStore: "equals-dispatch" | "differs" | "absent";
  authority: "current" | "obsolete" | "lifetime-ended";
  restoreConfirmed: boolean;
}

export interface RefusalDecision {
  reads: "fence" | "keep";
  dispatcher: "retire-all" | "retire-foreign" | "keep";
  reopen: "allowed" | "terminal";
  metadata: "adopt-directly" | "through-online-evidence" | "none";
  notify: "once" | "none";
  transport: "settle" | "retry";
}

/** These are actor constraints, not exclusions of inconvenient authority rows. */
export function reachable(f: RefusalFacts): { reachable: true } | { reachable: false; reason: string } {
  if (f.restoreConfirmed && (f.code !== "E_STORE_RESTORE" || f.retryable))
    return { reachable: false, reason: "confirmation requires a terminal restore" };
  if (f.source === "dispatch-binding") {
    if (f.code !== "E_STORE_REPLACED" || f.retryable || f.restoreConfirmed)
      return { reachable: false, reason: "binding produces only a terminal replacement" };
    if (f.storeNamed !== "absent" || f.requestStore === "equals-dispatch")
      return { reachable: false, reason: "binding has no server reply and refuses a foreign or unbound intent" };
  }
  if (f.source === "raw-onWrite") {
    if (f.retryable) return { reachable: false, reason: "raw onWrite emits terminal outcomes, not transport retries" };
    if (f.storeNamed !== "absent" || f.requestStore !== "absent")
      return { reachable: false, reason: "raw onWrite has no request or reply store envelope" };
  }
  return { reachable: true };
}

export function decideRefusal(f: RefusalFacts): RefusalDecision {
  const row = reachable(f);
  const decision: RefusalDecision = { reads: "keep", dispatcher: "keep", reopen: "allowed", metadata: "none", notify: "none", transport: "settle" };
  if (!row.reachable) return decision;
  if (f.authority === "lifetime-ended" || f.source === "dispatch-binding") return decision;
  if (f.source === "journal-wrapper" && f.code === "E_AUTH" && f.authority === "obsolete") decision.transport = "retry";
  if (f.source === "journal-wrapper" && f.authority === "current") decision.metadata = "through-online-evidence";
  if (f.retryable || !["E_STORE_REPLACED", "E_DEV_RESET", "E_STORE_RESTORE"].includes(f.code)) return decision;
  const fence = f.source === "journal-wrapper" && f.authority === "current"
    && (f.code === "E_STORE_REPLACED" ? f.storeNamed !== "equals-dispatch" : f.requestStore !== "differs");
  decision.reads = fence ? "fence" : "keep";
  const confirmed = f.restoreConfirmed && (f.source === "raw-onWrite" || f.authority === "current");
  decision.dispatcher = fence || f.source === "raw-onWrite" || confirmed ? "retire-all"
    : f.code === "E_STORE_RESTORE" ? "keep" : "retire-foreign";
  decision.reopen = f.code === "E_STORE_RESTORE" && (fence || confirmed) ? "terminal" : "allowed";
  decision.metadata = fence ? "adopt-directly"
    : f.source === "journal-wrapper" && f.authority === "current" && f.code === "E_STORE_REPLACED" && f.storeNamed === "equals-dispatch"
      ? "through-online-evidence" : "none";
  // Recovery is owed even if online evidence saw an already-adopted store.
  // Terminal restores use refuseRestore, which never calls onStoreChange.
  decision.notify = decision.dispatcher !== "keep" && f.code !== "E_STORE_RESTORE" ? "once" : "none";
  return decision;
}
