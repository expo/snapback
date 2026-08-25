import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWritePolicyChecks,
  deriveWritePosture,
  scanGenericWriteSites,
  WRITE_POSTURE_MIGRATION_REPAIR_CLASS,
  WRITE_POSTURE_MIGRATION_WARNING,
} from './write-policy.mjs';
import { createCodegenSummary, formatCodegenSummary } from './codegen-summary.mjs';
import {
  compareVisibilityPolicies,
  normalizePolicyBody,
} from './visibility-governance.mjs';
import {
  extractInlineHandlers,
  renderInlineOperationGraphModule,
} from './inline-handlers.mjs';

const ownerTable = (extra = {}) => ({
  name: 'todos',
  visibility: { kind: 'owner', field: 'ownerId' },
  fields: [
    { name: 'ownerId', fieldType: { String: {} } },
    { name: 'slug', fieldType: { String: {} } },
    { name: 'title', fieldType: { String: {} } },
  ],
  indexes: [],
  ...extra,
});

function errorSink(code, _subsystem, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function hostMutation(name, steps, writePolicy = { semanticVersion: 'snapback.owner-write.v1', disclosures: [] }) {
  return {
    name,
    kind: 'Mutation',
    runtime: { HostPlan: { Mutation: { steps, return_value: null } } },
    declaredWrites: ['todos'],
    writePolicy,
  };
}

function jsMutation(name, source, metadata = {}) {
  const resolved = typeof source === 'string' ? { runtimeSource: source } : source;
  return {
    name,
    kind: 'Mutation',
    handlerForm: metadata.handlerForm ?? 'inline',
    runtime: { IbexModule: { source: resolved.runtimeSource, export: name } },
    writePolicyAnalysisSource:
      resolved.writePolicyAnalysisSource ?? resolved.runtimeSource,
    writePolicySourceSegments:
      resolved.writePolicySourceSegments ?? null,
    writePolicySourcePath: metadata.sourcePath ?? 'functions.mjs',
    declaredWrites: ['todos'],
    writePolicy: {
      semanticVersion: 'snapback.owner-write.v1',
      disclosures: metadata.disclosures ?? [],
      ...(metadata.opaqueWritePosture === undefined
        ? {} : { opaqueWritePosture: metadata.opaqueWritePosture }),
      ...(metadata.declaredTableCeiling === undefined
        ? {} : { declaredTableCeiling: metadata.declaredTableCeiling }),
    },
  };
}

function resolvedInlineModule(name, source, { path = 'functions.mjs' } = {}) {
  const extracted = extractInlineHandlers(source, { path });
  assert.deepEqual(extracted.diagnostics, []);
  const handler = extracted.handlers.get(name);
  assert(handler, `expected ${name} to resolve as an inline handler`);
  const rendered = renderInlineOperationGraphModule(name, handler);
  return {
    runtimeSource: rendered.source,
    writePolicyAnalysisSource: rendered.source,
    writePolicySourceSegments: rendered.segments,
    extracted: handler,
  };
}

test('governance posture stays refused while owner posture remains host-enforced', () => {
  const owner = deriveWritePosture('todos', ownerTable());
  assert.deepEqual(owner.dispositions, {
    insert: 'owner-host-stamped',
    'insert-each': 'owner-host-stamped',
    patch: 'owner-old-row-checked',
    delete: 'owner-old-row-checked',
    'delete-where': 'owner-filtered',
  });
  const publicPosture = deriveWritePosture('todos', {
    ...ownerTable(), visibility: { kind: 'public-read' },
  });
  assert.deepEqual(new Set(Object.values(publicPosture.dispositions)), new Set(['refused']));
});

test('Phase 1a warns and projects migration-pending without applying owner checks', () => {
  for (const visibility of [
    { kind: 'public-read' },
    { kind: 'membership', declaration: 'members', resourceField: 'roomId' },
    { kind: 'any-of', arms: [{ kind: 'public-read' }, { kind: 'owner', field: 'ownerId' }] },
  ]) {
    const warnings = [];
    const fn = hostMutation('legacyWrite', [{ Insert: {
      table: 'todos', values: { ownerId: { Literal: 'caller-preserved' } },
    } }]);
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable({ visibility }) },
      functions: [fn],
      sourceFunctions: [fn],
      err: errorSink,
      warn: (code, subsystem, message, details) => {
        warnings.push({ code, subsystem, message, details });
      },
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].genericWriteDisposition, 'migration-pending');
    assert.deepEqual(result.rows[0].authoritativeChecks, ['pre-0264-runtime-behavior']);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, WRITE_POSTURE_MIGRATION_WARNING);
    assert.equal(
      warnings[0].details.repairClass,
      WRITE_POSTURE_MIGRATION_REPAIR_CLASS,
    );
    assert.equal(warnings[0].details.candidateWritePolicyCheck.id, result.rows[0].id);
  }
});

