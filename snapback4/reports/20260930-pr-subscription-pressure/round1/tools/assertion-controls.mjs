// Run from snapback4/. Fault only test adapters, preserve all production bytes.
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const root='reports/20260930-pr-subscription-pressure/round1';
const paths=[];
try {
  for(const revision of ['round0','round1']) {
    const name='snapback4/packages/snapback4/test/answer-withdrawal.test.mjs';
    let source=revision==='round0'?execFileSync('git',['show','ab2da069c5:'+name],{encoding:'utf8'}):readFileSync(name.slice('snapback4/'.length),'utf8');
    const anchor='          if (mode === "throw") throw Error("failed post-commit device read");';
    assert.ok(source.includes(anchor));
    source=source.replace(anchor,`          if (kind === "apply" && ["throw", "unavailable"].includes(mode)) {
            await delay(150);
            return { ok: { data: { id: 'private', room: 'room', body: 'private answer' }, unknown: false, complete: true, tables: ['secrets'] } };
          }
`+anchor);
    const path=`packages/snapback4/test/.pr-${revision}-assertion-control.test.mjs`;
    assert.equal(existsSync(path),false); paths.push(path); writeFileSync(path,source);
    const result=spawnSync(process.execPath,['--test','--test-name-pattern','^(wasm|process): apply revocation, keep=undefined, (throw|unavailable)$',path],{encoding:'utf8',maxBuffer:8*1024*1024});
    writeFileSync(`${root}/assertion-${revision}.log`,result.stdout+result.stderr);
    writeFileSync(`${root}/assertion-${revision}.exit`,String(result.status)+'\n');
    assert.equal(result.status,revision==='round0'?0:1,revision+' must '+(revision==='round0'?'miss':'detect')+' the late stale completion');
    rmSync(path);
  }
  const file=`${root}/convergence-active-wasm.json`;
  const trace=JSON.parse(existsSync(file) ? readFileSync(file,'utf8') : gunzipSync(readFileSync(file+'.gz')).toString());
  const results=structuredClone(trace.results);
  assert.ok(results.some(r=>r.withdrawals.length));
  for(const r of results)for(const w of r.withdrawals)w.inFlight=false;
  const verdicts={};
  for(const revision of ['round0','round1']) {
    const name='snapback4/packages/snapback4/test/subscription-pressure-e2e.test.mjs';
    const source=revision==='round0'?execFileSync('git',['show','ab2da069c5:'+name],{encoding:'utf8'}):readFileSync(name.slice('snapback4/'.length),'utf8');
    const begin=source.lastIndexOf('  for (const result of results) {');
    assert.ok(begin>0);
    const verify=new Function('assert','results',source.slice(begin,source.lastIndexOf('});')));
    let rejected=false;try{verify(assert,results);}catch{rejected=true;}
    verdicts[revision]={rejectedIdleTimeout:rejected};
    assert.equal(rejected,revision==='round1');
  }
  writeFileSync(root+'/GAP-ASSERTION-CONTROL.json',JSON.stringify(verdicts,null,2)+'\n');
} finally {for(const path of paths)rmSync(path,{force:true});rmSync(root+'/hold-ll',{force:true});}
