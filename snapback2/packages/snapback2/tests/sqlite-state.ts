import type { PersistedRangeState } from "../src/store/range-store.js";

export const fixtureAsset = "s2id-00000000000000000000000000000006-0000000000000001";

/** All state fields, with nonempty metadata; JSON values are the wire's value domain. */
export function sqliteState(clock = 1): PersistedRangeState {
  const id = `m\u0000${clock}`;
  const row = { table: "messages", id, row: { id, body: `hello ${clock}`, photo: { id: fixtureAsset, width: 8, height: 8 } } };
  const args = { nested: { a: [1, "雪", null], quote: "\"" } };
  const answerKey = `thread\u0000${JSON.stringify(args)}`;
  const facts = { generation: "g", schemaHash: "s", authEpoch: 2 };
  const intent = `grant:${clock}`;
  const factKey = `messages\0${id}`, digest = 'a'.repeat(64);
  const extentKey = 'fixture-extent-meaning', extent = 'e'.repeat(64);
  return {
    version: 1, sealed: false, clock, onceColumns: { secretPhotos: ["photo"] },
    rows: { [`messages\u0000${id}`]: row, "messages\u0000plain": { table: "messages", id: "plain", row: { id: "plain" } } },
    answers: { [answerKey]: { op: "thread", args, state: "complete", data: { $row: { table: "messages", id } },
      readTime: -clock, clockPlanHash: 'c'.repeat(64), clockOnly: true, rowProofs: { [factKey]: digest }, verdictProofs: {}, needsFactProofs: true,
      extentProofs: [extent],
      next: null, seq: clock, validator: "v", receipt: { ranges: [], absences: [["messages", "byId", ["absent"]]], verdicts: [true] },
      deliveredAt: 100, refs: [{ table: "messages", id }], order: 1, fingerprint: "fp", retained: true, caughtUp: true, watermark: null } },
    watermarks: { [answerKey]: { op: "thread", args, watermark: null, validator: "v", ...facts, updatedAt: 100, order: 1 } },
    outbox: { [intent]: { intent, grant: "grant", offset: clock, count: 2, ids: [id], op: "send", args: { body: "queued" },
      issuedSeq: clock, state: "queued", predicted: true, trace: { points: [], verdicts: [] }, createdAt: 100, updatedAt: 100, order: 1 } },
    grants: { grant: { id: "grant", from: "start", count: 100, mintedAt: 100, expiresAt: 200, used: clock } },
    currentGrant: "grant", overlay: { [intent]: [row] }, overlayMisses: { [intent]: clock },
    // Lane T1's commit-time tail snapshot (null after a reset) and T2's scoped negatives ride the same projection.
    overlayWatermarks: { [intent]: { op: "inbox", args: { c: null }, watermark: `cursor-${clock}`, cursorArg: "c", progress: `cursor-${clock}`, consumed: ["cursor-0"] }, "grant:0": null },
    overlayNegatives: { [intent]: { "messages\u0000absent": { seq: clock, source: "absence" }, "messages\u0000gone": { seq: clock, source: "tombstone" } } },
    bounds: { send: 1 },
    programs: { g: { generation: "g", schemaHash: "s", schema: { tables: {} }, programs: {
      thread: { kind: "query", planHash: "p", ir: { result: null }, certificate: { maxNewIds: 0 } },
    } } },
    facts, superseded: { ...facts, generation: "new" }, negative: { "messages\u0000absent": clock }, rowSeq: { [`messages\u0000${id}`]: clock },
    rowFacts: { [factKey]: [clock, digest] }, verdictFacts: {}, factFormat: 5, factSlots: 11, factLimitReset: 'prior-reset',
    factImages: { [`messages\0${digest}`]: { refs: 2, keys: { byId: [{ Scalar: { Id: id } }] } } },
    factExtents: { [extent]: { refs: 2, condition: { site: 'fixture-extent',ruleHash: 'rule', op: 'thread', table: 'messages', index: 'byId',
      prefix: [{ Scalar: { Id: 'gone' } }], present: [], order: 'Asc', after: null, before: null, gt: null, gte: null, lt: null, lte: null } } },
    extentGuards: { [extentKey]: { id: extent, seq: clock } }, extentNegative: { 'messages\0gone': { seq: clock, active: true, cause: extentKey } },
    assets: { [fixtureAsset]: { assetId: fixtureAsset, width: null, type: "image/jpeg", size: 3, lastRead: clock } },
    viewed: { "messages\u0000viewed": { at: 100, assets: ["viewed-asset"] } },
  };
}
