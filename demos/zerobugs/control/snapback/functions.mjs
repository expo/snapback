import {
  defineAction,
  defineAssetUpload,
  defineConfig,
  defineJsMutation,
  defineJsQuery,
  defineJsLiveQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

// Snapback function exports are JavaScript identifiers. `fixtureIngestBatch`
// is the identifier-safe lowering of the acceptance-only logical surface
// `fixture.ingestBatch` named in PLAN.md.

function fixtureTableNames() {
  return [
    'user',
    'project',
    'label',
    'issue',
    'issueLabel',
    'comment',
    'emoji',
    'viewState',
    'userPref',
    'issueNotifications',
    'identityBinding',
    'projectUserRead',
    'issueListRead',
    'issueLabelRead',
    'issueSearchDocument',
    'searchEpoch',
  ];
}

function largeFixtureContract() {
  return {
    fixtureId: 'large-seed42-v1',
    overlayDigest: 'sha256:39d7758a5a5809abf9fa3b3c6b966ecdf43dd9f5c6cc8b3977a94c17dd4efd73',
    totalRows: 5_549_113,
    totalBatches: 6_176,
  };
}

function largeFixturePlan() {
  return [
    {table: 'user', rows: 100, batches: 1},
    {table: 'project', rows: 100, batches: 1},
    {table: 'label', rows: 4_810, batches: 6},
    {table: 'issue', rows: 1_000_001, batches: 1_112},
    {table: 'issueLabel', rows: 2_000_370, batches: 2_223},
    {table: 'comment', rows: 2_527_887, batches: 2_809},
    {table: 'emoji', rows: 1_746, batches: 2},
    {table: 'viewState', rows: 5_000, batches: 6},
    {table: 'userPref', rows: 5, batches: 1},
    {table: 'issueNotifications', rows: 5_000, batches: 6},
    {table: 'projectUserRead', rows: 100, batches: 1},
    {table: 'issueListRead', rows: 1_000, batches: 2},
    {table: 'issueLabelRead', rows: 1_992, batches: 3},
    // issueSearchDocument rows carry the concatenated title/description/
    // comment text, so a 900-row batch echo exceeds the declared 1 MiB
    // v.json() result ceiling (measured 983 KiB of args alone for rows
    // 0-899). A 500-row cap keeps the same two-batch plan with the largest
    // committed-row echo measured at ~630 KiB against the frozen overlay.
    {table: 'issueSearchDocument', rows: 1_000, batches: 2, rowCap: 500},
    {table: 'searchEpoch', rows: 2, batches: 1},
  ];
}

function largeFixtureExpectedBatch(batchIndex) {
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0) return null;
  let firstBatch = 0;
  for (const entry of largeFixturePlan()) {
    const afterTable = firstBatch + entry.batches;
    if (batchIndex < afterTable) {
      const tableBatch = batchIndex - firstBatch;
      const cap = entry.rowCap ?? 900;
      const rowCount = tableBatch === entry.batches - 1
        ? entry.rows - (entry.batches - 1) * cap
        : cap;
      return {table: entry.table, rowCount};
    }
    firstBatch = afterTable;
  }
  return null;
}

function fixtureUserRoles() {
  return {
    crew: [
      '2wKdbVVF7qtnn5bx92sr9',
      'Gg4MskWt3M-ttzzlrJ9jn',
      'OeVnr1y5bEM_Yg06sUFtD',
      'ieK09sy2C_AIWE8KRkrQR',
      'nqYkxAGMnzk7Y5STjZryV',
      'pgyTvcxh2hjmq2l4WKzK6',
      'tDY6IbKdVqbBlRBc3XMwF',
    ],
    user: [
      '9Fw3n6EQS8mzE126AFJxb',
      'FPEhfZQwiEMgpk3WnEY72',
      '_4MJeHV4T-qZb52fyNwQ9',
      'jpRvILZ1tibPsQXKvb3cF',
      'pFCse65icLsHqrf1TJMuV',
      'vxBeM-NB6tEvoQuhMhFJ9',
      'yJ5hiysWE-LBcDfT44lR8',
    ],
  };
}

function normalFixtureActorBinding(actor) {
  if (actor === 'ordinary-user') {
    return {
      role: 'user',
      sourceUserID: '9Fw3n6EQS8mzE126AFJxb',
    };
  }
  if (actor === 'creator') {
    return {
      role: 'user',
      sourceUserID: 'FPEhfZQwiEMgpk3WnEY72',
    };
  }
  if (actor === 'assignee') {
    return {
      role: 'user',
      sourceUserID: '_4MJeHV4T-qZb52fyNwQ9',
    };
  }
  if (actor === 'crew-admin') {
    return {
      role: 'crew',
      sourceUserID: '2wKdbVVF7qtnn5bx92sr9',
    };
  }
  if (actor === 'removed-member') {
    return {
      role: 'crew',
      sourceUserID: 'Gg4MskWt3M-ttzzlrJ9jn',
    };
  }
  return null;
}

function largeFixtureActorBinding(actor) {
  if (actor === 'ordinary-user') {
    return {role: 'user', sourceUserID: 'usr_0010'};
  }
  if (actor === 'creator') {
    return {role: 'user', sourceUserID: 'usr_0011'};
  }
  if (actor === 'assignee') {
    return {role: 'user', sourceUserID: 'usr_0012'};
  }
  if (actor === 'crew-admin') {
    return {role: 'crew', sourceUserID: 'usr_0000'};
  }
  if (actor === 'removed-member') {
    return {role: 'crew', sourceUserID: 'usr_0001'};
  }
  return null;
}

function largeFixtureUserRole(sourceUserID) {
  const match = /^usr_([0-9]{4})$/u.exec(sourceUserID);
  if (!match) return null;
  const index = Number(match[1]);
  if (!Number.isSafeInteger(index) || index < 0 || index >= 100) return null;
  return index < 10 ? 'crew' : 'user';
}

function requireFixtureSession(ctx) {
  if (!ctx.auth || typeof ctx.auth.userId !== 'string' || ctx.auth.userId.length === 0) {
    throw new Error('fixture ingestion requires an authenticated session');
  }
}

async function authorityProbeStateRow(ctx) {
  return await ctx.db
    .query('authorityProbeState')
    .withIndex('by_user_id')
    .eq('userId', ctx.auth.userId)
    .first();
}

// Measurement plumbing only: these mutations toggle an otherwise-unused
// permission-backing row so LLP 0200's authorization fence/restoration lane is
// reachable without changing issueListV2 visibility. The companion state row
// makes retries tolerant; only a state-changing call buffers a membership
// command, and the diagnostic harness strictly alternates those calls.
// @ref LLP 0200#24-the-authorization-lane-splits-in-two--by-declared-classification
export const authorityProbeGrant = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  reads: ['authorityProbeState'],
  writes: ['authorityProbeMembers', 'authorityProbeState'],
  result: results.value(v.null()),
  handler: async (ctx) => {
    if (await authorityProbeStateRow(ctx)) return null;
    await ctx.membership.authorityProbeMembers.insert({
      userId: ctx.auth.userId,
      role: 'member',
    });
    await ctx.db.insert('authorityProbeState', {userId: ctx.auth.userId});
    return null;
  },
});

export const authorityProbeRevoke = defineJsMutation({
  auth: 'authenticated',
  args: {},
  reads: ['authorityProbeState'],
  writes: ['authorityProbeMembers', 'authorityProbeState'],
  result: results.value(v.null()),
  handler: async (ctx) => {
    const state = await authorityProbeStateRow(ctx);
    if (!state) return null;
    await ctx.membership.authorityProbeMembers.removeSelf();
    await ctx.db.delete('authorityProbeState', state._id);
    return null;
  },
});

// W-IDENTITY: private source rows never trust a caller-selected source user
// id. The sessions gate supplies the principal; this helper resolves the sole
// app-owned binding and verifies that it still names the same frozen source
// user row before releasing that row to any downstream guard.
export async function requireSourceUser(ctx) {
  requireFixtureSession(ctx);
  const principal = ctx.auth.userId;
  const binding = await ctx.db
    .query('identityBinding')
    .withIndex('by_principal')
    .eq('principal', principal)
    .first();
  if (!binding) {
    throw new Error('session principal is not bound to a source user');
  }
  const user = await ctx.db.get('user', binding.userID);
  if (
    !user
    || user.id !== binding.sourceUserID
    || (user.role !== 'crew' && user.role !== 'user')
  ) {
    throw new Error('session principal has an invalid source user binding');
  }
  return user;
}

// W-IDENTITY: role authority comes from the bound source row, never a session
// mint argument, request body, or caller-supplied role claim.
export async function requireCrew(ctx) {
  const user = await requireSourceUser(ctx);
  if (user.role !== 'crew') {
    throw new Error('source user is not authorized');
  }
  return user;
}

// The frozen query policy is crew-or-public. In particular, an ordinary issue
// creator receives no special internal-query visibility.
export async function assertIssueVisible(ctx, issue) {
  if (!issue || (issue.visibility !== 'public' && issue.visibility !== 'internal')) {
    throw new Error('issue was not found or is not visible');
  }
  if (issue.visibility === 'public') {
    return null;
  }
  return await requireCrew(ctx);
}

// The frozen ownership policy is creator-or-crew. Assignment grants neither
// ownership nor edit authority.
export async function assertCreatorOrCrew(ctx, resource) {
  const user = await requireSourceUser(ctx);
  if (!resource || (resource.creatorID !== user._id && user.role !== 'crew')) {
    throw new Error('resource was not found or is not authorized');
  }
  return user;
}

function validateFixtureBatch(table, rows) {
  if (!fixtureTableNames().includes(table)) {
    throw new Error('unknown fixture table');
  }
  if (!Array.isArray(rows) || rows.length > 900) {
    throw new Error('fixture batch must contain at most 900 rows');
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('fixture rows must be objects');
    }
    if ('_id' in row || '_version' in row || '_createdAt' in row || '_updatedAt' in row) {
      throw new Error('fixture rows may not author system fields');
    }
    if (table === 'user' && row.role !== 'crew' && row.role !== 'user') {
      throw new Error('fixture user role must be crew or user');
    }
    if (
      (table === 'issue'
        || table === 'issueListRead'
        || table === 'issueSearchDocument'
        || table === 'searchEpoch')
      && row.visibility !== 'internal'
      && row.visibility !== 'public'
    ) {
      throw new Error('fixture visibility must be internal or public');
    }
  }
}

function fixtureLedgerMetadata(args) {
  const values = [
    args.fixtureId,
    args.overlayDigest,
    args.batchIndex,
    args.rowCount,
    args.batchDigest,
  ];
  const present = values.filter(value => value !== undefined);
  if (present.length === 0) return null;
  if (present.length !== values.length) {
    throw new Error('fixture ingest ledger metadata must be supplied together');
  }
  return {
    fixtureId: args.fixtureId,
    overlayDigest: args.overlayDigest,
    batchIndex: args.batchIndex,
    rowCount: args.rowCount,
    batchDigest: args.batchDigest,
  };
}

function validateLargeFixtureBatch(args, metadata) {
  const contract = largeFixtureContract();
  if (
    metadata.fixtureId !== contract.fixtureId
    || metadata.overlayDigest !== contract.overlayDigest
  ) {
    throw new Error('fixture ingest metadata is outside the frozen large fixture');
  }
  const expected = largeFixtureExpectedBatch(metadata.batchIndex);
  if (!expected || expected.table !== args.table || expected.rowCount !== args.rows.length) {
    throw new Error('fixture ingest batch is outside the frozen large plan');
  }
  if (!Number.isSafeInteger(metadata.rowCount) || metadata.rowCount !== args.rows.length) {
    throw new Error('fixture ingest row count does not match the batch');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(metadata.batchDigest)) {
    throw new Error('fixture ingest batch digest is invalid');
  }
  if (args.table === 'user') {
    const ids = new Set();
    for (const row of args.rows) {
      const expectedRole = typeof row.id === 'string' ? largeFixtureUserRole(row.id) : null;
      if (!expectedRole || row.role !== expectedRole || ids.has(row.id)) {
        throw new Error('fixture ingest user batch is outside the receipt-bound 100-user contract');
      }
      ids.add(row.id);
    }
    if (ids.size !== 100) {
      throw new Error('fixture ingest user batch is outside the receipt-bound 100-user contract');
    }
  }
}

async function requireFixtureBootstrapWindow(db) {
  // @ref LLP 0109#155-quantitative-and-acceptance-closure — this fixture is a
  // sequence of ordinary bounded commits, not a partially installed seed.
  // `searchEpoch` is deliberately last in the frozen load order and therefore
  // acts as the completion sentinel: any later ingest attempt fails closed.
  const completed = await db.query('searchEpoch').take(1).collect();
  if (completed.length !== 0) {
    throw new Error('fixture ingestion is closed after fixture completion');
  }

  // Bootstrap is circular: the fixture creates the source users that a later
  // identityBinding maps to session principals. While the sentinel is absent,
  // only the frozen user population may exist. A foreign source user closes
  // the acceptance loader rather than widening this into a general import API.
  const expected = fixtureUserRoles();
  const users = await db.query('user').take(15).collect();
  if (
    users.length > 14
    || users.some(user => (
      user.role === 'crew'
        ? !expected.crew.includes(user.id)
        : user.role !== 'user' || !expected.user.includes(user.id)
    ))
  ) {
    throw new Error('fixture ingestion found source users outside the frozen fixture');
  }
}

async function requireReceiptBoundLargeUsers(db) {
  const users = await db.query('user').take(101).collect();
  const ids = new Set(users.map(user => user.id));
  if (
    users.length !== 100
    || ids.size !== 100
    || users.some(user => largeFixtureUserRole(user.id) !== user.role)
  ) {
    throw new Error('fixture ingestion requires the receipt-bound 100-user contract');
  }
}

async function fixtureLedgerBatch(db, fixtureId, overlayDigest, batchIndex) {
  return await db
    .query('fixtureIngestLedger')
    .withIndex('by_fixture_overlay_batch')
    .eq('fixtureId', fixtureId)
    .eq('overlayDigest', overlayDigest)
    .eq('batchIndex', batchIndex)
    .first();
}

function fixtureCommittedIds(ledger) {
  let ids;
  try {
    ids = JSON.parse(ledger.committedIds);
  } catch {
    throw new Error('fixture ingest ledger contains invalid committed ids');
  }
  if (
    !Array.isArray(ids)
    || ids.length !== ledger.rowCount
    || ids.some(id => typeof id !== 'string' || id.length === 0)
  ) {
    throw new Error('fixture ingest ledger contains invalid committed ids');
  }
  return ids;
}

async function fixtureCommittedRows(db, table, ids) {
  const rows = [];
  for (const id of ids) {
    const row = await db.get(table, id);
    if (!row) throw new Error('fixture ingest ledger references a missing committed row');
    rows.push(row);
  }
  return rows;
}

async function requireLargeFixtureBootstrapWindow(db, metadata) {
  const bindings = await db.query('identityBinding').take(1).collect();
  if (bindings.length !== 0) {
    throw new Error('fixture ingestion is closed after actor binding begins');
  }
  const completed = await db.query('searchEpoch').take(1).collect();
  if (completed.length !== 0) {
    throw new Error('fixture ingestion is closed after fixture completion');
  }
  if (metadata.batchIndex === 0) {
    const users = await db.query('user').take(1).collect();
    if (users.length !== 0) {
      throw new Error('large fixture ingestion requires an empty source-user table');
    }
    return;
  }
  const previous = await fixtureLedgerBatch(
    db,
    metadata.fixtureId,
    metadata.overlayDigest,
    metadata.batchIndex - 1,
  );
  if (!previous) {
    throw new Error('fixture ingest batches must commit in frozen order');
  }
  await requireReceiptBoundLargeUsers(db);
}

async function requireLoadedFrozenFixture(db) {
  const epochs = await db.query('searchEpoch').take(3).collect();
  if (
    epochs.length !== 2
    || !epochs.some(row => row.visibility === 'public')
    || !epochs.some(row => row.visibility === 'internal')
  ) {
    throw new Error('actor binding requires the complete frozen fixture');
  }

  const users = await db.query('user').take(101).collect();
  const ids = new Set(users.map(user => user.id));
  const expected = fixtureUserRoles();
  const isNormal = (
    users.length !== 14
      ? false
      : ids.size === 14
      && !users.some(user => (
      user.role === 'crew'
        ? !expected.crew.includes(user.id)
        : user.role !== 'user' || !expected.user.includes(user.id)
      ))
  );
  if (isNormal) return 'normal';

  const isLarge = (
    users.length === 100
    && ids.size === 100
    && !users.some(user => largeFixtureUserRole(user.id) !== user.role)
  );
  if (isLarge) {
    const contract = largeFixtureContract();
    const finalLedger = await fixtureLedgerBatch(
      db,
      contract.fixtureId,
      contract.overlayDigest,
      contract.totalBatches - 1,
    );
    if (
      finalLedger
      && finalLedger.table === 'searchEpoch'
      && finalLedger.rowCount === 2
      && /^sha256:[0-9a-f]{64}$/u.test(finalLedger.batchDigest)
    ) return 'large';
  }
  throw new Error('actor binding requires exactly a frozen source-user contract');
}

