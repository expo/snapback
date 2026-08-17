import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate, generateInProcess } from './index.mjs';
import {
  extractInlineHandlers,
  renderInlineOperationGraphModule,
  renderInlineOperationModule,
} from './inline-handlers.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '../..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

const digest = (source) => `sha256:${createHash('sha256').update(source).digest('hex')}`;

const parityFixtures = [
  {
    label: 'single self-contained handler',
    operation: 'single',
    source: 'export const single = defineJsQuery({ handler: async () => 1 });',
    bundleDigest: 'sha256:b865643b850e84b333a84637b4b013c12b64235e0055b8564d50594515e68594',
    nodes: 1,
    edges: 0,
  },
  {
    label: 'handler plus one helper',
    operation: 'oneHelper',
    source: 'function plusOne(value) { return value + 1; }\nexport const oneHelper = defineJsQuery({ handler: async () => plusOne(1) });',
    bundleDigest: 'sha256:9e337781d8fc25fc4c5a6fe0da56ce85bebe1f0511aba85050ec5b43b09db2b1',
    nodes: 2,
    edges: 1,
  },
  {
    label: 'helper chain',
    operation: 'chain',
    source: 'function leaf(value) { return value + 1; }\nfunction middle(value) { return leaf(value) * 2; }\nexport const chain = defineJsQuery({ handler: async () => middle(2) });',
    bundleDigest: 'sha256:bbbac60efd0d8c4421eeedadfd009cdd48cf361d18b381f36529db5ed7d6761a',
    nodes: 3,
    edges: 2,
  },
  {
    label: 'self-recursive helper',
    operation: 'recursive',
    source: 'function fact(value) { return value <= 1 ? 1 : value * fact(value - 1); }\nexport const recursive = defineJsQuery({ handler: async () => fact(5) });',
    bundleDigest: 'sha256:dbec95695e392907fe8f6c19146ce9c3c43536ab1debd7c745ee396fa2819a45',
    nodes: 2,
    edges: 2,
  },
];

