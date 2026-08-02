import {createBuilder, createSchema, number, relationships, string, table} from '@rocicorp/zero';

const fleet = table('fo_fleet').columns({id: string(), name: string()}).primaryKey('id');
const membership = table('fo_membership').columns({id: string(), fleetID: string(), userID: string()}).primaryKey('id');
const owner = table('fo_owner').columns({id: string(), name: string()}).primaryKey('id');
const device = table('fo_device').columns({id: string(), fleetID: string(), ownerID: string(), name: string(), region: string(), status: string(), updatedAt: number()}).primaryKey('id');
const event = table('fo_event').columns({
  id: string(), deviceID: string(), fleetID: string(), ownerID: string(), deviceStatus: string(), region: string(),
  severity: string(), message: string(), pageKey: string(), occurredAt: number(),
}).primaryKey('id');

const fleetRelationships = relationships(fleet, ({many}) => ({
  members: many({sourceField: ['id'], destField: ['fleetID'], destSchema: membership}),
}));
const deviceRelationships = relationships(device, ({one}) => ({
  owner: one({sourceField: ['ownerID'], destField: ['id'], destSchema: owner}),
  fleet: one({sourceField: ['fleetID'], destField: ['id'], destSchema: fleet}),
}));
const eventRelationships = relationships(event, ({one}) => ({
  fleet: one({sourceField: ['fleetID'], destField: ['id'], destSchema: fleet}),
  device: one({sourceField: ['deviceID'], destField: ['id'], destSchema: device}),
  owner: one({sourceField: ['ownerID'], destField: ['id'], destSchema: owner}),
}));

export const schema = createSchema({
  tables: [fleet, membership, owner, device, event],
  relationships: [fleetRelationships, deviceRelationships, eventRelationships],
  enableLegacyQueries: false,
  enableLegacyMutators: false,
});
export const zql = createBuilder(schema);
export type Schema = typeof schema;
export type AuthContext = {userID: string};

declare module '@rocicorp/zero' {
  interface DefaultTypes { schema: Schema; context: AuthContext; }
}

