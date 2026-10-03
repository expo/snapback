import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const report=path.dirname(new URL(import.meta.url).pathname);
const cases=['cold','warm1','warm2','warm3','warm4','warm5','native-change','startup-throw','missing-runtime','opt-out'];
const metrics={};
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
for(const starter of ['plain','social']) {
  const runs=Object.fromEntries(cases.map(label=>[label,JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)))]));
  const warm=cases.filter(x=>x.startsWith('warm')).map(x=>runs[x]);
  assert.equal(new Set(warm.map(r=>r.bundleHash)).size,5);
  for(const r of [runs.cold,...warm,runs['native-change']]) {
    assert.equal(r.status,0); assert.equal(r.receiptExit,0); assert.equal(r.bundleHash,r.loadedHash);
    assert.deepEqual(Object.values(r.segments),['passed','passed','passed']);
  }
  for(const r of warm) {assert.equal(r.cache.hit,true);assert.deepEqual(r.cache.fingerprint,runs.cold.cache.fingerprint);}
  assert.equal(runs.cold.cache.hit,false);assert.equal(runs['native-change'].cache.hit,false);
  assert.notDeepEqual(runs['native-change'].cache.fingerprint,runs.cold.cache.fingerprint);
  assert.equal(runs['startup-throw'].status,1);assert.equal(runs['startup-throw'].receiptExit,1);
  assert.equal(runs['startup-throw'].cache.hit,true);assert.equal(runs['startup-throw'].segments.prime,'failed');
  assert.match(fs.readFileSync(path.join(path.dirname(runs['startup-throw'].receiptPath),'smoke-ios-device.log'),'utf8'),/NX_STARTUP_THROW/);
  assert.equal(runs['missing-runtime'].status,0);assert.equal(runs['missing-runtime'].phase,'environment');
  assert.equal(runs['opt-out'].status,0);assert.equal(runs['opt-out'].receiptPath,undefined);
  const warmMedianMs=median(warm.map(r=>r.durationMs));assert.ok(warmMedianMs<=25000,`${starter} exceeded warm target`);
  metrics[starter]={warmMedianMs,nativeWarmMedianMs:median(warm.map(r=>r.nativeDurationMs)),runs};
}
fs.writeFileSync(path.join(report,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
console.log('| Case | Plain export:ios | Social export:ios | Outcome |\n| --- | ---: | ---: | --- |');
for(const label of cases) {
 const result=label==='startup-throw'?'exit 1, expected':label==='missing-runtime'?'exit 0, native skipped':label==='opt-out'?'exit 0, opted out':'exit 0, three segments pass';
 console.log(`| ${label} | ${(metrics.plain.runs[label].durationMs/1000).toFixed(3)} s | ${(metrics.social.runs[label].durationMs/1000).toFixed(3)} s | ${result} |`);
}
console.log(`| **Five-run warm median** | **${(metrics.plain.warmMedianMs/1000).toFixed(3)} s** | **${(metrics.social.warmMedianMs/1000).toFixed(3)} s** | All five distinct bundles loaded |`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,{warmMedianMs:v.warmMedianMs,nativeWarmMedianMs:v.nativeWarmMedianMs}]))));
