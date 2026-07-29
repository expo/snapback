import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Permission, Query, Role } from "node-appwrite";
import {
  allRows,
  databaseId,
  ownerWrite,
  primaryRead,
  primaryTeamId,
  primaryWrite,
  runtime,
  saveRuntime,
  secondaryTeamId,
  tableIds,
  tables,
  teamsApi,
  users,
} from "./admin-client.mjs";
import { receiptsRoot } from "./constants.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const people = {
  alice: { name: "Alice", role: "owner", email: "alice@llp0102-linear.appwrite.test" },
  bob: { name: "Bob", role: "member", email: "bob@llp0102-linear.appwrite.test" },
  mallory: { name: "Mallory", role: "outsider", email: "mallory@llp0102-linear.appwrite.test" },
};
runtime.personas ??= {};
for (const [id, person] of Object.entries(people)) {
  runtime.personas[id] ??= {
    ...person,
    password: randomBytes(24).toString("base64url"),
  };
}
await saveRuntime();

const [existingUsers, existingTeams, existingTables] = await Promise.all([
  users.list({ total: true }),
  teamsApi.list({ total: true }),
  tables.list({ total: true }),
]);
if (existingUsers.total || existingTeams.total || existingTables.total) {
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
  teamId: primaryTeamId,
  name: "Primary organization",
  roles: ["owner", "member"],
});
await teamsApi.create({
  teamId: secondaryTeamId,
  name: "Secondary organization",
  roles: ["owner"],
});
for (const [userId, roles] of [["alice", ["owner"]], ["bob", ["member"]]]) {
  const membership = await teamsApi.createMembership({
    teamId: primaryTeamId,
    roles,
    userId,
  });
  runtime.memberships ??= {};
  runtime.memberships[userId] = membership.$id;
}
runtime.memberships.mallory = (await teamsApi.createMembership({
  teamId: secondaryTeamId,
  roles: ["owner"],
  userId: "mallory",
})).$id;
await saveRuntime();

