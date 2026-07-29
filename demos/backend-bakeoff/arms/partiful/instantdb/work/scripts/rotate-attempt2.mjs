import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { receiptsDir, runtimeDir } from './lib.mjs';

for (const [source, destination] of [
  [resolve(runtimeDir, 'target.json'), resolve(runtimeDir, 'target-attempt2.json')],
  [resolve(runtimeDir, 'actors.json'), resolve(runtimeDir, 'actors-attempt2.json')],
  [resolve(runtimeDir, 'fixture.json'), resolve(runtimeDir, 'fixture-attempt2.json')],
  [resolve(receiptsDir, 'preflight.json'), resolve(receiptsDir, 'preflight-attempt2.json')],
  [resolve(receiptsDir, 'target-provision-redacted.json'), resolve(receiptsDir, 'target-provision-attempt2-redacted.json')],
  [resolve(receiptsDir, 'seed-receipt.json'), resolve(receiptsDir, 'seed-receipt-attempt2.json')],
]) {
  if (existsSync(source)) renameSync(source, destination);
}
process.stdout.write('attempt 2 runtime and stable-name receipts rotated\n');
