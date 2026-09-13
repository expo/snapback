import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../..');
const candidateApp = resolve(process.env.SNAPBACK3_CONTROL_APP ?? 'candidate-app');
const fixtureApp = resolve(process.env.SNAPBACK3_CONTROL_FIXTURE ?? 'fixture-source');
const packageArtifact = resolve(process.env.SNAPBACK3_CONTROL_PACKAGE ?? join(candidateApp, 'node_modules/snapback3'));
const work = resolve(process.env.SNAPBACK3_CONTROL_WORK ?? 'controls-work');
const output = resolve(process.env.SNAPBACK3_CONTROL_OUTPUT ?? join(work, 'result.json'));
const qualification = resolve(process.env.SNAPBACK3_CONTROL_QUALIFICATION
  ?? resolve(repository, '../.llp/ship-runs/snapback3-acquisition-20260912/qualification.md'));
const ownerPort = Number(process.env.SNAPBACK3_CONTROL_OWNER_PORT ?? 54928);
const recipientPort = Number(process.env.SNAPBACK3_CONTROL_RECIPIENT_PORT ?? 54929);
if (ownerPort !== 54928 || recipientPort !== 54929) throw new Error('The acquisition controls own only ports 54928–54929.');

const EXPECTED = Object.freeze({
  principal: 'u0500', principalId: 'dev:u0500', recipient: 'u0001', recipientId: 'dev:u0001',
  conversations: 100, messages: 10_000, chains: 101,
  idsSha256: 'ba91d208c55f77a1a4b792e2eb09407fe774a9814b1358981bbad7950ec984ac',
  canonicalRowsSha256: '86cc3d45609124219c7a74101015da00a96568e06d9b1341b418129fed5a38f2',
  messageFields: ['conversationId', 'edited', 'id', 'replyTo', 'senderId', 'serverTimestamp', 'text', 'tombstone'],
});
const scenarios = [
  { name: 'send-early', threshold: 1 },
  { name: 'send-middle', threshold: 75 },
  { name: 'send-late', threshold: 130 },
  { name: 'send-lost-reply', threshold: 75, lostReply: true },
  { name: 'interrupted-prefix-resume', threshold: 30, interruption: true },
];
const preflight = process.env.SNAPBACK3_CONTROL_PREFLIGHT === '1';
const scenarioPlan = preflight ? [{ name: 'preflight-send-early-lost-reply', threshold: 1, lostReply: true }] : scenarios;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const optionalSha256 = async path => await exists(path) ? { present: true, sha256: await sha256(path) } : { present: false };
const exists = path => stat(path).then(() => true, () => false);
const startTick = async pid => {
  const value = await readFile(`/proc/${pid}/stat`, 'utf8');
  const fields = value.slice(value.lastIndexOf(') ') + 2).trim().split(' ');
  if (!/^\d+$/.test(fields[19] ?? '')) throw new Error(`Cannot read start tick for PID ${pid}.`);
  return fields[19];
};
const alive = async owner => {
  try { return owner && await startTick(owner.pid) === owner.startTick; } catch { return false; }
};
const packagedWorkerAt = app => join(app, 'node_modules/snapback3/dist/native',
  `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'snapback3-worker.exe' : 'snapback3-worker');
async function ownedWorker(owner, expectedPath) {
  const expectedRealPath = await realpath(expectedPath);
  const matches = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const raw = await readFile(`/proc/${entry}/stat`, 'utf8');
      const fields = raw.slice(raw.lastIndexOf(') ') + 2).trim().split(' ');
      if (Number(fields[1]) !== owner.pid) continue;
      const argv = (await readFile(`/proc/${entry}/cmdline`)).toString().split('\0').filter(Boolean);
      if (!argv[0] || await realpath(argv[0]) !== expectedRealPath) continue;
      matches.push({ pid: Number(entry), startTick: fields[19], path: argv[0], realpath: expectedRealPath });
    } catch { /* The process exited while it was inspected. */ }
  }
  if (matches.length !== 1) throw new Error(`Expected one packaged worker child of owner PID ${owner.pid}; found ${matches.map(item => item.pid).join(',') || 'none'}.`);
  return matches[0];
}
const waitFor = async (test, timeout, label) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { if (await test()) return; } catch (error) { last = error; }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last}` : ''}`);
};
const listen = (server, port) => new Promise((done, reject) => {
  server.once('error', reject); server.listen(port, '127.0.0.1', done);
});
const closeServer = server => server ? new Promise(done => server.close(() => done())) : Promise.resolve();
const portFree = async port => {
  const probe = createServer();
  try { await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); }); return true; }
  catch { return false; }
  finally { await closeServer(probe).catch(() => {}); }
};

async function browserOwner(profile) {
  const matches = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = (await readFile(`/proc/${entry}/cmdline`)).toString().replaceAll('\0', ' ');
      if (command.includes(`--user-data-dir=${profile}`) && !command.includes(' --type=')) matches.push({ pid: Number(entry), command });
    } catch { /* The process exited while it was inspected. */ }
  }
  if (matches.length !== 1) throw new Error(`Expected one Chromium owner for ${profile}; found ${matches.map(item => item.pid).join(',') || 'none'}.`);
  return { ...matches[0], startTick: await startTick(matches[0].pid), profile };
}

async function prepareScenarioApp(name) {
  const scenarioDirectory = join(work, name);
  await mkdir(scenarioDirectory);
  const app = join(scenarioDirectory, 'app');
  await mkdir(app);
  for (const entry of await readdir(candidateApp, { withFileTypes: true })) {
    if (entry.name === '.snapback3' || entry.name === 'dist') continue;
    await symlink(join(candidateApp, entry.name), join(app, entry.name), entry.isDirectory() ? 'dir' : 'file');
  }
  await cp(join(candidateApp, 'dist'), join(app, 'dist'), { recursive: true, preserveTimestamps: true });
  await cp(join(fixtureApp, '.snapback3'), join(app, '.snapback3'), { recursive: true, preserveTimestamps: true });
  await cp(join(candidateApp, 'node_modules/snapback3/dist/client.mjs'), join(app, 'dist/control-sdk-client.mjs'));
  return app;
}

async function startOwner(app, runDirectory) {
  const packageJson = JSON.parse(await readFile(join(app, 'node_modules/snapback3/package.json'), 'utf8'));
  const workerPath = packagedWorkerAt(app);
  const worker = { path: workerPath, realpath: await realpath(workerPath), sha256: await sha256(workerPath),
    snapback3WorkerOverrideRemoved: true };
  const log = createWriteStream(join(runDirectory, 'owner.log'), { flags: 'wx' });
  const ownerEnvironment = { ...process.env, NODE_ENV: 'production' };
  delete ownerEnvironment.SNAPBACK3_WORKER;
  const child = spawn(process.execPath,
    [join(app, 'node_modules/snapback3', packageJson.bin.snapback3), 'dev', '.', '--port', String(ownerPort)],
    { cwd: app, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: ownerEnvironment });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let tick;
  try { tick = await startTick(child.pid); }
  catch (error) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    log.end();
    await writeFile(join(runDirectory, 'owner-start-failure.json'), json({ owner: { pid: child.pid, startTick: null, port: ownerPort },
      error: { name: error?.name, message: error?.message, stack: error?.stack } }));
    throw error;
  }
  const value = { owner: { pid: child.pid, startTick: tick, port: ownerPort, worker }, log };
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${ownerPort}/api/manifest`)).ok, 60_000, 'owner manifest');
    value.owner.worker = { ...worker, ...await ownedWorker(value.owner, workerPath) };
    await writeFile(join(runDirectory, 'owner-custody.json'), json(value.owner));
    return value;
  } catch (error) {
    await stopOwner(value);
    await writeFile(join(runDirectory, 'owner-start-failure.json'), json({ owner: value.owner,
      error: { name: error?.name, message: error?.message, stack: error?.stack } }));
    throw error;
  }
}

