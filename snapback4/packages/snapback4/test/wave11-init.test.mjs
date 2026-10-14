import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, PORT_LO: undefined, PORT_HI: undefined }, timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
for (const identity of [null, 'use identity password', 'use personas alice']) test(`generated explicit online web client typechecks: ${identity ?? 'default guest'}`, t => {
  const dir = mkdtempSync(join(root, 'target', 'dx11-online-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (identity) {
    mkdirSync(join(dir, 'snapback'));
    writeFileSync(join(dir, 'snapback/schema.q'), `${identity}\ntable notes:\n  owner: principal\n  title: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nquery mine():\n  return notes where .owner = viewer first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { owner: viewer, title }\n`);
  }
  run(bin, ['init', '--web', '--online'], dir);
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  run(bin, ['check'], dir);
  run(join(root, 'node_modules/.bin/tsc'), ['--noEmit'], dir);
  const client = readFileSync(join(dir, 'src/client.ts'), 'utf8');
  assert.match(client, /writes: "online"/);
  assert.ok(!client.includes('webDevice') && !client.includes('snapback4/web'));
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.ok(!readme.includes('works offline') && !readme.includes('synced tables use `webDevice()`'));
  assert.match(readme, /journal/);
  if (!identity) {
    const schema = join(dir, 'snapback/schema.q');
    writeFileSync(schema, readFileSync(schema, 'utf8').replace('use identity ', 'use identity password '));
    run(bin, ['init', '--adapt'], dir);
    run(bin, ['check'], dir);
    run(join(root, 'node_modules/.bin/tsc'), ['--noEmit'], dir);
  }
});
