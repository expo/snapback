import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const namespace = "llp0102-linear-convex-coord";
const seedKey = "llp0102-linear-public-seed";
const pageSize = 50;

async function subject(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  return identity.subject;
}

async function requireMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const actor = await subject(ctx);
  const membership = await ctx.db.query("memberships")
    .withIndex("by_org_subject", (q) => q.eq("organizationId", organizationId).eq("subject", actor))
    .unique();
  if (!membership?.active) throw new ConvexError("UNAUTHORIZED_ORGANIZATION");
  return { actor, membership };
}

async function issueAndMember(ctx: QueryCtx | MutationCtx, issueId: Id<"issues">) {
  const issue = await ctx.db.get(issueId);
  if (!issue || issue.namespace !== namespace) throw new ConvexError("ISSUE_NOT_FOUND");
  const authority = await requireMember(ctx, issue.organizationId);
  return { issue, ...authority };
}

export const seedMeta = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key !== seedKey) throw new ConvexError("BAD_SEED_KEY");
    const existing = await ctx.db.query("organizations")
      .withIndex("by_namespace", (q) => q.eq("namespace", namespace)).first();
    if (existing) throw new ConvexError("NAMESPACE_ALREADY_SEEDED");
    for (const actor of ["alice", "bob", "mallory"]) {
      await ctx.db.insert("profiles", {
        namespace, subject: actor, name: actor[0].toUpperCase() + actor.slice(1),
      });
    }
    const primaryId = await ctx.db.insert("organizations", { namespace, name: "Acme", slug: "acme" });
    const secondaryId = await ctx.db.insert("organizations", { namespace, name: "Umbrella", slug: "umbrella" });
    for (const organizationId of [primaryId, secondaryId]) {
      await ctx.db.insert("memberships", {
        namespace, organizationId, subject: "alice", role: "owner", active: true,
      });
      await ctx.db.insert("memberships", {
        namespace, organizationId, subject: "bob", role: "member", active: true,
      });
    }
    const teamIds = [];
    for (const [name, key] of [["Engineering", "ENG"], ["Product", "PROD"], ["Operations", "OPS"]]) {
      teamIds.push(await ctx.db.insert("teams", { namespace, organizationId: primaryId, name, key }));
    }
    const projectIds = [];
    for (const [index, name] of ["Launch", "Reliability", "Mobile", "Growth"].entries()) {
      projectIds.push(await ctx.db.insert("projects", {
        namespace, organizationId: primaryId, name, state: index === 0 ? "active" : "planned",
      }));
    }
    const labelIds = [];
    for (let index = 0; index < 20; index += 1) {
      labelIds.push(await ctx.db.insert("labels", {
        namespace, organizationId: primaryId,
        name: `Label ${String(index + 1).padStart(2, "0")}`,
        color: `hsl(${index * 18} 70% 50%)`,
      }));
    }
    return { namespace, primaryId, secondaryId, teamIds, projectIds, labelIds };
  },
});

export const seedIssues = mutation({
  args: {
    key: v.string(), organizationId: v.id("organizations"),
    startSequence: v.number(), count: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.key !== seedKey || args.count !== 100 || args.startSequence % 100 !== 0) {
      throw new ConvexError("BAD_SEED_BATCH");
    }
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.namespace !== namespace) throw new ConvexError("BAD_ORGANIZATION");
    const teams = await ctx.db.query("teams").withIndex("by_org_key", (q) =>
      q.eq("organizationId", args.organizationId)).collect();
    const projects = await ctx.db.query("projects").withIndex("by_org_name", (q) =>
      q.eq("organizationId", args.organizationId)).collect();
    const labels = await ctx.db.query("labels").withIndex("by_org_name", (q) =>
      q.eq("organizationId", args.organizationId)).collect();
    const statuses = ["backlog", "todo", "in_progress", "done", "cancelled"];
    for (let sequence = args.startSequence; sequence < args.startSequence + args.count; sequence += 1) {
      const team = teams[sequence % teams.length];
      const issueId = await ctx.db.insert("issues", {
        namespace, organizationId: args.organizationId,
        teamId: team._id, projectId: projects[sequence % projects.length]._id,
        assigneeSubject: sequence % 2 === 0 ? "alice" : "bob",
        identifier: `${team.key}-${sequence + 1}`, sequence,
        title: `Production issue ${String(sequence + 1).padStart(3, "0")}`,
        description: `Seeded issue ${sequence + 1} for the frozen Linear workload`,
        status: statuses[sequence % statuses.length],
        priority: sequence % 5, boardPosition: Math.floor(sequence / 5), revision: 0,
      });
      await ctx.db.insert("issueLabels", {
        namespace, organizationId: args.organizationId,
        issueId, labelId: labels[sequence % labels.length]._id,
      });
      for (let commentSequence = 0; commentSequence < 2; commentSequence += 1) {
        await ctx.db.insert("comments", {
          namespace, organizationId: args.organizationId, issueId,
          authorSubject: commentSequence === 0 ? "alice" : "bob",
          sequence: commentSequence, body: `Comment ${commentSequence + 1} on issue ${sequence + 1}`,
        });
      }
      await ctx.db.insert("activities", {
        namespace, organizationId: args.organizationId, issueId,
        actorSubject: "alice", sequence: 0, kind: "created", body: `Created ${sequence + 1}`,
      });
    }
    return args.count;
  },
});

