// The resume log is the page after the watermark (writer_resume log_args) and is
// held under that cursor's args; the drained first page under `c: null` survives.
// Found by lane O4's journey run: O2a's offline-drain journey failed on the
// integration commit with "conflicting deliveries for deliveries.inbox at seq N"
// once O1b's real /api/resume answered a restart's resume with an empty tail.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { fileRangeStore } from "../dist/test.mjs";

const generation = "d".repeat(64);
const schemaHash = "e".repeat(64);
const planHash = "f".repeat(64);
const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });

function envelope(data: unknown, validator: string, seq: number) {
  return {
    protocol: 1, generation, schemaHash, planHash,
    authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete", data, next: null, seq,
    rows: [], receipt: emptyReceipt(), validator,
  };
}

function metadataResponse(url: URL): Response | undefined {
  if (url.pathname === "/api/manifest") {
    return new Response(JSON.stringify({
      generation: "schema-generation", programGeneration: generation, ops: {}, channels: {}, auth: {},
    }), { status: 200 });
  }
  if (url.pathname === "/api/program") {
    return new Response(JSON.stringify({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }), { status: 404 });
  }
  return undefined;
}

test("a resume answered with the tail after the watermark is held under the cursor args and never replaces the drained first page", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-resume-tail-"));
  try {
    const store = fileRangeStore(root)();
    await store.open("dev:alice");
    await store.commit({
      deliveries: [{
        op: "deliveries.inbox", args: { c: null }, state: "complete", data: ["first page"], next: null, seq: 3,
        validator: "1".repeat(64), receipt: emptyReceipt(),
      }],
      watermark: {
        op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64),
        generation, schemaHash, authEpoch: 7, updatedAt: 10,
      },
    });
    await store.close?.();
    let request: any;
    const client = createClient({
      url: "http://resume-tail.test", as: "alice", offline: { store: fileRangeStore(root) },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const metadata = metadataResponse(url);
        if (metadata) return metadata;
        if (url.pathname === "/api/resume") {
          request = JSON.parse(String(init?.body));
          // The same seq as the held first page, different bytes: the tail after cursor-9 is empty.
          return new Response(JSON.stringify({
            seq: 3, generation, schemaHash, authority: { principal: "dev:alice", authEpoch: 7 },
            log: { ...envelope([], "2".repeat(64), 3), watermark: "cursor-9" }, mounted: [],
          }), { status: 200 });
        }
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    await client.ready;
    assert.deepEqual(request.log, { op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64) });
    await client.offline();
    const first = await client.query<any, any>(api.deliveries.inbox as any, { c: null });
    assert.deepEqual("data" in first ? first.data : undefined, ["first page"], "the drained first page is still held");
    const tail = await client.query<any, any>(api.deliveries.inbox as any, { c: "cursor-9" });
    assert.deepEqual("data" in tail ? tail.data : undefined, [], "the tail is held under its cursor");
    client.close();
    const inspect = fileRangeStore(root)();
    await inspect.open("dev:alice");
    const watermark = (await inspect.coverage()).watermarks.find((item) => item.op === "deliveries.inbox");
    assert.equal(watermark?.watermark, "cursor-9");
    assert.equal(watermark?.validator, "2".repeat(64), "the watermark carries the tail's validator");
    await inspect.close?.();
  } finally { await rm(root, { recursive: true, force: true }); }
});