async function stopOwner(value) {
  if (!value) return;
  if (await alive(value.owner) || await alive(value.owner.worker)) {
    try { process.kill(-value.owner.pid, 'SIGTERM'); } catch {}
    await waitFor(async () => !(await alive(value.owner)) && !(await alive(value.owner.worker)), 10_000, 'owner and worker shutdown').catch(() => {});
    if (await alive(value.owner) || await alive(value.owner.worker)) try { process.kill(-value.owner.pid, 'SIGKILL'); } catch {}
  }
  value.owner.cleaned = !(await alive(value.owner));
  value.owner.worker.cleaned = !(await alive(value.owner.worker));
  value.owner.cleanedAt = new Date().toISOString();
  value.log.end();
}

async function closeBrowser(context, owner, records) {
  try { await context?.close(); } catch {}
  if (owner) {
    await waitFor(async () => !(await alive(owner)), 10_000, 'Chromium shutdown').catch(() => {});
    owner.cleaned = !(await alive(owner)); owner.cleanedAt = new Date().toISOString(); records.push(owner);
  }
}

async function boot(page, persona, expectedPrincipal) {
  await page.waitForFunction(() => Boolean(window.clique && window.acquisitionTarget), undefined, { timeout: 30_000 });
  return page.evaluate(async ({ persona, expectedPrincipal }) => {
    await window.clique.ready;
    const session = await window.clique.auth.persona(persona);
    if (session.principal.id !== expectedPrincipal) throw new Error(`Unexpected principal ${session.principal.id}.`);
    return { principal: session.principal, authEpoch: session.authEpoch };
  }, { persona, expectedPrincipal });
}

