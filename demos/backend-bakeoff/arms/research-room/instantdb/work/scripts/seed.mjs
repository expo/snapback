import path from "node:path";
import { adminDb, embedding, evidenceDir, queryRows, runtimeDir, sha256, sourceBytes, target, tx, uuid, writeJson } from "./lib.mjs";

const db = await adminDb();
const targetConfig = await target();
const emails = {
  alice: "alice+llp0102-research-instantdb-w3-a1@example.invalid",
  bob: "bob+llp0102-research-instantdb-w3-a1@example.invalid",
  mallory: "mallory+llp0102-research-instantdb-w3-a1@example.invalid",
};
const actorRuntime = {};
for (const [name, email] of Object.entries(emails)) {
  const token = await db.auth.createToken({ email });
  const user = await db.auth.getUser({ email });
  actorRuntime[name] = { email, token, userId: user.id };
}
await writeJson(path.join(runtimeDir, "actors.json"), actorRuntime, 0o600);

const ids = {
  profiles: Object.fromEntries(Object.keys(emails).map((name) => [name, uuid()])),
  rooms: [uuid(), uuid()],
  sources: [],
  files: [],
};
const createdAt = Date.now();
const profileChunks = Object.entries(actorRuntime).map(([name, actor]) =>
  tx.profiles[ids.profiles[name]].update({
    email: actor.email,
    displayName: name[0].toUpperCase() + name.slice(1),
    createdAt,
  }).link({ $user: actor.userId })
);
await db.transact(profileChunks);
await db.transact([
  tx.rooms[ids.rooms[0]].update({ title: "Climate adaptation evidence", createdAt }).link({
    members: [ids.profiles.alice, ids.profiles.bob],
  }),
  tx.rooms[ids.rooms[1]].update({ title: "Private control room", createdAt: createdAt + 1 }).link({
    members: ids.profiles.alice,
  }),
]);

for (let n = 1; n <= 20; n++) {
  const sourceId = uuid();
  const bodyBytes = sourceBytes(n);
  const filePath = `${actorRuntime.alice.userId}/sources/source-${String(n).padStart(2, "0")}.txt`;
  const uploaded = await db.storage.uploadFile(filePath, bodyBytes, { contentType: "text/plain" });
  const fileId = uploaded.data.id;
  const keyword = [1, 5, 9, 13, 17].includes(n);
  await db.transact(
    tx.sources[sourceId].update({
      title: `Source ${String(n).padStart(2, "0")}${keyword ? " climate" : ""}`,
      body: keyword
        ? `climate adaptation evidence for source ${String(n).padStart(2, "0")}`
        : `general research evidence for source ${String(n).padStart(2, "0")}`,
      contentHash: sha256(bodyBytes),
      byteLength: bodyBytes.length,
      embedding: embedding(n),
      createdAt: createdAt + n,
    }).link({
      room: ids.rooms[0],
      owner: ids.profiles.alice,
      file: fileId,
    }),
  );
  ids.sources.push(sourceId);
  ids.files.push({ id: fileId, path: filePath, contentHash: sha256(bodyBytes) });
}
await writeJson(path.join(runtimeDir, "fixture.json"), ids, 0o600);

const inventory = await db.query({
  rooms: { members: {}, sources: { file: {} } },
  profiles: {},
  $users: {},
});
const counts = {
  rooms: queryRows(inventory, "rooms").length,
  primarySources: queryRows(inventory, "rooms").find((r) => r.id === ids.rooms[0])?.sources.length ?? 0,
  profiles: queryRows(inventory, "profiles").length,
  users: queryRows(inventory, "$users").length,
  embeddingsWith32Dimensions: queryRows(inventory, "rooms")
    .flatMap((r) => r.sources ?? [])
    .filter((s) => Array.isArray(s.embedding) && s.embedding.length === 32).length,
};
await writeJson(path.join(evidenceDir, "seed-receipt.json"), {
  schemaVersion: 1,
  seededAt: new Date().toISOString(),
  targetIdentityHash: sha256(targetConfig.appId),
  counts,
  exactWorkload: counts.rooms === 2 && counts.primarySources === 20 && counts.profiles === 3 &&
    counts.embeddingsWith32Dimensions === 20,
  sourceContentHashes: ids.files.map((f) => f.contentHash),
  actorPrincipalHashes: Object.fromEntries(
    Object.entries(actorRuntime).map(([name, a]) => [name, sha256(a.userId)]),
  ),
  containsCredentialValues: false,
});
process.stdout.write(JSON.stringify({ ok: true, counts }) + "\n");
