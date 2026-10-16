import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { operationAvailable } from '../dist/release.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const fixture = t => {
  const cwd = mkdtempSync(join(tmpdir(), 'sb4-pubfix29b-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
};
const invoke = (cwd, args, env = {}) => spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, PORT_LO: undefined, PORT_HI: undefined, ...env } });
const okay = result => assert.equal(result.status, 0, result.stdout + result.stderr);
function onlyPackageTypes(source, label) {
  const tree = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const packageName = name => !name.startsWith('.') && !name.startsWith('/');
  function visit(node) {
    if (ts.isImportDeclaration(node) && packageName(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      assert.ok(clause && (clause.isTypeOnly || (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length && clause.namedBindings.elements.every(item => item.isTypeOnly))), `${label}: runtime package import ${node.getText(tree)}`);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && packageName(node.moduleSpecifier.text)) {
      assert.ok(node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(item => item.isTypeOnly)), `${label}: runtime package export`);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require')) {
      const name = node.arguments[0];
      assert.ok(name && ts.isStringLiteral(name) && !packageName(name.text), `${label}: runtime package load`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}

test('E1 fixture census: all emitted TS modules import only package types; availability equals REL3', { timeout: 120_000 }, async t => {
  const cwd = fixture(t), schema = join(cwd, 'snapback/schema.q');
  mkdirSync(join(cwd, 'snapback'));
  const fixtures = join(root, 'crates/snapback4-lang/tests/fixtures');
  let count = 0; const shapes = new Set();
  const sources = readdirSync(fixtures, { recursive: true }).filter(name => name.endsWith('.q'))
    .map(name => [name, readFileSync(join(fixtures, name), 'utf8')]);
  sources.push(['action', "use server\naction invite(peers: [principal] 1..49) returns { peers: [principal] 1..49 }\n"]);
  for (const [name, text] of sources) {
    writeFileSync(schema, text);
    const result = invoke(cwd, ['types']);
    if (name === 'action') okay(result);
    if (result.status !== 0) continue; // Deliberately refusing repair fixtures.
    count++;
    const generated = join(cwd, 'snapback/generated');
    for (const file of readdirSync(generated).filter(name => /\.[cm]?[jt]s$/.test(name))) {
      onlyPackageTypes(readFileSync(join(generated, file), 'utf8'), `${name}/${file}`);
    }
    const source = readFileSync(join(generated, 'api.ts'), 'utf8');
    assert.equal(source.match(/function operationAvailable\(/g)?.length, 1);
    for (const shape of ['query', 'mutation', 'action']) if (source.includes(`kind: "${shape}"`)) shapes.add(shape);
    if (source.includes('ephemeral: true')) shapes.add('ephemeral');
    if (source.includes('following:')) shapes.add('following');
    if (source.includes('receiptFamilies:')) shapes.add('receipts');
    // No node_modules at all: Node must execute this generated module on its own.
    const { api } = await import(pathToFileURL(join(generated, 'api.ts')).href + `?case=${count}`);
    const check = value => {
      for (const op of Object.values(value)) {
        if (!op || typeof op !== 'object') continue;
        if (!op.available) { check(op); continue; }
        const handle = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true);
        let args;
        function find(node) {
          if (ts.isCallExpression(node) && node.expression.getText(handle) === 'operationAvailable' && node.arguments[1]?.text === op.name) {
            const encoded = node.arguments[3].arguments[0].text;
            args = JSON.parse(encoded);
          }
          ts.forEachChild(node, find);
        }
        find(handle); assert.ok(args);
        const reversed = value => Array.isArray(value) ? value.map(reversed) : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).reverse().map(([k,v]) => [k,reversed(v)])) : value;
        for (const release of [{ loading: true }, { denied: { code: 'E_AUTH' } }, { generation: 1, operations: {} },
          { generation: 1, operations: { [op.name]: { kind: op.kind, args: reversed(args) } } },
          { generation: 2, operations: { [op.name]: { kind: 'job', args } } },
          { generation: 2, operations: { differentName: { kind: op.kind, args } } },
          { generation: 2, operations: { [op.name]: { kind: op.kind, args: Object.fromEntries(Object.entries(args).slice(1)) } } },
          { generation: 3, operations: { [op.name]: { kind: op.kind, args: { ...args, extra: 'Bool' } } } }]) {
          assert.equal(op.available(release), operationAvailable(release, op.name, op.kind, args), `${name}: ${op.name}`);
        }
      }
    };
    check(api);
  }
  t.diagnostic(`audited ${count} fixture schemas; shapes: ${[...shapes].sort().join(", ")}`);
  assert.ok(count >= 25, `only ${count} fixture schemas compiled`);
  for (const shape of ['query', 'mutation', 'action', 'ephemeral', 'following', 'receipts']) assert.ok(shapes.has(shape), `missing ${shape}`);
});

