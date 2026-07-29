import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { armRoot, logsRoot, stateRoot, vitePort } from './constants.mjs';

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

if (await portOpen(vitePort)) throw new Error(`isolated Vite port ${vitePort} already open`);
await mkdir(logsRoot, { recursive: true });
const clientRoot = path.resolve(armRoot, 'work/client');
const logPath = path.resolve(logsRoot, 'vite.log');
const logFd = openSync(logPath, 'a');
const child = spawn(
  path.resolve(clientRoot, 'node_modules/.bin/vite'),
  ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
  { cwd: clientRoot, detached: true, stdio: ['ignore', logFd, logFd] },
);
child.unref();
await writeFile(path.resolve(stateRoot, 'vite.pid'), `${child.pid}\n`, { mode: 0o600 });
for (let attempt = 0; attempt < 100 && !(await portOpen(vitePort)); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
if (!(await portOpen(vitePort))) throw new Error(`Vite failed to bind ${vitePort}; inspect ${logPath}`);
process.stdout.write(`${JSON.stringify({ ok: true, pid: child.pid, port: vitePort, cwd: clientRoot })}\n`);
