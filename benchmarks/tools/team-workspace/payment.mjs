import { createHmac } from 'node:crypto';
import { equalSecret, insist, loopbackUrl } from './common.mjs';

// @ref LLP 3000.009#101-the-brief — exact-body signatures and durable retries belong to the neutral provider.
export const sign = (bytes, secret) => 'v1=' + createHmac('sha256', secret).update(bytes).digest('hex');
export const verify = (bytes, signature, secret) => equalSecret(sign(bytes, secret), signature);

export class PaymentProvider {
  constructor(journal, { webhookUrl, signingSecret, retryMs = 100, timeoutMs = 2000 }) {
    this.journal = journal;
    this.url = loopbackUrl(webhookUrl).href;
    insist(signingSecret.length >= 16, 'SIGNING_SECRET_TOO_SHORT');
    Object.assign(this, { signingSecret, retryMs, timeoutMs });
    this.events = new Map(); this.keys = new Map(); this.revisions = new Map();
    this.deliveries = new Map(); this.attempts = [];
    for (const record of journal.records) this.apply(record);
  }
  apply(record) {
    if (record.kind === 'payment.event') {
      this.events.set(record.event.id, record);
      this.keys.set(record.key, record);
      this.revisions.set(record.event.organizationId, record.event.revision);
    } else if (record.kind === 'payment.delivery') {
      this.deliveries.set(record.id, { ...record, attempts: 0, ack: false, done: false, nextAt: 0 });
    } else if (record.kind === 'payment.attempt') {
      this.attempts.push(record);
      const delivery = this.deliveries.get(record.deliveryId);
      insist(delivery, 'JOURNAL_DELIVERY_MISSING');
      Object.assign(delivery, { attempts: delivery.attempts + 1, ack: record.ack,
        done: record.ack || !delivery.retry, nextAt: record.nextAt });
    }
  }
  async persist(record) { await this.journal.append(record); this.apply(record); }
  async create(input, key) {
    insist(typeof key === 'string' && key.length > 0, 'IDEMPOTENCY_KEY_REQUIRED');
    const { organizationId, plan, seatLimit, renewalOffsetMs = null } = input;
    insist(typeof organizationId === 'string' && organizationId.length > 0, 'ORGANIZATION_REQUIRED');
    insist(['free', 'pro', 'past_due'].includes(plan), 'INVALID_PLAN');
    insist(Number.isSafeInteger(seatLimit) && seatLimit >= 1, 'INVALID_SEAT_LIMIT');
    insist(renewalOffsetMs === null || Number.isSafeInteger(renewalOffsetMs), 'INVALID_RENEWAL');
    insist(Object.keys(input).every(k => ['organizationId', 'plan', 'seatLimit', 'renewalOffsetMs'].includes(k)), 'UNKNOWN_EVENT_FIELD');
    const canonical = JSON.stringify({ organizationId, plan, seatLimit, renewalOffsetMs });
    const previous = this.keys.get(key);
    if (previous) { insist(previous.input === canonical, 'IDEMPOTENCY_INPUT_CHANGED'); return previous; }
    const event = { version: 1, id: 'event-' + String(this.events.size + 1).padStart(8, '0'),
      type: 'plan.changed', organizationId, revision: (this.revisions.get(organizationId) ?? 0) + 1,
      plan, seatLimit, renewalAt: renewalOffsetMs === null ? null : Date.now() + renewalOffsetMs };
    // Deliberate whitespace/newline detects receivers that sign a JSON reserialization.
    const raw = Buffer.from(JSON.stringify(event, null, 2) + '\n');
    const record = { kind: 'payment.event', key, input: canonical, event, bodyBase64: raw.toString('base64') };
    await this.persist(record);
    return record;
  }
  async enqueue({ eventIds, signature = 'valid', retry = true }) {
    insist(Array.isArray(eventIds) && eventIds.length > 0 && eventIds.length <= 1000, 'INVALID_EVENT_IDS');
    insist(eventIds.every(id => this.events.has(id)), 'UNKNOWN_EVENT');
    insist(['valid', 'wrong', 'unsigned'].includes(signature) && typeof retry === 'boolean', 'INVALID_DELIVERY');
    const ids = [];
    for (const eventId of eventIds) {
      const id = 'delivery-' + String(this.deliveries.size + 1).padStart(8, '0');
      await this.persist({ kind: 'payment.delivery', id, eventId, signature, retry });
      ids.push(id);
    }
    return ids;
  }
  async deliver(id) {
    const delivery = this.deliveries.get(id);
    insist(delivery, 'UNKNOWN_DELIVERY');
    if (delivery.done) return;
    const event = this.events.get(delivery.eventId);
    const bytes = Buffer.from(event.bodyBase64, 'base64');
    const headers = { 'content-type': 'application/json', 'x-workroom-event-id': delivery.eventId };
    if (delivery.signature !== 'unsigned') headers['x-workroom-signature'] = sign(bytes,
      delivery.signature === 'wrong' ? this.signingSecret + '-wrong' : this.signingSecret);
    let status = null, error = null;
    try {
      const response = await fetch(this.url, { method: 'POST', headers, body: bytes,
        redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      status = response.status;
      await response.body?.cancel();
    } catch (e) { error = e.name; }
    await this.persist({ kind: 'payment.attempt', deliveryId: id, eventId: delivery.eventId,
      status, error, ack: status !== null && status >= 200 && status < 300,
      at: Date.now(), nextAt: Date.now() + this.retryMs });
  }
  async tick({ force = false } = {}) {
    for (const delivery of this.deliveries.values()) {
      if (!delivery.done && (force || delivery.nextAt <= Date.now())) await this.deliver(delivery.id);
    }
  }
  inspect() {
    return { events: [...this.events.values()], deliveries: [...this.deliveries.values()],
      attempts: this.attempts, duplicateAttempts: this.attempts.length - new Set(this.attempts.map(x => x.eventId)).size };
  }
}