await tables.create({ databaseId, name: "Linear", enabled: true });
const commonOrgColumns = [
  { key: "org_id", type: "string", size: 36, required: true },
  { key: "name", type: "string", size: 128, required: true },
  { key: "ordinal", type: "integer", required: true },
];
const tableSpecs = [
  {
    id: tableIds.organizations,
    name: "Organizations",
    columns: [
      { key: "name", type: "string", size: 128, required: true },
      { key: "ordinal", type: "integer", required: true },
    ],
    indexes: [{ key: "ordinal_idx", type: "key", attributes: ["ordinal"], orders: ["ASC"] }],
  },
  {
    id: tableIds.teams,
    name: "Teams",
    columns: commonOrgColumns,
    indexes: [{ key: "org_ordinal_idx", type: "key", attributes: ["org_id", "ordinal"], orders: ["ASC", "ASC"] }],
  },
  {
    id: tableIds.projects,
    name: "Projects",
    columns: [
      ...commonOrgColumns,
      { key: "team_id", type: "string", size: 36, required: true },
    ],
    indexes: [
      { key: "org_ordinal_idx", type: "key", attributes: ["org_id", "ordinal"], orders: ["ASC", "ASC"] },
      { key: "team_idx", type: "key", attributes: ["team_id"], orders: ["ASC"] },
    ],
  },
  {
    id: tableIds.members,
    name: "Members",
    columns: [
      { key: "org_id", type: "string", size: 36, required: true },
      { key: "user_id", type: "string", size: 36, required: true },
      { key: "name", type: "string", size: 128, required: true },
      { key: "role", type: "string", size: 16, required: true },
      { key: "ordinal", type: "integer", required: true },
    ],
    indexes: [
      { key: "org_ordinal_idx", type: "key", attributes: ["org_id", "ordinal"], orders: ["ASC", "ASC"] },
      { key: "org_user_idx", type: "unique", attributes: ["org_id", "user_id"], orders: ["ASC", "ASC"] },
    ],
  },
  {
    id: tableIds.labels,
    name: "Labels",
    columns: [
      ...commonOrgColumns,
      { key: "color", type: "string", size: 16, required: true },
    ],
    indexes: [{ key: "org_ordinal_idx", type: "key", attributes: ["org_id", "ordinal"], orders: ["ASC", "ASC"] }],
  },
  {
    id: tableIds.issueLabels,
    name: "Issue labels",
    columns: [
      { key: "org_id", type: "string", size: 36, required: true },
      { key: "issue_id", type: "string", size: 36, required: true },
      { key: "label_id", type: "string", size: 36, required: true },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [
      { key: "org_label_sequence_idx", type: "key", attributes: ["org_id", "label_id", "sequence"], orders: ["ASC", "ASC", "DESC"] },
      { key: "issue_idx", type: "key", attributes: ["issue_id"], orders: ["ASC"] },
    ],
  },
  {
    id: tableIds.issues,
    name: "Issues",
    permissions: [Permission.create(Role.team(primaryTeamId))],
    columns: [
      { key: "org_id", type: "string", size: 36, required: true },
      { key: "team_id", type: "string", size: 36, required: true },
      { key: "project_id", type: "string", size: 36, required: true },
      { key: "identifier", type: "string", size: 20, required: true },
      { key: "title", type: "string", size: 256, required: true },
      { key: "description", type: "string", size: 1024, required: true },
      { key: "search_text", type: "string", size: 1280, required: true },
      { key: "status", type: "string", size: 24, required: true },
      { key: "priority", type: "integer", required: true },
      { key: "assignee_id", type: "string", size: 36, required: true },
      { key: "board_position", type: "integer", required: true },
      { key: "sequence", type: "integer", required: true },
      { key: "label_ids", type: "string", size: 36, required: true, array: true },
      { key: "revision", type: "integer", required: true },
    ],
    indexes: [
      { key: "org_sequence_idx", type: "key", attributes: ["org_id", "sequence"], orders: ["ASC", "DESC"] },
      { key: "org_status_sequence_idx", type: "key", attributes: ["org_id", "status", "sequence"], orders: ["ASC", "ASC", "DESC"] },
      { key: "org_assignee_sequence_idx", type: "key", attributes: ["org_id", "assignee_id", "sequence"], orders: ["ASC", "ASC", "DESC"] },
      { key: "org_project_sequence_idx", type: "key", attributes: ["org_id", "project_id", "sequence"], orders: ["ASC", "ASC", "DESC"] },
      { key: "search_text_idx", type: "fulltext", attributes: ["search_text"] },
    ],
  },
  {
    id: tableIds.comments,
    name: "Comments",
    permissions: [Permission.create(Role.team(primaryTeamId))],
    columns: [
      { key: "org_id", type: "string", size: 36, required: true },
      { key: "issue_id", type: "string", size: 36, required: true },
      { key: "author_id", type: "string", size: 36, required: true },
      { key: "body", type: "string", size: 1024, required: true },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [
      { key: "issue_sequence_idx", type: "key", attributes: ["issue_id", "sequence"], orders: ["ASC", "ASC"] },
      { key: "org_sequence_idx", type: "key", attributes: ["org_id", "sequence"], orders: ["ASC", "ASC"] },
    ],
  },
  {
    id: tableIds.activities,
    name: "Activities",
    permissions: [Permission.create(Role.team(primaryTeamId))],
    columns: [
      { key: "org_id", type: "string", size: 36, required: true },
      { key: "issue_id", type: "string", size: 36, required: true },
      { key: "actor_id", type: "string", size: 36, required: true },
      { key: "kind", type: "string", size: 48, required: true },
      { key: "description", type: "string", size: 512, required: true },
      { key: "sequence", type: "integer", required: true },
    ],
    indexes: [
      { key: "issue_sequence_idx", type: "key", attributes: ["issue_id", "sequence"], orders: ["ASC", "ASC"] },
      { key: "org_sequence_idx", type: "key", attributes: ["org_id", "sequence"], orders: ["ASC", "ASC"] },
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
    indexes: spec.indexes,
  });
}

const secondaryPermissions = [
  Permission.read(Role.team(secondaryTeamId)),
  Permission.update(Role.team(secondaryTeamId, "owner")),
];
async function create(tableId, rowId, data, permissions = primaryWrite) {
  return tables.createRow({ databaseId, tableId, rowId, data, permissions });
}
await create(tableIds.organizations, "org-primary", { name: "Primary", ordinal: 1 }, ownerWrite);
await create(tableIds.organizations, "org-secondary", { name: "Secondary", ordinal: 2 }, secondaryPermissions);
for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
  await create(tableIds.teams, `team-${ordinal}`, {
    org_id: "org-primary",
    name: `Team ${ordinal}`,
    ordinal,
  });
}
for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
  await create(tableIds.projects, `project-${ordinal}`, {
    org_id: "org-primary",
    team_id: `team-${((ordinal - 1) % 3) + 1}`,
    name: `Project ${ordinal}`,
    ordinal,
  });
}
for (const [ordinal, userId, name, role] of [
  [1, "alice", "Alice", "owner"],
  [2, "bob", "Bob", "member"],
]) {
  await create(tableIds.members, `member-${userId}`, {
    org_id: "org-primary", user_id: userId, name, role, ordinal,
  });
}
for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
  await create(tableIds.labels, `label-${String(ordinal).padStart(2, "0")}`, {
    org_id: "org-primary",
    name: `Label ${ordinal}`,
    color: `#${String(ordinal * 499).padStart(6, "0").slice(-6)}`,
    ordinal,
  });
}

