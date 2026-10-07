import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const fixture=resolve('crates/snapback4-lang/tests/fixtures/rx');
const published=resolve('target/rx/published');
const integrity=JSON.parse(readFileSync('reports/20261006-rx-rule-hops/published-integrity.json'));
for(const pkg of integrity){assert.equal('sha512-'+createHash('sha512').update(readFileSync(join(published,pkg.name+'.tgz'))).digest('base64'),pkg.integrity);}
const binary=join(published,'snapback4-linux-x64/package/snapback4');
const one=readFileSync(join(fixture,'legacy-one-hop.q'),'utf8');
const zero=one.replace(/  insert <- \.parent[^\n]+/,'  insert <- allow').replace(/  update \(old, next\)[^\n]+/,'  update <- allow').replace(/  delete <- \.parent[^\n]+/,'  delete <- allow');
writeFileSync(join(fixture,'legacy-zero-hop.q'),zero);
const records=[];
for(const [shape,source] of [['one-hop',one],['zero-hop',zero]]){
 const cwd=mkdtempSync(join(tmpdir(),'rx-legacy-'));mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),source);
 try{
  const ran=spawnSync(binary,['run','setup','{}','--as','alice'],{cwd,encoding:'utf8',timeout:60000});assert.equal(ran.status,0,ran.stdout+ran.stderr);
  const db=new DatabaseSync(join(cwd,'.snapback4/store.sqlite'),{readOnly:true});
  const row=db.prepare('SELECT generation, schema, programs FROM _generations ORDER BY generation DESC LIMIT 1').get();db.close();
  const programs=Object.values(JSON.parse(row.programs)).sort((a,b)=>a.name.localeCompare(b.name));
  const bytes=`{"generation":${row.generation},"schema":${row.schema},"programs":[${programs.map(x=>JSON.stringify(x)).join(',')}]}`;
  writeFileSync(join(fixture,`legacy-${shape}.json`),bytes+'\n');
  records.push({shape,sourceSha256:createHash('sha256').update(source).digest('hex'),backendSha256:createHash('sha256').update(bytes).digest('hex'),schemaSha256:createHash('sha256').update(row.schema).digest('hex'),bytes:Buffer.byteLength(bytes)});
 }finally{rmSync(cwd,{recursive:true,force:true});}
}
writeFileSync(join(fixture,'legacy-provenance.json'),JSON.stringify({version:'0.4.13',sourceFile:'snapback/schema.q',command:'snapback4 run setup {} --as alice',packages:integrity,records},null,2)+'\n');
console.log(JSON.stringify(records,null,2));
