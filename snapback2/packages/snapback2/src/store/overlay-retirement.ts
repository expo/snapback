// @ref LLP 1012#7-writes-offline — cursor identity is not order. Only held,
// post-commit next links prove progress; explicit negatives settle deletions.
import { collectRefs, rowKey } from "./row-values.js";
import type { OverlayRow, PersistedRangeState, StoreSwap, StoredAnswer, WatermarkRecord } from "./range-store.js";
import { canonical } from "./canonical.js";

export interface OverlayWatermark extends Pick<WatermarkRecord, "op" | "args" | "watermark"> {
  cursorArg: string;
  /** Last proven progress, and positions already consumed, survive a remount/reopen. */
  progress?: string;
  consumed?: string[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Each page keeps the name used when it was filed, including a pre-manifest c. */
export function pagePosition(page: Pick<StoredAnswer, "op" | "args" | "cursorArg">, mark: OverlayWatermark): string | null | undefined {
  if (page.op !== mark.op || !object(page.args) || !object(mark.args)) return undefined;
  const cursor = page.cursorArg ?? mark.cursorArg;
  const base = { ...mark.args };
  const args = { ...page.args };
  // Before the manifest, a caller can already pass { after: null } while the
  // recorded name is c. Only the now-known cursor substitutes for that missing
  // field; other nullable/string arguments remain part of the query identity.
  delete base[Object.hasOwn(base, mark.cursorArg) ? mark.cursorArg : cursor];
  delete args[cursor];
  if (canonical(base) !== canonical(args)) return undefined;
  const position = page.args[cursor];
  return position === null ? null : typeof position === "string" && !position.startsWith("h1.") ? position : undefined;
}

/**
 * An ordered path starting at the commit snapshot, never inferred from a newer
 * seq or a different opaque string. A cycle, ambiguity, or missing link ends
 * the proven prefix. The caller supplies only non-empty, intact held pages.
 */
export function cursorChain(pages: StoredAnswer[], mark: OverlayWatermark, committedSeq: number): string[] {
  const links = new Map<string | null, string | null>();
  for (const page of pages) {
    if ((page.nextSeq ?? page.seq) < committedSeq || typeof page.next !== "string" || page.next.startsWith("h1.")) continue;
    const position = pagePosition(page, mark);
    if (position === undefined) continue;
    // Conflicting links quarantine only this position, including off-path ones.
    links.set(position, links.has(position) && links.get(position) !== page.next ? null : page.next);
  }
  const seen = new Set<string | null>([mark.watermark]);
  const chain: string[] = [];
  let position = mark.watermark;
  while (links.has(position)) {
    const next = links.get(position);
    if (next == null || seen.has(next)) break;
    seen.add(next);
    chain.push(next);
    position = next;
  }
  return chain;
}

/** A re-mark can consume progress only once and only beyond the last proven mark. */
export function advanceOverlay(mark: OverlayWatermark, tail: WatermarkRecord | undefined, chain: string[]): boolean {
  if (!tail || pagePosition({ ...tail, args: object(tail.args)
    ? { ...tail.args, [tail.cursorArg ?? mark.cursorArg]: tail.watermark } : tail.args }, mark) === undefined) return false;
  if (typeof tail.watermark !== "string" || (mark.consumed ?? []).includes(tail.watermark)) return false;
  const at = chain.indexOf(tail.watermark);
  if (mark.progress !== undefined && !chain.includes(mark.progress)) {
    // A page can grow or be evicted. Re-anchor at the nearest surviving consumed
    // position (or the snapshot root), without forgetting what already counted.
    mark.progress = [...(mark.consumed ?? [])].reverse().find((position) => chain.includes(position));
  }
  const previous = mark.progress === undefined ? -1 : chain.indexOf(mark.progress);
  if (at < 0 || at <= previous) return false;
  mark.progress = tail.watermark;
  mark.consumed = [...new Set([...(mark.consumed ?? []), ...chain.slice(0, at + 1)])];
  return true;
}

/** Two post-commit resumes or proven tail advances retire a stranded prediction. */
const OVERLAY_PATIENCE = 2;

/** Bind an exact held absence to the intent that was admitted against it. */
export function admitOverlayAbsences(state: PersistedRangeState, intent: string, rows: OverlayRow[],
  owners: (key: string) => Iterable<string>): void {
  const entry = state.outbox[intent];
  if (entry?.predicted !== true) return;
  for (const row of rows) {
    if (row.removed || row.fields) continue;
    const key = rowKey(row), seq = state.negative[key];
    if (seq === undefined) continue;
    const heldBeforeAdmission = [...owners(key)].some(owner => {
      const answer = state.answers[owner]; return answer?.seq === seq && answer.order < entry.order!;
    });
    if (heldBeforeAdmission) (state.overlayNegatives[intent] ??= {})[key] = {
      seq, source: "absence", admitted: true,
    };
  }
}

/** Retire committed prediction rows against the authority landed in this complete swap. */
export function retireOverlays(
  state: PersistedRangeState,
  swap: StoreSwap,
  authoritativeNegatives: Map<string, { seq: number; source: "absence" | "tombstone" }>,
  clockOnly: Set<string>,
  previousTail: WatermarkRecord | undefined,
  tail: WatermarkRecord | undefined,
  committedNow: Set<string>,
  answerKey: (op: string, args: unknown) => string,
  copy: <T>(value: T) => T,
): void {
  const answers = Object.keys(state.overlay).some((intent) => state.outbox[intent]?.state === "committed")
    ? Object.values(state.answers) : [];
  let maintainedTargets: Set<string> | undefined;
  const targetTables = () => maintainedTargets ??= new Set(Object.values(state.programs).flatMap((program) => {
    const maintains = (program.schema as { maintains?: Array<{ target?: unknown }> }).maintains ?? [];
    return maintains.flatMap((maintain) => typeof maintain.target === "string" ? [maintain.target] : []);
  }));
  const pages = answers.filter((answer) => {
    const nonempty = Array.isArray(answer.data) ? answer.data.length > 0 : collectRefs(answer.data).length > 0;
    return !answer.clockOnly && !answer.retained && (answer.state === "complete" || answer.state === "capped") && answer.receipt !== undefined
      && !answer.receipt.ranges.some((range) => (range.evictedIds?.length ?? 0) > 0)
      && nonempty && answer.refs.length > 0 && answer.refs.every((ref) => state.rows[rowKey(ref)] !== undefined);
  });
  const chains = new Map<string, { chain: string[]; reached: Set<string | null | undefined> }>();
  for (const intent of Object.keys(state.overlay)) {
    const entry = state.outbox[intent];
    if (entry === undefined || entry.state === "rejected" || entry.state === "expired") {
      delete state.overlay[intent]; delete state.overlayMisses[intent]; delete state.overlayWatermarks[intent];
      delete state.overlayNegatives[intent]; if (entry) delete entry.predicted; continue;
    }
    for (const row of state.overlay[intent]!) {
      const key = rowKey(row), evidence = authoritativeNegatives.get(key);
      const previous = state.overlayNegatives[intent]?.[key];
      if (evidence !== undefined && (evidence.seq > (previous?.seq ?? -1)
        || (evidence.seq === previous?.seq && evidence.source === "tombstone"))) {
        (state.overlayNegatives[intent] ??= {})[key] = evidence;
      }
    }
    if (entry.state !== "committed") continue;
    if (state.overlayWatermarks[intent] == null && tail !== undefined) {
      const snapshot = committedNow.has(intent) && state.overlayWatermarks[intent] !== null ? previousTail ?? tail : tail;
      state.overlayWatermarks[intent] = { op: snapshot.op, args: copy(snapshot.args), cursorArg: snapshot.cursorArg ?? "c",
        watermark: snapshot.watermark };
    }
    const committedSeq = (entry.response as { seq?: unknown } | undefined)?.seq;
    if (!Number.isSafeInteger(committedSeq)) {
      delete state.overlay[intent]; delete state.overlayMisses[intent]; delete state.overlayWatermarks[intent];
      delete state.overlayNegatives[intent]; delete entry.predicted; continue;
    }
    const overlay = state.overlay[intent]!, seq = Number(committedSeq);
    const predicted = new Set(overlay.filter((row) => !row.removed).map(rowKey));
    const ordinary = new Set(overlay.filter((row) => !targetTables().has(row.table)).map(rowKey));
    const committedWatermark = state.overlayWatermarks[intent] ?? undefined;
    const chainKey = committedWatermark ? canonical({ op: committedWatermark.op, args: committedWatermark.args,
      cursorArg: committedWatermark.cursorArg, watermark: committedWatermark.watermark, seq }) : "";
    if (!chains.has(chainKey)) {
      const chain = committedWatermark ? cursorChain(pages, committedWatermark, seq) : [];
      chains.set(chainKey, { chain, reached: new Set(chain) });
    }
    const { chain, reached } = chains.get(chainKey)!;
    const confirmed = new Set<string>();
    for (const row of overlay) {
      const key = rowKey(row), evidence = state.overlayNegatives[intent]?.[key];
      if (evidence !== undefined && evidence.seq >= seq && (state.rowSeq[key] ?? -1) <= evidence.seq) confirmed.add(key);
    }
    for (const answer of answers) {
      if (answer.seq < seq || answer.retained || answer.state === "denied") continue;
      for (const ref of answer.refs) if (predicted.has(rowKey(ref)) && state.rows[rowKey(ref)] !== undefined) confirmed.add(rowKey(ref));
    }
    const pageArrived = predicted.size > 0 && committedWatermark !== undefined && pages.some((page) => page.seq >= seq
      && reached.has(pagePosition(page, committedWatermark)));
    // A mutation is one atomic write group. Exact arrival/absence of any
    // ordinary row, or the selected log advancing past the commit, supersedes
    // every ordinary prediction, including fan-out rows whose server ids
    // differ. Engine-maintained targets keep row-by-row custody until their own
    // authority arrives; an ordinary sibling cannot manufacture an aggregate.
    if (pageArrived || [...confirmed].some((key) => ordinary.has(key))) {
      for (const key of ordinary) confirmed.add(key);
    }
    const arrived = confirmed.size === overlay.length;
    const advanced = committedWatermark !== undefined && swap.watermark !== undefined && tail !== undefined
      && answerKey(tail.op, tail.args) === answerKey(swap.watermark.op, swap.watermark.args)
      && advanceOverlay(committedWatermark, tail, chain);
    const onlyClock = !!swap.deliveries?.length && swap.deliveries.every((delivery) => clockOnly.has(answerKey(delivery.op, delivery.args)))
      && !swap.refreshes?.length;
    const moved = !onlyClock && (advanced || (swap.resumeSeq !== undefined && swap.resumeSeq > seq));
    const misses = arrived ? 0 : (state.overlayMisses[intent] ?? 0) + (moved && !committedNow.has(intent) ? 1 : 0);
    if (!arrived && confirmed.size > 0) {
      state.overlay[intent] = overlay.filter((row) => !confirmed.has(rowKey(row)));
      delete state.overlayMisses[intent];
      const negatives = state.overlayNegatives[intent]; if (negatives) for (const key of confirmed) delete negatives[key];
      continue;
    }
    if (!arrived && misses < OVERLAY_PATIENCE) { if (misses > 0) state.overlayMisses[intent] = misses; continue; }
    delete state.overlay[intent]; delete state.overlayMisses[intent]; delete state.overlayWatermarks[intent];
    delete state.overlayNegatives[intent]; delete entry.predicted;
  }
}
