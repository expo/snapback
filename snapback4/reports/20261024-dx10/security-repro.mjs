// Executable SEC10 hand-off: record current gaps without changing gate semantics.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {cli,startDev} from '../../packages/snapback4/dist/proof.js';
const cwd=mkdtempSync(join(tmpdir(),'dx10-security-'));
const env={SNAPBACK4_BIN:resolve(import.meta.dirname,'../../target/debug/snapback4')};
mkdirSync(join(cwd,'snapback'));
const write=source=>writeFileSync(join(cwd,'snapback/schema.q'),source);
const result={};
try{
 write("fn owns(owner: principal): owner = viewer\ntable docs:\n  owner: principal\n  value: text write <- owns(.owner)\n  read <- allow\n  insert <- allow\n  online only\n");
 const helper=await cli(['check','--json'],{cwd,env});
 result.columnWriteHelper={exit:helper.code,diagnosticCodes:[...new Set((helper.stdout+helper.stderr).match(/E_[A-Z0-9_]+/g)||[])]};
 const list="table docs:\n  photos: [text <=20] 1..4\n  read <- allow\n  online only\n";
 write(list);const before=await cli(['check','--json'],{cwd,env});
 write(list.replace('1..4','<=4'));const after=await cli(['check','--json'],{cwd,env});
 result.listMinimum={beforeExit:before.code,afterExit:after.code,asksPresence:(after.stdout+after.stderr).includes('N_PRESENCE_LOOSENING')};
 write("use identity guests\nuse personas alice, bob\ntable docs:\n  photos: [text <=20] <=4 write <- viewer = 'alice'\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  return insert docs {photos: []}\n");
 const host=await startDev({cwd,env,args:['--memory']});
 try {
  const reply=await fetch(host.url+'/m/add',{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'bob'},body:JSON.stringify({args:{}})}).then(r=>r.json());
  result.emptyInitialization={state:reply.state,code:reply.why?.code};
 }finally{await host.stop();}
 console.log(JSON.stringify(result,null,2));
}finally{rmSync(cwd,{recursive:true,force:true});}