export const listIssues = query({
  args: {
    organizationId: v.id("organizations"), status: v.optional(v.string()),
    assigneeSubject: v.optional(v.string()), projectId: v.optional(v.id("projects")),
    labelId: v.optional(v.id("labels")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    let rows;
    if (args.status !== undefined) {
      rows = await ctx.db.query("issues").withIndex("by_org_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", args.status!)).collect();
    } else if (args.assigneeSubject !== undefined) {
      rows = await ctx.db.query("issues").withIndex("by_org_assignee", (q) =>
        q.eq("organizationId", args.organizationId).eq("assigneeSubject", args.assigneeSubject!)).collect();
    } else if (args.projectId !== undefined) {
      rows = await ctx.db.query("issues").withIndex("by_org_project", (q) =>
        q.eq("organizationId", args.organizationId).eq("projectId", args.projectId!)).collect();
    } else {
      rows = await ctx.db.query("issues").withIndex("by_org_sequence", (q) =>
        q.eq("organizationId", args.organizationId)).collect();
    }
    if (args.labelId !== undefined) {
      const links = await ctx.db.query("issueLabels").withIndex("by_label_issue", (q) =>
        q.eq("labelId", args.labelId!)).collect();
      const ids = new Set(links.map((link) => link.issueId));
      rows = rows.filter((row) => ids.has(row._id));
    }
    return rows.sort((a, b) => a.sequence - b.sequence || String(a._id).localeCompare(String(b._id)));
  },
});

export const pageIssues = query({
  args: {
    organizationId: v.id("organizations"), afterSequence: v.optional(v.number()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    if (args.limit !== pageSize) throw new ConvexError("FROZEN_PAGE_SIZE");
    const after = args.afterSequence ?? -1;
    return await ctx.db.query("issues").withIndex("by_org_sequence", (q) =>
      q.eq("organizationId", args.organizationId).gt("sequence", after)).take(pageSize);
  },
});

export const metadata = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const [teams, projects, labels] = await Promise.all([
      ctx.db.query("teams").withIndex("by_org_key", (q) => q.eq("organizationId", args.organizationId)).collect(),
      ctx.db.query("projects").withIndex("by_org_name", (q) => q.eq("organizationId", args.organizationId)).collect(),
      ctx.db.query("labels").withIndex("by_org_name", (q) => q.eq("organizationId", args.organizationId)).collect(),
    ]);
    return { teams, projects, labels };
  },
});

export const issueDetail = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const { issue } = await issueAndMember(ctx, args.issueId);
    const [project, labels, comments, activity] = await Promise.all([
      ctx.db.get(issue.projectId),
      ctx.db.query("issueLabels").withIndex("by_issue_label", (q) => q.eq("issueId", args.issueId)).collect(),
      ctx.db.query("comments").withIndex("by_issue_sequence", (q) => q.eq("issueId", args.issueId)).collect(),
      ctx.db.query("activities").withIndex("by_issue_sequence", (q) => q.eq("issueId", args.issueId)).collect(),
    ]);
    return { issue, project, assigneeSubject: issue.assigneeSubject, labels, comments, activity };
  },
});

export const commentsAndActivity = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    await issueAndMember(ctx, args.issueId);
    const [comments, activity] = await Promise.all([
      ctx.db.query("comments").withIndex("by_issue_sequence", (q) => q.eq("issueId", args.issueId)).collect(),
      ctx.db.query("activities").withIndex("by_issue_sequence", (q) => q.eq("issueId", args.issueId)).collect(),
    ]);
    return { comments, activity };
  },
});

