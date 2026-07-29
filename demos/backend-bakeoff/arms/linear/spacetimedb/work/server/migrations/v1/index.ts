import { schema, table, t } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';

// @ref LLP 0102#app-3-linear-shaped-issue-tracker — private source tables,
// caller-dependent views, reducer-only writes, and deterministic materialized
// pages preserve the frozen authority and pagination facts without a shared
// backend abstraction.
const persona = table(
  { name: 'persona' },
  {
    identity: t.identity().primaryKey(),
    name: t.string().unique(),
  },
);

const organization = table(
  { name: 'organization' },
  {
    id: t.string().primaryKey(),
    name: t.string(),
  },
);

const organizationMembership = table(
  { name: 'organization_membership' },
  {
    id: t.string().primaryKey(),
    organizationId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    role: t.string(),
    active: t.bool(),
  },
);

const team = table(
  { name: 'team' },
  {
    id: t.string().primaryKey(),
    organizationId: t.string().index('btree'),
    name: t.string(),
  },
);

const teamMembership = table(
  { name: 'team_membership' },
  {
    id: t.string().primaryKey(),
    teamId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    role: t.string(),
    active: t.bool(),
  },
);

const project = table(
  { name: 'project' },
  {
    id: t.string().primaryKey(),
    organizationId: t.string().index('btree'),
    teamId: t.string().index('btree'),
    name: t.string(),
  },
);

const label = table(
  { name: 'label' },
  {
    id: t.string().primaryKey(),
    organizationId: t.string().index('btree'),
    name: t.string(),
    color: t.string(),
  },
);

