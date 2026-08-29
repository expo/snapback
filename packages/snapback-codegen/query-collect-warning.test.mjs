import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SNAPBACK_PUBLIC_BUDGETS_V1 } from '@expo/snapback-contract/limits';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const warningCode = 'SNAPBACK_QUERY_COLLECT_UNBOUNDED';

const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const todos = defineTable({ title: v.string() })
  .index('by_title', ['title'])
  .visibility({ kind: 'public-read' })
  .sync();
export default defineSchema({ todos });
`;

function inlineFunctions(entries) {
  return `
import { defineJsLiveQuery, results, v } from '${defineUrl}';
${entries.map(([name, handler, args = '{}']) => `
export const ${name} = defineJsLiveQuery({
  args: ${args},
  reads: ['todos'],
  result: results.documents('todos'),
  handler: ${handler},
});`).join('\n')}
`;
}

async function generateCase(t, { functions, handlers = null }) {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-query-collect-warning-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'node_modules', '@expo'), { recursive: true });
  symlinkSync(packageDir, join(directory, 'node_modules', '@expo', 'snapback-codegen'), 'dir');
  writeFileSync(join(directory, 'schema.mjs'), schema);
  writeFileSync(join(directory, 'functions.mjs'), functions);
  if (handlers !== null) writeFileSync(join(directory, 'handlers.mjs'), handlers);
  return { directory, result: await generate(directory) };
}

test('inline collect without take warns with the ceiling and live repair', async (t) => {
  const { result } = await generateCase(t, {
    functions: inlineFunctions([[
      'listTodos',
      `async (ctx) => ctx.db.query('todos').withIndex('by_title').order('title').collect()`,
    ]]),
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const warnings = result.diagnostics.filter(({ code }) => code === warningCode);
  assert.equal(warnings.length, 1, JSON.stringify(result.diagnostics));
  const [warning] = warnings;
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.subsystem, 'codegen');
  assert.equal(warning.function, 'listTodos');
  assert.equal(warning.sourceSpan.file, 'functions.mjs');
  assert.match(warning.message, /listTodos/u);
  assert.match(
    warning.message,
    new RegExp(`${SNAPBACK_PUBLIC_BUDGETS_V1.query.implicitResultRows.toLocaleString('en-US')}-row implicit ceiling`, 'u'),
  );
  assert.match(warning.message, /SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED/u);
  assert.match(warning.message, /blank rows/u);
  assert.match(warning.message, /server-side \.order\(\.\.\.\)\.take\(n\)/u);
  assert.deepEqual(
    {
      implicitResultRowCeiling: warning.details.implicitResultRowCeiling,
      explicitTakeMaximum: warning.details.explicitTakeMaximum,
      liveSubscriptionRefusal: warning.details.liveSubscriptionRefusal,
      liveSubscriptionRows: warning.details.liveSubscriptionRows,
      repair: warning.details.repair,
    },
    {
      implicitResultRowCeiling: SNAPBACK_PUBLIC_BUDGETS_V1.query.implicitResultRows,
      explicitTakeMaximum: SNAPBACK_PUBLIC_BUDGETS_V1.query.takeRows,
      liveSubscriptionRefusal: 'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED',
      liveSubscriptionRows: 'blank',
      repair: 'server-side .order(...).take(n)',
    },
  );
});

test('selected module handler collect without take warns', async (t) => {
  const { result } = await generateCase(t, {
    functions: `
import { defineJsQuery, results } from '${defineUrl}';
export const listTodos = defineJsQuery({
  args: {}, reads: ['todos'], result: results.documents('todos'),
  source: 'handlers.mjs', exportName: 'listTodos',
});
`,
    handlers: `
