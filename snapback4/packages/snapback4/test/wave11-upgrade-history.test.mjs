import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hangBudget } from './helpers/wait.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-narr-')); mkdirSync(join(dir, 'snapback'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const deployment = join(dir, 'deployment'), schema = join(dir, 'snapback/schema.q');
  const invoke = (...args) => spawnSync(binary, args, { cwd: dir, encoding: 'utf8', timeout: hangBudget(), env: { ...process.env, PORT_LO: undefined, PORT_HI: undefined } });
  const run = (...args) => { const result = invoke(...args); assert.equal(result.status, 0, result.stdout + result.stderr); return result; };
  return { dir, deployment, schema, run, invoke };
}
import { runtimeChanges, lockedVersion } from '../bin/release-changes.js';
const installed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const v1 = `use identity guests
table notes:
  body: text 1..80
  status: enum('draft') default 'draft'
  public
  insert <- allow
  update <- allow
  online only
mutation add(body: text 1..80):
  return insert notes {body}
query readNote(note: notes):
  return notes[note]
query guardedNote(note: notes):
  n = notes[note]! else MISSING_NOTE
  return n
job remind():
  chunk n in notes first 10 by byId:
    update notes[n.id] {body: n.body}
schedule remindDaily every 1d: remind
`;
test('first check recovers older versions from locks/generated metadata and matches the packaged changelog', t => {
  for (const [name, contents] of [
    ['package-lock.json', JSON.stringify({ packages: { 'node_modules/snapback4': { version: '0.4.25' } } })],
    ['bun.lock', '{"packages":{"snapback4":["snapback4@0.4.25","",{},"sri"],},}'],
    ['pnpm-lock.yaml', 'importers:\n  .:\n    dependencies:\n      snapback4:\n        specifier: ^0.4.24\n        version: 0.4.25'],
    ['snapback/generated/package.json', '{"type":"module","snapback4Version":"0.4.25"}'],
  ]) {
    const { dir, schema, run } = fixture(t); writeFileSync(schema, v1);
    mkdirSync(join(dir, 'snapback/generated'), { recursive: true }); writeFileSync(join(dir, name), contents);
    const checked = run('check', '--json'); const facts = JSON.parse(checked.stdout); assert.ok(facts.ok);
    const expected = runtimeChanges(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), '0.4.25', installed);
    assert.ok(checked.stderr.includes(expected), checked.stderr);
    assert.match(expected, /0\.4\.26[\s\S]*run\(\).*sent \| failed/);
    assert.match(expected, /0\.4\.27/);
    const again = run('check'); assert.doesNotMatch(again.stdout + again.stderr, /runtime changes|baseline unavailable/);
  }
  const { run } = fixture(t); const guide = run('guide', 'changes').stdout;
  assert.ok(guide.includes(`Changes in ${installed}`)); assert.match(guide, /waitSeconds: 0/);
  if (installed === '0.4.27') assert.doesNotMatch(guide, /## 0\.4\.28/);
  assert.equal(lockedVersion('snapback4@0.4.25\nsnapback4@0.4.26'), undefined);
  assert.equal(lockedVersion('snapback4@0.4.25.1'), undefined);
  assert.equal(lockedVersion('importers:\n  one:\n    snapback4:\n      version: 0.4.25\n  two:\n    snapback4:\n      version: 0.4.27'), undefined);
  const human = fixture(t); writeFileSync(human.schema, v1);
  writeFileSync(join(human.dir, 'package-lock.json'), JSON.stringify({ dependencies: { snapback4: { version: '0.4.25' } } }));
  assert.match(human.run('check').stdout, /runtime changes: 0\.4\.25 →/);
});

test('runtime history remains visible when the first check refuses device preflight', t => {
  const { dir, schema, invoke } = fixture(t); writeFileSync(schema, v1);
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/snapback4': { version: '0.4.25' } } }));
  mkdirSync(join(dir, 'app')); writeFileSync(join(dir, 'app/app.json'), JSON.stringify({ typescript: { sources: { snapback4: '../../exact2/snapback4/ts', backend: '../snapback/generated' } } }));
  const checked = invoke('check', '--json'); assert.equal(checked.status, 1);
  assert.equal(JSON.parse(checked.stdout).denied.code, 'E_DEVICE_VERSION');
  assert.match(checked.stderr, /runtime changes: 0\.4\.25 →/); assert.match(checked.stderr, /run\(\).*sent \| failed/);
  assert.equal(existsSync(join(dir, 'snapback/generated/api.ts')), false);
});

