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
  return {
    version: 1, sealed: false, clock,
    rows: { [`messages\u0000${id}`]: row, "messages\u0000plain": { table: "messages", id: "plain", row: { id: "plain" } } },
    answers: { [answerKey]: { op: "thread", args, state: "complete", data: { $row: { table: "messages", id } },
      next: null, seq: clock, validator: "v", receipt: { ranges: [], absences: [["messages", "byId", ["absent"]]], verdicts: [true] },
      deliveredAt: 100, refs: [{ table: "messages", id }], order: 1, fingerprint: "fp", retained: true, caughtUp: true, watermark: null } },
    watermarks: { [answerKey]: { op: "thread", args, watermark: null, validator: "v", ...facts, updatedAt: 100, order: 1 } },
    outbox: { [intent]: { intent, grant: "grant", offset: clock, count: 2, ids: [id], op: "send", args: { body: "queued" },
      issuedSeq: clock, state: "queued", predicted: true, trace: { points: [], verdicts: [] }, createdAt: 100, updatedAt: 100, order: 1 } },
    grants: { grant: { id: "grant", from: "start", count: 100, mintedAt: 100, expiresAt: 200, used: clock } },
    currentGrant: "grant", overlay: { [intent]: [row] }, overlayMisses: { [intent]: clock }, bounds: { send: 1 },
    programs: { g: { generation: "g", schemaHash: "s", schema: { tables: {} }, programs: {
      thread: { kind: "query", planHash: "p", ir: { result: null }, certificate: { maxNewIds: 0 } },
    } } },
    facts, superseded: { ...facts, generation: "new" }, negative: { "messages\u0000absent": clock }, rowSeq: { [`messages\u0000${id}`]: clock },
    assets: { [fixtureAsset]: { assetId: fixtureAsset, width: null, type: "image/jpeg", size: 3, lastRead: clock } },
    viewed: { "messages\u0000viewed": { at: 100, assets: ["viewed-asset"] } },
  };
}
