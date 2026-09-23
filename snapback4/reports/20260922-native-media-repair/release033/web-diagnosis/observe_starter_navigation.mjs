// Operator-only observation. Does not change navigation options, app code, or assertions.
import { createRequire } from 'node:module';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright-core');
const output = join(process.cwd(), 'navigation-events.jsonl');
let serial = 0;
function safeURL(value) {
  try { const u = new URL(value); for (const name of [...u.searchParams.keys()]) if (name !== 'as') u.searchParams.set(name, '[redacted]'); u.hash = ''; return u.href; }
  catch { return '[non-URL]'; }
}
function emit(event, fields = {}) { appendFileSync(output, JSON.stringify({ at: new Date().toISOString(), elapsedMs: Math.round(performance.now()), event, ...fields }) + '\n'); }
writeFileSync(output, '');
emit('node', { pid: process.pid, version: process.version, playwright: require('playwright-core/package.json').version });
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  emit('launch', { executablePath: args[0]?.executablePath, headless: args[0]?.headless });
  const browser = await launch(...args);
  emit('browser', { version: browser.version() });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...options) => {
    const context = await newContext(...options);
    const setOffline = context.setOffline.bind(context);
    context.setOffline = async value => { emit('offline.begin', { value }); const result = await setOffline(value); emit('offline.end', { value }); return result; };
    context.on('serviceworker', worker => { emit('worker', { url: safeURL(worker.url()) }); worker.on('close', () => emit('worker.close', { url: safeURL(worker.url()) })); });
    const newPage = context.newPage.bind(context);
    context.newPage = async (...options) => {
      const page = await newPage(...options), id = ++serial;
      const pending = new Map();
      emit('page', { id });
      page.on('request', r => { const row = { url: safeURL(r.url()), method: r.method(), type: r.resourceType(), navigation: r.isNavigationRequest() }; pending.set(r, row); emit('request', { id, ...row }); });
      page.on('response', r => emit('response', { id, url: safeURL(r.url()), status: r.status(), fromServiceWorker: r.fromServiceWorker() }));
      page.on('requestfinished', r => { pending.delete(r); emit('finished', { id, url: safeURL(r.url()) }); });
      page.on('requestfailed', r => { pending.delete(r); emit('failed', { id, url: safeURL(r.url()), failure: r.failure()?.errorText }); });
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) emit('navigated', { id, url: safeURL(frame.url()) }); });
      for (const event of ['domcontentloaded', 'load', 'close', 'crash']) page.on(event, () => emit(event, { id, url: safeURL(page.url()) }));
      page.on('pageerror', error => emit('pageerror', { id, message: error.message }));
      const session = await context.newCDPSession(page);
      for (const event of ['ServiceWorker.workerRegistrationUpdated', 'ServiceWorker.workerVersionUpdated']) session.on(event, data => emit(event, { id, data }));
      await session.send('ServiceWorker.enable').catch(error => emit('cdp.unavailable', { id, message: error.message }));
      const goto = page.goto.bind(page);
      page.goto = async (...args) => {
        emit('goto.begin', { id, url: safeURL(args[0]), options: args[1] ?? 'unchanged defaults' });
        try { const result = await goto(...args); emit('goto.end', { id, url: safeURL(page.url()) }); return result; }
        catch (error) { emit('goto.error', { id, url: safeURL(page.url()), message: error.message, pending: [...pending.values()] }); throw error; }
      };
      return page;
    };
    return context;
  };
  return browser;
};
process.on('exit', code => emit('process.exit', { code }));
