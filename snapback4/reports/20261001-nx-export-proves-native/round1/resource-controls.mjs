import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const starter=process.argv[2],report=path.resolve('reports/20261001-nx-export-proves-native/round1'),project=path.resolve('target/nx',starter);
const source=path.join(project,starter==='plain'?'App.tsx':'app/_layout.tsx'),original=fs.readFileSync(path.join(report,starter+'-original.txt'),'utf8');
fs.mkdirSync(path.join(project,'src'),{recursive:true});
fs.writeFileSync(path.join(project,'src/retired.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64'));
function run(label,hit){const child=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});assert.equal(child.status,0);const r=JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)));assert.equal(r.status,0);assert.equal(r.receiptExit,0);assert.equal(r.cache.hit,hit);return r;}
fs.writeFileSync(source,original+`\nconsole.log('NX asset', require('${starter==='plain'?'./src':'../src'}/retired.png'));\n`);
const present=run('asset-present',false);
assert.equal(present.metroResources.some(r=>r.path.endsWith('/retired.png')),true);
fs.writeFileSync(source,original+`\nconsole.log('NX round1 ${starter} asset removed');\n`);
const removed=run('asset-removed',true);
assert.equal(removed.metroResources.some(r=>r.path.endsWith('/retired.png')),false);
const child=spawnSync(process.execPath,[path.join(report,'controls.mjs'),starter],{stdio:'inherit'});assert.equal(child.status,0);
