import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localConfig } from "./local-config.mjs";

const namespace = "llp0102-linear-supabase-w3";
const config = localConfig();
const passphrase = process.env.LINEAR_TEST_PASSPHRASE ?? `${randomBytes(24).toString("base64url")}aA1!`;
const admin = createClient(config.apiUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const actorSpecs = [
  ["alice", "alice.linear.w3@llp0102.local"],
  ["bob", "bob.linear.w3@llp0102.local"],
  ["mallory", "mallory.linear.w3@llp0102.local"]
];

const previousOrganizations = await admin.from("organizations").select("id").eq("arm_namespace", namespace);
if (previousOrganizations.error) throw previousOrganizations.error;
if (previousOrganizations.data.length > 0) {
  const deleted = await admin.from("organizations").delete().in("id", previousOrganizations.data.map(({ id }) => id));
  if (deleted.error) throw deleted.error;
}
const previousProfiles = await admin.from("profiles").select("user_id").eq("arm_namespace", namespace);
if (previousProfiles.error) throw previousProfiles.error;
if (previousProfiles.data.length > 0) {
  const deleted = await admin.from("profiles").delete().in("user_id", previousProfiles.data.map(({ user_id }) => user_id));
  if (deleted.error) throw deleted.error;
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

const primaryOrganization = deterministicUuid("organization:primary");
const secondaryOrganization = deterministicUuid("organization:secondary");
const teams = ["platform", "product", "growth"].map((key, index) => ({
  id: deterministicUuid(`team:${key}`),
  organization_id: primaryOrganization,
  key: key.toUpperCase().slice(0, 3),
  name: `${titleCase(key)} team`,
  sort: index
}));
const projects = ["backend-bakeoff", "mobile", "launch", "reliability"].map((slug, index) => ({
  id: deterministicUuid(`project:${slug}`),
  organization_id: primaryOrganization,
  team_id: teams[index % teams.length].id,
  slug,
  name: titleCase(slug.replaceAll("-", " "))
}));
const labels = Array.from({ length: 20 }, (_, index) => ({
  id: deterministicUuid(`label:${index + 1}`),
  organization_id: primaryOrganization,
  name: `label-${String(index + 1).padStart(2, "0")}`,
  color: `#${createHash("sha256").update(`color:${index}`).digest("hex").slice(0, 6)}`
}));

await checked(admin.from("organizations").insert([
  { id: primaryOrganization, arm_namespace: namespace, slug: "acme", name: "Acme Systems" },
  { id: secondaryOrganization, arm_namespace: namespace, slug: "archive", name: "Archive Labs" }
]));
await checked(admin.from("profiles").insert([
  { user_id: actors.alice, arm_namespace: namespace, display_name: "Alice" },
  { user_id: actors.bob, arm_namespace: namespace, display_name: "Bob" },
  { user_id: actors.mallory, arm_namespace: namespace, display_name: "Mallory" }
]));
await checked(admin.from("organization_members").insert([
  { organization_id: primaryOrganization, user_id: actors.alice, role: "owner" },
  { organization_id: primaryOrganization, user_id: actors.bob, role: "member" },
  { organization_id: secondaryOrganization, user_id: actors.alice, role: "owner" }
]));
await checked(admin.from("teams").insert(teams.map(({ sort: _sort, ...team }) => team)));
await checked(admin.from("team_members").insert([
  ...teams.map((team) => ({ team_id: team.id, user_id: actors.alice, role: "lead" })),
  { team_id: teams[0].id, user_id: actors.bob, role: "member" }
]));
await checked(admin.from("projects").insert(projects));
await checked(admin.from("labels").insert(labels));

const epoch = Date.parse("2026-01-01T00:00:00.000Z");
const issues = Array.from({ length: 500 }, (_, index) => {
  const number = index + 1;
  const team = teams[index % teams.length];
  const project = projects[index % projects.length];
  const title = number % 10 === 0
    ? `Realtime cursor migration issue ${number}`
    : `${titleCase(team.name)} workflow issue ${number}`;
  const createdAt = new Date(epoch + index * 60_000).toISOString();
  return {
    id: deterministicUuid(`issue:${number}`),
    organization_id: primaryOrganization,
    team_id: team.id,
    project_id: project.id,
    assignee_id: index % 3 === 0 ? actors.alice : index % 3 === 1 ? actors.bob : null,
    issue_number: number,
    title,
    description: `Production-shaped issue ${number} for ${project.name}. Includes deterministic backend evidence.`,
    status: ["backlog", "todo", "in_progress", "review", "done"][index % 5],
    priority: index % 5,
    board_position: number * 1000,
    created_at: createdAt,
    updated_at: createdAt
  };
});

for (const batch of chunks(issues, 100)) await checked(admin.from("issues").insert(batch));

const issueLabels = issues.flatMap((issue, index) => [
  { issue_id: issue.id, label_id: labels[index % labels.length].id },
  { issue_id: issue.id, label_id: labels[(index + 7) % labels.length].id }
]);
for (const batch of chunks(issueLabels, 250)) await checked(admin.from("issue_labels").insert(batch));

const comments = issues.flatMap((issue, index) => [
  {
    id: deterministicUuid(`comment:${index + 1}:1`),
    issue_id: issue.id,
    author_id: actors.alice,
    body: `Alice seeded comment one for issue ${index + 1}`
  },
  {
    id: deterministicUuid(`comment:${index + 1}:2`),
    issue_id: issue.id,
    author_id: actors.bob,
    body: `Bob seeded comment two for issue ${index + 1}`
  }
]);
for (const batch of chunks(comments, 100)) await checked(admin.from("comments").insert(batch));

const counts = {};
for (const table of ["organizations", "teams", "projects", "labels", "issues", "issue_labels", "comments", "activities"]) {
  const result = await admin.from(table).select("*", { count: "exact", head: true });
  if (result.error) throw result.error;
  counts[table] = result.count;
}

console.log(JSON.stringify({
  ok: true,
  namespace,
  counts,
  primaryOrganization,
  actors: Object.fromEntries(Object.entries(actors).map(([name, id]) => [name, sha256(id)])),
  dataset: {
    organizations: 2,
    teamsPerPrimaryOrganization: 3,
    projectsPerPrimaryOrganization: 4,
    issues: 500,
    comments: 1000,
    labels: 20
  }
}, null, 2));

async function checked(builder) {
  const result = await builder;
  if (result.error) throw result.error;
  return result;
}

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size));
}

function deterministicUuid(seed) {
  const hex = createHash("sha256").update(`${namespace}:${seed}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function titleCase(value) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