export const fixtureIngestBatch = defineJsMutation({
  auth: 'authenticated',
  args: {
    table: v.string(),
    rows: v.json(),
    fixtureId: v.optional(v.string()),
    overlayDigest: v.optional(v.string()),
    batchIndex: v.optional(v.integer()),
    rowCount: v.optional(v.integer()),
    batchDigest: v.optional(v.string()),
  },
  reads: ['identityBinding', 'user', 'searchEpoch', 'fixtureIngestLedger'],
  writes: [...fixtureTableNames(), 'fixtureIngestLedger'],
  result: results.value(v.json()),
  outgrewIr: 'general-iteration',
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    validateFixtureBatch(args.table, args.rows);
    const metadata = fixtureLedgerMetadata(args);
    if (!metadata) {
      // Compatibility is deliberate: the frozen normal fixture keeps the
      // exact admission path and return object it had before Lane 8.
      await requireFixtureBootstrapWindow(ctx.db);
      const ids = [];
      for (const row of args.rows) {
        ids.push(await ctx.db.insert(args.table, row));
      }
      return {inserted: args.rows.length, ids};
    }

    validateLargeFixtureBatch(args, metadata);
    const existing = await fixtureLedgerBatch(
      ctx.db,
      metadata.fixtureId,
      metadata.overlayDigest,
      metadata.batchIndex,
    );
    if (existing) {
      if (
        existing.table !== args.table
        || existing.rowCount !== metadata.rowCount
        || existing.batchDigest !== metadata.batchDigest
      ) {
        throw new Error('fixture ingest replay does not match the committed batch');
      }
      const ids = fixtureCommittedIds(existing);
      const rows = await fixtureCommittedRows(ctx.db, args.table, ids);
      return {...metadata, table: args.table, status: 'already-ingested', ids, rows};
    }

    await requireLargeFixtureBootstrapWindow(ctx.db, metadata);
    const ids = [];
    for (const row of args.rows) {
      ids.push(await ctx.db.insert(args.table, row));
    }
    const rows = await fixtureCommittedRows(ctx.db, args.table, ids);
    await ctx.db.insert('fixtureIngestLedger', {
      ...metadata,
      table: args.table,
      committedIds: JSON.stringify(ids),
    });
    return {...metadata, table: args.table, status: 'inserted', ids, rows};
  },
});

function fixtureIngestSummaryResult() {
  return v.object({
    fixtureId: v.string(),
    overlayDigest: v.string(),
    batches: v.integer(),
    rows: v.integer(),
    rowsByTable: v.object({
      user: v.integer(),
      project: v.integer(),
      label: v.integer(),
      issue: v.integer(),
      issueLabel: v.integer(),
      comment: v.integer(),
      emoji: v.integer(),
      viewState: v.integer(),
      userPref: v.integer(),
      issueNotifications: v.integer(),
      projectUserRead: v.integer(),
      issueListRead: v.integer(),
      issueLabelRead: v.integer(),
      issueSearchDocument: v.integer(),
      searchEpoch: v.integer(),
    }),
    completed: v.boolean(),
    finalTable: v.union([v.null(), v.string()]),
  });
}

export const fixtureIngestSummary = defineJsQuery({
  auth: 'authenticated',
  args: {fixtureId: v.string(), overlayDigest: v.string()},
  reads: ['fixtureIngestLedger'],
  result: results.records(fixtureIngestSummaryResult()),
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    const contract = largeFixtureContract();
    if (
      args.fixtureId !== contract.fixtureId
      || args.overlayDigest !== contract.overlayDigest
    ) {
      throw new Error('fixture ingest summary is outside the frozen large fixture');
    }

    const rowsByTable = {
      user: 0,
      project: 0,
      label: 0,
      issue: 0,
      issueLabel: 0,
      comment: 0,
      emoji: 0,
      viewState: 0,
      userPref: 0,
      issueNotifications: 0,
      projectUserRead: 0,
      issueListRead: 0,
      issueLabelRead: 0,
      issueSearchDocument: 0,
      searchEpoch: 0,
    };
    let batches = 0;
    let rows = 0;
    let finalTable = null;
    let afterBatch = -1;
    for (;;) {
      const page = await ctx.db
        .query('fixtureIngestLedger')
        .withIndex('by_fixture_overlay_batch')
        .eq('fixtureId', args.fixtureId)
        .eq('overlayDigest', args.overlayDigest)
        .gt('batchIndex', afterBatch)
        .order('batchIndex', 'asc')
        .take(64)
        .collect();
      for (const ledger of page) {
        const expected = largeFixtureExpectedBatch(batches);
        if (
          !expected
          || ledger.batchIndex !== batches
          || ledger.table !== expected.table
          || ledger.rowCount !== expected.rowCount
          || !/^sha256:[0-9a-f]{64}$/u.test(ledger.batchDigest)
          || typeof ledger.committedIds !== 'string'
          || ledger.committedIds.length === 0
        ) {
          throw new Error('fixture ingest ledger does not match the frozen large plan');
        }
        if (ledger.table === 'user') rowsByTable.user += ledger.rowCount;
        else if (ledger.table === 'project') rowsByTable.project += ledger.rowCount;
        else if (ledger.table === 'label') rowsByTable.label += ledger.rowCount;
        else if (ledger.table === 'issue') rowsByTable.issue += ledger.rowCount;
        else if (ledger.table === 'issueLabel') rowsByTable.issueLabel += ledger.rowCount;
        else if (ledger.table === 'comment') rowsByTable.comment += ledger.rowCount;
        else if (ledger.table === 'emoji') rowsByTable.emoji += ledger.rowCount;
        else if (ledger.table === 'viewState') rowsByTable.viewState += ledger.rowCount;
        else if (ledger.table === 'userPref') rowsByTable.userPref += ledger.rowCount;
        else if (ledger.table === 'issueNotifications') rowsByTable.issueNotifications += ledger.rowCount;
        else if (ledger.table === 'projectUserRead') rowsByTable.projectUserRead += ledger.rowCount;
        else if (ledger.table === 'issueListRead') rowsByTable.issueListRead += ledger.rowCount;
        else if (ledger.table === 'issueLabelRead') rowsByTable.issueLabelRead += ledger.rowCount;
        else if (ledger.table === 'issueSearchDocument') rowsByTable.issueSearchDocument += ledger.rowCount;
        else if (ledger.table === 'searchEpoch') rowsByTable.searchEpoch += ledger.rowCount;
        else throw new Error('fixture ingest ledger names an unknown table');
        rows += ledger.rowCount;
        batches += 1;
        finalTable = ledger.table;
        afterBatch = ledger.batchIndex;
      }
      if (page.length < 64) break;
    }
    const completed = (
      batches === contract.totalBatches
      && rows === contract.totalRows
      && finalTable === 'searchEpoch'
    );
    return [{
      fixtureId: args.fixtureId,
      overlayDigest: args.overlayDigest,
      batches,
      rows,
      rowsByTable,
      completed,
      finalTable,
    }];
  },
});

export const fixtureInspectTable = defineJsQuery({
  auth: 'authenticated',
  args: {table: v.string()},
  reads: fixtureTableNames(),
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    if (!fixtureTableNames().includes(args.table)) {
      throw new Error('unknown fixture table');
    }
    // Lane 1 needs one broad inverse-remap inspection pass before principals
    // exist. The first W-IDENTITY row closes that acceptance bootstrap surface
    // so it cannot bypass Lane 2's principal-bound private queries.
    const bindings = await ctx.db.query('identityBinding').take(1).collect();
    if (bindings.length !== 0) {
      throw new Error('fixture inspection is closed after actor binding begins');
    }
    return await ctx.db.query(args.table).take(1024).collect();
  },
});

// W-IDENTITY acceptance bootstrap. The actor name selects only one member of
// the manifest's frozen five-row map; it is not a general source-user id. The
// mutation is intentionally omitted from the composition gateway and closes
// after five one-to-one bindings.
export const acceptanceBindActor = defineJsMutation({
  auth: 'authenticated',
  args: {actor: v.string()},
  reads: ['fixtureIngestLedger', 'identityBinding', 'searchEpoch', 'user'],
  writes: ['identityBinding'],
  result: results.value(v.object({
    actor: v.string(),
    principal: v.string(),
    sourceUserID: v.string(),
    userID: v.id('user'),
    role: v.string(),
  })),
  outgrewIr: 'general-iteration',
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    const normalActor = normalFixtureActorBinding(args.actor);
    const largeActor = largeFixtureActorBinding(args.actor);
    if (!normalActor || !largeActor) {
      throw new Error('actor binding is closed to the frozen manifest actors');
    }

    let actor = normalActor;
    let sourceUser = await ctx.db
      .query('user')
      .withIndex('by_source_id')
      .eq('id', actor.sourceUserID)
      .first();
    if (!sourceUser) {
      actor = largeActor;
      sourceUser = await ctx.db
        .query('user')
        .withIndex('by_source_id')
        .eq('id', actor.sourceUserID)
        .first();
    }
    if (!sourceUser || sourceUser.role !== actor.role) {
      throw new Error('actor binding source user is unknown or has the wrong frozen role');
    }
    const fixtureContract = await requireLoadedFrozenFixture(ctx.db);
    const expectedActor = fixtureContract === 'large' ? largeActor : normalActor;
    if (sourceUser.id !== expectedActor.sourceUserID || sourceUser.role !== expectedActor.role) {
      throw new Error('actor binding source user is outside the loaded fixture contract');
    }

    const principal = ctx.auth.userId;
    const existingPrincipal = await ctx.db
      .query('identityBinding')
      .withIndex('by_principal')
      .eq('principal', principal)
      .first();
    if (existingPrincipal) {
      throw new Error('session principal is already bound');
    }

    const existingBindings = await ctx.db.query('identityBinding').take(6).collect();
    if (existingBindings.length >= 5) {
      throw new Error('actor binding is closed after the frozen actor set is complete');
    }

    const [existingUser, existingSource] = await Promise.all([
      ctx.db
        .query('identityBinding')
        .withIndex('by_user')
        .eq('userID', sourceUser._id)
        .first(),
      ctx.db
        .query('identityBinding')
        .withIndex('by_source_user_id')
        .eq('sourceUserID', sourceUser.id)
        .first(),
    ]);
    if (existingUser || existingSource) {
      throw new Error('source user is already bound');
    }

    await ctx.db.insert('identityBinding', {
      principal,
      userID: sourceUser._id,
      sourceUserID: sourceUser.id,
    });
    return {
      actor: args.actor,
      principal,
      sourceUserID: sourceUser.id,
      userID: sourceUser._id,
      role: sourceUser.role,
    };
  },
});

export const acceptanceActorBindingSelf = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  result: results.records(v.object({
    principal: v.string(),
    sourceUserID: v.string(),
    userID: v.id('user'),
    role: v.string(),
  })),
  handler: async (ctx) => {
    const user = await requireSourceUser(ctx);
    return [{
      principal: ctx.auth.userId,
      sourceUserID: user.id,
      userID: user._id,
      role: user.role,
    }];
  },
});

export const acceptanceCrewGuard = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  result: results.records(v.object({
    sourceUserID: v.string(),
    role: v.string(),
  })),
  handler: async (ctx) => {
    const user = await requireCrew(ctx);
    return [{sourceUserID: user.id, role: user.role}];
  },
});

export const acceptanceOwnershipGuard = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'issue', 'user'],
  result: results.records(v.object({
    sourceIssueID: v.string(),
    sourceUserID: v.string(),
  })),
  handler: async (ctx) => {
    const issue = await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', 'zbav1_internal_issue')
      .first();
    const user = await assertCreatorOrCrew(ctx, issue);
    return [{sourceIssueID: issue.id, sourceUserID: user.id}];
  },
});

export const acceptancePrivateOverlay = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'issue', 'user', 'viewState'],
  result: results.records(v.object({
    issueID: v.id('issue'),
    sourceUserID: v.string(),
    userID: v.id('user'),
    viewed: v.number(),
  })),
  handler: async (ctx) => {
    const user = await requireSourceUser(ctx);
    const overlay = await ctx.db
      .query('viewState')
      .withIndex('by_user_issue')
      .eq('userID', user._id)
      .first();
    if (!overlay) {
      throw new Error('source user has no acceptance view-state row');
    }
    const issue = await ctx.db.get('issue', overlay.issueID);
    await assertIssueVisible(ctx, issue);
    return [{
      issueID: overlay.issueID,
      sourceUserID: user.id,
      userID: user._id,
      viewed: overlay.viewed,
    }];
  },
});

// @ref LLP 0183#zb3--optimistic-programs-and-durable-intent — authoritative
// writes, projection repair, and durable effect intent settle atomically.
// Lane 4 authoritative mutation helpers. Every source-id lookup is explicit:
// the pinned application keeps its public ids while Snapback alone mints the
// physical prefixed `_id` values used by typed references.

function assertVisibilityDomain(value) {
  if (value !== 'public' && value !== 'internal') {
    throw new Error('issue visibility must be public or internal');
  }
  return value;
}

function assertSubscriptionCommand(value) {
  if (value !== 'subscribe' && value !== 'unsubscribe') {
    throw new Error('notification subscription must be subscribe or unsubscribe');
  }
  return value;
}

function assertIntentDomain(trigger, kind, state) {
  let expectedKind = null;
  if (trigger === 'issueCreate') expectedKind = 'create-issue';
  else if (trigger === 'issueUpdate') expectedKind = 'update-issue';
  else if (trigger === 'issueAddLabel') expectedKind = 'update-issue';
  else if (trigger === 'issueRemoveLabel') expectedKind = 'update-issue';
  else if (trigger === 'emojiAddToIssue') expectedKind = 'add-emoji-to-issue';
  else if (trigger === 'emojiAddToComment') expectedKind = 'add-emoji-to-comment';
  else if (trigger === 'commentAdd') expectedKind = 'add-comment';
  else if (trigger === 'commentEdit') expectedKind = 'edit-comment';
  if (!expectedKind || kind !== expectedKind || state !== 'pending') {
    throw new Error('notification intent has an invalid closed-domain value');
  }
}

function assertBoundedRows(rows, label) {
  if (rows.length >= 1_024) {
    throw new Error(`${label} reached the portable 1,024-row boundary`);
  }
  return rows;
}

function assertCommentBody(issue, body) {
  if (typeof body !== 'string') throw new Error('comment body must be a string');
  const limit = issue.id === 'duuW9Nyj5cTNLlimp9Qje' ? 1_024 : 65_536;
  if (Array.from(body).length > limit) {
    throw new Error(`comment body exceeds the ${limit}-character limit`);
  }
}

// PostgreSQL's identity starts at 3000 and explicit values (including the
// policy-extension sentinel) do not advance that sequence. The control has no
// first-class numeric identity column, so choose the first unused generated
// value under the same bounded transaction that inserts the issue.
export function nextIssueShortID(issues) {
  const used = new Set(issues
    .map(issue => issue.shortID)
    .filter(value => Number.isSafeInteger(value) && value >= 3_000));
  let candidate = 3_000;
  while (used.has(candidate)) {
    if (candidate >= Number.MAX_SAFE_INTEGER) {
      throw new Error('issue short id sequence is exhausted');
    }
    candidate += 1;
  }
  return candidate;
}

export function planIssueDependentCleanup(
  issue,
  comments,
  joins,
  views,
  notifications,
  emojiRows,
) {
  const commentIDs = new Set(comments.map(comment => comment._id));
  return {
    commentIDs: comments.map(comment => comment._id),
    emojiIDs: emojiRows
      .filter(emoji => emoji.subjectID === issue._id || commentIDs.has(emoji.subjectID))
      .map(emoji => emoji._id),
    issueLabels: joins.map(join => ({id: join._id, labelID: join.labelID})),
    viewStateIDs: views.map(view => view._id),
    notificationIDs: notifications.map(notification => notification._id),
  };
}

export function planCommentDependentCleanup(comment, emojiRows) {
  return {
    commentID: comment._id,
    emojiIDs: emojiRows
      .filter(emoji => emoji.subjectID === comment._id)
      .map(emoji => emoji._id),
  };
}

async function sourceRowByID(ctx, table, sourceID) {
  return await ctx.db
    .query(table)
    .withIndex('by_source_id')
    .eq('id', sourceID)
    .first();
}

async function requireSourceRowByID(ctx, table, sourceID) {
  const row = await sourceRowByID(ctx, table, sourceID);
  if (!row) throw new Error(`${table} was not found`);
  return row;
}

async function requireMutationVisibleIssue(ctx, issue) {
  const user = await requireSourceUser(ctx);
  if (!issue) throw new Error('issue was not found or is not visible');
  assertVisibilityDomain(issue.visibility);
  if (
    issue.visibility !== 'public'
    && issue.creatorID !== user._id
    && user.role !== 'crew'
  ) {
    throw new Error('issue was not found or is not visible');
  }
  return user;
}

async function resolveProjectArgument(ctx, sourceProjectID) {
  return await requireSourceRowByID(
    ctx,
    'project',
    sourceProjectID ?? 'iCNlS2qEpzYWEes1RTf-D',
  );
}

async function resolveOptionalAssignee(ctx, sourceAssigneeID) {
  if (sourceAssigneeID === null || sourceAssigneeID === undefined) return null;
  return await requireSourceRowByID(ctx, 'user', sourceAssigneeID);
}

async function upsertIssueNotification(ctx, issue, userID, subscribed, created, forceUpdate) {
  const existing = await ctx.db
    .query('issueNotifications')
    .withIndex('by_user_issue')
    .eq('userID', userID)
    .eq('issueID', issue._id)
    .first();
  if (!existing) {
    await ctx.db.insert('issueNotifications', {
      userID,
      issueID: issue._id,
      subscribed,
      created,
    });
  } else if (forceUpdate) {
    await ctx.db.patch('issueNotifications', existing._id, {subscribed, created});
  }
}

async function repairIssueListRead(ctx, issue) {
  assertVisibilityDomain(issue.visibility);
  const existing = await ctx.db
    .query('issueListRead')
    .withIndex('by_issue')
    .eq('issueID', issue._id)
    .first();
  const values = {
    issueID: issue._id,
    sourceIssueID: issue.id,
    projectID: issue.projectID,
    creatorID: issue.creatorID,
    assigneeID: issue.assigneeID ?? null,
    open: issue.open,
    visibility: issue.visibility,
    modified: issue.modified,
    created: issue.created,
  };
  if (existing) await ctx.db.patch('issueListRead', existing._id, values);
  else await ctx.db.insert('issueListRead', values);
}

async function repairIssueSearchDocument(ctx, issue) {
  assertVisibilityDomain(issue.visibility);
  const comments = assertBoundedRows(
    await ctx.db
      .query('comment')
      .withIndex('by_issue_created')
      .eq('issueID', issue._id)
      .order('created', 'asc')
      .take(1_024)
      .collect(),
    'issue search comments',
  );
  const existing = await ctx.db
    .query('issueSearchDocument')
    .withIndex('by_issue')
    .eq('issueID', issue._id)
    .first();
  const values = {
    issueID: issue._id,
    sourceIssueID: issue.id,
    projectID: issue.projectID,
    visibility: issue.visibility,
    title: issue.title,
    description: issue.description,
    commentText: comments.map(comment => comment.body).join('\n'),
  };
  if (existing) await ctx.db.patch('issueSearchDocument', existing._id, values);
  else await ctx.db.insert('issueSearchDocument', values);
}

