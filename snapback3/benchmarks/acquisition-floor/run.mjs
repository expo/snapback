import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

// @ref LLP 2000#16-making-acquisition-fast — isolate the compact browser data cost before integrating SDK machinery.

const root = process.cwd();
const taskDir = path.dirname(new URL(import.meta.url).pathname);
const fixture = path.join(taskDir, 'fixture');
const lossless = process.env.SNAPBACK3_FLOOR_LOSSLESS === '1';
const resultsDir = path.join(taskDir, lossless ? 'lossless-cohort/private-results' : 'private-results');
const node = '/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node';
const backendOrigin = 'http://127.0.0.1:54920';
const floorOrigin = 'http://127.0.0.1:54921';
const expectedPath = path.join(taskDir, 'expected-u0500-ids.json');
fs.mkdirSync(resultsDir, { recursive: true, mode: 0o700 });

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stat = pid => {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid, state: fields[0], startTicks: fields[19] };
  } catch { return null; }
};
const processRecord = (role, child) => ({ role, pid: child.pid, startTicks: stat(child.pid)?.startTicks, startedEpochMs: Date.now() });
const portFree = port => {
  try {
    execFileSync('bash', ['-lc', `! ss -ltn "sport = :${port}" | tail -n +2 | grep -q .`], { stdio: 'ignore' });
    return true;
  } catch { return false; }
};
const stopOwned = async (record, child) => {
  if (!record || !child || child.exitCode !== null) return { ...record, alreadyExited: true };
  const current = stat(record.pid);
  assert.equal(current?.startTicks, record.startTicks, `refusing to stop changed PID ${record.pid}`);
  child.kill('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null) {
    const same = stat(record.pid);
    assert.equal(same?.startTicks, record.startTicks, `refusing SIGKILL for changed PID ${record.pid}`);
    child.kill('SIGKILL');
  }
  return { ...record, stoppedEpochMs: Date.now(), sameProcessPresent: stat(record.pid)?.startTicks === record.startTicks };
};

const report = {
  kind: 'fixture-only compact representation/transfer/IndexedDB lower-bound diagnostic; not product qualification',
  representation: lossless ? 'lossless-public-sdk-rows' : 'eight-field-message-tuples',
  startedEpochMs: Date.now(),
  host: process.env.HOSTNAME,
  ports: [54920, 54921],
  repetitions: [],
  ownedProcesses: [],
  failures: []
};

