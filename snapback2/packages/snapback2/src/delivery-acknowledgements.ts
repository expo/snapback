// @ref LLP 1019#6-receipts-with-receipts — only accepted event/body disclosure
// earns an acknowledgement; its ordinary outbox intent owns retries.
import { imageRecord } from '../../evaluator/src/row-image.js';
import { collectRefs, rowKey } from './store/row-values.js';
import { storedProgram } from './store/canonical.js';
import type { PersistedRangeState, StoreSwap } from './store/range-store.js';

/** Keyed by the log row key. A terminal binding retries only on accepted redelivery. */
export type DeliveryAcknowledgement = [seq: number, intent?: string, retry?: boolean];

export function applyDeliveryAcknowledgements(state: PersistedRangeState, swap: StoreSwap, principal: string): boolean {
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
    if (!entry.op.startsWith('_delivery.')) continue;
    for (const event of (entry.args as {events: string[]}).events) {
      const ack = state.deliveryAcks[`${entry.op.slice(10, -4)}\0${event}`];
      if (!ack) continue;
      if (!ack[1] && entry.state === 'queued') ack[1] = entry.intent;
      if (ack[1] === entry.intent && (entry.state === 'rejected' || entry.state === 'expired')) {
        ack[2] = true;
        if (state.currentGrant === entry.grant) delete state.currentGrant;
      }
    }
  }
  let removed = false;
  for (const [key, ack] of Object.entries(state.deliveryAcks)) {
    if (swap.bounds && swap.bounds[`_delivery.${key.split('\0')[0]}.ack`] === undefined) {
      delete state.deliveryAcks[key]; removed = true;
    } else if (ack[1] && !ack[2] && !state.outbox[ack[1]] && !state.rows[key]) delete state.deliveryAcks[key];
  }
  return removed;
}

/** The page and its FIFO custody use the same carrier transaction. */
export function applyOutboxSwap(state: PersistedRangeState, swap: StoreSwap, clone: <T>(value: T) => T): Set<string> {
  // Coverage resets never touch unsent outbox/grant/bound/overlay custody.
  for (const intent of swap.outbox?.remove ?? []) {
    delete state.outbox[intent];
    delete state.overlayMisses[intent];
    delete state.overlay[intent];
    delete state.overlayWatermarks[intent];
    delete state.overlayNegatives[intent];
  }
  const committedNow = new Set<string>();
  for (const entry of swap.outbox?.put ?? []) {
    if (typeof entry.intent !== "string" || entry.intent.length === 0) throw new TypeError("outbox entry needs an intent");
    const previous = state.outbox[entry.intent];
    if (entry.state === "committed" && previous?.state !== "committed") committedNow.add(entry.intent);
    const order = previous?.order ?? entry.order ?? ++state.clock;
    state.outbox[entry.intent] = { ...clone(entry), order };
  }
  if (swap.bounds) state.bounds = clone(swap.bounds);
  if (swap.programs) state.programs = clone(swap.programs);
  for (const id of swap.grants?.remove ?? []) {
    delete state.grants[id];
    if (state.currentGrant === id) delete state.currentGrant;
  }
  for (const grant of swap.grants?.put ?? []) state.grants[grant.id] = clone(grant);
  if (swap.grants?.current === null) delete state.currentGrant;
  else if (typeof swap.grants?.current === "string") {
    if (!state.grants[swap.grants.current]) throw new TypeError("current grant must be a held grant");
    state.currentGrant = swap.grants.current;
  }
  return committedNow;
}
