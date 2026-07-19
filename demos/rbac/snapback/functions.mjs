import { appMembers } from './schema.mjs';
import {
  asc,
  defineJsMutation,
  defineLiveQuery,
  v,
} from '../../_kit/define.mjs';

// memberOf() is declaration-bound. For scope:'app' the builder supplies the
// host-owned singleton resource; there is no caller-provided resource string.
export const listAnnouncements = defineLiveQuery({
  auth: 'authenticated',
  table: 'announcements',
  args: {},
  membership: [appMembers.memberOf()],
  order: [asc('_createdAt')],
});

export const joinApp = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'joinApp',
  writes: ['appMembers'],
});

export const inviteApp = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { userId: v.principal() },
  source: 'handlers.mjs',
  exportName: 'inviteApp',
  writes: ['appMembers'],
});

export const acceptInvite = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'acceptInvite',
  writes: ['appMembers'],
});

export const leaveApp = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'leaveApp',
  writes: ['appMembers'],
});

export const postAnnouncement = defineJsMutation({
  auth: 'authenticated',
  args: { message: v.string() },
  source: 'handlers.mjs',
  exportName: 'postAnnouncement',
  reads: ['appMembers'],
  writes: ['announcements'],
});

// Deliberately hostile acceptance fixture. The central write seam, not handler
// convention, must refuse this raw membership write.
export const rawJoin = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'rawJoin',
  writes: ['appMembers'],
});
