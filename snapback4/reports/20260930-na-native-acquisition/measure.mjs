// Run after builds/tests finish. taskset -c 0-9 node .../measure.mjs --loaded
// The fixture is a private SQLite backup of HV's store-after, never its source.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { open, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { availableParallelism, hostname, loadavg } from 'node:os';
import { createHash } from 'node:crypto';
import { login } from '../../packages/snapback4/dist/auth.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const report = fileURLToPath(new URL('./', import.meta.url));
const fixture = resolve(root, '../target/na-envelope/store');
const binary = process.env.NA_BINARY ?? join(root, 'target/production/snapback4');
const loaded = process.argv.includes('--loaded'), label = loaded ? 'ten-cpu-loaded' : 'unconfined';
const out = join(report, process.env.NA_PHASE ?? 'after', label);
await mkdir(out, { recursive: true });
const serverLog = await open(join(out, 'server.log'), 'w');
const server = spawn(binary, ['dev', '--port', '0', '--replay', '--no-watch'], { cwd: fixture, stdio: ['ignore', 'pipe', serverLog.fd] });
const stopped = once(server, 'exit');
const burners = [];
const samples = [];
let output = '', url;
server.stdout.on('data', data => { output += data; url ??= output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
const sample = () => samples.push({ at: Date.now(), load: loadavg(), cpus: availableParallelism() });
const interval = setInterval(sample, 1000); sample();
try {
  const deadline = Date.now() + 30000;
  while (!url) {
    if (server.exitCode !== null || Date.now() >= deadline) throw Error('fixture server did not start');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (loaded) for (let i = 0; i < 8; i++) {
    const child = spawn(process.execPath, ['-e', 'let x=1; for (;;) { x=Math.imul(x,1664525)+1013904223; }'], { stdio: 'ignore' });
    burners.push({ child, done: once(child, 'exit') });
  }
  const hv = await readFile(join(root, 'reports/20260929-hv-heavy-acquisition/tools/browser.mjs'), 'utf8');
  const password = hv.match(/login\(api,`\$\{account\}@example.com`,'([^']+)'/)[1];
  for (const account of (process.env.NA_ACCOUNT ? [process.env.NA_ACCOUNT] : ['u0500', 'u0001'])) {
    const signed = await login(url, `${account}@example.com`, password);
    if (!signed.ok) throw Error(`fixture login failed: ${signed.why.code}`);
    const log = await open(join(out, `${account}.log`), 'w');
    const child = spawn(binary, ['witness', 'acquire', '--url', url, '--as', signed.session.principal,
      '--token', signed.session.token, '--query', 'chat.inbox', '--args', '{"c":null}', '--restart',
      '--runs', process.env.NA_RUNS ?? '3', '--timeout', '300', '--artifacts', join(out, account)], { cwd: fixture, stdio: ['ignore', log.fd, log.fd] });
    const [status] = await once(child, 'exit');
    await log.close();
    if (status !== 0) throw Error(`${account} witness failed; see its log`);
    console.log(`${label}: ${account} ${process.env.NA_RUNS ?? 3} runs passed`);
  }
} finally {
  clearInterval(interval); sample();
  for (const { child } of burners) child.kill();
  await Promise.all(burners.map(({ done }) => done));
  if (server.exitCode === null) server.kill();
  await stopped; await serverLog.close();
  await writeFile(join(out, 'server-stdout.log'), output);
  await writeFile(join(out, 'host.json'), JSON.stringify({ hostname: hostname(), node: process.version,
    cpus: availableParallelism(), burners: burners.length, binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'), samples }, null, 2));
}