const issue = table(
  { name: 'issue' },
  {
    id: t.string().primaryKey(),
    identifier: t.string().unique(),
    organizationId: t.string().index('btree'),
    teamId: t.string().index('btree'),
    projectId: t.string().index('btree'),
    title: t.string(),
    description: t.string(),
    status: t.string().index('btree'),
    priority: t.string().index('btree'),
    assigneeName: t.string().index('btree'),
    boardPosition: t.u32().index('btree'),
    sortKey: t.string().index('btree'),
    revision: t.u64(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const issueLabel = table(
  { name: 'issue_label' },
  {
    id: t.string().primaryKey(),
    issueId: t.string().index('btree'),
    labelId: t.string().index('btree'),
  },
);

const comment = table(
  { name: 'comment' },
  {
    id: t.u64().primaryKey().autoInc(),
    issueId: t.string().index('btree'),
    author: t.identity().index('btree'),
    authorName: t.string(),
    body: t.string(),
    createdAt: t.timestamp(),
  },
);

const activity = table(
  { name: 'activity' },
  {
    id: t.u64().primaryKey().autoInc(),
    issueId: t.string().index('btree'),
    actor: t.identity().index('btree'),
    actorName: t.string(),
    kind: t.string().index('btree'),
    detail: t.string(),
    createdAt: t.timestamp(),
  },
);

const pageResult = table(
  { name: 'page_result' },
  {
    id: t.string().primaryKey(),
    requestId: t.string().index('btree'),
    owner: t.identity().index('btree'),
    issueId: t.string(),
    identifier: t.string(),
    title: t.string(),
    status: t.string(),
    priority: t.string(),
    assigneeName: t.string(),
    projectId: t.string(),
    boardPosition: t.u32(),
    sortKey: t.string(),
    revision: t.u64(),
  },
);

const spacetimedb = schema({
  persona,
  organization,
  organizationMembership,
  team,
  teamMembership,
  project,
  label,
  issue,
  issueLabel,
  comment,
  activity,
  pageResult,
});

export default spacetimedb;

const PRIMARY_ORGANIZATION = 'org-primary';
const SECONDARY_ORGANIZATION = 'org-secondary';
const STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

function identityKey(identity: Identity): string {
  return identity.toHexString();
}

function requirePersona(ctx: any) {
  const row = ctx.db.persona.identity.find(ctx.sender);
  if (!row) throw new Error('LINEAR_PERSONA_REQUIRED');
  return row;
}

function activeOrganizationMembership(ctx: any, identity: Identity, organizationId: string) {
  const id = `${organizationId}:${identityKey(identity)}`;
  const row = ctx.db.organizationMembership.id.find(id);
  return row?.active ? row : undefined;
}

function activeTeamMembership(ctx: any, identity: Identity, teamId: string) {
  const id = `${teamId}:${identityKey(identity)}`;
  const row = ctx.db.teamMembership.id.find(id);
  return row?.active ? row : undefined;
}

function canReadIssue(
  ctx: any,
  target: { organizationId: string; teamId: string },
): boolean {
  const organizationRole = activeOrganizationMembership(
    ctx,
    ctx.sender,
    target.organizationId,
  );
  if (organizationRole?.role === 'owner') return true;
  return Boolean(activeTeamMembership(ctx, ctx.sender, target.teamId));
}

function requireReadableIssue(ctx: any, issueId: string) {
  requirePersona(ctx);
  const target = ctx.db.issue.id.find(issueId);
  if (!target || !canReadIssue(ctx, target)) throw new Error('LINEAR_NOT_AUTHORIZED');
  return target;
}

function requireOwner(ctx: any) {
  const actor = requirePersona(ctx);
  const membership = activeOrganizationMembership(ctx, ctx.sender, PRIMARY_ORGANIZATION);
  if (!membership || membership.role !== 'owner') throw new Error('LINEAR_OWNER_REQUIRED');
  return actor;
}

function addActivity(
  ctx: any,
  issueId: string,
  actor: { identity: Identity; name: string },
  kind: string,
  detail: string,
) {
  ctx.db.activity.insert({
    id: 0n,
    issueId,
    actor: actor.identity,
    actorName: actor.name,
    kind,
    detail,
    createdAt: ctx.timestamp,
  });
}

export const registerPersona = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    if (!['Alice', 'Bob', 'Mallory'].includes(name)) {
      throw new Error('LINEAR_UNKNOWN_PERSONA');
    }
    const current = ctx.db.persona.identity.find(ctx.sender);
    if (current && current.name !== name) throw new Error('LINEAR_IDENTITY_ALREADY_BOUND');
    const claimed = ctx.db.persona.name.find(name);
    if (claimed && identityKey(claimed.identity) !== identityKey(ctx.sender)) {
      throw new Error('LINEAR_PERSONA_ALREADY_CLAIMED');
    }
    if (!current) ctx.db.persona.insert({ identity: ctx.sender, name });
  },
);

export const seedFixtures = spacetimedb.reducer((ctx) => {
  const actor = requirePersona(ctx);
  if (actor.name !== 'Alice') throw new Error('LINEAR_ONLY_ALICE_SEEDS');
  if (ctx.db.organization.id.find(PRIMARY_ORGANIZATION)) {
    throw new Error('LINEAR_FIXTURE_ALREADY_SEEDED');
  }
  const alice = ctx.db.persona.name.find('Alice');
  const bob = ctx.db.persona.name.find('Bob');
  const mallory = ctx.db.persona.name.find('Mallory');
  if (!alice || !bob || !mallory) throw new Error('LINEAR_ALL_PERSONAS_REQUIRED');

  ctx.db.organization.insert({ id: PRIMARY_ORGANIZATION, name: 'Acme Systems' });
  ctx.db.organization.insert({ id: SECONDARY_ORGANIZATION, name: 'Control Organization' });
  ctx.db.organizationMembership.insert({
    id: `${PRIMARY_ORGANIZATION}:${identityKey(alice.identity)}`,
    organizationId: PRIMARY_ORGANIZATION,
    identity: alice.identity,
    role: 'owner',
    active: true,
  });
  ctx.db.organizationMembership.insert({
    id: `${PRIMARY_ORGANIZATION}:${identityKey(bob.identity)}`,
    organizationId: PRIMARY_ORGANIZATION,
    identity: bob.identity,
    role: 'member',
    active: true,
  });

  const teams = ['Platform', 'Client', 'Infrastructure'].map((name, index) => ({
    id: `team-${index + 1}`,
    organizationId: PRIMARY_ORGANIZATION,
    name,
  }));
  for (const target of teams) {
    ctx.db.team.insert(target);
    for (const member of [
      { identity: alice.identity, role: 'owner' },
      { identity: bob.identity, role: 'member' },
    ]) {
      ctx.db.teamMembership.insert({
        id: `${target.id}:${identityKey(member.identity)}`,
        teamId: target.id,
        identity: member.identity,
        role: member.role,
        active: true,
      });
    }
  }

  const projects = ['Atlas', 'Beacon', 'Comet', 'Delta'].map((name, index) => ({
    id: `project-${index + 1}`,
    organizationId: PRIMARY_ORGANIZATION,
    teamId: teams[index % teams.length].id,
    name,
  }));
  for (const target of projects) ctx.db.project.insert(target);

  const labels = Array.from({ length: 20 }, (_, index) => ({
    id: `label-${String(index + 1).padStart(2, '0')}`,
    organizationId: PRIMARY_ORGANIZATION,
    name: `Label ${String(index + 1).padStart(2, '0')}`,
    color: `hsl(${index * 18} 60% 55%)`,
  }));
  for (const target of labels) ctx.db.label.insert(target);

  for (let ordinal = 1; ordinal <= 500; ordinal += 1) {
    const id = `issue-${String(ordinal).padStart(3, '0')}`;
    const teamId = teams[(ordinal - 1) % teams.length].id;
    const projectId = projects[(ordinal - 1) % projects.length].id;
    const status = STATUSES[(ordinal - 1) % STATUSES.length];
    const priority = PRIORITIES[(ordinal - 1) % PRIORITIES.length];
    const assigneeName = ordinal % 2 === 0 ? 'Alice' : 'Bob';
    ctx.db.issue.insert({
      id,
      identifier: `LIN-${String(ordinal).padStart(3, '0')}`,
      organizationId: PRIMARY_ORGANIZATION,
      teamId,
      projectId,
      title: `Production issue ${String(ordinal).padStart(3, '0')}`,
      description: `Deterministic production-shaped description for issue ${ordinal}.`,
      status,
      priority,
      assigneeName,
      boardPosition: ordinal - 1,
      sortKey: `${String(ordinal).padStart(6, '0')}:${id}`,
      revision: 1n,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    for (const labelOffset of [0, 7]) {
      const labelId = labels[(ordinal - 1 + labelOffset) % labels.length].id;
      ctx.db.issueLabel.insert({
        id: `${id}:${labelId}`,
        issueId: id,
        labelId,
      });
    }
    for (let commentIndex = 1; commentIndex <= 2; commentIndex += 1) {
      const author = commentIndex % 2 === 1 ? alice : bob;
      ctx.db.comment.insert({
        id: 0n,
        issueId: id,
        author: author.identity,
        authorName: author.name,
        body: `Fixture comment ${commentIndex} for LIN-${String(ordinal).padStart(3, '0')}`,
        createdAt: ctx.timestamp,
      });
    }
    addActivity(ctx, id, alice, 'seeded', 'Issue created by deterministic seed');
  }
});

export const requestIssuePage = spacetimedb.reducer(
  {
    requestId: t.string(),
    status: t.string(),
    assigneeName: t.string(),
    projectId: t.string(),
    labelId: t.string(),
    afterSortKey: t.string(),
  },
  (ctx, filters) => {
    requirePersona(ctx);
    const ownedRequest = `${identityKey(ctx.sender)}:${filters.requestId}`;
    for (const old of Array.from(ctx.db.pageResult.requestId.filter(ownedRequest))) {
      ctx.db.pageResult.id.delete(old.id);
    }

    let candidates: Array<typeof issue.rowType.type>;
    if (filters.status) {
      candidates = Array.from(ctx.db.issue.status.filter(filters.status));
    } else if (filters.assigneeName) {
      candidates = Array.from(ctx.db.issue.assigneeName.filter(filters.assigneeName));
    } else if (filters.projectId) {
      candidates = Array.from(ctx.db.issue.projectId.filter(filters.projectId));
    } else {
      candidates = Array.from(ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION));
    }
    const rows = candidates
      .filter((row) => canReadIssue(ctx, row))
      .filter((row) => !filters.status || row.status === filters.status)
      .filter((row) => !filters.assigneeName || row.assigneeName === filters.assigneeName)
      .filter((row) => !filters.projectId || row.projectId === filters.projectId)
      .filter((row) => !filters.labelId || Boolean(
        ctx.db.issueLabel.id.find(`${row.id}:${filters.labelId}`),
      ))
      .filter((row) => !filters.afterSortKey || row.sortKey > filters.afterSortKey)
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .slice(0, 50);
    for (const row of rows) {
      ctx.db.pageResult.insert({
        id: `${ownedRequest}:${row.id}`,
        requestId: ownedRequest,
        owner: ctx.sender,
        issueId: row.id,
        identifier: row.identifier,
        title: row.title,
        status: row.status,
        priority: row.priority,
        assigneeName: row.assigneeName,
        projectId: row.projectId,
        boardPosition: row.boardPosition,
        sortKey: row.sortKey,
        revision: row.revision,
      });
    }
  },
);

export const createIssue = spacetimedb.reducer(
  {
    id: t.string(),
    identifier: t.string(),
    teamId: t.string(),
    projectId: t.string(),
    title: t.string(),
    status: t.string(),
    priority: t.string(),
    assigneeName: t.string(),
    boardPosition: t.u32(),
    sortKey: t.string(),
  },
  (ctx, input) => {
    const actor = requirePersona(ctx);
    const authorizationProbe = {
      organizationId: PRIMARY_ORGANIZATION,
      teamId: input.teamId,
    };
    if (!canReadIssue(ctx, authorizationProbe)) throw new Error('LINEAR_NOT_AUTHORIZED');
    if (ctx.db.issue.id.find(input.id)) throw new Error('LINEAR_DUPLICATE_ISSUE');
    if (!ctx.db.project.id.find(input.projectId)) throw new Error('LINEAR_PROJECT_NOT_FOUND');
    ctx.db.issue.insert({
      ...input,
      organizationId: PRIMARY_ORGANIZATION,
      description: 'Created during acceptance.',
      revision: 1n,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    addActivity(ctx, input.id, actor, 'created', input.title);
  },
);

export const updateIssue = spacetimedb.reducer(
  {
    issueId: t.string(),
    expectedRevision: t.u64(),
    status: t.string(),
    priority: t.string(),
    assigneeName: t.string(),
    boardPosition: t.u32(),
  },
  (ctx, input) => {
    const actor = requirePersona(ctx);
    const current = requireReadableIssue(ctx, input.issueId);
    if (current.revision !== input.expectedRevision) {
      throw new Error('LINEAR_REVISION_CONFLICT');
    }
    ctx.db.issue.id.update({
      ...current,
      status: input.status,
      priority: input.priority,
      assigneeName: input.assigneeName,
      boardPosition: input.boardPosition,
      revision: current.revision + 1n,
      updatedAt: ctx.timestamp,
    });
    addActivity(
      ctx,
      current.id,
      actor,
      'updated',
      `revision ${current.revision.toString()} -> ${(current.revision + 1n).toString()}`,
    );
  },
);

export const addComment = spacetimedb.reducer(
  { issueId: t.string(), body: t.string() },
  (ctx, { issueId, body }) => {
    const actor = requirePersona(ctx);
    requireReadableIssue(ctx, issueId);
    if (!body || body.length > 4000) throw new Error('LINEAR_INVALID_COMMENT');
    ctx.db.comment.insert({
      id: 0n,
      issueId,
      author: ctx.sender,
      authorName: actor.name,
      body,
      createdAt: ctx.timestamp,
    });
    addActivity(ctx, issueId, actor, 'commented', body.slice(0, 120));
  },
);

export const ownerOnlyProbe = spacetimedb.reducer((ctx) => {
  requireOwner(ctx);
});

export const myOrganizations = spacetimedb.view(
  { name: 'my_organizations', public: true },
  t.array(organization.rowType),
  (ctx) => {
    const rows = [];
    for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
      if (!membership.active) continue;
      const target = ctx.db.organization.id.find(membership.organizationId);
      if (target) rows.push(target);
    }
    return rows;
  },
);

export const myTeams = spacetimedb.view(
  { name: 'my_teams', public: true },
  t.array(team.rowType),
  (ctx) => {
    const rows: Array<typeof team.rowType.type> = [];
    const seen = new Set<string>();
    for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
      if (!membership.active || membership.role !== 'owner') continue;
      for (const target of ctx.db.team.organizationId.filter(membership.organizationId)) {
        rows.push(target);
        seen.add(target.id);
      }
    }
    for (const membership of ctx.db.teamMembership.identity.filter(ctx.sender)) {
      if (!membership.active || seen.has(membership.teamId)) continue;
      const target = ctx.db.team.id.find(membership.teamId);
      if (target) rows.push(target);
    }
    return rows;
  },
);

export const myProjects = spacetimedb.view(
  { name: 'my_projects', public: true },
  t.array(project.rowType),
  (ctx) => {
    const rows: Array<typeof project.rowType.type> = [];
    const seen = new Set<string>();
    for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
      if (!membership.active) continue;
      for (const target of ctx.db.project.organizationId.filter(membership.organizationId)) {
        if (!seen.has(target.id)) rows.push(target);
        seen.add(target.id);
      }
    }
    return rows;
  },
);

export const myLabels = spacetimedb.view(
  { name: 'my_labels', public: true },
  t.array(label.rowType),
  (ctx) => {
    const rows: Array<typeof label.rowType.type> = [];
    const seen = new Set<string>();
    for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
      if (!membership.active) continue;
      for (const target of ctx.db.label.organizationId.filter(membership.organizationId)) {
        if (!seen.has(target.id)) rows.push(target);
        seen.add(target.id);
      }
    }
    return rows;
  },
);