async function bumpSearchEpoch(ctx, projectID, visibility) {
  assertVisibilityDomain(visibility);
  const epoch = await ctx.db
    .query('searchEpoch')
    .withIndex('by_project_visibility')
    .eq('projectID', projectID)
    .eq('visibility', visibility)
    .first();
  if (!epoch || !Number.isSafeInteger(epoch.epoch)) {
    throw new Error('search epoch is missing or invalid');
  }
  if (epoch.epoch >= Number.MAX_SAFE_INTEGER) {
    throw new Error('search epoch is exhausted');
  }
  await ctx.db.patch('searchEpoch', epoch._id, {epoch: epoch.epoch + 1});
}

async function repairProjectUserRead(ctx, projectID, userID) {
  const [creatorIssue, assigneeIssue, user, existing] = await Promise.all([
    ctx.db
      .query('issue')
      .withIndex('by_project_creator_modified')
      .eq('projectID', projectID)
      .eq('creatorID', userID)
      .first(),
    ctx.db
      .query('issue')
      .withIndex('by_project_assignee_modified')
      .eq('projectID', projectID)
      .eq('assigneeID', userID)
      .first(),
    ctx.db.get('user', userID),
    ctx.db
      .query('projectUserRead')
      .withIndex('by_project_user')
      .eq('projectID', projectID)
      .eq('userID', userID)
      .first(),
  ]);
  if (!user || (user.role !== 'crew' && user.role !== 'user')) {
    throw new Error('project-user repair found an invalid user role');
  }
  const values = {
    projectID,
    userID,
    isCreator: Boolean(creatorIssue),
    isAssignee: Boolean(assigneeIssue),
    isCrew: user.role === 'crew' && !user.login.startsWith('rocibot'),
  };
  if (values.isCreator || values.isAssignee || values.isCrew) {
    if (existing) await ctx.db.patch('projectUserRead', existing._id, values);
    else await ctx.db.insert('projectUserRead', values);
  } else if (existing) {
    await ctx.db.delete('projectUserRead', existing._id);
  }
}

async function insertIssueLabelRead(ctx, issue, label) {
  const existing = await ctx.db
    .query('issueLabelRead')
    .withIndex('by_issue_label')
    .eq('issueID', issue._id)
    .eq('labelID', label._id)
    .first();
  if (existing) throw new Error('issue label already exists');
  await ctx.db.insert('issueLabelRead', {
    projectID: issue.projectID,
    issueID: issue._id,
    labelID: label._id,
  });
}

async function removeIssueLabelRead(ctx, issueID, labelID) {
  const existing = await ctx.db
    .query('issueLabelRead')
    .withIndex('by_issue_label')
    .eq('issueID', issueID)
    .eq('labelID', labelID)
    .first();
  if (existing) await ctx.db.delete('issueLabelRead', existing._id);
}

export function validRecipientEmail(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  const lastAt = trimmed.lastIndexOf('@');
  if (
    trimmed.length === 0
    || at <= 0
    || at !== lastAt
    || at >= trimmed.length - 3
    || trimmed.slice(at + 1).indexOf('.') <= 0
    || /\s/u.test(trimmed)
  ) return null;
  return trimmed;
}

export function buildNotificationRecipientSnapshot(
  issue,
  actor,
  includeActor,
  subscriptions,
  users,
) {
  assertVisibilityDomain(issue.visibility);
  const usersByID = new Map(users.map(user => [user._id, user]));
  const byEmail = new Map();
  for (const subscription of subscriptions) {
    if (!subscription.subscribed) continue;
    const user = usersByID.get(subscription.userID);
    if (!user || (user.role !== 'crew' && user.role !== 'user')) {
      throw new Error('notification recipient has an invalid role');
    }
    if (!includeActor && user._id === actor._id) continue;
    if (issue.visibility === 'internal' && user.role !== 'crew') continue;
    const email = validRecipientEmail(user.email);
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, {sourceUserID: user.id, email});
  }
  const recipients = [...byEmail.values()].sort((left, right) => (
    left.email < right.email ? -1 : left.email > right.email ? 1
      : left.sourceUserID < right.sourceUserID ? -1
        : left.sourceUserID > right.sourceUserID ? 1 : 0
  ));
  return {
    actorSourceUserID: actor.id,
    includeActor,
    issueVisibility: issue.visibility,
    issueShortID: issue.shortID ?? null,
    recipients,
    discordEligible: issue.visibility === 'public',
  };
}

async function notificationRecipientSnapshot(ctx, issue, actor, includeActor) {
  assertVisibilityDomain(issue.visibility);
  const subscriptions = assertBoundedRows(
    await ctx.db
      .query('issueNotifications')
      .withIndex('by_issue_user')
      .eq('issueID', issue._id)
      .take(1_024)
      .collect(),
    'notification subscriptions',
  );
  const users = [];
  for (const subscription of subscriptions) {
    const user = await ctx.db.get('user', subscription.userID);
    if (user) users.push(user);
  }
  return buildNotificationRecipientSnapshot(
    issue,
    actor,
    includeActor,
    subscriptions,
    users,
  );
}

function compositionEffectIdentity(args) {
  const clientID = args.compositionClientID;
  const mutationID = args.compositionMutationID;
  if (clientID === undefined && mutationID === undefined) return null;
  if (
    typeof clientID !== 'string' || typeof mutationID !== 'string'
    || clientID.length < 1 || clientID.length > 256
    || mutationID.length < 1 || mutationID.length > 256
    || !/^[A-Za-z0-9._:-]+$/.test(clientID)
    || !/^[A-Za-z0-9._:-]+$/.test(mutationID)
  ) throw new Error('composition effect identity was refused');
  return `${clientID}:${mutationID}`;
}

async function enqueueNotificationIntent(
  ctx,
  trigger,
  kind,
  issue,
  actor,
  payload,
  includeActor,
  effectIdentity = null,
) {
  assertIntentDomain(trigger, kind, 'pending');
  const recipientSnapshot = await notificationRecipientSnapshot(
    ctx,
    issue,
    actor,
    includeActor,
  );
  // Duplicate protocol delivery returns the retained mutation settlement
  // without re-entering this handler. Runtime answers are replay-stable too,
  // so this is one durable logical-effect identity rather than a delivery
  // attempt id or the intent row's physical id.
  const idempotencyKey = `notification:${trigger}:${effectIdentity ?? ctx.runtime.id()}`;
  const intentID = await ctx.db.insert('notificationIntent', {
    idempotencyKey,
    trigger,
    kind,
    issueID: issue._id,
    sourceIssueID: issue.id,
    actorID: actor._id,
    created: ctx.runtime.now(),
    payloadSnapshot: JSON.stringify(payload),
    recipientSnapshot: JSON.stringify(recipientSnapshot),
    discordEligible: recipientSnapshot.discordEligible,
    state: 'pending',
  });
  return {intentID, idempotencyKey};
}

function mutationReceipt(mutator, sourceID, rowID, issueID, intent, authoritativeTime) {
  return {
    mutator,
    outcome: 'applied',
    sourceID: sourceID ?? null,
    rowID: rowID ?? null,
    issueID: issueID ?? null,
    intentID: intent?.intentID ?? null,
    intentKey: intent?.idempotencyKey ?? null,
    authoritativeTime: authoritativeTime ?? null,
  };
}

export function notificationPayload(kind, actor, issue, details) {
  return {
    kind,
    actor: {id: actor.id, login: actor.login},
    issue: {
      id: issue.id,
      shortID: issue.shortID ?? null,
      title: issue.title,
      description: issue.description,
      visibility: issue.visibility,
    },
    ...details,
  };
}

function mutationReceiptValidator() {
  return v.object({
    mutator: v.string(),
    outcome: v.literal('applied'),
    sourceID: nullableStringValidator(),
    rowID: nullableStringValidator(),
    issueID: nullableStringValidator(),
    intentID: nullableStringValidator(),
    intentKey: nullableStringValidator(),
    authoritativeTime: v.union([v.null(), v.number()]),
  });
}

export const issueCreate = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    created: v.number(),
    modified: v.number(),
    projectID: v.optional(v.string()),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'comment', 'identityBinding', 'issue', 'issueListRead',
    'issueNotifications', 'issueSearchDocument', 'project',
    'projectUserRead', 'searchEpoch', 'user',
  ],
  writes: [
    'issue', 'issueNotifications', 'issueListRead', 'issueSearchDocument',
    'notificationIntent', 'projectUserRead', 'searchEpoch',
  ],
  result: results.value(mutationReceiptValidator()),
  // W-SHORTID's proof boundary is an application-semantic refusal, not a
  // handler crash: at stores past the 1,024-row bound the allocator cannot
  // prove short-id uniqueness, and the caller must receive a typed code
  // (an undeclared throw folds to SNAPBACK_HANDLER_FAILED and drops the
  // message — observed live in the zb5-hot v9 receipt).
  refusals: ['ZBUGS_SHORT_ID_BOUNDARY'],
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const actor = await requireSourceUser(ctx);
    const project = await resolveProjectArgument(ctx, args.projectID);
    const shortIDRows = await ctx.db.query('issue').take(1_024).collect();
    if (shortIDRows.length >= 1_024) {
      ctx.refuse('ZBUGS_SHORT_ID_BOUNDARY', {boundary: 1_024});
    }
    const shortID = nextIssueShortID(shortIDRows);
    const now = ctx.runtime.now();
    const values = {
      id: args.id,
      shortID,
      title: args.title,
      description: args.description ?? '',
      open: true,
      created: now,
      modified: now,
      projectID: project._id,
      creatorID: actor._id,
      visibility: assertVisibilityDomain('public'),
    };
    const rowID = await ctx.db.insert('issue', values);
    const issue = {...values, _id: rowID};
    await upsertIssueNotification(ctx, issue, actor._id, true, now, false);
    await repairIssueListRead(ctx, issue);
    await repairIssueSearchDocument(ctx, issue);
    await repairProjectUserRead(ctx, issue.projectID, actor._id);
    await bumpSearchEpoch(ctx, issue.projectID, issue.visibility);
    const intent = await enqueueNotificationIntent(
      ctx,
      'issueCreate',
      'create-issue',
      issue,
      actor,
      notificationPayload('create-issue', actor, issue, {}),
      true,
      compositionEffectIdentity(args),
    );
    return mutationReceipt('issue.create', issue.id, rowID, issue.id, intent, now);
  },
});

export const issueUpdate = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    open: v.optional(v.boolean()),
    assigneeID: v.optional(v.union([v.null(), v.string()])),
    visibility: v.optional(v.string()),
    modified: v.number(),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'comment', 'identityBinding', 'issue', 'issueListRead',
    'issueNotifications', 'issueSearchDocument', 'projectUserRead',
    'searchEpoch', 'user',
  ],
  writes: [
    'issue', 'issueNotifications', 'issueListRead', 'issueSearchDocument',
    'notificationIntent', 'projectUserRead', 'searchEpoch',
  ],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const oldIssue = await sourceRowByID(ctx, 'issue', args.id);
    const actor = await assertCreatorOrCrew(ctx, oldIssue);
    assertVisibilityDomain(oldIssue.visibility);
    const hasAssignee = Object.hasOwn(args, 'assigneeID');
    const assignee = hasAssignee
      ? await resolveOptionalAssignee(ctx, args.assigneeID)
      : null;
    if (Object.hasOwn(args, 'visibility')) assertVisibilityDomain(args.visibility);
    const now = ctx.runtime.now();
    const updates = {modified: now};
    // The pinned server forwards the authoritative update payload to notify;
    // formatting ignores `modified`, but Lane 5 still needs the exact snapshot
    // to reconstruct or inspect that decision without rereading mutable rows.
    const submitted = {id: args.id, modified: now};
    if (Object.hasOwn(args, 'title')) {
      updates.title = args.title;
      submitted.title = args.title;
    }
    if (Object.hasOwn(args, 'description')) {
      updates.description = args.description;
      submitted.description = args.description;
    }
    if (Object.hasOwn(args, 'open')) {
      updates.open = args.open;
      submitted.open = args.open;
    }
    if (hasAssignee) {
      updates.assigneeID = assignee?._id ?? null;
      submitted.assigneeID = assignee?.id ?? null;
    }
    if (Object.hasOwn(args, 'visibility')) {
      updates.visibility = args.visibility;
      submitted.visibility = args.visibility;
    }
    await ctx.db.patch('issue', oldIssue._id, updates);
    const issue = {...oldIssue, ...updates};

    if (hasAssignee && assignee) {
      await upsertIssueNotification(ctx, issue, assignee._id, true, now, false);
    }
    if (
      hasAssignee
      && oldIssue.assigneeID
      && oldIssue.assigneeID !== (assignee?._id ?? null)
    ) {
      await upsertIssueNotification(
        ctx,
        issue,
        oldIssue.assigneeID,
        false,
        now,
        true,
      );
    }

    await repairIssueListRead(ctx, issue);
    await repairIssueSearchDocument(ctx, issue);
    if (hasAssignee && oldIssue.assigneeID) {
      await repairProjectUserRead(ctx, issue.projectID, oldIssue.assigneeID);
    }
    if (hasAssignee && assignee) {
      await repairProjectUserRead(ctx, issue.projectID, assignee._id);
    }
    if (
      Object.hasOwn(args, 'title')
      || Object.hasOwn(args, 'description')
      || Object.hasOwn(args, 'visibility')
    ) {
      await bumpSearchEpoch(ctx, issue.projectID, oldIssue.visibility);
      if (issue.visibility !== oldIssue.visibility) {
        await bumpSearchEpoch(ctx, issue.projectID, issue.visibility);
      }
    }
    const intent = await enqueueNotificationIntent(
      ctx,
      'issueUpdate',
      'update-issue',
      issue,
      actor,
      notificationPayload('update-issue', actor, issue, {update: submitted}),
      false,
      compositionEffectIdentity(args),
    );
    return mutationReceipt('issue.update', issue.id, issue._id, issue.id, intent, now);
  },
});

export const issueDelete = defineJsMutation({
  auth: 'authenticated',
  args: {id: v.string()},
  reads: [
    'comment', 'emoji', 'identityBinding', 'issue', 'issueLabel',
    'issueLabelRead', 'issueListRead', 'issueNotifications',
    'issueSearchDocument', 'projectUserRead', 'searchEpoch', 'user', 'viewState',
  ],
  writes: [
    'comment', 'emoji', 'issue', 'issueLabel', 'issueLabelRead',
    'issueListRead', 'issueNotifications', 'issueSearchDocument',
    'projectUserRead', 'searchEpoch', 'viewState',
  ],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'general-iteration',
  handler: async (ctx, args) => {
    const issue = await sourceRowByID(ctx, 'issue', args.id);
    await assertCreatorOrCrew(ctx, issue);
    assertVisibilityDomain(issue.visibility);
    const comments = assertBoundedRows(
      await ctx.db
        .query('comment')
        .withIndex('by_issue')
        .eq('issueID', issue._id)
        .take(1_024)
        .collect(),
      'issue comments',
    );
    const joins = assertBoundedRows(
      await ctx.db
        .query('issueLabel')
        .withIndex('by_issue')
        .eq('issueID', issue._id)
        .take(1_024)
        .collect(),
      'issue labels',
    );
    const views = assertBoundedRows(
      await ctx.db
        .query('viewState')
        .withIndex('by_issue_user')
        .eq('issueID', issue._id)
        .take(1_024)
        .collect(),
      'issue view state',
    );
    const notifications = assertBoundedRows(
      await ctx.db
        .query('issueNotifications')
        .withIndex('by_issue_user')
        .eq('issueID', issue._id)
        .take(1_024)
        .collect(),
      'issue notifications',
    );
    const issueEmoji = assertBoundedRows(
      await ctx.db
        .query('emoji')
        .withIndex('by_subject')
        .eq('subjectID', issue._id)
        .take(1_024)
        .collect(),
      'issue emoji',
    );
    const allEmoji = [...issueEmoji];
    for (const comment of comments) {
      const commentEmoji = assertBoundedRows(
        await ctx.db
          .query('emoji')
          .withIndex('by_subject')
          .eq('subjectID', comment._id)
          .take(1_024)
          .collect(),
        'comment emoji',
      );
      allEmoji.push(...commentEmoji);
    }
    const cleanup = planIssueDependentCleanup(
      issue,
      comments,
      joins,
      views,
      notifications,
      allEmoji,
    );
    for (const emojiID of cleanup.emojiIDs) await ctx.db.delete('emoji', emojiID);
    for (const commentID of cleanup.commentIDs) await ctx.db.delete('comment', commentID);
    for (const join of cleanup.issueLabels) {
      await removeIssueLabelRead(ctx, issue._id, join.labelID);
      await ctx.db.delete('issueLabel', join.id);
    }
    for (const viewID of cleanup.viewStateIDs) await ctx.db.delete('viewState', viewID);
    for (const notificationID of cleanup.notificationIDs) {
      await ctx.db.delete('issueNotifications', notificationID);
    }
    const listRead = await ctx.db
      .query('issueListRead')
      .withIndex('by_issue')
      .eq('issueID', issue._id)
      .first();
    if (listRead) await ctx.db.delete('issueListRead', listRead._id);
    const searchDocument = await ctx.db
      .query('issueSearchDocument')
      .withIndex('by_issue')
      .eq('issueID', issue._id)
      .first();
    if (searchDocument) await ctx.db.delete('issueSearchDocument', searchDocument._id);
    await ctx.db.delete('issue', issue._id);
    await repairProjectUserRead(ctx, issue.projectID, issue.creatorID);
    if (issue.assigneeID) {
      await repairProjectUserRead(ctx, issue.projectID, issue.assigneeID);
    }
    await bumpSearchEpoch(ctx, issue.projectID, issue.visibility);
    return mutationReceipt('issue.delete', issue.id, issue._id, issue.id, null, null);
  },
});