const demoGoldens = {
  'demos/todo/snapback': {
    createTodo: ['sha256:322ad16cb013c451c97da621a895a1652d82074ce5f1c0e202e92825a814fa57', 'sha256:b9a3c9eb89828254384ec0025e61bdc2313e006640cb8338ed35eba84b8f825c'],
    deleteTodo: ['sha256:12fe4a4c36a00511df804fdefc87a2d0ea4576c2c4445b2d8a9259eeaaf59db4', 'sha256:b9a3c9eb89828254384ec0025e61bdc2313e006640cb8338ed35eba84b8f825c'],
    editTitle: ['sha256:a164473f858ea0135b3ff21dd7e66464c1f476989b7b086c7d77984a3ecdfcb2', null],
    listTodos: ['sha256:730552aad46d939ba2272c9523f03a1d366b2063e8639a577f7fe00e5b0a6a24', 'sha256:b9a3c9eb89828254384ec0025e61bdc2313e006640cb8338ed35eba84b8f825c'],
    listTodosOnce: ['sha256:e024f99fb163691da8d87e06547cdb474ad351854cf904cc6172210f5f4c2b84', null],
    setCompleted: ['sha256:10b6d9a78c836a9e9b622753485960227585ef2392853a2f9e6f06f42718bc7f', 'sha256:b9a3c9eb89828254384ec0025e61bdc2313e006640cb8338ed35eba84b8f825c'],
  },
  'demos/rbac/snapback': {
        'createApp': [
            'sha256:67f040d7bf34ec08cb1db637f078dae01f5ec50838255d96df76f54f596e2586',
            'sha256:0dde744f4decbe5aa7d146ecb64c2fa65c85456d7fe789d4a93f1d4ed31b5c90'
        ],
        'listAnnouncements': [
            'sha256:5020010d16c89c4c2de91af330118dc99e59d5479c722fc01e2cf166f8bd1ca3',
            null
        ],
        'postAnnouncement': [
            'sha256:3e8f5b65e4add85360449e1827b98b8ad97dfbe1f96176bc3cb732b3df2b7ec8',
            'sha256:6090fe79870d25224e107bd924ef02fa301c2486f78ac8eabc401c5e6d7d3b9c'
        ],
        'appAccess.list': [
            'sha256:28b636ee796975b45cf551fd163a0618012e56d721004e2bcf43680818df5065',
            'sha256:41dcdc7063ea1c392caa6fca921d69bf0c18f319174586072fc962bfe53b6c77'
        ],
        'appAccess.myRole': [
            'sha256:1c57b056f6f7b05e30cb3e79a660b04935c327a8443c1e432e4c91e09075224a',
            'sha256:2dead41c79000ba3310c8dd54467dc7486f347891a1ba9673645dd0f87f2828b'
        ],
        'appAccess.invite': [
            'sha256:8fde2d3d0906fd16e3075be7b83afc75b095a8d73cf8c84a36eb496c76838c95',
            'sha256:d42ed83563f00cb0c4455f387d80e67446f9a1402ebc27e3f42cb15fc7042f47'
        ],
        'appAccess.join': [
            'sha256:426e0487ec7194af3b61a7a9fea63225409ef784f278d262c2c22f3f81c93640',
            'sha256:4c0d6255b975025fb542efac8d897a7d9ebc92c8749f12017097971c21322a44'
        ],
        'appAccess.leave': [
            'sha256:1e929c46b5ffedd03867180ff21b158ee97c42d5d8e0c1fa14ddf3430cafd88b',
            'sha256:6d2fbf0dc7fda9f5e5c2abccd9e9bb2eff5485887d6483d742cfb30b5e394b0c'
        ],
        'appAccess.changeRole': [
            'sha256:5a72d58ddb5b81f7140937e24a40635f5b9696d749f7b93f25c8850c966cb989',
            'sha256:3fcfd2f82b8c2db56311903400890f7160d90cf7c448ffa439106fb33499907a'
        ],
        'appAccess.transferOwner': [
            'sha256:9da526385cb3ac60cde8eb7d3e4e967cfc63f437fc5049e0475fa48f55d521b8',
            'sha256:c784ac5716a5daaf2778cd92560c674417f511d094048d16c5c6f48c4166a54b'
        ],
        'appAccess.remove': [
            'sha256:172bb828b84869503ae84e6eb4b21a58dd3097dc9f897fb82c12b83df0ca6764',
            'sha256:271403b2d33d42b2f0ae11b0d53498c3ba71e12fde26197a03941d58f08a3a7a'
        ]
    },
};

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('same-file graph rendering is byte-identical to the legacy renderer', () => {
  for (const fixture of parityFixtures) {
    const extraction = extractInlineHandlers(fixture.source);
    assert.deepEqual(extraction.diagnostics, [], fixture.label);
    const extracted = extraction.handlers.get(fixture.operation);
    assert(extracted, fixture.label);
    const legacy = renderInlineOperationModule(fixture.operation, extracted);
    const graph = renderInlineOperationGraphModule(fixture.operation, extracted);
    assert.equal(graph.source, legacy.source, fixture.label);
    assert.deepEqual(graph.segments, legacy.segments, fixture.label);
    assert.equal(digest(graph.source), fixture.bundleDigest, fixture.label);
    assert.equal(extracted.graphRecord.nodes.length, fixture.nodes, fixture.label);
    assert.equal(extracted.graphRecord.edges.length, fixture.edges, fixture.label);
    assert.equal(extracted.graphRecord.root.normalizedTarget, 'functions.mjs', fixture.label);
    for (const node of extracted.graphRecord.nodes) {
      assert.match(node.canonicalExecutableAstDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.match(node.rawSourceEvidenceDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(node.moduleFormat, 'esm');
    }
  }
  const recursive = extractInlineHandlers(parityFixtures[3].source)
    .handlers.get('recursive').graphRecord;
  assert(recursive.edges.some((edge) => (
    edge.importerNodeId === 'helper:fact' && edge.targetNodeId === 'helper:fact'
  )), 'self recursion must be represented by a topology self-edge');
});

test('current same-file refusal fixtures keep their stable diagnostic codes', () => {
  const refusals = [
    {
      code: 'SNAPBACK_INLINE_HELPER_SYNTAX_FORBIDDEN',
      source: 'function bad(input, key) { return input[key]; }\nexport const query = defineJsQuery({ handler: async () => bad({}, "x") });',
    },
    {
      code: 'SNAPBACK_INLINE_HELPER_FREE_IDENTIFIER',
      source: 'const BASE = 1;\nfunction bad(value) { return value + BASE; }\nexport const query = defineJsQuery({ handler: async () => bad(1) });',
    },
    {
      code: 'SNAPBACK_INLINE_HELPER_INADMISSIBLE',
      source: 'function bad() { return 1; }\nfunction bad() { return 2; }\nexport const query = defineJsQuery({ handler: async () => bad() });',
    },
    {
      code: 'SNAPBACK_INLINE_HELPER_CYCLE',
      source: 'function ping() { return pong(); }\nfunction pong() { return ping(); }\nexport const query = defineJsQuery({ handler: async () => ping() });',
    },
  ];
  for (const fixture of refusals) {
    const extraction = extractInlineHandlers(fixture.source);
    assert(
      extraction.diagnostics.some(({ code }) => code === fixture.code),
      `${fixture.code}: ${JSON.stringify(extraction.diagnostics)}`,
    );
  }
});

test('helper comments and formatting alter only raw graph evidence, not executable identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-handler-graph-evidence-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() })
    .visibility({ kind: 'public-read' })
    .sync(),
});
`);
  const functions = (comment) => `
import { defineJsQuery, results, v } from '${defineUrl}';
function plusOne(value) { ${comment}return value + 1; }
export const listTodos = defineJsQuery({
  args: {}, reads: ['todos'],
  result: results.records(v.object({ value: v.integer() })),
  handler: async () => [{ value: plusOne(1) }],
});
`;
  writeFileSync(join(root, 'functions.mjs'), functions(''));
  const baseline = await generate(root);
  assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics));
  const baselineFunction = baseline.functionManifest.functions[0];
  const baselineRecord = baseline.handlerRuntimeProfile.moduleGraph.records[0];
  const baselineHelper = baselineRecord.nodes.find(({ nodeId }) => nodeId === 'helper:plusOne');
  for (const evidenceEdit of ['/* evidence only */ ', '  ']) {
    writeFileSync(join(root, 'functions.mjs'), functions(evidenceEdit));
    const edited = await generate(root);
    assert.equal(edited.ok, true, JSON.stringify(edited.diagnostics));
    const editedFunction = edited.functionManifest.functions[0];
    assert.equal(editedFunction.implementationHash, baselineFunction.implementationHash);
    assert.notEqual(editedFunction.runtime.IbexModule.source, baselineFunction.runtime.IbexModule.source);
    const editedRecord = edited.handlerRuntimeProfile.moduleGraph.records[0];
    const editedHelper = editedRecord.nodes.find(({ nodeId }) => nodeId === 'helper:plusOne');
    assert.equal(
      editedHelper.canonicalExecutableAstDigest,
      baselineHelper.canonicalExecutableAstDigest,
    );
    assert.notEqual(
      editedHelper.rawSourceEvidenceDigest,
      baselineHelper.rawSourceEvidenceDigest,
    );
    const normalizedEdited = structuredClone(editedRecord);
    normalizedEdited.nodes.find(({ nodeId }) => nodeId === 'helper:plusOne')
      .rawSourceEvidenceDigest = baselineHelper.rawSourceEvidenceDigest;
    assert.deepEqual(normalizedEdited, baselineRecord);
  }
});

test('todo and rbac generated handler bytes and implementation hashes match goldens', async () => {
  for (const [relativeBackend, expected] of Object.entries(demoGoldens)) {
    const backend = join(repositoryRoot, relativeBackend);
    const result = await generate(backend, { check: true });
    assert.equal(result.ok, true, `${relativeBackend}: ${JSON.stringify(result.diagnostics)}`);
    const legacy = await generateInProcess(
      backend,
      { check: true },
      { inlineRenderer: 'legacy' },
    );
    assert.equal(legacy.ok, true, `${relativeBackend} legacy: ${JSON.stringify(legacy.diagnostics)}`);
    assert.equal(
      JSON.stringify(result.functionManifest),
      JSON.stringify(legacy.functionManifest),
      relativeBackend,
    );
    assert.equal(
      JSON.stringify(result.handlerRuntimeProfile),
      JSON.stringify(legacy.handlerRuntimeProfile),
      relativeBackend,
    );
    assert.deepEqual(result.handlerRuntimeProfile.moduleGraph.records, []);
    const actual = Object.fromEntries(result.functionManifest.functions.map((fn) => [
      fn.name,
      [
        fn.implementationHash,
        fn.runtime?.IbexModule?.source === undefined
          ? null
          : digest(fn.runtime.IbexModule.source),
      ],
    ]));
    assert.deepEqual(actual, expected, relativeBackend);
  }
});
