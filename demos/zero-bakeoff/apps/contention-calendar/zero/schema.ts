import { createBuilder, createSchema, number, Row, string, table } from '@rocicorp/zero';

const resource = table('calendar_resource').columns({ id: string(), title: string() }).primaryKey('id');
const reservation = table('calendar_reservation').columns({
  id: string(),
  idempotencyKey: string().from('idempotency_key'),
  resourceID: string().from('resource_id'),
  slotKey: string().from('slot_key'),
  ownerID: string().from('owner_id'),
  title: string(),
  createdAt: number().from('created_at'),
}).primaryKey('id');

export const schema = createSchema({
  tables: [resource, reservation], relationships: [],
  enableLegacyQueries: false, enableLegacyMutators: false,
});
export const zql = createBuilder(schema);
export type Schema = typeof schema;
export type Reservation = Row<typeof schema.tables.calendar_reservation>;
export type Context = { userID: string };
declare module '@rocicorp/zero' { interface DefaultTypes { schema: Schema; context: Context; } }
