import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

// A1 offline field notebook (LLP 0137 contract a1-field-notebook.v1).
// Sessions mode: the server derives identity; Mallory can never assert
// Alice's userId. The workspace is membership-gated (host/member with a
// pending 'invited' seat); the sites table is deliberately public,
// authority-independent reference data — the rqsEligible subset the JS arm's
// shipped offline claim (sync.offline-js-arm) covers.
export const workspaceMembers = defineTable({
  workspaceId: v.id('workspaces'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'workspaceMembers',
  principal: 'userId',
  resource: 'workspaceId',
  role: 'role',
  roles: ['host', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['host'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'member'] },
  ],
});

export default defineSchema({
  // Public reference data (no auth scope): site directory the field team
  // consults. This is the authority-independent live-query subset that the
  // JS arm cold-retains by contract.
  sites: defineTable({
    name: v.string(),
    region: v.string(),
    hazardClass: v.string(),
  })
    .index('by_name', ['name'], { unique: true })
    .sync(),

  workspaces: defineTable({
    name: v.string(),
  })
    .index('by_name', ['name'], { unique: true })
    .sync(),

  // Structured field records: assignment, due date, deterministic ordering
  // (position with _id tiebreak), revision counter for conflict visibility,
  // clientKey for idempotent offline replay, optional typed attachment.
  records: defineTable({
    workspaceId: v.id('workspaces'),
    title: v.string(),
    notes: v.string(),
    assigneeId: v.principal(),
    assigneeName: v.string(),
    dueAt: v.integer(),
    position: v.integer(),
    state: v.string(), // 'open' | 'done'
    revision: v.integer(),
    clientKey: v.string(),
    // Finding 0137-a1: any v.assetRef field makes its table unqueryable on
    // the packaged 0.1.7 closure (result contracts have no AssetRef mapping,
    // SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID for declarative and JS
    // queries alike). Workaround: the typed reference lives in the
    // recordAttachments side table below, which no query ever returns; this
    // string is a display/delivery hint only and confers no read authority.
    attachmentAssetId: v.optional(v.string()),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_workspace_position', ['workspaceId', 'position'])
    .index('by_workspace_client_key', ['workspaceId', 'clientKey'], { unique: true })
    .sync(),

  // Typed asset references live here so the records table stays queryable
  // (finding 0137-a1 above). assetSharing extends read authority to
  // workspace members via the membership declaration; no query returns
  // this table.
  recordAttachments: defineTable({
    recordId: v.id('records'),
    workspaceId: v.id('workspaces'),
    // Restricted to the intent: the ctx.assets.attach({ upload }) admission
    // binds to a restricted field; since no query ever returns this table,
    // the 0.1.7 result-contract AssetRef gap does not bite here.
    assetRef: v.assetRef({ upload: 'recordAttachment' }),
  })
    .index('by_record', ['recordId'], { unique: true })
    .assetSharing({ kind: 'membership', membership: 'workspaceMembers' })
    .sync(),

  workspaceMembers,
}, {
  auth: { mode: 'sessions' },
});
