// Bundled server handlers. The injected ctx is the only authority and data
// surface; browser input never selects a principal or bypasses membership.

async function requireMember(ctx, workspaceId) {
  await ctx.permissions.workspaceMembers.requireRole(workspaceId, 'owner', 'member');
}

globalThis.__snapbackHandlers = {
  async listLists(ctx, args) {
    await requireMember(ctx, args.workspaceId);
    return await ctx.db
      .query('lists')
      .withIndex('by_workspace_position')
      .eq('workspaceId', args.workspaceId)
      .order('position', 'asc')
      .collect();
  },

  async listTasks(ctx, args) {
    await requireMember(ctx, args.workspaceId);
    return await ctx.db
      .query('tasks')
      .withIndex('by_workspace_position')
      .eq('workspaceId', args.workspaceId)
      .order('position', 'asc')
      .collect();
  },

  async bootstrapWorkspace(ctx, args) {
    const name = String(args.name).trim();
    if (!name) throw new Error('workspace name is required');
    const workspaceId = await ctx.membership.workspaceMembers.bootstrap({
      name,
      createdBy: ctx.auth.userId,
    });
    if (!args.seedPrimary) return workspaceId;

    const listNames = ['Inbox', 'Bakeoff', 'Operations', 'Done'];
    for (let listIndex = 0; listIndex < listNames.length; listIndex += 1) {
      const listId = await ctx.db.insert('lists', {
        workspaceId,
        name: listNames[listIndex],
        position: listIndex,
      });
      for (let taskIndex = 0; taskIndex < 25; taskIndex += 1) {
        await ctx.db.insert('tasks', {
          workspaceId,
          listId,
          title: `Task ${listIndex + 1}.${String(taskIndex + 1).padStart(2, '0')}`,
          completed: listIndex === 3,
          assigneeId: taskIndex % 2 === 0 ? ctx.auth.userId : args.bobId,
          dueDate: `2026-08-${String((taskIndex % 28) + 1).padStart(2, '0')}`,
          position: taskIndex,
        });
      }
    }
    return workspaceId;
  },

  async addMember(ctx, args) {
    await ctx.permissions.workspaceMembers.requireRole(args.workspaceId, 'owner');
    await ctx.membership.workspaceMembers.insert({
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: 'member',
    });
    return null;
  },

  async leaveWorkspace(ctx, args) {
    await ctx.membership.workspaceMembers.removeSelf(args.workspaceId);
    return null;
  },

  async createTask(ctx, args) {
    await requireMember(ctx, args.workspaceId);
    const list = await ctx.db.get('lists', args.listId);
    if (!list || list.workspaceId !== args.workspaceId) {
      throw new Error('list does not belong to workspace');
    }
    return await ctx.db.insert('tasks', {
      workspaceId: args.workspaceId,
      listId: args.listId,
      title: String(args.title).trim(),
      completed: false,
      assigneeId: args.assigneeId,
      dueDate: args.dueDate,
      position: args.position,
    });
  },

  async editTask(ctx, args) {
    const task = await ctx.db.get('tasks', args.id);
    if (!task) return 0;
    await requireMember(ctx, task.workspaceId);
    const values = {};
    if (args.title !== undefined) values.title = String(args.title).trim();
    if (args.completed !== undefined) values.completed = args.completed;
    if (args.assigneeId !== undefined) values.assigneeId = args.assigneeId;
    if (args.dueDate !== undefined) values.dueDate = args.dueDate;
    if (Object.keys(values).length === 0) return 0;
    return (await ctx.db.patch('tasks', args.id, values)) ? 1 : 0;
  },

  async reorderTask(ctx, args) {
    const task = await ctx.db.get('tasks', args.id);
    if (!task) return 0;
    await requireMember(ctx, task.workspaceId);
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_list_position')
      .eq('listId', task.listId)
      .order('position', 'asc')
      .collect();
    const without = rows.filter((row) => row._id !== args.id);
    const targetIndex = Math.max(0, Math.min(args.targetIndex, without.length));
    without.splice(targetIndex, 0, task);
    let changed = 0;
    for (let position = 0; position < without.length; position += 1) {
      const row = without[position];
      if (row.position === position) continue;
      if (await ctx.db.patch('tasks', row._id, { position })) changed += 1;
    }
    return changed;
  },

  async deleteTask(ctx, args) {
    const task = await ctx.db.get('tasks', args.id);
    if (!task) return 0;
    await requireMember(ctx, task.workspaceId);
    return (await ctx.db.delete('tasks', args.id)) ? 1 : 0;
  },
};
