import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Permission, Query, Role } from "node-appwrite";
import {
  databaseId,
  hostAndBobRead,
  hostAndBobWrite,
  hostPermissions,
  hostTeamId,
  runtime,
  saveRuntime,
  storage,
  tableIds,
  tables,
  teamsApi,
  users,
} from "./admin-client.mjs";
import { receiptsRoot } from "./constants.mjs";

// @ref LLP 0102#app-4-partiful-shaped-event-application — Frozen dataset and authority model.
const hash = (value) => createHash("sha256").update(value).digest("hex");
const people = {
  alice: { name: "Alice Host", role: "host", email: "alice@llp0102-partiful.appwrite.test" },
  bob: { name: "Bob Guest", role: "guest", email: "bob@llp0102-partiful.appwrite.test" },
  mallory: { name: "Mallory Outsider", role: "outsider", email: "mallory@llp0102-partiful.appwrite.test" },
};
runtime.personas ??= {};
for (const [id, person] of Object.entries(people)) {
  runtime.personas[id] ??= { ...person, password: randomBytes(24).toString("base64url") };
}
await saveRuntime();

const [existingUsers, existingTeams, existingTables, existingBuckets] = await Promise.all([
  users.list({ total: true }),
  teamsApi.list({ total: true }),
  tables.list({ total: true }),
  storage.listBuckets({ total: true }),
]);
if (existingUsers.total || existingTeams.total || existingTables.total || existingBuckets.total) {
  throw new Error("Provisioning requires a fresh empty Appwrite project");
}
for (const [id, person] of Object.entries(runtime.personas)) {
  await users.create({ userId: id, email: person.email, password: person.password, name: person.name });
}
await teamsApi.create({ teamId: hostTeamId, name: "Party hosts", roles: ["host", "cohost"] });
for (const [userId, roles] of [["alice", ["host"]], ["bob", ["cohost"]]]) {
  const membership = await teamsApi.createMembership({ teamId: hostTeamId, roles, userId });
  runtime.memberships ??= {};
  runtime.memberships[userId] = membership.$id;
}
await saveRuntime();

