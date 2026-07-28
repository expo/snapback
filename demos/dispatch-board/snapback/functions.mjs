import {
  arg,
  asc,
  authUserId,
  defineJsMutation,
  defineLiveQuery,
  eq,
  v,
} from '../../_kit/define.mjs';

export const listIncidents = defineLiveQuery({
  auth: 'authenticated',
  table: 'incidents',
  args: {},
  filter: [eq('ownerId', authUserId())],
  order: [asc('reportedAt')],
  index: 'by_owner_time',
});

export const listAuditEntries = defineLiveQuery({
  auth: 'authenticated',
  table: 'auditEntries',
  args: { incidentId: v.id('incidents') },
  filter: [
    eq('ownerId', authUserId()),
    eq('incidentId', arg('incidentId')),
  ],
  index: 'by_owner_incident',
});

export const reportIncident = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string() },
  source: 'handlers.mjs',
  exportName: 'reportIncident',
  writes: ['incidents', 'auditEntries'],
});