async function prepareRecipient(page) {
  return page.evaluate(async () => {
    const client = window.clique;
    const resource = client.watch('messages.latest', { conversationId: 'g0001' });
    window.__controlRecipient = { events: [] };
    window.__controlRecipientUnsubscribe = resource.subscribe(() => {
      const value = resource.getSnapshot();
      window.__controlRecipient.events.push({ at: performance.now(), status: value.status, seq: value.seq,
        ids: (value.data ?? []).map(row => row.id) });
    });
    await resource.refresh();
    return resource.getSnapshot();
  });
}

async function startAcquisition(page, send) {
  await page.evaluate(async send => {
    const { pages } = await import('/control-sdk-client.mjs');
    const client = window.clique;
    const state = window.__controlState = { startedAt: performance.now(), progress: [], operation: null };
    const latest = client.watch('messages.latest', { conversationId: 'g0001' });
    state.latestBefore = await latest.refresh();
    window.__controlLatestUnsubscribe = latest.subscribe(() => {
      const value = latest.getSnapshot();
      state.latest = { at: performance.now(), status: value.status, seq: value.seq,
        ids: (value.data ?? []).map(row => row.id) };
    });
    const spec = {
      id: 'clique-u0500-full-history', revision: 'exact-100-conversations-10000-messages-v1',
      root: pages('conversations.inbox', { c: null }, { key: 'u0500-inbox', cursor: 'c' }),
      expand: conversations => conversations.map(conversation => pages('messages.page',
        { conversationId: conversation.id, c: null }, { key: String(conversation.id), cursor: 'c' })),
    };
    const handle = client.acquire(spec);
    window.__controlHandle = handle; window.__controlSpec = spec;
    let triggered = false;
    const snapshot = () => {
      const value = handle.getSnapshot();
      const observed = { at: performance.now(), status: value.status, pages: value.pages,
        chains: value.chains, seq: value.seq, error: value.error?.code };
      state.progress.push(observed); state.handle = observed;
      if (send && !triggered && value.status === 'acquiring' && value.pages >= send.threshold) {
        triggered = true;
        state.trigger = { ...observed, threshold: send.threshold };
        const operation = client.mutate('messages.send', { id: send.messageId, conversationId: 'g0001', text: send.text, replyTo: null });
        state.operation = { id: operation.id, messageId: send.messageId, text: send.text,
          createdAt: performance.now(), snapshots: [] };
        window.__controlOperation = operation;
        const recordOperation = () => {
          const current = operation.getSnapshot();
          state.operation.snapshots.push({ at: performance.now(), status: current.status,
            receipt: current.receipt, error: current.error?.code });
          state.operation.status = current.status;
          if (current.status === 'committed' && state.operation.observedAt === undefined) state.operation.observedAt = performance.now();
        };
        window.__controlOperationUnsubscribe = operation.subscribe(recordOperation); recordOperation();
        operation.durable.then(() => { state.operation.durableAt = performance.now(); }, error => {
          state.operation.durableError = { name: error?.name, message: error?.message, code: error?.code };
        });
        operation.settled.then(receipt => { state.operation.settledAt = performance.now(); state.operation.receipt = receipt; }, error => {
          state.operation.settledError = { name: error?.name, message: error?.message, code: error?.code };
        });
      }
    };
    window.__controlAcquisitionUnsubscribe = handle.subscribe(snapshot); snapshot();
    handle.completed.then(value => { state.completion = { at: performance.now(), ...value }; }, error => {
      state.completionError = { at: performance.now(), name: error?.name, message: error?.message, code: error?.code };
    });
  }, send);
}

async function acquisitionState(page) {
  return page.evaluate(() => structuredClone({ ...window.__controlState, storageTimings: window.storageTimings ?? [] }));
}

async function recipientAudit(page, messageId, text) {
  return page.evaluate(async ({ messageId, text }) => {
    const client = window.clique;
    const rows = []; const pages = []; const visited = new Set();
    let cursor = null;
    do {
      const encoded = JSON.stringify(cursor);
      if (visited.has(encoded)) throw new Error(`Recipient cursor repeated: ${encoded}.`);
      visited.add(encoded);
      const resource = client.watch('messages.page', { conversationId: 'g0001', c: cursor });
      const snapshot = await resource.refresh();
      if (snapshot.status !== 'ready' || snapshot.data === undefined) throw new Error(`Recipient page unavailable: ${snapshot.status}.`);
      pages.push({ c: cursor, rows: snapshot.data.length, complete: snapshot.complete, seq: snapshot.seq, next: snapshot.next ?? null });
      rows.push(...snapshot.data); cursor = snapshot.next ?? null;
    } while (cursor !== null);
    const matches = rows.filter(row => row.id === messageId);
    if (matches.length !== 1) throw new Error(`Recipient observed ${matches.length} copies of ${messageId}.`);
    const row = matches[0];
    if (row.conversationId !== 'g0001' || row.senderId !== 'dev:u0500' || row.text !== text || row.replyTo !== null
      || row.edited !== false || row.tombstone !== false || !Number.isSafeInteger(row.serverTimestamp))
      throw new Error(`Recipient observed malformed row ${JSON.stringify(row)}.`);
    return { pages, totalRows: rows.length, occurrenceCount: matches.length, row };
  }, { messageId, text });
}