// Inventory class: current IR (Get/Guard/Insert). This control remains JS-tier
// because the generated Get cannot resolve the pinned source id, AuthUserId is
// not the bound source-user id, and the plan cannot append recipient intent.
export const issueAddLabel = defineJsMutation({
  auth: 'authenticated',
  args: {
    issueID: v.string(),
    labelID: v.string(),
    projectID: v.optional(v.string()),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'identityBinding', 'issue', 'issueLabel', 'issueLabelRead',
    'issueNotifications', 'label', 'project', 'user',
  ],
  writes: ['issueLabel', 'issueLabelRead', 'notificationIntent'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'filtered-read-guards',
  handler: async (ctx, args) => {
    const [issue, label, project] = await Promise.all([
      sourceRowByID(ctx, 'issue', args.issueID),
      requireSourceRowByID(ctx, 'label', args.labelID),
      resolveProjectArgument(ctx, args.projectID),
    ]);
    const actor = await assertCreatorOrCrew(ctx, issue);
    if (issue.projectID !== project._id || label.projectID !== project._id) {
      throw new Error('issue, label, and project do not share one project');
    }
    const rowID = await ctx.db.insert('issueLabel', {
      issueID: issue._id,
      labelID: label._id,
      projectID: project._id,
    });
    await insertIssueLabelRead(ctx, issue, label);
    const intent = await enqueueNotificationIntent(
      ctx,
      'issueAddLabel',
      'update-issue',
      issue,
      actor,
      notificationPayload('update-issue', actor, issue, {update: {id: issue.id}}),
      false,
      compositionEffectIdentity(args),
    );
    return mutationReceipt('issue.addLabel', label.id, rowID, issue.id, intent, null);
  },
});

export const issueRemoveLabel = defineJsMutation({
  auth: 'authenticated',
  args: {
    issueID: v.string(),
    labelID: v.string(),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'identityBinding', 'issue', 'issueLabel', 'issueLabelRead',
    'issueNotifications', 'label', 'user',
  ],
  writes: ['issueLabel', 'issueLabelRead', 'notificationIntent'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const [issue, label] = await Promise.all([
      sourceRowByID(ctx, 'issue', args.issueID),
      requireSourceRowByID(ctx, 'label', args.labelID),
    ]);
    const actor = await assertCreatorOrCrew(ctx, issue);
    const join = await ctx.db
      .query('issueLabel')
      .withIndex('by_label_issue')
      .eq('labelID', label._id)
      .eq('issueID', issue._id)
      .first();
    if (!join) throw new Error('issue label was not found');
    await ctx.db.delete('issueLabel', join._id);
    await removeIssueLabelRead(ctx, issue._id, label._id);
    const intent = await enqueueNotificationIntent(
      ctx,
      'issueRemoveLabel',
      'update-issue',
      issue,
      actor,
      notificationPayload('update-issue', actor, issue, {update: {id: issue.id}}),
      false,
      compositionEffectIdentity(args),
    );
    return mutationReceipt('issue.removeLabel', label.id, join._id, issue.id, intent, null);
  },
});

async function updateNotificationSubscription(ctx, actor, issue, command, created) {
  const subscribed = assertSubscriptionCommand(command) === 'subscribe';
  const existing = await ctx.db
    .query('issueNotifications')
    .withIndex('by_user_issue')
    .eq('userID', actor._id)
    .eq('issueID', issue._id)
    .first();
  let rowID;
  if (existing) {
    rowID = existing._id;
    await ctx.db.patch('issueNotifications', rowID, {subscribed, created});
  } else {
    rowID = await ctx.db.insert('issueNotifications', {
      userID: actor._id,
      issueID: issue._id,
      subscribed,
      created,
    });
  }
  return mutationReceipt(
    'notification.update',
    actor.id,
    rowID,
    issue.id,
    null,
    created,
  );
}

export const notificationUpdate = defineJsMutation({
  auth: 'authenticated',
  args: {issueID: v.string(), subscribed: v.string(), created: v.number()},
  reads: ['identityBinding', 'issue', 'issueNotifications', 'user'],
  writes: ['issueNotifications'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const issue = await sourceRowByID(ctx, 'issue', args.issueID);
    const actor = await requireMutationVisibleIssue(ctx, issue);
    return await updateNotificationSubscription(
      ctx,
      actor,
      issue,
      args.subscribed,
      args.created,
    );
  },
});

export const emojiAddToIssue = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.string(),
    unicode: v.string(),
    annotation: v.string(),
    subjectID: v.string(),
    created: v.number(),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'identityBinding', 'issue', 'issueListRead', 'issueNotifications', 'user',
  ],
  writes: [
    'emoji', 'issue', 'issueListRead', 'issueNotifications',
    'notificationIntent',
  ],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const issue = await sourceRowByID(ctx, 'issue', args.subjectID);
    const actor = await requireMutationVisibleIssue(ctx, issue);
    const now = ctx.runtime.now();
    const rowID = await ctx.db.insert('emoji', {
      id: args.id,
      value: args.unicode,
      annotation: args.annotation,
      subjectID: issue._id,
      creatorID: actor._id,
      created: now,
    });
    await ctx.db.patch('issue', issue._id, {modified: now});
    const updatedIssue = {...issue, modified: now};
    await repairIssueListRead(ctx, updatedIssue);
    await upsertIssueNotification(ctx, updatedIssue, actor._id, true, now, false);
    const intent = await enqueueNotificationIntent(
      ctx,
      'emojiAddToIssue',
      'add-emoji-to-issue',
      updatedIssue,
      actor,
      notificationPayload('add-emoji-to-issue', actor, updatedIssue, {
        emoji: args.unicode,
      }),
      false,
      compositionEffectIdentity(args),
    );
    return mutationReceipt(
      'emoji.addToIssue',
      args.id,
      rowID,
      issue.id,
      intent,
      now,
    );
  },
});

export const emojiAddToComment = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.string(),
    unicode: v.string(),
    annotation: v.string(),
    subjectID: v.string(),
    created: v.number(),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'comment', 'identityBinding', 'issue', 'issueListRead',
    'issueNotifications', 'user',
  ],
  writes: ['emoji', 'issue', 'issueListRead', 'notificationIntent'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'filtered-read-guards',
  handler: async (ctx, args) => {
    const comment = await requireSourceRowByID(ctx, 'comment', args.subjectID);
    const issue = await ctx.db.get('issue', comment.issueID);
    const actor = await requireMutationVisibleIssue(ctx, issue);
    const now = ctx.runtime.now();
    const rowID = await ctx.db.insert('emoji', {
      id: args.id,
      value: args.unicode,
      annotation: args.annotation,
      subjectID: comment._id,
      creatorID: actor._id,
      created: now,
    });
    await ctx.db.patch('issue', issue._id, {modified: now});
    const updatedIssue = {...issue, modified: now};
    await repairIssueListRead(ctx, updatedIssue);
    const intent = await enqueueNotificationIntent(
      ctx,
      'emojiAddToComment',
      'add-emoji-to-comment',
      updatedIssue,
      actor,
      notificationPayload('add-emoji-to-comment', actor, updatedIssue, {
        emoji: args.unicode,
        comment: {id: comment.id, body: comment.body},
      }),
      false,
      compositionEffectIdentity(args),
    );
    return mutationReceipt(
      'emoji.addToComment',
      args.id,
      rowID,
      issue.id,
      intent,
      now,
    );
  },
});

export const emojiRemove = defineJsMutation({
  auth: 'authenticated',
  args: {id: v.string()},
  reads: ['emoji', 'identityBinding', 'user'],
  writes: ['emoji'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const emoji = await sourceRowByID(ctx, 'emoji', args.id);
    await assertCreatorOrCrew(ctx, emoji);
    await ctx.db.delete('emoji', emoji._id);
    return mutationReceipt('emoji.remove', emoji.id, emoji._id, null, null, null);
  },
});

export const commentAdd = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.string(),
    issueID: v.string(),
    body: v.string(),
    created: v.number(),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'comment', 'identityBinding', 'issue', 'issueListRead',
    'issueNotifications', 'issueSearchDocument', 'searchEpoch', 'user',
  ],
  writes: [
    'comment', 'issue', 'issueListRead', 'issueNotifications',
    'issueSearchDocument', 'notificationIntent', 'searchEpoch',
  ],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const issue = await sourceRowByID(ctx, 'issue', args.issueID);
    const actor = await requireMutationVisibleIssue(ctx, issue);
    assertCommentBody(issue, args.body);
    const now = ctx.runtime.now();
    const rowID = await ctx.db.insert('comment', {
      id: args.id,
      issueID: issue._id,
      body: args.body,
      creatorID: actor._id,
      created: now,
    });
    await ctx.db.patch('issue', issue._id, {modified: now});
    const updatedIssue = {...issue, modified: now};
    await repairIssueListRead(ctx, updatedIssue);
    await repairIssueSearchDocument(ctx, updatedIssue);
    await upsertIssueNotification(ctx, updatedIssue, actor._id, true, now, false);
    await bumpSearchEpoch(ctx, updatedIssue.projectID, updatedIssue.visibility);
    const intent = await enqueueNotificationIntent(
      ctx,
      'commentAdd',
      'add-comment',
      updatedIssue,
      actor,
      notificationPayload('add-comment', actor, updatedIssue, {
        comment: {id: args.id, body: args.body},
      }),
      false,
      compositionEffectIdentity(args),
    );
    return mutationReceipt('comment.add', args.id, rowID, issue.id, intent, now);
  },
});

// Inventory class: current IR (Get/Guard/Patch). The source-id lookup,
// principal-to-source ownership mapping, search repair, and durable recipient
// branch keep the complete authoritative program on the JS tier.
export const commentEdit = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.string(),
    body: v.string(),
    compositionClientID: v.optional(v.string()),
    compositionMutationID: v.optional(v.string()),
  },
  reads: [
    'comment', 'identityBinding', 'issue', 'issueNotifications',
    'issueSearchDocument', 'searchEpoch', 'user',
  ],
  writes: ['comment', 'issueSearchDocument', 'notificationIntent', 'searchEpoch'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'filtered-read-guards',
  handler: async (ctx, args) => {
    const comment = await sourceRowByID(ctx, 'comment', args.id);
    const actor = await assertCreatorOrCrew(ctx, comment);
    const issue = await ctx.db.get('issue', comment.issueID);
    if (!issue) throw new Error('comment parent issue was not found');
    assertVisibilityDomain(issue.visibility);
    assertCommentBody(issue, args.body);
    await ctx.db.patch('comment', comment._id, {body: args.body});
    await repairIssueSearchDocument(ctx, issue);
    await bumpSearchEpoch(ctx, issue.projectID, issue.visibility);
    const intent = await enqueueNotificationIntent(
      ctx,
      'commentEdit',
      'edit-comment',
      issue,
      actor,
      notificationPayload('edit-comment', actor, issue, {
        comment: {id: comment.id, body: args.body},
      }),
      false,
      compositionEffectIdentity(args),
    );
    return mutationReceipt('comment.edit', comment.id, comment._id, issue.id, intent, null);
  },
});