test('migration advisories group by repair class while retaining per-table detail', () => {
  const diagnostics = [
    ['createPost', 'posts', 'insert'],
    ['updatePost', 'posts', 'patch'],
    ['sendMessage', 'messages', 'insert'],
  ].map(([operation, table, writeForm]) => ({
    code: WRITE_POSTURE_MIGRATION_WARNING,
    severity: 'warning',
    subsystem: 'auth',
    message: `${operation}: migration pending`,
    function: operation,
    table,
    writeForm,
    policyKind: 'public-read',
    repairClass: WRITE_POSTURE_MIGRATION_REPAIR_CLASS,
  }));
  const summary = createCodegenSummary({
    appId: 'migration-summary',
    inputsHash: 'fixture-input',
    tables: {
      posts: { visibility: { kind: 'public-read' } },
      messages: { visibility: { kind: 'public-read' } },
    },
    functions: [],
    ephemeralCollections: [],
    fileRecords: [],
    diagnostics,
  });
  assert.equal(summary.counts.warnings, 3);
  assert.equal(summary.counts.migrationAdvisories, 1);
  assert.deepEqual(summary.migrationAdvisories, [{
    code: WRITE_POSTURE_MIGRATION_WARNING,
    repairClass: WRITE_POSTURE_MIGRATION_REPAIR_CLASS,
    affectedTableCount: 2,
    affectedTables: ['messages', 'posts'],
    affectedOperationCount: 3,
    affectedOperations: ['createPost', 'sendMessage', 'updatePost'],
    occurrences: 3,
    detailSurfaces: [
      '--json diagnostics',
      'generated/authorization-review.json#writePolicyChecks',
    ],
  }]);
  const rendered = formatCodegenSummary(summary);
  assert.equal(
    rendered.match(/migration declare-explicit-write-authority:/gu)?.length,
    1,
  );
  assert.match(rendered, /2 affected tables across 3 findings/u);
  assert.match(rendered, /Per-table detail: --json diagnostics/u);
});

test('Phase 1b synthetic flip refuses declared non-owner generic writes', () => {
  const fn = hostMutation('futureRefusal', [{ Insert: { table: 'todos', values: {} } }]);
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: ownerTable({ visibility: { kind: 'public-read' } }) },
      functions: [fn],
      sourceFunctions: [fn],
      err: errorSink,
      declaredNonOwnerDisposition: 'refused',
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE'
      && details.candidateWritePolicyCheck.genericWriteDisposition === 'migration-pending',
  );
});

test('opaque migration facts use the declared write set without claiming a site census', () => {
  const warnings = [];
  const fn = jsMutation(
    'legacyOpaque',
    'export async function legacyOpaque(ctx) { return helper(ctx); }',
    { handlerForm: 'module' },
  );
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable({ visibility: { kind: 'public-read' } }) },
    functions: [fn],
    sourceFunctions: [fn],
    err: errorSink,
    warn: (...warning) => warnings.push(warning),
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'migration-pending-declared-write-set');
  assert.equal(result.rows[0].siteId, null);
  assert.equal(result.rows[0].table, 'todos');
  assert.equal(result.rows[0].genericWriteDisposition, 'migration-pending');
  assert.equal(warnings[0][0], WRITE_POSTURE_MIGRATION_WARNING);
});

