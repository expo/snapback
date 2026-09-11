// @ref LLP 1019#6-receipts-with-receipts — only accepted event/body disclosure
// earns an acknowledgement; its ordinary outbox intent owns retries.
import { imageRecord } from '../../evaluator/src/row-image.js';
import { collectRefs, rowKey } from './store/row-values.js';
import { storedProgram } from './store/canonical.js';
import { dropOverlay } from './store/overlay-retirement.js';
import type { OutboxEntry, PersistedRangeState, StoreSwap } from './store/range-store.js';
import type { ChangedRecords } from './store/swap-journal.js';

/** The engine-owned acknowledgement mutation of one custody log (`receipts.rs::ack_name`). */
const ACK_OP = /^_delivery\.([^.]+)\.ack$/;

/** Keyed by the log row key. A terminal binding retries only on accepted redelivery. */
export type DeliveryAcknowledgement = [seq: number, intent?: string, retry?: boolean];

export interface PendingDeliveryAcks {
  remaining: number;
  next?: { op: string; args: { events: string[] }; issuedSeq: number };
  batches?: NonNullable<PendingDeliveryAcks['next']>[];
}

// @ref LLP 1018.008.007.001#3-acknowledgements-proportional-to-changed-state —
// derived keys only; patch after durability, never while a draft can roll back.
export class DeliveryAcknowledgementIndex {
  private readonly bindings = new Map<string, string | undefined>();
  private readonly intents = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Set<string>>();
  private readonly logs = new Map<string, number>();
  private remaining = 0;

  constructor(acks: PersistedRangeState['deliveryAcks']) { this.update(acks, Object.keys(acks)); }

  update(acks: PersistedRangeState['deliveryAcks'], keys: Iterable<string>): void {
    for (const key of keys) {
      const present = this.bindings.has(key), before = this.bindings.get(key), after = acks[key]?.[1];
      if (present && acks[key] && before === after) continue;
      const log = key.split('\0')[0];
      if (present) {
        const map = before ? this.intents : this.pending, group = before || log, set = map.get(group)!;
        if (!before) this.remaining -= Math.ceil(set.size / 50);
        set.delete(key);
        if (!before) this.remaining += Math.ceil(set.size / 50);
        if (!set.size) map.delete(group);
        this.bindings.delete(key);
        const count = this.logs.get(log)! - 1;
        if (count) this.logs.set(log, count); else this.logs.delete(log);
      }
      if (!acks[key]) continue;
      this.bindings.set(key, after);
      this.logs.set(log, (this.logs.get(log) ?? 0) + 1);
      const map = after ? this.intents : this.pending, group = after || log;
      const set = map.get(group) ?? new Set<string>(); map.set(group, set);
      if (!after) this.remaining -= Math.ceil(set.size / 50);
      set.add(key);
      if (!after) this.remaining += Math.ceil(set.size / 50);
    }
  }

  read(acks: PersistedRangeState['deliveryAcks'], limit = 1): PendingDeliveryAcks {
    const batches: NonNullable<PendingDeliveryAcks['next']>[] = [];
    outer: for (const [log, keys] of this.pending) {
      let batch: PendingDeliveryAcks['next'];
      for (const key of keys) {
        if (!batch || batch.args.events.length === 50) {
          if (batches.length >= Math.min(16, limit)) break outer;
          batch = { op: `_delivery.${log}.ack`, args: { events: [] }, issuedSeq: 0 }; batches.push(batch);
        }
        batch.args.events.push(key.slice(log.length + 1)); batch.issuedSeq = Math.max(batch.issuedSeq, acks[key][0]);
      }
    }
    return { remaining: this.remaining, ...(batches.length ? { next: batches[0], ...(limit > 1 ? { batches } : {}) } : {}) };
  }

  candidates(state: PersistedRangeState, swap: StoreSwap, changed: ChangedRecords): Iterable<string> {
    const roots = changed.get('*');
    if (['rows', 'outbox', 'deliveryAcks'].some(k => roots?.has(k))
      || swap.bounds && [...this.logs.keys()].some(log => swap.bounds![`_delivery.${log}.ack`] === undefined))
      return Object.keys(state.deliveryAcks);
    const keys = new Set([...changed.get('deliveryAcks') ?? [], ...changed.get('rows') ?? []]);
    for (const intent of changed.get('outbox') ?? []) for (const key of this.intents.get(intent) ?? []) keys.add(key);
    return keys;
  }
}

/** Shared current-program proof; neither replay nor settlement trusts the reserved name alone. */
function acknowledgementProgram(state: PersistedRangeState, entry: OutboxEntry): string | undefined {
  const held = storedProgram(state), log = ACK_OP.exec(entry.op)?.[1];
  return held && log && entry.targets?.generation === held.generation
    && entry.targets.schemaHash === held.schemaHash && entry.targets.planHash === held.programs[entry.op]?.planHash
    && held.programs[entry.op]?.kind === 'mutation'
    && Object.values(held.schema.tables ?? {}).some(table => table.deliver?.receipts && table.deliver.log === log)
    ? log : undefined;
}

/** Local earned-event custody selects the prefix; the owner also checks exact generated IR. */
export function acknowledgementForReplay(state: PersistedRangeState, entry: OutboxEntry): boolean {
  const log = acknowledgementProgram(state, entry), events = (entry.args as { events?: unknown })?.events;
  return !!log && entry.state === 'queued' && !entry.refusal && !entry.predicted && entry.inbox === undefined
    && !state.overlay[entry.intent]
    && Array.isArray(events) && events.length > 0 && events.length <= 50
    && events.every(event => typeof event === 'string' && state.deliveryAcks[`${log}\0${event}`]?.[1] === entry.intent);
}