async function bulk(tableId, rows, size = 50) {
  for (let start = 0; start < rows.length; start += size) {
    await tables.createRows({
      databaseId,
      tableId,
      rows: rows.slice(start, start + size),
    });
  }
}
const statuses = ["backlog", "todo", "in_progress", "done"];
const issueRows = Array.from({ length: 500 }, (_, index) => {
  const sequence = index + 1;
  const title = `Issue ${sequence} deterministic search fixture`;
  const description = `Production-shaped Appwrite issue body ${sequence}`;
  return {
    $id: `issue-${String(sequence).padStart(3, "0")}`,
    $permissions: primaryWrite,
    org_id: "org-primary",
    team_id: `team-${(index % 3) + 1}`,
    project_id: `project-${(index % 4) + 1}`,
    identifier: `LIN-${sequence}`,
    title,
    description,
    search_text: `${title} ${description}`,
    status: statuses[index % statuses.length],
    priority: (index % 4) + 1,
    assignee_id: index % 2 === 0 ? "alice" : "bob",
    board_position: sequence,
    sequence,
    label_ids: [
      `label-${String((index % 20) + 1).padStart(2, "0")}`,
      `label-${String(((index + 1) % 20) + 1).padStart(2, "0")}`,
    ],
    revision: 1,
  };
});
await bulk(tableIds.issues, issueRows);
await bulk(tableIds.issueLabels, issueRows.flatMap((issue) =>
  issue.label_ids.map((labelId, offset) => ({
    $id: `${issue.$id}-${offset + 1}`,
    $permissions: primaryRead,
    org_id: "org-primary",
    issue_id: issue.$id,
    label_id: labelId,
    sequence: issue.sequence,
  }))));
const commentRows = Array.from({ length: 1000 }, (_, index) => {
  const sequence = index + 1;
  return {
    $id: `comment-${String(sequence).padStart(4, "0")}`,
    $permissions: primaryRead,
    org_id: "org-primary",
    issue_id: `issue-${String((index % 500) + 1).padStart(3, "0")}`,
    author_id: index % 2 === 0 ? "alice" : "bob",
    body: `Deterministic comment ${sequence}`,
    sequence,
  };
});
await bulk(tableIds.comments, commentRows);
const activityRows = Array.from({ length: 500 }, (_, index) => {
  const sequence = index + 1;
  return {
    $id: `activity-${String(sequence).padStart(3, "0")}`,
    $permissions: primaryRead,
    org_id: "org-primary",
    issue_id: `issue-${String(sequence).padStart(3, "0")}`,
    actor_id: index % 2 === 0 ? "alice" : "bob",
    kind: "issue.created",
    description: `Issue LIN-${sequence} created`,
    sequence,
  };
});
await bulk(tableIds.activities, activityRows);

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
  organizations: 2,
  teams: 3,
  projects: 4,
  members: 2,
  labels: 20,
  issueLabels: 1000,
  issues: 500,
  comments: 1000,
  activities: 500,
};
if (JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(`Seed mismatch: ${JSON.stringify({ counts, expected })}`);
}
await mkdir(receiptsRoot, { recursive: true });
await writeFile(path.resolve(receiptsRoot, "seed.v1.json"), `${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  counts,
  personas: Object.fromEntries(Object.entries(people).map(([id, value]) => [
    id,
    { principalIdHash: hash(id), role: value.role },
  ])),
  primaryTeamId,
  secondaryTeamId,
  containsSecretValues: false,
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, counts, secretValuesPrinted: false }));