await tables.create({ databaseId, name: "Partiful", enabled: true });
const tableSpecs = [
  {
    id: tableIds.events,
    name: "Events",
    permissions: [Permission.create(Role.user("alice"))],
    columns: [
      { key: "title", type: "string", size: 160, required: true },
      { key: "description", type: "string", size: 1024, required: true },
      { key: "starts_at", type: "datetime", required: true },
      { key: "public", type: "boolean", required: true },
      { key: "guest_list_visible", type: "boolean", required: true },
      { key: "capacity", type: "integer", required: true },
      { key: "yes_count", type: "integer", required: true },
      { key: "maybe_count", type: "integer", required: true },
      { key: "no_count", type: "integer", required: true },
      { key: "host_id", type: "string", size: 36, required: true },
      { key: "cohost_id", type: "string", size: 36, required: false },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [
      { key: "sequence_idx", type: "key", attributes: ["sequence"], orders: ["ASC"] },
      { key: "public_sequence_idx", type: "key", attributes: ["public", "sequence"], orders: ["ASC", "ASC"] },
    ],
  },
  {
    id: tableIds.eventPrivate,
    name: "Private event details",
    columns: [
      { key: "event_id", type: "string", size: 36, required: true },
      { key: "address", type: "string", size: 256, required: true },
      { key: "host_note", type: "string", size: 512, required: true },
    ],
    indexes: [{ key: "event_unique", type: "unique", attributes: ["event_id"], orders: ["ASC"] }],
  },
  {
    id: tableIds.invitations,
    name: "Invitations",
    columns: [
      { key: "event_id", type: "string", size: 36, required: true },
      { key: "user_id", type: "string", size: 36, required: true },
      { key: "status", type: "string", size: 16, required: true },
      { key: "plus_ones", type: "integer", required: true },
      { key: "revoked", type: "boolean", required: true },
      { key: "nonce", type: "string", size: 64, required: true },
    ],
    indexes: [
      { key: "event_user_unique", type: "unique", attributes: ["event_id", "user_id"], orders: ["ASC", "ASC"] },
      { key: "user_idx", type: "key", attributes: ["user_id"], orders: ["ASC"] },
    ],
  },
  {
    id: tableIds.guests,
    name: "Guests",
    permissions: [Permission.read(Role.user("bob")), Permission.read(Role.user("mallory"))],
    columns: [
      { key: "event_id", type: "string", size: 36, required: true },
      { key: "display_name", type: "string", size: 128, required: true },
      { key: "user_id", type: "string", size: 36, required: false },
      { key: "response", type: "string", size: 16, required: true },
      { key: "plus_ones", type: "integer", required: true },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [{ key: "event_sequence_idx", type: "key", attributes: ["event_id", "sequence"], orders: ["ASC", "ASC"] }],
  },
  {
    id: tableIds.wallPosts,
    name: "Wall posts",
    permissions: [Permission.create(Role.users()), Permission.read(Role.user("bob"))],
    columns: [
      { key: "event_id", type: "string", size: 36, required: true },
      { key: "author_id", type: "string", size: 36, required: true },
      { key: "body", type: "string", size: 1024, required: true },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [{ key: "event_sequence_idx", type: "key", attributes: ["event_id", "sequence"], orders: ["ASC", "ASC"] }],
  },
  {
    id: tableIds.deliveries,
    name: "Notification deliveries",
    columns: [
      { key: "dedupe_key", type: "string", size: 128, required: true },
      { key: "event_id", type: "string", size: 36, required: true },
      { key: "state", type: "string", size: 32, required: true },
      { key: "delivery_count", type: "integer", required: true },
    ],
    indexes: [{ key: "dedupe_unique", type: "unique", attributes: ["dedupe_key"], orders: ["ASC"] }],
  },
  {
    id: tableIds.attempts,
    name: "Effect attempts",
    columns: [
      { key: "dedupe_key", type: "string", size: 128, required: true },
      { key: "attempt_number", type: "integer", required: true },
      { key: "outcome", type: "string", size: 32, required: true },
      { key: "detail", type: "string", size: 512, required: true },
    ],
    indexes: [{ key: "dedupe_attempt_unique", type: "unique", attributes: ["dedupe_key", "attempt_number"], orders: ["ASC", "ASC"] }],
  },
];
for (const spec of tableSpecs) {
  await tables.createTable({
    databaseId,
    tableId: spec.id,
    name: spec.name,
    permissions: spec.permissions ?? [],
    rowSecurity: true,
    enabled: true,
    columns: spec.columns,
    indexes: spec.indexes,
  });
}

async function create(tableId, rowId, data, permissions = hostPermissions) {
  return tables.createRow({ databaseId, tableId, rowId, data, permissions });
}
const eventDate = "2030-06-01T19:00:00.000Z";
for (let sequence = 1; sequence <= 20; sequence += 1) {
  const id = `event-${String(sequence).padStart(2, "0")}`;
  const isPrivate = sequence === 2;
  const permissions = isPrivate
    ? hostAndBobWrite
    : [Permission.read(Role.any()), ...hostPermissions.slice(1)];
  await create(tableIds.events, id, {
    title: sequence === 1 ? "Summer Roof Party" : `Event ${sequence}`,
    description: `Deterministic party fixture ${sequence}`,
    starts_at: eventDate,
    public: !isPrivate,
    guest_list_visible: sequence !== 3,
    capacity: sequence === 20 ? 50 : 100,
    yes_count: sequence === 20 ? 49 : 0,
    maybe_count: 0,
    no_count: 0,
    host_id: "alice",
    cohost_id: sequence === 4 ? "bob" : null,
    sequence,
  }, permissions);
  await create(tableIds.eventPrivate, `private-${String(sequence).padStart(2, "0")}`, {
    event_id: id,
    address: `${100 + sequence} Secret Street`,
    host_note: `private-note-${sequence}`,
  }, isPrivate ? hostAndBobRead : hostPermissions);
}

for (const [id, eventId, userId] of [
  ["invite-event-01-bob", "event-01", "bob"],
  ["invite-event-02-bob", "event-02", "bob"],
  ["invite-event-20-bob", "event-20", "bob"],
  ["invite-event-20-mallory", "event-20", "mallory"],
]) {
  await create(tableIds.invitations, id, {
    event_id: eventId,
    user_id: userId,
    status: "invited",
    plus_ones: 0,
    revoked: false,
    nonce: hash(`${eventId}:${userId}`).slice(0, 32),
  }, [
    Permission.read(Role.user("alice")),
    Permission.update(Role.user("alice")),
    Permission.delete(Role.user("alice")),
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
  ]);
}

const guests = Array.from({ length: 49 }, (_, index) => ({
  $id: `guest-${String(index + 1).padStart(2, "0")}`,
  $permissions: [
    Permission.read(Role.user("alice")),
    Permission.read(Role.user("bob")),
    Permission.read(Role.user("mallory")),
    Permission.update(Role.user("alice")),
  ],
  event_id: "event-20",
  display_name: `Confirmed Guest ${index + 1}`,
  user_id: null,
  response: "yes",
  plus_ones: 0,
  sequence: index + 1,
}));
await tables.createRows({ databaseId, tableId: tableIds.guests, rows: guests });

await create(tableIds.wallPosts, "wall-seed", {
  event_id: "event-02",
  author_id: "alice",
  body: "Welcome invited guests",
  sequence: 0,
}, hostAndBobRead);

await storage.createBucket({
  bucketId: "event-art",
  name: "Event art",
  permissions: [Permission.create(Role.user("alice"))],
  fileSecurity: true,
  enabled: true,
  maximumFileSize: 1048576,
  allowedFileExtensions: ["bin"],
  compression: "none",
  encryption: true,
  antivirus: false,
});

const counts = {};
for (const [name, tableId] of Object.entries(tableIds)) {
  counts[name] = (await tables.listRows({ databaseId, tableId, queries: [Query.limit(1)], total: true })).total;
}
const expected = { events: 20, eventPrivate: 20, invitations: 4, guests: 49, wallPosts: 1, deliveries: 0, attempts: 0 };
if (JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(`Seed mismatch: ${JSON.stringify({ counts, expected })}`);
}
await mkdir(receiptsRoot, { recursive: true });
await writeFile(path.resolve(receiptsRoot, "seed.v1.json"), `${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  counts,
  fixedDataset: { events: 20, contendedGuests: 49, capacity: 50, actors: 3, concurrentClients: 2, wallBurst: 20, assetBytes: 262144 },
  personas: Object.fromEntries(Object.entries(people).map(([id, value]) => [id, { principalIdHash: hash(id), role: value.role }])),
  hostTeamId,
  containsSecretValues: false,
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, counts, secretValuesPrinted: false }));
