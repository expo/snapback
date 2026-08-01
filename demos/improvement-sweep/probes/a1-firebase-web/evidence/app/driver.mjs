// A1 Firebase probe driver: real Chrome (system channel, playwright-core),
// persistent profiles for genuine cold restarts, backend offline simulated
// by aborting all routes to the Firestore/Auth emulators while the page
// origin stays reachable. Reference observations only.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname);
const profiles = { a: join(root, 'profiles', 'client-a'), b: join(root, 'profiles', 'client-b') };
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'http://127.0.0.1:4610/';
const observations = { legs: [], errors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(page, predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await page.evaluate(predicate);
    if (value) return value;
    if (Date.now() >= deadline) {
      const state = await page.evaluate(() => JSON.stringify(window.probeState)).catch(() => 'unreadable');
      throw new Error(`timeout: ${label}\nstate: ${state.slice(0, 800)}`);
    }
    await sleep(50);
  }
}

async function launch(profile, { offline }) {
  await sleep(1_000); // let a dying predecessor release the profile cleanly
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1024, height: 700 },
  });
  if (offline) {
    // Backend unreachable: abort every request to the emulator ports before
    // any page runs. The static page server (4610) stays reachable.
    await context.route(/127\.0\.0\.1:(8181|9199)|localhost:(8181|9199)/, (route) => route.abort('connectionrefused'));
  }
  const page = await context.newPage();
  await page.goto(PAGE);
  return { context, page };
}

const snap = (page) => page.evaluate(() => ({
  phase: window.probeState.phase,
  uid: window.probeState.uid,
  fromCache: window.probeState.fromCache,
  hasPendingWrites: window.probeState.hasPendingWrites,
  rows: window.probeState.rows,
  timings: window.probeState.timings,
  snapshots: window.probeState.snapshots.slice(0, 12),
  errors: window.probeState.errors,
}));

