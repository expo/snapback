import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { api, createClient } from "../dist/client.mjs";
import { RealOwnerHarness } from "./owner-harness.ts";

// An isolated authored Quarry project, never a benchmark DB or an external owner.
assert.equal(process.env.SNAPBACK_URL, undefined, "asset pending witness requires its own owner");
const owner = await RealOwnerHarness.create({ fixture: fileURLToPath(new URL("./fixtures/asset-pending", import.meta.url)) });
after(async () => owner.close());
const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
const file = () => new File([png], "photo.png", { type: "image/png" });

test("public never-claimed uploads still hit 20 creator and 40 owner slots without disclosing other creators", async (t) => {
  const a = createClient({ url: owner.url, persona: "pending-a" });
  const b = createClient({ url: owner.url, persona: "pending-b" });
  const guest = createClient({ url: owner.url, persona: "pending-guest" });
  const owned: [any, string][] = [];
  try {
    for (const client of [a, b]) {
      const unused = await client.upload(file(), { kind: "image" });
      owned.push([client, unused.id]);
      const inspected = await client.mutation(api.media.inspect, { photo: unused });
      assert.equal(inspected.state, "committed");
      assert.deepEqual((await client.listUploads()).usage, { objects: 0, bytes: 0 },
        "a committed return-only mutation discards its unused staged argument");
      for (let index = 0; index < 20; index++) {
        const photo = await client.upload(file(), { kind: "image" });
        owned.push([client, photo.id]);
      }
      const listing = await client.listUploads();
      assert.equal(listing.usage.objects, 20);
      assert.equal(listing.uploads.length, 20);
      assert.ok(listing.uploads.every((upload) => upload.releasedAt === null && !upload.reclaiming));
      await assert.rejects(client.upload(file()), (error: any) => {
        assert.equal(error.code, "E_ASSET_TOO_LARGE");
        assert.match(error.message, /pending object/);
        t.diagnostic(JSON.stringify({ phase: "creator-cap", refusal: error.envelope ?? error.message }));
        return true;
      });
    }
    assert.deepEqual((await guest.listUploads()).usage, { objects: 0, bytes: 0 });
    assert.deepEqual((await guest.listUploads()).uploads, []);
    assert.equal(await guest.discardUpload(owned[0][1]), false);
    await assert.rejects(guest.upload(file()), (error: any) => {
      assert.equal(error.code, "E_ASSET_TOO_LARGE");
      assert.match(error.message, /owner pending object/);
      assert.match(error.message, /your usage is 0 pending objects/);
      assert.ok(!error.message.includes(owned[0][1]));
      t.diagnostic(JSON.stringify({ phase: "owner-cap", refusal: error.envelope ?? error.message }));
      return true;
    });
  } finally {
    for (const [client, id] of owned) await client.discardUpload(id);
    await a.close(); await b.close(); await guest.close();
  }
});

test("21 public replacements free pending slots and preserve released byte charges", async (t) => {
  const client = createClient({ url: owner.url, persona: "replacements" });
  try {
    const kept = await client.mutation(api.media.keep, { photo: file() });
    assert.equal(kept.state, "committed");
    for (let index = 0; index < 21; index++) {
      const result = await client.mutation(api.media.replace, { rowId: kept.data.id, photo: file() });
      assert.equal(result.state, "committed");
    }
    const listing = await client.listUploads();
    assert.equal(listing.uploads.length, 21);
    assert.equal(listing.usage.objects, 0);
    assert.equal(listing.usage.bytes, listing.uploads.reduce((sum, upload) => sum + upload.bytes, 0));
    t.diagnostic(JSON.stringify({ phase: "21-replacements", usage: listing.usage }));
  } finally { await client.close(); }
});
