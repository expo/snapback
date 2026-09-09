// @ref LLP 1018.003.001#4-automatic-compaction-of-successful-history —
// a success leaves the ledger only after every actual row effect has authority.
import { sha256, compareCodepoints } from "../../../evaluator/src/hash.js";
import { matchingMutationProgram } from "../mutation-targets.js";
import { rowKey } from "./row-values.js";
import type { PersistedRangeState } from "./range-store.js";

export interface SuccessEffects {
  digest: string;
  pending: { table: string; id: string; removed?: true }[];
}

/** Same canonical address set as the owner; no private fan-out addresses cross the wire. */
export function successEffects(rows: SuccessEffects["pending"]): SuccessEffects {
  const unique = new Map(rows.map(row => [rowKey(row), row]));
  const pending = [...unique.values()].sort((a, b) => compareCodepoints(a.table, b.table) || compareCodepoints(a.id, b.id));
  return { digest: sha256(JSON.stringify(pending.map(row => [row.table, row.id]))), pending };
}

/** Runs in the existing carrier transaction, with or without query readers. */
export function compactSuccesses(state: PersistedRangeState): number[] {
  const aliases: number[] = [];
  for (const [intent, entry] of Object.entries(state.outbox)) {
    if (!matchingMutationProgram(entry) || entry.state !== "committed" || !entry.effects
      || !state.facts || state.superseded || state.facts.generation !== entry.targets!.generation
      || state.facts.schemaHash !== entry.targets!.schemaHash) continue;
    const response = entry.response as { seq?: number; effects?: string };
    const seq = response?.seq;
    if (!Number.isSafeInteger(seq) || response.effects !== entry.effects.digest) continue;
    const pending = entry.effects.pending.filter(row => {
      const key = rowKey(row), positive = state.rows[key] ? state.rowSeq[key] ?? -1 : -1;
      const negative = state.negative[key] ?? -1;
      // No global sequence, page exclusion, patience, or disappeared overlay is evidence.
      return !(negative >= seq! && negative >= positive)
        && (row.removed || positive < seq! || positive <= negative);
    });
    if (pending.length) {
      if (pending.length !== entry.effects.pending.length) entry.effects.pending = pending;
      continue;
    }
    // One scalar invalidates the freshness of older public snapshots; it is not
    // a receipt for their rows and stores no replacement intent history.
    state.compactedThrough = Math.max(state.compactedThrough ?? 0, seq!);
    delete state.outbox[intent]; delete state.overlay[intent]; delete state.overlayMisses[intent];
    delete state.overlayWatermarks[intent]; delete state.overlayNegatives[intent];
    if (entry.inbox !== undefined) aliases.push(entry.inbox);
  }
  return aliases;
}
