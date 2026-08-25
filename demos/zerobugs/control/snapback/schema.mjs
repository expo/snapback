import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// The ten source tables stay visible and source-shaped. Snapback's system `_id`
// is the physical, typed reference target; the source `id` columns remain part
// of the public row so the pinned application's URL and mutation contracts do
// not silently change.
// @ref LLP 0183#d1--comparator-manifest-and-current-surface-control — the
// current-surface control keeps source demand exact while making every
// Snapback-specific representation choice explicit and countable.
// LLP 0231's explicit table-policy requirement postdates this frozen control.
// Public-read preserves instrument fidelity: the source-faithful handler
// boundaries stay unchanged. Honest-narrowest declarations require an author
// decision tracked in issues/20260824-zerobugs-control-honest-narrowest-visibility.md.

export const user = defineTable({
  id: v.string(),
  login: v.string(),
  name: v.optional(v.string()),
  avatar: v.string(),
  // Stored as the source varchar representation. The fixture compiler and
  // every authoritative writer close this to `crew | user`; the shipped table
  // field surface does not admit literal unions.
  role: v.string(),
  githubID: v.integer(),
  email: v.optional(v.string()),
})
  .visibility({ kind: 'public-read' })
  .index('by_source_id', ['id'], { unique: true })
  .index('by_github_id', ['githubID'], { unique: true })
  .index('by_login', ['login'], { unique: true })
  .sync();

export const project = defineTable({
  id: v.string(),
  name: v.string(),
  lowerCaseName: v.string(),
  issueCountEstimate: v.optional(v.integer()),
  supportsSearch: v.boolean(),
  markURL: v.optional(v.string()),
  logoURL: v.optional(v.string()),
})
  .visibility({ kind: 'public-read' })
  .index('by_source_id', ['id'], { unique: true })
  .index('by_lower_case_name', ['lowerCaseName'], { unique: true })
  .sync();

export const issue = defineTable({
  id: v.string(),
  shortID: v.optional(v.integer()),
  title: v.string(),
  open: v.boolean(),
  modified: v.number(),
  created: v.number(),
  projectID: v.id('project'),
  creatorID: v.id('user'),
  assigneeID: v.optional(v.id('user')),
  description: v.string(),
  // Stored as the source varchar representation, with the source enum checked
  // by fixture ingestion and every authoritative write.
  visibility: v.string(),
})
  .visibility({ kind: 'public-read' })
  .index('by_source_id', ['id'], { unique: true })
  .index('by_source_id_project', ['id', 'projectID'], { unique: true })
  .index('by_short_id', ['shortID'])
  .index('by_created', ['created'])
  .index('by_project_modified', ['projectID', 'modified', 'id'])
  .index('by_project_open_modified', ['projectID', 'open', 'modified', 'id'])
  .index('by_project_assignee_modified', ['projectID', 'assigneeID', 'modified', 'id'])
  .index('by_project_open_assignee_modified', ['projectID', 'open', 'assigneeID', 'modified', 'id'])
  .index('by_project_creator_modified', ['projectID', 'creatorID', 'modified', 'id'])
  .index('by_project_open_creator_modified', ['projectID', 'open', 'creatorID', 'modified', 'id'])
  .index('by_creator_source_id', ['creatorID', 'id'])
  .index('by_assignee_source_id', ['assigneeID', 'id'])
  .sync();

export const viewState = defineTable({
  issueID: v.id('issue'),
  userID: v.id('user'),
  viewed: v.number(),
})
  .visibility({ kind: 'public-read' })
  .index('by_user_issue', ['userID', 'issueID'], { unique: true })
  .index('by_issue_user', ['issueID', 'userID'], { unique: true })
  .sync();

export const comment = defineTable({
  id: v.string(),
  issueID: v.id('issue'),
  created: v.number(),
  body: v.string(),
  creatorID: v.id('user'),
})
  .visibility({ kind: 'public-read' })
  .index('by_source_id', ['id'], { unique: true })
  .index('by_issue', ['issueID'])
  .index('by_issue_created', ['issueID', 'created', 'id'])
  .sync();

export const label = defineTable({
  id: v.string(),
  name: v.string(),
  projectID: v.id('project'),
})
  .visibility({ kind: 'public-read' })
  .index('by_source_id', ['id'], { unique: true })
  .index('by_source_id_project', ['id', 'projectID'], { unique: true })
  .index('by_project_name', ['projectID', 'name'], { unique: true })
  .sync();

