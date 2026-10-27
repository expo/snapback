import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after } from './helpers/teardown.mjs';
import { server, until } from './helpers/app-server.mjs';
import { createClient, settleMutation, mintId } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { createMockClient } from '../dist/mock.js';
import { guardClient } from '../dist/app-client.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
import { withBrowser, labelledControl, selectByValue, renderedText, waitForFresh, command, startDev, devAccounts } from '../dist/proof.js';
import { chromiumExecutable } from '../../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../../..');
const wasm=readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
const schema=`use personas alice
query answer():
  return 42
mutation refuse():
  require false else EXPECTED_REFUSAL
  return null
`;
for(const tier of ['online','web','mock','guarded'])test(`DX14 044R 022E observe callback/watch guesses refuse before work (${tier})`,{timeout:30000},async t=>{
 const {url}=await server(t,undefined,schema);
 const raw=tier==='web'?await createLocalClient({url,persona:'alice',device:webDevice({wasm,persist:memoryPersistence()})}):tier==='mock'?createMockClient({viewer:'alice',tables:{},ops:{queries:{answer:()=>42},mutations:{}}}):createClient({url,persona:'alice'});
 after(t,()=>raw.close());
 const client=tier==='guarded'?guardClient(raw,async()=>true,()=>true,()=>({code:'E_AUTH',family:'auth',message:'retired'})).client:raw;
 for(const call of [()=>client.observe({kind:'query',name:'answer'},{},()=>{}),()=>client.watch({kind:'query',name:'answer'},{},()=>{})]) assert.throws(call,error=>error.code==='E_OBSERVE_USAGE'&&/getSnapshot/.test(error.message)&&/subscribe/.test(error.message));
 for(const options of [{keep:false},null]){
  const observed=client.observe({kind:'query',name:'answer'},{},options);const stop=observed.subscribe(()=>{});
  await until(()=>observed.getSnapshot().data===42,`documented observed read with ${options===null?'null (omitted)':'explicit'} options`);stop();observed.close();
 }
});
test('DX14 011E oversized upload recovery follows the original intent to its refusal',{timeout:30000},async t=>{
 const {url}=await server(t,undefined,schema);let recovering=false,submissions=0;
 const client=createClient({url,persona:'alice',fetch:async(input,init)=>{
  if(new URL(input).pathname==='/assets'){recovering=true;throw Error('oversized upload connection closed');}
  if(recovering)throw Error('connection recovering');
  if(new URL(input).pathname==='/m/refuse'){assert.equal(JSON.parse(init.body).id,id);submissions++;}
  return fetch(input,init);
 }});after(t,()=>client.close());
 await client.query({kind:'query',name:'answer'},{});
 const upload=await client.upload(new Blob(['%PDF-',new Uint8Array(5_000_001)],{type:'application/pdf'}),{file:{name:'oversized.pdf',type:'application/pdf'}});
 assert.equal(upload.ok,false);assert.equal(client.link(),'offline');
 const id=mintId(),raw=await client.mutate({kind:'mutation',name:'refuse'},{},{id});assert.equal(raw.state,'pending');
 let terminal=false;const work=settleMutation(client,{kind:'mutation',name:'refuse'},{},{id}).then(value=>{terminal=true;return value;});
 await Promise.resolve();assert.equal(terminal,false);recovering=false;
 const result=await work;assert.equal(result.id,id);assert.equal(result.state,'failed');assert.equal(result.why.code,'EXPECTED_REFUSAL');assert.equal(submissions,1);
});
test('DX14 044R 050R labelled controls exclude option text and keep duplicate labels ambiguous',{timeout:30000},async t=>{
 await withBrowser({executablePath:chromiumExecutable()},async context=>{
 const page=await context.newPage();await page.setContent('<section aria-label="Form"><label>Owner<select><option value="a">Alice</option><option value="b">Bob</option></select></label><label>Notes<textarea></textarea></label><label for="explicit">Priority</label><select id="explicit"><option value="x">Low</option></select><input aria-label="Account"><label>Legacy<input aria-label="Current"></label><label for="both">Given</label><label for="both">Family</label><input id="both"></section><label>Owner<select><option>Other</option></select></label>');
 const within=page.getByRole('region',{name:'Form'}),owner=labelledControl(page,'combobox','Owner',{within});
 assert.equal(await owner.count(),1);await selectByValue(owner,'b');assert.equal(await owner.inputValue(),'b');
 await labelledControl(page,'textbox','Notes').fill('hello');assert.equal(await page.locator('textarea').inputValue(),'hello');
 assert.equal(await labelledControl(page,'combobox','Priority').count(),1);assert.equal(await labelledControl(page,'textbox','Account').count(),1);
 assert.equal(await labelledControl(page,'textbox','Current').count(),1);assert.equal(await labelledControl(page,'textbox','Legacy').count(),0,'ARIA name overrides the native label');
 assert.equal(await labelledControl(page,'textbox','Given Family').count(),1);assert.equal(await labelledControl(page,'textbox','Given').count(),0,'multiple labels form one name');
 assert.equal(await labelledControl(page,'combobox','Alice').count(),0,'option names are not label names');
 assert.equal(await labelledControl(page,'combobox','Owner').count(),2);await assert.rejects(labelledControl(page,'combobox','Owner').selectOption('b',{timeout:1000}),/strict mode violation/);
 await page.setContent('<p>Visible result</p><p hidden>Hidden result</p>');assert.equal(await waitForFresh(renderedText(page,'Visible result'),null), 'Visible result');assert.equal(await renderedText(page,'Hidden result').count(),0);
 });
});
// Optional external toolchain: the packed qualification explicitly supplies tsx.
let tsx=process.env.SNAPBACK4_TSX_CLI;try{tsx??=createRequire(import.meta.url).resolve('tsx/cli');}catch{}
test('DX14 022E 050R packed proof selectors and visibleText work through tsx',{timeout:60000,skip:!tsx?'tsx toolchain absent; packed qualification sets SNAPBACK4_TSX_CLI':false},async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'dx14-packed-tsx-'));after(t,()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'node_modules'),{recursive:true});
 const tarball=process.env.SNAPBACK4_CLIENT_TARBALL??join(cwd,JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',cwd],{cwd:join(root,'packages/snapback4'),encoding:'utf8'}))[0].filename);
 mkdirSync(join(cwd,'node_modules/snapback4'));execFileSync('tar',['-xf',tarball,'-C',join(cwd,'node_modules/snapback4'),'--strip-components=1']);
 const require=createRequire(import.meta.url);for(const name of ['playwright-core','undici','openid-client'])symlinkSync(resolve(require.resolve(name+'/package.json'),'..'),join(cwd,'node_modules',name),'dir');
 writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
 // Keep names is what tsx inserts into serialized nested browser callbacks.
 // Transform the extracted package, then use it through the real tsx loader.
 const esbuild=createRequire(tsx)('esbuild');const path=join(cwd,'node_modules/snapback4/dist/proof-text.js');
 writeFileSync(join(cwd,'proof.ts'),`import assert from 'node:assert/strict';import {chromium} from 'playwright-core';import {withBrowser,renderedText,waitForFresh,labelledControl} from 'snapback4/proof';const run=async(page)=>{await page.setContent('<p>tsx result</p><label>Owner<select><option>Alice</option></select></label>');assert.equal(await waitForFresh(renderedText(page,'tsx result'),null),'tsx result');assert.equal(await labelledControl(page,'combobox','Owner').count(),1);};await withBrowser({executablePath:${JSON.stringify(chromiumExecutable())}},async c=>run(await c.newPage()));const browser=await chromium.launch({headless:true,executablePath:${JSON.stringify(chromiumExecutable())},args:['--no-sandbox']});try{await run(await browser.newPage());}finally{await browser.close();}`);
 const exact=await command(process.execPath,[tsx,join(cwd,'proof.ts')],{cwd,timeoutMs:20000});assert.equal(exact.code,0,exact.stdout+exact.stderr);
 writeFileSync(path,esbuild.transformSync(readFileSync(path,'utf8'),{loader:'js',format:'esm',keepNames:true}).code);
 const named=await command(process.execPath,[tsx,join(cwd,'proof.ts')],{cwd,timeoutMs:20000});assert.equal(named.code,0,named.stdout+named.stderr);
});

