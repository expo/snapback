// Local Snapback server lifecycle for tests/demos.
//
// @ref LLP 0010#required-tool-surfaces — copies Valet's orchestrator disciplines:
//   reuse an already-running server via a health probe, and tear down with
//   SIGTERM->SIGKILL. The two corrections from that section apply: never serve
//   stale output, and local tooling must exit cleanly.

import { spawn } from 'node:child_process';

export async function startServer({ port = 4399, db = ':memory:', cwd = process.cwd() } = {}) {
  const baseUrl = `http://127.0.0.1:${port}`;

  // Reuse an already-running server (health probe) rather than fighting the port.
  if (await isHealthy(baseUrl)) {
    return { baseUrl, stop: async () => {}, reused: true };
  }

  const args = ['run', '--quiet', '--', '--port', String(port)];
  if (db === ':memory:') args.push('--memory');
  else args.push('--db', db);

  const child = spawn('cargo', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const deadline = Date.now() + 60_000; // first run may compile
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`snapback server exited early (code ${child.exitCode}):\n${log}`);
    }
    if (await isHealthy(baseUrl)) {
      return { baseUrl, reused: false, stop: () => stopChild(child) };
    }
    await sleep(250);
  }
  await stopChild(child);
  throw new Error(`snapback server did not become healthy on ${baseUrl}:\n${log}`);
}

async function isHealthy(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.on('exit', () => { clearTimeout(kill); resolve(); });
    child.kill('SIGTERM');
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
