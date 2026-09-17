// Measurement witness, never a fresh-builder trial and never appended to boundsbar.jsonl.
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVerificationLane } from '../../run.mjs';
import { command } from '../../ceremony-process.mjs';
import { probeBounds } from '../../bounds-probes.mjs';
import { HUB, TINY } from '../../bounds-seed.mjs';
import { seedReference, ONE, TWO } from './seed.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const binary = resolve(process.env.BOUNDS_BINARY ?? join(here,'../../../target/w13d-bin/package/snapback4'));
const version = await command(binary,['--version']);
if (version.stdout.trim() !== 'snapback4 0.2.27') throw new Error(`wrong published binary: ${version.out}`);
const results = [];
for (const protocol of [ONE,TWO]) {
  const directory = prepareVerificationLane(here), size = process.argv.includes('--tiny') ? TINY : HUB;
  const check = await command(binary,['check'],{cwd:directory,log:join(directory,'check.log')});
  if (check.status !== 0) throw new Error(check.out);
  const result = await probeBounds(directory,{binary,size,protocol,seed:(call) => seedReference(call,size)});
  const record = {at:new Date().toISOString(), version:version.stdout.trim(), directory, protocol:protocol.kind,...result};
  results.push(record); console.log(JSON.stringify(record));
}
if (process.env.BOUNDS_OUTPUT) writeFileSync(process.env.BOUNDS_OUTPUT,JSON.stringify(results,null,2)+'\n');
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
