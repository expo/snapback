import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createClient } from '../packages/snapback3/src/client.ts';
import { startProject } from '../packages/snapback3/src/node/project.ts';
import type { StoredOperation } from '../packages/snapback3/src/resource/types.ts';
import { writeServiceWorker } from '../examples/chat/build-shell.mjs';

const chrome = process.env.SNAPBACK3_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const app = fileURLToPath(new URL('../examples/chat', import.meta.url));
const screenshots = { desktop: '/tmp/snapback3-desktop-final.png', mobile: '/tmp/snapback3-mobile-final.png' };
let root: string;
let owner: Awaited<ReturnType<typeof startProject>>;
let browser: Browser;
const contexts = new Set<BrowserContext>();

async function until<T>(read: () => Promise<T>, accepted: (value: T) => boolean, description: string, timeout = 10_000): Promise<T> {
  const end = Date.now() + timeout;
  let last: T;
  do {
    last = await read();
    if (accepted(last)) return last;
    await new Promise(done => setTimeout(done, 50));
  } while (Date.now() < end);
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(last!)}`);
}

async function context(viewport = { width: 1440, height: 960 }) {
  const result = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
  result.setDefaultTimeout(10_000);
  contexts.add(result);
  return result;
}

async function open(context: BrowserContext, errors: string[]) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(owner.url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Design studio', level: 1 }).waitFor();
  await page.locator('article.message').first().waitFor();
  return page;
}

async function installedShell(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // The app never forces a reload. This explicit test visit verifies the
  // installed worker controls a page before the network is removed.
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  await page.locator('article.message').first().waitFor();
}

async function shellCache(page: Page) {
  return page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith(`commonroom-shell:${location.origin}/:`));
    return Promise.all(names.map(async name => ({
      name,
      paths: (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname),
    })));
  });
}

function message(page: Page, body: string) {
  return page.locator('article.message').filter({ has: page.getByText(body, { exact: true }) });
}

async function journal(page: Page): Promise<{ principal: string | null; frameSeq: number | null; operations: StoredOperation[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((done, reject) => {
      const request = indexedDB.open(`snapback3:${location.origin}`);
      request.onsuccess = () => done(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction(['state', 'operations'], 'readonly');
      const value = (request: IDBRequest) => new Promise<any>((done, reject) => {
        request.onsuccess = () => done(request.result);
        request.onerror = () => reject(request.error);
      });
      const [session, frame, operations] = await Promise.all([
        value(transaction.objectStore('state').get('session')),
        value(transaction.objectStore('state').get('frame')),
        value(transaction.objectStore('operations').getAll()),
      ]);
      return { principal: session?.principal.id ?? null, frameSeq: frame?.seq ?? null, operations };
    } finally { db.close(); }
  });
}

async function operationFor(page: Page, body: string) {
  const state = await journal(page);
  return state.operations.find(operation => JSON.parse(operation.body).args.body === body);
}

async function settled(page: Page, body: string) {
  const operation = await until(() => operationFor(page, body), operation => operation?.status === 'committed' && operation.observed === true, `durable and observed commit for ${body}`);
  expect(operation!.receipt?.state).toBe('committed');
  expect(operation!.receipt?.intent).toBe(operation!.id);
  return operation!;
}

beforeAll(async () => {
  // Browser absence is a real failure. Do not turn missing built artifacts or
  // a non-working native worker into a successful skipped product witness.
  await access(chrome);
  await access(join(app, 'dist/public/index.html'));
  root = await mkdtemp(join(tmpdir(), 'snapback3-browser-'));
  await cp(join(app, 'snapback'), join(root, 'snapback'), { recursive: true });
  await cp(join(app, 'dist/public'), join(root, 'dist/public'), { recursive: true });
  owner = await startProject({ root, dev: true, port: 0, log: message => console.error(message) });
  browser = await chromium.launch({ executablePath: chrome, headless: true });
}, 30_000);

afterAll(async () => {
  await Promise.all([...contexts].map(context => context.close()));
  await browser?.close();
  await owner?.close();
  if (root) await rm(root, { recursive: true, force: true });
}, 15_000);

// @ref LLP 2000#4-reference-applications-as-an-executable-design — exercise the
// real built application, browser persistence, and server through public APIs.
describe('Commonroom in real Chrome', () => {
  test('seeded screen, accepted send/edit, saved draft, and another person sees live delivery', async () => {
    const errors: string[] = [];
    const aliceContext = await context(), bobContext = await context();
    const alice = await open(aliceContext, errors);
    const bob = await open(bobContext, errors);
    await bob.getByRole('combobox', { name: 'YOU’RE HERE AS' }).selectOption('bob');
    await until(() => bob.getByRole('combobox', { name: 'YOU’RE HERE AS' }).inputValue(), value => value === 'bob', 'Bob identity');
    await bob.getByRole('heading', { name: 'Design studio', level: 1 }).waitFor();
    expect(await alice.locator('article.message').count()).toBe(14);
    const draft = 'Keep this thought while I close the page.';
    await alice.getByRole('textbox', { name: 'Message Design studio', exact: true }).fill(draft);
    await alice.reload({ waitUntil: 'domcontentloaded' });
    await until(() => alice.getByRole('textbox', { name: 'Message Design studio', exact: true }).inputValue(), value => value === draft, 'draft after reload');
    const sent = 'A real browser send, with a quieter first step.';
    await alice.getByRole('textbox', { name: 'Message Design studio', exact: true }).fill(sent);
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await message(alice, sent).waitFor();
    await message(bob, sent).waitFor();
    await settled(alice, sent);
    expect(await message(alice, sent).count()).toBe(1);
    expect(await message(bob, sent).count()).toBe(1);
    await message(alice, sent).getByRole('button', { name: /^Edit message:/ }).click();
    const edited = 'A real browser edit, with room for one better idea.';
    await alice.getByRole('textbox', { name: 'Edit your message', exact: true }).fill(edited);
    await alice.getByRole('button', { name: 'Save edit', exact: true }).click();
    await message(alice, edited).getByText('edited', { exact: true }).waitFor();
    await message(bob, edited).waitFor();
    await settled(alice, edited);
    expect(await message(alice, sent).count()).toBe(0);
    expect(await message(bob, edited).count()).toBe(1);
    await alice.screenshot({ path: screenshots.desktop });
    expect(errors).toEqual([]);
    await aliceContext.close(); contexts.delete(aliceContext);
    await bobContext.close(); contexts.delete(bobContext);
  }, 60_000);

  test('actual IndexedDB queue survives page close/reopen and commits once after reconnect', async () => {
    const errors: string[] = [];
    const savedContext = await context();
    let page = await open(savedContext, errors);
    await installedShell(page);
    const caches = await shellCache(page);
    expect(caches).toHaveLength(1);
    expect(caches[0].paths).toContain('/index.html');
    expect(caches[0].paths.every(path => /^\/(?:index\.html|app-[A-Za-z0-9_-]+\.(?:js|css))$/.test(path))).toBe(true);
    const body = 'Saved offline, reopened, and delivered exactly once.';
    const sentBodies: string[] = [];
    savedContext.on('request', request => {
      if (new URL(request.url()).pathname === '/api/mutation') {
        const bytes = request.postData();
        if (bytes && JSON.parse(bytes).args?.body === body) sentBodies.push(bytes);
      }
    });
    await page.getByRole('button', { name: 'Try working offline', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message Design studio', exact: true }).fill(body);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Saved on this device · waiting to send', { exact: true }).waitFor();
    const stored = await operationFor(page, body);
    expect(stored?.status).toBe('queued');
    expect(stored?.principal).toBe('dev:alice');
    expect(stored?.receipt).toBeUndefined();
    expect(sentBodies).toEqual([]);
    await savedContext.setOffline(true);
    await page.close();
    page = await open(savedContext, errors);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.getByText('Saved on this device · waiting to send', { exact: true }).waitFor();
    const reopened = await operationFor(page, body);
    expect(reopened?.id).toBe(stored?.id);
    expect(reopened?.body).toBe(stored?.body);
    expect(reopened?.status).toBe('queued');
    expect(sentBodies).toEqual([]);
    await savedContext.setOffline(false);
    await message(page, body).waitFor();
    const receipt = await settled(page, body);
    expect(receipt.id).toBe(stored!.id);
    expect(sentBodies).toEqual([stored!.body]);
    expect(await message(page, body).count()).toBe(1);
    // A further reload must use the persisted terminal, never resubmit it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await message(page, body).waitFor();
    expect((await operationFor(page, body))?.receipt).toEqual(receipt.receipt);
    expect(sentBodies).toEqual([stored!.body]);
    const audit = createClient({ url: owner.url, storage: false, live: false });
    try {
      await audit.ready; await audit.auth.persona('alice');
      const rows = await audit.query<any[]>('messages.page', { conversationId: 'studio', c: null });
      expect(rows.filter(row => row.body === body)).toHaveLength(1);
    } finally { audit.close(); }
    expect(errors).toEqual([]);
    await savedContext.close(); contexts.delete(savedContext);
  }, 60_000);

  test('a new shell waits for old tabs, preserves their draft, and caches no API responses', async () => {
    const errors: string[] = [];
    const updateContext = await context();
    let page = await open(updateContext, errors);
    await installedShell(page);
    const initial = await shellCache(page);
    expect(initial).toHaveLength(1);
    const output = join(root, 'dist/public');
    const oldHtml = await readFile(join(output, 'index.html'), 'utf8');
    const oldWorker = await readFile(join(output, 'service-worker.js'), 'utf8');
    try {
      const draft = 'An installing update must leave these words alone.';
      await page.getByRole('textbox', { name: 'Message Design studio', exact: true }).fill(draft);
      const beforeTitle = await page.title();
      await writeFile(join(output, 'index.html'), oldHtml.replace('<title>', '<title>Updated '));
      const next = await writeServiceWorker(output, initial[0].paths.map(path => path.slice(1)));
      await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
      await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
      expect(await page.title()).toBe(beforeTitle);
      expect(await page.getByRole('textbox', { name: 'Message Design studio', exact: true }).inputValue()).toBe(draft);
      const waiting = await shellCache(page);
      expect(waiting.map(cache => cache.name)).toContain(initial[0].name);
      expect(waiting.some(cache => cache.name.endsWith(next.version))).toBe(true);
      expect(waiting).toHaveLength(2);
      expect(waiting.flatMap(cache => cache.paths).some(path => path.startsWith('/api/'))).toBe(false);
      const workers = await Promise.all(updateContext.serviceWorkers().map(async worker => ({ worker, version: await worker.evaluate<string>('VERSION') })));
      const candidate = workers.find(worker => worker.version === next.version)!.worker;
      await page.close();
      await until(() => candidate.evaluate<boolean>("self.registration.waiting === null && self.registration.active?.state === 'activated'"), active => active, 'next shell activation');
      page = await open(updateContext, errors);
      expect(await page.title()).toBe(`Updated ${beforeTitle}`);
      expect(await page.getByRole('textbox', { name: 'Message Design studio', exact: true }).inputValue()).toBe(draft);
      const activated = await shellCache(page);
      expect(activated).toHaveLength(1);
      expect(activated[0].name.endsWith(next.version)).toBe(true);
      expect(activated[0].name).not.toBe(initial[0].name);
      expect(errors).toEqual([]);
    } finally {
      await updateContext.close(); contexts.delete(updateContext);
      await writeFile(join(output, 'index.html'), oldHtml);
      await writeFile(join(output, 'service-worker.js'), oldWorker);
    }
  }, 60_000);

  test('a shared-tab account switch hides private rows, local draft, and queued work', async () => {
    const errors: string[] = [];
    const shared = await context();
    const first = await open(shared, errors), switcher = await open(shared, errors);
    await first.getByRole('navigation', { name: 'Conversations', exact: true }).getByRole('button', { name: /Alice & Erin/ }).click();
    await first.getByRole('heading', { name: 'Alice & Erin', level: 1 }).waitFor();
    const privateMessage = 'The little notebook you recommended arrived.';
    await first.getByText(privateMessage, { exact: true }).waitFor();
    await first.getByRole('button', { name: 'Try working offline', exact: true }).click();
    const queued = 'Alice-only work, still waiting on this device.';
    const draft = 'Alice-only words still in the composer.';
    await first.getByRole('textbox', { name: 'Message Alice & Erin', exact: true }).fill(queued);
    await first.getByRole('button', { name: 'Send message', exact: true }).click();
    await first.getByText('Saved on this device · waiting to send', { exact: true }).waitFor();
    await first.getByRole('textbox', { name: 'Message Alice & Erin', exact: true }).fill(draft);
    const pending = await operationFor(first, queued);
    expect(pending?.status).toBe('queued');
    await switcher.getByRole('combobox', { name: 'YOU’RE HERE AS' }).selectOption('bob');
    await until(() => journal(first), state => state.principal === 'dev:bob', 'shared IndexedDB Bob identity');
    // Even this deliberately offline tab must receive the BroadcastChannel
    // authority change. It need not reacquire Bob data while offline.
    await until(() => first.locator('body').innerText(), text => !text.includes(privateMessage) && !text.includes(queued) && !text.includes('Alice & Erin'), 'redaction in the other tab');
    expect(await first.locator('textarea').evaluateAll(nodes => nodes.some(node => node instanceof HTMLTextAreaElement && node.value === draft))).toBe(false);
    const durableAfter = await operationFor(first, queued);
    expect(durableAfter?.principal).toBe('dev:alice');
    expect(durableAfter?.id).toBe(pending?.id);
    expect(durableAfter?.body).toBe(pending?.body);
    expect(durableAfter?.receipt).toBeUndefined();
    await switcher.getByRole('navigation', { name: 'Conversations', exact: true }).getByRole('button', { name: /Bob & Erin/ }).waitFor();
    expect(await switcher.getByRole('navigation', { name: 'Conversations', exact: true }).getByRole('button', { name: /Alice & Erin/ }).count()).toBe(0);
    expect(errors).toEqual([]);
    await shared.close(); contexts.delete(shared);
  }, 60_000);

  test('390×844 layout keeps the composer reachable without horizontal overflow', async () => {
    const errors: string[] = [];
    const mobile = await context({ width: 390, height: 844 });
    const page = await open(mobile, errors);
    const composer = page.getByRole('textbox', { name: 'Message Design studio', exact: true });
    const bounds = await composer.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await composer.fill('A small screen still leaves room to think.');
    await composer.click();
    expect(await composer.evaluate(node => document.activeElement === node)).toBe(true);
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    expect(await send.isEnabled()).toBe(true);
    const sendBounds = await send.boundingBox();
    expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: screenshots.mobile });
    expect(errors).toEqual([]);
    await mobile.close(); contexts.delete(mobile);
  }, 60_000);
});
