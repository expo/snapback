import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localConfig } from "./local-config.mjs";

const namespace = "llp0102-chat-supabase-calibration-chat-supabase-calibration-01";
const passphrase = process.env.CHAT_TEST_PASSPHRASE;
if (!passphrase) throw new Error("CHAT_TEST_PASSPHRASE is required");

const config = localConfig();
const admin = createClient(config.apiUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const actorSpecs = [
  ["alice", "alice@llp0102.local"],
  ["bob", "bob@llp0102.local"],
  ["mallory", "mallory@llp0102.local"]
];

const channels = [
  { id: "10000000-0000-4000-8000-000000000001", slug: "general", name: "general", visibility: "public", sort_key: 1 },
  { id: "10000000-0000-4000-8000-000000000002", slug: "field-notes", name: "field-notes", visibility: "public", sort_key: 2 },
  { id: "10000000-0000-4000-8000-000000000003", slug: "calibration", name: "calibration", visibility: "private", sort_key: 3 },
  { id: "10000000-0000-4000-8000-000000000004", slug: "deep-round", name: "deep-round", visibility: "private", sort_key: 4 }
].map((channel) => ({ ...channel, arm_namespace: namespace }));

await admin.from("read_markers").delete().gte("last_read_seq", 0);
await admin.from("messages").delete().gte("seq", 0);
await admin.from("channel_members").delete().not("user_id", "is", null);
await admin.from("channels").delete().eq("arm_namespace", namespace);

const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
for (const user of listed.data.users.filter((candidate) => actorSpecs.some(([, email]) => email === candidate.email))) {
  const removed = await admin.auth.admin.deleteUser(user.id);
  if (removed.error) throw removed.error;
}

const actors = {};
for (const [name, email] of actorSpecs) {
  const created = await admin.auth.admin.createUser({
    email,
    password: passphrase,
    email_confirm: true,
    user_metadata: { actor: name, arm_namespace: namespace }
  });
  if (created.error) throw created.error;
  actors[name] = created.data.user.id;
}

const channelInsert = await admin.from("channels").insert(channels);
if (channelInsert.error) throw channelInsert.error;

const memberships = channels.flatMap((channel) => {
  const memberNames = channel.visibility === "public" ? ["alice", "bob", "mallory"] : ["alice", "bob"];
  return memberNames.map((actor) => ({
    channel_id: channel.id,
    user_id: actors[actor],
    role: actor === "alice" ? "owner" : "member"
  }));
});
const membershipInsert = await admin.from("channel_members").insert(memberships);
if (membershipInsert.error) throw membershipInsert.error;

for (const channel of channels) {
  const batch = Array.from({ length: 125 }, (_, index) => ({
    id: deterministicUuid(`${channel.slug}:${index + 1}`),
    channel_id: channel.id,
    author_id: index % 2 === 0 ? actors.alice : actors.bob,
    body: `${channel.slug} seeded message ${String(index + 1).padStart(3, "0")}`
  }));
  const inserted = await admin.from("messages").insert(batch);
  if (inserted.error) throw inserted.error;
}

const counts = await Promise.all([
  admin.from("channels").select("*", { count: "exact", head: true }).eq("arm_namespace", namespace),
  admin.from("channel_members").select("*", { count: "exact", head: true }),
  admin.from("messages").select("*", { count: "exact", head: true })
]);
for (const result of counts) if (result.error) throw result.error;

console.log(JSON.stringify({
  ok: true,
  namespace,
  counts: { channels: counts[0].count, memberships: counts[1].count, messages: counts[2].count },
  actorHashes: Object.fromEntries(Object.entries(actors).map(([name, id]) => [name, sha256(id)]))
}, null, 2));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
