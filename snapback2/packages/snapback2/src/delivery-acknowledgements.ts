// @ref LLP 1019#6-receipts-with-receipts — neither cursor progress nor a
// metadata read proves body receipt. Both identities must be disclosed here.
import { collectRefs, rowKey } from './store/row-values.js';
import type { DeliveryEnvelopeV1 } from './offline-protocol.js';
export interface DeliveryAcknowledgement { op: string; event: string; seq: number; rows: string[]; intent?: string }
export function deliveryAcknowledgements(schema: any, envelope: DeliveryEnvelopeV1): Record<string, DeliveryAcknowledgement> {
  const acks: Record<string, DeliveryAcknowledgement> = {};
  if (envelope.state === 'denied') return acks;
  const disclosed = new Set(collectRefs(envelope.data).map(rowKey));
  const bodies = new Set(envelope.rows.filter(r => disclosed.has(rowKey(r))).map(rowKey));
  const events = new Set([...disclosed, ...envelope.receipt.ranges.flatMap(range => range.rowIds.map(id => `${range.table}\0${id}`))]);
  for (const [content, table] of Object.entries<any>(schema.tables)) {
    const d = table.deliver; if (!d?.receipts) continue;
    for (const event of envelope.rows) {
      if (event.table !== d.log || !events.has(rowKey(event)) || !['delivered','changed'].includes(String(event.row.kind))
        || event.row.recipient !== envelope.authority.principal || !bodies.has(`${content}\0${event.row.row}`)) continue;
      const op = `_delivery.${d.log}.ack`;
      acks[`${op}\0${event.id}`] = { op, event: event.id, seq: envelope.seq, rows: [rowKey(event), `${content}\0${event.row.row}`] };
    }
  }
  return acks;
}