test('direct inline write census remains exact and rejects authored owner input', () => {
  const directSource = resolvedInlineModule('createTodo', `
export const createTodo = defineJsMutation({
  handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }),
});
`);
  const direct = jsMutation('createTodo', directSource);
  const directResult = buildWritePolicyChecks({
    tables: { todos: ownerTable() },
    functions: [direct],
    sourceFunctions: [direct],
    err: errorSink,
  });
  assert.equal(directResult.rows.length, 1);
  assert.equal(directResult.rows[0].siteResolution, 'exact-static');
  assert.equal(directResult.rows[0].writeForm, 'insert');

  const source = `async function write(ctx) {
    await ctx.db.insert('todos', { title: 'first' });
    await ctx.db.insert('todos', { title: 'second' });
  }`;
  const census = scanGenericWriteSites(source, 'write');
  assert.equal(census.opaque, false);
  assert.equal(census.sites.length, 2);
  assert.notEqual(census.sites[0].siteId, census.sites[1].siteId);

  const forged = jsMutation('forged',
    `async function forged(ctx) { return ctx.db.insert('todos', { ownerId: 'alice' }); }`);
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: ownerTable() }, functions: [forged], sourceFunctions: [forged], err: errorSink,
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED'
      && details.candidateWritePolicyCheck.ownerInputDisposition === 'host-stamped',
  );
});

test('inline census projects writes from the splice-resolved same-file helper closure', () => {
  const authored = `
async function insertTodo(ctx, title) {
  return ctx.db.insert('todos', { title });
}

export const createTodo = defineJsMutation({
  handler: async (ctx, args) => insertTodo(ctx, args.title),
});
`;
  const source = resolvedInlineModule('createTodo', authored);
  const fn = jsMutation('createTodo', source);
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'exact-static');
  assert.equal(result.rows[0].writeForm, 'insert');
  assert.deepEqual(result.rows[0].sourceEvidence, {
    kind: 'static-inline',
    path: 'functions.mjs',
    line: authored.slice(0, authored.indexOf('ctx.db.insert')).split('\n').length,
    column: 10,
  });
  assert.deepEqual(result.rows[0].authoritativeChecks, ['installed-policy', 'owner-stamp']);
});

test('inline census follows a splice-resolved helper-calling-helper chain', () => {
  const source = resolvedInlineModule('createTodo', `
async function insertTodo(ctx, title) {
  return ctx.db.insert('todos', { title });
}

async function saveTodo(ctx, title) {
  return insertTodo(ctx, title);
}

export const createTodo = defineJsMutation({
  handler: async (ctx, args) => saveTodo(ctx, args.title),
});
`);
  const fn = jsMutation('createTodo', source);
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'exact-static');
  assert.equal(result.rows[0].writeForm, 'insert');
  assert.deepEqual(result.rows[0].preflightChecks, [
    'target-policy', 'authority-table-class', 'owner-input', 'unique-disclosure',
  ]);
});

test('dynamic and detached ctx.db write dispatch project honest opaque operation rows', () => {
  const sources = [
    `
globalThis.__snapbackHandlers = {
  dynamicWrite: async (ctx, args) => {
    const write = ctx.db.insert;
    return write('todos', { title: args.title });
  },
};
`,
    `
globalThis.__snapbackHandlers = {
  dynamicWrite: async (ctx, args) => ctx.db[args.writeForm](
    'todos', { title: args.title },
  ),
};
`,
  ];
  for (const source of sources) {
    const fn = jsMutation('dynamicWrite', source, {
      opaqueWritePosture: 'conservative-v1',
      declaredTableCeiling: ['todos'],
    });
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable() },
      functions: [fn],
      sourceFunctions: [fn],
      err: errorSink,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].siteResolution, 'opaque-module');
    assert.equal(result.rows[0].writeForm, 'opaque');
    assert.deepEqual(result.rows[0].writeFormCeiling, ['insert', 'patch', 'delete']);
  }
});

test('whole ctx.db aliases, destructuring, and pass-through project opaque operation rows', () => {
  const sources = [
    `globalThis.__snapbackHandlers = {
      escape: async (ctx) => { const db = ctx.db; return db.insert('todos', {}); },
    };`,
    `globalThis.__snapbackHandlers = {
      escape: async (ctx) => { const { insert } = ctx.db; return insert('todos', {}); },
    };`,
    `function helper(db) { return db.insert('todos', {}); }
    globalThis.__snapbackHandlers = { escape: async (ctx) => helper(ctx.db) };`,
  ];
  for (const source of sources) {
    const fn = jsMutation('escape', source, {
      handlerForm: 'module',
      opaqueWritePosture: 'conservative-v1',
      declaredTableCeiling: ['todos'],
    });
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].siteResolution, 'opaque-module');
    assert.equal(result.rows[0].writeForm, 'opaque');
  }
});