globalThis.__snapbackHandlers = {
  async listTodos(context) {
    return context.db.query('todos').withIndex('by_title').collect();
  },
  async unrelated(context) {
    return context.db.query('todos').collect();
  },
};
`,
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const warnings = result.diagnostics.filter(({ code }) => code === warningCode);
  assert.equal(warnings.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(warnings[0].function, 'listTodos');
  assert.deepEqual(warnings[0].sourceSpan, { file: 'handlers.mjs', line: 4, column: 12 });
});

test('first terminal stays quiet', async (t) => {
  const { result } = await generateCase(t, {
    functions: inlineFunctions([[
      'firstTodo',
      `async (ctx) => { const row = await ctx.db.query('todos').first(); return row ? [row] : []; }`,
    ]]),
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.some(({ code }) => code === warningCode), false);
});

test('take on the same chain stays quiet, including a dynamic bound', async (t) => {
  const { result } = await generateCase(t, {
    functions: inlineFunctions([[
      'boundedTodos',
      `async (ctx, args) => ctx.db.query('todos').order('title').take(args.limit).collect()`,
      `{ limit: v.integer() }`,
    ]]),
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.some(({ code }) => code === warningCode), false);
});

test('non-query-builder collect chain stays quiet', async (t) => {
  const { result } = await generateCase(t, {
    functions: inlineFunctions([[
      'localCollector',
      `async (ctx) => { const local = { query: () => ({ collect: async () => [] }) }; return local.query().collect(); }`,
    ]]),
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.some(({ code }) => code === warningCode), false);
});

test('builder alias is not statically analyzable and stays quiet', async (t) => {
  const { result } = await generateCase(t, {
    functions: inlineFunctions([[
      'aliasedBuilder',
      `async (ctx) => { const builder = ctx.db.query('todos').withIndex('by_title'); return builder.collect(); }`,
    ]]),
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.some(({ code }) => code === warningCode), false);
});

test('only the handler context binding can root the warning', async (t) => {
  const cases = [
    [
      'blockShadow',
      `async (ctx) => { { const ctx = { db: { query: () => ({ collect: async () => [] }) } }; return ctx.db.query('todos').collect(); } }`,
    ],
    [
      'catchShadow',
      `async (ctx) => { try { throw { db: { query: () => ({ collect: async () => [] }) } }; } catch (ctx) { return ctx.db.query('todos').collect(); } }`,
    ],
    [
      'destructuredContext',
      `async ({ db }) => db.query('todos').collect()`,
    ],
    [
      'computedDbMember',
      `async (ctx) => ctx['db'].query('todos').collect()`,
    ],
    [
      'nestedClosure',
      `async (ctx) => { const nested = async () => ctx.db.query('todos').collect(); return nested(); }`,
    ],
  ];
  for (const [name, handler] of cases) {
    await t.test(name, async (subtest) => {
      const { result } = await generateCase(subtest, {
        functions: inlineFunctions([[name, handler]]),
      });
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      assert.equal(result.diagnostics.some(({ code }) => code === warningCode), false);
    });
  }
});

test('helper warning propagation requires the handler context in argument zero', async (t) => {
  await t.test('helper(args) stays quiet', async (subtest) => {
    const { result } = await generateCase(subtest, {
      functions: `${inlineFunctions([[
        'listTodos',
        `async (ctx, args) => collectTodos(args)`,
      ]])}
function collectTodos(args) {
  return args.db.query('todos').collect();
}
`,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.diagnostics.some(({ code }) => code === warningCode), false);
  });

  await t.test('helper(ctx) propagates the helper site', async (subtest) => {
    const { result } = await generateCase(subtest, {
      functions: `${inlineFunctions([[
        'listTodos',
        `async (ctx) => collectTodos(ctx)`,
      ]])}
function collectTodos(context) {
  return context.db.query('todos').collect();
}
`,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const warnings = result.diagnostics.filter(({ code }) => code === warningCode);
    assert.equal(warnings.length, 1, JSON.stringify(result.diagnostics));
    assert.equal(warnings[0].function, 'listTodos');
    assert.equal(warnings[0].sourceSpan.file, 'functions.mjs');
  });
});

test('mutation warning describes a one-shot refusal, not a live subscription', async (t) => {
  const { result } = await generateCase(t, {
    functions: `
import { defineJsMutation, results, v } from '${defineUrl}';
export const listTodos = defineJsMutation({
  args: {},
  reads: ['todos'],
  writes: ['todos'],
  result: results.value(v.json()),
  handler: async (ctx) => ctx.db.query('todos').collect(),
});
`,
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const warnings = result.diagnostics.filter(({ code }) => code === warningCode);
  assert.equal(warnings.length, 1, JSON.stringify(result.diagnostics));
  assert.match(warnings[0].message, /one-shot invocation/u);
  assert.match(warnings[0].message, /SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED/u);
  assert.doesNotMatch(warnings[0].message, /live subscription/u);
  assert.equal(warnings[0].details.oneShotRefusal, 'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED');
  assert.equal(Object.hasOwn(warnings[0].details, 'liveSubscriptionRefusal'), false);
});
