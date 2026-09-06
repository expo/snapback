import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { api, createClient } from "../dist/client.mjs";
import { RealOwnerHarness } from "./owner-harness.ts";

// An isolated authored Quarry project, never a benchmark DB or an external owner.
assert.equal(process.env.SNAPBACK_URL, undefined, "asset pending witness requires its own owner");
const owner = await RealOwnerHarness.create({ fixture: fileURLToPath(new URL("./fixtures/asset-pending", import.meta.url)) });
after(async () => owner.close());
const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
const file = () => new File([png], "photo.png", { type: "image/png" });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("43 public claims, 40 successful releases, restart and a fresh small upload preserve original custody", async (t) => {
  const alice = createClient({ url: owner.url, as: "releases" });
  const fresh = createClient({ url: owner.url, as: "fresh" });
  const rows: any[] = [];
  try {
    for (let index = 0; index < 43; index++) {
      const result = await alice.mutation(api.media.keep, { photo: file() });
      assert.equal(result.state, "committed", `claim ${index}: ${JSON.stringify(result)}`);
      rows.push(result.data);
    }
    assert.equal(new Set(rows.map((row) => row.photo.id)).size, 43, "equal bytes have distinct asset identities");
    assert.deepEqual((await alice.listUploads()).usage, { objects: 0, bytes: 0 });
    const blobPath = (id: string) => `${owner.root}/.snapback/blobs/${id}`;
    const original = await readFile(blobPath(rows[0].photo.id));
    const rung = await fetch(await alice.assetUrl(rows[0].photo, { width: 1 }), { headers: await alice.assetHeaders() });
    assert.equal(rung.status, 200);
    await rung.arrayBuffer();
    for (let index = 0; index < 40; index++) {
      const result = await alice.mutation(api.media.release, { rowId: rows[index].id });
      assert.equal(result.state, "committed", `release ${index}: ${JSON.stringify(result)}`);
    }
    const released = await alice.listUploads();
    assert.equal(released.uploads.length, 40);
    assert.deepEqual(released.usage, { objects: 0, bytes: 40 * Math.max(png.length, original.length) });
    assert.ok(released.uploads.every((upload) => upload.state === "ready" && Number.isSafeInteger(upload.releasedAt) && !upload.reclaiming));
    assert.deepEqual((await fresh.listUploads()).usage, { objects: 0, bytes: 0 });
    assert.deepEqual((await fresh.listUploads()).uploads, []);
    assert.equal(await fresh.discardUpload(rows[0].photo.id), false);
    // The authored bound admits this length, but released original charges must
    // refuse it before reading a body. No large buffer or physical fixture needed.
    const byteRefusal = await new Promise<any>((resolve, reject) => {
      const upload = request(`${owner.url}/api/upload`, { method: "POST", agent: false, headers: {
        "X-Snapback-As": "releases", "Content-Length": String(256 * 1024 * 1024),
      } }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try { resolve({ status: response.statusCode, ...JSON.parse(body) }); }
          catch (error) { reject(error); }
        });
      });
      upload.setTimeout(2_000, () => upload.destroy(new Error("byte admission did not refuse before the body")));
      upload.on("error", reject);
      upload.end();
    });
    assert.equal(byteRefusal.status, 422);
    assert.equal(byteRefusal.code, "E_ASSET_TOO_LARGE");
    assert.match(byteRefusal.message, /byte admission/);
    assert.ok(byteRefusal.message.includes(`${released.usage.bytes} /`));
    const unavailable = await fetch(await alice.assetUrl(rows[0].photo), { headers: await alice.assetHeaders() });
    assert.equal(unavailable.status, 404); await unavailable.arrayBuffer();
    console.error(JSON.stringify({ phase: "40-releases", listing: released, byteRefusal, originalSha256: hash(original) }));

    await owner.stop(); await owner.start(false);
    assert.deepEqual(await alice.listUploads(), released, "restart reconstructs identical usage and release clocks");
    for (const row of rows) assert.equal(hash(await readFile(blobPath(row.photo.id))), hash(original), "unexpired originals survive boot GC");
    const small = await fresh.upload(file(), { kind: "image" });
    assert.ok(!rows.some((row) => row.photo.id === small.id));
    assert.equal((await fresh.listUploads()).usage.objects, 1);
    assert.equal(await fresh.discardUpload(small.id), true);
    // Re-claim the exact released record through the public mutation API.
    const reclaimed = await alice.mutation(api.media.keep, { photo: rows[0].photo });
    assert.equal(reclaimed.state, "committed");
    const delivered = await fetch(await alice.assetUrl(rows[0].photo), { headers: await alice.assetHeaders() });
    assert.equal(delivered.status, 200);
    assert.equal(hash(new Uint8Array(await delivered.arrayBuffer())), hash(original));
    for (const row of rows.slice(40)) {
      const result = await alice.query(api.media.get, { rowId: row.id });
      assert.equal(result.data.photo.id, row.photo.id, "the three retained rows stay live");
    }
    console.error(JSON.stringify({ phase: "restart-and-new-upload", newAsset: small, finalUsage: (await alice.listUploads()).usage }));
  } finally { await alice.close(); await fresh.close(); }
});
