import { fixtureClient as createClient } from "./live-fixture.ts";
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
import { api } from "../dist/client.mjs";
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

function sse(value?: unknown, hang = false): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      if (value !== undefined) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      if (!hang) controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A manifest whose delivery log names its cursor argument `after`, not the recipe's `c`. */
function afterManifest(url: URL): Response | undefined {
  if (url.pathname === "/api/manifest") {
    return new Response(JSON.stringify({
      generation: "schema-generation", programGeneration: generation, channels: {}, auth: {},
      ops: { "deliveries.inbox": { kind: "query", planHash, drain: { cursor: "after" }, args: { aAux: { Optional: "Cursor" }, after: { Optional: "Cursor" } } } },
    }), { status: 200 });
  }
  return metadataResponse(url);
}

test("the returned-page cursor drives drain and resume, ahead of an auxiliary Cursor argument or c", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-cursor-name-"));
  const open: Array<{ close(): void }> = [];
  try {
    const pages: unknown[] = [];
    const tails: unknown[] = [];
    const client = createClient({
      url: "http://cursor-name.test", as: "alice", offline: { store: fileRangeStore(root) },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const metadata = afterManifest(url);
        if (metadata) return metadata;
        if (url.pathname === "/api/resume") return new Response(JSON.stringify({
          seq: 9, generation, schemaHash, authority: { principal: "dev:alice", authEpoch: 7 },
          log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        if (url.pathname === "/api/query") {
          const args = JSON.parse(String(init?.body)).args;
          assert.equal("c" in args || "aAux" in args, false, "neither c nor an auxiliary cursor drives the returned page");
          pages.push(args.after);
          const next = args.after === null ? "k1" : null;
          const page = envelope([args.after], String(pages.length).repeat(64), pages.length);
          page.state = next === null ? "complete" : "capped";
          page.next = next;
          return new Response(JSON.stringify(page), { status: 200 });
        }
        if (url.pathname === "/api/subscribe") {
          const args = JSON.parse(url.searchParams.get("args") ?? "{}");
          assert.equal("c" in args, false, "the tail is not watched under c");
          tails.push(args.after);
          return sse(undefined, true);
        }
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    open.push(client);
    await client.ready;
    // The drain is mounted before ready settles on a fresh client too: the name resolves after the manifest.
    const early = createClient({
      url: "http://cursor-name.test", as: "alice", offline: { store: fileRangeStore(root) },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const metadata = afterManifest(url);
        if (metadata) return metadata;
        if (url.pathname === "/api/resume") return new Response(JSON.stringify({
          seq: 9, generation, schemaHash, authority: { principal: "dev:alice", authEpoch: 7 },
          log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        if (url.pathname === "/api/query") {
          const args = JSON.parse(String(init?.body)).args;
          assert.equal("c" in args, false, "a drain mounted before ready still asks under the manifest's name");
          return new Response(JSON.stringify({ ...envelope([], "9".repeat(64), 9), state: "complete", next: null }), { status: 200 });
        }
        if (url.pathname === "/api/subscribe") return sse(undefined, true);
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    open.push(early);
    const earlyDrain = early.subscribe(api.deliveries.inbox as any, { after: null }, () => undefined, { drain: true });
    await earlyDrain.until((value) => value.caughtUp === true, 2_000);
    earlyDrain.close();
    early.close();

    const drain = client.subscribe(api.deliveries.inbox as any, { after: null }, () => undefined, { drain: true });
    await drain.until((value) => value.state === "complete" && value.caughtUp === true && value.watermark === "k1", 2_000);
    // The tail subscription opens a tick after the caught-up delivery.
    for (let attempt = 0; attempt < 100 && tails.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(pages, [null, "k1"]);
    assert.deepEqual(tails, ["k1"]);
    drain.close();
    client.close();
    const inspect = fileRangeStore(root)();
    await inspect.open("dev:alice");
    const watermark = (await inspect.coverage()).watermarks.find((item) => item.op === "deliveries.inbox");
    assert.deepEqual(watermark?.args, { after: null });
    assert.equal(watermark?.cursorArg, "after", "the watermark keeps the manifest-named cursor for store-side tail matching");
    assert.equal(watermark?.watermark, "k1");
    assert.equal(watermark?.validator, "2".repeat(64), "the watermark carries the validator of the page held under { after: k1 }");
    await inspect.close?.();

    // A cold resume answers the tail after k1; it is filed under { after: "k1" }, never { c: "k1" }.
    let request: any;
    const cold = createClient({
      url: "http://cursor-name.test", as: "alice", offline: { store: fileRangeStore(root) },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const metadata = afterManifest(url);
        if (metadata) return metadata;
        if (url.pathname === "/api/resume") {
          request = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({
            seq: 5, generation, schemaHash, authority: { principal: "dev:alice", authEpoch: 7 },
            log: { ...envelope(["tail"], "5".repeat(64), 5), watermark: "k2" }, mounted: [],
          }), { status: 200 });
        }
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    open.push(cold);
    await cold.ready;
    assert.deepEqual(request.log, { op: "deliveries.inbox", args: { after: null }, watermark: "k1", validator: "2".repeat(64) });
    await cold.offline();
    const first = await cold.query<any, any>(api.deliveries.inbox as any, { after: null });
    assert.deepEqual("data" in first ? first.data : undefined, [null], "the drained first page is still held");
    const tail = await cold.query<any, any>(api.deliveries.inbox as any, { after: "k1" });
    assert.deepEqual("data" in tail ? tail.data : undefined, ["tail"], "the tail is held under the manifest's cursor argument");
    const wrong = await cold.query<any, any>(api.deliveries.inbox as any, { after: null, c: "k1" });
    assert.equal(wrong.state, "hydrating", "nothing was ever filed under c");
  } finally {
    for (const client of open) client.close();
    await rm(root, { recursive: true, force: true });
  }
});
