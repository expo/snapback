import { createBuilder, createSchema, number, relationships, Row, string, table } from '@rocicorp/zero';

const column = table('kanban_column').columns({
  id: string(), title: string(), rank: number(),
}).primaryKey('id');

const card = table('kanban_card').columns({
  id: string(),
  title: string(),
  columnID: string().from('column_id'),
  rank: number(),
  assigneeID: string().from('assignee_id'),
  archived: number(),
  locked: number(),
  revision: number(),
}).primaryKey('id');

const cardRelationships = relationships(card, ({ one }) => ({
  column: one({ sourceField: ['columnID'], destField: ['id'], destSchema: column }),
}));

export const schema = createSchema({
  tables: [column, card], relationships: [cardRelationships],
  enableLegacyQueries: false, enableLegacyMutators: false,
});
export const zql = createBuilder(schema);
export type Schema = typeof schema;
export type Card = Row<typeof schema.tables.kanban_card>;
export type Context = { userID: string };

declare module '@rocicorp/zero' {
  interface DefaultTypes { schema: Schema; context: Context; }
}