test('aliased context and computed context members are opaque, never exact-empty', () => {
  const sources = [
    `globalThis.__snapbackHandlers = {
      escape: async (ctx) => {
        const alias = ctx;
        return alias.db.insert('todos', {});
      },
    };`,
    `globalThis.__snapbackHandlers = {
      escape: async (ctx) => {
        let alias;
        alias = ctx;
        return alias.db.insert('todos', {});
      },
    };`,
    `globalThis.__snapbackHandlers = {
      escape: async (ctx, args) => ctx[args.key].insert('todos', {}),
    };`,
    `globalThis.__snapbackHandlers = {
      escape: async (ctx, args) => {
        const alias = ctx;
        return alias[args.key].insert('todos', {});
      },
    };`,
  ];
  for (const source of sources) {
    const census = scanGenericWriteSites(source, 'escape');
    assert.equal(census.opaque, true);
    const fn = jsMutation('escape', source, {
      handlerForm: 'module',
      opaqueWritePosture: 'conservative-v1',
      declaredTableCeiling: ['todos'],
    });
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].siteResolution, 'opaque-module');
    assert.equal(result.rows[0].writeForm, 'opaque');
  }

  const staticComputed = scanGenericWriteSites(`globalThis.__snapbackHandlers = {
    inspect: async (ctx) => ctx["db"].insert('todos', {}),
  };`, 'inspect');
  assert.equal(staticComputed.opaque, false);
  assert.equal(staticComputed.sites.length, 1);
  assert.equal(staticComputed.sites[0].writeForm, 'insert');

  const silent = jsMutation('escape', sources[0], { handlerForm: 'module' });
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: ownerTable() },
      functions: [silent],
      sourceFunctions: [silent],
      err: errorSink,
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE'
      && details.candidateWritePolicyCheck.siteResolution === 'opaque-module',
  );
});

test('module census follows a registered handler into a top-level helper', () => {
  const source = `
async function insertTodo(ctx, title) {
  return ctx.db.insert('todos', { title });
}
globalThis.__snapbackHandlers = {
  createTodo: async (ctx, args) => insertTodo(ctx, args.title),
};
`;
  const fn = jsMutation('createTodo', source, { handlerForm: 'module' });
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'exact-static');
  assert.equal(result.rows[0].sourceEvidence.line, 3);
});

test('module census follows top-level const helpers with function-valued initializers', () => {
  const source = `
const persist = (context, title) => context.db.insert('todos', { title });
globalThis.__snapbackHandlers = {
  createTodo: async (ctx, args) => persist(ctx, args.title),
};
`;
  const fn = jsMutation('createTodo', source, { handlerForm: 'module' });
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'exact-static');
  assert.equal(result.rows[0].writeForm, 'insert');
});

test('module census demotes reassignable let/var helpers from exact-static to opaque', () => {
  const helpers = [
    `let persist = function save(context, title) {
       return context.db.insert('todos', { title });
     };`,
    `var persist = async (context, title) => context.db.insert('todos', { title });`,
  ];
  for (const helper of helpers) {
    const source = `${helper}
      globalThis.__snapbackHandlers = {
        createTodo: async (ctx, args) => persist(ctx, args.title),
      };`;
    const census = scanGenericWriteSites(source, 'createTodo');
    assert.equal(census.opaque, true);
    const fn = jsMutation('createTodo', source, {
      handlerForm: 'module',
      opaqueWritePosture: 'conservative-v1',
      declaredTableCeiling: ['todos'],
    });
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].siteResolution, 'opaque-module');
    assert.equal(result.rows[0].writeForm, 'opaque');
  }
});

test('a local binding shadowing a top-level helper makes the module census opaque', () => {
  const source = `
function persist(ctx) {
  return ctx.db.insert('todos', { title: 'top-level' });
}
globalThis.__snapbackHandlers = {
  createTodo: async (ctx) => {
    const persist = () => 'local';
    return persist();
  },
};
`;
  const census = scanGenericWriteSites(source, 'createTodo');
  assert.equal(census.opaque, true);
  assert.deepEqual(census.sites, []);
  const fn = jsMutation('createTodo', source, {
    handlerForm: 'module',
    opaqueWritePosture: 'conservative-v1',
    declaredTableCeiling: ['todos'],
  });
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'opaque-module');
});