async function historyAudit(page, extra) {
  return page.evaluate(async ({ expected, extra }) => {
    const canonical = value => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    };
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const read = async (op, args) => {
      const snapshot = await window.clique.watch(op, args).refresh();
      if (snapshot.status !== 'ready' || snapshot.data === undefined)
        throw new Error(`${op} ${canonical(args)} unavailable: ${snapshot.status} ${snapshot.error?.code ?? ''}.`);
      return snapshot;
    };
    window.clique.setOnline(false);
    const conversations = []; const messages = []; const pageEvidence = []; const finalPages = [];
    let cursor = null; const inboxVisited = new Set();
    do {
      if (inboxVisited.has(cursor)) throw new Error(`Repeated inbox cursor ${cursor}.`); inboxVisited.add(cursor);
      const value = await read('conversations.inbox', { c: cursor });
      conversations.push(...value.data); pageEvidence.push({ op: 'conversations.inbox', c: cursor,
        rows: value.data.length, complete: value.complete, seq: value.seq, next: value.next ?? null });
      if ((value.next ?? null) === null) finalPages.push(pageEvidence.at(-1)); cursor = value.next ?? null;
    } while (cursor !== null);
    for (const conversation of conversations) {
      cursor = null; const visited = new Set();
      do {
        if (visited.has(cursor)) throw new Error(`Repeated ${conversation.id} cursor ${cursor}.`); visited.add(cursor);
        const value = await read('messages.page', { conversationId: conversation.id, c: cursor });
        messages.push(...value.data); pageEvidence.push({ op: 'messages.page', conversationId: conversation.id, c: cursor,
          rows: value.data.length, complete: value.complete, seq: value.seq, next: value.next ?? null });
        if ((value.next ?? null) === null) finalPages.push(pageEvidence.at(-1)); cursor = value.next ?? null;
      } while (cursor !== null);
    }
    const extras = extra ? messages.filter(row => row.id === extra.messageId) : [];
    const baseline = extra ? messages.filter(row => row.id !== extra.messageId) : messages;
    const sorted = [...baseline].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const ids = sorted.map(row => row.id);
    const uniqueConversations = new Set(conversations.map(row => row.id)).size;
    const uniqueMessages = new Set(messages.map(row => row.id)).size;
    const fields = [...new Set(messages.map(row => Object.keys(row).sort().join(',')))];
    const sequences = [...new Set(pageEvidence.map(page => page.seq))];
    const audit = { conversations: conversations.length, uniqueConversations, messages: messages.length, uniqueMessages,
      pages: pageEvidence.length, chains: finalPages.length, completeFinalPages: finalPages.filter(page => page.complete).length,
      fields, sequences, commonSeq: sequences.length === 1 ? sequences[0] : null,
      baselineIdsSha256: await digest(JSON.stringify(ids)), baselineRowsSha256: await digest(canonical(sorted)),
      extraRows: extras, pageEvidence };
    if (audit.conversations !== expected.conversations || uniqueConversations !== expected.conversations
      || baseline.length !== expected.messages || new Set(baseline.map(row => row.id)).size !== expected.messages
      || audit.chains !== expected.chains || audit.completeFinalPages !== expected.chains
      || sequences.length !== 1 || !Number.isSafeInteger(audit.commonSeq)
      || fields.length !== 1 || fields[0] !== expected.messageFields.join(',')
      || audit.baselineIdsSha256 !== expected.idsSha256 || audit.baselineRowsSha256 !== expected.canonicalRowsSha256)
      throw new Error(`Full retained-history baseline audit failed: ${canonical(audit)}.`);
    if (extra) {
      if (messages.length !== expected.messages + 1 || uniqueMessages !== expected.messages + 1 || extras.length !== 1)
        throw new Error(`Expected exactly one added message: ${canonical(audit)}.`);
      const row = extras[0];
      if (row.conversationId !== 'g0001' || row.senderId !== expected.principalId || row.text !== extra.text
        || row.replyTo !== null || row.edited !== false || row.tombstone !== false || !Number.isSafeInteger(row.serverTimestamp))
        throw new Error(`Added message fields changed: ${canonical(row)}.`);
    }
    return audit;
  }, { expected: EXPECTED, extra });
}

