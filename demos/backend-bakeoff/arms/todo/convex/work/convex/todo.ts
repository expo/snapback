import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

const workspaceSlug = "llp0102-todo-convex-calibration-01";

function requireAdminProof(proof: string) {
  const expected = process.env.ARM_ADMIN_PROOF;
  if (!expected || proof !== expected) {
    throw new ConvexError("ADMIN_PROOF_REQUIRED");
  }
}

async function workspace(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_slug", (q) => q.eq("slug", workspaceSlug))
    .unique();
}

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("AUTH_REQUIRED");
  return userId;
}

async function requireMember(ctx: QueryCtx | MutationCtx) {
  const userId = await requireUser(ctx);
  const currentWorkspace = await workspace(ctx);
  if (!currentWorkspace) throw new ConvexError("WORKSPACE_NOT_SEEDED");
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", currentWorkspace._id).eq("userId", userId),
    )
    .unique();
  if (!membership?.active) throw new ConvexError("MEMBERSHIP_REQUIRED");
  return { userId, currentWorkspace, membership };
}

export const seed = mutation({
  args: { proof: v.string() },
  handler: async (ctx, { proof }) => {
    requireAdminProof(proof);
    if (await workspace(ctx)) throw new ConvexError("ALREADY_SEEDED");
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: workspaceSlug,
      name: "Backend Bakeoff",
    });
    const listNames = ["Inbox", "Today", "Upcoming", "Someday"];
    for (let listIndex = 0; listIndex < listNames.length; listIndex += 1) {
      const listId = await ctx.db.insert("lists", {
        workspaceId,
        name: listNames[listIndex],
        taskIds: [],
      });
      const taskIds: Id<"tasks">[] = [];
      for (let taskIndex = 0; taskIndex < 25; taskIndex += 1) {
        taskIds.push(await ctx.db.insert("tasks", {
          workspaceId,
          listId,
          title: `Task ${String(listIndex * 25 + taskIndex + 1).padStart(3, "0")}`,
          completed: false,
          revision: 0,
        }));
      }
      await ctx.db.patch(listId, { taskIds });
    }
    return { workspaceId, taskCount: 100 };
  },
});

export const grantMember = mutation({
  args: {
    proof: v.string(),
    userId: v.id("users"),
    role: v.union(v.literal("member"), v.literal("owner")),
  },
  handler: async (ctx, { proof, userId, role }) => {
    requireAdminProof(proof);
    const currentWorkspace = await workspace(ctx);
    if (!currentWorkspace) throw new ConvexError("WORKSPACE_NOT_SEEDED");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", currentWorkspace._id).eq("userId", userId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { active: true, role });
      return existing._id;
    }
    return await ctx.db.insert("memberships", {
      workspaceId: currentWorkspace._id,
      userId,
      active: true,
      role,
    });
  },
});

export const provisionMembers = mutation({
  args: {
    proof: v.string(),
    aliceUserId: v.id("users"),
    bobUserId: v.id("users"),
  },
  handler: async (ctx, { proof, aliceUserId, bobUserId }) => {
    requireAdminProof(proof);
    const currentWorkspace = await workspace(ctx);
    if (!currentWorkspace) throw new ConvexError("WORKSPACE_NOT_SEEDED");
    const intended = new Set([aliceUserId, bobUserId]);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", currentWorkspace._id))
      .collect();
    for (const membership of memberships) {
      await ctx.db.patch(membership._id, {
        active: intended.has(membership.userId),
      });
    }
    for (const userId of intended) {
      const existing = memberships.find(
        (membership) => membership.userId === userId,
      );
      if (!existing) {
        await ctx.db.insert("memberships", {
          workspaceId: currentWorkspace._id,
          userId,
          active: true,
          role: "member",
        });
      }
    }
  },
});

export const revokeMember = mutation({
  args: { proof: v.string(), userId: v.id("users") },
  handler: async (ctx, { proof, userId }) => {
    requireAdminProof(proof);
    const currentWorkspace = await workspace(ctx);
    if (!currentWorkspace) throw new ConvexError("WORKSPACE_NOT_SEEDED");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", currentWorkspace._id).eq("userId", userId),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, { active: false });
  },
});

export const cleanupMarkers = mutation({
  args: { proof: v.string(), prefix: v.string() },
  handler: async (ctx, { proof, prefix }) => {
    requireAdminProof(proof);
    const currentWorkspace = await workspace(ctx);
    if (!currentWorkspace) throw new ConvexError("WORKSPACE_NOT_SEEDED");
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", currentWorkspace._id))
      .collect();
    const matches = tasks.filter((task) => task.title.startsWith(prefix));
    for (const task of matches) {
      const list = await ctx.db.get(task.listId);
      if (list) {
        await ctx.db.patch(list._id, {
          taskIds: list.taskIds.filter((candidate) => candidate !== task._id),
        });
      }
      await ctx.db.delete(task._id);
    }
    return matches.length;
  },
});

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { userId: null, activeMember: false };
    const currentWorkspace = await workspace(ctx);
    if (!currentWorkspace) return { userId, activeMember: false };
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", currentWorkspace._id).eq("userId", userId),
      )
      .unique();
    return {
      userId,
      activeMember: membership?.active ?? false,
      role: membership?.active ? membership.role : null,
    };
  },
});

