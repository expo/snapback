import { schema, table, t } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';

const config = table(
  { name: 'config' },
  {
    key: t.string().primaryKey(),
    owner: t.identity(),
  }
);

const workspace = table(
  { name: 'workspace' },
  {
    id: t.string().primaryKey(),
    name: t.string(),
  }
);

const membership = table(
  { name: 'membership' },
  {
    id: t.string().primaryKey(),
    workspaceId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    label: t.string(),
    role: t.string(),
    active: t.bool(),
  }
);

const todoList = table(
  { name: 'todo_list' },
  {
    id: t.string().primaryKey(),
    workspaceId: t.string().index('btree'),
    title: t.string(),
    position: t.u32(),
    taskIds: t.array(t.string()),
  }
);

const task = table(
  { name: 'task' },
  {
    id: t.string().primaryKey(),
    workspaceId: t.string().index('btree'),
    listId: t.string().index('btree'),
    title: t.string(),
    completed: t.bool(),
    assignee: t.string(),
    dueDate: t.string(),
    position: t.u32(),
    revision: t.u64(),
  }
);

const spacetimedb = schema({ config, workspace, membership, todoList, task });
export default spacetimedb;

const PRIMARY_WORKSPACE = 'workspace-primary';
const SECONDARY_WORKSPACE = 'workspace-secondary';

function identityKey(identity: Identity) {
  return identity.toHexString();
}

function requireOwner(ctx: Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0]) {
  const owner = ctx.db.config.key.find('owner');
  if (!owner || identityKey(owner.owner) !== identityKey(ctx.sender)) {
    throw new Error('TODO_NOT_OWNER');
  }
}

function membershipFor(
  ctx: Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0],
  identity: Identity,
  workspaceId: string
) {
  const expected = identityKey(identity);
  return Array.from(ctx.db.membership.identity.filter(identity)).find(
    row => row.workspaceId === workspaceId && row.active && identityKey(row.identity) === expected
  );
}

function requireMember(
  ctx: Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0],
  workspaceId: string
) {
  if (!membershipFor(ctx, ctx.sender, workspaceId)) {
    throw new Error('TODO_NOT_MEMBER');
  }
}

export const init = spacetimedb.init(ctx => {
  ctx.db.config.insert({ key: 'owner', owner: ctx.sender });
  ctx.db.workspace.insert({ id: PRIMARY_WORKSPACE, name: 'Product launch' });
  ctx.db.workspace.insert({ id: SECONDARY_WORKSPACE, name: 'Private control' });

  const listNames = ['Inbox', 'Next', 'Doing', 'Done'];
  for (let listIndex = 0; listIndex < listNames.length; listIndex += 1) {
    const listId = `list-${listIndex + 1}`;
    const taskIds = Array.from({ length: 25 }, (_, taskIndex) => {
      const ordinal = listIndex * 25 + taskIndex + 1;
      return `seed-task-${String(ordinal).padStart(3, '0')}`;
    });
    ctx.db.todoList.insert({
      id: listId,
      workspaceId: PRIMARY_WORKSPACE,
      title: listNames[listIndex],
      position: listIndex,
      taskIds,
    });
    for (let taskIndex = 0; taskIndex < 25; taskIndex += 1) {
      const ordinal = listIndex * 25 + taskIndex + 1;
      ctx.db.task.insert({
        id: `seed-task-${String(ordinal).padStart(3, '0')}`,
        workspaceId: PRIMARY_WORKSPACE,
        listId,
        title: `Seed task ${String(ordinal).padStart(3, '0')}`,
        completed: false,
        assignee: ordinal % 2 === 0 ? 'alice' : 'bob',
        dueDate: `2026-08-${String((ordinal % 28) + 1).padStart(2, '0')}`,
        position: taskIndex,
        revision: 1n,
      });
    }
  }
});

export const my_memberships = spacetimedb.view(
  { name: 'my_memberships', public: true },
  t.array(membership.rowType),
  ctx => Array.from(ctx.db.membership.identity.filter(ctx.sender)).filter(row => row.active)
);

export const my_workspaces = spacetimedb.view(
  { name: 'my_workspaces', public: true },
  t.array(workspace.rowType),
  ctx => {
    const ids = new Set(
      Array.from(ctx.db.membership.identity.filter(ctx.sender))
        .filter(row => row.active)
        .map(row => row.workspaceId)
    );
    return Array.from(ctx.db.workspace.iter()).filter(row => ids.has(row.id));
  }
);

export const my_lists = spacetimedb.view(
  { name: 'my_lists', public: true },
  t.array(todoList.rowType),
  ctx => {
    const ids = new Set(
      Array.from(ctx.db.membership.identity.filter(ctx.sender))
        .filter(row => row.active)
        .map(row => row.workspaceId)
    );
    return Array.from(ctx.db.todoList.iter()).filter(row => ids.has(row.workspaceId));
  }
);

