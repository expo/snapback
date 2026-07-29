import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { receiptsDir, runtimeDir } from './lib.mjs';

for (const [source, destination] of [
  [resolve(runtimeDir, 'target.json'), resolve(runtimeDir, 'target-attempt1.json')],
  [resolve(runtimeDir, 'actors.json'), resolve(runtimeDir, 'actors-attempt1.json')],
  [resolve(runtimeDir, 'fixture.json'), resolve(runtimeDir, 'fixture-attempt1.json')],
  [resolve(receiptsDir, 'preflight.json'), resolve(receiptsDir, 'preflight-attempt1.json')],
  [resolve(receiptsDir, 'target-provision-redacted.json'), resolve(receiptsDir, 'target-provision-attempt1-redacted.json')],
  [resolve(receiptsDir, 'seed-receipt.json'), resolve(receiptsDir, 'seed-receipt-attempt1.json')],
]) {
  if (existsSync(source)) renameSync(source, destination);
}
process.stdout.write('attempt 1 runtime and stable-name receipts rotated\n');