export const createIssue = mutation({
  args: {
    organizationId: v.id("organizations"), teamId: v.id("teams"),
    projectId: v.id("projects"), assigneeSubject: v.string(),
    title: v.string(), sequence: v.number(),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireMember(ctx, args.organizationId);
    const team = await ctx.db.get(args.teamId);
    const project = await ctx.db.get(args.projectId);
    if (team?.organizationId !== args.organizationId || project?.organizationId !== args.organizationId) {
      throw new ConvexError("CROSS_ORGANIZATION_RELATION");
    }
    const issueId = await ctx.db.insert("issues", {
      namespace, organizationId: args.organizationId, teamId: args.teamId,
      projectId: args.projectId, assigneeSubject: args.assigneeSubject,
      identifier: `${team.key}-${args.sequence + 1}`, sequence: args.sequence,
      title: args.title.trim(), description: "", status: "backlog",
      priority: 0, boardPosition: args.sequence, revision: 0,
    });
    await ctx.db.insert("activities", {
      namespace, organizationId: args.organizationId, issueId,
      actorSubject: actor, sequence: 0, kind: "created", body: "Created issue",
    });
    return issueId;
  },
});

export const updateIssue = mutation({
  args: {
    issueId: v.id("issues"), expectedRevision: v.optional(v.number()),
    status: v.optional(v.string()), priority: v.optional(v.number()),
    assigneeSubject: v.optional(v.string()), boardPosition: v.optional(v.number()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { issue, actor } = await issueAndMember(ctx, args.issueId);
    if (args.expectedRevision !== undefined && issue.revision !== args.expectedRevision) {
      throw new ConvexError("REVISION_CONFLICT");
    }
    const patch: Record<string, string | number> = { revision: issue.revision + 1 };
    for (const key of ["status", "priority", "assigneeSubject", "boardPosition", "title"] as const) {
      if (args[key] !== undefined) patch[key] = args[key]!;
    }
    await ctx.db.patch(args.issueId, patch);
    const activity = await ctx.db.query("activities").withIndex("by_issue_sequence", (q) =>
      q.eq("issueId", args.issueId)).collect();
    await ctx.db.insert("activities", {
      namespace, organizationId: issue.organizationId, issueId: args.issueId,
      actorSubject: actor, sequence: activity.length, kind: "updated",
      body: Object.keys(patch).sort().join(","),
    });
    return { revision: issue.revision + 1 };
  },
});

export const addComment = mutation({
  args: { issueId: v.id("issues"), body: v.string(), sequence: v.number() },
  handler: async (ctx, args) => {
    const { issue, actor } = await issueAndMember(ctx, args.issueId);
    const commentId = await ctx.db.insert("comments", {
      namespace, organizationId: issue.organizationId, issueId: args.issueId,
      authorSubject: actor, sequence: args.sequence, body: args.body.trim(),
    });
    await ctx.db.insert("activities", {
      namespace, organizationId: issue.organizationId, issueId: args.issueId,
      actorSubject: actor, sequence: args.sequence + 1,
      kind: "commented", body: "Added comment",
    });
    return commentId;
  },
});

export const searchIssues = query({
  args: { organizationId: v.id("organizations"), term: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    return await ctx.db.query("issues").withSearchIndex("search_title", (q) =>
      q.search("title", args.term).eq("namespace", namespace).eq("organizationId", args.organizationId)
    ).take(50);
  },
});

export const backfillTriageScore = mutation({
  args: { key: v.string(), organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    if (args.key !== seedKey) throw new ConvexError("BAD_SEED_KEY");
    const rows = await ctx.db.query("issues").withIndex("by_org_sequence", (q) =>
      q.eq("organizationId", args.organizationId)).collect();
    let changed = 0;
    for (const row of rows) {
      if (row.triageScore !== undefined) continue;
      await ctx.db.patch(row._id, { triageScore: row.priority * 10 });
      changed += 1;
    }
    return { before: rows.length, changed };
  },
});

export const triageIndex = query({
  args: { organizationId: v.id("organizations"), minimum: v.number() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    return await ctx.db.query("issues").withIndex("by_org_triage", (q) =>
      q.eq("organizationId", args.organizationId).gte("triageScore", args.minimum)).collect();
  },
});

const tables = [
  "profiles", "organizations", "memberships", "teams", "projects",
  "labels", "issues", "issueLabels", "comments", "activities",
] as const;

export const inspect = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key !== seedKey) throw new ConvexError("BAD_SEED_KEY");
    const result: Record<string, number | string> = { namespace };
    for (const table of tables) {
      result[table] = (await ctx.db.query(table).collect())
        .filter((row) => row.namespace === namespace).length;
    }
    return result;
  },
});

export const cleanup = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key !== seedKey) throw new ConvexError("BAD_SEED_KEY");
    const deleted: Record<string, number> = {};
    for (const table of [...tables].reverse()) {
      const rows = (await ctx.db.query(table).collect())
        .filter((row) => row.namespace === namespace);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted[table] = rows.length;
    }
    return { namespace, deleted };
  },
});
