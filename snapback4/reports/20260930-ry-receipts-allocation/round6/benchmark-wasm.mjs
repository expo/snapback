// Run after builds/tests drain. Arguments: main Snapback4 root, candidate root, fixture.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const [mainRoot, candidateRoot, fixturePath] = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const devices = [];
for (const root of [mainRoot, candidateRoot]) {
  const base = `${root}/packages/snapback4/src/wasm/snapback4_device`;
  const module = await import(pathToFileURL(base + '.js'));
  await module.default({ module_or_path: readFileSync(base + '_bg.wasm') });
  const device = new module.WebDevice(JSON.stringify(fixture.backend), '[]');
  const apply = JSON.parse(device.call(JSON.stringify({op:'apply',first:true,page:fixture.page})));
  assert.ok(Object.hasOwn(apply, 'ok'), JSON.stringify(apply));
  devices.push(device);
}
const cases = [0,100,500,1000].map(size => ({label:`count-${size}`, op:'query',name:'countLoop',viewer:'alice',args:{xs:Array.from({length:size},(_,i)=>i)},search:true}));
cases.push({label:'ordinary-100',op:'query',name:'list',viewer:'alice',args:{c:null},search:true});
for (const {label,...query} of cases) {
  const input = JSON.stringify(query), times=[[],[]];
  let answers;
  for (let i=0;i<101;i++) {
    answers=[];
    for (const side of (i%2 ? [1,0] : [0,1])) {
      const start=process.hrtime.bigint(); const output=devices[side].call(input);
      const ns=Number(process.hrtime.bigint()-start);
      if(i>=20)times[side].push(ns);
      answers[side]=JSON.parse(output);
    }
    assert.deepEqual(answers[0], answers[1], label);
    assert.ok(answers[0].ok && !answers[0].ok.loading && !answers[0].ok.denied,JSON.stringify(answers[0]));
  }
  if(label==='ordinary-100')assert.equal(answers[0].ok.data.length,100);
  else assert.equal(answers[0].ok.data,query.args.xs.length);
  console.log(JSON.stringify({case:label, main:summary(times[0]),candidate:summary(times[1]),response:answers[0]}));
}
const entry={id:'benchmark-write',seq:1,op:'add',args:{title:'ordinary prediction'},new_ids:['benchmark-row'],predicted:[],viewer:'alice',now:1,predictable:true,sent_seq:null,observed_seq:null};
const predicted=devices.map(device=>JSON.parse(device.call(JSON.stringify({op:'admit',entry}))));
assert.deepEqual(predicted[0],predicted[1]);assert.equal(predicted[0].ok.predictable,true);
const reads=devices.map(device=>JSON.parse(device.call(JSON.stringify({op:'query',name:'list',viewer:'alice',args:{c:null},search:true}))));
assert.deepEqual(reads[0],reads[1]);assert.equal(reads[0].ok.data.find(r=>r.id==='benchmark-row')?.pending,true);
console.log(JSON.stringify({behavior:'identical classification fixture, acquired query results/meters, ordinary predictable write and pending query result',prediction:predicted[0]}));
for(const device of devices)device.free();
function summary(values){values.sort((a,b)=>a-b);return {median_ns:values[40],p10_ns:values[8],p90_ns:values[72]};}