test('ctx.db recognition is rooted in the renamed handler context binding', () => {
  const source = `globalThis.__snapbackHandlers = {
    inspect: async (context, args) => {
      String(args.db);
      args.db.insert('todos', {});
      return context.db.insert('todos', {});
    },
  };`;
  const census = scanGenericWriteSites(source, 'inspect');
  assert.equal(census.opaque, false);
  assert.equal(census.sites.length, 1);
  assert.equal(census.sites[0].writeForm, 'insert');
  assert.equal(census.sites[0].source.line, 5);

  const argsOnly = scanGenericWriteSites(`globalThis.__snapbackHandlers = {
    inspect: async (context, args) => {
      String(args.db);
      return args.db.insert('todos', {});
    },
  };`, 'inspect');
  assert.equal(argsOnly.opaque, false);
  assert.deepEqual(argsOnly.sites, []);

  const shadowedContext = scanGenericWriteSites(`globalThis.__snapbackHandlers = {
    inspect: async (context, args) => {
      {
        const context = args;
        return context.db.insert('todos', {});
      }
    },
  };`, 'inspect');
  assert.equal(shadowedContext.opaque, true);
  assert.deepEqual(shadowedContext.sites, []);
});

test('context db destructuring in a handler or helper is opaque', () => {
  const sources = [
    `globalThis.__snapbackHandlers = {
      escape: async (ctx) => {
        const { db } = ctx;
        return db.insert('todos', {});
      },
    };`,
    `function helper({ db }) { return db.patch('todos', 'id', {}); }
     globalThis.__snapbackHandlers = { escape: async (ctx) => helper(ctx) };`,
    `function helper({ db }) { return db.patch('todos', 'id', {}); }
     globalThis.__snapbackHandlers = { escape: async (ctx) => helper(ctx.db) };`,
    `globalThis.__snapbackHandlers = {
      escape: async (ctx, args) => {
        const { [args.key]: db } = ctx;
        return db.insert('todos', {});
      },
    };`,
  ];
  for (const source of sources) {
    const census = scanGenericWriteSites(source, 'escape');
    assert.equal(census.opaque, true);
    const fn = jsMutation('escape', source, {
      handlerForm: 'module',
      opaqueWritePosture: 'conservative-v1',
      declaredTableCeiling: ['todos'],
    });
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].siteResolution, 'opaque-module');
  }
});

test('module handler census isolates each operation to its own helper closure', () => {
  const source = `
function helperA(ctx) { return ctx.db.insert('todos', {}); }
function helperB(ctx, id) { return ctx.db.delete('todos', id); }
globalThis.__snapbackHandlers = {
  opA: async (ctx) => helperA(ctx),
  opB: async (ctx, args) => helperB(ctx, args.id),
};
`;
  const functions = ['opA', 'opB'].map((name) => (
    jsMutation(name, source, { handlerForm: 'module' })
  ));
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions, sourceFunctions: functions, err: errorSink,
  });
  assert.deepEqual(
    result.rows.map(({ operation, writeForm }) => ({ operation, writeForm }))
      .sort((left, right) => left.operation.localeCompare(right.operation)),
    [
      { operation: 'opA', writeForm: 'insert' },
      { operation: 'opB', writeForm: 'delete' },
    ],
  );
});

test('unused sibling helper writes stay outside the operation splice census', () => {
  const authored = `
async function unusedDelete(ctx, id) {
  return ctx.db.delete('todos', id);
}
export const createTodo = defineJsMutation({
  handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }),
});
`;
  const fn = jsMutation('createTodo', resolvedInlineModule('createTodo', authored));
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.deepEqual(result.rows.map(({ writeForm }) => writeForm), ['insert']);
});

test('detached and dynamic ctx.db dispatch inside reachable helpers is opaque', () => {
  const sources = [
    `function helper(ctx) { const write = ctx.db.insert; return write('todos', {}); }
     globalThis.__snapbackHandlers = { escape: async (ctx) => helper(ctx) };`,
    `function helper(ctx, form) { return ctx.db[form]('todos', {}); }
     globalThis.__snapbackHandlers = { escape: async (ctx, args) => helper(ctx, args.form) };`,
  ];
  for (const source of sources) {
    const fn = jsMutation('escape', source, {
      handlerForm: 'module',
      opaqueWritePosture: 'conservative-v1',
      declaredTableCeiling: ['todos'],
    });
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].siteResolution, 'opaque-module');
  }
});

