// @ref LLP 3000.023#10 — public option documentation describes both retaining policies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sdk} from './helpers/answers-stay.mjs';
const {ReadObservation}=await import(new URL('read-observation.js',sdk));
test('ObserveOptions documents plain retention and bounded change evidence for omitted and true',()=>{
 const contract=readFileSync(process.env.PR_CONTRACT_SOURCE??new URL('../src/contract.ts',import.meta.url),'utf8');
 const comments=contract.slice(contract.lastIndexOf('/**',contract.indexOf('export interface ObserveOptions')),contract.indexOf('export interface ObserveOptions'));
 assert.match(comments,/plain revalidation without a timeout/);
 assert.match(comments,/Change evidence bounds both/);
 assert.doesNotMatch(comments,/True: retain without the time cap/);
});
for(const keep of [undefined,true])test(`plain revalidation is unbounded; evidence bounds keep=${keep}`,t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
 const watch=new ReadObservation(keep);t.after(()=>watch.retire());
 watch.publish({data:'answer',complete:true,fresh:true,cut:null});watch.reload();
 t.mock.timers.tick(5000);assert.equal(watch.read(null).data,'answer');
 watch.reload(true);t.mock.timers.tick(1000);assert.deepEqual(watch.read(null),{loading:true});
});
