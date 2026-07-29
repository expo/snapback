#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const spacetime = `${process.env.HOME}/.local/bin/spacetime`;
const children = [];

async function waitForDebugPage(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()).catch(() => []);
    const page = pages.find(candidate => candidate.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Chrome debugging page did not become available');
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome evaluation timed out')), 10_000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  socket.close();
  return response.result.result.value;
}

async function launch(label, port) {
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${process.cwd()}/../runtime/chrome-${label}-offline`,
      'http://127.0.0.1:4178/?persona=alice',
    ],
    { stdio: 'ignore' }
  );
  children.push(child);
  return waitForDebugPage(port);
}

async function waitFor(page, expression, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(page, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const connectedWith100 = `document.querySelector('[data-testid="connection-state"]')?.textContent === 'Online' &&
  /100 authorized tasks/.test(document.querySelector('[data-testid="todo-offline-state"]')?.textContent ?? '')`;
const disconnectedWithZero = `document.querySelector('[data-testid="connection-state"]')?.textContent !== 'Online' &&
  document.querySelectorAll('[data-testid^="todo-task-"]').length === 0`;

try {
  const warm = await launch('warm', 9240);
  await waitFor(warm, connectedWith100, 'warm client did not receive initial rows');

  const listener = spawnSync('lsof', ['-tiTCP:3102', '-sTCP:LISTEN'], { encoding: 'utf8' });
  const pid = Number(listener.stdout.trim().split(/\s+/)[0]);
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('could not resolve exact SpacetimeDB listener');
  process.kill(pid, 'SIGTERM');
  await waitFor(warm, disconnectedWithZero, 'warm client retained rows after transport loss');

  const cold = await launch('cold', 9241);
  await waitFor(cold, disconnectedWithZero, 'cold offline client unexpectedly had rows');

  const server = spawn(
    spacetime,
    [
      'start',
      '--listen-addr',
      '127.0.0.1:3102',
      '--data-dir',
      `${process.cwd()}/../runtime/data`,
      '--non-interactive',
    ],
    { detached: true, stdio: 'ignore' }
  );
  server.unref();

  await waitFor(warm, connectedWith100, 'warm client did not recover after server restart');
  await waitFor(cold, connectedWith100, 'cold client did not subscribe after server restart');

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok: true,
    warmClientRowsWhileOffline: 0,
    coldBootRowsWhileOffline: 0,
    warmReconnectRows: 100,
    coldReconnectRows: 100,
    finding: 'native React subscription cache clears on disconnect and is not durable across cold offline boot',
    reconnect: 'provider reconnect resubscribed successfully after server return',
    containsSecretValues: false,
  };
  await mkdir('../receipts', { recursive: true });
  await writeFile('../receipts/offline-smoke.v1.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  for (const child of children) child.kill('SIGTERM');
}
