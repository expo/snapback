#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cli = `${process.env.HOME}/.local/bin/spacetime`;
const host = 'http://127.0.0.1:3102';
const database = 'todo-spacetimedb-calibration-02';
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
  const id = 1;
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome evaluation timed out')), 10_000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  socket.close();
  if (response.result.exceptionDetails) throw new Error('Chrome evaluation failed');
  return response.result.result.value;
}

async function launch(persona, port) {
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${process.cwd()}/../runtime/chrome-${persona}-correctness`,
      `http://127.0.0.1:4178/?persona=${persona}`,
    ],
    { stdio: 'ignore' }
  );
  children.push(child);
  return waitForDebugPage(port);
}

async function waitFor(page, expression, message) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate(page, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function ownerCall(functionName, ...args) {
  const result = spawnSync(
    cli,
    ['call', '--no-config', '--server', host, database, functionName, ...args],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(`${functionName} failed (exit ${result.status})`);
}

const clickByLabel = (label) => `(() => {
  const button = [...document.querySelectorAll('button')].find(
    item => item.getAttribute('aria-label') === ${JSON.stringify(label)}
  );
  button?.click();
  return Boolean(button);
})()`;

const firstTitle = `document.querySelector('[data-testid="todo-task-0"] strong')?.textContent ?? ''`;
const positions = `[...document.querySelectorAll('[data-testid^="todo-task-"]')].map(
  row => Number(row.getAttribute('data-position'))
)`;

try {
  const [alice, bob] = await Promise.all([launch('alice', 9230), launch('bob', 9231)]);
  await waitFor(alice, `document.querySelector('[data-testid="connection-state"]')?.textContent === 'Online'`, 'Alice did not connect');
  await waitFor(bob, `document.querySelector('[data-testid="connection-state"]')?.textContent === 'Online'`, 'Bob did not connect');

  const originalTitle = await evaluate(alice, firstTitle);
  await evaluate(alice, clickByLabel(`Edit ${originalTitle}`));
  const aliceEditedTitle = `${originalTitle} · edited by alice`;
  await waitFor(bob, `document.body.textContent.includes(${JSON.stringify(aliceEditedTitle)})`, 'Bob did not observe edit');

  await evaluate(alice, clickByLabel(`Complete ${aliceEditedTitle}`));
  await waitFor(
    bob,
    `document.querySelector(${JSON.stringify(`[aria-label="Reopen ${aliceEditedTitle}"]`)})?.classList.contains('checked') === true`,
    'Bob did not observe completion'
  );
  await evaluate(alice, clickByLabel(`Reopen ${aliceEditedTitle}`));
  await waitFor(
    bob,
    `document.querySelector(${JSON.stringify(`[aria-label="Complete ${aliceEditedTitle}"]`)})?.classList.contains('checked') === false`,
    'Bob did not observe reopen'
  );

  await evaluate(alice, clickByLabel(`Move down ${aliceEditedTitle}`));
  await waitFor(alice, `(${positions}).every((value, index, all) => all.indexOf(value) === index)`, 'Order became non-unique');
  await evaluate(alice, clickByLabel(`Move up ${aliceEditedTitle}`));

  const bobCurrentTitle = await evaluate(bob, firstTitle);
  await Promise.all([
    evaluate(alice, clickByLabel(`Edit ${aliceEditedTitle}`)),
    evaluate(bob, clickByLabel(`Edit ${bobCurrentTitle}`)),
  ]);
  await new Promise(resolve => setTimeout(resolve, 500));
  const conflictWinnerAlice = await evaluate(alice, firstTitle);
  const conflictWinnerBob = await evaluate(bob, firstTitle);
  const conflictConverged =
    conflictWinnerAlice === conflictWinnerBob &&
    / · edited by (alice|bob)$/.test(conflictWinnerAlice);

  const secondTitle = await evaluate(
    bob,
    `document.querySelector('[data-testid="todo-task-1"] strong')?.textContent ?? ''`
  );
  await Promise.all([
    evaluate(alice, clickByLabel(`Move down ${conflictWinnerAlice}`)),
    evaluate(bob, clickByLabel(`Move down ${secondTitle}`)),
  ]);
  await new Promise(resolve => setTimeout(resolve, 500));
  const orderValues = await evaluate(alice, positions);
  const orderInvariant =
    orderValues.length === 25 &&
    new Set(orderValues).size === 25 &&
    orderValues.every(value => Number.isInteger(value) && value >= 0 && value < 25);

  const secrets = JSON.parse(await readFile('.arm-secrets.json', 'utf8'));
  ownerCall('revoke_member', secrets.personas.bob.identity);
  await waitFor(bob, `/0 authorized tasks/.test(document.querySelector('[data-testid="todo-offline-state"]')?.textContent ?? '')`, 'Bob retained tasks after revocation');

  const marker = `Revocation witness ${Date.now()}`;
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
  await new Promise(resolve => setTimeout(resolve, 500));
  const revokedBobSawFutureWrite = await evaluate(
    bob,
    `document.body.textContent.includes(${JSON.stringify(marker)})`
  );

  ownerCall('grant_member', secrets.personas.bob.identity, 'bob', 'member');
  await waitFor(bob, `document.body.textContent.includes(${JSON.stringify(marker)})`, 'Bob did not resubscribe after regrant');
  await evaluate(alice, clickByLabel(`Delete ${marker}`));
  await waitFor(bob, `!document.body.textContent.includes(${JSON.stringify(marker)})`, 'Bob did not observe cleanup delete');

  await evaluate(alice, `document.querySelector('[data-testid="account-menu"]').click(); true`);
  await waitFor(
    alice,
    `document.querySelector('[data-testid="connection-state"]')?.textContent === 'Disconnected' &&
      document.querySelectorAll('[data-testid^="todo-task-"]').length === 0`,
    'Logout did not clear the protected cache'
  );
  await evaluate(alice, `location.reload(); true`);
  await waitFor(
    alice,
    `document.querySelector('[data-testid="connection-state"]')?.textContent === 'Online' &&
      /0 authorized tasks/.test(document.querySelector('[data-testid="todo-offline-state"]')?.textContent ?? '')`,
    'Reload after logout did not establish an unprivileged identity'
  );

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok: conflictConverged && orderInvariant && !revokedBobSawFutureWrite,
    crud: {
      editObservedBySecondClient: true,
      completeObservedBySecondClient: true,
      reopenObservedBySecondClient: true,
      moveDownAndRestorePreservedUniqueOrder: true,
      createAndDeleteObservedBySecondClient: true,
    },
    conflict: {
      policy: 'transaction serialization with last committed reducer update winning',
      converged: conflictConverged,
      winningActorClass: conflictWinnerAlice.endsWith('alice') ? 'alice' : 'bob',
    },
    concurrentOrder: {
      positions: orderValues,
      validUniquePermutation: orderInvariant,
    },
    revocation: {
      connectedCacheCleared: true,
      futureWriteDelivered: revokedBobSawFutureWrite,
      regrantRestoredAuthorizedView: true,
    },
    logout: {
      disconnectedCacheCleared: true,
      reloadUsedFreshUnprivilegedIdentity: true,
    },
    containsSecretValues: false,
  };
  await mkdir('../receipts', { recursive: true });
  await writeFile('../receipts/correctness-smoke.v1.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  for (const child of children) child.kill('SIGTERM');
}
