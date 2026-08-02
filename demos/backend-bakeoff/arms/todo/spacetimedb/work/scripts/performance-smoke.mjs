#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

import { launchChromeCdp } from '../../../../../../_kit/chrome-process.mjs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cli = `${process.env.HOME}/.local/bin/spacetime`;
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

async function launch(persona, _port) {
  const lifecycle = await launchChromeCdp({
    chromeBin: chrome,
    userDataPrefix: `spacetimedb-${persona}-performance-`,
    initialUrl: `http://127.0.0.1:4178/?persona=${persona}`,
  });
  children.push(lifecycle);
  return waitForDebugPage(lifecycle.debugPort);
}

async function waitFor(page, expression, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(page, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function durationOf(command, args, assertion) {
  const started = performance.now();
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const elapsed = performance.now() - started;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status})`);
  assertion?.(result.stdout);
  return elapsed;
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    rawMs: samples.map(value => Number(value.toFixed(3))),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    nearestRankP95Ms: Number(sorted[Math.ceil(0.95 * sorted.length) - 1].toFixed(3)),
  };
}

try {
  const [alice, bob] = await Promise.all([launch('alice', 9250), launch('bob', 9251)]);
  const connected100 = `document.querySelector('[data-testid="connection-state"]')?.textContent === 'Online' &&
    /100 authorized tasks/.test(document.querySelector('[data-testid="todo-offline-state"]')?.textContent ?? '')`;
  await waitFor(alice, connected100, 'Alice did not connect');
  await waitFor(bob, connected100, 'Bob did not connect');

  const readAll = [];
  const buildAll = [];
  for (let index = 0; index < 9; index += 1) {
    readAll.push(durationOf(
      cli,
      [
        'sql',
        '--no-config',
        '--server',
        'http://127.0.0.1:3102',
        '--format',
        'json',
        'todo-spacetimedb-calibration-02',
        'SELECT COUNT(*) AS task_count FROM task',
      ],
      output => {
        if (Number(JSON.parse(output)[0]?.rows?.[0]?.[0]) !== 100) throw new Error('read sample count drift');
      }
    ));
    buildAll.push(durationOf(cli, ['build', '--module-path', 'spacetimedb']));
  }

  const writeAll = [];
  const realtimeAll = [];
  const reconnectAll = [];
  for (let index = 0; index < 9; index += 1) {
    const marker = `Performance witness ${index}-${Date.now()}`;
    const started = performance.now();
    await evaluate(
      alice,
      `(() => {
        const input = document.querySelector('[aria-label="New task title"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(marker)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-testid="todo-add-task"]').click();
        return true;
      })()`
    );
    await waitFor(alice, `document.body.textContent.includes(${JSON.stringify(marker)})`, 'Alice did not settle write');
    writeAll.push(performance.now() - started);
    await waitFor(bob, `document.body.textContent.includes(${JSON.stringify(marker)})`, 'Bob did not receive write');
    realtimeAll.push(performance.now() - started);
    await evaluate(
      alice,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          item => item.getAttribute('aria-label') === ${JSON.stringify(`Delete ${marker}`)}
        );
        button?.click();
        return Boolean(button);
      })()`
    );
    await waitFor(bob, `!document.body.textContent.includes(${JSON.stringify(marker)})`, 'cleanup delete did not settle');

    const reconnectStarted = performance.now();
    await evaluate(alice, 'location.reload(); true');
    await waitFor(alice, connected100, 'Alice did not reconnect after reload');
    reconnectAll.push(performance.now() - reconnectStarted);
  }

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok: true,
    warmups: 2,
    recordedSamples: 7,
    measurements: {
      authoritativeReadCli: summarize(readAll.slice(2)),
      reducerWriteToOriginView: summarize(writeAll.slice(2)),
      reducerWriteToSecondClientPush: summarize(realtimeAll.slice(2)),
      browserReconnectAndResubscribe: summarize(reconnectAll.slice(2)),
      moduleBuild: summarize(buildAll.slice(2)),
    },
    warmupSamplesMs: {
      authoritativeReadCli: readAll.slice(0, 2),
      reducerWriteToOriginView: writeAll.slice(0, 2),
      reducerWriteToSecondClientPush: realtimeAll.slice(0, 2),
      browserReconnectAndResubscribe: reconnectAll.slice(0, 2),
      moduleBuild: buildAll.slice(0, 2),
    },
    scope: 'local standalone, one machine, small frozen Todo dataset; not production scale',
    containsSecretValues: false,
  };
  await mkdir('../receipts', { recursive: true });
  await writeFile('../receipts/performance.v1.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  await Promise.all(children.map((child) => child.stop()));
}