test('two operations sharing one helper each receive their own exact attribution', () => {
  const authored = `
async function insertTodo(ctx, title) {
  return ctx.db.insert('todos', { title });
}
export const createA = defineJsMutation({
  handler: async (ctx, args) => insertTodo(ctx, args.title),
});
export const createB = defineJsMutation({
  handler: async (ctx, args) => insertTodo(ctx, args.title),
});
`;
  const functions = ['createA', 'createB'].map((name) => (
    jsMutation(name, resolvedInlineModule(name, authored))
  ));
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions, sourceFunctions: functions, err: errorSink,
  });
  assert.deepEqual(result.rows.map(({ operation }) => operation).sort(), ['createA', 'createB']);
  assert.equal(new Set(result.rows.map(({ siteId }) => siteId)).size, 2);
  assert.deepEqual(new Set(result.rows.map(({ sourceEvidence }) => sourceEvidence.line)), new Set([3]));
});

test('Familiar runtime wrapping retains the canonical authored write census', async () => {
  const { renderFamiliarHandlerRuntime } = await import('./index.mjs');
  const authored = `
export const create = mutation({
  handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }),
});
`;
  const canonical = resolvedInlineModule('create', authored, { path: 'todos.ts' });
  const familiar = renderFamiliarHandlerRuntime(
    'create',
    canonical.extracted,
    {
      source: canonical.writePolicyAnalysisSource,
      segments: canonical.writePolicySourceSegments,
    },
    'data',
    'sha256:test-api',
  );
  const fn = jsMutation('create', {
    runtimeSource: familiar.source,
    writePolicyAnalysisSource: canonical.writePolicyAnalysisSource,
    writePolicySourceSegments: canonical.writePolicySourceSegments,
  }, { sourcePath: 'todos.ts' });
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'exact-static');
  assert.deepEqual(result.rows[0].sourceEvidence, {
    kind: 'static-inline', path: 'todos.ts', line: 3, column: 33,
  });
});

test('Familiar TypeScript generation maps the splice census through syntax erasure', async () => {
  const { cpSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { generate } = await import('./index.mjs');
  const root = mkdtempSync(join(tmpdir(), 'snapback-write-policy-familiar-'));
  try {
    const { fileURLToPath } = await import('node:url');
    const fixture = fileURLToPath(new URL('../../tests/fixtures/familiar-todo', import.meta.url));
    for (const file of ['codegen.policy.json', 'contracts.ts', 'schema.ts', 'todos.ts']) {
      cpSync(join(fixture, file), join(root, file));
    }
    const generated = await generate(root);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const row = generated.authorizationReview.writePolicyChecks.find(
      ({ operation }) => operation === 'todos.create',
    );
    assert(row, 'the Familiar-wrapped insert must appear in the write census');
    assert.deepEqual(row.sourceEvidence, {
      kind: 'static-inline', path: 'todos.ts', line: 26, column: 33,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('authority tables refuse before their row-policy kind', () => {
  const fn = hostMutation('insertMember', [{ Insert: { table: 'todos', values: {} } }]);
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: ownerTable({
        visibility: { kind: 'public-read' },
        membership: { id: 'members' },
      }) },
      functions: [fn], sourceFunctions: [fn], err: errorSink,
    }),
    ({ code }) => code === 'SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE',
  );
});

test('generated authority-profile transitions bypass the generic writer classifier', () => {
  const fn = jsMutation(
    'appAccess.join',
    `globalThis.__snapbackHandlers = {
      async ['appAccess.join'](ctx, args) {
        await ctx.membership.appAccess.join(args.scopeId, args.invitation);
        return null;
      },
    };`,
    { handlerForm: 'module' },
  );
  const sourceFn = {
    ...fn,
    generatedAuthorityOperation: {
      id: 'appAccess', generation: 'sha256:test', operation: 'join',
    },
  };
  const result = buildWritePolicyChecks({
    tables: {
      todos: ownerTable({ membership: { id: 'appAccess' } }),
    },
    functions: [fn],
    sourceFunctions: [sourceFn],
    err: errorSink,
  });
  assert.deepEqual(result.rows, []);
});

test('recipient-snapshot senders keep their declared product-row writes classified', () => {
  const fn = jsMutation(
    'sendMessage',
    `globalThis.__snapbackHandlers = {
      async sendMessage(ctx, args) {
        const rowId = await ctx.db.insert('todos', { title: args.title });
        await ctx.authority.members.snapshotRecipients(args.scopeId, rowId);
        return null;
      },
    };`,
    { handlerForm: 'module' },
  );
  const sourceFn = {
    ...fn,
    generatedAuthorityOperation: {
      id: 'members',
      generation: 'sha256:test',
      operation: 'snapshotRecipients',
      recipientSink: {
        operation: 'sendMessage',
        table: 'todos',
        scopeField: 'scopeId',
        recipientsField: 'recipientIds',
      },
    },
  };
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() },
    functions: [fn],
    sourceFunctions: [sourceFn],
    err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].table, 'todos');
  assert.equal(result.rows[0].writeForm, 'insert');
});

