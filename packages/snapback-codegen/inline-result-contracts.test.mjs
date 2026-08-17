import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const roots = [];
const backend = () => {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-inline-result-'));
  roots.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), `
    import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
    export default defineSchema({
      todos: defineTable({
        title: v.string(),
        metadata: v.optional(v.json()),
        photo: v.optional(v.assetRef()),
      }).visibility({ kind: 'public-read' }).sync(),
    });
  `);
  writeFileSync(join(dir, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    contractMetadata: 'exact',
  }, null, 2));
  return dir;
};

const validFunctions = (suffix = '') => `
  import {
    defineAction,
    defineJsLiveQuery,
    defineJsMutation,
    defineJsQuery,
    results,
    v,
  } from ${JSON.stringify(defineUrl)};
  export const listTodos = defineJsQuery({
    args: {},
    reads: ['todos'],
    result: results.documents('todos'),
    handler: async (ctx) => {
      const rows = await ctx.db.query('todos').collect();
      return rows${suffix};
    },
  });
  export const exactlyOne = defineJsQuery({
    args: {},
    reads: ['todos'],
    result: results.records(
      v.object({ kind: v.literal('only') }),
      { minItems: 1, maxItems: 1 },
    ),
    handler: async () => [{ kind: 'only' }],
  });
  export const createTodo = defineJsMutation({
    args: { title: v.string() },
    writes: ['todos'],
    result: results.value(v.id('todos')),
    handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }),
  });
  export const watchTodos = defineJsLiveQuery({
    args: {},
    reads: ['todos'],
    result: results.documents('todos'),
    handler: async (ctx) => ctx.db.query('todos').collect(),
  });
  export const echo = defineAction({
    args: { value: v.string() },
    result: results.value(v.string()),
    handler: async (_ctx, args) => args.value,
  });
`;

