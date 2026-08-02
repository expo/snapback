// @ref LLP 0056#declaring-a-membership-table — the incident roster is private
// authorization backing; product rows are gated by the roster.
import {defineSchema, defineTable, v} from '../../../../_kit/define.mjs';

export const incidentMembers = defineTable({
  incidentId: v.id('incidents'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'incidentMembers',
  principal: 'userId',
  resource: 'incidentId',
  role: 'role',
  roles: ['commander', 'responder', 'observer'],
  bootstrapRole: 'commander',
  lastHolder: {protect: 'commander'},
  provenance: 'full',
  transitions: [
    {op: 'insert', by: ['commander'], target: 'other', to: ['responder', 'observer']},
    {op: 'remove', by: ['self'], target: 'self', from: ['responder', 'observer']},
  ],
});

export default defineSchema({
  incidents: defineTable({
    title: v.string(),
    severity: v.string(),
    createdBy: v.principal(),
    nextSequence: v.integer(),
  }).sync(),
  incidentMembers,
  messages: defineTable({
    incidentId: v.id('incidents'),
    sequence: v.integer(),
    authorId: v.principal(),
    body: v.string(),
  }).index('by_incident_sequence', ['incidentId', 'sequence'], {unique: true}).sync(),
  tasks: defineTable({
    incidentId: v.id('incidents'),
    title: v.string(),
    done: v.boolean(),
  }).index('by_incident', ['incidentId']).sync(),
  notes: defineTable({
    incidentId: v.id('incidents'),
    authorId: v.principal(),
    body: v.string(),
  }).index('by_incident', ['incidentId']).sync(),
}, {auth: {mode: 'sessions'}});
