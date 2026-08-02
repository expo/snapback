#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';

import { launchChromeCdp } from '../../../../../../_kit/chrome-process.mjs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const id = 1;
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome evaluation timed out')), 10_000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  socket.close();
  if (result.result.exceptionDetails) throw new Error('Chrome evaluation failed');
  return result.result.result.value;
}

async function launch(persona, _port) {
  const lifecycle = await launchChromeCdp({
    chromeBin: chrome,
    userDataPrefix: `spacetimedb-${persona}-smoke-`,
    initialUrl: `http://127.0.0.1:4178/?persona=${persona}`,
  });
  children.push(lifecycle);
  return waitForDebugPage(lifecycle.debugPort);
}

const snapshotExpression = `({
  connected: document.querySelector('[data-testid="connection-state"]')?.textContent === 'Online',
  visibleTasks: document.querySelectorAll('[data-testid^="todo-task-"]').length,
  cacheText: document.querySelector('[data-testid="todo-offline-state"]')?.textContent ?? ''
})`;

try {
  const [alicePage, bobPage, malloryPage] = await Promise.all([
    launch('alice', 9225),
    launch('bob', 9226),
    launch('mallory', 9227),
  ]);
  await new Promise(resolve => setTimeout(resolve, 1_500));

  const [aliceBefore, bobBefore, mallory] = await Promise.all([
    evaluate(alicePage.webSocketDebuggerUrl, snapshotExpression),
    evaluate(bobPage.webSocketDebuggerUrl, snapshotExpression),
    evaluate(malloryPage.webSocketDebuggerUrl, snapshotExpression),
  ]);

  const marker = `Realtime witness ${Date.now()}`;
  await evaluate(
    alicePage.webSocketDebuggerUrl,
    `(() => {
      const input = document.querySelector('[aria-label="New task title"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(marker)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-testid="todo-add-task"]').click();
      return true;
    })()`
  );
  await new Promise(resolve => setTimeout(resolve, 750));
  const bobSawInsert = await evaluate(
    bobPage.webSocketDebuggerUrl,
    `document.body.textContent.includes(${JSON.stringify(marker)})`
  );

  await evaluate(
    alicePage.webSocketDebuggerUrl,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        item => item.getAttribute('aria-label') === ${JSON.stringify(`Delete ${marker}`)}
      );
      button?.click();
      return Boolean(button);
    })()`
  );
  await new Promise(resolve => setTimeout(resolve, 750));
  const bobAfter = await evaluate(bobPage.webSocketDebuggerUrl, snapshotExpression);
  const bobSawDelete = await evaluate(
    bobPage.webSocketDebuggerUrl,
    `!document.body.textContent.includes(${JSON.stringify(marker)})`
  );

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      aliceBefore.connected &&
      aliceBefore.visibleTasks === 25 &&
      /100 authorized tasks/.test(aliceBefore.cacheText) &&
      bobBefore.connected &&
      /100 authorized tasks/.test(bobBefore.cacheText) &&
      mallory.connected &&
      mallory.visibleTasks === 0 &&
      /0 authorized tasks/.test(mallory.cacheText) &&
      bobSawInsert &&
      bobSawDelete &&
      /100 authorized tasks/.test(bobAfter.cacheText),
    aliceBefore,
    bobBefore,
    mallory,
    bobSawInsert,
    bobSawDelete,
    bobAfter,
    transport: 'SpacetimeDB WebSocket subscription',
    containsSecretValues: false,
  };
  await mkdir('../receipts', { recursive: true });
  await writeFile('../receipts/browser-smoke.v1.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  await Promise.all(children.map((child) => child.stop()));
}
