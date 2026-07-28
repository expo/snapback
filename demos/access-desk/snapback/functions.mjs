import { workspaceMembers } from './schema.mjs';
import {
  arg,
  asc,
  defineJsMutation,
  defineLiveQuery,
  eq,
  membershipResource,
  v,
} from '../../_kit/define.mjs';

export const workspaceNotes = defineLiveQuery({
  auth: 'authenticated',
  table: 'notes',
  args: { workspaceId: v.id('workspaces') },
  membership: [workspaceMembers.memberOf(membershipResource.arg('workspaceId'))],
  filter: [eq('workspaceId', arg('workspaceId'))],
  order: [asc('_createdAt')],
  index: 'by_workspace',
});

export const createWorkspace = defineJsMutation({
  auth: 'authenticated',
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'createWorkspace',
  writes: ['workspaces', 'workspaceMembers'],
});

export const addMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { workspaceId: v.id('workspaces'), userId: v.principal() },
  source: 'handlers.mjs',
  exportName: 'addMember',
  writes: ['workspaceMembers'],
});

export const addNote = defineJsMutation({
  auth: 'authenticated',
  args: { workspaceId: v.id('workspaces'), body: v.string() },
  source: 'handlers.mjs',
  exportName: 'addNote',
  writes: ['notes'],
});
