import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localConfig } from "./local-config.mjs";

const namespace = "llp0102-partiful-supabase-coord";
const config = localConfig();
const passphrase = process.env.PARTY_TEST_PASSPHRASE ?? `${randomBytes(24).toString("base64url")}aA1!`;
const admin = createClient(config.apiUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const actorSpecs = [
  ["alice", "alice.partiful.supabase@llp0102.local"],
  ["bob", "bob.partiful.supabase@llp0102.local"],
  ["mallory", "mallory.partiful.supabase@llp0102.local"],
  ["carol", "carol.partiful.supabase@llp0102.local"],
  ["dave", "dave.partiful.supabase@llp0102.local"],
  ["erin", "erin.partiful.supabase@llp0102.local"]
];

const previousEvents = await admin.from("events").select("id").eq("arm_namespace", namespace);
if (previousEvents.error) throw previousEvents.error;
if (previousEvents.data.length) {
  const removed = await admin.from("events").delete().in("id", previousEvents.data.map(({ id }) => id));
  if (removed.error) throw removed.error;
}
const previousProfiles = await admin.from("profiles").select("user_id").eq("arm_namespace", namespace);
if (previousProfiles.error) throw previousProfiles.error;
if (previousProfiles.data.length) {
  const removed = await admin.from("profiles").delete().in("user_id", previousProfiles.data.map(({ user_id }) => user_id));
  if (removed.error) throw removed.error;
}

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

await checked(admin.from("profiles").insert(
  Object.entries(actors).map(([name, user_id]) => ({
    user_id,
    arm_namespace: namespace,
    display_name: name[0].toUpperCase() + name.slice(1)
  }))
));

const events = {
  primary: deterministicUuid("event:primary"),
  capacity: deterministicUuid("event:capacity"),
  private: deterministicUuid("event:private")
};
await checked(admin.from("events").insert([
  {
    id: events.primary,
    arm_namespace: namespace,
    host_id: actors.alice,
    slug: "summer-rooftop",
    title: "Summer Rooftop",
    summary: "A production-shaped evening with music and friends.",
    venue_public: "Mission District, San Francisco",
    private_notes: "Door code 0102. Host controls and guest contacts stay private.",
    is_public: true,
    capacity: 20,
    guest_list_visible: true,
    starts_at: "2026-08-15T02:00:00.000Z"
  },
  {
    id: events.capacity,
    arm_namespace: namespace,
    host_id: actors.alice,
    slug: "last-seat",
    title: "Last Seat Dinner",
    summary: "A tiny capacity-contention fixture.",
    venue_public: "Private dining room",
    private_notes: "One seat only.",
    is_public: false,
    capacity: 1,
    guest_list_visible: true,
    starts_at: "2026-08-16T02:00:00.000Z"
  },
  {
    id: events.private,
    arm_namespace: namespace,
    host_id: actors.alice,
    slug: "host-planning",
    title: "Host Planning",
    summary: "Private planning fixture.",
    venue_public: "Undisclosed",
    private_notes: "Supplier phone and budget.",
    is_public: false,
    capacity: 5,
    guest_list_visible: false,
    starts_at: "2026-08-14T02:00:00.000Z"
  }
]));

await checked(admin.from("event_members").insert([
  { event_id: events.primary, user_id: actors.alice, role: "host" },
  { event_id: events.primary, user_id: actors.carol, role: "cohost" },
  { event_id: events.primary, user_id: actors.bob, role: "guest" },
  { event_id: events.capacity, user_id: actors.alice, role: "host" },
  { event_id: events.capacity, user_id: actors.dave, role: "guest" },
  { event_id: events.capacity, user_id: actors.erin, role: "guest" },
  { event_id: events.private, user_id: actors.alice, role: "host" }
]));

await checked(admin.from("invitations").insert([
  ["bob", events.primary, "accepted"],
  ["carol", events.primary, "accepted"],
  ["dave", events.capacity, "accepted"],
  ["erin", events.capacity, "accepted"]
].map(([name, event_id, status]) => ({
  id: deterministicUuid(`invite:${name}:${event_id}`),
  event_id,
  email: actorSpecs.find(([actor]) => actor === name)[1],
  invitee_id: actors[name],
  created_by: actors.alice,
  status
}))));

const counts = {};
for (const table of ["profiles", "events", "event_members", "invitations", "rsvps", "wall_posts", "reminder_schedules", "notification_attempts"]) {
  const result = await admin.from(table).select("*", { count: "exact", head: true });
  if (result.error) throw result.error;
  counts[table] = result.count;
}

console.log(JSON.stringify({
  ok: true,
  namespace,
  counts,
  events,
  personas: Object.fromEntries(Object.entries(actors).map(([name, id]) => [name, {
    idHash: sha256(id),
    role: name === "alice" ? "host" : name === "carol" ? "cohost" : name === "mallory" ? "outsider" : "guest"
  }]))
}, null, 2));

async function checked(builder) {
  const result = await builder;
  if (result.error) throw result.error;
  return result;
}

function deterministicUuid(seed) {
  const hex = createHash("sha256").update(`${namespace}:${seed}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
