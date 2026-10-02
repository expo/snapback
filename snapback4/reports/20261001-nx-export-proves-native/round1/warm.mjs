import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const starter=process.argv[2],report=path.resolve('reports/20261001-nx-export-proves-native/round1'),project=path.resolve('target/nx',starter);
const source=path.join(project,starter==='plain'?'App.tsx':'app/_layout.tsx');
const original=fs.readFileSync(source,'utf8');fs.writeFileSync(path.join(report,starter+'-original.txt'),original);
fs.mkdirSync(path.join(project,'src'),{recursive:true});
// A real tiny PNG becomes a Metro resource; the file remains when its require is removed.
fs.writeFileSync(path.join(project,'src/retired.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64'));
const requireAsset=`\nconsole.log('NX asset', require('${starter==='plain'?'./src':'../src'}/retired.png'));\n`;
function run(label,hit){spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});const r=JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)));assert.equal(r.status,0);assert.equal(r.receiptExit,0);assert.equal(r.cache.hit,hit);assert.deepEqual(Object.values(r.segments),['passed','passed','passed']);assert.equal(r.bundleHash,r.loadedHash);return r;}
fs.writeFileSync(source,original+requireAsset);const cold=run('cold',false);let previous=cold.bundleHash;const durations=[];
for(let i=1;i<=5;i++){fs.writeFileSync(source,original+requireAsset+`\nconsole.log('NX round1 ${starter} JS ${i}');\n`);const r=run('warm'+i,true);assert.notEqual(r.bundleHash,previous);previous=r.bundleHash;durations.push(r.durationMs);}
console.log('WARM MEDIAN',starter,durations.sort((a,b)=>a-b)[2]);
fs.writeFileSync(source,original+`\nconsole.log('NX round1 ${starter} asset removed');\n`);
const removed=run('asset-removed',true);assert.equal(removed.metroResources.some(r=>r.path.endsWith('/retired.png')),false);