test('DX14 027E provision refusal retains backend lookup explanation',{timeout:30000},async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'dx14-provision-'));after(t,()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'snapback'));
 const source=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)\n```/)[1].replace("read <- .principal = viewer or viewer = 'service:operator'","read <- .principal = viewer").replace('return upsert roles[principal] { principal, role }','provisioned = (upsert roles[principal] { principal, role }) ! else NOT_FOUND\n  return provisioned');
 writeFileSync(join(cwd,'snapback/schema.q'),source);const host=await startDev({cwd});after(t,()=>host.stop());
 await assert.rejects(devAccounts(host,{roles:{member:1},provision:{name:'provision'}}),error=>{
  assert.match(error.message,/E_STAGING_PROVISION/);assert.match(error.message,/NOT_FOUND/);assert.match(error.message,/: .*lookup|: .*row|: .*found/i);return true;
 });
});

test('DX14 R1/R2 provisioning redacts plain and quoted scalar enum inputs with schema diagnostics intact',{timeout:30000},async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'dx14-provision-scalars-'));after(t,()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'snapback'));
 const source=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)\n```/)[1];
 writeFileSync(join(cwd,'snapback/schema.q'),source);const host=await startDev({cwd});after(t,()=>host.stop());
 // A harmless dummy value records the real backend's previously leaked form.
 const raw=await fetch(host.url+'/m/provision',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${await host.operatorToken()}`},body:JSON.stringify({id:'scalar-validation-dummy',args:{principal:'user:dummy',role:482719}})}).then(response=>response.json());
 assert.equal(raw.why.code,'E_INPUT');assert.match(raw.why.message,/expected "admin" or "member", got (?:a number|the number 482719)/);
 // Older/backend-originated refusals include the supplied scalar. Preserve
 // that reviewed dummy example while retaining real enum validation below.
 const originalFetch=globalThis.fetch;after(t,()=>{globalThis.fetch=originalFetch;});
 globalThis.fetch=async(input,init)=>{
  const response=await originalFetch(input,init);
  if(String(input)!==host.url+'/m/provision')return response;
  const value=JSON.parse(init.body).args.role,reply=await response.json();assert.equal(reply.why.code,'E_INPUT');
  const description=value===null?'null':typeof value==='boolean'?`the boolean ${value}`:`the number ${value}`;
  reply.why.message=reply.why.message.replace(/got .+$/,`got ${description}; quoted '${value}'; double quoted "${value}"; field 'role'; code E_INPUT${typeof value==='number'?`; argument '${value}'`:''}`);
  return Response.json(reply,{status:response.status});
 };
 for(const [role,type,description] of [[482719,'number','the number 482719'],[false,'boolean','the boolean false'],[null,'null','got null']]){
  await assert.rejects(devAccounts(host,{roles:{member:1},provision:{name:'provision'},args:()=>({role})}),error=>{
   assert.match(error.message,/E_STAGING_PROVISION.*E_INPUT/);assert.match(error.message,/mutation parameters: principal, role/);
   assert.ok(error.message.includes(`"role":"<redacted ${type}>"`));assert.ok(!error.message.includes(description));
   assert.match(error.message,/quoted '<redacted>'; double quoted "<redacted>"; field 'role'; code E_INPUT/);
   if(typeof role==='number'){assert.ok(!error.message.includes(String(role)));assert.match(error.message,/argument '<redacted>'/,'a number cannot name a schema argument');}
   assert.match(error.message,/role/);assert.match(error.message,/<redacted>/);return true;
  });
 }
});

test('DX14 Muse R1 short string provisioning values redact without mangling argument diagnostics',{timeout:30000},async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'dx14-provision-short-'));after(t,()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'snapback'));
 const source=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)\n```/)[1].replace("mutation provision(principal: principal, role: enum('admin', 'member')):","mutation provision(principal: principal, role: enum('admin', 'member'), team: enum('staff', 'ops')):");
 writeFileSync(join(cwd,'snapback/schema.q'),source);const host=await startDev({cwd});after(t,()=>host.stop());
 const originalFetch=globalThis.fetch;after(t,()=>{globalThis.fetch=originalFetch;});
 globalThis.fetch=async(input,init)=>{
  const response=await originalFetch(input,init);if(String(input)!==host.url+'/m/provision')return response;
  const reply=await response.json();assert.equal(reply.why.code,'E_INPUT');assert.match(reply.why.message,/argument team/);
  reply.why.message=`argument team: expected "staff" or "ops", got the text 'a'; got a; field 'a'; code E_a`;
  return Response.json(reply,{status:response.status});
 };
 await assert.rejects(devAccounts(host,{roles:{member:1},provision:{name:'provision'},args:()=>({team:'a'})}),error=>{
  assert.match(error.message,/E_STAGING_PROVISION.*E_INPUT/);assert.match(error.message,/argument team: expected "staff" or "ops", got the text '<redacted>'; got <redacted>/);
  assert.match(error.message,/field 'a'; code E_a/);assert.match(error.message,/mutation parameters: principal, role, team/);
  assert.ok(error.message.includes('"team":"<redacted string>"'));return true;
 });
});
