// Team Chat React product-surface acceptance.
//
// @ref LLP 0063#next-application-pressure-tests — this is the executable
// local UI witness for the admitted room/membership/fan-out kernel. The
// profile remains claim-ineligible until every red pressure and hosted gate
// in pressure-profile.v1.json is satisfied.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'team-chat', 'surfaces', 'react');
const backendDir = join(repoRoot, 'demos', 'team-chat', 'snapback');
const chromeBin = process.env.CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const suite = createSuite('team-chat / React local product surface', { expectedChecks: 11 });
const cleanups = [];
const artifactIndex = JSON.parse(readFileSync(join(backendDir, 'generated', 'artifacts.json'), 'utf8'));
const pressureProfile = JSON.parse(readFileSync(join(repoRoot, 'demos', 'team-chat', 'pressure-profile.v1.json'), 'utf8'));
const receiptPressureRows = pressureProfile.pressures.filter(({ id }) =>
  id === 'membership-changes' || id === 'pagination');
const snapbackRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
let roomId;
let preRemovalCursor;

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const urlOk = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
};

if (!existsSync(join(surfaceDir, 'node_modules', '.bin', 'vite'))) {
  console.error(`SNAPBACK_CAPABILITY_REACT_DEPS_MISSING: run bun install --cwd ${surfaceDir}`);
  process.exit(1);
}
if (!existsSync(chromeBin)) {
  console.error('SNAPBACK_CAPABILITY_CHROME_MISSING: set CHROME_BIN');
  process.exit(1);
}

