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
  const alice = createClient({ url: owner.url, persona: "releases" });
  const fresh = createClient({ url: owner.url, persona: "fresh" });
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

test("the committed sample-50 media sequence fits the fixed owner envelope", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/asset-pending", import.meta.url));
  const sampleRoot = new URL("../../../../benchmarks/fixtures/social-messenger/", import.meta.url);
  const actionLog = await readFile(new URL("sample-50.log", sampleRoot), "utf8");
  const actions = actionLog.trim().split("\n").flatMap((line) => {
    const actor = line.split(" ", 3)[1];
    return [...line.matchAll(/media\/[a-z0-9-]+\.(?:png|mp4)/g)].map((match) => ({ actor, path: match[0] }));
  });
  assert.equal(actions.length, 16, "the frozen 50-action log has exactly 16 affine media uses");

  const isolated = await RealOwnerHarness.create({ fixture, forceOwned: true });
  const clients = new Map(["sample-a", "sample-b", "sample-c", "sample-d"].map((persona) => [
    persona, createClient({ url: isolated.url, persona }),
  ]));
  try {
    // A source-bound PNG padded after IEND gives the owner a deterministic
    // receiving window without changing the canonical action sequence below.
    const probeSource = await readFile(new URL("media/img-01.png", sampleRoot));
    const probeBytes = Buffer.concat([probeSource, Buffer.alloc(128 * 1024)]);
    const probeClient = clients.get("sample-a")!;
    let responseBody = "";
    const responseDone = Promise.withResolvers<void>();
    const receiving = await new Promise<{ objects: number; bytes: number }>((resolve, reject) => {
      const upload = request(`${isolated.url}/api/upload`, {
        method: "POST", agent: false, headers: {
          "X-Snapback-As": "sample-a", "Content-Length": String(probeBytes.length),
        },
      }, (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk) => { responseBody += chunk; });
        response.on("end", responseDone.resolve);
        response.on("error", (error) => { responseDone.reject(error); reject(error); });
      });
      upload.on("error", reject);
      upload.write(probeBytes.subarray(0, 64 * 1024), async () => {
        try {
          for (let attempt = 0; attempt < 100; attempt++) {
            const listing = await probeClient.listUploads();
            if (listing.uploads.some((entry) => entry.state === "receiving")) {
              resolve(listing.usage);
              upload.end(probeBytes.subarray(64 * 1024));
              return;
            }
            await new Promise((done) => setTimeout(done, 10));
          }
          reject(new Error("the paused upload never exposed its receiving ledger row"));
          upload.destroy();
        } catch (error) { reject(error); upload.destroy(); }
      });
    });
    assert.deepEqual(receiving, { objects: 1, bytes: probeBytes.length });
    await responseDone.promise;
    const probe = JSON.parse(responseBody);
    assert.equal(typeof probe.id, "string", JSON.stringify(probe));
    assert.equal(await probeClient.discardUpload(probe.id), true);

    const uploaded: Array<{ actor: string; kind: "image" | "video"; record: any; rowId?: string }> = [];
    await Promise.all([0, 1].map(async (lane) => {
      for (let index = lane; index < actions.length; index += 2) {
        const action = actions[index]!;
        const bytes = await readFile(new URL(action.path, sampleRoot));
        const kind = action.path.endsWith(".mp4") ? "video" : "image";
        const type = kind === "video" ? "video/mp4" : "image/png";
        const source = new File([bytes], action.path.slice("media/".length), { type });
        const record = kind === "video"
          ? await clients.get(action.actor)!.upload(source, { kind: "video" })
          : await clients.get(action.actor)!.upload(source, { kind: "image" });
        uploaded[index] = { ...action, kind, record };
      }
    }));
    assert.equal(new Set(uploaded.map(({ record }) => record.id)).size, 16);
    const unreleased = await Promise.all([...clients.values()].map((client) => client.listUploads()));
    assert.equal(unreleased.reduce((sum, listing) => sum + listing.usage.objects, 0), 16);
    assert.ok(unreleased.every((listing) => listing.uploads.every((entry) => entry.state === "ready" && !entry.releasedAt)));
    const unreleasedBytes = unreleased.reduce((sum, listing) => sum + listing.usage.bytes, 0);

    await Promise.all(uploaded.map(async (item) => {
      const client = clients.get(item.actor)!;
      const result = item.kind === "video"
        ? await client.mutation(api.media.keepVideo, { video: item.record })
        : await client.mutation(api.media.keep, { photo: item.record });
      assert.equal(result.state, "committed", JSON.stringify(result));
      item.rowId = result.data.id;
    }));
    const attached = await Promise.all([...clients.values()].map((client) => client.listUploads()));
    assert.ok(attached.every((listing) => listing.usage.objects === 0 && listing.usage.bytes === 0));

    await Promise.all(uploaded.map(async (item) => {
      const client = clients.get(item.actor)!;
      const result = item.kind === "video"
        ? await client.mutation(api.media.releaseVideo, { rowId: item.rowId })
        : await client.mutation(api.media.release, { rowId: item.rowId });
      assert.equal(result.state, "committed", JSON.stringify(result));
    }));
    const released = await Promise.all([...clients.values()].map((client) => client.listUploads()));
    assert.equal(released.reduce((sum, listing) => sum + listing.uploads.length, 0), 16);
    assert.equal(released.reduce((sum, listing) => sum + listing.usage.objects, 0), 0);
    assert.equal(released.reduce((sum, listing) => sum + listing.usage.bytes, 0), unreleasedBytes);
    assert.ok(released.every((listing) => listing.uploads.every((entry) =>
      entry.state === "ready" && Number.isSafeInteger(entry.releasedAt) && !entry.reclaiming)));
    console.error(JSON.stringify({
      phase: "sample-50-media-lifecycle", actions: actions.length,
      receivingPeak: receiving, unreleasedReadyPeak: { objects: 16, bytes: unreleasedBytes },
      releasedReady: { objects: 16, chargedObjects: 0, bytes: unreleasedBytes },
      failed: { objects: 0, bytes: 0 }, tombstoned: { objects: 0, bytes: 0 },
    }));
  } finally {
    for (const client of clients.values()) await client.close();
    await isolated.close();
  }
});
