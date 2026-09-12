#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @ref LLP 2000#7-performance-is-part-of-the-architecture — measure acquisition
// against a declared fixture; a large chat seed does not imply a full product.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--help")) {
  console.log("node scripts/generate-hub.mjs [output.json]\nDefault: examples/chat/.snapback3/fixtures/hub-seed.json");
  process.exit(0);
}
if (process.argv.length > 3 || process.argv[2]?.startsWith("--")) throw new Error("Expected one optional output.json path.");
const output = process.argv[2] ? resolve(process.argv[2]) : resolve(root, "examples/chat/.snapback3/fixtures/hub-seed.json");
const person = value => `u${String(value).padStart(4, "0")}`;
const principal = value => `dev:${person(value)}`;
const colors = ["sage", "clay", "lavender", "sky"];
const epoch = Date.UTC(2026, 8, 12, 12);
const seed = {
  personas: Array.from({ length: 4901 }, (_, index) => person(index + 1)),
  rows: { conversations: [], memberships: [], messages: [], readCursors: [] },
};
const subjects = [
  "A small observation for our next conversation.",
  "I have added a little more context to the idea we discussed.",
  "This seems like a useful place to pause and compare notes.",
  "A question worth coming back to when we have a moment.",
];

for (let room = 0; room < 1000; room++) {
  const group = room < 100;
  const id = group ? `group-${String(room + 1).padStart(3, "0")}` : `direct-${String(room - 99).padStart(3, "0")}`;
  const members = group ? [1, ...Array.from({ length: 49 }, (_, index) => room * 49 + index + 2)] : [1, room - 98];
  const count = room < 15 ? 101 : 100;
  const title = group ? `Shared room ${room + 1}` : `Hub & ${person(members[1])}`;
  seed.rows.conversations.push({
    id, title, kind: group ? "group" : "direct", color: colors[room % colors.length],
    topic: group ? "A synthetic shared conversation for measuring bounded chat acquisition."
      : "A synthetic direct conversation visible only to its two members.",
    updatedAt: epoch + room * 1000 + count * 60_000,
  });
  for (const member of members) seed.rows.memberships.push({
    id: `member-${id}-${person(member)}`, conversationId: id, principal: principal(member),
    displayName: member === 1 ? "The hub" : `Member ${String(member).padStart(4, "0")}`,
    role: member === 1 ? "Connected to every room" : "A member of this conversation",
  });
  for (let ordinal = 1; ordinal <= count; ordinal++) seed.rows.messages.push({
    id: `message-${id}-${String(ordinal).padStart(3, "0")}`, conversationId: id,
    author: principal(members[(ordinal - 1) % members.length]),
    body: `${subjects[(room + ordinal) % subjects.length]} ${title}, message ${ordinal}.`,
    ordinal, at: epoch + room * 1000 + ordinal * 60_000, editedAt: null,
  });
  seed.rows.readCursors.push({ id: `read-${id}-${person(1)}`, conversationId: id, principal: principal(1), seen: count - 5 });
}

const source = JSON.stringify(seed) + "\n";
const metrics = {
  fixture: "snapback3-commonroom-hub-v1",
  scope: "Synthetic chat acquisition fixture; not the full Clique application or an M1–M8 comparison.",
  hubPersona: "u0001", hubPrincipal: "dev:u0001",
  counts: { personas: seed.personas.length, groups: 100, directConversations: 900,
    ...Object.fromEntries(Object.entries(seed.rows).map(([table, rows]) => [table, rows.length])) },
  maxMembersPerConversation: 50,
  omitted: ["Feed and follow edges: the reference schema has no feed, so no 500-follow claim is made."],
  bytes: Buffer.byteLength(source), sha256: createHash("sha256").update(source).digest("hex"),
};
const metricsPath = output.replace(/\.json$/, "") + ".metrics.json";
await mkdir(dirname(output), { recursive: true });
await writeFile(output, source);
await writeFile(metricsPath, JSON.stringify(metrics, null, 2) + "\n");
console.log(JSON.stringify({ output, metrics: metricsPath, ...metrics }, null, 2));
