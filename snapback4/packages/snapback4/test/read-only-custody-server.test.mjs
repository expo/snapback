// @ref LLP 3000.033#3 — custody failures reproduced against the HTTP server.
import test from 'node:test';import assert from 'node:assert/strict';
import {createApp} from '../dist/app.js';
import {signup,sessionKey} from '../dist/auth.js';
import {server,until} from './helpers/app-server.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const password='review-read-only-password';
async function fixture(t,readOnly=true){
 const {url}=await server(t,undefined,'use identity\nquery who():\n  return viewer\n');
 const initial=await signup(url,'bob@example.test',password,{scope:readOnly?'read':'full'});assert.ok(initial.ok);
 const key=sessionKey(url,readOnly),values=new Map([[key,JSON.stringify(initial.session)]]);
 const store={async get(k){return values.get(k)??null},async set(k,v){values.set(k,v)},async delete(k){values.delete(k)}};
 return {url,initial:initial.session,key,values,store};
}
for(const readOnly of [true,false]) test(`peer logout vs held committed login, readOnly=${readOnly}`,{timeout:10000},async t=>{
 const {url,key,store,values}=await fixture(t,readOnly),entered=deferred(),release=deferred();t.after(()=>release.resolve());
 const a=createApp({url,readOnly,sessionStore:store}),b=createApp({url,readOnly,sessionStore:store,fetch:async(input,init)=>{const response=await fetch(input,init);if(new URL(input).pathname==='/auth/login'){entered.resolve();await release.promise}return response}});
 t.after(()=>Promise.all([a.close(),b.close()]));await Promise.all([a.ready,b.ready]);
 const login=b.auth.login('bob@example.test',password);await entered.promise;assert.equal((await a.auth.logout()).ok,true);release.resolve();const result=await login;
 const restart=createApp({url,readOnly,sessionStore:store});t.after(()=>restart.close());await restart.ready;
 const answer=await restart.client.query({kind:'query',name:'who'},{});
 assert.equal(result.ok,false);assert.ok('denied' in answer);
 assert.equal(restart.auth.state,'signed-out');
});
test('simultaneous read refresh refusals preserve live custody across restart', { timeout: 10000 }, async t => {
  const { url, key, store, values, initial } = await fixture(t), requests = [];
  const transport = async (input, init) => { requests.push(new URL(input).pathname); return fetch(input, init); };
  const a = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  const b = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  t.after(() => Promise.all([a.close(), b.close()])); await Promise.all([a.ready, b.ready]);
  for (const result of await Promise.all([a.client.refreshSession(), b.client.refreshSession()])) assert.equal(result.why.code, 'E_READ_ONLY_REFRESH');
  const live = await (await fetch(url + '/probe?scope=1', { headers: { authorization: `Bearer ${initial.token}` } })).json();
  assert.equal(live.ok, true); assert.equal(JSON.parse(values.get(key)).token, initial.token);
  await b.close();
  const restart = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  t.after(() => restart.close()); assert.equal((await restart.ready).ok, true);
  assert.equal((await restart.client.query({ kind: 'query', name: 'who' }, {})).data, initial.principal);
  assert.ok(!requests.includes('/auth/refresh'));
});
