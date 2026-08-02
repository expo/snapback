import {createBuilder, createSchema, number, relationships, string, table} from '@rocicorp/zero';

export const incident = table('incident').columns({
  id: string(), title: string(), severity: string(), createdBy: string().from('created_by'), nextSequence: number().from('next_sequence'),
}).primaryKey('id');
export const incidentMember = table('incidentMember').from('incident_member').columns({
  id: string(), incidentID: string().from('incident_id'), userID: string().from('user_id'), role: string(),
}).primaryKey('id');
export const message = table('message').columns({
  id: string(), incidentID: string().from('incident_id'), sequence: number(), authorID: string().from('author_id'), body: string(),
}).primaryKey('id');
export const task = table('task').columns({
  id: string(), incidentID: string().from('incident_id'), title: string(), done: number(),
}).primaryKey('id');
export const note = table('note').columns({
  id: string(), incidentID: string().from('incident_id'), authorID: string().from('author_id'), body: string(),
}).primaryKey('id');

const messageRelationships = relationships(message, ({one, many}) => ({
  incident: one({sourceField: ['incidentID'], destField: ['id'], destSchema: incident}),
  members: many({sourceField: ['incidentID'], destField: ['incidentID'], destSchema: incidentMember}),
}));
const incidentRelationships = relationships(incident, ({many}) => ({
  members: many({sourceField: ['id'], destField: ['incidentID'], destSchema: incidentMember}),
  messages: many({sourceField: ['id'], destField: ['incidentID'], destSchema: message}),
}));
export const schema = createSchema({tables: [incident, incidentMember, message, task, note],
  relationships: [messageRelationships, incidentRelationships]});
export const zql = createBuilder(schema);
