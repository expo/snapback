import { assertRefused } from "./live-fixture.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { api,
  createClient,
  initialQueryState,
  reduceQueryState } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import { configureRealOwner, RealOwnerHarness } from "./owner-harness.ts";

const owner = await configureRealOwner();
after(async () => owner.close());

test("real owner ordinary private bytes are cacheable only with owner revalidation", async () => {
  const { readFile } = await import("node:fs/promises");
  const client = createClient({ url: owner.url, persona: "alice" });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await client.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const posted = await client.mutation(api.messages.sendPhoto, { conversationId: "conversation-1", photo });
    assert.equal(posted.state, "committed");
    const url = (await client.assetUrl(photo))!;
    const preflight = await fetch(url, { method: "OPTIONS", headers: {
      Origin: "http://client.example", "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "cache-control,x-snapback-as",
    } });
    assert.equal(preflight.status, 204);
    assert.ok(preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase().split(/,\s*/).includes("cache-control"));
    const headers = await client.assetHeaders();
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-cache");
    const bytes = await response.arrayBuffer(); assert.ok(bytes.byteLength > 0);
    const partial = await fetch(url, { headers: { ...headers, Range: "bytes=0-9" } });
    assert.equal(partial.status, 206); assert.equal(partial.headers.get("Cache-Control"), "private, no-cache"); await partial.arrayBuffer();
    const conditional = await fetch(url, { headers: { ...headers, "If-None-Match": response.headers.get("ETag")! } });
    assert.equal(conditional.status, 304); assert.equal(conditional.headers.get("Cache-Control"), "private, no-cache");
  } finally { await client.close(); }
});

test("twenty-four refused File mutations recover their staging quota immediately", async () => {
  const { readFile } = await import("node:fs/promises");
  const client = createClient({ url: owner.url, persona: "upload-refusals" });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    for (let index = 0; index < 24; index++) {
      const result = await client.mutation(api.messages.sendPhoto, {
        conversationId: "conversation-1", photo: new File([png], "photo.png", { type: "image/png" }),
      });
      assert.equal(result.state, "rejected", `attempt ${index} returns the mutation refusal, not a quota failure`);
      const listing = await client.listUploads();
      assert.deepEqual(listing.usage, { bytes: 0, objects: 0 });
      assert.deepEqual(listing.uploads, []);
    }
  } finally { await client.close(); }
});

test("cyclic mutation arguments release uploaded bytes without sending a mutation", async () => {
  const { readFile } = await import("node:fs/promises");
  let mutations = 0;
  let uploads = 0;
  const client = createClient({ url: owner.url, persona: "upload-serialization", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/mutation") mutations++;
    if (path === "/api/upload") uploads++;
    return fetch(input, init);
  } });
  const metadata: any = {};
  metadata.self = metadata;
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    for (let index = 0; index < 24; index++) {
      await assertRefused(client.mutation(api.messages.sendPhoto, {
        conversationId: "conversation-1", photo: new File([png], "photo.png"), metadata,
      } as any), (value: any) => value.state === "rejected" && /circular|cyclic/i.test(value.message));
      const listing = await client.listUploads();
      assert.deepEqual(listing.usage, { bytes: 0, objects: 0 });
      assert.deepEqual(listing.uploads, []);
    }
    assert.equal(uploads, 24);
    assert.equal(mutations, 0);
  } finally { await client.close(); }
});
