import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { InputFile } from "node-appwrite/file";
import {
  bucketId,
  databaseId,
  memberRead,
  memberTeamId,
  ownerWrite,
  Permission,
  Query,
  Role,
  runtime,
  saveRuntime,
  storage,
  tableIds,
  tables,
  teamsApi,
  users,
} from "./admin-client.mjs";
import { receiptsRoot } from "./constants.mjs";

// @ref LLP 0102#app-5-collaborative-ai-research-room — Frozen dataset and authority model.
const hash = (value) => createHash("sha256").update(value).digest("hex");
const people = {
  alice: {
    name: "Alice Researcher",
    role: "owner",
    email: "alice@llp0102-research.appwrite.test",
  },
  bob: {
    name: "Bob Collaborator",
    role: "member",
    email: "bob@llp0102-research.appwrite.test",
  },
  mallory: {
    name: "Mallory Outsider",
    role: "outsider",
    email: "mallory@llp0102-research.appwrite.test",
  },
};
runtime.personas ??= {};
for (const [id, person] of Object.entries(people)) {
  runtime.personas[id] ??= {
    ...person,
    password: randomBytes(24).toString("base64url"),
  };
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
  await users.create({
    userId: id,
    email: person.email,
    password: person.password,
    name: person.name,
  });
}
await teamsApi.create({
  teamId: memberTeamId,
  name: "Research Room members",
  roles: ["owner", "member"],
});
for (const [userId, roles] of [["alice", ["owner"]], ["bob", ["member"]]]) {
  const membership = await teamsApi.createMembership({
    teamId: memberTeamId,
    roles,
    userId,
  });
  runtime.memberships ??= {};
  runtime.memberships[userId] = membership.$id;
}
await saveRuntime();

