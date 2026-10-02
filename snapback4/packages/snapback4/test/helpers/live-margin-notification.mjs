// Instrument the existing ticket reproducer without changing any assertion,
// barrier, clock tick, or hang guard. The temporary sibling keeps its imports.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
const [prefix, workers = '0', cpus = '80-83'] = process.argv.slice(2);
const original = new URL('../live-propagation-fallback.test.mjs', import.meta.url);
const path = new URL(`../lm-notification-${process.pid}.mjs`, import.meta.url);
const source = readFileSync(original, 'utf8');
const marker = "    deliver(Response.json(change));\n    await turns(t, () => syncEntered, 'notification starts sync');";
if (source.split(marker).length !== 2) throw Error('ticket reproducer changed; review instrumentation');
writeFileSync(path, source.replace(marker, "    const notificationStart = performance.now();\n" + marker +
  "\n    console.log('LM_NOTIFICATION ' + JSON.stringify({ host, scenario, ms: performance.now() - notificationStart }));"));
writeFileSync(prefix + '.source.json', JSON.stringify({ file: original.pathname, sha256: createHash('sha256').update(source).digest('hex'), marker, added: 'one performance.now before delivery, one diagnostic after the unchanged sync barrier' }, null, 2));
try {
  const child = spawn(process.execPath, [new URL('./live-margin-load.mjs', import.meta.url).pathname, prefix, workers, cpus], {
    stdio: 'inherit', env: { ...process.env, LM_TEST: path.pathname, LM_REPEAT: process.env.LM_REPEAT ?? '20' },
  });
  const [code] = await once(child, 'exit'); process.exitCode = code ?? 1;
} finally { rmSync(path); }