export const commentRemove = defineJsMutation({
  auth: 'authenticated',
  args: {id: v.string()},
  reads: [
    'comment', 'emoji', 'identityBinding', 'issue', 'issueSearchDocument',
    'searchEpoch', 'user',
  ],
  writes: ['comment', 'emoji', 'issueSearchDocument', 'searchEpoch'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'general-iteration',
  handler: async (ctx, args) => {
    const comment = await sourceRowByID(ctx, 'comment', args.id);
    await assertCreatorOrCrew(ctx, comment);
    const issue = await ctx.db.get('issue', comment.issueID);
    if (!issue) throw new Error('comment parent issue was not found');
    assertVisibilityDomain(issue.visibility);
    const emojiRows = assertBoundedRows(
      await ctx.db
        .query('emoji')
        .withIndex('by_subject')
        .eq('subjectID', comment._id)
        .take(1_024)
        .collect(),
      'comment emoji',
    );
    const cleanup = planCommentDependentCleanup(comment, emojiRows);
    for (const emojiID of cleanup.emojiIDs) await ctx.db.delete('emoji', emojiID);
    await ctx.db.delete('comment', cleanup.commentID);
    await repairIssueSearchDocument(ctx, issue);
    await bumpSearchEpoch(ctx, issue.projectID, issue.visibility);
    return mutationReceipt('comment.remove', comment.id, comment._id, issue.id, null, null);
  },
});

export const labelCreate = defineJsMutation({
  auth: 'authenticated',
  args: {id: v.string(), name: v.string(), projectID: v.optional(v.string())},
  reads: ['identityBinding', 'project', 'user'],
  writes: ['label'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'filtered-read-guards',
  handler: async (ctx, args) => {
    await requireCrew(ctx);
    const project = await resolveProjectArgument(ctx, args.projectID);
    const rowID = await ctx.db.insert('label', {
      id: args.id,
      name: args.name,
      projectID: project._id,
    });
    return mutationReceipt('label.create', args.id, rowID, null, null, null);
  },
});

export const labelCreateAndAddToIssue = defineJsMutation({
  auth: 'authenticated',
  args: {
    issueID: v.string(),
    labelID: v.string(),
    labelName: v.string(),
    projectID: v.optional(v.string()),
  },
  reads: ['identityBinding', 'issue', 'issueLabelRead', 'project', 'user'],
  writes: ['issueLabel', 'issueLabelRead', 'label'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'filtered-read-guards',
  handler: async (ctx, args) => {
    await requireCrew(ctx);
    const [issue, project] = await Promise.all([
      requireSourceRowByID(ctx, 'issue', args.issueID),
      resolveProjectArgument(ctx, args.projectID),
    ]);
    if (issue.projectID !== project._id) {
      throw new Error('issue and label project do not match');
    }
    const labelID = await ctx.db.insert('label', {
      id: args.labelID,
      name: args.labelName,
      projectID: project._id,
    });
    const label = {
      _id: labelID,
      id: args.labelID,
      name: args.labelName,
      projectID: project._id,
    };
    await ctx.db.insert('issueLabel', {
      issueID: issue._id,
      labelID,
      projectID: project._id,
    });
    await insertIssueLabelRead(ctx, issue, label);
    return mutationReceipt(
      'label.createAndAddToIssue',
      args.labelID,
      labelID,
      issue.id,
      null,
      null,
    );
  },
});

export const viewStateSet = defineJsMutation({
  auth: 'authenticated',
  args: {issueID: v.string(), viewed: v.number()},
  reads: ['identityBinding', 'issue', 'user', 'viewState'],
  writes: ['viewState'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const actor = await requireSourceUser(ctx);
    const issue = await requireSourceRowByID(ctx, 'issue', args.issueID);
    const existing = await ctx.db
      .query('viewState')
      .withIndex('by_user_issue')
      .eq('userID', actor._id)
      .eq('issueID', issue._id)
      .first();
    let rowID;
    if (existing) {
      rowID = existing._id;
      await ctx.db.patch('viewState', rowID, {viewed: args.viewed});
    } else {
      rowID = await ctx.db.insert('viewState', {
        issueID: issue._id,
        userID: actor._id,
        viewed: args.viewed,
      });
    }
    return mutationReceipt('viewState.set', actor.id, rowID, issue.id, null, args.viewed);
  },
});

export const userPrefSet = defineJsMutation({
  auth: 'authenticated',
  args: {key: v.string(), value: v.string()},
  reads: ['identityBinding', 'user', 'userPref'],
  writes: ['userPref'],
  result: results.value(mutationReceiptValidator()),
  outgrewIr: 'conditional-writes',
  handler: async (ctx, args) => {
    const actor = await requireSourceUser(ctx);
    const existing = await ctx.db
      .query('userPref')
      .withIndex('by_key_user')
      .eq('key', args.key)
      .eq('userID', actor._id)
      .first();
    let rowID;
    if (existing) {
      rowID = existing._id;
      await ctx.db.patch('userPref', rowID, {value: args.value});
    } else {
      rowID = await ctx.db.insert('userPref', {
        key: args.key,
        userID: actor._id,
        value: args.value,
      });
    }
    return mutationReceipt('userPref.set', actor.id, rowID, null, null, null);
  },
});

function issueLabelAuditValidator() {
  return v.object({issueID: v.string(), labelID: v.string(), projectID: v.string()});
}

function projectUserReadAuditValidator() {
  return v.object({
    projectID: v.string(),
    userID: v.string(),
    isCreator: v.boolean(),
    isAssignee: v.boolean(),
    isCrew: v.boolean(),
  });
}

function issueListReadAuditValidator() {
  return v.object({
    issueID: v.string(),
    projectID: v.string(),
    creatorID: v.string(),
    assigneeID: nullableStringValidator(),
    open: v.boolean(),
    visibility: visibilityResultValidator(),
    modified: v.number(),
    created: v.number(),
  });
}

function issueSearchDocumentAuditValidator() {
  return v.object({
    issueID: v.string(),
    projectID: v.string(),
    visibility: visibilityResultValidator(),
    title: v.string(),
    description: v.string(),
    commentText: v.string(),
  });
}

function searchEpochAuditValidator() {
  return v.object({
    projectID: v.string(),
    visibility: visibilityResultValidator(),
    epoch: v.integer(),
  });
}

function intentAuditValidator() {
  return v.object({
    physicalID: v.string(),
    idempotencyKey: v.string(),
    trigger: v.string(),
    kind: v.string(),
    issueID: v.string(),
    actorID: v.string(),
    created: v.number(),
    payloadSnapshot: v.string(),
    recipientSnapshot: v.string(),
    discordEligible: v.boolean(),
    state: v.string(),
  });
}

function attemptAuditValidator() {
  return v.object({
    physicalID: v.string(),
    intentID: v.string(),
    channel: v.string(),
    recipientKey: v.string(),
    attempt: v.integer(),
    state: v.string(),
    providerIdempotencyKey: v.string(),
    started: v.number(),
    finished: v.union([v.null(), v.number()]),
    errorCode: nullableStringValidator(),
    providerReceiptID: nullableStringValidator(),
    ambiguous: v.boolean(),
  });
}

function lane4StateAuditValidator() {
  return v.object({
    issues: v.array(issueResultValidator(), {maxItems: 1_023}),
    comments: v.array(commentResultValidator(), {maxItems: 1_023}),
    labels: v.array(labelResultValidator(), {maxItems: 1_023}),
    issueLabels: v.array(issueLabelAuditValidator(), {maxItems: 1_023}),
    emoji: v.array(emojiResultValidator(), {maxItems: 1_023}),
    viewState: v.array(viewStateResultValidator(), {maxItems: 1_023}),
    userPref: v.array(userPrefResultValidator(), {maxItems: 1_023}),
    issueNotifications: v.array(notificationResultValidator(), {maxItems: 1_023}),
    projectUserRead: v.array(projectUserReadAuditValidator(), {maxItems: 1_023}),
    issueListRead: v.array(issueListReadAuditValidator(), {maxItems: 1_023}),
    issueLabelRead: v.array(issueLabelAuditValidator(), {maxItems: 1_023}),
    issueSearchDocument: v.array(issueSearchDocumentAuditValidator(), {maxItems: 1_023}),
    searchEpoch: v.array(searchEpochAuditValidator(), {maxItems: 1_023}),
    notificationIntent: v.array(intentAuditValidator(), {maxItems: 1_023}),
    notificationAttempt: v.array(attemptAuditValidator(), {maxItems: 1_023}),
  });
}

function requiredMappedRow(map, id, label) {
  const row = map.get(id);
  if (!row) throw new Error(`lane4 audit found a broken ${label} reference`);
  return row;
}

// Acceptance-only crew inspector. It releases source-shaped rows and semantic
// projection fields so the live harness can independently rebuild the Lane 3
// read models; it is not part of the application data adapter.
export const lane4StateAudit = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: [
    'comment', 'emoji', 'identityBinding', 'issue', 'issueLabel',
    'issueLabelRead', 'issueListRead', 'issueNotifications',
    'issueSearchDocument', 'label', 'notificationAttempt',
    'notificationIntent', 'project', 'projectUserRead', 'searchEpoch',
    'user', 'userPref', 'viewState',
  ],
  result: results.records(lane4StateAuditValidator()),
  handler: async (ctx) => {
    await requireCrew(ctx);
    const [
      users, projects, issues, comments, labels, issueLabels, emojiRows,
      viewRows, prefRows, notificationRows, projectUserRows, listRows,
      labelReadRows, searchRows, epochRows, intentRows, attemptRows,
    ] = await Promise.all([
      ctx.db.query('user').take(1_024).collect(),
      ctx.db.query('project').take(1_024).collect(),
      ctx.db.query('issue').take(1_024).collect(),
      ctx.db.query('comment').take(1_024).collect(),
      ctx.db.query('label').take(1_024).collect(),
      ctx.db.query('issueLabel').take(1_024).collect(),
      ctx.db.query('emoji').take(1_024).collect(),
      ctx.db.query('viewState').take(1_024).collect(),
      ctx.db.query('userPref').take(1_024).collect(),
      ctx.db.query('issueNotifications').take(1_024).collect(),
      ctx.db.query('projectUserRead').take(1_024).collect(),
      ctx.db.query('issueListRead').take(1_024).collect(),
      ctx.db.query('issueLabelRead').take(1_024).collect(),
      ctx.db.query('issueSearchDocument').take(1_024).collect(),
      ctx.db.query('searchEpoch').take(1_024).collect(),
      ctx.db.query('notificationIntent').take(1_024).collect(),
      ctx.db.query('notificationAttempt').take(1_024).collect(),
    ]);
    for (const [rows, label] of [
      [users, 'users'], [projects, 'projects'], [issues, 'issues'],
      [comments, 'comments'], [labels, 'labels'], [issueLabels, 'issue labels'],
      [emojiRows, 'emoji'], [viewRows, 'view state'], [prefRows, 'preferences'],
      [notificationRows, 'notifications'], [projectUserRows, 'project users'],
      [listRows, 'issue list read'], [labelReadRows, 'issue label read'],
      [searchRows, 'search documents'], [epochRows, 'search epochs'],
      [intentRows, 'notification intents'], [attemptRows, 'notification attempts'],
    ]) assertBoundedRows(rows, `lane4 audit ${label}`);

    const usersByID = new Map(users.map(row => [row._id, row]));
    const projectsByID = new Map(projects.map(row => [row._id, row]));
    const issuesByID = new Map(issues.map(row => [row._id, row]));
    const commentsByID = new Map(comments.map(row => [row._id, row]));
    const labelsByID = new Map(labels.map(row => [row._id, row]));
    return [{
      issues: issues.map(issue => sourceIssueResult(
        issue,
        requiredMappedRow(projectsByID, issue.projectID, 'issue project'),
        requiredMappedRow(usersByID, issue.creatorID, 'issue creator'),
        issue.assigneeID
          ? requiredMappedRow(usersByID, issue.assigneeID, 'issue assignee')
          : null,
      )),
      comments: comments.map(comment => sourceCommentResult(
        comment,
        requiredMappedRow(issuesByID, comment.issueID, 'comment issue'),
        requiredMappedRow(usersByID, comment.creatorID, 'comment creator'),
      )),
      labels: labels.map(label => sourceLabelResult(
        label,
        requiredMappedRow(projectsByID, label.projectID, 'label project'),
      )),
      issueLabels: issueLabels.map(edge => ({
        issueID: requiredMappedRow(issuesByID, edge.issueID, 'join issue').id,
        labelID: requiredMappedRow(labelsByID, edge.labelID, 'join label').id,
        projectID: requiredMappedRow(projectsByID, edge.projectID, 'join project').id,
      })),
      emoji: emojiRows.map(emoji => {
        const subject = issuesByID.get(emoji.subjectID) ?? commentsByID.get(emoji.subjectID);
        if (!subject) throw new Error('lane4 audit found a broken emoji subject');
        return sourceEmojiResult(
          emoji,
          subject.id,
          requiredMappedRow(usersByID, emoji.creatorID, 'emoji creator'),
        );
      }),
      viewState: viewRows.map(view => sourceViewStateResult(
        view,
        requiredMappedRow(issuesByID, view.issueID, 'view issue'),
        requiredMappedRow(usersByID, view.userID, 'view user'),
      )),
      userPref: prefRows.map(pref => sourceUserPrefResult(
        pref,
        requiredMappedRow(usersByID, pref.userID, 'preference user'),
      )),
      issueNotifications: notificationRows.map(notification => sourceNotificationResult(
        notification,
        requiredMappedRow(issuesByID, notification.issueID, 'notification issue'),
        requiredMappedRow(usersByID, notification.userID, 'notification user'),
      )),
      projectUserRead: projectUserRows.map(row => ({
        projectID: requiredMappedRow(projectsByID, row.projectID, 'project-user project').id,
        userID: requiredMappedRow(usersByID, row.userID, 'project-user user').id,
        isCreator: row.isCreator,
        isAssignee: row.isAssignee,
        isCrew: row.isCrew,
      })),
      issueListRead: listRows.map(row => ({
        issueID: row.sourceIssueID,
        projectID: requiredMappedRow(projectsByID, row.projectID, 'list project').id,
        creatorID: requiredMappedRow(usersByID, row.creatorID, 'list creator').id,
        assigneeID: row.assigneeID
          ? requiredMappedRow(usersByID, row.assigneeID, 'list assignee').id
          : null,
        open: row.open,
        visibility: assertVisibilityDomain(row.visibility),
        modified: row.modified,
        created: row.created,
      })),
      issueLabelRead: labelReadRows.map(row => ({
        issueID: requiredMappedRow(issuesByID, row.issueID, 'label-read issue').id,
        labelID: requiredMappedRow(labelsByID, row.labelID, 'label-read label').id,
        projectID: requiredMappedRow(projectsByID, row.projectID, 'label-read project').id,
      })),
      issueSearchDocument: searchRows.map(row => ({
        issueID: row.sourceIssueID,
        projectID: requiredMappedRow(projectsByID, row.projectID, 'search project').id,
        visibility: assertVisibilityDomain(row.visibility),
        title: row.title,
        description: row.description,
        commentText: row.commentText,
      })),
      searchEpoch: epochRows.map(row => ({
        projectID: requiredMappedRow(projectsByID, row.projectID, 'epoch project').id,
        visibility: assertVisibilityDomain(row.visibility),
        epoch: row.epoch,
      })),
      notificationIntent: intentRows.map(row => ({
        physicalID: row._id,
        idempotencyKey: row.idempotencyKey,
        trigger: row.trigger,
        kind: row.kind,
        issueID: row.sourceIssueID,
        actorID: requiredMappedRow(usersByID, row.actorID, 'intent actor').id,
        created: row.created,
        payloadSnapshot: row.payloadSnapshot,
        recipientSnapshot: row.recipientSnapshot,
        discordEligible: row.discordEligible,
        state: row.state,
      })),
      notificationAttempt: attemptRows.map(row => ({
        physicalID: row._id,
        intentID: row.intentID,
        channel: row.channel,
        recipientKey: row.recipientKey,
        attempt: row.attempt,
        state: row.state,
        providerIdempotencyKey: row.providerIdempotencyKey,
        started: row.started,
        finished: row.finished ?? null,
        errorCode: row.errorCode ?? null,
        providerReceiptID: row.providerReceiptID ?? null,
        ambiguous: row.ambiguous,
      })),
    }];
  },
});

// Lane 3 query result contracts. These are source-shaped records rather than
// raw stored documents: the pinned Zero surface does not expose Snapback
// system fields, user email/github ids, or physical foreign-key ids.

function statusValidator() {
  return v.union([
    v.literal('complete'),
    v.literal('incomplete'),
    v.literal('refreshing'),
    v.literal('not-found-authoritative'),
  ]);
}

function nullableStringValidator() {
  return v.union([v.null(), v.string()]);
}

function roleResultValidator() {
  return v.union([v.literal('crew'), v.literal('user')]);
}

function visibilityResultValidator() {
  return v.union([v.literal('internal'), v.literal('public')]);
}

function userResultValidator() {
  return v.object({
    id: v.string(),
    login: v.string(),
    name: v.optional(v.string()),
    avatar: v.string(),
    role: roleResultValidator(),
  });
}

function projectResultValidator() {
  return v.object({
    id: v.string(),
    name: v.string(),
    lowerCaseName: v.string(),
    issueCountEstimate: v.optional(v.integer()),
    supportsSearch: v.boolean(),
    markURL: v.optional(v.string()),
    logoURL: v.optional(v.string()),
  });
}

function issueResultValidator() {
  return v.object({
    id: v.string(),
    shortID: v.optional(v.integer()),
    title: v.string(),
    open: v.boolean(),
    modified: v.number(),
    created: v.number(),
    projectID: v.string(),
    creatorID: v.string(),
    assigneeID: v.optional(v.string()),
    description: v.string(),
    visibility: visibilityResultValidator(),
  });
}

function labelResultValidator() {
  return v.object({id: v.string(), name: v.string(), projectID: v.string()});
}

function viewStateResultValidator() {
  return v.object({issueID: v.string(), userID: v.string(), viewed: v.number()});
}

function userPrefResultValidator() {
  return v.object({key: v.string(), userID: v.string(), value: v.string()});
}

function notificationResultValidator() {
  return v.object({
    userID: v.string(),
    issueID: v.string(),
    subscribed: v.boolean(),
    created: v.number(),
  });
}

function emojiResultValidator() {
  return v.object({
    id: v.string(),
    value: v.string(),
    annotation: v.string(),
    subjectID: v.string(),
    creatorID: v.string(),
    created: v.number(),
  });
}

function commentResultValidator() {
  return v.object({
    id: v.string(),
    issueID: v.string(),
    created: v.number(),
    body: v.string(),
    creatorID: v.string(),
  });
}

function issueCursorValidator() {
  return v.object({id: v.string(), created: v.number(), modified: v.number()});
}

function commentCursorValidator() {
  return v.object({id: v.string(), created: v.number()});
}

function userCursorValidator() {
  return v.object({id: v.string(), login: v.string()});
}

function projectCursorValidator() {
  return v.object({id: v.string(), lowerCaseName: v.string()});
}

function labelCursorValidator() {
  return v.object({id: v.string(), name: v.string(), projectID: v.string()});
}

function emojiCursorValidator() {
  return v.object({id: v.string(), created: v.number()});
}

function searchEpochResultValidator() {
  return v.object({visibility: visibilityResultValidator(), epoch: v.integer()});
}

function richEmojiResultValidator() {
  return v.object({emoji: emojiResultValidator(), creator: userResultValidator()});
}

function richCommentResultValidator() {
  return v.object({
    comment: commentResultValidator(),
    creator: userResultValidator(),
    emoji: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
    emojiCompleteness: statusValidator(),
  });
}

function listIssueItemValidator() {
  return v.object({
    issue: issueResultValidator(),
    labels: v.array(labelResultValidator(), {maxItems: 1_023}),
    labelsCompleteness: statusValidator(),
    viewState: v.union([v.null(), viewStateResultValidator()]),
  });
}

function preloadIssueItemValidator() {
  return v.object({
    issue: issueResultValidator(),
    labels: v.array(labelResultValidator(), {maxItems: 1_023}),
    labelsCompleteness: statusValidator(),
    viewState: v.array(viewStateResultValidator(), {maxItems: 1}),
    creator: userResultValidator(),
    assignee: v.union([v.null(), userResultValidator()]),
    emoji: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
    emojiCompleteness: statusValidator(),
    comments: v.array(richCommentResultValidator(), {maxItems: 10}),
    commentsCompleteness: statusValidator(),
    commentsCursor: v.union([v.null(), commentCursorValidator()]),
  });
}

function issueDetailValueValidator() {
  return v.object({
    issue: issueResultValidator(),
    project: projectResultValidator(),
    creator: userResultValidator(),
    assignee: v.union([v.null(), userResultValidator()]),
    labels: v.array(labelResultValidator(), {maxItems: 1_023}),
    labelsCompleteness: statusValidator(),
    notificationState: v.union([v.null(), notificationResultValidator()]),
    viewState: v.union([v.null(), viewStateResultValidator()]),
    emoji: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
    emojiCompleteness: statusValidator(),
    comments: v.array(richCommentResultValidator(), {maxItems: 50}),
    commentsCompleteness: statusValidator(),
    commentsCursor: v.union([v.null(), commentCursorValidator()]),
  });
}

function listContextArgsValidator() {
  return v.object({
    open: v.union([v.null(), v.boolean()]),
    projectName: v.optional(v.string()),
    assignee: v.union([v.null(), v.string()]),
    creator: v.union([v.null(), v.string()]),
    labels: v.union([v.null(), v.array(v.string(), {maxItems: 64})]),
    textFilter: v.union([v.null(), v.string()]),
    sortField: v.union([v.literal('modified'), v.literal('created')]),
    sortDirection: v.union([v.literal('asc'), v.literal('desc')]),
  });
}

function pageFact(status, reason, hasMore, cursor, examined, total) {
  return {status, reason, hasMore, cursor, examined, total};
}

function sourceUserResult(user) {
  const row = {
    id: user.id,
    login: user.login,
    avatar: user.avatar,
    role: user.role,
  };
  if (typeof user.name === 'string') row.name = user.name;
  return row;
}

function sourceProjectResult(project) {
  const row = {
    id: project.id,
    name: project.name,
    lowerCaseName: project.lowerCaseName,
    supportsSearch: project.supportsSearch,
  };
  if (typeof project.issueCountEstimate === 'number') {
    row.issueCountEstimate = project.issueCountEstimate;
  }
  if (typeof project.markURL === 'string') row.markURL = project.markURL;
  if (typeof project.logoURL === 'string') row.logoURL = project.logoURL;
  return row;
}

function sourceIssueResult(issue, project, creator, assignee) {
  const row = {
    id: issue.id,
    title: issue.title,
    open: issue.open,
    modified: issue.modified,
    created: issue.created,
    projectID: project.id,
    creatorID: creator.id,
    description: issue.description,
    visibility: issue.visibility,
  };
  if (typeof issue.shortID === 'number') row.shortID = issue.shortID;
  if (assignee) row.assigneeID = assignee.id;
  return row;
}

function sourceLabelResult(label, project) {
  return {id: label.id, name: label.name, projectID: project.id};
}

function sourceViewStateResult(viewState, issue, user) {
  return {issueID: issue.id, userID: user.id, viewed: viewState.viewed};
}

function sourceUserPrefResult(pref, user) {
  return {key: pref.key, userID: user.id, value: pref.value};
}

function sourceNotificationResult(notification, issue, user) {
  return {
    userID: user.id,
    issueID: issue.id,
    subscribed: notification.subscribed,
    created: notification.created,
  };
}

function sourceEmojiResult(emoji, subjectSourceID, creator) {
  return {
    id: emoji.id,
    value: emoji.value,
    annotation: emoji.annotation,
    subjectID: subjectSourceID,
    creatorID: creator.id,
    created: emoji.created,
  };
}

function sourceCommentResult(comment, issue, creator) {
  return {
    id: comment.id,
    issueID: issue.id,
    created: comment.created,
    body: comment.body,
    creatorID: creator.id,
  };
}

async function optionalSourceUser(ctx) {
  if (!ctx.auth || typeof ctx.auth.userId !== 'string' || ctx.auth.userId.length === 0) {
    return null;
  }
  return await requireSourceUser(ctx);
}

async function visibleIssueOrNull(ctx, issue) {
  if (!issue) return null;
  try {
    await assertIssueVisible(ctx, issue);
    return issue;
  } catch (_error) {
    // Missing and invisible are deliberately projected into the same query
    // result. In particular, do not release the Lane 2 guard's internal reason.
    return null;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function directionMultiplier(direction) {
  return direction === 'desc' ? -1 : 1;
}

function compareUserRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const login = compareText(left.login, right.login);
  return (login !== 0 ? login : compareText(left.id, right.id)) * multiplier;
}

function compareProjectRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const name = compareText(left.lowerCaseName, right.lowerCaseName);
  return (name !== 0 ? name : compareText(left.id, right.id)) * multiplier;
}

function compareLabelRows(left, right, direction, includeProject) {
  const multiplier = directionMultiplier(direction);
  if (includeProject) {
    const project = compareText(left.projectID, right.projectID);
    if (project !== 0) return project * multiplier;
  }
  const name = compareText(left.name, right.name);
  return (name !== 0 ? name : compareText(left.id, right.id)) * multiplier;
}

function compareIssueRows(left, right, sortField, direction) {
  const multiplier = directionMultiplier(direction);
  const leftOrdered = sortField === 'created' ? left.created : left.modified;
  const rightOrdered = sortField === 'created' ? right.created : right.modified;
  const leftID = typeof left.sourceIssueID === 'string' ? left.sourceIssueID : left.id;
  const rightID = typeof right.sourceIssueID === 'string' ? right.sourceIssueID : right.id;
  const ordered = leftOrdered < rightOrdered
    ? -1
    : leftOrdered > rightOrdered ? 1 : 0;
  return (ordered !== 0 ? ordered : compareText(leftID, rightID)) * multiplier;
}

function compareCommentRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const created = left.created < right.created ? -1 : left.created > right.created ? 1 : 0;
  return (created !== 0 ? created : compareText(left.id, right.id)) * multiplier;
}

function compareEmojiRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const created = left.created < right.created ? -1 : left.created > right.created ? 1 : 0;
  return (created !== 0 ? created : compareText(left.id, right.id)) * multiplier;
}

function pageAfterStart(rows, start, inclusive, compare) {
  if (!start) return rows;
  return rows.filter(row => {
    const order = compare(row, start);
    return inclusive ? order >= 0 : order > 0;
  });
}

function boundedPage(rows, limit) {
  const items = rows.slice(0, limit);
  return {items, hasMore: rows.length > limit};
}

async function issueBaseGraph(ctx, issue) {
  const [project, creator, assignee] = await Promise.all([
    ctx.db.get('project', issue.projectID),
    ctx.db.get('user', issue.creatorID),
    issue.assigneeID ? ctx.db.get('user', issue.assigneeID) : null,
  ]);
  if (!project || !creator || (issue.assigneeID && !assignee)) {
    throw new Error('issue graph references a missing source row');
  }
  return {
    project,
    creator,
    assignee,
    issue: sourceIssueResult(issue, project, creator, assignee),
  };
}

async function issueLabelsGraph(ctx, issue, project) {
  const memberships = await ctx.db
    .query('issueLabelRead')
    .withIndex('by_project_issue_label')
    .eq('projectID', issue.projectID)
    .eq('issueID', issue._id)
    .take(1_024)
    .collect();
  if (memberships.length === 1_024) {
    return {items: [], status: 'incomplete'};
  }
  const items = [];
  for (const membership of memberships) {
    const label = await ctx.db.get('label', membership.labelID);
    if (!label) throw new Error('issue label read model references a missing label');
    items.push(sourceLabelResult(label, project));
  }
  items.sort((left, right) => compareLabelRows(left, right, 'asc', false));
  return {items, status: 'complete'};
}

async function emojiGraph(ctx, physicalSubjectID, sourceSubjectID) {
  const emojiRows = await ctx.db
    .query('emoji')
    .withIndex('by_subject')
    .eq('subjectID', physicalSubjectID)
    .take(1_024)
    .collect();
  if (emojiRows.length === 1_024) {
    return {items: [], status: 'incomplete'};
  }
  const items = [];
  emojiRows.sort((left, right) => compareEmojiRows(left, right, 'asc'));
  for (const emoji of emojiRows) {
    const creator = await ctx.db.get('user', emoji.creatorID);
    if (!creator) throw new Error('emoji references a missing creator');
    items.push({
      emoji: sourceEmojiResult(emoji, sourceSubjectID, creator),
      creator: sourceUserResult(creator),
    });
  }
  return {items, status: 'complete'};
}

async function richCommentGraph(ctx, comment, issue) {
  const creator = await ctx.db.get('user', comment.creatorID);
  if (!creator) throw new Error('comment references a missing creator');
  const emoji = await emojiGraph(ctx, comment._id, comment.id);
  return {
    comment: sourceCommentResult(comment, issue, creator),
    creator: sourceUserResult(creator),
    emoji: emoji.items,
    emojiCompleteness: emoji.status,
  };
}

async function issueCommentsWindow(ctx, issue, limit, direction) {
  const comments = await ctx.db
    .query('comment')
    .withIndex('by_issue_created')
    .eq('issueID', issue._id)
    .take(1_024)
    .collect();
  if (comments.length === 1_024) {
    return {items: [], status: 'incomplete', cursor: null};
  }
  comments.sort((left, right) => compareCommentRows(left, right, direction));
  const page = boundedPage(comments, limit);
  const items = [];
  for (const comment of page.items) items.push(await richCommentGraph(ctx, comment, issue));
  const last = page.items.at(-1);
  return {
    items,
    status: page.hasMore ? 'incomplete' : 'complete',
    cursor: page.hasMore && last ? {id: last.id, created: last.created} : null,
  };
}

async function principalViewState(ctx, issue, viewer) {
  if (!viewer) return null;
  // The viewer came only from requireSourceUser; there is no caller identity
  // selector on this helper or any query that uses it.
  const row = await ctx.db
    .query('viewState')
    .withIndex('by_user_issue')
    .eq('userID', viewer._id)
    .eq('issueID', issue._id)
    .first();
  return row ? sourceViewStateResult(row, issue, viewer) : null;
}

async function principalNotificationState(ctx, issue, viewer) {
  if (!viewer) return null;
  const row = await ctx.db
    .query('issueNotifications')
    .withIndex('by_user_issue')
    .eq('userID', viewer._id)
    .eq('issueID', issue._id)
    .first();
  return row ? sourceNotificationResult(row, issue, viewer) : null;
}

function issueIndexName(listContext, creator, assignee) {
  const sort = listContext.sortField === 'created' ? 'created' : 'modified';
  if (creator) {
    return listContext.open === null
      ? `by_project_creator_${sort}`
      : `by_project_open_creator_${sort}`;
  }
  if (assignee) {
    return listContext.open === null
      ? `by_project_assignee_${sort}`
      : `by_project_open_assignee_${sort}`;
  }
  return listContext.open === null
    ? `by_project_${sort}`
    : `by_project_open_${sort}`;
}

async function resolveProject(ctx, projectName) {
  return await ctx.db
    .query('project')
    .withIndex('by_lower_case_name')
    .eq('lowerCaseName', projectName.toLowerCase())
    .first();
}

async function resolveUserByLogin(ctx, login) {
  if (login === null) return null;
  return await ctx.db
    .query('user')
    .withIndex('by_login')
    .eq('login', login)
    .first();
}

async function selectedLabelMembership(ctx, project, labelNames) {
  if (labelNames === null || labelNames.length === 0) {
    return {sets: [], refused: false, impossible: false};
  }
  const uniqueNames = [];
  for (const name of labelNames) if (!uniqueNames.includes(name)) uniqueNames.push(name);
  const sets = [];
  for (const name of uniqueNames) {
    const label = await ctx.db
      .query('label')
      .withIndex('by_project_name')
      .eq('projectID', project._id)
      .eq('name', name)
      .first();
    if (!label) return {sets: [], refused: false, impossible: true};
    const memberships = await ctx.db
      .query('issueLabelRead')
      .withIndex('by_project_label_issue')
      .eq('projectID', project._id)
      .eq('labelID', label._id)
      .take(1_024)
      .collect();
    if (memberships.length === 1_024) {
      return {sets: [], refused: true, impossible: false};
    }
    sets.push(new Set(memberships.map(row => row.issueID)));
  }
  return {sets, refused: false, impossible: false};
}

async function searchMembership(ctx, project, viewer, textFilter) {
  const epochs = [];
  const visibilityClasses = viewer && viewer.role === 'crew'
    ? ['public', 'internal']
    : ['public'];
  for (const visibility of visibilityClasses) {
    const epoch = await ctx.db
      .query('searchEpoch')
      .withIndex('by_project_visibility')
      .eq('projectID', project._id)
      .eq('visibility', visibility)
      .first();
    if (!epoch) return {ids: null, epochs, refused: true};
    epochs.push({visibility, epoch: epoch.epoch});
  }
  if (textFilter === null) return {ids: null, epochs, refused: false};

  // W-SEARCH-EPOCH deviation: role-partitioned search cannot currently be
  // composed into an opaque handler or generated route group. Scan only the
  // maintained search-document partitions under a strict proof ceiling; a
  // boundary hit refuses the result instead of releasing a truncated match
  // set. PLAN.md records why an exported public search plan would leak the
  // internal partition.
  const needle = textFilter.toLowerCase();
  const ids = new Set();
  for (const visibility of visibilityClasses) {
    const documents = await ctx.db
      .query('issueSearchDocument')
      .withIndex('by_project_visibility_issue')
      .eq('projectID', project._id)
      .eq('visibility', visibility)
      .take(1_024)
      .collect();
    if (documents.length === 1_024) return {ids: null, epochs, refused: true};
    for (const document of documents) {
      if (
        document.title.toLowerCase().includes(needle)
        || document.description.toLowerCase().includes(needle)
        || document.commentText.toLowerCase().includes(needle)
      ) {
        ids.add(document.issueID);
      }
    }
  }
  return {ids, epochs, refused: false};
}

async function runIssueListEngine(ctx, options) {
  const listContext = options.listContext;
  const viewer = await optionalSourceUser(ctx);
  const project = await resolveProject(ctx, listContext.projectName || 'Zero');
  if (!project) {
    return {
      status: options.point ? 'not-found-authoritative' : 'complete',
      reason: options.point ? 'missing-or-outside-list-context' : null,
      hasMore: false,
      cursor: null,
      examined: 0,
      total: 0,
      searchEpoch: [],
      entries: [],
    };
  }

  const creator = await resolveUserByLogin(ctx, listContext.creator);
  const assignee = await resolveUserByLogin(ctx, listContext.assignee);
  if ((listContext.creator !== null && !creator) || (listContext.assignee !== null && !assignee)) {
    return {
      status: options.point ? 'not-found-authoritative' : 'complete',
      reason: options.point ? 'missing-or-outside-list-context' : null,
      hasMore: false,
      cursor: null,
      examined: 0,
      total: 0,
      searchEpoch: [],
      entries: [],
    };
  }

  let roots;
  if (options.targetSourceID) {
    const target = await ctx.db
      .query('issueListRead')
      .withIndex('by_source_issue_id')
      .eq('sourceIssueID', options.targetSourceID)
      .first();
    roots = target ? [target] : [];
  } else {
    let query = ctx.db
      .query('issueListRead')
      .withIndex(issueIndexName(listContext, creator, assignee))
      .eq('projectID', project._id);
    if (listContext.open !== null) query = query.eq('open', listContext.open);
    if (creator) query = query.eq('creatorID', creator._id);
    else if (assignee) query = query.eq('assigneeID', assignee._id);
    roots = await query.take(1_024).collect();
    if (roots.length === 1_024) {
      return {
        status: 'incomplete',
        reason: 'issue-read-model-bound',
        hasMore: true,
        cursor: null,
        // The bounded refusal is public, but the sampled root count may mix
        // public and protected rows. Do not turn it into a visibility oracle.
        examined: 0,
        total: 0,
        searchEpoch: [],
        entries: [],
      };
    }
  }

  const authorizedRoots = roots.filter(row => (
    row.visibility === 'public' || (viewer && viewer.role === 'crew')
  ));

  const labels = await selectedLabelMembership(ctx, project, listContext.labels);
  if (labels.refused) {
    return {
      status: 'incomplete',
      reason: 'label-membership-bound',
      hasMore: true,
      cursor: null,
      examined: authorizedRoots.length,
      total: 0,
      searchEpoch: [],
      entries: [],
    };
  }
  const search = await searchMembership(ctx, project, viewer, listContext.textFilter);
  if (search.refused) {
    return {
      status: 'refreshing',
      reason: 'search-document-bound-or-epoch-missing',
      hasMore: true,
      cursor: null,
      examined: authorizedRoots.length,
      total: 0,
      searchEpoch: search.epochs,
      entries: [],
    };
  }

  let filtered = authorizedRoots.filter(row => (
    row.projectID === project._id
    && (listContext.open === null || row.open === listContext.open)
    && (!creator || row.creatorID === creator._id)
    && (!assignee || row.assigneeID === assignee._id)
    && !labels.impossible
    && labels.sets.every(set => set.has(row.issueID))
    && (search.ids === null || search.ids.has(row.issueID))
  ));

  const queryDirection = options.direction === 'backward'
    ? (listContext.sortDirection === 'asc' ? 'desc' : 'asc')
    : listContext.sortDirection;
  filtered.sort((left, right) => compareIssueRows(
    left,
    right,
    listContext.sortField,
    queryDirection,
  ));
  filtered = pageAfterStart(
    filtered,
    options.start,
    options.inclusive,
    (row, start) => compareIssueRows(row, start, listContext.sortField, queryDirection),
  );

  const total = filtered.length;
  const page = boundedPage(filtered, options.limit);
  const entries = [];
  let childIncomplete = false;
  for (const readRow of page.items) {
    const issue = await ctx.db.get('issue', readRow.issueID);
    if (!issue || issue.id !== readRow.sourceIssueID) {
      throw new Error('issue list read model references a missing or mismatched issue');
    }
    const base = await issueBaseGraph(ctx, issue);
    const issueLabels = await issueLabelsGraph(ctx, issue, base.project);
    const viewState = await principalViewState(ctx, issue, viewer);
    if (issueLabels.status !== 'complete') childIncomplete = true;
    entries.push({
      physicalIssue: issue,
      project: base.project,
      creator: base.creator,
      assignee: base.assignee,
      item: {
        issue: base.issue,
        labels: issueLabels.items,
        labelsCompleteness: issueLabels.status,
        viewState,
      },
    });
  }

  const last = page.items.at(-1);
  const cursor = page.hasMore && last
    ? {id: last.sourceIssueID, created: last.created, modified: last.modified}
    : null;
  let status = page.hasMore || childIncomplete ? 'incomplete' : 'complete';
  let reason = page.hasMore ? 'page-limit' : childIncomplete ? 'child-bound' : null;
  if (options.point && entries.length === 0) {
    status = 'not-found-authoritative';
    reason = 'missing-or-outside-list-context';
  }
  return {
    status,
    reason,
    hasMore: page.hasMore,
    cursor,
    examined: authorizedRoots.length,
    total,
    searchEpoch: search.epochs,
    entries,
  };
}

function listEngineResult(engine) {
  return {
    ...pageFact(
      engine.status,
      engine.reason,
      engine.hasMore,
      engine.cursor,
      engine.examined,
      engine.total,
    ),
    searchEpoch: engine.searchEpoch,
    items: engine.entries.map(entry => entry.item),
  };
}

async function findIssueByField(ctx, idField, idValue) {
  if (idField === 'shortID') {
    return typeof idValue === 'number'
      ? await ctx.db
        .query('issue')
        .withIndex('by_short_id')
        .eq('shortID', idValue)
        .first()
      : null;
  }
  return typeof idValue === 'string'
    ? await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', idValue)
      .first()
    : null;
}

// @ref LLP 0183#design-principles — every Lane 3 collection releases an
// explicit completeness fact; an exact 1,024-row proof ceiling returns no
// plausible prefix.
export const allLabels = defineJsLiveQuery({
  auth: 'public',
  args: {
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), labelCursorValidator()]),
  },
  reads: ['label', 'project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), labelCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(labelResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('label').take(1_024).collect();
    if (rows.length === 1_024) {
      return [{...pageFact('incomplete', 'label-bound', true, null, 1_024, 0), items: []}];
    }
    const items = [];
    for (const row of rows) {
      const project = await ctx.db.get('project', row.projectID);
      if (!project) throw new Error('label references a missing project');
      items.push(sourceLabelResult(row, project));
    }
    items.sort((left, right) => compareLabelRows(left, right, 'asc', true));
    const remaining = pageAfterStart(
      items,
      args.start,
      false,
      (left, right) => compareLabelRows(left, right, 'asc', true),
    );
    const page = boundedPage(remaining, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last
      ? {id: last.id, name: last.name, projectID: last.projectID}
      : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, remaining.length),
      items: page.items,
    }];
  },
});

export const allUsers = defineJsLiveQuery({
  auth: 'public',
  args: {
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), userCursorValidator()]),
  },
  reads: ['user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), userCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(userResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('user').withIndex('by_login').take(1_024).collect();
    if (rows.length === 1_024) {
      return [{...pageFact('incomplete', 'user-bound', true, null, 1_024, 0), items: []}];
    }
    let items = rows.map(sourceUserResult);
    items.sort((left, right) => compareUserRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareUserRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, login: last.login} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, items.length),
      items: page.items,
    }];
  },
});

export const allProjects = defineJsLiveQuery({
  auth: 'public',
  args: {
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), projectCursorValidator()]),
  },
  reads: ['project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), projectCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(projectResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('project')
      .withIndex('by_lower_case_name')
      .take(1_024)
      .collect();
    if (rows.length === 1_024) {
      return [{...pageFact('incomplete', 'project-bound', true, null, 1_024, 0), items: []}];
    }
    let items = rows.map(sourceProjectResult);
    items.sort((left, right) => compareProjectRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareProjectRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last
      ? {id: last.id, lowerCaseName: last.lowerCaseName}
      : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, items.length),
      items: page.items,
    }];
  },
});

export const user = defineJsLiveQuery({
  auth: 'public',
  args: {userID: v.string()},
  reads: ['user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), userResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('user')
      .withIndex('by_source_id')
      .eq('id', args.userID)
      .first();
    return row
      ? [{status: 'complete', reason: null, value: sourceUserResult(row)}]
      : [{status: 'not-found-authoritative', reason: 'missing-user', value: null}];
  },
});

export const crewUser = defineJsLiveQuery({
  auth: 'public',
  args: {userID: v.string()},
  reads: ['user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), userResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('user')
      .withIndex('by_source_id')
      .eq('id', args.userID)
      .first();
    return row && row.role === 'crew'
      ? [{status: 'complete', reason: null, value: sourceUserResult(row)}]
      : [{status: 'not-found-authoritative', reason: 'missing-or-not-crew', value: null}];
  },
});

