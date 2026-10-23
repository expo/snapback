import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,copyFileSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {numericAdvanceUse} from "../bin/upgrade-warnings.js";
const root=fileURLToPath(new URL("../../../",import.meta.url));
test("numeric advance advice follows the consumed result",()=>{
 for(const source of ["const result = await host.advance('1h'); console.log(result.now); const x=1+2; new Date();", "// await host.advance('1h') > 0", "const text = \"advance(\"; const x=2-1;", "await host.advance('2h'); assert.equal(rows.length,1);"])
  assert.equal(numericAdvanceUse(source),false,source);
 for(const source of ["const now = await host.advance('1h'); assert.ok(now > before);", "const now = await advance('1h'); new Date(now);", "new Date(await host.advance('1h'));", "(await host.advance('1h')) - before;"])
  assert.equal(numericAdvanceUse(source),true,source);
});
test("DX7 guide and staging/browser consumer",{timeout:180000},async t=>{
 const cwd=mkdtempSync(join(tmpdir(),"sb4-dx7-"));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 mkdirSync(join(cwd,"node_modules"));symlinkSync(join(root,"packages/snapback4"),join(cwd,"node_modules/snapback4"),"dir");
 copyFileSync(join(root,"scripts/dx7-consumer.mjs"),join(cwd,"consumer.mjs"));
 const child=spawn(process.execPath,["consumer.mjs"],{cwd,env:{...process.env,SNAPBACK4_BIN:process.env.SNAPBACK4_BIN??join(root,"target/debug/snapback4")},stdio:["ignore","pipe","pipe"]});
 let output="";child.stdout.on("data",v=>output+=v);child.stderr.on("data",v=>output+=v);
 const timer=setTimeout(()=>child.kill("SIGTERM"),170000);
 try{const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve)});assert.equal(code,0,output);}
 finally{clearTimeout(timer);}
});
