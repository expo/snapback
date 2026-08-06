import {
  defineJsMutation,
  defineJsQuery,
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

function requireFixtureSession(ctx) {
  if (!ctx.auth || typeof ctx.auth.userId !== 'string' || ctx.auth.userId.length === 0) {
    throw new Error('fixture ingestion requires an authenticated session');
  }
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

async function requireFixtureBootstrapWindow(db) {
  // @ref LLP 0109#155-quantitative-and-acceptance-closure — the large fixture
  // is a sequence of ordinary bounded commits, not a partially installed seed.
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

export const fixtureIngestBatch = defineJsMutation({
  args: {table: v.string(), rows: v.json()},
  reads: ['user', 'searchEpoch'],
  writes: fixtureTableNames(),
  result: results.value(v.json()),
  outgrewIr: 'general-iteration',
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    validateFixtureBatch(args.table, args.rows);
    await requireFixtureBootstrapWindow(ctx.db);
    const ids = [];
    for (const row of args.rows) {
      ids.push(await ctx.db.insert(args.table, row));
    }
    return {inserted: args.rows.length, ids};
  },
});

export const fixtureInspectTable = defineJsQuery({
  args: {table: v.string()},
  reads: fixtureTableNames(),
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    if (!fixtureTableNames().includes(args.table)) {
      throw new Error('unknown fixture table');
    }
    return await ctx.db.query(args.table).take(1024).collect();
  },
});

// The remaining 19-query and 16-mutator inventory is intentionally not
// implemented by Lane 1. PLAN.md fixes those names, lowering, and lane order.
