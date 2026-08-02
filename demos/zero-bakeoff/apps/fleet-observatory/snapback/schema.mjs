import {defineSchema, defineTable, v} from '../../../../_kit/define.mjs';

const synced = (fields) => defineTable(fields).sync();

export default defineSchema({
  fleets: synced({fleetKey: v.string(), name: v.string()}).index('by_fleet_key', ['fleetKey'], {unique: true}),
  fleetMemberships: synced({membershipKey: v.string(), fleetKey: v.string(), userKey: v.string()})
    .index('by_membership_key', ['membershipKey'], {unique: true})
    .index('by_user_fleet', ['userKey', 'fleetKey'], {unique: true})
    .index('by_fleet_user', ['fleetKey', 'userKey'], {unique: true}),
  owners: synced({ownerKey: v.string(), name: v.string()}).index('by_owner_key', ['ownerKey'], {unique: true}),
  devices: synced({deviceKey: v.string(), fleetKey: v.string(), ownerKey: v.string(), name: v.string(), region: v.string(), status: v.string(), updatedAt: v.integer()})
    .index('by_device_key', ['deviceKey'], {unique: true})
    .index('by_fleet_region_status', ['fleetKey', 'region', 'status', 'deviceKey'], {unique: true}),
  events: synced({eventKey: v.string(), deviceKey: v.string(), fleetKey: v.string(), ownerKey: v.string(), deviceStatus: v.string(), region: v.string(), severity: v.string(), message: v.string(), pageKey: v.string(), occurredAt: v.integer()})
    .index('by_event_key', ['eventKey'], {unique: true})
    .index('by_fleet_page', ['fleetKey', 'pageKey'], {unique: true})
    .index('by_fleet_severity_page', ['fleetKey', 'severity', 'pageKey'], {unique: true})
    .index('by_fleet_region_page', ['fleetKey', 'region', 'pageKey'], {unique: true})
    .index('by_fleet_status_page', ['fleetKey', 'deviceStatus', 'pageKey'], {unique: true})
    .index('by_fleet_severity_region_page', ['fleetKey', 'severity', 'region', 'pageKey'], {unique: true})
    .index('by_fleet_severity_status_page', ['fleetKey', 'severity', 'deviceStatus', 'pageKey'], {unique: true})
    .index('by_fleet_region_status_page', ['fleetKey', 'region', 'deviceStatus', 'pageKey'], {unique: true})
    .index('by_fleet_severity_region_status_page', ['fleetKey', 'severity', 'region', 'deviceStatus', 'pageKey'], {unique: true}),
});