async function labelsQueryHandler(ctx, args, direction) {
  const project = await resolveProject(ctx, args.projectName);
  if (!project) {
    return [{
      ...pageFact('not-found-authoritative', 'missing-project', false, null, 0, 0),
      items: [],
    }];
  }
  const rows = await ctx.db
    .query('label')
    .withIndex('by_project_name')
    .eq('projectID', project._id)
    .take(1_024)
    .collect();
  if (rows.length === 1_024) {
    return [{...pageFact('incomplete', 'label-bound', true, null, 1_024, 0), items: []}];
  }
  let items = rows.map(row => sourceLabelResult(row, project));
  items.sort((left, right) => compareLabelRows(left, right, direction, false));
  items = pageAfterStart(
    items,
    args.start,
    false,
    (left, right) => compareLabelRows(left, right, direction, false),
  );
  const page = boundedPage(items, args.limit);
  const last = page.items.at(-1);
  const cursor = page.hasMore && last
    ? {id: last.id, name: last.name, projectID: last.projectID}
    : null;
  return [{
    ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, items.length),
    items: page.items,
  }];
}

export const labels = defineJsLiveQuery({
  auth: 'public',
  args: {
    projectName: v.string(),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), labelCursorValidator()]),
  },
  reads: ['label', 'project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), labelCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(labelResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await labelsQueryHandler(ctx, args, 'asc'),
});

export const labelsOrderByName = defineJsLiveQuery({
  auth: 'public',
  args: {
    projectName: v.string(),
    orderBy: v.union([v.literal('asc'), v.literal('desc')]),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), labelCursorValidator()]),
  },
  reads: ['label', 'project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), labelCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(labelResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await labelsQueryHandler(ctx, args, args.orderBy),
});

export const issuePreloadV2 = defineJsLiveQuery({
  auth: 'public',
  args: {projectName: v.string()},
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'viewState',
    'comment',
    'emoji',
    'searchEpoch',
  ],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), issueCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    searchEpoch: v.array(searchEpochResultValidator(), {maxItems: 2}),
    items: v.array(preloadIssueItemValidator(), {maxItems: 1_000}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const engine = await runIssueListEngine(ctx, {
      listContext: {
        open: null,
        projectName: args.projectName,
        assignee: null,
        creator: null,
        labels: null,
        textFilter: null,
        sortField: 'modified',
        sortDirection: 'desc',
      },
      point: false,
      targetSourceID: null,
      limit: 1_000,
      start: null,
      direction: 'forward',
      inclusive: false,
    });
    const items = [];
    let childIncomplete = false;
    for (const entry of engine.entries) {
      const issueEmoji = await emojiGraph(
        ctx,
        entry.physicalIssue._id,
        entry.physicalIssue.id,
      );
      const comments = await issueCommentsWindow(ctx, entry.physicalIssue, 10, 'desc');
      if (
        entry.item.labelsCompleteness !== 'complete'
        || issueEmoji.status !== 'complete'
        || comments.status !== 'complete'
      ) childIncomplete = true;
      items.push({
        issue: entry.item.issue,
        labels: entry.item.labels,
        labelsCompleteness: entry.item.labelsCompleteness,
        viewState: entry.item.viewState ? [entry.item.viewState] : [],
        creator: sourceUserResult(entry.creator),
        assignee: entry.assignee ? sourceUserResult(entry.assignee) : null,
        emoji: issueEmoji.items,
        emojiCompleteness: issueEmoji.status,
        comments: comments.items,
        commentsCompleteness: comments.status,
        commentsCursor: comments.cursor,
      });
    }
    const status = engine.status === 'complete' && childIncomplete
      ? 'incomplete'
      : engine.status;
    const reason = engine.reason || (childIncomplete ? 'child-bound-or-window' : null);
    return [{
      ...pageFact(status, reason, engine.hasMore, engine.cursor, engine.examined, engine.total),
      searchEpoch: engine.searchEpoch,
      items,
    }];
  },
});

export const userPref = defineJsLiveQuery({
  auth: 'authenticated',
  args: {key: v.string()},
  reads: ['identityBinding', 'user', 'userPref'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), userPrefResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const viewer = await requireSourceUser(ctx);
    const pref = await ctx.db
      .query('userPref')
      .withIndex('by_key_user')
      .eq('key', args.key)
      .eq('userID', viewer._id)
      .first();
    return pref
      ? [{status: 'complete', reason: null, value: sourceUserPrefResult(pref, viewer)}]
      : [{status: 'not-found-authoritative', reason: 'missing-principal-preference', value: null}];
  },
});

export const usersForProject = defineJsLiveQuery({
  auth: 'public',
  args: {
    disabled: v.boolean(),
    login: v.union([v.null(), v.string()]),
    projectName: v.string(),
    filter: v.union([
      v.null(),
      v.literal('crew'),
      v.literal('creators'),
      v.literal('assignees'),
    ]),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), userCursorValidator()]),
  },
  reads: ['project', 'projectUserRead', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), userCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(userResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    let users = [];
    let examined = 0;
    if (args.disabled && args.login !== null) {
      const row = await resolveUserByLogin(ctx, args.login);
      if (row) users = [row];
      examined = row ? 1 : 0;
    } else if (args.filter === null) {
      const rows = await ctx.db.query('user').withIndex('by_login').take(1_024).collect();
      if (rows.length === 1_024) {
        return [{...pageFact('incomplete', 'user-bound', true, null, 1_024, 0), items: []}];
      }
      users = rows;
      examined = rows.length;
    } else {
      const project = await resolveProject(ctx, args.projectName);
      if (project) {
        const flag = args.filter === 'crew'
          ? 'isCrew'
          : args.filter === 'creators' ? 'isCreator' : 'isAssignee';
        const index = args.filter === 'crew'
          ? 'by_project_crew'
          : args.filter === 'creators' ? 'by_project_creator' : 'by_project_assignee';
        const memberships = await ctx.db
          .query('projectUserRead')
          .withIndex(index)
          .eq('projectID', project._id)
          .eq(flag, true)
          .take(1_024)
          .collect();
        if (memberships.length === 1_024) {
          return [{...pageFact('incomplete', 'project-user-bound', true, null, 1_024, 0), items: []}];
        }
        examined = memberships.length;
        for (const membership of memberships) {
          const row = await ctx.db.get('user', membership.userID);
          if (!row) throw new Error('project user read model references a missing user');
          if (args.filter !== 'crew' || !row.login.startsWith('rocibot')) users.push(row);
        }
      }
    }
    let items = users.map(sourceUserResult);
    items.sort((left, right) => compareUserRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareUserRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, login: last.login} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, examined, items.length),
      items: page.items,
    }];
  },
});

// @ref LLP 0183#d2--bounded-relational-graph-profile — protected child roots
// release no row, existence, order, or completeness fact before parent proof.
export const commentsPage = defineJsLiveQuery({
  auth: 'public',
  args: {
    issueID: v.string(),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), commentCursorValidator()]),
    dir: v.union([v.literal('forward'), v.literal('backward')]),
    inclusive: v.boolean(),
  },
  reads: ['identityBinding', 'issue', 'comment', 'emoji', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), commentCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(richCommentResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const unresolved = await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', args.issueID)
      .first();
    const issue = await visibleIssueOrNull(ctx, unresolved);
    if (!issue) {
      return [{
        ...pageFact('not-found-authoritative', 'missing-or-invisible-parent', false, null, 0, 0),
        items: [],
      }];
    }
    const comments = await ctx.db
      .query('comment')
      .withIndex('by_issue_created')
      .eq('issueID', issue._id)
      .take(1_024)
      .collect();
    if (comments.length === 1_024) {
      return [{...pageFact('incomplete', 'comment-bound', true, null, 1_024, 0), items: []}];
    }
    const direction = args.dir === 'backward' ? 'desc' : 'asc';
    comments.sort((left, right) => compareCommentRows(left, right, direction));
    const remaining = pageAfterStart(
      comments,
      args.start,
      args.inclusive,
      (left, right) => compareCommentRows(left, right, direction),
    );
    const page = boundedPage(remaining, args.limit);
    const items = [];
    let childIncomplete = false;
    for (const row of page.items) {
      const rich = await richCommentGraph(ctx, row, issue);
      if (rich.emojiCompleteness !== 'complete') childIncomplete = true;
      items.push(rich);
    }
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, created: last.created} : null;
    const incomplete = page.hasMore || childIncomplete;
    return [{
      ...pageFact(
        incomplete ? 'incomplete' : 'complete',
        page.hasMore ? 'page-limit' : childIncomplete ? 'emoji-bound' : null,
        page.hasMore,
        cursor,
        comments.length,
        remaining.length,
      ),
      items,
    }];
  },
});

export const comment = defineJsLiveQuery({
  auth: 'public',
  args: {id: v.string()},
  reads: ['identityBinding', 'issue', 'comment', 'emoji', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), richCommentResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('comment')
      .withIndex('by_source_id')
      .eq('id', args.id)
      .first();
    const unresolved = row ? await ctx.db.get('issue', row.issueID) : null;
    const issue = await visibleIssueOrNull(ctx, unresolved);
    if (!row || !issue) {
      return [{status: 'not-found-authoritative', reason: 'missing-or-invisible-comment', value: null}];
    }
    const value = await richCommentGraph(ctx, row, issue);
    return [{
      status: value.emojiCompleteness === 'complete' ? 'complete' : 'incomplete',
      reason: value.emojiCompleteness === 'complete' ? null : 'emoji-bound',
      value,
    }];
  },
});

async function issueDetailQueryHandler(ctx, idField, id) {
  const unresolved = await findIssueByField(ctx, idField, id);
  const issue = await visibleIssueOrNull(ctx, unresolved);
  if (!issue) {
    return [{status: 'not-found-authoritative', reason: 'missing-or-invisible-issue', value: null}];
  }
  const viewer = await optionalSourceUser(ctx);
  const base = await issueBaseGraph(ctx, issue);
  const [labelsGraph, issueEmoji, comments, viewState, notificationState] = await Promise.all([
    issueLabelsGraph(ctx, issue, base.project),
    emojiGraph(ctx, issue._id, issue.id),
    issueCommentsWindow(ctx, issue, 50, 'desc'),
    principalViewState(ctx, issue, viewer),
    principalNotificationState(ctx, issue, viewer),
  ]);
  const incomplete = labelsGraph.status !== 'complete'
    || issueEmoji.status !== 'complete'
    || comments.status !== 'complete';
  return [{
    status: incomplete ? 'incomplete' : 'complete',
    reason: incomplete ? 'bounded-child-window' : null,
    value: {
      issue: base.issue,
      project: sourceProjectResult(base.project),
      creator: sourceUserResult(base.creator),
      assignee: base.assignee ? sourceUserResult(base.assignee) : null,
      labels: labelsGraph.items,
      labelsCompleteness: labelsGraph.status,
      notificationState,
      viewState,
      emoji: issueEmoji.items,
      emojiCompleteness: issueEmoji.status,
      comments: comments.items,
      commentsCompleteness: comments.status,
      commentsCursor: comments.cursor,
    },
  }];
}

export const issueDetail = defineJsLiveQuery({
  auth: 'public',
  args: {
    idField: v.union([v.literal('shortID'), v.literal('id')]),
    id: v.union([v.string(), v.integer()]),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueLabelRead',
    'label',
    'viewState',
    'issueNotifications',
    'emoji',
    'comment',
  ],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), issueDetailValueValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await issueDetailQueryHandler(ctx, args.idField, args.id),
});

// Route-only typed wrapper: route parameters can target primitive string args,
// while the frozen issueDetail query keeps its id|string/number union.
export const issueDetailBySourceID = defineJsLiveQuery({
  auth: 'public',
  args: {id: v.string()},
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueLabelRead',
    'label',
    'viewState',
    'issueNotifications',
    'emoji',
    'comment',
  ],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), issueDetailValueValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await issueDetailQueryHandler(ctx, 'id', args.id),
});

function issueListResultValidator() {
  return v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), issueCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    searchEpoch: v.array(searchEpochResultValidator(), {maxItems: 2}),
    items: v.array(listIssueItemValidator(), {maxItems: 1_023}),
  });
}

export const issueListV2 = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: listContextArgsValidator(),
    limit: v.union([v.null(), v.integer({min: 1, max: 1_023})]),
    start: v.union([v.null(), issueCursorValidator()]),
    dir: v.union([v.literal('forward'), v.literal('backward')]),
    inclusive: v.optional(v.boolean()),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    if (args.limit === null) {
      return [{
        ...pageFact('incomplete', 'positive-limit-required', true, null, 0, 0),
        searchEpoch: [],
        items: [],
      }];
    }
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: false,
      targetSourceID: null,
      limit: args.limit,
      start: args.start,
      direction: args.dir,
      inclusive: args.inclusive === true,
    });
    return [listEngineResult(engine)];
  },
});

export const listIssueByID = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: listContextArgsValidator(),
    idField: v.union([v.literal('shortID'), v.literal('id')]),
    idValue: v.union([v.string(), v.integer()]),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const issue = await findIssueByField(ctx, args.idField, args.idValue);
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: true,
      targetSourceID: issue ? issue.id : '__zerobugs_missing_issue__',
      limit: 1,
      start: null,
      direction: 'forward',
      inclusive: false,
    });
    return [listEngineResult(engine)];
  },
});

export const emojiChange = defineJsLiveQuery({
  auth: 'public',
  args: {
    subjectID: v.string(),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), emojiCursorValidator()]),
  },
  reads: ['identityBinding', 'issue', 'comment', 'emoji', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    subjectKind: v.union([v.null(), v.literal('issue'), v.literal('comment')]),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), emojiCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    let subjectKind = null;
    let physicalSubjectID = null;
    const issueSubject = await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', args.subjectID)
      .first();
    if (issueSubject) {
      const issue = await visibleIssueOrNull(ctx, issueSubject);
      if (!issue) {
        return [{
          ...pageFact('not-found-authoritative', 'missing-or-invisible-subject', false, null, 0, 0),
          subjectKind: null,
          items: [],
        }];
      }
      subjectKind = 'issue';
      physicalSubjectID = issue._id;
    } else {
      const commentSubject = await ctx.db
        .query('comment')
        .withIndex('by_source_id')
        .eq('id', args.subjectID)
        .first();
      const unresolvedParent = commentSubject
        ? await ctx.db.get('issue', commentSubject.issueID)
        : null;
      const parent = await visibleIssueOrNull(ctx, unresolvedParent);
      if (!commentSubject || !parent) {
        return [{
          ...pageFact('not-found-authoritative', 'missing-or-invisible-subject', false, null, 0, 0),
          subjectKind: null,
          items: [],
        }];
      }
      subjectKind = 'comment';
      physicalSubjectID = commentSubject._id;
    }

    const rows = await ctx.db
      .query('emoji')
      .withIndex('by_subject')
      .eq('subjectID', physicalSubjectID)
      .take(1_024)
      .collect();
    if (rows.length === 1_024) {
      return [{
        ...pageFact('incomplete', 'emoji-bound', true, null, 1_024, 0),
        subjectKind,
        items: [],
      }];
    }
    rows.sort((left, right) => compareEmojiRows(left, right, 'asc'));
    const remaining = pageAfterStart(
      rows,
      args.start,
      false,
      (left, right) => compareEmojiRows(left, right, 'asc'),
    );
    const page = boundedPage(remaining, args.limit);
    const items = [];
    for (const row of page.items) {
      const creator = await ctx.db.get('user', row.creatorID);
      if (!creator) throw new Error('emoji references a missing creator');
      items.push({
        emoji: sourceEmojiResult(row, args.subjectID, creator),
        creator: sourceUserResult(creator),
      });
    }
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, created: last.created} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, remaining.length),
      subjectKind,
      items,
    }];
  },
});

export const prevNext = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: v.union([v.null(), listContextArgsValidator()]),
    issue: v.union([v.null(), issueCursorValidator()]),
    dir: v.union([v.literal('next'), v.literal('prev')]),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    if (args.listContext === null) {
      return [{
        ...pageFact('not-found-authoritative', 'missing-list-context', false, null, 0, 0),
        searchEpoch: [],
        items: [],
      }];
    }
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: true,
      targetSourceID: null,
      limit: 1,
      start: args.issue,
      direction: args.dir === 'prev' ? 'backward' : 'forward',
      inclusive: false,
    });
    return [listEngineResult(engine)];
  },
});

export const issueList = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: listContextArgsValidator(),
    limit: v.integer({min: 1, max: 1_023}),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: false,
      targetSourceID: null,
      limit: args.limit,
      start: null,
      direction: 'forward',
      inclusive: false,
    });
    return [listEngineResult(engine)];
  },
});

export const userPicker = defineJsLiveQuery({
  auth: 'public',
  args: {
    disabled: v.boolean(),
    login: v.union([v.null(), v.string()]),
    filter: v.union([v.null(), v.literal('crew'), v.literal('creators')]),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), userCursorValidator()]),
  },
  reads: ['user', 'projectUserRead'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), userCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(userResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    let users = [];
    let examined = 0;
    if (args.disabled && args.login !== null) {
      const row = await resolveUserByLogin(ctx, args.login);
      if (row) users = [row];
      examined = row ? 1 : 0;
    } else if (args.filter === 'creators') {
      const memberships = await ctx.db.query('projectUserRead').take(1_024).collect();
      if (memberships.length === 1_024) {
        return [{...pageFact('incomplete', 'project-user-bound', true, null, 1_024, 0), items: []}];
      }
      const userIDs = new Set(
        memberships.filter(row => row.isCreator).map(row => row.userID),
      );
      examined = memberships.length;
      for (const userID of userIDs) {
        const row = await ctx.db.get('user', userID);
        if (!row) throw new Error('project user read model references a missing user');
        users.push(row);
      }
    } else {
      const rows = await ctx.db.query('user').withIndex('by_login').take(1_024).collect();
      if (rows.length === 1_024) {
        return [{...pageFact('incomplete', 'user-bound', true, null, 1_024, 0), items: []}];
      }
      examined = rows.length;
      users = args.filter === 'crew'
        ? rows.filter(row => row.role === 'crew' && !row.login.startsWith('rocibot'))
        : rows;
    }
    let items = users.map(sourceUserResult);
    items.sort((left, right) => compareUserRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareUserRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, login: last.login} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, examined, items.length),
      items: page.items,
    }];
  },
});

