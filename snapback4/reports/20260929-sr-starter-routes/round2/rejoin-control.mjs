// Seed the forbidden post-reopen membership as a behavioral negative control.
// No schema widening: its independent sync checker refuses that before runtime.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../..');
const test = resolve(root, 'packages/snapback4/test/social-starter.test.mjs');
const scratch = resolve(root, 'packages/snapback4/test/.sr-rejoin-control.mjs');
const old = '  assert.equal(reopened.state, "sent"); assert.equal(reopened.result, canonical);';
const injected = `${old}
  const restored = await fetch(url + "/seed", { method: "POST", body: JSON.stringify([
    { table: "members", row: { id: mintId(), conversation: canonical, principal: sessions[0].session.principal,
      joinedOrdinal: 0, deliveredOrdinal: 0, seenOrdinal: 0 } },
  ]) }).then(r => r.json());
  assert.equal(restored.seeded, 1);`;
const source = readFileSync(test, 'utf8');
if (source.split(old).length !== 2) throw Error('missing unique injection site');
try {
  writeFileSync(scratch, source.replace(old, injected));
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=social DM', scratch], { cwd: root, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { unlinkSync(scratch); }
