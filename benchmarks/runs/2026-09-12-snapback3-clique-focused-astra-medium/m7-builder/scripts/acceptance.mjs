import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '../choreography/node_modules/playwright/index.mjs';
const m=process.argv[process.argv.indexOf('--milestone')+1];
if(m!=='m1'){console.error(`${m}: blocked-by-M1; no passing assertions claimed`);process.exit(1)}
const results=[];const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();const page=await ctx.newPage();
const base=process.env.CLIQUE_URL??'http://127.0.0.1:54900';
page.on('pageerror',e=>console.error('BROWSER',e.message));
async function test(id,fn){try{await fn();results.push({id,pass:true})}catch(e){results.push({id,pass:false,error:String(e)});console.error(id,String(e))}}
async function waitVisible(id){await page.getByTestId(id).waitFor({state:'visible',timeout:10000})}
const unique='tester'+Date.now().toString().slice(-10);
await page.goto(base);
await test('m1-a01',async()=>{await page.getByTestId('sm-auth-toggle').click();await page.getByTestId('sm-auth-email').fill(unique+'@example.com');await page.getByTestId('sm-auth-password').fill('Acceptance!2026');await page.getByTestId('sm-auth-submit').click();await waitVisible('sm-profile-save')});
await test('m1-a02',async()=>{assert.equal(await page.getByTestId('sm-auth-submit').count(),0);await waitVisible('sm-profile-save')});
await test('m1-a03',async()=>{await page.getByTestId('sm-profile-field-displayname').fill('Acceptance User');await page.getByTestId('sm-profile-field-handle').fill('alice');await page.getByTestId('sm-profile-save').click();await page.getByText(/unique|duplicate|conflict/i).first().waitFor({state:'visible',timeout:10000})});
await test('m1-a08',async()=>{await page.getByTestId('sm-profile-field-handle').fill(unique);await page.getByTestId('sm-profile-field-bio').fill('Profile write persists');await page.getByTestId('sm-profile-save').click();await waitVisible('sm-profile-heading');assert.match(await page.getByTestId('sm-profile').innerText(),/Profile write persists/);await page.reload();await waitVisible('sm-profile-heading');assert.match(await page.getByTestId('sm-profile').innerText(),/Profile write persists/)});
await test('m1-a04',async()=>{await page.goto(base+'/settings');await page.getByTestId('sm-settings-logout').click();await waitVisible('sm-auth-submit');await page.getByTestId('sm-auth-toggle').click();await page.getByTestId('sm-auth-email').fill(unique+'@example.com');await page.getByTestId('sm-auth-password').fill('Acceptance!2026');await page.getByTestId('sm-auth-submit').click();await waitVisible('sm-auth-error');assert.match(await page.getByTestId('sm-auth-error').innerText(),/exists|email|registered|duplicate/i)});
for(const id of ['m1-a10','m1-a11'])results.push({id,pass:false,outcomeClass:'platform',error:'S3_CAPABILITY_UNAVAILABLE: runtime refuses image columns; evidence/m1-media-check.json'});
await page.screenshot({path:'artifacts/m1-acceptance.png',fullPage:true});
await browser.close();
const required=JSON.parse(fs.readFileSync('instrument/schema/social-messenger/assertions.json')).milestones.M1.assertions.filter(a=>a.executor==='suite-required').map(a=>a.id);
const coverage=Object.fromEntries(required.map(id=>[id,{test:`scripts/acceptance.mjs#${id}`,status:results.find(r=>r.id===id)?.pass?'pass':'fail'}]));
assert.deepEqual(Object.keys(coverage).sort(),required.sort());
const pass=results.every(r=>r.pass);
fs.writeFileSync('evidence/m1-coverage.json',JSON.stringify(coverage,null,2)+'\n');
fs.writeFileSync('evidence/m1-suite.json',JSON.stringify({milestone:m,recordedAt:new Date().toISOString(),pass,coverage:'m1-coverage.json',results},null,2)+'\n');
fs.writeFileSync('suite-status.json',JSON.stringify({m1:{pass,receipt:'evidence/m1-suite.json',outcomeClass:results.some(r=>!r.pass&&r.outcomeClass!=='platform')?'application':'platform'}},null,2)+'\n');
console.log(JSON.stringify({pass,results}));process.exitCode=pass?0:1;
