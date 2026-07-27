// Team Chat Contract product-surface acceptance.
//
// @ref LLP 0063#next-application-pressure-tests — this is the executable
// local Contract witness for the admitted room/membership/fan-out kernel.
// The profile remains claim-ineligible while its red pressures and hosted
// gates remain unsatisfied.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'team-chat', 'surfaces', 'contract');
const backendDir = join(repoRoot, 'demos', 'team-chat', 'snapback');
const chromeBin = process.env.CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const suite = createSuite('team-chat / Contract local product surface', { expectedChecks: 8 });
const cleanups = [];

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const urlOk = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
};

if (!existsSync(join(surfaceDir, 'node_modules', '.bin', 'vite'))) {
  console.error(`SNAPBACK_CAPABILITY_CONTRACT_DEPS_MISSING: run bun install --cwd ${surfaceDir}`);
  process.exit(1);
}
if (!existsSync(chromeBin)) {
  console.error('SNAPBACK_CAPABILITY_CHROME_MISSING: set CHROME_BIN');
  process.exit(1);
}

async function spawnVite(apiOrigin) {
  const port = await freePort();
  const child = spawn(
    'bun',
    [
      '--bun',
      'node_modules/.bin/vite',
      '--config',
      'vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: surfaceDir,
      env: { ...process.env, SNAPBACK_TEAM_CHAT_API: apiOrigin },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  cleanups.push(() => child.kill('SIGTERM'));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await urlOk(origin)) return origin;
    if (child.exitCode !== null) throw new Error(`Vite exited before readiness:\n${output}`);
    await sleep(100);
  }
  throw new Error(`Vite did not become ready:\n${output}`);
}

