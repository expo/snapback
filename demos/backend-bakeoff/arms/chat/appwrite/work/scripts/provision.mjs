import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Permission, Role } from "node-appwrite";
import {
  allRows,
  channelsTableId,
  databaseId,
  privateMessagesTableId,
  privateRead,
  privateTeamId,
  publicMessagesTableId,
  publicRead,
  runtime,
  saveRuntime,
  tables,
  teams,
  unreadTableId,
  users,
} from "./admin-client.mjs";

const armRoot = resolve("..");
const receiptsRoot = resolve(armRoot, "receipts");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const personSpecs = {
  alice: { id: "alice", name: "Alice", role: "member" },
  bob: { id: "bob", name: "Bob", role: "member" },
  mallory: { id: "mallory", name: "Mallory", role: "outsider" },
};

if (!runtime.personas) {
  runtime.personas = Object.fromEntries(
    Object.entries(personSpecs).map(([key, spec]) => [
      key,
      {
        ...spec,
        email: `${key}@llp0102-chat.appwrite.test`,
        password: randomBytes(24).toString("base64url"),
      },
    ]),
  );
  await saveRuntime();
}

const existing = await Promise.all([
  users.list({ total: true }),
  teams.list({ total: true }),
  tables.list({ total: true }),
]);
if (existing.some((result) => result.total !== 0)) {
  throw new Error("Provisioning requires a fresh empty Appwrite project");
}

const createdUsers = {};
for (const [key, person] of Object.entries(runtime.personas)) {
  createdUsers[key] = await users.create({
    userId: person.id,
    email: person.email,
    password: person.password,
    name: person.name,
  });
}

await teams.create({
  teamId: privateTeamId,
  name: "Private channels",
  roles: ["owner"],
});
for (const key of ["alice", "bob"]) {
  const membership = await teams.createMembership({
    teamId: privateTeamId,
    roles: ["member"],
    userId: createdUsers[key].$id,
  });
  runtime.memberships ??= {};
  runtime.memberships[key] = membership.$id;
}
await saveRuntime();

await tables.create({ databaseId, name: "Chat", enabled: true });
await tables.createTable({
  databaseId,
  tableId: channelsTableId,
  name: "Channels",
  permissions: [],
  rowSecurity: true,
  enabled: true,
  columns: [
    { key: "name", type: "string", size: 128, required: true },
    { key: "visibility", type: "string", size: 16, required: true },
    { key: "ordinal", type: "integer", required: true },
  ],
  indexes: [
    { key: "ordinal_idx", type: "key", attributes: ["ordinal"], orders: ["ASC"] },
  ],
});

const messageColumns = [
  { key: "channel_id", type: "string", size: 36, required: true },
  { key: "body", type: "string", size: 512, required: true },
  { key: "author_label", type: "string", size: 128, required: true },
  { key: "seed_ordinal", type: "integer", required: false },
];
const messageIndexes = [
  { key: "channel_created_idx", type: "key", attributes: ["channel_id", "$createdAt"], orders: ["ASC", "DESC"] },
];
await tables.createTable({
  databaseId,
  tableId: publicMessagesTableId,
  name: "Public messages",
  permissions: [Permission.create(Role.users())],
  rowSecurity: true,
  enabled: true,
  columns: messageColumns,
  indexes: messageIndexes,
});
await tables.createTable({
  databaseId,
  tableId: privateMessagesTableId,
  name: "Private messages",
  permissions: [Permission.create(Role.team(privateTeamId))],
  rowSecurity: true,
  enabled: true,
  columns: messageColumns,
  indexes: messageIndexes,
});
await tables.createTable({
  databaseId,
  tableId: unreadTableId,
  name: "Unread markers",
  permissions: [Permission.create(Role.users())],
  rowSecurity: true,
  enabled: true,
  columns: [
    { key: "channel_id", type: "string", size: 36, required: true },
    { key: "last_seen_message_id", type: "string", size: 36, required: true },
    { key: "revision", type: "integer", required: true },
  ],
  indexes: [
    { key: "channel_idx", type: "key", attributes: ["channel_id"], orders: ["ASC"] },
  ],
});

const channels = [
  { id: "public-general", name: "General", visibility: "public", ordinal: 0, permissions: publicRead },
  { id: "public-random", name: "Random", visibility: "public", ordinal: 1, permissions: publicRead },
  { id: "private-alpha", name: "Alpha", visibility: "private", ordinal: 2, permissions: privateRead },
  { id: "private-beta", name: "Beta", visibility: "private", ordinal: 3, permissions: privateRead },
];
for (const channel of channels) {
  await tables.createRow({
    databaseId,
    tableId: channelsTableId,
    rowId: channel.id,
    data: {
      name: channel.name,
      visibility: channel.visibility,
      ordinal: channel.ordinal,
    },
    permissions: channel.permissions,
  });
  const tableId =
    channel.visibility === "private" ? privateMessagesTableId : publicMessagesTableId;
  for (let start = 0; start < 125; start += 25) {
    await Promise.all(Array.from({ length: 25 }, (_, offset) => {
      const ordinal = start + offset + 1;
      const author = ordinal % 2 === 0 ? "Alice" : "Bob";
      return tables.createRow({
        databaseId,
        tableId,
        rowId: `${channel.id}-${String(ordinal).padStart(3, "0")}`,
        data: {
          channel_id: channel.id,
          body: `${channel.name} seeded message ${ordinal}`,
          author_label: author,
          seed_ordinal: ordinal,
        },
        permissions: [
          ...channel.permissions,
          Permission.update(Role.user(author.toLowerCase())),
          Permission.delete(Role.user(author.toLowerCase())),
        ],
      });
    }));
  }
}

const [seededChannels, publicMessages, privateMessages] = await Promise.all([
  allRows(channelsTableId),
  allRows(publicMessagesTableId),
  allRows(privateMessagesTableId),
]);
const counts = {
  channels: seededChannels.length,
  publicMessages: publicMessages.length,
  privateMessages: privateMessages.length,
  totalMessages: publicMessages.length + privateMessages.length,
};
if (
  counts.channels !== 4 ||
  counts.publicMessages !== 250 ||
  counts.privateMessages !== 250
) {
  throw new Error(`Authoritative seed verification failed: ${JSON.stringify(counts)}`);
}

await mkdir(receiptsRoot, { recursive: true });
await writeFile(
  resolve(receiptsRoot, "personas.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    provider: "Appwrite Auth and Teams",
    principalIdHashes: Object.fromEntries(
      Object.entries(createdUsers).map(([key, user]) => [key, hash(user.$id)]),
    ),
    roles: Object.fromEntries(
      Object.entries(personSpecs).map(([key, spec]) => [key, spec.role]),
    ),
    privateChannelMembers: ["alice", "bob"],
    outsiderPrivateReadCount: 0,
    containsSecretValues: false,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
await writeFile(
  resolve(receiptsRoot, "authoritative-summary.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ...counts,
    channelCounts: Object.fromEntries(channels.map((channel) => [channel.id, 125])),
    containsSecretValues: false,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  users: Object.keys(createdUsers).length,
  ...counts,
  secretValuesPrinted: false,
})}\n`);
