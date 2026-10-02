import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process'; import assert from 'node:assert/strict';
const report=path.resolve('reports/20261001-nx-export-proves-native/round2');
for (const starter of ['plain','social']) {
 const project=path.resolve('target/nx',starter), source=path.join(project,starter==='plain'?'App.tsx':'app/_layout.tsx');
 const original=fs.readFileSync(source,'utf8'); fs.writeFileSync(path.join(report,`${starter}-original.txt`),original);
 fs.rmSync(path.join(project,'.snapback4-witness'),{recursive:true,force:true});
 const times=[],hashes=new Set();
 try { for(let i=0;i<=5;i++) {
  fs.writeFileSync(source,original+`\nconsole.log('NX round2 ${starter} cohort edit ${i}');\n`);
  const label=i===0?'cold':`warm${i}`;
  const r=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'}); assert.equal(r.status,0);
  const row=JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)));
  assert.equal(row.receiptExit,0); assert.equal(row.cache.hit,i>0); assert.equal(row.bundleHash,row.loadedHash);
  assert.deepEqual(Object.values(row.segments),['passed','passed','passed']);
  if(i>0){times.push(row.durationMs);hashes.add(row.loadedHash);}
 } } finally {fs.writeFileSync(source,original);}
 assert.equal(hashes.size,5);const median=times.toSorted((a,b)=>a-b)[2];
 fs.writeFileSync(path.join(report,`${starter}-warm-summary.json`),JSON.stringify({times,medianMs:median,distinctLoadedBundles:hashes.size},null,2));
 console.log('MEDIAN',starter,median);
}