export const my_tasks = spacetimedb.view(
  { name: 'my_tasks', public: true },
  t.array(task.rowType),
  ctx => {
    const ids = new Set(
      Array.from(ctx.db.membership.identity.filter(ctx.sender))
        .filter(row => row.active)
        .map(row => row.workspaceId)
    );
    const rows: Array<typeof task.rowType.type> = [];
    for (const list of ctx.db.todoList.iter()) {
      if (!ids.has(list.workspaceId)) continue;
      list.taskIds.forEach((taskId, position) => {
        const row = ctx.db.task.id.find(taskId);
        if (row) rows.push({ ...row, position });
      });
    }
    return rows;
  }
);

export const grant_member = spacetimedb.reducer(
  { identity: t.identity(), label: t.string(), role: t.string() },
  (ctx, { identity, label, role }) => {
    requireOwner(ctx);
    const id = `${PRIMARY_WORKSPACE}:${identityKey(identity)}`;
    const existing = ctx.db.membership.id.find(id);
    const row = { id, workspaceId: PRIMARY_WORKSPACE, identity, label, role, active: true };
    if (existing) ctx.db.membership.id.update(row);
    else ctx.db.membership.insert(row);
  }
);

export const revoke_member = spacetimedb.reducer(
  { identity: t.identity() },
  (ctx, { identity }) => {
    requireOwner(ctx);
    const id = `${PRIMARY_WORKSPACE}:${identityKey(identity)}`;
    const existing = ctx.db.membership.id.find(id);
    if (existing) ctx.db.membership.id.update({ ...existing, active: false });
  }
);

export const create_task = spacetimedb.reducer(
  {
    id: t.string(),
    listId: t.string(),
    title: t.string(),
    assignee: t.string(),
    dueDate: t.string(),
    position: t.u32(),
  },
  (ctx, input) => {
    requireMember(ctx, PRIMARY_WORKSPACE);
    if (ctx.db.task.id.find(input.id)) throw new Error('TODO_DUPLICATE_TASK');
    const list = ctx.db.todoList.id.find(input.listId);
    if (!list || list.workspaceId !== PRIMARY_WORKSPACE) throw new Error('TODO_LIST_NOT_FOUND');
    ctx.db.task.insert({
      ...input,
      workspaceId: PRIMARY_WORKSPACE,
      completed: false,
      position: list.taskIds.length,
      revision: 1n,
    });
    ctx.db.todoList.id.update({ ...list, taskIds: [...list.taskIds, input.id] });
  }
);

export const update_task = spacetimedb.reducer(
  {
    id: t.string(),
    title: t.string(),
    completed: t.bool(),
    assignee: t.string(),
    dueDate: t.string(),
    listId: t.string(),
    position: t.u32(),
  },
  (ctx, input) => {
    const existing = ctx.db.task.id.find(input.id);
    if (!existing) throw new Error('TODO_TASK_NOT_FOUND');
    requireMember(ctx, existing.workspaceId);
    ctx.db.task.id.update({
      ...existing,
      ...input,
      position: existing.position,
      revision: existing.revision + 1n,
    });
  }
);

export const move_task = spacetimedb.reducer(
  { id: t.string(), direction: t.string() },
  (ctx, { id, direction }) => {
    const existing = ctx.db.task.id.find(id);
    if (!existing) throw new Error('TODO_TASK_NOT_FOUND');
    requireMember(ctx, existing.workspaceId);
    if (direction !== 'up' && direction !== 'down') throw new Error('TODO_BAD_DIRECTION');

    const list = ctx.db.todoList.id.find(existing.listId);
    if (!list) throw new Error('TODO_LIST_NOT_FOUND');
    const currentPosition = list.taskIds.indexOf(id);
    if (currentPosition < 0) throw new Error('TODO_ORDER_INVARIANT');
    const maximum = list.taskIds.length - 1;
    const nextPosition = direction === 'up'
      ? Math.max(0, currentPosition - 1)
      : Math.min(maximum, currentPosition + 1);
    if (nextPosition === currentPosition) return;

    const taskIds = [...list.taskIds];
    [taskIds[currentPosition], taskIds[nextPosition]] = [taskIds[nextPosition], taskIds[currentPosition]];
    ctx.db.todoList.id.update({ ...list, taskIds });
  }
);

export const delete_task = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    const existing = ctx.db.task.id.find(id);
    if (!existing) return;
    requireMember(ctx, existing.workspaceId);
    const list = ctx.db.todoList.id.find(existing.listId);
    if (!list) throw new Error('TODO_LIST_NOT_FOUND');
    ctx.db.todoList.id.update({ ...list, taskIds: list.taskIds.filter(taskId => taskId !== id) });
    ctx.db.task.id.delete(id);
  }
);