async function spawnVite(apiOrigin) {
  const port = await freePort();
  const child = spawn(
    join(surfaceDir, 'node_modules', '.bin', 'vite'),
    ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
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
  const admin = new SnapbackClient(server.baseUrl, server.clientOptions);
  const generated = (name) => JSON.parse(
    readFileSync(join(backendDir, 'generated', name), 'utf8'),
  );
  await admin.ensureApp({
    intent: 'provision',
    requestedMode: 'dev',
    schema: generated('schema.manifest.json'),
    functions: generated('functions.manifest.json'),
    routes: generated('routes.manifest.json'),
  });
  const viteOrigin = await spawnVite(server.baseUrl);
  const chrome = await launchChromeCdp({
    chromeBin,
    userDataPrefix: 'team-chat-react-',
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
    while (!window.teamChatReady) {
      if (Date.now() >= deadline) throw new Error('team-chat surface never booted');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return await Promise.race([
      window.teamChatReady.then(() => true),
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'boot pending at ' + window.teamChatBootStage + ': ' + document.body.innerText
      )), 20000)),
    ]);
  })()`);

  await suite.check('three independent authority windows boot over generated artifacts', async () => {
    await Promise.all([waitBoot(owner), waitBoot(member), waitBoot(outsider)]);
    const ownerEmpty = await owner.pollText('rooms-empty', 'No rooms yet', 10_000);
    const memberEmpty = await member.pollText('rooms-empty', 'No rooms yet', 10_000);
    const outsiderEmpty = await outsider.pollText('rooms-empty', 'No rooms yet', 10_000);
    if (!ownerEmpty || !memberEmpty || !outsiderEmpty) {
      throw new Error(`empty-state mismatch: ${ownerEmpty} / ${memberEmpty} / ${outsiderEmpty}`);
    }
  });

  await suite.check('owner creates and enters a protected room through the real form', async () => {
    await owner.click('new-room');
    await owner.setValue('create-room-title', 'Compiler Club');
    await owner.click('create-room-submit');
    const title = await owner.pollText('room-title', 'Compiler Club', 10_000);
    if (title !== 'Compiler Club') throw new Error(`room title did not render: ${title}`);
    const connection = await owner.pollText('connection', 'live', 10_000);
    if (!/live/.test(connection ?? '')) throw new Error(`room did not reach live: ${connection}`);
  });

  await suite.check('owner invitation lands live but requires explicit self-accept', async () => {
    await owner.click('invite-member');
    const status = await member.pollText('room-status', 'invited', 10_000);
    if (status !== 'invited') throw new Error(`member invitation missing: ${status}`);
    if (await member.exists('room-view')) throw new Error('pending invite opened the protected room');
    await member.click('accept-invite');
    const title = await member.pollText('room-title', 'Compiler Club', 10_000);
    if (title !== 'Compiler Club') throw new Error(`accepted room did not open: ${title}`);
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

  await suite.check('member traverses three bounded room-history pages through the React UI', async () => {
    roomId = await owner.eval(`document.querySelector('[data-testid="room-view"]')?.dataset.roomId ?? null`);
    if (!roomId) throw new Error('room id missing from product route state');
    for (let index = 0; index < 20; index += 1) {
      const body = `react-history-${String(index).padStart(2, '0')}`;
      await owner.setValue('message-input', body);
      await owner.click('message-send');
      const visible = await member.pollText('message-list', body, 10_000);
      if (!visible?.includes(body)) throw new Error(`history message did not settle: ${body}`);
    }
    await member.click('history-first');
    if (await member.pollText('history-count', '^10 historical messages$', 10_000) !== '10 historical messages') {
      throw new Error('first room-history page did not render');
    }
    await member.click('history-next');
    if (await member.pollText('history-count', '^20 historical messages$', 10_000) !== '20 historical messages') {
      throw new Error('second room-history page did not render');
    }
    await member.click('history-next');
    if (await member.pollText('history-count', '^22 historical messages$', 10_000) !== '22 historical messages') {
      throw new Error('terminal room-history page did not render');
    }
    if (!await member.exists('history-terminal')) throw new Error('terminal history state missing');
  });

  await suite.check('React receipt records cross-user and cross-room cursor refusal', async () => {
    const first = await member.eval(`window.teamChatProductReceipt.query(
      'firstRoomMessagePage', { roomId: ${JSON.stringify(roomId)} }, 'user_member_01')`);
    preRemovalCursor = first?.cursor;
    if (typeof preRemovalCursor !== 'string' || !preRemovalCursor.startsWith('sbpc1.')) {
      throw new Error('React product client did not mint an opaque room cursor');
    }
    const crossUserCode = await outsider.eval(`window.teamChatProductReceipt.query(
      'nextRoomMessagePage',
      { roomId: ${JSON.stringify(roomId)}, after: ${JSON.stringify(preRemovalCursor)} },
      'user_unrelated'
    ).then(() => null, (error) => error?.diagnostic?.code ?? error?.code ?? null)`);
    if (crossUserCode !== 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID') {
      throw new Error(`cross-user refusal mismatch: ${crossUserCode}`);
    }
    const second = await owner.eval(`window.teamChatProductReceipt.mutate(
      'createRoom', { title: 'React Other Room', displayName: 'Owner' }, 'user_owner')`);
    const secondRoomId = second?.result;
    const crossRoomCode = await member.eval(`window.teamChatProductReceipt.query(
      'nextRoomMessagePage',
      { roomId: ${JSON.stringify(secondRoomId)}, after: ${JSON.stringify(preRemovalCursor)} },
      'user_member_01'
    ).then(() => null, (error) => error?.diagnostic?.code ?? error?.code ?? null)`);
    if (crossRoomCode !== 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID') {
      throw new Error(`cross-room refusal mismatch: ${crossRoomCode}`);
    }
  });

  await suite.check('owner removal blanks room, seat, page custody, send authority, and delivery at one product cut', async () => {
    const beforeSeats = await member.eval(`window.teamChatProductReceipt.startSeats('user_member_01')`);
    if (!beforeSeats.some((row) => row.resource === roomId && row.role === 'member')) {
      throw new Error(`member seat missing before removal: ${JSON.stringify(beforeSeats)}`);
    }
    await owner.click('remove-member');
    const removed = await member.pollText('room-status', '^removed$', 10_000);
    if (removed !== 'removed') throw new Error(`removed status missing: ${removed}`);
    if (await member.exists('room-view') || await member.exists('room-history')) {
      throw new Error('protected room or accumulated history remained in React custody');
    }
    const afterSeats = await member.eval(`window.teamChatProductReceipt.pollSeats()`);
    if (afterSeats.some((row) => row.resource === roomId)) {
      throw new Error(`seat survived owner-removal cut: ${JSON.stringify(afterSeats)}`);
    }
    const fresh = await member.eval(`window.teamChatProductReceipt.query(
      'firstRoomMessagePage', { roomId: ${JSON.stringify(roomId)} }, 'user_member_01')`);
    if (fresh.rows.length !== 0 || fresh.cursor != null) {
      throw new Error(`former member history was not blank: ${JSON.stringify(fresh)}`);
    }
    const staleCode = await member.eval(`window.teamChatProductReceipt.query(
      'nextRoomMessagePage',
      { roomId: ${JSON.stringify(roomId)}, after: ${JSON.stringify(preRemovalCursor)} },
      'user_member_01'
    ).then(() => null, (error) => error?.diagnostic?.code ?? error?.code ?? null)`);
    if (staleCode !== 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID') {
      throw new Error(`stale cursor refusal mismatch: ${staleCode}`);
    }
    const sendCode = await member.eval(`window.teamChatProductReceipt.mutate(
      'sendMessage', { roomId: ${JSON.stringify(roomId)}, body: 'forbidden' }, 'user_member_01'
    ).then(() => null, (error) => error?.diagnostic?.code ?? error?.code ?? null)`);
    if (sendCode !== 'SNAPBACK_AUTH_PERMISSION_DENIED') {
      throw new Error(`removed send refusal mismatch: ${sendCode}`);
    }
    await owner.setValue('message-input', 'after removal boundary');
    await owner.click('message-send');
    await owner.pollText('message-list', 'after removal boundary', 10_000);
    if (await member.exists('unread-count')) throw new Error('post-removal delivery reopened room UI');
  });

  await suite.check('invitation, self-accept, self-leave, and stale-cursor fencing survive owner removal', async () => {
    await owner.click('invite-member');
    const invited = await member.pollText('room-status', '^invited$', 10_000);
    if (invited !== 'invited') throw new Error(`re-invitation missing: ${invited}`);
    await member.click('accept-invite');
    const restored = await member.pollText('room-title', 'Compiler Club', 10_000);
    if (restored !== 'Compiler Club') throw new Error(`rejoined room missing: ${restored}`);
    const staleCode = await member.eval(`window.teamChatProductReceipt.query(
      'nextRoomMessagePage',
      { roomId: ${JSON.stringify(roomId)}, after: ${JSON.stringify(preRemovalCursor)} },
      'user_member_01'
    ).then(() => null, (error) => error?.diagnostic?.code ?? error?.code ?? null)`);
    if (staleCode !== 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID') {
      throw new Error(`rejoin revived old cursor: ${staleCode}`);
    }
    await member.click('leave-room');
    const left = await member.pollText('room-status', '^left$', 10_000);
    if (left !== 'left') throw new Error(`left status missing: ${left}`);
    if (await member.exists('room-view')) throw new Error('room remained open after leave');
    await owner.click('invite-member');
    const invitedAgain = await member.pollText('room-status', '^invited$', 10_000);
    if (invitedAgain !== 'invited') throw new Error(`second re-invitation missing: ${invitedAgain}`);
    await member.click('accept-invite');
    const restoredAgain = await member.pollText('room-title', 'Compiler Club', 10_000);
    if (restoredAgain !== 'Compiler Club') throw new Error(`second rejoin missing: ${restoredAgain}`);
    const unread = await member.text('unread-count');
    if (unread !== '0 unread') throw new Error(`old inbox rows survived rejoin: ${unread}`);
  });

  await suite.check('post-rejoin delivery works and unrelated authority remains empty', async () => {
    await owner.setValue('message-input', 'welcome back');
    await owner.click('message-send');
    const restored = await member.pollText('message-list', 'welcome back', 10_000);
    if (!/welcome back/.test(restored ?? '')) throw new Error(`post-rejoin delivery missing: ${restored}`);
    const outsiderEmpty = await outsider.text('rooms-empty');
    if (outsiderEmpty !== 'No rooms yet.') {
      throw new Error(`room activity leaked to outsider: ${outsiderEmpty}`);
    }
  });
}, {
  cleanups,
  reportExtra: {
    demo: 'team-chat',
    surface: 'react',
    profileId: 'team-chat/local-pressure-v0',
    targetProfile: 'local-dev-sqlite-ibex',
    snapbackRevision,
    generatedArtifactHashes: {
      inputsHash: artifactIndex.inputsHash,
      bundleHash: artifactIndex.bundleHash,
      schemaHash: artifactIndex.schemaHash,
    },
    pressureRows: receiptPressureRows,
    refusalCodes: [
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'SNAPBACK_AUTH_PERMISSION_DENIED',
    ],
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
        setValue: (testId, value) => evaluate(`(() => {
          const element = document.querySelector('${selector(testId)}');
          if (!element) throw new Error('missing input ${testId}');
          const prototype = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
          element.dispatchEvent(new Event('input', { bubbles: true }));
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
      };
    },
  };
}
