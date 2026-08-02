// @ref LLP 0053#the-one-constraint-everything-follows-from — protected
// messages declare their membership dependency so revocation invalidates live results.
import {incidentMembers} from './schema.mjs';
import {
  arg,
  asc,
  defineJsMutation,
  defineLiveQuery,
  eq,
  membershipResource,
  v,
} from '../../../../_kit/define.mjs';

export const incidentMessages = defineLiveQuery({
  auth: 'authenticated',
  table: 'messages',
  args: {incidentId: v.id('incidents')},
  membership: [incidentMembers.memberOf(membershipResource.arg('incidentId'))],
  filter: [eq('incidentId', arg('incidentId'))],
  order: [asc('sequence')],
  index: 'by_incident_sequence',
});

export const createIncident = defineJsMutation({
  auth: 'authenticated', authorityCreating: true,
  args: {title: v.string(), severity: v.string()},
  source: 'handlers.mjs', exportName: 'createIncident',
  writes: ['incidents', 'incidentMembers', 'messages'],
});
export const addParticipant = defineJsMutation({
  auth: 'authenticated', authorityCreating: true,
  args: {incidentId: v.id('incidents'), userId: v.principal(), role: v.string()},
  source: 'handlers.mjs', exportName: 'addParticipant',
  reads: ['incidentMembers'], writes: ['incidentMembers'],
});
export const removeParticipant = defineJsMutation({
  auth: 'authenticated', authorityCreating: true,
  args: {incidentId: v.id('incidents'), userId: v.principal()},
  source: 'handlers.mjs', exportName: 'removeParticipant',
  reads: ['incidentMembers'], writes: ['incidentMembers'],
});
export const postMessage = defineJsMutation({
  auth: 'authenticated',
  args: {incidentId: v.id('incidents'), body: v.string()},
  source: 'handlers.mjs', exportName: 'postMessage',
  reads: ['incidents', 'incidentMembers'], writes: ['incidents', 'messages'],
});
