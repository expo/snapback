import { announcements, appMembers } from './schema.mjs';
import {
  asc,
  arg,
  defineJsMutation,
  defineLiveQuery,
  defineSearchQuery,
  eq,
  membershipResource,
  results,
  v,
} from '../../_kit/define.mjs';

export const listAnnouncements = defineLiveQuery({
  auth: 'authenticated',
  table: 'announcements',
  args: { appId: v.id('applications') },
  filter: [eq('appId', arg('appId'))],
  order: [asc('_createdAt')],
});

export const searchAnnouncements = defineSearchQuery({
  auth: 'authenticated',
  table: announcements,
  index: 'search_announcements',
  resourceArg: 'appId',
});

// Resource creation is the one specialized operation outside the common
// profile facade: bootstrap atomically creates the resource and its owner.
export const createApp = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'createApp',
  writes: ['applications', 'appMembers'],
  result: results.value(v.id('applications')),
});

export const postAnnouncement = defineJsMutation({
  auth: 'authenticated',
  args: { appId: v.id('applications'), message: v.string() },
  source: 'handlers.mjs',
  exportName: 'postAnnouncement',
  membership: [appMembers.hasRole(membershipResource.arg('appId'), 'member')],
  writes: ['announcements'],
  result: results.value(v.id('announcements')),
});