export const issueLabel = defineTable({
  labelID: v.id('label'),
  issueID: v.id('issue'),
  projectID: v.id('project'),
})
  .visibility({ kind: 'public-read' })
  .index('by_label_issue', ['labelID', 'issueID'], { unique: true })
  .index('by_issue', ['issueID'])
  .index('by_issue_label', ['issueID', 'labelID'], { unique: true })
  .sync();

export const emoji = defineTable({
  id: v.string(),
  value: v.string(),
  annotation: v.string(),
  subjectID: v.string(),
  creatorID: v.id('user'),
  created: v.number(),
})
  .visibility({ kind: 'public-read' })
  .index('by_source_id', ['id'], { unique: true })
  .index('by_created', ['created'])
  .index('by_subject', ['subjectID'])
  .index('by_value_subject_creator', ['value', 'subjectID', 'creatorID'], { unique: true })
  .sync();

export const userPref = defineTable({
  key: v.string(),
  userID: v.id('user'),
  value: v.string(),
})
  .visibility({ kind: 'public-read' })
  .index('by_key_user', ['key', 'userID'], { unique: true })
  .index('by_user_key', ['userID', 'key'], { unique: true })
  .sync();

export const issueNotifications = defineTable({
  userID: v.id('user'),
  issueID: v.id('issue'),
  subscribed: v.boolean(),
  created: v.number(),
})
  .visibility({ kind: 'public-read' })
  .index('by_user_issue', ['userID', 'issueID'], { unique: true })
  .index('by_issue_user', ['issueID', 'userID'], { unique: true })
  .sync();

// W-IDENTITY: one server-derived Snapback principal is bound to one frozen
// source user row. `sourceUserID` is retained for OAuth lookup/audit, while
// `userID` is the typed physical reference used by private source rows. The
// fixture leaves this table empty; Lane 2 writes bindings after minting real
// principals, as required by the sessions seed contract.
export const identityBinding = defineTable({
  principal: v.principal(),
  userID: v.id('user'),
  sourceUserID: v.string(),
})
  .visibility({ kind: 'public-read' })
  .index('by_principal', ['principal'], { unique: true })
  .index('by_user', ['userID'], { unique: true })
  .index('by_source_user_id', ['sourceUserID'], { unique: true });

// This membership declaration exists only as the LLP 0200 A/B harness's
// authority-transition probe surface. Its writes are permission-backing and
// therefore advance the authorization epoch, but no application query or
// mutation consults it for access control (in particular, issueListV2 does
// not read it).
// @ref LLP 0200#24-the-authorization-lane-splits-in-two--by-declared-classification
// — probe writes exercise fence application and restoration without changing
// any observer's effective access.
export const authorityProbeMembers = defineTable({
  userId: v.principal(),
  role: v.string(),
})
  .visibility({ kind: 'public-read' })
  .membership({
  principal: 'userId',
  role: 'role',
  roles: ['member'],
  scope: 'app',
  provenance: 'full',
  transitions: [
    {op: 'insert', by: ['none'], target: 'self', to: ['member']},
    {op: 'remove', by: ['self'], target: 'self', from: ['member']},
  ],
});

// Membership rows are intentionally private to application handlers. This
// companion ledger is the minimal app-visible fact needed to make probe
// retries idempotent without attempting a forbidden raw membership read. It
// is inserted/deleted atomically with the membership row and is not itself
// permission-backing.
export const authorityProbeState = defineTable({
  userId: v.principal(),
})
  .visibility({ kind: 'public-read' })
  .index('by_user_id', ['userId'], {unique: true});

// W-READMODEL: one row per (project,user) that participates as an issue
// creator, issue assignee, or non-rocibot crew picker candidate. The booleans
// record every applicable membership reason so each picker branch stays
// bounded without fabricating a source membership table.
export const projectUserRead = defineTable({
  projectID: v.id('project'),
  userID: v.id('user'),
  isCreator: v.boolean(),
  isAssignee: v.boolean(),
  isCrew: v.boolean(),
})
  .visibility({ kind: 'public-read' })
  .index('by_project_user', ['projectID', 'userID'], { unique: true })
  .index('by_project_creator', ['projectID', 'isCreator', 'userID'])
  .index('by_project_assignee', ['projectID', 'isAssignee', 'userID'])
  .index('by_project_crew', ['projectID', 'isCrew', 'userID'])
  .index('by_user_project', ['userID', 'projectID'], { unique: true })
  .sync();

