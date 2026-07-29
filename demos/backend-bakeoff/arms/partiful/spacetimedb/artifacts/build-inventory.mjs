import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { armRoot, evidenceRoot } from './constants.mjs';

const repoRoot = path.resolve(armRoot, '../../../../..');
const relativeArm = path.relative(repoRoot, armRoot);
const result = spawnSync(
  process.execPath,
  ['demos/backend-bakeoff/scripts/inventory-arm.mjs', relativeArm],
  { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const inventory = JSON.parse(result.stdout);
inventory.armRoot = relativeArm;
inventory.files = inventory.files.filter(
  (record) => !['evidence/inventory.json', 'run-capsule.v1.json'].includes(record.path),
);
inventory.totals = {};
for (const record of inventory.files) {
  const total = inventory.totals[record.category] ?? { files: 0, bytes: 0, lines: 0 };
  total.files += 1;
  total.bytes += record.bytes;
  if (record.lines !== null) total.lines += record.lines;
  inventory.totals[record.category] = total;
}
inventory.excludedSelfReferentialArtifacts = [
  'evidence/inventory.json',
  'run-capsule.v1.json',
];
await writeFile(
  path.resolve(evidenceRoot, 'inventory.json'),
  `${JSON.stringify(inventory, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  totals: inventory.totals,
  installedDependencyBytes: inventory.installedDependencyBytes,
})}\n`);
