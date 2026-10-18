// Execute the published security card and starter through actual npm packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('packed security card and starter run as written; broad reads refute', {timeout:240000}, t=>{
 const dir=mkdtempSync(join(tmpdir(),'sb4-security-packed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const run=(cmd,args,cwd=dir,expected=0)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:120000,env:{...process.env,SNAPBACK4_BIN:''}});assert.equal(r.status,expected,`${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);return r.stdout;};
 const pack=source=>join(dir,JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],source))[0].filename);
 const client=pack(join(root,'packages/snapback4'));const nativeName=`snapback4-${process.platform}-${process.arch}`;
 const native=join(dir,'native');mkdirSync(native);copyFileSync(join(root,'packages',nativeName,'package.json'),join(native,'package.json'));copyFileSync(process.env.SNAPBACK4_BIN||join(root,'target/debug/snapback4'),join(native,'snapback4'));
 const platform=pack(native);writeFileSync(join(dir,'package.json'),'{}');
 run('npm',['install','--ignore-scripts','--omit=optional','--no-audit','--no-fund',client,platform]);
 const cli=join(dir,'node_modules/snapback4/bin/snapback4.js');const command=(args,cwd=dir,code=0)=>run(process.execPath,[cli,...args],cwd,code);
 const guide=command(['guide','security','--full']);const blocks=[...guide.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(m=>m[1]);assert.ok(blocks.length);
 for(let i=0;i<blocks.length;i++){
  const app=join(dir,`card-${i}`);mkdirSync(join(app,'snapback'),{recursive:true});writeFileSync(join(app,'snapback/schema.q'),blocks[i]);
  let checked=JSON.parse(command(['check','--json'],app));assert.equal(checked.ok,true);assert.ok(checked.security.invariants.length);
  assert.ok(checked.security.invariants.every(v=>['proved','unproved'].includes(v.status)),JSON.stringify(checked.security));assert.ok(checked.security.invariants.every(v=>v.direct_rule==='proved'));
  const audited=JSON.parse(command(['audit','--json'],app));assert.equal(audited.format,1);assert.ok(audited.exposures.some(x=>x.table==='privateNotes'));
  assert.ok(command(['test'],app).includes('security tests:'));
  writeFileSync(join(app,'snapback/schema.q'),blocks[i].replace('read <- .patient = viewer','read <- allow'));
  checked=JSON.parse(command(['check','--json'],app,1));assert.equal(checked.ok,false);assert.ok(checked.security.invariants.some(v=>v.status==='refuted'));
  command(['test'],app,1);
 }
 const starter=join(dir,'starter');command(['init',starter,'--online']);const source=readFileSync(join(starter,'snapback/schema.q'),'utf8');assert.ok(source.includes('invariant todos.read only .ownerId = viewer'));
 command(['check'],starter);assert.ok(command(['test'],starter).includes('security tests:'));
 const social=join(dir,'social');command(['init',social,'--template','social']);
 command(['check'],social);assert.ok(command(['test'],social).includes('security tests:'));
 const web=join(dir,'web');command(['init',web,'--web']);
 command(['check'],web);assert.ok(command(['test'],web).includes('security tests:'));
 const production=join(dir,'production');mkdirSync(join(production,'snapback'),{recursive:true});
 copyFileSync(join(web,'recipes/production/schema.q'),join(production,'snapback/schema.q'));
 command(['check'],production);assert.ok(command(['test'],production).includes('security tests:'));
});
