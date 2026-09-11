// @ref LLP 1018.003.001#4-automatic-compaction-of-successful-history —
// the owner names the actor-observable effects; its commit settles server-only fan-out.
import { rowKey } from "./row-values.js";
import { rowObservation } from "../query-items.js";
import type { PersistedRangeState } from "./range-store.js";

export type SuccessEffects = { table: string; id: string; removed?: true }[];

/** Runs in the existing carrier transaction, with or without query readers. */
export function compactSuccesses(state: PersistedRangeState): number[] {
  const aliases: number[] = [];
  for (const [intent, entry] of Object.entries(state.outbox)) {
    if (entry.state !== "committed" || state.superseded) continue;
    const response = entry.response as { seq?: number; effects?: SuccessEffects; program?: { schemaHash: string; planHash: string } };
    const seq = response?.seq, identity = response?.program;
    const held = state.programs[state.facts?.generation ?? ""] ?? Object.values(state.programs)[0];
    if (!Number.isSafeInteger(seq) || !Array.isArray(response.effects) || !identity || !held
      || held.schemaHash !== identity.schemaHash || held.programs[entry.op]?.planHash !== identity.planHash) continue;
    const pending = entry.effects ?? response.effects;
    const remaining = pending.filter(row => {
      // Empty effect sets require no row coverage; nonempty sets need this exact schema.
      if (!state.facts || state.facts.schemaHash !== identity.schemaHash || state.facts.generation !== held.generation) return true;
      const key = rowKey(row);
      const observed = rowObservation(state, key);
      let positive = observed?.through ?? -1;
      // An answer can extend an existing image's proof, never supply a missing
      // or negatively superseded image. Keep explicit negative evidence below.
      if (observed && positive < seq!) for (const answer of Object.values(state.answers)) {
        positive = Math.max(positive, rowObservation(state, key, answer)?.through ?? -1);
        if (positive >= seq!) break;
      }
      const negative = state.negative[key] ?? -1;
      // No global sequence, page exclusion, patience, or disappeared overlay is evidence.
      return !(negative >= seq! && negative >= positive)
        && (positive < seq! || positive <= negative);
    });
    if (remaining.length) {
      if (remaining.length !== pending.length) entry.effects = remaining;
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