let backend;
let server;
try {
  assert(fs.existsSync(path.join(fixture, '.snapback3/store.sqlite')), 'copied fixture database missing');
  assert(fs.existsSync(expectedPath), 'expected ID oracle missing');
  fs.copyFileSync(path.join(taskDir, 'extract.html'), path.join(fixture, 'dist/extract.html'));
  fs.copyFileSync(path.join(fixture, 'node_modules/snapback3/dist/client.mjs'), path.join(fixture, 'dist/floor-client.mjs'));
  const out = fs.openSync(path.join(resultsDir, 'backend.stdout.log'), 'w');
  const err = fs.openSync(path.join(resultsDir, 'backend.stderr.log'), 'w');
  const env = { ...process.env, PATH: `${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin` };
  for (const key of ['SNAPBACK3_WORKER', 'NODE_OPTIONS', 'NODE_PATH', 'CI']) delete env[key];
  backend = spawn(node, ['node_modules/snapback3/dist/cli.mjs', 'dev', '.', '--host', '127.0.0.1', '--port', '54920'], { cwd: fixture, env, stdio: ['ignore', out, err] });
  fs.closeSync(out); fs.closeSync(err);
  const backendRecord = processRecord('snapback3-node-owner', backend);
  report.ownedProcesses.push(backendRecord);
  const healthDeadline = Date.now() + 60_000;
  let health;
  while (Date.now() < healthDeadline) {
    if (backend.exitCode !== null) throw new Error(`backend exited ${backend.exitCode}`);
    try { const response = await fetch(`${backendOrigin}/api/health`); if (response.ok) { health = await response.json(); break; } } catch {}
    await sleep(100);
  }
  assert(health, 'backend health timeout');
  report.backendHealth = health;
  report.ownedProcesses.push({ role: 'snapback3-rust-worker', pid: health.pid, startTicks: stat(health.pid)?.startTicks });

  const extractionProfile = path.join(resultsDir, 'extract-browser-profile');
  assert(!fs.existsSync(extractionProfile), 'extraction profile must be fresh');
  const extractionContext = await chromium.launchPersistentContext(extractionProfile, { headless: true, args: ['--no-sandbox'] });
  const extractionPage = extractionContext.pages()[0] ?? await extractionContext.newPage();
  await extractionPage.goto(`${backendOrigin}/extract.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await extractionPage.waitForFunction(() => window.floorExtract?.status !== 'starting', null, { polling: 500, timeout: 180_000 });
  const extraction = await extractionPage.evaluate(() => window.floorExtract);
  await extractionContext.close();
  assert.equal(extraction.status, 'complete', extraction.error);

  const expectedIds = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  const expectedIdsSha256 = sha(JSON.stringify([...expectedIds].sort()));
  const observedIds = extraction.messages.map(message => message.id);
  const observedIdsSha256 = sha(JSON.stringify([...observedIds].sort()));
  assert.equal(extraction.conversations.length, 100);
  assert.equal(extraction.messages.length, 10_000);
  assert.equal(new Set(observedIds).size, 10_000);
  assert.equal(observedIdsSha256, expectedIdsSha256, 'authorized SDK results differ from fixed fixture oracle');
  report.inputPreparation = {
    actor: extraction.principal,
    publicSdkQueries: true,
    conversations: extraction.conversations.length,
    messages: extraction.messages.length,
    pages: extraction.pages.length,
    inboxPages: extraction.pages.filter(page => page.op === 'conversations.inbox').length,
    messagePages: extraction.pages.filter(page => page.op === 'messages.page').length,
    uniqueMessageIds: new Set(observedIds).size,
    expectedIdsSha256,
    observedIdsSha256,
    exactFixtureIds: observedIdsSha256 === expectedIdsSha256
  };
  report.ownedProcesses[0] = await stopOwned(backendRecord, backend);
  backend = null;
  const workerRecord = report.ownedProcesses.find(record => record.role === 'snapback3-rust-worker');
  if (workerRecord?.startTicks && stat(workerRecord.pid)?.startTicks === workerRecord.startTicks) process.kill(workerRecord.pid, 'SIGTERM');
  await sleep(100);
  workerRecord.sameProcessPresent = stat(workerRecord.pid)?.startTicks === workerRecord.startTicks;

  const expectedFullRowsSha256 = sha(JSON.stringify([...extraction.messages].sort((a, b) => a.id.localeCompare(b.id))));
  report.inputPreparation.expectedFullRowsSha256 = expectedFullRowsSha256;
  const conversations = lossless ? extraction.conversations : extraction.conversations.map(row => [row.id, row]);
  const messages = lossless ? extraction.messages : extraction.messages.map(row => [row.id, row.conversationId, row.senderId, row.text, row.serverTimestamp, row.replyTo ?? null, !!row.edited, !!row.tombstone]);
  const compact = JSON.stringify(lossless
    ? { version: 2, actor: 'u0500', representation: 'lossless-public-sdk-rows', expectedIdsSha256, expectedFullRowsSha256, conversations, messages }
    : { version: 1, actor: 'u0500', expectedIdsSha256, conversations, messages });
  const compactGzip = zlib.gzipSync(compact);
  fs.writeFileSync(path.join(resultsDir, 'compact.json'), compact, { mode: 0o600 });
  report.compact = { rawBytes: Buffer.byteLength(compact), gzipBytes: compactGzip.length, gzipRatio: compactGzip.length / Buffer.byteLength(compact), sha256: sha(compact) };

  const html = fs.readFileSync(path.join(taskDir, lossless ? 'floor-lossless.html' : 'floor.html'));
  let compactRequestCount = 0;
  server = http.createServer((request, response) => {
    if (request.url === '/compact.json') {
      compactRequestCount++;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': compactGzip.length, 'Cache-Control': 'no-store' });
      response.end(compactGzip);
    } else if (request.url === '/' || request.url === '/floor.html') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': html.length, 'Cache-Control': 'no-store' });
      response.end(html);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(54921, '127.0.0.1', resolve); });
  const serverRecord = { role: 'compact-node-owner', pid: process.pid, startTicks: stat(process.pid)?.startTicks, startedEpochMs: Date.now(), inProcess: true };
  report.ownedProcesses.push(serverRecord);

  for (let repetition = 1; repetition <= 3; repetition++) {
    const profile = path.join(resultsDir, `browser-profile-${repetition}`);
    assert(!fs.existsSync(profile), `browser profile ${repetition} must be fresh`);
    const context = await chromium.launchPersistentContext(profile, { headless: true, args: ['--no-sandbox', '--enable-precise-memory-info'] });
    const page = context.pages()[0] ?? await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const network = [];
    cdp.on('Network.loadingFinished', event => network.push({ requestId: event.requestId, encodedDataLength: event.encodedDataLength }));
    const beforePageLoadEpochMs = Date.now();
    const beforePageLoadMonotonicMs = performance.now();
    await page.goto(`${floorOrigin}/floor.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => window.floorResult?.status !== 'running', null, { polling: 50, timeout: 60_000 });
    const result = await page.evaluate(() => window.floorResult);
    const observedAtEpochMs = Date.now();
    const observedAtMonotonicMs = performance.now();
    await context.close();
    assert.equal(result.status, 'complete', result.error);
    assert.equal(lossless ? result.audit.messageRows : result.audit.messageKeys, 10_000);
    assert.equal(result.audit.uniqueMessageIds, 10_000);
    assert.equal(result.audit.historyIndexKeys, 10_000);
    assert.equal(result.audit.conversationKeys, 100);
    if (lossless) assert.equal(result.audit.fullRowDigestMatches, true);
    else {
      assert.equal(result.audit.digestMatches, true);
      assert.equal(result.audit.allExpectedIdsAccessibleThroughHistoryIndex, true);
    }
    report.repetitions.push({
      repetition,
      freshBrowserProfile: true,
      beforePageLoadEpochMs,
      observedAtEpochMs,
      outerBeforeLoadToObservedMs: observedAtMonotonicMs - beforePageLoadMonotonicMs,
      outerBeforeLoadToPrimaryCompleteMs: result.timeOrigin + result.primaryComplete - beforePageLoadEpochMs,
      compactRequests: 1,
      networkCompletedRequests: network.length,
      networkEncodedBytes: network.reduce((sum, row) => sum + row.encodedDataLength, 0),
      result
    });
  }
  await new Promise(resolve => server.close(resolve));
  server = null;
  serverRecord.stoppedEpochMs = Date.now();
  serverRecord.sameProcessPresent = true;
  report.compactEndpointRequests = compactRequestCount;
  report.status = 'complete';
} catch (error) {
  report.status = 'failed';
  report.failures.push(String(error?.stack ?? error));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (backend) {
    const record = report.ownedProcesses.find(item => item.role === 'snapback3-node-owner');
    try { Object.assign(record, await stopOwned(record, backend)); } catch (error) { report.failures.push(`cleanup: ${error}`); }
  }
  report.finishedEpochMs = Date.now();
  report.cleanup = {
    port54920Free: portFree(54920),
    port54921Free: portFree(54921),
    ownedExternalProcessesPresent: report.ownedProcesses.filter(row => !row.inProcess && row.startTicks && stat(row.pid)?.startTicks === row.startTicks).map(row => row.pid)
  };
  fs.writeFileSync(path.join(resultsDir, 'run.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, compact: report.compact, repetitions: report.repetitions.map(row => ({ repetition: row.repetition, outerMs: row.outerBeforeLoadToObservedMs, primaryMs: row.result?.primaryComplete - row.result?.phases?.scriptStart, auditMs: row.result?.phases?.validationAuditComplete - row.result?.phases?.validationAuditStart })), cleanup: report.cleanup, failures: report.failures }, null, 2));
  if (report.status !== 'complete') process.exitCode = 1;
}
