// Execute the published security card and starter through actual npm packs.
import test from 'node:test';
import {proveSecurity} from '../../../scripts/publication-security.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('packed security card and starter run as written; broad reads refute', {timeout:360000}, async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sb4-security-packed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const run=(cmd,args,cwd=dir,expected=0)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:120000,env:{...process.env,SNAPBACK4_BIN:''}});assert.equal(r.status,expected,`${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);return r.stdout;};
 const pack=source=>join(dir,JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],source))[0].filename);
 const client=pack(join(root,'packages/snapback4'));const nativeName=`snapback4-${process.platform}-${process.arch}`;
 const native=join(dir,'native');mkdirSync(native);copyFileSync(join(root,'packages',nativeName,'package.json'),join(native,'package.json'));copyFileSync(process.env.SNAPBACK4_BIN||join(root,'target/debug/snapback4'),join(native,'snapback4'));
 copyFileSync(join(root,'packages',nativeName,'THIRD-PARTY-NOTICES'),join(native,'THIRD-PARTY-NOTICES'));
 const platform=pack(native);writeFileSync(join(dir,'package.json'),'{}');
 if(process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE){
  const evidence=process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE;mkdirSync(evidence,{recursive:true});
  const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
  for(const file of [client,platform])copyFileSync(file,join(evidence,basename(file)));
  writeFileSync(join(evidence,'packs.json'),JSON.stringify({source:process.env.SNAPBACK4_SECURITY_SOURCE||null,client:{file:basename(client),sha256:digest(client)},platform:{file:basename(platform),sha256:digest(platform)},binarySha256:digest(join(native,'snapback4'))},null,2)+'\n');
 }

 const result=await proveSecurity(client,platform,dir);
 assert.equal(result.status,'passed');
 assert.ok(result.guideCases.every(c=>c.broadRead==='refuted'));
 assert.equal(result.starters.length,6);
 if(process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE)
  writeFileSync(join(process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE,'security-evidence.json'),JSON.stringify(result,null,2)+'\n');
});
