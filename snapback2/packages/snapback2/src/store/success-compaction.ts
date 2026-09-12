// @ref LLP 1018.003.001#4-automatic-compaction-of-successful-history —
// the owner names the actor-observable effects; its commit settles server-only fan-out.
import { rowKey } from "./row-values.js";
import { dropOverlay } from "./overlay-retirement.js";
import { storedProgram } from "./canonical.js";
import { rowObservation } from "../query-items.js";
import type { OutboxEntry, PersistedRangeState } from "./range-store.js";

export type SuccessEffects = { table: string; id: string; removed?: true }[];

/** Shared terminal eligibility; the index never invents a second effect set. */
export function successEffects(entry?: OutboxEntry): SuccessEffects | undefined {
  const response = entry?.response as { effects?: SuccessEffects } | undefined;
  return entry?.state === 'committed' && Array.isArray(response?.effects) ? entry.effects ?? response.effects : undefined;
}

/** Runs in the existing carrier transaction, with or without query readers. */
export function compactSuccesses(state: PersistedRangeState, owners?: (key: string) => Iterable<string>,
  intents: Iterable<string> = Object.keys(state.outbox)): number[] {
  const aliases: number[] = [];
  if (state.superseded) return aliases;
  const held = storedProgram(state);
  for (const intent of intents) {
    const entry = state.outbox[intent], pending = successEffects(entry);
    if (!pending) continue;
    const response = entry.response as { seq?: number; effects?: SuccessEffects; program?: { schemaHash: string; planHash: string } };
    const seq = response?.seq, identity = response?.program;
    if (!Number.isSafeInteger(seq) || !identity || !held
      || held.schemaHash !== identity.schemaHash || held.programs[entry.op]?.planHash !== identity.planHash) continue;
    const remaining = pending.filter(row => {
      // Empty effect sets require no row coverage; nonempty sets need this exact schema.
      if (!state.facts || state.facts.schemaHash !== identity.schemaHash || state.facts.generation !== held.generation) return true;
      const key = rowKey(row);
      // No global sequence, page exclusion, patience, or disappeared overlay is evidence.
      if ((state.negative[key] ?? -1) >= seq!) return false;
      const observed = rowObservation(state, key);
      if (!observed) return true;
      if (observed.through >= seq!) return false;
      // @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work —
      // An answer can advance only the exact current, positively held image.
      for (const owner of owners?.(key) ?? Object.keys(state.answers))
        if ((rowObservation(state, key, state.answers[owner])?.through ?? -1) >= seq!) return false;
      return true;
    });
    if (remaining.length) {
      if (remaining.length !== pending.length) entry.effects = remaining;
      continue;
    }
    // One scalar invalidates the freshness of older public snapshots; it is not
    // a receipt for their rows and stores no replacement intent history.
    state.compactedThrough = Math.max(state.compactedThrough ?? 0, seq!);
    delete state.outbox[intent]; dropOverlay(state, intent);
    if (entry.inbox !== undefined) aliases.push(entry.inbox);
  }
  return aliases;
}