async function shellVersion(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 10_000 });
  return page.evaluate(() => new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Shell version handshake timed out.')), 5_000);
    const listener = event => {
      if (event.data?.type !== 'snapback3-acquisition-shell-version') return;
      clearTimeout(timeout); navigator.serviceWorker.removeEventListener('message', listener); done(event.data.cacheName);
    };
    navigator.serviceWorker.addEventListener('message', listener);
    navigator.serviceWorker.controller.postMessage({ type: 'snapback3-acquisition-shell-version' });
  }));
}

async function runSendScenario(chromium, scenario, app, runDirectory, browsers, result, expectedShellCacheName, proxyState) {
  const profile = join(runDirectory, 'browser-profile');
  let context; let browser;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow', args: ['--no-sandbox'] });
    browser = await browserOwner(profile);
    const sender = context.pages()[0] ?? await context.newPage();
    const senderPort = scenario.lostReply ? recipientPort : ownerPort;
    const recipientActorPort = scenario.lostReply ? ownerPort : recipientPort;
    await sender.goto(`http://127.0.0.1:${senderPort}/`, { waitUntil: 'domcontentloaded' });
    const recipient = await context.newPage(); await recipient.goto(`http://127.0.0.1:${recipientActorPort}/`, { waitUntil: 'domcontentloaded' });
    const sessions = { sender: await boot(sender, EXPECTED.principal, EXPECTED.principalId),
      recipient: await boot(recipient, EXPECTED.recipient, EXPECTED.recipientId) };
    result.value = { sessions };
    await sender.getByText('Busy Group 0001', { exact: true }).click();
    await sender.getByTestId('history-status').waitFor({ state: 'visible' });
    await sender.getByTestId('history-search').fill('busy');
    await sender.waitForFunction(() => document.querySelectorAll('[data-testid^="message-"]').length > 0);
    result.value.foregroundBefore = await sender.evaluate(() => ({
      historyStatus: document.querySelector('[data-testid="history-status"]')?.textContent,
      search: document.querySelector('[data-testid="history-search"]')?.value,
      renderedMessages: document.querySelectorAll('[data-testid^="message-"]').length,
    }));
    await prepareRecipient(recipient);
    const suffix = `${scenario.name}-${Date.now()}`;
    const send = { threshold: scenario.threshold, messageId: `control-${suffix}`, text: `Snapback acquisition ${scenario.name} ${suffix}` };
    result.value.send = send;
    const lostReplyStart = proxyState.lostReplies.length;
    if (scenario.lostReply) proxyState.dropNextSendReply = true;
    await startAcquisition(sender, send);
    await sender.waitForFunction(() => Boolean(window.__controlState?.operation?.id), undefined, { timeout: 60_000 });
    await sender.waitForFunction(() => Boolean(window.__controlState?.operation?.receipt || window.__controlState?.operation?.settledError), undefined,
      { timeout: 60_000 });
    await sender.waitForFunction(() => {
      const state = window.__controlState, receiptSeq = state?.operation?.receipt?.seq;
      return Number.isSafeInteger(receiptSeq) && state.handle?.status === 'ready' && state.handle?.seq >= receiptSeq;
    }, undefined, { timeout: 90_000 });
    await sender.waitForFunction(() => window.__controlState?.operation?.status === 'committed', undefined, { timeout: 30_000 }).catch(() => {});
    const acquisition = await acquisitionState(sender);
    result.value.acquisition = acquisition;
    acquisition.trigger.fractionOfFinalPages = acquisition.trigger.pages / 151;
    if (acquisition.trigger.pages >= 151) throw new Error(`The ${scenario.name} mutation started after all pages were acquired.`);
    if (acquisition.operation.receipt.state !== 'committed') throw new Error(`Send did not commit: ${JSON.stringify(acquisition.operation.receipt)}.`);
    if (acquisition.operation.durableAt === undefined || acquisition.operation.settledAt === undefined)
      throw new Error('Send did not record both durable admission and terminal settlement.');
    acquisition.operation.observation = acquisition.operation.observedAt === undefined
      ? { observed: false, finalStatus: acquisition.operation.status }
      : { observed: true, at: acquisition.operation.observedAt, finalStatus: acquisition.operation.status };
    acquisition.operation.latency = {
      durableMs: acquisition.operation.durableAt - acquisition.operation.createdAt,
      settledMs: acquisition.operation.settledAt - acquisition.operation.createdAt,
      observedMs: acquisition.operation.observedAt === undefined ? null
        : acquisition.operation.observedAt - acquisition.operation.createdAt,
    };
    if (scenario.lostReply) {
      result.value.lostReplies = proxyState.lostReplies.slice(lostReplyStart);
      const lost = result.value.lostReplies[0];
      if (result.value.lostReplies.length !== 1 || lost.request?.intent !== acquisition.operation.id
        || lost.response?.state !== 'committed' || lost.response.intent !== acquisition.operation.id)
        throw new Error(`The lost reply was not recovered under the original operation identity: ${JSON.stringify(result.value.lostReplies)}.`);
    }
    const recipientEvidence = await recipientAudit(recipient, send.messageId, send.text);
    result.value.recipient = recipientEvidence;
    result.value.foregroundAfter = await sender.evaluate(messageId => ({
      historyStatus: document.querySelector('[data-testid="history-status"]')?.textContent,
      search: document.querySelector('[data-testid="history-search"]')?.value,
      renderedMessages: document.querySelectorAll('[data-testid^="message-"]').length,
      latestMessageVisible: Boolean(document.querySelector(`[data-testid="latest-${CSS.escape(messageId)}"]`)),
    }), send.messageId);
    const cacheName = await shellVersion(sender);
    if (cacheName !== expectedShellCacheName) throw new Error(`Unexpected shell cache ${cacheName}.`);
    result.value.cacheName = cacheName;
    await closeBrowser(context, browser, browsers); context = undefined; browser = undefined;

    context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow', args: ['--no-sandbox'] });
    browser = await browserOwner(profile);
    await context.setOffline(true);
    const reopened = context.pages()[0] ?? await context.newPage();
    const navigation = await reopened.goto(`http://127.0.0.1:${senderPort}/`, { waitUntil: 'domcontentloaded' });
    await reopened.waitForFunction(() => Boolean(window.clique), undefined, { timeout: 30_000 });
    await reopened.evaluate(() => window.clique.ready);
    const restored = await reopened.evaluate(() => window.clique.getSnapshot());
    if (restored.principal?.id !== EXPECTED.principalId) throw new Error('Sender session did not restore in the offline browser.');
    const reopenAudit = await historyAudit(reopened, send);
    const reopenedCacheName = await shellVersion(reopened);
    if (cacheName !== reopenedCacheName) throw new Error(`Shell cache changed from ${cacheName} to ${reopenedCacheName}.`);
    if (navigation?.status() !== 200 || navigation?.fromServiceWorker() !== true)
      throw new Error(`Strict offline shell navigation failed: status ${navigation?.status()}, serviceWorker ${navigation?.fromServiceWorker()}.`);
    if (reopenAudit.commonSeq < acquisition.operation.receipt.seq)
      throw new Error(`Offline dataset seq ${reopenAudit.commonSeq} predates send receipt ${acquisition.operation.receipt.seq}.`);
    const reopen = { navigationFromServiceWorker: navigation?.fromServiceWorker() ?? null,
      navigationStatus: navigation?.status() ?? null, cacheName: reopenedCacheName, restored, audit: reopenAudit };
    result.value.reopen = reopen;
    await closeBrowser(context, browser, browsers); context = undefined; browser = undefined;
    return result.value;
  } finally {
    if (context || browser) await closeBrowser(context, browser, browsers);
  }
}