await runAcceptance(suite, async () => {
  const server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    provenance: {
      appId: 'team-chat',
      artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
    },
  });
  cleanups.push(() => server.stop());
  const viteOrigin = await spawnVite(server.baseUrl);
  const chrome = await launchChromeCdp({
    chromeBin,
    userDataPrefix: 'team-chat-contract-',
  });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());

  const owner = await cdp.newPage();
  const member = await cdp.newPage();
  const outsider = await cdp.newPage();
  await owner.navigate(`${viteOrigin}/?user=owner`);
  await member.navigate(`${viteOrigin}/?user=member`);
  await outsider.navigate(`${viteOrigin}/?user=outsider`);

  const waitBoot = (page) => page.eval(`(async () => {
    const deadline = Date.now() + 30000;
    while (!window.teamChatContractReady) {
      if (Date.now() >= deadline) throw new Error('team-chat Contract surface never booted');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return window.teamChatContractReady;
  })()`);

  await suite.check('three independent authority windows boot compiled Contract over generated artifacts', async () => {
    const states = await Promise.all([waitBoot(owner), waitBoot(member), waitBoot(outsider)]);
    if (states.some((state) => state.screen !== 'rooms' || state.claimEligible !== false)) {
      throw new Error(`unexpected boot state: ${JSON.stringify(states)}`);
    }
    const emptyStates = await Promise.all([
      owner.pollText('rooms-empty', 'No rooms yet', 10_000),
      member.pollText('rooms-empty', 'No rooms yet', 10_000),
      outsider.pollText('rooms-empty', 'No rooms yet', 10_000),
    ]);
    if (emptyStates.some((value) => !/No rooms yet/.test(value ?? ''))) {
      throw new Error(`empty-state mismatch: ${JSON.stringify(emptyStates)}`);
    }
  });

  await suite.check('owner creates and opens a protected room through compiled actions', async () => {
    await owner.setValue('room-title-input', 'Compiler Club');
    await owner.click('create-room');
    const card = await owner.pollPrefixText('room-card-', 'owner', 10_000);
    if (!/owner/.test(card ?? '')) throw new Error(`owner room card missing: ${card}`);
    await owner.clickPrefix('open-room-');
    const title = await owner.pollText('room-title', 'Compiler Club', 10_000);
    if (title !== '#Compiler Club') throw new Error(`room title did not render: ${title}`);
    const connection = await owner.pollText('room-connection', 'live', 10_000);
    if (!/live/.test(connection ?? '')) throw new Error(`room did not reach live: ${connection}`);
  });

  await suite.check('owner invitation lands live but requires explicit self-accept', async () => {
    await owner.click('invite-member');
    const status = await member.pollText('room-status', 'invited', 10_000);
    if (!/invited/.test(status ?? '')) throw new Error(`member invitation missing: ${status}`);
    if (await member.exists('team-chat-room')) throw new Error('pending invite opened the protected room');
    await member.clickPrefix('accept-invite-');
    const accepted = await member.pollText('room-status', 'member', 10_000);
    if (!/member/.test(accepted ?? '')) throw new Error(`accepted membership missing: ${accepted}`);
    await member.clickPrefix('open-room-');
    const title = await member.pollText('room-title', 'Compiler Club', 10_000);
    if (title !== '#Compiler Club') throw new Error(`accepted room did not open: ${title}`);
  });

  await suite.check('message fan-out reaches the member and increments unread state', async () => {
    await owner.setValue('message-input', 'hello protected room');
    await owner.click('message-send');
    const message = await member.pollText('message-list', 'hello protected room', 10_000);
    if (!/hello protected room/.test(message ?? '')) throw new Error(`member message missing: ${message}`);
    const unread = await member.pollText('unread-count', '^1 unread$', 10_000);
    if (unread !== '1 unread') throw new Error(`member unread count wrong: ${unread}`);
  });

  await suite.check('mark-read settles only the member inbox', async () => {
    await member.click('unread-count');
    const unread = await member.pollText('unread-count', '^0 unread$', 10_000);
    if (unread !== '0 unread') throw new Error(`unread did not clear: ${unread}`);
    const ownerUnread = await owner.text('unread-count');
    if (ownerUnread !== '0 unread') throw new Error(`sender acquired unread state: ${ownerUnread}`);
  });

  await suite.check('member reply propagates back to the owner', async () => {
    await member.setValue('message-input', 'reply from member');
    await member.click('message-send');
    const message = await owner.pollText('message-list', 'reply from member', 10_000);
    if (!/reply from member/.test(message ?? '')) throw new Error(`owner reply missing: ${message}`);
  });

  await suite.check('self-leave revokes the room, then re-invite restores access without old inbox rows', async () => {
    await member.click('leave-room');
    const locked = await member.pollText('room-locked', 'no longer available', 10_000);
    if (!/no longer available/.test(locked ?? '')) {
      throw new Error(`revoked room did not lock: ${locked}`);
    }
    await member.click('locked-back-to-rooms');
    const left = await member.pollText('room-status', 'left', 10_000);
    if (!/left/.test(left ?? '')) throw new Error(`left status missing: ${left}`);
    if (await member.exists('team-chat-room')) throw new Error('room remained open after leave');
    await owner.click('invite-member');
    const invited = await member.pollText('room-status', 'invited', 10_000);
    if (!/invited/.test(invited ?? '')) throw new Error(`re-invitation missing: ${invited}`);
    await member.clickPrefix('accept-invite-');
    const accepted = await member.pollText('room-status', 'member', 10_000);
    if (!/member/.test(accepted ?? '')) throw new Error(`reaccepted membership missing: ${accepted}`);
    await member.clickPrefix('open-room-');
    const restored = await member.pollText('room-title', 'Compiler Club', 10_000);
    if (restored !== '#Compiler Club') throw new Error(`rejoined room missing: ${restored}`);
    const unread = await member.text('unread-count');
    if (unread !== '0 unread') throw new Error(`old inbox rows survived rejoin: ${unread}`);
  });

  await suite.check('post-rejoin delivery works and unrelated authority remains empty', async () => {
    await owner.setValue('message-input', 'welcome back');
    await owner.click('message-send');
    const restored = await member.pollText('message-list', 'welcome back', 10_000);
    if (!/welcome back/.test(restored ?? '')) throw new Error(`post-rejoin delivery missing: ${restored}`);
    const outsiderEmpty = await outsider.text('rooms-empty');
    if (!/No rooms yet/.test(outsiderEmpty ?? '')) {
      throw new Error(`room activity leaked to outsider: ${outsiderEmpty}`);
    }
  });
}, {
  cleanups,
  reportExtra: {
    demo: 'team-chat',
    surface: 'contract',
    profileId: 'team-chat/local-pressure-v0',
    claimEligible: false,
  },
});

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  };
  const rejectAll = (reason) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason));
  };
  socket.addEventListener('message', async (event) => {
    const text = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(text);
    if (message.id && pending.has(message.id)) {
      const entry = settle(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result ?? {});
    }
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify(sessionId
      ? { id, method, params, sessionId }
      : { id, method, params }));
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectCommand(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
    });
  };
  return {
    close: () => socket.close(),
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      const evaluate = async (expression) => {
        const result = await send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true, userGesture: true },
          sessionId,
        );
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result?.value;
      };
      const selector = (testId) => `[data-testid="${testId}"]`;
      const prefixSelector = (prefix) => `[data-testid^="${prefix}"]`;
      return {
        navigate: (target) => send('Page.navigate', { url: target }, sessionId),
        eval: evaluate,
        text: (testId) => evaluate(`document.querySelector('${selector(testId)}')?.textContent.trim() ?? null`),
        exists: (testId) => evaluate(`!!document.querySelector('${selector(testId)}')`),
        click: (testId) => evaluate(`(() => {
          const element = document.querySelector('${selector(testId)}');
          if (!element) throw new Error('missing element ${testId}');
          element.click();
          return true;
        })()`),
        clickPrefix: (prefix) => evaluate(`(() => {
          const element = document.querySelector('${prefixSelector(prefix)}');
          if (!element) throw new Error('missing element prefix ${prefix}');
          element.click();
          return true;
        })()`),
        setValue: (testId, value) => evaluate(`(() => {
          const element = document.querySelector('${selector(testId)}');
          if (!element) throw new Error('missing input ${testId}');
          const target = element.matches('input, textarea')
            ? element
            : element.querySelector('input, textarea');
          if (!target) throw new Error('no input inside ${testId}');
          const prototype = target instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(target, ${JSON.stringify(value)});
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`),
        pollText: (testId, pattern, milliseconds) => evaluate(`(async () => {
          const deadline = Date.now() + ${milliseconds};
          let value = null;
          while (Date.now() < deadline) {
            value = document.querySelector('${selector(testId)}')?.textContent.trim() ?? null;
            if (value !== null && new RegExp(${JSON.stringify(pattern)}).test(value)) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return value;
        })()`),
        pollPrefixText: (prefix, pattern, milliseconds) => evaluate(`(async () => {
          const deadline = Date.now() + ${milliseconds};
          let value = null;
          while (Date.now() < deadline) {
            value = document.querySelector('${prefixSelector(prefix)}')?.textContent.trim() ?? null;
            if (value !== null && new RegExp(${JSON.stringify(pattern)}).test(value)) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return value;
        })()`),
      };
    },
  };
}