await tables.create({ databaseId, name: "Research Room", enabled: true });
const tableSpecs = [
  {
    id: tableIds.rooms,
    name: "Rooms",
    columns: [
      { key: "name", type: "string", size: 160, required: true },
      { key: "owner_id", type: "string", size: 36, required: true },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [
      { key: "sequence_idx", type: "key", attributes: ["sequence"], orders: ["ASC"] },
    ],
  },
  {
    id: tableIds.memberships,
    name: "Room memberships",
    columns: [
      { key: "room_id", type: "string", size: 36, required: true },
      { key: "user_id", type: "string", size: 36, required: true },
      { key: "role", type: "string", size: 24, required: true },
    ],
    indexes: [
      {
        key: "room_user_unique",
        type: "unique",
        attributes: ["room_id", "user_id"],
        orders: ["ASC", "ASC"],
      },
      { key: "user_idx", type: "key", attributes: ["user_id"], orders: ["ASC"] },
    ],
  },
  {
    id: tableIds.sources,
    name: "Sources",
    permissions: [Permission.create(Role.team(memberTeamId))],
    columns: [
      { key: "room_id", type: "string", size: 36, required: true },
      { key: "file_id", type: "string", size: 36, required: true },
      { key: "filename", type: "string", size: 256, required: true },
      { key: "content_text", type: "string", size: 4096, required: true },
      { key: "content_hash", type: "string", size: 64, required: true },
      { key: "embedding_json", type: "string", size: 2048, required: true },
      { key: "owner_id", type: "string", size: 36, required: true },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [
      {
        key: "room_sequence_idx",
        type: "key",
        attributes: ["room_id", "sequence"],
        orders: ["ASC", "ASC"],
      },
      { key: "source_text_search", type: "fulltext", attributes: ["content_text"] },
    ],
  },
  {
    id: tableIds.questions,
    name: "Questions",
    permissions: [Permission.create(Role.team(memberTeamId))],
    columns: [
      { key: "room_id", type: "string", size: 36, required: true },
      { key: "asker_id", type: "string", size: 36, required: true },
      { key: "prompt", type: "string", size: 2048, required: true },
      { key: "idempotency_key", type: "string", size: 128, required: true },
      { key: "status", type: "string", size: 24, required: true },
      { key: "cancelled", type: "boolean", required: true },
    ],
    indexes: [
      {
        key: "idempotency_unique",
        type: "unique",
        attributes: ["idempotency_key"],
        orders: ["ASC"],
      },
    ],
  },
  {
    id: tableIds.answers,
    name: "Answers",
    columns: [
      { key: "question_id", type: "string", size: 36, required: true },
      { key: "status", type: "string", size: 24, required: true },
      { key: "body", type: "string", size: 4096, required: true },
      { key: "citations_json", type: "string", size: 1024, required: true },
      { key: "effect_state", type: "string", size: 32, required: true },
    ],
    indexes: [
      {
        key: "question_unique",
        type: "unique",
        attributes: ["question_id"],
        orders: ["ASC"],
      },
    ],
  },
  {
    id: tableIds.progress,
    name: "Answer progress",
    columns: [
      { key: "question_id", type: "string", size: 36, required: true },
      { key: "sequence", type: "integer", required: true },
      { key: "label", type: "string", size: 64, required: true },
    ],
    indexes: [
      {
        key: "question_sequence_unique",
        type: "unique",
        attributes: ["question_id", "sequence"],
        orders: ["ASC", "ASC"],
      },
    ],
  },
  {
    id: tableIds.refreshRuns,
    name: "Refresh runs",
    columns: [
      { key: "source_url", type: "string", size: 1024, required: true },
      { key: "status", type: "string", size: 24, required: true },
      { key: "content_hash", type: "string", size: 64, required: true },
      { key: "progress_count", type: "integer", required: true },
      { key: "effect_state", type: "string", size: 32, required: true },
      { key: "secret_seen", type: "boolean", required: true },
    ],
  },
  {
    id: tableIds.outcomes,
    name: "Outcome fixtures",
    columns: [
      { key: "status", type: "string", size: 24, required: true },
      { key: "effect_state", type: "string", size: 32, required: true },
      { key: "detail", type: "string", size: 256, required: true },
    ],
    indexes: [
      { key: "status_unique", type: "unique", attributes: ["status"], orders: ["ASC"] },
    ],
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
    indexes: spec.indexes ?? [],
  });
}

async function create(tableId, rowId, data, permissions = memberRead) {
  return tables.createRow({ databaseId, tableId, rowId, data, permissions });
}
await create(tableIds.rooms, "research-main", {
  name: "Backend architecture",
  owner_id: "alice",
  sequence: 1,
}, ownerWrite);
await create(tableIds.rooms, "research-secondary", {
  name: "Interview synthesis",
  owner_id: "alice",
  sequence: 2,
}, ownerWrite);
for (const [userId, role] of [["alice", "owner"], ["bob", "member"]]) {
  await create(tableIds.memberships, `research-main-${userId}`, {
    room_id: "research-main",
    user_id: userId,
    role,
  });
}
await create(tableIds.memberships, "research-secondary-alice", {
  room_id: "research-secondary",
  user_id: "alice",
  role: "owner",
}, [
  Permission.read(Role.user("alice")),
  Permission.update(Role.user("alice")),
  Permission.delete(Role.user("alice")),
]);

await storage.createBucket({
  bucketId,
  name: "Research source files",
  permissions: [Permission.create(Role.team(memberTeamId))],
  fileSecurity: true,
  enabled: true,
  maximumFileSize: 1048576,
  allowedFileExtensions: [],
  compression: "none",
  encryption: true,
  antivirus: false,
});

for (let sequence = 1; sequence <= 20; sequence += 1) {
  const suffix = String(sequence).padStart(2, "0");
  const sourceId = `source-${suffix}`;
  const filename = sequence === 1
    ? "Architecture.pdf"
    : sequence === 2
      ? "Interview notes.md"
      : `Research source ${suffix}.txt`;
  const searchable = sequence <= 2
    ? `cancellation safety durable attempt identity authoritative fence backend architecture source ${suffix}`
    : `deterministic backend research fixture source ${suffix}`;
  const bytes = Buffer.alloc(65536, sequence);
  await storage.createFile({
    bucketId,
    fileId: sourceId,
    file: InputFile.fromBuffer(bytes, filename),
    permissions: ownerWrite,
  });
  await create(tableIds.sources, sourceId, {
    room_id: "research-main",
    file_id: sourceId,
    filename,
    content_text: searchable,
    content_hash: hash(bytes),
    embedding_json: JSON.stringify(
      Array.from({ length: 32 }, (_, index) => Number(((sequence + index) / 100).toFixed(4))),
    ),
    owner_id: "alice",
    sequence,
  }, ownerWrite);
}

for (const [status, effectState] of [
  ["complete", "confirmed"],
  ["failed", "terminal"],
  ["cancelled", "terminal"],
  ["timed-out", "terminal"],
  ["ambiguous", "unknown"],
]) {
  await create(tableIds.outcomes, `outcome-${status}`, {
    status,
    effect_state: effectState,
    detail: `deterministic ${status} fixture`,
  });
}

const counts = {};
for (const [name, tableId] of Object.entries(tableIds)) {
  counts[name] = (await tables.listRows({
    databaseId,
    tableId,
    queries: [Query.limit(1)],
    total: true,
  })).total;
}
const expected = {
  rooms: 2,
  memberships: 3,
  sources: 20,
  questions: 0,
  answers: 0,
  progress: 0,
  refreshRuns: 0,
  outcomes: 5,
};
if (JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(`Seed mismatch: ${JSON.stringify({ counts, expected })}`);
}

await mkdir(receiptsRoot, { recursive: true });
await writeFile(path.resolve(receiptsRoot, "seed.v1.json"), `${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  counts,
  fixedDataset: {
    rooms: 2,
    primarySources: 20,
    sourceBytes: 65536,
    embeddingDimensions: 32,
    actors: 3,
    concurrentClients: 2,
  },
  personas: Object.fromEntries(Object.entries(people).map(([id, person]) => [
    id,
    { principalIdHash: hash(id), role: person.role },
  ])),
  memberTeamId,
  containsSecretValues: false,
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, counts, secretValuesPrinted: false }));