export const myIssues = spacetimedb.view(
  { name: 'my_issues', public: true },
  t.array(issue.rowType),
  (ctx) => {
    const rows: Array<typeof issue.rowType.type> = [];
    const seen = new Set<string>();
    for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
      if (!membership.active || membership.role !== 'owner') continue;
      for (const target of ctx.db.issue.organizationId.filter(membership.organizationId)) {
        rows.push(target);
        seen.add(target.id);
      }
    }
    for (const membership of ctx.db.teamMembership.identity.filter(ctx.sender)) {
      if (!membership.active) continue;
      for (const target of ctx.db.issue.teamId.filter(membership.teamId)) {
        if (!seen.has(target.id)) rows.push(target);
        seen.add(target.id);
      }
    }
    return rows;
  },
);

export const myIssueLabels = spacetimedb.view(
  { name: 'my_issue_labels', public: true },
  t.array(issueLabel.rowType),
  (ctx) => {
    const rows: Array<typeof issueLabel.rowType.type> = [];
    for (const target of ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION)) {
      if (!canReadIssue(ctx, target)) continue;
      rows.push(...Array.from(ctx.db.issueLabel.issueId.filter(target.id)));
    }
    return rows;
  },
);

export const myComments = spacetimedb.view(
  { name: 'my_comments', public: true },
  t.array(comment.rowType),
  (ctx) => {
    const rows: Array<typeof comment.rowType.type> = [];
    for (const target of ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION)) {
      if (!canReadIssue(ctx, target)) continue;
      rows.push(...Array.from(ctx.db.comment.issueId.filter(target.id)));
    }
    return rows;
  },
);

export const myActivities = spacetimedb.view(
  { name: 'my_activities', public: true },
  t.array(activity.rowType),
  (ctx) => {
    const rows: Array<typeof activity.rowType.type> = [];
    for (const target of ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION)) {
      if (!canReadIssue(ctx, target)) continue;
      rows.push(...Array.from(ctx.db.activity.issueId.filter(target.id)));
    }
    return rows;
  },
);

export const myPageResults = spacetimedb.view(
  { name: 'my_page_results', public: true },
  t.array(pageResult.rowType),
  (ctx) => Array.from(ctx.db.pageResult.owner.filter(ctx.sender)),
);
