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
    createApp: ['sha256:13d9dee202bd1e8c1edbc0ce784717d23b0cbec40a5a1bf612c09e4e79a7d6af', 'sha256:0dde744f4decbe5aa7d146ecb64c2fa65c85456d7fe789d4a93f1d4ed31b5c90'],
    listAnnouncements: ['sha256:e6c4c64237a0ec96f8da196b351f5dc3c52517358ca15ea3f16af8969b0a9569', null],
    postAnnouncement: ['sha256:28db57ee13c70daeccfcd1803757ed7c6e6b008facb6ab1ec31f35ee57a8c227', 'sha256:6090fe79870d25224e107bd924ef02fa301c2486f78ac8eabc401c5e6d7d3b9c'],
    'appAccess.list': ['sha256:89d2ac27c31d98e737024421b091b3a08112695b6f31dc8d044c31562ded536d', 'sha256:c725401309d0ecec4c5b8bf6d1cb441b70c8b04bd477af2b8ec36766d8d76cf4'],
    'appAccess.myRole': ['sha256:2c4d28bf1f12083393c455937c1fb567fd05a11fa75fc37d03437a8c7af94a69', 'sha256:a61fe1c65a6a280b459839d9b6e2f5f8366c09ee5ecf5446965ac9ad7a191a7a'],
    'appAccess.invite': ['sha256:26e5d416f4711bf53f5f13270907f33ccfc96067d6a2ef1c3e7cebb0cfd22da1', 'sha256:d75a33801b2da6d05b354513f7ab4c648d95677a036514eceebd9c08ef2ff91f'],
    'appAccess.join': ['sha256:1ece5ab32cb37d5becba81d9ea3da579557fe1af99d3d1ab61f7a9c058b7e7e5', 'sha256:8da12272e52f2428f1de80c609042499811e3b1d63f5f0c985f37ea9aa6fe4f2'],
    'appAccess.leave': ['sha256:68662511d76ce50520be4691f28d7712f10a7dd3a34a793c07ff9d96e5966a6a', 'sha256:eb934f4848130c6c98400b67339f361c3097d4942330017a643a9e80214b72ac'],
    'appAccess.changeRole': ['sha256:4a8802d74b85b3d58246cdadbe2de5b646ad095a31571c5f100c361c4b6d0066', 'sha256:717d062b15d095169cffc9a8399dac05af56bf0f905b41678f1e5cc33936c287'],
    'appAccess.transferOwner': ['sha256:a27bcfbb0b804d0ad6a643ca5e9d156dcc567db1f2e72e258ddbff25368edb31', 'sha256:a4839d7d7fa0264882bf689f6b2be2ed77f6e039bd448f0d9c2889c736a2c147'],
    'appAccess.remove': ['sha256:0263774eb610f7f960cd9d935c256b417c3d8b2560cc76767bed9ddcc92badab', 'sha256:888f99a99d37cf3cc9cd4b8b1f0ef0d228f5a3734f13409703914d0b9c8cf8f7'],
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