async function runInterruption(chromium, scenario, app, runDirectory, browsers, result, expectedShellCacheName) {
  const profile = join(runDirectory, 'browser-profile');
  let context; let browser;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow', args: ['--no-sandbox'] });
    browser = await browserOwner(profile);
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto(`http://127.0.0.1:${ownerPort}/`, { waitUntil: 'domcontentloaded' });
    const session = await boot(page, EXPECTED.principal, EXPECTED.principalId);
    result.value = { session };
    await startAcquisition(page, null);
    await page.waitForFunction(threshold => window.__controlState?.handle?.status === 'acquiring'
      && window.__controlState.handle.pages >= threshold, scenario.threshold, { timeout: 60_000 });
    await page.evaluate(() => window.clique.setOnline(false));
    await context.setOffline(true);
    await sleep(100);
    const prefix = await acquisitionState(page);
    result.value.prefix = prefix;
    if (prefix.handle.pages >= 151) throw new Error('The interruption missed the durable prefix window.');
    if (prefix.handle.pages < scenario.threshold) throw new Error(`The frozen prefix regressed to ${prefix.handle.pages} pages.`);
    const cacheName = await shellVersion(page);
    if (cacheName !== expectedShellCacheName) throw new Error(`Unexpected shell cache ${cacheName}.`);
    result.value.cacheName = cacheName;
    await closeBrowser(context, browser, browsers); context = undefined; browser = undefined;

    context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow', args: ['--no-sandbox'] });
    browser = await browserOwner(profile);
    page = context.pages()[0] ?? await context.newPage();
    await page.goto(`http://127.0.0.1:${ownerPort}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.clique && window.acquisitionTarget), undefined, { timeout: 30_000 });
    const restored = await page.evaluate(async expectedPrincipal => {
      await window.clique.ready; const value = window.clique.getSnapshot();
      if (value.principal?.id !== expectedPrincipal) throw new Error(`Restored ${value.principal?.id ?? 'no principal'}.`);
      return value;
    }, EXPECTED.principalId);
    result.value.restored = restored;
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    const resumeNetwork = [];
    cdp.on('Network.requestWillBeSent', event => {
      if (new URL(event.request.url).pathname !== '/api/acquire') return;
      let body;
      try { body = JSON.parse(event.request.postData ?? '{}'); } catch { body = null; }
      const chains = body?.chains ?? [];
      resumeNetwork.push({ at: event.timestamp, expectedSeq: body?.expectedSeq ?? null, chains: chains.length,
        phase: chains.length && chains.every(chain => chain.follow === false && typeof chain.validator === 'string')
          ? 'validation' : 'traverse' });
    });
    await startAcquisition(page, null);
    await page.waitForFunction(() => window.__controlState?.handle?.status === 'ready', undefined, { timeout: 120_000 });
    const resumed = await acquisitionState(page);
    result.value.resumed = resumed;
    result.value.resumeNetwork = resumeNetwork;
    if (resumed.handle.pages !== 151 || resumed.handle.chains !== 101) throw new Error(`Resume completed with ${JSON.stringify(resumed.handle)}.`);
    if (!resumeNetwork.some(request => request.phase === 'validation'))
      throw new Error(`Restored acquisition completed without conditional normalization: ${JSON.stringify(resumeNetwork)}.`);
    await context.setOffline(true);
    const audit = await historyAudit(page, null);
    result.value.offlineAudit = audit;
    await closeBrowser(context, browser, browsers); context = undefined; browser = undefined;
    return result.value;
  } finally {
    if (context || browser) await closeBrowser(context, browser, browsers);
  }
}

await stat(candidateApp); await stat(fixtureApp); await stat(packageArtifact); await stat(packagedWorkerAt(candidateApp));
await mkdir(dirname(output), { recursive: true });
await mkdir(work, { recursive: true });
const packagePath = (await stat(packageArtifact)).isDirectory() ? join(packageArtifact, 'package.json') : packageArtifact;
const metadata = {
  test: 'snapback3-acquisition-foreground-write-and-interruption-controls', startedAt: new Date().toISOString(),
  host: hostname(), node: process.version, preflight, candidateApp, fixtureApp, packageArtifact,
  ownerPort, recipientPort, controllerSha256: await sha256(fileURLToPath(import.meta.url)),
  packageSha256: await sha256(packagePath),
  packagedWorker: { path: packagedWorkerAt(candidateApp), realpath: await realpath(packagedWorkerAt(candidateApp)),
    sha256: await sha256(packagedWorkerAt(candidateApp)), snapback3WorkerOverrideRemoved: true },
  inputHashes: {
    appAcquire: await sha256(join(candidateApp, 'src/acquire.ts')),
    appChat: await sha256(join(candidateApp, 'src/chat.tsx')),
    appClient: await sha256(join(candidateApp, 'src/client.tsx')),
    schema: await sha256(join(candidateApp, 'snapback/schema.q')),
    database: await sha256(join(fixtureApp, '.snapback3/store.sqlite')),
    databaseWal: await optionalSha256(join(fixtureApp, '.snapback3/store.sqlite-wal')),
    seed: await sha256(join(fixtureApp, 'snapback/seed.ts')),
    qualification: await sha256(qualification),
  },
  scenarios: [], browserProcesses: [], limits: [
    'Recipient delivery is checked through an independently authenticated actor and ordinary SDK cursor traversal; no push fanout claim is made.',
  ], result: 'failed', finishedAt: null,
};
const serviceWorkerSource = await readFile(join(candidateApp, 'dist/sw.js'), 'utf8');
metadata.inputHashes.distIndex = await sha256(join(candidateApp, 'dist/index.html'));
metadata.inputHashes.distServiceWorker = await sha256(join(candidateApp, 'dist/sw.js'));
metadata.inputHashes.packageJson = await sha256(join(candidateApp, 'package.json'));
metadata.inputHashes.clientBundle = await sha256(join(candidateApp, 'node_modules/snapback3/dist/client.mjs'));
metadata.expectedShellCacheName = JSON.parse(serviceWorkerSource.match(/const CACHE = ("[^"]+")/)?.[1] ?? 'null');
if (!metadata.expectedShellCacheName) throw new Error('The candidate app has no readable content-bound shell cache name.');
let proxy;
const proxyState = { dropNextSendReply: false, lostReplies: [] };
try {
  proxy = createServer((incoming, outgoing) => {
    const forward = (body, dropReply) => {
      const headers = { ...incoming.headers, host: `127.0.0.1:${ownerPort}` };
      if (body) headers['content-length'] = String(body.byteLength);
      const upstream = httpRequest({ host: '127.0.0.1', port: ownerPort, method: incoming.method, path: incoming.url, headers }, response => {
        if (!dropReply) { outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing); return; }
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const encoded = Buffer.concat(chunks);
          let decoded = encoded;
          if (response.headers['content-encoding'] === 'gzip') decoded = gunzipSync(encoded);
          let receipt;
          try { receipt = JSON.parse(decoded.toString('utf8')); } catch { receipt = null; }
          let sentRequest;
          try { sentRequest = JSON.parse(body.toString('utf8')); } catch { sentRequest = null; }
          proxyState.lostReplies.push({ droppedAt: new Date().toISOString(), request: sentRequest,
            status: response.statusCode, encoding: response.headers['content-encoding'] ?? null,
            encodedBytes: encoded.byteLength, encodedSha256: createHash('sha256').update(encoded).digest('hex'), response: receipt });
          outgoing.destroy(new Error('Deliberately dropped committed mutation reply.'));
        });
      });
      upstream.on('error', error => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(String(error)); });
      if (body) upstream.end(body); else incoming.pipe(upstream);
    };
    if (incoming.method === 'POST' && incoming.url === '/api/mutation') {
      const chunks = []; let bytes = 0;
      incoming.on('data', chunk => {
        bytes += chunk.byteLength;
        if (bytes > 1024 * 1024) incoming.destroy(new Error('Control mutation request exceeded 1 MiB.'));
        else chunks.push(chunk);
      });
      incoming.on('end', () => {
        const body = Buffer.concat(chunks);
        let value;
        try { value = JSON.parse(body.toString('utf8')); } catch { value = null; }
        const dropReply = proxyState.dropNextSendReply && value?.op === 'messages.send';
        if (dropReply) proxyState.dropNextSendReply = false;
        forward(body, dropReply);
      });
      return;
    }
    forward(null, false);
  });
  await listen(proxy, recipientPort);
  const firstApp = await prepareScenarioApp(scenarioPlan[0].name);
  const { chromium } = await import(join(firstApp, 'node_modules/playwright/index.mjs'));
  metadata.browserExecutable = chromium.executablePath();
  for (const scenario of scenarioPlan) {
    const result = { name: scenario.name, threshold: scenario.threshold, startedAt: new Date().toISOString(), success: false };
    const runDirectory = join(work, scenario.name);
    let owner;
    try {
      const app = scenario === scenarioPlan[0] ? firstApp : await prepareScenarioApp(scenario.name);
      owner = await startOwner(app, runDirectory);
      result.value = scenario.interruption
        ? await runInterruption(chromium, scenario, app, runDirectory, metadata.browserProcesses, result, metadata.expectedShellCacheName)
        : await runSendScenario(chromium, scenario, app, runDirectory, metadata.browserProcesses, result,
          metadata.expectedShellCacheName, proxyState);
      result.success = true;
    } catch (error) {
      result.error = { name: error?.name, message: error?.message, stack: error?.stack };
    } finally {
      await stopOwner(owner); if (owner) result.owner = owner.owner;
    }
    result.finishedAt = new Date().toISOString(); metadata.scenarios.push(result);
    await writeFile(output, json(metadata));
    if (!result.success) break;
  }
  metadata.result = metadata.scenarios.length === scenarioPlan.length && metadata.scenarios.every(item => item.success) ? 'passed' : 'failed';
} catch (error) {
  metadata.error = { name: error?.name, message: error?.message, stack: error?.stack };
} finally {
  await closeServer(proxy).catch(() => {});
  metadata.finishedAt = new Date().toISOString();
  metadata.cleanup = {
    browsersCleaned: metadata.browserProcesses.every(item => item.cleaned),
    ownersCleaned: metadata.scenarios.every(item => item.owner?.cleaned !== false && item.owner?.worker?.cleaned !== false),
    proxyClosed: true, ownerPortFree: await portFree(ownerPort), recipientPortFree: await portFree(recipientPort),
  };
  await writeFile(output, json(metadata));
  console.log(json(metadata));
}
if (metadata.result !== 'passed' || !metadata.cleanup.browsersCleaned || !metadata.cleanup.ownersCleaned
  || !metadata.cleanup.ownerPortFree || !metadata.cleanup.recipientPortFree) process.exitCode = 1;
