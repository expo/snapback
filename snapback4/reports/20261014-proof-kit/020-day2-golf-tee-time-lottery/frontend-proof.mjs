// Production browser proof. Own all servers and close partial startup in finally.
import { rm } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { startServe, startStatic, deploy, withBrowser, fillRN, cleanup } from "snapback4/proof";
import { root, signup, grantStaff, password, accountApi } from "./proof-lib.mjs";

let backend, server;
const deployment = path.join(root, '.scratch/frontend-deploy');
try {
  await rm(deployment, { recursive: true, force: true });
  await deploy(deployment, 'snapback/schema.q');
  backend = await startServe(deployment);
  const pro = await signup(backend.url, 'web-pro@example.test');
  const member = await signup(backend.url, 'web-member@example.test');
  await grantStaff(backend.url, deployment, pro.principal);
  server = await startStatic('dist');
  await withBrowser({ executablePath: process.env.CHROME }, async context => {
  const browser = context.browser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const origin = `${server.url}/?api=${encodeURIComponent(backend.url)}`;
  const signIn = async email => {
    await fillRN(page.getByTestId('email'), email);
    await fillRN(page.getByTestId('password'), password);
    await page.getByTestId('sign-in').click();
    await page.getByTestId('sign-out').waitFor({ timeout: 30000 });
  };
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await signIn('web-pro@example.test');
  const proApi = accountApi(backend.url, pro);
  // Two successive writes must produce different fresh rows.
  for (const label of ['Browser week one', 'Browser week two']) {
    assert.equal(await page.getByRole('button', { name: new RegExp(label) }).count(), 0);
    await fillRN(page.getByTestId('new-week'), label);
    await page.getByTestId('create-lottery').click();
    await page.getByRole('button', { name: new RegExp(label) }).waitFor({ timeout: 30000 });
  }
  const lottery = (await proApi.q('lotteriesList')).find(l => l.weekLabel === 'Browser week one');
  await page.getByTestId(`lottery-${lottery.id}`).click();
  await fillRN(page.getByTestId('new-tee-label'), 'Browser Saturday 09:00');
  await page.getByTestId('add-teetime').click();
  await page.getByText('Browser Saturday 09:00', { exact: false }).waitFor({ timeout: 30000 });
  const tee = (await proApi.q('teeTimesFor', { lottery: lottery.id }))[0];
  await page.getByTestId('sign-out').click();
  await signIn('web-member@example.test');
  await page.getByTestId(`lottery-${lottery.id}`).click();
  assert.equal(await page.getByTestId(`entry-for-${tee.id}`).count(), 0);
  await page.getByTestId(`enter-${tee.id}`).click();
  const entry = page.getByTestId(`entry-for-${tee.id}`);
  await entry.waitFor({ timeout: 30000 });
  assert.match(await entry.innerText(), /entered/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('sign-out').waitFor({ timeout: 30000 });
  await page.getByTestId(`lottery-${lottery.id}`).click();
  await page.getByTestId(`entry-for-${tee.id}`).waitFor({ timeout: 30000 });
  await page.getByTestId('sign-out').click();
  await signIn('web-pro@example.test');
  await page.getByTestId(`lottery-${lottery.id}`).click();
  assert.equal(await page.getByTestId('closure-reason').count(), 0);
  await fillRN(page.getByTestId('close-reason'), 'Lightning: browser proof closure');
  await page.getByTestId('close-lottery').click();
  await page.getByTestId('closure-reason').waitFor({ timeout: 30000 });
  assert.equal(await page.getByTestId('closure-reason').innerText(), 'Lightning: browser proof closure');
  await page.getByTestId('sign-out').click();
  await signIn('web-member@example.test');
  await page.getByTestId(`lottery-${lottery.id}`).click();
  await page.getByTestId('closure-reason').waitFor({ timeout: 30000 });
  await page.waitForFunction(id => document.querySelector(`[data-testid="entry-for-${id}"]`)?.textContent?.includes('cancelled'), tee.id);
  assert.equal(await page.getByTestId(`enter-${tee.id}`).count(), 0);
  await page.screenshot({ path: 'logs/frontend-closure.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('frontend:proof: real sign-ins, two fresh lottery writes, tee time, member entry, persisted login, closure, cancelled entry — PASS');
  });
} finally { await cleanup(() => server?.stop(), () => backend?.stop()); }
