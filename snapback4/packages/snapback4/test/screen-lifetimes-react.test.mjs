// @ref LLP 3000.023#13 — mount complete ownership compositions, never extracted snippets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {screen} from './helpers/screen-lifetimes.mjs';
import {hangBudget} from './helpers/wait.mjs';
test('screen recipe: Strict Mode, bounded owners, scope resets, neutral placeholders and sibling cleanup',{timeout:hangBudget(20)},async t=>{
 const {page,errors}=await screen(t);
 const counts=()=>page.evaluate(()=>window.counts()),text=()=>page.locator('body').innerText();
 const measured={recipe:await counts()};assert.equal(measured.recipe.observations,22);assert.equal(measured.recipe.points,20);
 const input=page.locator('input');await input.fill('preserve me');await input.focus();
 await page.evaluate(()=>window.input=document.querySelector('input'));
 await page.evaluate(()=>window.publish({point:{loading:true}}));assert.doesNotMatch(await text(),/protected-/);assert.match(await text(),/Message unavailable/);
 assert.equal(await page.getByRole('button',{name:'Select photo',exact:true}).count(),0,'identity placeholders expose no media action');
 const loading=await text();
 await page.evaluate(()=>window.publish({point:{denied:{code:'NO_BODY',message:'Denied',family:'rule'}}}));assert.equal(await text(),loading,'denied placeholder has only the same neutral text as loading');
 assert.doesNotMatch(await text(),/NO_BODY|Denied|protected-/);
 await page.evaluate(()=>window.publish({point:{data:null,complete:true,fresh:true,existence:'absent'}}));assert.equal(await text(),loading,'absence must be indistinguishable from denial');
 await page.evaluate(()=>window.publish({point:{data:null,complete:false,fresh:false,existence:'partial'}}));assert.equal(await text(),loading);
 await page.evaluate(()=>window.publish({point:null}));assert.match(await text(),/protected-/);
 await page.getByRole('button',{name:'Older page',exact:true}).click();assert.equal((await counts()).history,2);
 await page.getByRole('button',{name:'Older page',exact:true}).click();assert.equal((await counts()).history,3);assert.equal(await page.getByRole('button',{name:'Older page',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Next rows',exact:true}).click();assert.equal((await counts()).points,20);assert.doesNotMatch(await text(),/protected-0\b/,'window movement releases old body');
 await page.evaluate(()=>window.coalesced());assert.equal((await counts()).history,1,'generation withdrawal resets requested page owner even when React batches it');
 assert.equal(await input.inputValue(),'preserve me');assert.equal(await page.evaluate(()=>window.input===document.querySelector('input')),true);
 await page.evaluate(()=>window.publish({root:{loading:true}}));assert.equal((await counts()).points,0,'root withdrawal releases every identity owner');
 assert.equal(await input.inputValue(),'preserve me');
 await page.evaluate(()=>window.publish({root:null}));
 await page.evaluate(()=>window.change({active:false}));measured.hidden=await counts();assert.equal(measured.hidden.observations,0);
 await page.evaluate(()=>window.publish({cycle:200}));assert.doesNotMatch(await text(),/protected-/,'hidden late replacement cannot render');
 await page.evaluate(()=>window.change({viewer:'bob'}));assert.equal(await input.inputValue(),'','account change while inactive clears draft');
 await page.evaluate(()=>window.change({active:true}));assert.match(await text(),/protected-200/);assert.doesNotMatch(await text(),/protected-0\b/);
 for(const change of [{backend:'two'},{conversation:'other'},{replaceClient:true}]){await input.fill('reset');await page.evaluate(v=>window.change(v),change);assert.equal(await input.inputValue(),'');}
 await page.evaluate(()=>window.publish({cycle:0}));await page.evaluate(()=>window.change({sibling:true}));assert.equal((await counts()).points,20,'same-key active sibling shares point');
 await page.evaluate(()=>window.change({active:false}));assert.equal((await counts()).observations,1);assert.match(await text(),/protected-0/);
 await page.evaluate(()=>window.change({mode:'visibility'}));assert.equal(await page.evaluate(()=>window.visibilityListeners()),1,'Strict Mode leaves one native visibility listener');
 await page.evaluate(()=>window.nativeVisibility('background'));await page.waitForFunction(()=>document.body.textContent.includes('background'));
 await page.evaluate(()=>window.webVisibility('visible'));assert.match(await text(),/background/,'web visibility cannot override native background');
 await page.evaluate(()=>window.nativeVisibility('active'));await page.waitForFunction(()=>document.body.textContent.includes('foreground'));
 await page.evaluate(()=>window.webVisibility('hidden'));assert.match(await text(),/background/);assert.equal(await page.evaluate(()=>window.webVisibilityListeners()),1);
 const end=await page.evaluate(()=>window.finish());assert.equal(end.observations,0);assert.equal(end.opens,end.closes);assert.equal(end.viewers,0);assert.equal(await page.evaluate(()=>window.visibilityListeners()),0);assert.equal(await page.evaluate(()=>window.webVisibilityListeners()),0);
 assert.deepEqual(errors,[]);console.log('L1-L3 mounted measurements',JSON.stringify(measured));
});

for (const mode of ['before','after']) {
 for (const intent of ['edit','attachment','refusal']) test(`complete ${mode} conversation preserves ${intent} across backgrounding`,{timeout:hangBudget(15)},async t=>{
  const {page,errors}=await screen(t);await page.evaluate(mode=>window.change({mode}),mode);
  const input=page.getByRole('textbox',{name:'Message draft'});
  if(intent==='edit'){await page.getByRole('button',{name:'Edit',exact:true}).first().click();await input.fill('edited intent');}
  else if(intent==='attachment')await page.getByRole('button',{name:'Attach',exact:true}).click();
  else {await input.fill('recover me');await page.evaluate(()=>window.holdSend());await page.getByRole('button',{name:'Send',exact:true}).click();}
  await page.evaluate(()=>window.nativeVisibility('background'));
  if(intent==='refusal')await page.evaluate(()=>window.refuse());
  await page.evaluate(()=>window.nativeVisibility('active'));
  if(intent==='edit'){
   await page.getByRole('button',{name:'Send',exact:true}).click();
   const calls=await page.evaluate(()=>window.calls.filter(c=>['send','editMessage'].includes(c.name)));
   assert.deepEqual(calls,[{name:'editMessage',args:{message:'m0',text:'edited intent'}}]);
  }else if(intent==='attachment')assert.equal(await page.locator('output').innerText(),'Attachments: 1');
  else assert.equal(await input.inputValue(),'recover me');
  assert.deepEqual(errors,[]);
 });
}
for(const hidden of [false,true])test(`bounded starter restores a refused send${hidden?' while hidden':''}`,{timeout:hangBudget(15)},async t=>{
 const {page,errors}=await screen(t);const input=page.getByRole('textbox',{name:'Message draft'});
 await input.fill('unadmitted text');await page.evaluate(()=>window.holdSend());await page.getByRole('button',{name:'Send',exact:true}).click();assert.equal(await input.inputValue(),'');
 if(hidden)await page.evaluate(()=>window.change({active:false}));await page.evaluate(()=>window.refuse());if(hidden)await page.evaluate(()=>window.change({active:true}));
 assert.equal(await input.inputValue(),'unadmitted text');assert.match(await page.locator('body').innerText(),/Admission refused/);assert.deepEqual(errors,[]);
});
for(const mode of ['recipe','after'])test(`${mode} recovery is fenced by account, backend/client and conversation ownership`,{timeout:hangBudget(20)},async t=>{
 const {page,errors}=await screen(t);await page.evaluate(mode=>window.change({mode}),mode);
 for(const change of [{viewer:'bob'},{backend:'two',replaceClient:true},{conversation:'other'}]){
  const input=page.getByRole('textbox',{name:'Message draft'});await input.fill('old scope');await page.evaluate(()=>window.holdSend());await page.getByRole('button',{name:'Send',exact:true}).click();
  if(mode==='after')await page.evaluate(()=>window.nativeVisibility('background'));else await page.evaluate(()=>window.change({active:false}));
  await page.evaluate(change=>window.change(change),change);await page.evaluate(()=>window.refuse());
  if(mode==='after')await page.evaluate(()=>window.nativeVisibility('active'));else await page.evaluate(()=>window.change({active:true}));
  assert.equal(await input.inputValue(),'');assert.doesNotMatch(await page.locator('body').innerText(),/Admission refused/);
 }
 assert.deepEqual(errors,[]);
});
test('complete pilot quote jump mounts page 4 and scrolls without requesting a fifth page',{timeout:hangBudget(15)},async t=>{
 const {page,errors,counts}=await screen(t);await page.evaluate(()=>window.change({mode:'after'}));
 await page.locator('#message-m0').getByRole('button',{name:'Jump to quote',exact:true}).click();
 await page.waitForFunction(()=>window.counts().history===4);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));assert.ok(await page.evaluate(()=>window.scrolls.some(s=>s.y===650)),'page 4 target scrolled');assert.equal(await page.locator('#message-m65').count(),1);assert.equal((await counts()).history,4);assert.ok(await page.locator('[id^="message-"]').count()<=40);
 const ends=await page.evaluate(()=>window.ends);await page.evaluate(()=>window.publish({cycle:1}));assert.ok(await page.evaluate(()=>window.ends)>ends,'completed jump restores ordinary auto-scroll');assert.deepEqual(errors,[]);
});
test('real starter OnceViewer rechecks before consuming a selected photo',{timeout:hangBudget(15)},async t=>{
 const {page,errors}=await screen(t);await page.getByRole('button',{name:'Select photo',exact:true}).first().click();assert.equal(await page.evaluate(()=>window.recheckOwners('messagePhoto')),2);assert.equal(await page.getByRole('button',{name:'Open media',exact:true}).isEnabled(),true);
 await page.evaluate(()=>window.publish({point:{loading:true}}));assert.equal(await page.getByRole('button',{name:'Open media',exact:true}).isDisabled(),true);
 await page.evaluate(()=>window.publish({point:{denied:{code:'NO_BODY',message:'Denied',family:'rule'}}}));assert.equal(await page.getByRole('button',{name:'Open media',exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>window.assets),[]);
 await page.evaluate(()=>window.publish({point:null}));await page.getByRole('button',{name:'Select photo',exact:true}).first().click();await page.getByRole('button',{name:'Open media',exact:true}).click();assert.equal(await page.getByRole('img',{name:'Once photo'}).count(),1);assert.deepEqual(await page.evaluate(()=>window.assets),['asset']);
 await page.evaluate(()=>window.coalesced());assert.equal(await page.getByRole('img').count(),0);assert.equal(await page.evaluate(()=>window.revokes),1);assert.deepEqual(errors,[]);
});
test('complete pilot removes an open photo in every commit across a coalesced generation withdrawal',{timeout:hangBudget(15)},async t=>{
 const {page,errors}=await screen(t);await page.evaluate(()=>window.change({mode:'after'}));await page.getByRole('button',{name:'Open once',exact:true}).first().click();assert.equal(await page.getByRole('img').count(),1);
 assert.equal(await page.evaluate(()=>window.recheckOwners()),2,'viewer shares the immediate-withdrawal point, not retained recheck');await page.evaluate(()=>{window.commits=[]});await page.evaluate(()=>window.coalesced());const commits=await page.evaluate(()=>window.commits);assert.ok(commits.length);assert.ok(commits.every(c=>!c.image),JSON.stringify(commits));assert.equal(await page.getByRole('img').count(),0);assert.deepEqual(errors,[]);
});
test('full pilot observations and owner resets are measured with mounted composer and rows',{timeout:hangBudget(20)},async t=>{
 const {page,errors,counts}=await screen(t);const measured={};
 for(const mode of ['before','after']){await page.evaluate(mode=>window.change({mode}),mode);for(let n=0;n<200;n+=20)await page.evaluate(cycle=>window.publish({cycle}),n);measured[mode]=await counts();assert.equal(await page.locator('[id^="message-"]').count(),mode==='before'?200:20);}
 await page.evaluate(()=>window.publish({size:80}));measured.afterWide=await counts();assert.equal(await page.locator('[id^="message-"]').count(),40);
 await page.evaluate(()=>window.nativeVisibility('background'));measured.hidden=await counts();assert.equal(measured.hidden.observations,0);
 await page.evaluate(()=>window.nativeVisibility('active'));await page.getByRole('textbox').fill('epoch survives');await page.evaluate(()=>window.publish({size:20,cycle:0}));await page.getByRole('button',{name:'Older messages',exact:true}).click();assert.equal((await counts()).history,2);
 await page.evaluate(()=>window.coalesced());assert.equal((await counts()).history,1);assert.equal(await page.getByRole('textbox').inputValue(),'epoch survives');
 const end=await page.evaluate(()=>window.finish());assert.equal(end.opens,end.closes);assert.equal(end.observations,0);assert.deepEqual(errors,[]);console.log('Complete pilot measurements',JSON.stringify(measured));
});

test('complete pilot hides open photo before every commit of real wasm program-generation adoption',{timeout:hangBudget(15)},async t=>{
 const {page,errors}=await screen(t);await page.evaluate(()=>window.useDevice());assert.ok((await page.evaluate(()=>window.deviceReads)).every(r=>'data'in r),JSON.stringify(await page.evaluate(()=>window.deviceReads)));
 await page.getByRole('button',{name:'Open once',exact:true}).first().click();assert.equal(await page.getByRole('img').count(),1);
 await page.evaluate(()=>{window.commits=[]});await page.evaluate(()=>window.adopt());
 assert.deepEqual(await page.evaluate(()=>window.adoptions),[2],'real device committed the replacement program');
 const commits=await page.evaluate(()=>window.commits);assert.ok(commits.length);assert.ok(commits.every(c=>!c.image),JSON.stringify(commits));assert.equal(await page.getByRole('img').count(),0);
 await page.evaluate(()=>window.finish());assert.deepEqual(errors,[]);
});
