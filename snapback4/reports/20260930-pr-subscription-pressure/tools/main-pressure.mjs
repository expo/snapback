// Run the detecting Chromium/process convergence control against recorded main.
// From snapback4/, build the SDK, then run baseline-sdk.mjs first.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['local','local-reads','client','read-work','read-observation','read-episode','app-client'];
const fixed = new Map(files.map(name => [name, readFileSync('packages/snapback4/dist/' + name + '.js')]));
let result;
try {
  for (const name of files) writeFileSync('packages/snapback4/dist/' + name + '.js', readFileSync('target/pr-main/dist/' + name + '.js'));
  result = spawnSync(process.execPath, ['--test','packages/snapback4/test/subscription-pressure-e2e.test.mjs'], { stdio:'inherit', env:process.env });
} finally { for (const [name, bytes] of fixed) writeFileSync('packages/snapback4/dist/' + name + '.js', bytes); }
process.exitCode = result.status ?? 1;