// ---------------------------------------------------------------------------
// Lane 5 declared companion composition
// ---------------------------------------------------------------------------

export const zerobugsCompositionConfig = defineConfig({
  loopsApiKey: {
    description: 'Loops transactional API key',
    purpose: 'Authorizes Loops-shaped notification delivery',
    required: true,
  },
  discordWebhookToken: {
    description: 'Discord webhook credential',
    purpose: 'Authorizes Discord-shaped notification delivery',
    required: true,
  },
  captureAdapterAuth: {
    description: 'Local deterministic capture-adapter credential',
    purpose: 'Restricts the Lane 5 local-only effect capture endpoints',
    required: true,
  },
});

export const gatewayIdentitySelf = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  result: results.records(v.object({
    principal: v.string(),
    sourceUserID: v.string(),
    githubID: v.integer(),
    login: v.string(),
    role: v.string(),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx) => {
    const actor = await requireSourceUser(ctx);
    return [{
      principal: ctx.auth.userId,
      sourceUserID: actor.id,
      githubID: actor.githubID,
      login: actor.login,
      role: actor.role,
    }];
  },
});

// One atomic mutation consumes the capability and reuses the exact Lane 4
// subscription helper. A crash cannot strand a consumed token before the
// set-false write, and a replay cannot author a second write.
export const acceptanceConsumeUnsubscribeToken = defineJsMutation({
  auth: 'authenticated',
  args: {
    tokenDigest: v.string(),
    sourceUserID: v.string(),
    issueID: v.string(),
    usedAt: v.number(),
  },
  reads: [
    'identityBinding', 'issue', 'issueNotifications', 'unsubscribeTokenUse', 'user',
  ],
  writes: ['issueNotifications', 'unsubscribeTokenUse'],
  result: results.value(v.json()),
  handler: async (ctx, args) => {
    if (!/^[0-9a-f]{64}$/.test(args.tokenDigest)) {
      throw new Error('unsubscribe capability was refused');
    }
    const actor = await requireSourceUser(ctx);
    if (actor.id !== args.sourceUserID) {
      throw new Error('unsubscribe capability was refused');
    }
    const existingUse = await ctx.db
      .query('unsubscribeTokenUse')
      .withIndex('by_token_digest')
      .eq('tokenDigest', args.tokenDigest)
      .first();
    if (existingUse) throw new Error('unsubscribe capability was refused');
    const issue = await sourceRowByID(ctx, 'issue', args.issueID);
    await requireMutationVisibleIssue(ctx, issue);
    const tokenUseID = await ctx.db.insert('unsubscribeTokenUse', {
      tokenDigest: args.tokenDigest,
      userID: actor._id,
      issueID: issue._id,
      usedAt: args.usedAt,
    });
    const receipt = await updateNotificationSubscription(
      ctx,
      actor,
      issue,
      'unsubscribe',
      args.usedAt,
    );
    return {tokenUseID, receipt};
  },
});

export const zerobugsImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['identityBinding', 'user'],
  accept: {
    mediaTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ],
    maxBytes: 10 * 1024 * 1024,
  },
  delivery: {kind: 'public-immutable'},
  access: {read: 'via-references'},
  image: {location: 'retain'},
  authorize: async (ctx) => {
    await requireSourceUser(ctx);
    return {owner: ctx.auth.userId};
  },
});

// Native trusted MIME detection deliberately classifies active SVG as opaque.
// The gateway admits this intent only after its own exact SVG signature/type/
// length policy and serves the typed alias with the source MIME.
export const zerobugsSvgUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['identityBinding', 'user'],
  accept: {mediaTypes: ['application/octet-stream'], maxBytes: 10 * 1024 * 1024},
  delivery: {kind: 'public-immutable'},
  access: {read: 'via-references'},
  authorize: async (ctx) => {
    await requireSourceUser(ctx);
    return {owner: ctx.auth.userId};
  },
});

function acceptedAssetContentType(contentType) {
  return [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  ].includes(contentType);
}

export const acceptanceAttachAsset = defineJsMutation({
  auth: 'authenticated',
  args: {
    key: v.string(),
    assetID: v.string(),
    contentType: v.string(),
    uploadKind: v.string(),
    size: v.integer(),
    created: v.number(),
  },
  reads: ['assetAttachment', 'identityBinding', 'user'],
  writes: ['assetAttachment'],
  result: results.value(v.json()),
  handler: async (ctx, args) => {
    const actor = await requireSourceUser(ctx);
    if (!/^zba_[A-Za-z0-9_-]{24,96}$/.test(args.key)) {
      throw new Error('asset key was refused');
    }
    if (!acceptedAssetContentType(args.contentType)) {
      throw new Error('asset content type was refused');
    }
    if (
      (args.contentType === 'image/svg+xml' && args.uploadKind !== 'svg-opaque')
      || (args.contentType !== 'image/svg+xml' && args.uploadKind !== 'image')
    ) throw new Error('asset upload intent was refused');
    if (!Number.isSafeInteger(args.size) || args.size < 1 || args.size > 10 * 1024 * 1024) {
      throw new Error('asset size was refused');
    }
    const existing = await ctx.db
      .query('assetAttachment')
      .withIndex('by_key')
      .eq('key', args.key)
      .first();
    if (existing) {
      if (existing.owner !== ctx.auth.userId) throw new Error('asset key was refused');
      return {
        attachmentID: existing._id,
        assetID: existing.asset,
        key: existing.key,
        deduplicated: true,
      };
    }
    const asset = args.uploadKind === 'svg-opaque'
      ? await ctx.assets.attach(args.assetID, {upload: 'zerobugsSvgUpload'})
      : await ctx.assets.attach(args.assetID, {upload: 'zerobugsImageUpload'});
    const attachmentID = await ctx.db.insert('assetAttachment', {
      key: args.key,
      owner: ctx.auth.userId,
      asset,
      contentType: args.contentType,
      size: args.size,
      created: args.created,
    });
    return {attachmentID, assetID: asset, key: args.key, deduplicated: false, actorID: actor.id};
  },
});

export const gatewayAssetByKey = defineJsQuery({
  auth: 'public',
  args: {key: v.string()},
  reads: ['assetAttachment'],
  result: results.records(v.object({
    key: v.string(),
    assetID: v.string(),
    contentType: v.string(),
    size: v.integer(),
  }), {minItems: 0, maxItems: 1}),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('assetAttachment')
      .withIndex('by_key')
      .eq('key', args.key)
      .first();
    return row ? [{
      key: row.key,
      assetID: row.asset,
      contentType: row.contentType,
      size: row.size,
    }] : [];
  },
});

export const acceptanceAssetCleanupInventory = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['assetAttachment', 'identityBinding', 'user'],
  result: results.records(v.object({
    key: v.string(),
    assetID: v.string(),
    contentType: v.string(),
    size: v.integer(),
    created: v.number(),
  }), {minItems: 0, maxItems: 1_023}),
  handler: async (ctx) => {
    const actor = await requireSourceUser(ctx);
    const rows = actor.role === 'crew'
      ? await ctx.db.query('assetAttachment').take(1_024).collect()
      : await ctx.db
        .query('assetAttachment')
        .withIndex('by_owner_created')
        .eq('owner', ctx.auth.userId)
        .take(1_024)
        .collect();
    if (rows.length === 1_024) throw new Error('asset cleanup inventory exceeded its bound');
    return rows.map(row => ({
      key: row.key,
      assetID: row.asset,
      contentType: row.contentType,
      size: row.size,
      created: row.created,
    }));
  },
});

function effectTargets(intent) {
  const snapshot = JSON.parse(intent.recipientSnapshot);
  if (!snapshot || !Array.isArray(snapshot.recipients) || snapshot.recipients.length > 1_023) {
    throw new Error('notification recipient snapshot is invalid');
  }
  const targets = [];
  for (const recipient of snapshot.recipients) {
    if (
      !recipient || typeof recipient.email !== 'string'
      || typeof recipient.sourceUserID !== 'string'
    ) throw new Error('notification recipient snapshot is invalid');
    targets.push({channel: 'email', recipientKey: recipient.email});
  }
  if (intent.discordEligible) targets.push({channel: 'discord', recipientKey: 'project-webhook'});
  return targets;
}

function latestEffectAttempts(attempts) {
  const latest = new Map();
  for (const attempt of attempts) {
    const key = `${attempt.channel}:${attempt.recipientKey}`;
    const current = latest.get(key);
    if (!current || attempt.attempt > current.attempt) latest.set(key, attempt);
  }
  return latest;
}

function stableProviderKey(intent, target) {
  const prefix = `notification:${intent.trigger}:`;
  if (!intent.idempotencyKey.startsWith(prefix)) {
    throw new Error('notification settlement identity is invalid');
  }
  const settlementIdentity = intent.idempotencyKey.slice(prefix.length);
  if (!settlementIdentity || settlementIdentity.length > 768) {
    throw new Error('notification settlement identity is invalid');
  }
  return target.channel === 'email'
    ? `${settlementIdentity}:${target.recipientKey}`
    : `${settlementIdentity}:discord`;
}

// @ref LLP 0045#durable-intent-side-effectful-delivery — a committed intent is leased into a
// per-recipient attempt before egress; terminal delivered/ambiguous attempts
// fence every later tick from sending the same logical effect again.
export const acceptanceLeaseNotificationIntent = defineJsMutation({
  auth: 'authenticated',
  args: {now: v.number(), leaseMs: v.integer({min: 1_000, max: 600_000})},
  reads: ['identityBinding', 'notificationAttempt', 'notificationIntent', 'user'],
  writes: ['notificationAttempt', 'notificationIntent'],
  result: results.value(v.json()),
  handler: async (ctx, args) => {
    const operator = await requireCrew(ctx);
    if (operator.id !== '2wKdbVVF7qtnn5bx92sr9') {
      throw new Error('effect delivery requires the frozen crew administrator');
    }
    const pending = await ctx.db
      .query('notificationIntent')
      .withIndex('by_state_created')
      .eq('state', 'pending')
      .take(128)
      .collect();
    const leased = await ctx.db
      .query('notificationIntent')
      .withIndex('by_state_created')
      .eq('state', 'leased')
      .take(128)
      .collect();
    const candidates = [...pending, ...leased]
      .sort((left, right) => left.created - right.created || (
        left.idempotencyKey < right.idempotencyKey ? -1 : 1
      ));
    for (const intent of candidates) {
      const prior = await ctx.db
        .query('notificationAttempt')
        .withIndex('by_intent_channel_recipient_attempt')
        .eq('intentID', intent._id)
        .take(1_024)
        .collect();
      const forIntent = prior;
      if (forIntent.length === 1_024) throw new Error('notification attempt bound exceeded');
      const active = forIntent.filter(row => row.state === 'leased');
      if (active.some(row => row.started + args.leaseMs > args.now)) continue;
      for (const expired of active) {
        await ctx.db.patch('notificationAttempt', expired._id, {
          state: 'retryable',
          finished: args.now,
          errorCode: 'lease-expired-before-settlement',
          ambiguous: false,
        });
        expired.state = 'retryable';
      }
      const targets = effectTargets(intent);
      const latest = latestEffectAttempts(forIntent);
      const unresolved = targets.filter(target => {
        const row = latest.get(`${target.channel}:${target.recipientKey}`);
        return !row || (row.state !== 'delivered' && row.state !== 'ambiguous');
      });
      if (unresolved.length === 0) {
        const hasAmbiguous = targets.some(target => (
          latest.get(`${target.channel}:${target.recipientKey}`)?.state === 'ambiguous'
        ));
        await ctx.db.patch('notificationIntent', intent._id, {
          state: hasAmbiguous ? 'ambiguous' : 'delivered',
        });
        continue;
      }
      const attempts = [];
      for (const target of unresolved) {
        const previous = forIntent.filter(row => (
          row.channel === target.channel && row.recipientKey === target.recipientKey
        ));
        const attempt = previous.reduce((maximum, row) => Math.max(maximum, row.attempt), 0) + 1;
        const providerIdempotencyKey = stableProviderKey(intent, target);
        const attemptID = await ctx.db.insert('notificationAttempt', {
          intentID: intent._id,
          channel: target.channel,
          recipientKey: target.recipientKey,
          attempt,
          state: 'leased',
          providerIdempotencyKey,
          started: args.now,
          ambiguous: false,
        });
        attempts.push({attemptID, ...target, attempt, providerIdempotencyKey});
      }
      await ctx.db.patch('notificationIntent', intent._id, {state: 'leased'});
      return {
        intent: {
          physicalID: intent._id,
          idempotencyKey: intent.idempotencyKey,
          trigger: intent.trigger,
          kind: intent.kind,
          issueID: intent.sourceIssueID,
          created: intent.created,
          payloadSnapshot: intent.payloadSnapshot,
          recipientSnapshot: intent.recipientSnapshot,
          discordEligible: intent.discordEligible,
        },
        attempts,
      };
    }
    return null;
  },
});

export const acceptanceSettleNotificationAttempt = defineJsMutation({
  auth: 'authenticated',
  args: {
    attemptID: v.id('notificationAttempt'),
    outcome: v.string(),
    now: v.number(),
    providerReceiptID: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  },
  reads: ['identityBinding', 'notificationAttempt', 'notificationIntent', 'user'],
  writes: ['notificationAttempt', 'notificationIntent'],
  result: results.value(v.json()),
  handler: async (ctx, args) => {
    const operator = await requireCrew(ctx);
    if (operator.id !== '2wKdbVVF7qtnn5bx92sr9') {
      throw new Error('effect delivery requires the frozen crew administrator');
    }
    if (!['delivered', 'retryable', 'ambiguous'].includes(args.outcome)) {
      throw new Error('effect settlement outcome was refused');
    }
    const attempt = await ctx.db.get('notificationAttempt', args.attemptID);
    if (!attempt) throw new Error('notification attempt was not found');
    if (attempt.state !== 'leased') {
      return {attemptID: attempt._id, state: attempt.state, deduplicated: true};
    }
    await ctx.db.patch('notificationAttempt', attempt._id, {
      state: args.outcome,
      finished: args.now,
      ...(args.providerReceiptID ? {providerReceiptID: args.providerReceiptID} : {}),
      ...(args.errorCode ? {errorCode: args.errorCode} : {}),
      ambiguous: args.outcome === 'ambiguous',
    });
    const intent = await ctx.db.get('notificationIntent', attempt.intentID);
    if (!intent) throw new Error('notification intent was not found');
    const rows = await ctx.db
      .query('notificationAttempt')
      .withIndex('by_intent_channel_recipient_attempt')
      .eq('intentID', intent._id)
      .take(1_024)
      .collect();
    if (rows.length === 1_024) throw new Error('notification attempt bound exceeded');
    const forIntent = rows.map(row => (
      row._id === attempt._id ? {...row, state: args.outcome} : row
    ));
    const latest = latestEffectAttempts(forIntent);
    const targets = effectTargets(intent);
    let intentState = 'leased';
    const terminal = targets.every(target => {
      const row = latest.get(`${target.channel}:${target.recipientKey}`);
      return row && (row.state === 'delivered' || row.state === 'ambiguous');
    });
    if (terminal) {
      intentState = targets.some(target => (
        latest.get(`${target.channel}:${target.recipientKey}`)?.state === 'ambiguous'
      )) ? 'ambiguous' : 'delivered';
    } else if (![...latest.values()].some(row => row.state === 'leased')) {
      intentState = 'pending';
    }
    await ctx.db.patch('notificationIntent', intent._id, {state: intentState});
    return {attemptID: attempt._id, state: args.outcome, intentState, deduplicated: false};
  },
});

export const acceptanceAuthorizeEffectDelivery = defineJsMutation({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  // `ctx.runMutation` is the action-to-Ibex authority bridge; declaring the
  // intent ledger closes the callable write ceiling even though this guard
  // performs no data change.
  writes: ['notificationIntent'],
  result: results.value(v.boolean()),
  handler: async (ctx) => {
    const operator = await requireCrew(ctx);
    if (operator.id !== '2wKdbVVF7qtnn5bx92sr9') {
      throw new Error('effect delivery requires the frozen crew administrator');
    }
    return true;
  },
});

export const acceptanceDeliverNotification = defineAction({
  auth: 'authenticated',
  args: {
    provider: v.string(),
    url: v.string(),
    idempotencyKey: v.string(),
    body: v.string(),
  },
  uses: ['loopsApiKey', 'discordWebhookToken', 'captureAdapterAuth'],
  writes: ['notificationIntent'],
  result: results.value(v.object({
    status: v.integer(),
    ok: v.boolean(),
    bodyText: v.string(),
  })),
  handler: async (ctx, args) => {
    await ctx.runMutation('acceptanceAuthorizeEffectDelivery', {});
    if (args.provider !== 'loops' && args.provider !== 'discord') {
      throw new Error('effect provider was refused');
    }
    const expectedPath = args.provider === 'loops'
      ? '/__capture/loops'
      : '/__capture/discord';
    if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}\//.test(args.url)) {
      throw new Error('effect delivery URL must be loopback');
    }
    const path = args.url.replace(/^http:\/\/[^/]+/, '');
    if (path !== expectedPath) throw new Error('effect delivery path was refused');
    const captureAuth = ctx.secrets.get('captureAdapterAuth').expose();
    const providerToken = ctx.secrets
      .get(args.provider === 'loops' ? 'loopsApiKey' : 'discordWebhookToken')
      .expose();
    const response = await ctx.fetch({
      url: args.url,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': args.idempotencyKey,
        'x-zerobugs-capture-auth': captureAuth,
        authorization: `Bearer ${providerToken}`,
      },
      body: args.body,
    });
    // ctx.fetch resolves to the host.fetch JSON result ({status, ok, url,
    // bodyText}); it is not a WHATWG Response and has no .text() method.
    return {status: response.status, ok: response.ok, bodyText: response.bodyText};
  },
});