try {
  const dir = backend();
  writeFileSync(join(dir, 'functions.mjs'), validFunctions());
  let generated = await generate(dir);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  const manifestPath = join(dir, 'generated', 'functions.manifest.json');
  const firstBytes = readFileSync(manifestPath, 'utf8');
  const first = JSON.parse(firstBytes);
  const query = first.functions.find(({ name }) => name === 'listTodos');
  const liveQuery = first.functions.find(({ name }) => name === 'watchTodos');
  const mutation = first.functions.find(({ name }) => name === 'createTodo');
  const action = first.functions.find(({ name }) => name === 'echo');
  const exact = first.functions.find(({ name }) => name === 'exactlyOne');
  assert.equal(query.handlerForm, 'inline');
  assert.equal(query.sourceSpan.file, 'functions.mjs');
  assert.equal(query.resultContract.kind, 'documents');
  assert.equal(query.resultContract.document.allowExtra, false);
  const optionalJson = query.resultContract.document.fields.find(
    ({ name }) => name === 'metadata',
  );
  assert.equal(optionalJson.required, true);
  assert.equal(
    optionalJson.value.kind,
    'json',
    'a stored optional JSON field is one JSON contract (which already admits null), not invalid null|json',
  );
  assert.equal(liveQuery.kind, 'LiveQuery');
  assert.equal(liveQuery.handlerForm, 'inline');
  assert.equal(liveQuery.resultContract.kind, 'documents');
  const livePhoto = liveQuery.resultContract.document.fields.find(
    ({ name }) => name === 'photo',
  );
  assert.equal(livePhoto.required, true);
  assert.deepEqual(
    livePhoto.value,
    { kind: 'union', variants: [{ kind: 'null' }, { kind: 'assetRef' }] },
    'a photo-bearing live table emits the typed AssetRef leaf instead of failing codegen',
  );
  assert.equal(mutation.resultContract.kind, 'value');
  assert.equal(action.handlerForm, 'inline');
  assert.equal(action.resultContract.kind, 'value');
  assert.deepEqual(exact.resultContract.rows, { minItems: 1, maxItems: 1 });
  assert.match(
    readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8'),
    /"exactlyOne": FunctionReference<[^\n]+readonly \[/u,
  );
  assert.match(
    readFileSync(join(dir, 'generated', 'provider-bindings.d.ts'), 'utf8'),
    /ExactlyOneResult = readonly \[/u,
  );
  assert.match(
    readFileSync(
      join(dir, 'generated', 'contract', 'exactlyOne.query.contract-meta.ts'),
      'utf8',
    ),
    /result: 'readonly \[ExactlyOneRow\]'/u,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, 'generated', 'provider-introspection.json'), 'utf8'))
      .operations.queries.find(({ name }) => name === 'exactlyOne').result,
    {
      kind: 'list',
      maxItems: 1,
      minItems: 1,
      row: {
        fields: {
          kind: { shape: 'literal', value: 'only' },
        },
        shape: 'object',
      },
    },
  );
  assert.match(query.implementationHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(query.argsContractHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(query.resultContractHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(query.runtime.IbexModule.source, /__snapbackHandlers/);
  assert.doesNotMatch(query.runtime.IbexModule.source, /\bexport\b/);
  assert(query.requiredCapabilities.includes('inline_handler_v1'));
  assert(query.requiredCapabilities.includes('result_contract_v1'));

  generated = await generate(dir);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(readFileSync(manifestPath, 'utf8'), firstBytes);

  writeFileSync(join(dir, 'functions.mjs'), validFunctions('.slice()'));
  generated = await generate(dir);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const changed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.notEqual(
    changed.functions.find(({ name }) => name === 'listTodos').implementationHash,
    query.implementationHash,
  );
  assert.equal(
    changed.functions.find(({ name }) => name === 'listTodos').resultContractHash,
    query.resultContractHash,
  );

  const lastGood = readFileSync(manifestPath, 'utf8');
  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    const sibling = async () => [];
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: sibling,
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED',
  ));
  assert.equal(readFileSync(manifestPath, 'utf8'), lastGood);

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    const legacy = { source: 'handlers.mjs', exportName: 'listTodos' };
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => [],
      ...legacy,
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code, sourceSpan }) => (
      code === 'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED'
      && sourceSpan?.file === 'functions.mjs'
    ),
  ), 'a spread cannot ambiguously replace or mix an inline handler form');
  assert.equal(readFileSync(manifestPath, 'utf8'), lastGood);

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      ['handler']: async () => [],
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED',
  ), 'a computed handler property must fail with the stable direct-literal code');

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    const helper = () => [];
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => helper(),
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code, identifiers }) => (
      code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
      && identifiers.includes('helper')
    ),
  ));

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      source: 'handlers.mjs',
      exportName: 'listTodos',
      handler: async () => [],
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_FUNCTION_HANDLER_FORM_INVALID',
  ));

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => import('./helper.mjs'),
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN',
  ));

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => {
        (() => { const nestedOnly = []; return nestedOnly; })();
        return nestedOnly;
      },
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code, identifiers }) => (
      code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
      && identifiers.includes('nestedOnly')
    ),
  ), 'a declaration in a nested lexical scope must not admit an outer free reference');

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => this.todos,
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN',
  ), 'module-ambient this must not cross into the generated runtime module');

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => globalThis['eval']('[]'),
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code, identifiers }) => (
      code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
      && identifiers.includes('globalThis')
    ),
  ), 'globalThis cannot act as a computed escape to forbidden ambient authority');

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => Object.constructor('return []')(),
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code, message }) => (
      code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN'
      && /constructor reflection/u.test(message)
    ),
  ), 'static constructor reflection must not become an eval-like escape');

  for (const [label, body] of [
    [
      'computed concatenation',
      `const Ctor = Object['con' + 'structor']; return Ctor('return []')();`,
    ],
    [
      'computed template',
      "const Ctor = Object[`con${'structor'}`]; return Ctor('return []')();",
    ],
    [
      'computed constant alias',
      `const key = 'con' + 'structor'; const Ctor = Object[key]; return Ctor('return []')();`,
    ],
    [
      'computed chained constant aliases',
      `const prefix = 'con'; const key = prefix + 'structor'; const Ctor = Object[key]; return Ctor('return []')();`,
    ],
    [
      'dynamic computed constructor key',
      `const key = ['con', 'structor'].join(''); const Ctor = Object[key]; return Ctor('return []')();`,
    ],
    [
      'destructured constructor',
      `const { constructor: Ctor } = async () => {}; return Ctor('return []')();`,
    ],
    [
      'shorthand destructured constructor',
      `const { constructor } = async () => {}; return constructor('return []')();`,
    ],
    [
      'computed destructured constructor',
      `const { ['con' + 'structor']: Ctor } = async () => {}; return Ctor('return []')();`,
    ],
    [
      'computed destructured constant alias',
      `const key = 'con' + 'structor'; const { [key]: Ctor } = async () => {}; return Ctor('return []')();`,
    ],
    [
      'dynamic computed destructured constructor',
      `const key = ['con', 'structor'].join(''); const { [key]: Ctor } = async () => {}; return Ctor('return []')();`,
    ],
    [
      'destructuring assignment constructor',
      `let Ctor; ({ constructor: Ctor } = async () => {}); return Ctor('return []')();`,
    ],
    [
      'dynamic computed destructuring assignment constructor',
      `let Ctor; const key = ['con', 'structor'].join(''); ({ [key]: Ctor } = async () => {}); return Ctor('return []')();`,
    ],
    [
      'prototype reflection',
      `const proto = Object.getPrototypeOf(async () => {}); return proto.constructor('return []')();`,
    ],
  ]) {
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery } from ${JSON.stringify(defineUrl)};
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        handler: async () => { ${body} },
      });
    `);
    generated = await generate(dir);
    assert.equal(generated.ok, false, `${label} unexpectedly generated`);
    assert(generated.diagnostics.some(
      ({ code }) => code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN',
    ), `${label} must fail at the authored handler expression`);
    assert.equal(readFileSync(manifestPath, 'utf8'), lastGood);
  }

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineAction, results, v } from ${JSON.stringify(defineUrl)};
    export const oversized = defineAction({
      args: {},
      result: results.value(v.string({ maxBytes: 1048577 })),
      handler: async () => 'ok',
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(
    generated.diagnostics.some(({ code, message }) => (
      code === 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID'
      && /1 MiB/u.test(message)
    )),
  );

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
    export const wrongQueryShape = defineJsQuery({
      args: {},
      reads: ['todos'],
      result: results.value(v.string()),
      handler: async () => 'not-a-query-row-list',
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert.match(
    JSON.stringify(generated.diagnostics),
    /Query cannot use value result contract/u,
  );

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsMutation, results, v } from ${JSON.stringify(defineUrl)};
    export const wrongMutationShape = defineJsMutation({
      args: {},
      writes: ['todos'],
      result: results.records(v.object({ title: v.string() })),
      handler: async () => [],
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert.match(
    JSON.stringify(generated.diagnostics),
    /defineJsMutation result must use results\.document\(\.\.\.\) or results\.value\(\.\.\.\)/u,
  );

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineAction, results, v } from ${JSON.stringify(defineUrl)};
    export const ambiguous = defineAction({
      args: {},
      result: results.value(v.union([v.string(), v.string({ maxBytes: 8 })])),
      handler: async () => 'ok',
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(
    generated.diagnostics.some(({ code, message }) => (
      code === 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID'
      && /syntactically disjoint/u.test(message)
    )),
  );

  writeFileSync(join(dir, 'functions.mjs'), `
    import { defineJsQuery } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({
      args: {},
      reads: ['todos'],
      handler: async () => {
        class Hidden {}
        return [new Hidden()];
      },
    });
  `);
  generated = await generate(dir);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN',
  ));

  const types = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
  assert.match(types, /FunctionResult<Ref>/);
  assert.match(types, /ReadonlyArray<\{ "_id": Id<"todos">; "_version": number;/u);
  assert.match(types, /"photo": null \| string/u);
  assert.doesNotMatch(types, /ReadonlyArray<GeneratedDataModel\["todos"\]>/u);
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log('inline handler and result contract tests passed');
