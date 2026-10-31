import { decideRefusal, type RefusalDecision } from "./refusal-decision.ts";
import { generationRelation, storeRelation, type Certificate, type Facts, type Outcome } from "./settlement-extract.ts";

// @ref LLP 3000.002.000.000#2.2 — arrival revocation and pending-exit publication are separate decisions.
export interface State {
  phase: "admitted" | "responded" | "settled";
  certificate: Certificate | undefined;
  episodeStarted: boolean;
  cutInstalled: boolean;
  published: boolean;
  op: string | undefined;
  footprintKnown: boolean;
  storeId: string | undefined;
  outcome: Outcome | undefined;
  outcomeDelivered: boolean;
  responseOutstanding: number;
}
export type Event = { type: "dispatched" }
  | { type: "admitted"; op: string; footprintKnown: boolean }
  | { type: "response"; certificate: Certificate }
  | { type: "observed"; receipt: Outcome; certificate?: Certificate }
  | { type: "persisted" } | { type: "evicted" };
export interface Publication {
  cut: number | undefined;
  preserved: readonly string[] | undefined;
  footprint: "qualified" | "unknown";
}
export interface Episode {
  preserved: readonly string[];
  scope: "qualified" | "all-columns-of-known-tables" | "every-watch";
}
export type Effect = ({ type: "startEpisode" } & Episode)
  | { type: "publish"; publication: Publication }
  | { type: "settle" } | { type: "deliverOutcome"; outcome: Outcome }
  | { type: "retain" } | { type: "discard" } | { type: "refuseEviction" };

/** Unknown response ownership pins conservatively. A peer-only owner may pass zero.
 * An observed peer completion cannot clear this pin; each own response releases one dispatch. */
export function initialState(responseOutstanding = 1): State {
  return { phase: "admitted", certificate: undefined, episodeStarted: false, cutInstalled: false, published: false,
    op: undefined, footprintKnown: false, storeId: undefined, outcome: undefined, outcomeDelivered: false, responseOutstanding };
}

export function atArrival(certificate: Certificate, facts: Facts): { episode?: Episode; retire?: RefusalDecision } {
  const result: { episode?: Episode; retire?: RefusalDecision } = {};
  if (facts.kind === "response" && certificate.outcome.state === "failed") result.retire = decideRefusal(facts);
  const now = facts.snapshot;
  if (now.closed || now.sessionDead || storeRelation(certificate.storeId, now.storeIdentity) !== "same" || certificate.preserved === undefined) return result;
  const sameGeneration = generationRelation(certificate.generation, now.generation) === "same";
  const qualified = certificate.authorityCurrent(now) && sameGeneration;
  result.episode = { preserved: qualified ? certificate.preserved : [],
    scope: !facts.footprintKnown || !sameGeneration ? "every-watch" : qualified ? "qualified" : "all-columns-of-known-tables" };
  return result;
}

export function atSettlement(state: State, facts: Facts): Publication {
  const certificate = state.certificate, outcome = certificate?.outcome ?? state.outcome, now = facts.snapshot;
  const known = facts.footprintKnown && (certificate?.op ?? state.op ?? facts.op) !== undefined;
  const sameStore = storeRelation(certificate?.storeId ?? state.storeId, now.storeIdentity) === "same";
  if (now.closed || now.sessionDead || !sameStore)
    return { cut: undefined, preserved: undefined, footprint: known ? "qualified" : "unknown" };
  const sameGeneration = certificate !== undefined && generationRelation(certificate.generation, now.generation) === "same";
  return { cut: outcome?.state === "sent" ? outcome.seq : undefined,
    preserved: certificate?.preserved === undefined ? undefined : sameGeneration && certificate.authorityCurrent(now) ? certificate.preserved : [],
    footprint: known && (outcome?.state === "failed" || sameGeneration) ? "qualified" : "unknown" };
}

export function step(previous: State, event: Event, facts: Facts): { state: State; effects: Effect[] } {
  const state = { ...previous }, effects: Effect[] = [];
  const arrive = (certificate: Certificate) => {
    const { episode } = atArrival(certificate, facts);
    if (episode) { effects.push({ type: "startEpisode", ...episode }); state.episodeStarted = true; }
  };
  const deliver = () => {
    if (state.outcome && !state.outcomeDelivered) { effects.push({ type: "deliverOutcome", outcome: state.outcome }); state.outcomeDelivered = true; }
  };
  const finish = () => {
    if (state.published || !state.outcome) return;
    const publication = atSettlement(state, facts);
    // The executor removes pending custody and installs this in-memory cut
    // before waking reads. Durable cut persistence is not a prerequisite.
    effects.push({ type: "settle" }, { type: "publish", publication });
    state.phase = "settled"; state.published = true; state.cutInstalled = publication.cut !== undefined;
    deliver();
  };
  switch (event.type) {
    case "dispatched":
      state.responseOutstanding++;
      break;
    case "admitted":
      if (state.phase !== "settled") {
        state.op ??= event.op; state.footprintKnown = event.footprintKnown;
        state.storeId ??= facts.storeId;
        effects.push({ type: "retain" });
      }
      break;
    case "response":
      state.responseOutstanding = Math.max(0, state.responseOutstanding - 1);
      arrive(event.certificate);
      // Peer completion owns settlement, but never swallows live revocation.
      if (state.phase === "settled") break;
      if (!state.certificate) {
        state.certificate = event.certificate; state.outcome = event.certificate.outcome;
        state.op ??= event.certificate.op; state.storeId ??= event.certificate.storeId;
      }
      state.phase = "responded";
      deliver(); effects.push({ type: "retain" });
      break;
    case "observed":
      if (state.phase === "settled") break;
      if (!state.certificate && event.certificate) { state.certificate = event.certificate; arrive(event.certificate); }
      state.outcome = state.certificate?.outcome ?? event.receipt;
      state.storeId ??= facts.storeId; state.op ??= facts.op;
      finish();
      break;
    case "persisted":
      // A stray acknowledgement without a known terminal receipt proves nothing.
      finish();
      break;
    case "evicted":
      effects.push({ type: state.phase !== "settled" || !state.published || state.responseOutstanding ? "refuseEviction" : "discard" });
      break;
  }
  return { state, effects };
}