try {
  // ---- leg 0: online seed (client A) ----
  {
    rmSync(join(root, 'profiles'), { recursive: true, force: true });
    mkdirSync(profiles.a, { recursive: true });
    mkdirSync(profiles.b, { recursive: true });
    const { context, page } = await launch(profiles.a, { offline: false });
    const t0 = Date.now();
    await page.evaluate(() => window.probe.init());
    await until(page, () => window.probeState.uid !== null, 'auth ready');
    await page.evaluate(() => window.probe.createRecord('r1', 'Transformer vault reading', 1000));
    await page.evaluate(() => window.probe.createRecord('r2', 'North fence corrosion pass', 2000));
    await page.evaluate(() => window.probe.createRecord('r3', 'Pump house vibration log', 3000));
    await until(page, () => window.probeState.rows.length === 3
      && window.probeState.hasPendingWrites === false
      && window.probeState.fromCache === false, 'seed synced');
    const view = await snap(page);
    observations.legs.push({ leg: '0-seed-online', ms: Date.now() - t0, view });
    await context.close();
  }

  // ---- leg 1: cold-boot retained render, backend unreachable (client A) ----
  {
    const { context, page } = await launch(profiles.a, { offline: true });
    const t0 = Date.now();
    await page.evaluate(() => window.probe.init());
    await until(page, () => window.probeState.rows.length === 3 && window.probeState.fromCache === true,
      'cold retained render offline');
    const view = await snap(page);
    observations.legs.push({
      leg: '1-cold-boot-retained-offline',
      ms: Date.now() - t0,
      renderedFromCache: view.fromCache,
      authRestoredOffline: view.uid !== null,
      view,
    });
    await context.close();
  }

  // ---- leg 2: queue create+update while offline, beside cached rows (client A) ----
  {
    const { context, page } = await launch(profiles.a, { offline: true });
    const t0 = Date.now();
    await page.evaluate(() => window.probe.init());
    await until(page, () => window.probeState.rows.length === 3 && window.probeState.fromCache === true, 'cached rows first');
    await page.evaluate(() => window.probe.createRecord('q1', 'Valve inspection — queued offline', 4000));
    await page.evaluate(() => window.probe.updateNotes('r1', 'offline note from A', 2));
    await until(page, () => window.probeState.rows.length === 4
      && window.probeState.rows.some((r) => r.key === 'q1' && r.pending === true)
      && window.probeState.rows.some((r) => r.key === 'r1' && r.notes === 'offline note from A' && r.pending === true),
      'queued writes rendered WITH cached rows');
    const view = await snap(page);
    observations.legs.push({ leg: '2-queue-offline-with-cached-rows', ms: Date.now() - t0, view });
    await context.close(); // restart while still offline
  }

  // ---- leg 3: offline RESTART with pending queue: cached rows + queued writes still render (client A) ----
  {
    const { context, page } = await launch(profiles.a, { offline: true });
    const t0 = Date.now();
    await page.evaluate(() => window.probe.init());
    await until(page, () => window.probeState.rows.length === 4
      && window.probeState.fromCache === true
      && window.probeState.rows.some((r) => r.key === 'q1' && r.pending === true),
      'restart offline: cached rows AND durable queued writes render together');
    const view = await snap(page);
    observations.legs.push({ leg: '3-offline-restart-pending-queue-renders', ms: Date.now() - t0, view });
    await context.close();
  }

  // ---- leg 4: second client (B) online — no-remote-commit proof + conflicting online edit ----
  const b = await launch(profiles.b, { offline: false });
  {
    const t0 = Date.now();
    await b.page.evaluate(() => window.probe.init());
    await until(b.page, () => window.probeState.rows.length === 3 && window.probeState.hasPendingWrites === false,
      'B sees only committed rows (q1 not committed remotely)');
    await b.page.evaluate(() => window.probe.updateNotes('r1', 'online note from B', 2));
    await until(b.page, () => window.probeState.rows.some((r) => r.key === 'r1' && r.notes === 'online note from B' && r.pending === false),
      'B online edit committed');
    const view = await snap(b.page);
    observations.legs.push({ leg: '4-second-client-precommit-and-conflict-edit', ms: Date.now() - t0, noRemoteCommit: view.rows.length === 3, view });
  }

  // ---- leg 5: client A reconnects: flush, settle, conflict outcome, convergence ----
  {
    const { context, page } = await launch(profiles.a, { offline: false });
    const t0 = Date.now();
    await page.evaluate(() => window.probe.init());
    // cached-first render, then server settlement
    await until(page, () => window.probeState.rows.length === 4, 'A renders (cache-first)');
    const cacheFirst = await snap(page);
    await until(page, () => window.probeState.hasPendingWrites === false
      && window.probeState.fromCache === false
      && window.probeState.rows.filter((r) => r.key === 'q1').length === 1,
      'A settled: queue flushed exactly once');
    const settled = await snap(page);
    // B convergence: q1 arrives, r1 notes settle to the deterministic winner
    await until(b.page, () => window.probeState.rows.length === 4
      && window.probeState.rows.filter((r) => r.key === 'q1').length === 1,
      'B converges to the settled state');
    const bView = await snap(b.page);
    observations.legs.push({
      leg: '5-reconnect-settlement-and-convergence',
      ms: Date.now() - t0,
      cacheFirstRender: { fromCache: cacheFirst.fromCache, rows: cacheFirst.rows.length },
      settledA: { rows: settled.rows.length, q1Count: settled.rows.filter((r) => r.key === 'q1').length, r1Notes: settled.rows.find((r) => r.key === 'r1')?.notes },
      convergedB: { rows: bView.rows.length, q1Count: bView.rows.filter((r) => r.key === 'q1').length, r1Notes: bView.rows.find((r) => r.key === 'r1')?.notes },
      conflictOutcomeIdentical: settled.rows.find((r) => r.key === 'r1')?.notes === bView.rows.find((r) => r.key === 'r1')?.notes,
      view: settled,
    });
    await context.close();
  }

  // ---- leg 6: cleanup — delete probe data, verify empty, tear down ----
  {
    const t0 = Date.now();
    // Delete through the page's own authenticated SDK instance.
    const deleted = await b.page.evaluate(async () => {
      if (typeof window.probeCleanup !== 'function') throw new Error('cleanup helper missing');
      return window.probeCleanup();
    });
    observations.deletedDocs = deleted;
    await until(b.page, () => window.probeState.rows.length === 0, 'probe data deleted (B observes empty)');
    const view = await snap(b.page);
    observations.legs.push({ leg: '6-cleanup-deleted', ms: Date.now() - t0, rowsAfter: view.rows.length });
    await b.context.close();
  }

  observations.ok = true;
} catch (error) {
  observations.ok = false;
  observations.errors.push(String(error?.message ?? error));
} finally {
  writeFileSync(join(root, 'observations.json'), JSON.stringify(observations, null, 2));
  console.log(JSON.stringify({ ok: observations.ok, legs: observations.legs.map((l) => l.leg), errors: observations.errors }, null, 2));
  process.exit(observations.ok ? 0 : 1);
}