export const snapshot = query({
  args: {},
  handler: async (ctx) => {
    let authority;
    try {
      authority = await requireMember(ctx);
    } catch {
      return { workspace: null, lists: [], tasks: [] };
    }
    const lists = await ctx.db
      .query("lists")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", authority.currentWorkspace._id),
      )
      .collect();
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", authority.currentWorkspace._id),
      )
      .collect();
    const positions = new Map<string, number>();
    for (const list of lists) {
      list.taskIds.forEach((taskId, index) => positions.set(taskId, index));
    }
    return {
      workspace: authority.currentWorkspace,
      lists,
      tasks: tasks.map((task) => ({
        ...task,
        position: positions.get(task._id) ?? -1,
      })),
    };
  },
});

export const authoritativeSummary = query({
  args: { proof: v.string() },
  handler: async (ctx, { proof }) => {
    requireAdminProof(proof);
    const currentWorkspace = await workspace(ctx);
    if (!currentWorkspace) return null;
    const [memberships, lists, tasks] = await Promise.all([
      ctx.db
        .query("memberships")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", currentWorkspace._id))
        .collect(),
      ctx.db
        .query("lists")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", currentWorkspace._id))
        .collect(),
      ctx.db
        .query("tasks")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", currentWorkspace._id))
        .collect(),
    ]);
    return {
      taskCount: tasks.length,
      listCount: lists.length,
      activeMemberCount: memberships.filter((membership) => membership.active).length,
      listOrderSizes: lists.map((list) => list.taskIds.length),
    };
  },
});

export const authoritativeTask = query({
  args: { proof: v.string(), taskId: v.id("tasks") },
  handler: async (ctx, { proof, taskId }) => {
    requireAdminProof(proof);
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    const list = await ctx.db.get(task.listId);
    if (!list) return null;
    return {
      title: task.title,
      completed: task.completed,
      revision: task.revision,
      position: list.taskIds.indexOf(taskId),
      listOrderSize: list.taskIds.length,
      listOrderUnique: new Set(list.taskIds).size === list.taskIds.length,
    };
  },
});

export const createTask = mutation({
  args: { listId: v.id("lists"), title: v.string() },
  handler: async (ctx, { listId, title }) => {
    const { currentWorkspace } = await requireMember(ctx);
    const list = await ctx.db.get(listId);
    if (!list || list.workspaceId !== currentWorkspace._id) {
      throw new ConvexError("LIST_NOT_AUTHORIZED");
    }
    const taskId = await ctx.db.insert("tasks", {
      workspaceId: currentWorkspace._id,
      listId,
      title,
      completed: false,
      revision: 0,
    });
    await ctx.db.patch(listId, { taskIds: [...list.taskIds, taskId] });
    return taskId;
  },
});

export const updateTask = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    completed: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskId, title, completed }) => {
    const { currentWorkspace } = await requireMember(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.workspaceId !== currentWorkspace._id) {
      throw new ConvexError("TASK_NOT_AUTHORIZED");
    }
    const patch: Partial<Doc<"tasks">> = { revision: task.revision + 1 };
    if (title !== undefined) patch.title = title;
    if (completed !== undefined) patch.completed = completed;
    await ctx.db.patch(taskId, patch);
    return task.revision + 1;
  },
});

export const moveTask = mutation({
  args: {
    taskId: v.id("tasks"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, { taskId, direction }) => {
    const { currentWorkspace } = await requireMember(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.workspaceId !== currentWorkspace._id) {
      throw new ConvexError("TASK_NOT_AUTHORIZED");
    }
    const list = await ctx.db.get(task.listId);
    if (!list) throw new ConvexError("LIST_MISSING");
    const taskIds = [...list.taskIds];
    const from = taskIds.indexOf(taskId);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= taskIds.length) return;
    [taskIds[from], taskIds[to]] = [taskIds[to], taskIds[from]];
    await ctx.db.patch(list._id, { taskIds });
  },
});

export const deleteTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { currentWorkspace } = await requireMember(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.workspaceId !== currentWorkspace._id) {
      throw new ConvexError("TASK_NOT_AUTHORIZED");
    }
    const list = await ctx.db.get(task.listId);
    if (!list) throw new ConvexError("LIST_MISSING");
    await ctx.db.patch(list._id, {
      taskIds: list.taskIds.filter((candidate) => candidate !== taskId),
    });
    await ctx.db.delete(taskId);
  },
});
