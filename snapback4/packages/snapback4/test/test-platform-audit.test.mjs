import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditTestPlatforms } from '../../../scripts/test-platform-audit.mjs';

const directory = import.meta.dirname;
test('client sources gate Linux APIs, including imported test helpers', () => {
  const files = readdirSync(directory).filter(name => name.endsWith('.test.mjs')).map(name => resolve(directory, name));
  assert.deepEqual(auditTestPlatforms(files), [], 'Linux-only calls require a platform gate at the call/test, or a portable fallback');
});

// In-memory sources prevent these deliberately broken examples from executing
// or appearing as real /proc reads in this file's own census.
function hazards(source, helper = '') {
  const sources = new Map([[resolve('/virtual/test.mjs'), source], [resolve('/virtual/helper.mjs'), helper]]);
  return auditTestPlatforms(['/virtual/test.mjs'], { read: file => sources.get(file), exists: file => sources.has(file) });
}
const procRead = "readFileSync('/proc/self/stat', 'utf8')";
const snapshot = "export function snapshot() { return readFileSync('/proc/net/tcp', 'utf8'); }";
test('platform guard catches direct and transitive versions of the publication regression', () => {
  for (const source of [
    `test('unsafe', () => ${procRead});`,
    "test('unsafe', () => spawnSync('strace', ['--version']));",
    "test('unsafe', () => spawn('ss', ['-ltn']));",
    "test('unsafe', () => execFileSync('taskset', ['-c','0','node']));",
    "import {snapshot as listeners} from './helper.mjs'; test('unsafe', () => listeners());",
    "import * as audit from './helper.mjs'; test('unsafe', () => audit.snapshot());",
    `function check() { ${procRead}; } test('named callback', check);`,
    "const check = () => spawnSync('strace', ['--version']); test('arrow callback', check);",
    "import {snapshot} from './helper.mjs'; test('imported callback', snapshot);",
    `test('nested helper', () => { function inner() { return ${procRead}; } inner(); });`,
    `function withDefault(value = ${procRead}) { return value; } test('default', () => withDefault());`,
    "import './helper.mjs'; test('import initialization', () => {});",
    `function inner() { return ${procRead}; } function outer() { return inner(); } test('unsafe', () => outer());`,
    `test('sibling gate', {skip:process.platform!=='linux'}, () => {}); test('unsafe', () => ${procRead});`,
    `test('late gate', () => { ${procRead}; if(process.platform!=='linux') return; });`,
  ]) assert.ok(hazards(source, source.includes('import initialization') ? `const stat = ${procRead};` : snapshot).length, source);
});
test('platform guard honors a Linux gate for an imported named callback', () => {
  assert.deepEqual(hazards("import {snapshot} from './helper.mjs'; test('gated', {skip:process.platform!=='linux'}, snapshot);", snapshot), []);
});
test('platform guard detects the original listenerSnapshot default /proc argument', () => {
  assert.ok(hazards("import {listenerSnapshot} from './helper.mjs'; test('unsafe', () => listenerSnapshot());", "export function listenerSnapshot(root=process.pid,proc='/proc') { return readdirSync(proc); }").length);
});
test('platform guard accepts scoped skips, branches, returns and portable helpers', () => {
  for (const source of [
    `function check() { ${procRead}; } test('named callback', {skip:process.platform!=='linux'}, check);`,
    `const check = () => { ${procRead}; }; test('arrow callback', {skip:process.platform!=='linux'}, check);`,
    `test('skip', {skip:process.platform!=='linux' && 'requires Linux /proc'}, () => ${procRead});`,
    `test('branch', () => { if(process.platform==='linux') ${procRead}; });`,
    `test('return', () => { if(process.platform!=='linux') return; ${procRead}; });`,
    `test('conditional', () => process.platform==='linux' ? ${procRead} : null);`,
    `test('and', () => process.platform==='linux' && ${procRead});`,
    "import {snapshot} from './helper.mjs'; test('portable', () => snapshot());",
    "// /proc is a Linux path; mocked traces and command output are portable.\ntest('mock', () => assert.match('strace -- version 6.8', /strace/));",
  ]) assert.deepEqual(hazards(source, "export function snapshot() { if(process.platform !== 'linux') return []; return readFileSync('/proc/net/tcp','utf8'); }"), [], source);
});