// W-READMODEL: one row per issue carrying only list membership, visibility,
// filter, and stable `(sort field, source id)` cursor facts. Rich issue fields
// remain authoritative in `issue`; this row never claims graph completeness.
export const issueListRead = defineTable({
  issueID: v.id('issue'),
  sourceIssueID: v.string(),
  projectID: v.id('project'),
  creatorID: v.id('user'),
  assigneeID: v.optional(v.id('user')),
  open: v.boolean(),
  visibility: v.string(),
  modified: v.number(),
  created: v.number(),
})
  .visibility({ kind: 'public-read' })
  .index('by_issue', ['issueID'], { unique: true })
  .index('by_source_issue_id', ['sourceIssueID'], { unique: true })
  .index('by_project_modified', ['projectID', 'modified', 'sourceIssueID'])
  .index('by_project_created', ['projectID', 'created', 'sourceIssueID'])
  .index('by_project_open_modified', ['projectID', 'open', 'modified', 'sourceIssueID'])
  .index('by_project_open_created', ['projectID', 'open', 'created', 'sourceIssueID'])
  .index('by_project_creator_modified', ['projectID', 'creatorID', 'modified', 'sourceIssueID'])
  .index('by_project_creator_created', ['projectID', 'creatorID', 'created', 'sourceIssueID'])
  .index('by_project_open_creator_modified', ['projectID', 'open', 'creatorID', 'modified', 'sourceIssueID'])
  .index('by_project_open_creator_created', ['projectID', 'open', 'creatorID', 'created', 'sourceIssueID'])
  .index('by_project_assignee_modified', ['projectID', 'assigneeID', 'modified', 'sourceIssueID'])
  .index('by_project_assignee_created', ['projectID', 'assigneeID', 'created', 'sourceIssueID'])
  .index('by_project_open_assignee_modified', ['projectID', 'open', 'assigneeID', 'modified', 'sourceIssueID'])
  .index('by_project_open_assignee_created', ['projectID', 'open', 'assigneeID', 'created', 'sourceIssueID'])
  .sync();

// W-READMODEL: one row per source issue-label edge. The explicit project
// partition makes repeated all-selected-label membership checks bounded while
// retaining typed references to the authoritative source rows.
export const issueLabelRead = defineTable({
  projectID: v.id('project'),
  issueID: v.id('issue'),
  labelID: v.id('label'),
})
  .visibility({ kind: 'public-read' })
  .index('by_issue_label', ['issueID', 'labelID'], { unique: true })
  .index('by_project_label_issue', ['projectID', 'labelID', 'issueID'], { unique: true })
  .index('by_project_issue_label', ['projectID', 'issueID', 'labelID'], { unique: true });

// W-READMODEL: one row per issue containing the title, description, and the
// deterministic `(created,id)` concatenation of comment bodies used to rebuild
// the search corpus. It is intentionally not syncable: search result release
// remains server-authorized, and the search declaration lands with Lane 3.
export const issueSearchDocument = defineTable({
  issueID: v.id('issue'),
  sourceIssueID: v.string(),
  projectID: v.id('project'),
  visibility: v.string(),
  title: v.string(),
  description: v.string(),
  commentText: v.string(),
})
  .visibility({ kind: 'public-read' })
  .index('by_issue', ['issueID'], { unique: true })
  .index('by_source_issue_id', ['sourceIssueID'], { unique: true })
  .index('by_project_visibility_issue', ['projectID', 'visibility', 'sourceIssueID']);

