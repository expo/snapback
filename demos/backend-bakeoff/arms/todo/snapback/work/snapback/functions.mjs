// LLP 0102 Todo calibration functions. Membership is checked in every
// protected handler so outsiders receive a terminal denial rather than a
// successfully subscribed empty result.

import {
  defineJsLiveQuery,
  defineJsMutation,
  v,
} from '../../../../../../_kit/define.mjs';

const listShape = v.object({
  workspaceId: v.string(),
  name: v.string(),
  position: v.integer(),
});

const taskShape = v.object({
  workspaceId: v.string(),
  listId: v.string(),
  title: v.string(),
  completed: v.boolean(),
  assigneeId: v.string(),
  dueDate: v.string(),
  position: v.integer(),
});

export const listLists = defineJsLiveQuery({
  auth: 'authenticated',
  args: { workspaceId: v.id('workspaces') },
  source: 'handlers.mjs',
  exportName: 'listLists',
  reads: ['workspaceMembers', 'lists'],
  result: listShape,
});

export const listTasks = defineJsLiveQuery({
  auth: 'authenticated',
  args: { workspaceId: v.id('workspaces') },
  source: 'handlers.mjs',
  exportName: 'listTasks',
  reads: ['workspaceMembers', 'tasks'],
  result: taskShape,
});

// The resource bootstrap atomically creates the workspace and owner seat, then
// writes the bounded calibration fixture. It cannot grant authority to anyone
// except the effective caller, so it is not authority-creating.
export const bootstrapWorkspace = defineJsMutation({
  auth: 'authenticated',
  args: {
    name: v.string(),
    seedPrimary: v.boolean(),
    bobId: v.principal(),
  },
  source: 'handlers.mjs',
  exportName: 'bootstrapWorkspace',
  writes: ['workspaces', 'workspaceMembers', 'lists', 'tasks'],
});

export const addMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    workspaceId: v.id('workspaces'),
    userId: v.principal(),
  },
  source: 'handlers.mjs',
  exportName: 'addMember',
  reads: ['workspaceMembers'],
  writes: ['workspaceMembers'],
});

export const leaveWorkspace = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { workspaceId: v.id('workspaces') },
  source: 'handlers.mjs',
  exportName: 'leaveWorkspace',
  writes: ['workspaceMembers'],
});

export const createTask = defineJsMutation({
  auth: 'authenticated',
  args: {
    workspaceId: v.id('workspaces'),
    listId: v.id('lists'),
    title: v.string(),
    assigneeId: v.principal(),
    dueDate: v.string(),
    position: v.integer(),
  },
  source: 'handlers.mjs',
  exportName: 'createTask',
  reads: ['workspaceMembers', 'lists'],
  writes: ['tasks'],
});

export const editTask = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.id('tasks'),
    title: v.optional(v.string()),
    completed: v.optional(v.boolean()),
    assigneeId: v.optional(v.principal()),
    dueDate: v.optional(v.string()),
  },
  source: 'handlers.mjs',
  exportName: 'editTask',
  reads: ['workspaceMembers', 'tasks'],
  writes: ['tasks'],
});

export const reorderTask = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.id('tasks'),
    targetIndex: v.integer(),
  },
  source: 'handlers.mjs',
  exportName: 'reorderTask',
  reads: ['workspaceMembers', 'tasks'],
  writes: ['tasks'],
});

export const deleteTask = defineJsMutation({
  auth: 'authenticated',
  args: { id: v.id('tasks') },
  source: 'handlers.mjs',
  exportName: 'deleteTask',
  reads: ['workspaceMembers', 'tasks'],
  writes: ['tasks'],
});
