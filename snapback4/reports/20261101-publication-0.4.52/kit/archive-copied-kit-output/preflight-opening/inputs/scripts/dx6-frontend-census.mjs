// Copy only authored frontend source; never edit bakeoff evidence or retain scratch.
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const evidence = process.argv[2] ?? join(homedir(), 'sb4-loop/wave22/apps');
const census = JSON.parse(readFileSync(process.argv[3] ?? join(evidence, '../../wave22-repro/front/census.json'), 'utf8'));
const names = ['001-snapback-stained-glass-restorations','037-snapback-orthotic-casting-orders','040-snapback-excavator-rental-returns'];
const scratch = mkdtempSync(join(tmpdir(),'sb4-dx6-frontend-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const chars = source => source.replace(/\s/g,'').length;
try {
  const results=[];
  for (const lane of names) {
    const files = census.find(entry=>entry.lane===lane).files;
    const snapshots=files.map(({rel})=>({rel,source:readFileSync(join(evidence,lane,rel),'utf8')}));
    for (const {rel,source} of snapshots) {const path=join(scratch,lane,rel);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);}
    const path=join(scratch,lane,'src/client.ts'), source=readFileSync(path,'utf8');
    assert.match(source,/registerWebWitness\(app, api\)/);
    let changed=source.replace(/^import \{ registerWebWitness \}.*\n/m,'').replace(/^import \{ api \}.*\n/m,'')
      .replace(/^const witnessPersona[^\n]*\n[^\n]*\n/m,'').replace('...(witnessPersona ? { persona: witnessPersona } : {}),','')
      .replace('registerWebWitness(app, api);','');
    assert.doesNotMatch(changed,/witnessPersona|registerWebWitness/); writeFileSync(path,changed);
    const before=snapshots.reduce((n,file)=>n+chars(file.source),0);
    const after=snapshots.reduce((n,file)=>n+chars(readFileSync(join(scratch,lane,file.rel),'utf8')),0);
    for (const {rel,source} of snapshots) assert.equal(hash(readFileSync(join(evidence,lane,rel))),hash(source),'frozen evidence changed');
    results.push({lane,frontendFiles:files.length,before,after,delta:after-before,changedFiles:['src/client.ts']});
  }
  console.log(JSON.stringify({method:'all authored frontend files in wave-22 census; whitespace removed; looksBuilt never excludes authored source; isolated witness-plumbing removal only; originals hash-identical',results},null,2));
} finally {rmSync(scratch,{recursive:true,force:true});}
