import {createBuilder, createSchema, number, string, table} from '@rocicorp/zero';

export const record = table('fieldRecord').from('field_record').columns({
  id: string(), assignmentID: string().from('assignment_id'), assignedTo: string().from('assigned_to'),
  title: string(), body: string(), checklistDone: number().from('checklist_done'), revision: number(), conflict: string().optional(),
}).primaryKey('id');
export const schema = createSchema({tables: [record], relationships: []});
export const zql = createBuilder(schema);
