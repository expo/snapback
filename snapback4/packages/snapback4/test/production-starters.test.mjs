import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
import { chromiumExecutable } from '../../../witness/lib.mjs';
const root = resolve(import.meta.dirname, '../../..');
const require = createRequire(join(root, 'package.json'));
const starter = join(root, 'crates/snapback4/src/verbs/init/starter');
// Qualification supplies init's installed recipe files and the packed SDK.
const clientDist = process.env.SNAPBACK4_PRODUCTION_CLIENT_DIST ?? join(root, 'packages/snapback4/dist');

test('native smoke identifies its own provider error and preserves other failures', () => {
  const source = readFileSync(process.env.SNAPBACK4_PRODUCTION_NATIVE_SMOKE ?? join(starter, '../native-smoke.ts'), 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
  for (const missing of [true, false]) {
    const context = vm.createContext({ Error, useAuth() { throw new Error(missing ? 'useAuth: no <AppProvider> above this component' : 'storage failure'); } });
    vm.runInContext(source, context);
    assert.throws(() => vm.runInContext('useNativeSmokeGuest()', context), missing ? /useNativeSmokeGuest: no <AppProvider>/ : /storage failure/);
  }
});

for (const platform of ['web', 'expo']) test(`${platform} production screen keeps drafts across release loss and distinguishes denied, absent and incomplete rosters`, { timeout: 120000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-production-ui-')); let server, browser;
  t.after(async () => { try { await browser?.close(); } finally { try { await server?.close(); } finally { rmSync(dir, { recursive: true, force: true }); } } });
  let source = readFileSync(process.env[`SNAPBACK4_PRODUCTION_${platform.toUpperCase()}_APP`] ?? join(starter, `production/${platform}-app.tsx`), 'utf8');
  source = source.replace(/^import \{ api \}.*;\n/m, 'import { api } from "./api";\n').replace(/^import \{ app, openApp, personas \}.*;\n/m, '').replace('function Workspace()', 'export function Workspace()');
  writeFileSync(join(dir, 'workspace.tsx'), source);
  writeFileSync(join(dir, 'api.ts'), `const op=(name,kind)=>({name,kind,available:r=>'generation' in r && name in r.operations});export const api=Object.fromEntries(['myTeams','myRole','roster','createTeam','invite'].map(n=>[n,op(n,['createTeam','invite'].includes(n)?'mutation':'query')]));`);
  writeFileSync(join(dir, 'native.tsx'), `import React from 'react';export const View=({children})=><div>{children}</div>,Text=({children})=><span>{children}</span>,SafeAreaView=View,ScrollView=View;export const Button=({title,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{title}</button>;export const TextInput=({accessibilityLabel,onChangeText,value,...props})=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/>;`);
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/harness.tsx"></script>');
  writeFileSync(join(dir, 'harness.tsx'), `
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {AppProvider} from 'snapback4/react';import {Workspace} from './workspace';
window.IS_REACT_ACT_ENVIRONMENT=true;
const ready=data=>({data,complete:true,existence:data===null||Array.isArray(data)&&!data.length?'absent':'present',fresh:true,cut:null,next:null});
let role=ready({role:'admin',principal:'dev:alice'}),roster=ready([{id:'a',principal:'dev:alice',role:'admin'},{id:'b',principal:'dev:bob',role:'member'}]);
let release={generation:2,operations:{myTeams:{},myRole:{},roster:{},createTeam:{},invite:{}},tables:{}};const releaseListeners=new Set(),records=new Set(),writes=[];
const client={release:{getSnapshot:()=>release,subscribe(fn){releaseListeners.add(fn);return()=>releaseListeners.delete(fn)}},viewer:()=>auth.viewer,onViewer:()=>()=>{},onWrite:()=>()=>{},now:()=>Date.now(),
mutate:async(op,args)=>{writes.push({op:op.name,args});return{state:'sent',id:'w',seq:1,result:null}},
observe(op){if(!op.available(release))throw Error('unavailable query opened');const r={op,subs:new Set(),getSnapshot:()=>op.name==='myRole'?role:op.name==='roster'?roster:readyTeams,subscribe(fn){r.subs.add(fn);return()=>r.subs.delete(fn)},close(){records.delete(r)}};records.add(r);return r;}};
const readyTeams=ready([{id:'membership',teamId:'team',role:'admin'}]),auth={state:'signed-in',viewer:'dev:alice'};
const app={client,ready:Promise.resolve({ok:true}),auth:{getSnapshot:()=>auth,onChange:()=>()=>{},logout:async()=>({ok:true})}};
const root=createRoot(document.querySelector('#root'));window.start=async()=>{await act(async()=>root.render(<React.StrictMode><AppProvider app={app}><Workspace/></AppProvider></React.StrictMode>));window.IS_REACT_ACT_ENVIRONMENT=false;};
window.publish=async patch=>{window.IS_REACT_ACT_ENVIRONMENT=true;await act(async()=>{if(patch.release)release=patch.release;if(patch.role)role=patch.role;if(patch.roster)roster=patch.roster;for(const fn of releaseListeners)fn();for(const r of records)for(const fn of r.subs)fn();});window.IS_REACT_ACT_ENVIRONMENT=false;};
window.inspect=()=>({writes,records:[...records].map(r=>r.op.name)});window.finish=()=>{window.IS_REACT_ACT_ENVIRONMENT=true;return act(async()=>root.unmount());};
`);
  server = await createBrowserServer({ root: dir, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } }, resolve: { alias: [
    { find: 'snapback4/react', replacement: join(clientDist, 'react.js') }, { find: 'snapback4/contract', replacement: join(clientDist, 'contract.js') }, { find: 'react-native', replacement: join(dir, 'native.tsx') },
  ] } });
  await server.listen(); const { chromium } = require('playwright-core');
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await loadBrowserPage(t, page, server.resolvedUrls.local[0]); await page.waitForFunction(() => window.start); await page.evaluate(async () => { try { await window.start(); } catch (error) { throw new Error((error.errors ?? [error]).map(e => e.stack ?? String(e)).join("\n")); } });
  await page.getByRole('button', { name: 'team · admin', exact: true }).click();
  const principal = page.getByRole('textbox', { name: 'Principal', exact: true }); await principal.fill('acct:new-member');
  if (platform === 'web') await page.getByLabel('Role', { exact: true }).selectOption('admin');
  else await page.getByRole('button', { name: 'Admin role', exact: true }).click();
  if (platform === 'web') await page.getByLabel('Member principal', { exact: true }).selectOption('dev:bob');
  else await page.getByRole('button', { name: 'dev:bob · member', exact: true }).click();
  const title = platform === 'web' ? page.getByLabel('Team name', { exact: true }) : page.getByRole('textbox', { name: 'Team name', exact: true }); await title.fill('Unsent team');
  const publish = patch => page.evaluate(p => window.publish(p), patch);
  await publish({ release: { generation: 1, operations: {}, tables: {} } });
  assert.equal(await title.inputValue(), 'Unsent team'); assert.deepEqual((await page.evaluate(() => window.inspect())).records, []);
  await publish({ release: { generation: 3, operations: { myTeams: {}, myRole: {}, roster: {}, createTeam: {}, invite: {} }, tables: {} } });
  assert.equal(await principal.inputValue(), 'acct:new-member');
  if (platform === 'web') { assert.equal(await page.getByLabel('Role', { exact: true }).inputValue(), 'admin'); assert.equal(await page.getByLabel('Member principal', { exact: true }).inputValue(), 'dev:bob'); }
  else { assert.equal(await page.getByText('Invitation role: admin', { exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: 'Selected: dev:bob · member', exact: true }).count(), 1); }
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  assert.deepEqual((await page.evaluate(() => window.inspect())).writes, [{ op: 'invite', args: { teamId: 'team', principal: 'acct:new-member', role: 'admin' } }]);
  await publish({ role: { denied: { code: 'NOT_MEMBER', family: 'rule', message: 'Revoked' } } });
  assert.equal(await page.getByText('Not available: Revoked', { exact: true }).count(), 1); assert.ok(!(await page.evaluate(() => window.inspect())).records.includes('roster'));
  await publish({ role: { data: { role: 'member' }, existence: 'present', complete: true, cut: null, next: null, fresh: true }, roster: { data: [], existence: 'absent', complete: true, cut: null, next: null, fresh: true } });
  assert.equal(await page.getByText('No members.', { exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: 'Invite', exact: true }).count(), 0);
  await publish({ roster: { data: [], existence: 'partial', complete: false, cut: 'offline', next: null, fresh: false } });
  assert.equal(await page.getByText('Roster incomplete (0 known); reconnect.', { exact: true }).count(), 1); assert.equal(await page.getByText('No members.', { exact: true }).count(), 0);
  await page.evaluate(() => window.finish()); assert.deepEqual(errors, []);
});