export function applyDeliveryAcknowledgements(state: PersistedRangeState, swap: StoreSwap, principal: string,
  index?: DeliveryAcknowledgementIndex, changed?: ChangedRecords): boolean {
  const schema = storedProgram(state, swap)?.schema;
  for (const page of swap.deliveries ?? []) {
    if (!page.receipt || page.state === 'denied') continue;
    const refs = new Set(collectRefs(page.data).map(rowKey));
    const bodies = new Set((page.rows ?? []).filter(r => refs.has(rowKey(r)) && state.rows[rowKey(r)]).map(rowKey));
    for (const range of page.receipt.ranges) for (const id of range.rowIds) refs.add(rowKey({table:range.table,id}));
    for (const [content, table] of Object.entries(schema?.tables ?? {})) {
      const d = table.deliver; if (!d?.receipts) continue;
      for (const record of page.rows ?? []) {
        const event = imageRecord(record);
        const key = rowKey(event), old = state.deliveryAcks[key];
        if ((!old || old[2]) && event.table === d.log && refs.has(key) && state.rows[key]
          && (event.row.kind === 'delivered' || event.row.kind === 'changed')
          && event.row.recipient === principal && bodies.has(`${content}\0${event.row.row}`)) state.deliveryAcks[key] = [page.seq];
      }
    }
  }
  for (const entry of swap.outbox?.put ?? []) {
    // Only the engine-owned acknowledgement mutation `_delivery.<log>.ack` carries event
    // identities; `_delivery` is a legal module stem, so an authored `_delivery.send` is an
    // ordinary product write and must pass untouched.
    const log = ACK_OP.exec(entry.op)?.[1];
    const events = (entry.args as { events?: unknown } | undefined)?.events;
    if (log === undefined || !Array.isArray(events)) continue;
    for (const event of events as string[]) {
      const ack = state.deliveryAcks[`${log}\0${event}`];
      if (!ack) continue;
      if (!ack[1] && entry.state === 'queued') ack[1] = entry.intent;
      if (ack[1] === entry.intent && (entry.state === 'rejected' || entry.state === 'expired')) {
        ack[2] = true;
        if (state.currentGrant === entry.grant) delete state.currentGrant;
      }
    }
  }
  let removed = false;
  for (const key of index && changed ? index.candidates(state, swap, changed) : Object.keys(state.deliveryAcks)) {
    const ack = state.deliveryAcks[key]; if (!ack) continue;
    if (swap.bounds && swap.bounds[`_delivery.${key.split('\0')[0]}.ack`] === undefined) {
      delete state.deliveryAcks[key]; removed = true;
    } else if (ack[1] && !ack[2] && !state.outbox[ack[1]] && !state.rows[key]) delete state.deliveryAcks[key];
  }
  return removed;
}

// @ref LLP 1018.008.007.001#5-avoid-redundant-query-work-without-suppressing-progress —
// empty actual effects are owner evidence; unresolved certified targets are not.
export function acknowledgementWithoutTail(state: PersistedRangeState, entry: OutboxEntry,
  queued = state.outbox[entry.intent]): boolean {
  const result = entry.response as { effects?: unknown; program?: { planHash?: string; schemaHash?: string } } | undefined;
  const targets = entry.targets;
  return !!acknowledgementProgram(state, entry) && !state.sealed && !state.superseded && entry.state === 'committed'
    && queued?.state === 'queued' && queued.op === entry.op
    && !queued.predicted && !entry.predicted && !state.overlay[entry.intent] && !!targets
    && queued.targets?.generation === targets.generation && queued.targets.schemaHash === targets.schemaHash
    && queued.targets.planHash === targets.planHash
    && result?.program?.schemaHash === targets.schemaHash && result.program.planHash === targets.planHash
    && Array.isArray(result.effects) && result.effects.length === 0;
}

/** A changed eligibility proof retains the queued intent and uses the ordinary tail path. */
export class AcknowledgementTailRequired extends Error {}

/** The carrier supplies its private JSON-normalized swap; no caller-owned metadata enters this transaction. */
// @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work — commit owns these values already; journal insertion needs no second detached copy.
export function applyOutboxSwap(state: PersistedRangeState, swap: StoreSwap): Set<string> {
  // Coverage resets never touch unsent outbox/grant/bound/overlay custody.
  for (const intent of swap.outbox?.remove ?? []) {
    delete state.outbox[intent];
    dropOverlay(state, intent);
  }
  const committedNow = new Set<string>();
  for (const entry of swap.outbox?.put ?? []) {
    if (typeof entry.intent !== "string" || entry.intent.length === 0) throw new TypeError("outbox entry needs an intent");
    const previous = state.outbox[entry.intent];
    if (entry.state === "committed" && previous?.state !== "committed") committedNow.add(entry.intent);
    const order = previous?.order ?? entry.order ?? ++state.clock;
    state.outbox[entry.intent] = { ...entry, order };
  }
  if (swap.bounds) state.bounds = swap.bounds;
  if (swap.programs) state.programs = swap.programs;
  for (const id of swap.grants?.remove ?? []) {
    delete state.grants[id];
    if (state.currentGrant === id) delete state.currentGrant;
  }
  for (const grant of swap.grants?.put ?? []) state.grants[grant.id] = grant;
  if (swap.grants?.current === null) delete state.currentGrant;
  else if (typeof swap.grants?.current === "string") {
    if (!state.grants[swap.grants.current]) throw new TypeError("current grant must be a held grant");
    state.currentGrant = swap.grants.current;
  }
  return committedNow;
}