test('global uniqueness disclosure is bound to operation identity and widens by operation-set growth', () => {
  const table = ownerTable({ indexes: [{ name: 'by_slug', fields: ['slug'], unique: true }] });
  const disclosure = {
    table: 'todos', writeForm: 'insert', constraint: 'by_slug', operations: ['createA'],
  };
  const createA = hostMutation('createA', [{ Insert: {
    table: 'todos', values: { ownerId: 'AuthUserId', slug: { Arg: 'slug' } },
  } }], { semanticVersion: 'snapback.owner-write.v1', disclosures: [disclosure] });
  const createB = hostMutation('createB', [{ Insert: {
    table: 'todos', values: { ownerId: 'AuthUserId', slug: { Arg: 'slug' } },
  } }]);
  assert.doesNotThrow(() => buildWritePolicyChecks({
    tables: { todos: table }, functions: [createA], sourceFunctions: [createA], err: errorSink,
  }));
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: table }, functions: [createA, createB],
      sourceFunctions: [createA, createB], err: errorSink,
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED'
      && details.function === 'createB',
  );

  const before = normalizePolicyBody(
    table.visibility, { todos: table }, deriveWritePosture('todos', table, [disclosure]),
  );
  const afterDisclosure = { ...disclosure, operations: ['createA', 'createB'] };
  const after = normalizePolicyBody(
    table.visibility, { todos: table }, deriveWritePosture('todos', table, [afterDisclosure]),
  );
  assert.equal(compareVisibilityPolicies(before, after), 'growth');
});

test('opaque module needs conservative-v1, a closed ceiling, and all-form conflict disclosures', () => {
  const table = ownerTable({ indexes: [{ name: 'by_slug', fields: ['slug'], unique: true }] });
  const bare = jsMutation('opaque', 'export async function opaque(ctx) { return helper(ctx); }', {
    handlerForm: 'module',
  });
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: table }, functions: [bare], sourceFunctions: [bare], err: errorSink,
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE'
      && details.candidateWritePolicyCheck.siteResolution === 'opaque-module',
  );

  const disclosures = ['insert', 'patch'].map((writeForm) => ({
    table: 'todos', writeForm, constraint: 'by_slug', operations: ['opaque'],
  }));
  const declared = jsMutation('opaque', bare.runtime.IbexModule.source, {
    handlerForm: 'module',
    opaqueWritePosture: 'conservative-v1',
    declaredTableCeiling: ['todos'],
    disclosures,
  });
  const result = buildWritePolicyChecks({
    tables: { todos: table }, functions: [declared], sourceFunctions: [declared], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].writeForm, 'opaque');
  assert.deepEqual(result.rows[0].writeFormCeiling, ['insert', 'patch', 'delete']);
});

test('classifiable runtime-table sites project one exact ceiling-member row', () => {
  const fn = jsMutation(
    'remove',
    `async function remove(ctx, args) { return ctx.db.delete(args.table, args.id); }`,
    { declaredTableCeiling: ['todos'] },
  );
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'runtime-ceiling-member');
  assert.equal(result.rows[0].tableResolution, 'runtime-ceiling-member');
  assert.equal(result.rows[0].table, 'todos');
  assert.deepEqual(result.rows[0].declaredTableCeiling, ['todos']);
});

test('generic write elevation is not an admitted authoring field value', async () => {
  const { arg, defineMutation, insert, v } = await import('./define.mjs');
  assert.throws(
    () => defineMutation({
      args: { title: v.string() },
      plan: insert('todos', { title: arg('title') }),
      writeElevation: { tables: ['todos'] },
    }),
    ({ code }) => code === 'SNAPBACK_TABLE_WRITE_ELEVATION_UNAVAILABLE',
  );
});
