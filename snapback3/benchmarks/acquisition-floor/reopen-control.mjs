import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const taskDir = path.dirname(new URL(import.meta.url).pathname);
const profile = path.join(taskDir, 'private-results/browser-profile-1');
const html = fs.readFileSync(path.join(taskDir, 'reopen.html'));
const stat = pid => {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid, startTicks: fields[19] };
  } catch { return null; }
};
const browserPids = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' })
  .split('\n')
  .filter(line => line.includes(`--user-data-dir=${profile}`))
  .map(line => Number(line.trim().split(/\s+/)[0]));

assert(fs.existsSync(profile), 'successful measured browser profile missing');
const server = http.createServer((request, response) => {
  if (request.url === '/reopen.html') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': html.length, 'Cache-Control': 'no-store' });
    response.end(html);
  } else { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(54921, '127.0.0.1', resolve); });
const report = {
  kind: 'separate physical browser-profile reopen plus offline-before-IDB-query control; not included in compact floor timings',
  profilePreviouslyClosedAfterMeasuredRepetition: 1,
  pageLoadRequiresNetwork: true,
  offlineFirstShellReopenQualified: false,
  controller: { pid: process.pid, startTicks: stat(process.pid)?.startTicks },
  startedEpochMs: Date.now()
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, args: ['--no-sandbox'] });
  const roots = browserPids();
  assert.equal(roots.length, 1, 'expected one owned Chromium root');
  report.browser = { pid: roots[0], startTicks: stat(roots[0])?.startTicks };
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('http://127.0.0.1:54921/reopen.html', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => window.reopenPageReady === true);
  report.pageLoadedOnlineEpochMs = Date.now();
  await context.setOffline(true);
  report.networkSetOfflineEpochMs = Date.now();
  report.result = await page.evaluate(() => window.runOfflineControl());
  assert.equal(report.result.navigatorOnline, false);
  assert.equal(report.result.historyIndexKeys, 10_000);
  assert.equal(report.result.conversationKeys, 100);
  assert.equal(report.result.exactDigestMatch, true);
  report.status = 'complete';
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack ?? error);
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  report.finishedEpochMs = Date.now();
  report.cleanup = {
    browserSamePidAndStartTickPresent: report.browser ? stat(report.browser.pid)?.startTicks === report.browser.startTicks : null,
    port54921Free: (() => { try { execFileSync('bash', ['-lc', '! ss -ltn "sport = :54921" | tail -n +2 | grep -q .'], { stdio: 'ignore' }); return true; } catch { return false; } })()
  };
  fs.writeFileSync(path.join(taskDir, 'private-results/reopen-control.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'complete') process.exitCode = 1;
}
