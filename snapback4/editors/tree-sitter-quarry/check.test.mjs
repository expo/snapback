import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { checkTreeSitter } from './check.mjs';
import { runEditorSelfTests } from '../../scripts/check-editor-grammar.mjs';
const home = import.meta.dirname;
const root = resolve(home, '../..');
const templates = ['crates/snapback4-lang/src/bind/receipts.q', 'crates/snapback4-lang/src/bind/timeline.q', 'crates/snapback4-lang/src/recipe/bridge.q'];
function probe(change) {
  const scratch = mkdtempSync(join(tmpdir(), 'quarry-fence-probe-'));
  try {
    const project = join(scratch, 'project'), temp = join(scratch, 'build');
    mkdirSync(temp);
    const editor = join(project, 'editors/tree-sitter-quarry'); mkdirSync(editor, { recursive: true });
    for (const path of ['grammar.js', 'tree-sitter.json', 'package.json', 'src/scanner.c', 'queries', 'test', 'expected-errors.txt']) cpSync(join(home, path), join(editor, path), { recursive: true });
    symlinkSync(join(home, 'node_modules'), join(editor, 'node_modules'), 'dir');
    cpSync(join(home, 'keywords.generated.js'), join(temp, 'keywords.generated.js'));
    cpSync(join(home, 'src/keywords.generated.h'), join(temp, 'keywords.generated.h'));
    const sources = templates.map(path => ({ path: join(project, path), text: readFileSync(join(root, path), 'utf8') }));
    change({ sources, editor, project });
    for (const source of sources) { mkdirSync(dirname(source.path), { recursive: true }); writeFileSync(source.path, source.text); }
    const failures = [];
    checkTreeSitter({ root: project, temp, sources, snippets: [], binary: process.env.QUARRY_EDITOR_BINARY ?? join(root, 'target/debug/snapback4'), failures });
    return failures;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
test('template substitution still rejects an unrelated unmatched parenthesis', () => {
  const failures = probe(({ sources }) => { sources[1].text += '\nquery planted():\n  return 1)\n'; });
  assert(failures.some(f => /bind\/timeline.q:\d+:\d+: tree-sitter (ERROR|MISSING)/.test(f)), `fence silently accepted template fault: ${failures.join('\n')}`);
});
for (const placeholder of ['@X@', '$x']) test(`template substitution rejects unsupported ${placeholder} in timeline`, () => {
  const failures = probe(({ sources }) => { sources[1].text += `\nquery ${placeholder}():\n  return 1\n`; });
  assert(failures.some(f => /bind\/timeline.q:\d+:\d+: tree-sitter (ERROR|MISSING)/.test(f)), `fence silently accepted ${placeholder}: ${failures.join('\n')}`);
});
test('syntax exception checks the fixture in a real scratch project', () => {
  const failures = probe(({ sources, editor, project }) => {
    const path = 'crates/snapback4-lang/tests/fixtures/editor-syntax-probe.q';
    sources.push({ path: join(project, path), text: 'query broken():\n  return 1)\n' });
    const list = join(editor, 'expected-errors.txt');
    writeFileSync(list, readFileSync(list, 'utf8') + `${path} # syntax E_QUARRY_SYNTAX: deliberately unmatched close\n`);
  });
  assert.deepEqual(failures, []);
});

test('local unclosed-group recovery remains a located fence failure', () => {
  const failures = probe(({ sources, project }) => {
    sources.push({ path: join(project, 'unclosed.q'), text: 'query q():\n  return (1\n' });
  });
  assert(failures.some(f => /unclosed.q:\d+:\d+: tree-sitter MISSING/.test(f)), failures.join('\n'));
});

test('fence self-tests use the alternate binary with no default debug binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quarry-binary-probe-'));
  try {
    const selected = process.env.QUARRY_EDITOR_BINARY ?? join(root, 'target/debug/snapback4');
    const project = join(dir, 'fixture');
    // Only the editor test inputs: the temporary fixture has no target/debug.
    const tree = 'editors/tree-sitter-quarry';
    for (const path of ['scripts/generate-editor-grammar.mjs', 'scripts/check-editor-grammar.mjs', 'editors/vscode/package.json', 'editors/vscode/test/first-line.test.mjs',
      ...['check.mjs', 'check.test.mjs', 'grammar.js', 'tree-sitter.json', 'package.json', 'src', 'queries', 'test', 'expected-errors.txt', 'keywords.generated.js'].map(p => `${tree}/${p}`),
      ...['bind/receipts.q', 'bind/timeline.q', 'recipe/bridge.q'].map(p => `crates/snapback4-lang/src/${p}`)]) {
      mkdirSync(dirname(join(project, path)), { recursive: true });
      cpSync(join(root, path), join(project, path), { recursive: true });
    }
    symlinkSync(join(root, tree, 'node_modules'), join(project, tree, 'node_modules'), 'dir');
    assert(!existsSync(join(project, 'target/debug/snapback4')));
    const binary = join(dir, 'alternate-compiler'), trace = join(dir, 'calls.jsonl');
    // Exercise both actual consumer tests. The Node name filter keeps this
    // regression from recursively launching itself in the temporary fixture.
    writeFileSync(binary, `#!${process.execPath}\nconst fs = require('node:fs');\nconst { spawnSync } = require('node:child_process');\nfs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconst child = spawnSync(${JSON.stringify(selected)}, process.argv.slice(2), { stdio: 'inherit' });\nprocess.exit(child.status ?? 2);\n`);
    chmodSync(binary, 0o755);
    const result = runEditorSelfTests(binary, ['--test-name-pattern=^(firstLine|syntax exception)', join(project, 'editors/vscode/test/first-line.test.mjs'), join(project, 'editors/tree-sitter-quarry/check.test.mjs')]);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const calls = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : [];
    assert(calls.some(args => args[0] === 'grammar'), `alternate binary never supplied lexical facts: ${JSON.stringify(calls)}`);
    assert(calls.some(args => args[0] === 'check'), `alternate binary never checked the syntax exception: ${JSON.stringify(calls)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
