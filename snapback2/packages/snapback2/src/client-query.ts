// @ref LLP 1018.008.007.002#4-one-local-delivery-transaction-per-chunk —
// transport frames retain their arguments; only independently durable groups publish.
import { acceptOffline } from './client-offline.js';
import { RefusalError, wireObject, wireQuery, wireRefusal, wireShape } from './client-wire.js';
import { DeliveryEnvelopeDecodeError, ownDeliveryEnvelope } from './offline-protocol.js';
import type { OfflineRuntime } from './offline.js';
import { stableSerialize, type QueryResult } from './types.js';

/** Initial bounded group; the transport may contain up to sixteen frames. */
const COMMIT_PAGES = 4;

export async function commitQuery<Result>(options: {
  runtime?: OfflineRuntime; op: string; args: unknown; raw: unknown; batch: boolean;
  revision?: number; deliveryOrder?: number; current(): boolean;
  failure(error: unknown): Error; revalidate(): Promise<unknown>;
}): Promise<{ pages: QueryResult<Result>[]; superseded: boolean }> {
  const { runtime, op, args, raw, revision, deliveryOrder } = options;
  const batch = options.batch && raw && typeof raw === 'object' && 'pages' in raw
    ? wireObject(raw, 'query batch') : undefined;
  let frames = [{ args, envelope: raw }];
  if (batch) {
    if (!Array.isArray(batch.pages) || batch.pages.length > 16 || typeof batch.more !== 'boolean'
      || (!batch.pages.length && !batch.error)) throw wireShape('query batch requires bounded pages and a continuation');
    if (batch.pages.length > 1 && new TextEncoder().encode(JSON.stringify(batch)).length > 1024 * 1024)
      throw wireShape('query batch exceeds its byte budget');
    const cursor = runtime!.drainCursor(op), seen = new Set<unknown>();
    let expected = args;
    // Validate the entire transport before any durable subgroup; commit-time
    // authority and cross-frame contradiction checks still belong to the store.
    const sourcePages = batch.pages;
    frames = sourcePages.map((value, index) => {
      const frame = wireObject(value, 'query batch page');
      if (stableSerialize(frame.args) !== stableSerialize(expected)) throw wireShape('query batch arguments do not follow its cursor chain');
      let envelope;
      try { envelope = ownDeliveryEnvelope(frame.envelope); }
      catch (error) { if (error instanceof DeliveryEnvelopeDecodeError) throw wireShape(error.message); throw error; }
      const position = (expected as Record<string, unknown>)[cursor];
      seen.add(position);
      if (envelope.next !== null && seen.has(envelope.next)) throw wireShape('query batch repeated a cursor');
      if (index < sourcePages.length - 1 && (envelope.next === null || !['complete', 'capped'].includes(envelope.state)))
        throw wireShape('query batch continues after a terminal page');
      expected = { ...(args as Record<string, unknown>), [cursor]: envelope.next };
      return { args: structuredClone(frame.args), envelope };
    });
    const last = frames.at(-1)?.envelope as { next: unknown; state: string } | undefined;
    if (batch.more && (!last || last.next === null || !['complete', 'capped'].includes(last.state) || batch.error))
      throw wireShape('query batch continuation has no advancing page');
    if (!batch.more && !batch.error && last?.next !== null && ['complete', 'capped'].includes(last?.state ?? ''))
      throw wireShape('query batch omitted its continuation');
    if (batch.error) {
      wireRefusal(batch.error, 'query batch refusal');
      if (last && (last.next === null || !['complete', 'capped'].includes(last.state)))
        throw wireShape('query batch refusal follows a terminal page');
    }
  }
  const items = [];
  for (const frame of frames) {
    const accepted = await acceptOffline<Result>(runtime, op, frame.args, frame.envelope, wireShape,
      batch ? undefined : options.revalidate);
    wireQuery(accepted.result);
    items.push({ op, args: frame.args, accepted });
  }
  let superseded = false, committed = 0;
  for (let offset = 0; offset < items.length; offset += COMMIT_PAGES) {
    if (!options.current()) throw options.failure(new Error('query authority changed'));
    const group = items.slice(offset, offset + COMMIT_PAGES);
    try {
      superseded ||= runtime ? await runtime.commitMany(group, undefined, undefined, revision,
        options.current, undefined, deliveryOrder) : false;
    } catch (error) { throw options.failure(error); }
    if (!options.current()) throw options.failure(new Error('query authority changed'));
    if (superseded || revision !== runtime?.coverageRevision) break;
    committed += group.length;
  }
  // Publish a durable advancing prefix; its next request exposes any still-current
  // owner refusal. Throwing here would hide accepted pages from the drain.
  if (batch?.error && !committed) throw new RefusalError(wireRefusal(batch.error, 'query batch refusal'));
  const published = batch ? items.slice(0, committed) : items;
  const pages = published.map(item => wireQuery<Result>(item.accepted.result));
  if (runtime && published.length && !superseded && revision === runtime.coverageRevision) {
    const ledger = { entries: await runtime.itemEntries(), compactedThrough: await runtime.compactedThrough() };
    for (const [index, item] of published.entries()) {
      pages[index] = await runtime.withQueryItems(op, item.args, item.accepted, pages[index], ledger);
    }
  }
  return { pages, superseded };
}
