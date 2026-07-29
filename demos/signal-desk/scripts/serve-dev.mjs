import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..');
const repoRoot = resolve(demoRoot, '..', '..');
const secrets = await readFile(join(repoRoot, '.agent-local-secrets.md'), 'utf8');
const local = await readFile(join(demoRoot, '.env.local'), 'utf8');
const snapbackReady = JSON.parse(
  await readFile(join(demoRoot, '.snapback', 'dev.ready.json'), 'utf8'),
);
const unquote = (value) => value?.trim().replace(/^(['"])(.*)\1$/, '$2');
const values = (source, name) =>
  [...source.matchAll(new RegExp(`^${name}=(.+)$`, 'gm'))].map((match) => unquote(match[1]));
const supabaseUrl = values(secrets, 'SUPABASE_URL').find((value) => /^https?:\/\//.test(value));
const supabaseKey = [
  ...values(secrets, 'SUPABASE_PUBLISHABLE_KEY'),
  ...values(secrets, 'SUPABASE_ANON_KEY'),
].find((value) => value.length > 20 && value !== '...');
const convexUrl = values(local, 'VITE_CONVEX_URL')[0];
if (!supabaseUrl || !supabaseKey || !convexUrl) {
  throw new Error('Signal Desk dev credentials/config are incomplete');
}

const child = spawn(join(demoRoot, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', '5217'], {
  cwd: demoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    SNAPBACK_URL: snapbackReady.serverUrl,
    VITE_CONVEX_URL: convexUrl,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: supabaseKey,
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