// W-SEARCH-EPOCH: one row per (project, visibility class) carries only a
// monotone invalidation epoch. It contains no query text or result membership;
// a client that observes a change performs a fresh bounded search.
export const searchEpoch = defineTable({
  projectID: v.id('project'),
  visibility: v.string(),
  epoch: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_project_visibility', ['projectID', 'visibility'], { unique: true })
  .index('by_visibility_project', ['visibility', 'projectID'], { unique: true })
  .sync();

// W-FIXTURE: the acceptance-only large-fixture branch commits one ledger row
// in the same transaction as each bounded batch. `committedIds` is a closed
// JSON string of server-owned ids; it lets a verified replay recover the exact
// inverse-remapping rows without exposing this table through the composition.
// @ref LLP 0109#155-quantitative-and-acceptance-closure — this is resumability
// for ordinary bounded commits, not a partially established seed identity.
export const fixtureIngestLedger = defineTable({
  fixtureId: v.string(),
  overlayDigest: v.string(),
  table: v.string(),
  batchIndex: v.integer(),
  rowCount: v.integer(),
  batchDigest: v.string(),
  committedIds: v.string(),
})
  .visibility({ kind: 'public-read' })
  .index('by_fixture_overlay_table_batch', [
    'fixtureId',
    'overlayDigest',
    'table',
    'batchIndex',
  ], { unique: true })
  .index('by_fixture_overlay_batch', [
    'fixtureId',
    'overlayDigest',
    'batchIndex',
  ], { unique: true });

// C-NOTIFY: one durable, transaction-coupled row per triggering mutation.
// Payload and recipient-selection snapshots are canonical JSON strings because
// stored table fields do not admit arrays/objects; Lane 5 owns their delivery
// and attempt-state transitions. The public `idempotencyKey` is separately
// stable from the table's server-owned physical `_id`.
// @ref LLP 0183#zb3--optimistic-programs-and-durable-intent — external effects
// are represented by committed intent before any delivery is attempted.
export const notificationIntent = defineTable({
  idempotencyKey: v.string(),
  trigger: v.string(),
  kind: v.string(),
  issueID: v.id('issue'),
  sourceIssueID: v.string(),
  actorID: v.id('user'),
  created: v.number(),
  payloadSnapshot: v.string(),
  recipientSnapshot: v.string(),
  discordEligible: v.boolean(),
  state: v.string(),
})
  .visibility({ kind: 'public-read' })
  .index('by_idempotency_key', ['idempotencyKey'], { unique: true })
  .index('by_issue_created', ['issueID', 'created', 'idempotencyKey'])
  .index('by_state_created', ['state', 'created', 'idempotencyKey']);

// Lane 4 declares the attempt ledger but deliberately writes no attempt rows:
// delivery, retry, ambiguity, and terminal capture belong to Lane 5.
export const notificationAttempt = defineTable({
  intentID: v.id('notificationIntent'),
  channel: v.string(),
  recipientKey: v.string(),
  attempt: v.integer(),
  state: v.string(),
  providerIdempotencyKey: v.string(),
  started: v.number(),
  finished: v.optional(v.number()),
  errorCode: v.optional(v.string()),
  providerReceiptID: v.optional(v.string()),
  ambiguous: v.boolean(),
})
  .visibility({ kind: 'public-read' })
  .index('by_intent_channel_recipient_attempt', [
    'intentID',
    'channel',
    'recipientKey',
    'attempt',
  ], { unique: true })
  .index('by_state_started', ['state', 'started']);

// C-GATEWAY: one consumed row closes the signed unsubscribe capability after
// its first successful use. The token digest, rather than the token itself,
// is retained so neither the HMAC nor its claims become an app-data secret.
export const unsubscribeTokenUse = defineTable({
  tokenDigest: v.string(),
  userID: v.id('user'),
  issueID: v.id('issue'),
  usedAt: v.number(),
})
  .visibility({ kind: 'public-read' })
  .index('by_token_digest', ['tokenDigest'], { unique: true })
  .index('by_user_issue', ['userID', 'issueID', 'usedAt']);

// C-ASSET: Snapback owns asset objects, upload attempts, and reverse edges.
// The companion additionally needs a source-shaped opaque key so its frozen
// presign response can resolve public delivery and enumerate cleanup. The
// typed reference keeps this alias inside the native asset lifecycle.
// @ref LLP 0044#typed-references-and-atomic-attachment — the companion key
// names a stable native asset identity; the row is committed only by attach.
export const assetAttachment = defineTable({
  key: v.string(),
  owner: v.principal(),
  // Explicitly restriction-less because the gateway has two closed native
  // intents: detectable image formats and the server-validated SVG-as-opaque
  // adapter. Bare v.assetRef() derives one default intent on the current
  // surface and therefore cannot represent this two-intent alias.
  asset: v.assetRef({upload: null}),
  contentType: v.string(),
  size: v.integer(),
  created: v.number(),
})
  .visibility({ kind: 'public-read' })
  .index('by_key', ['key'], { unique: true })
  .index('by_owner_created', ['owner', 'created', 'key'])
  .assetSharing({ kind: 'public-read' });

export default defineSchema(
  {
    user,
    project,
    issue,
    viewState,
    comment,
    label,
    issueLabel,
    emoji,
    userPref,
    issueNotifications,
    identityBinding,
    authorityProbeMembers,
    authorityProbeState,
    projectUserRead,
    issueListRead,
    issueLabelRead,
    issueSearchDocument,
    searchEpoch,
    fixtureIngestLedger,
    notificationIntent,
    notificationAttempt,
    unsubscribeTokenUse,
    assetAttachment,
  },
  { auth: { mode: 'sessions' } },
);
