import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,copyFileSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
const root=fileURLToPath(new URL("../../../",import.meta.url));
test("DX6 staging clock consumer",{timeout:120000},async t=>{
  const cwd=mkdtempSync(join(tmpdir(),"sb4-dx6-clock-"));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,"node_modules"));
  symlinkSync(join(root,"packages/snapback4"),join(cwd,"node_modules/snapback4"),"dir");
  copyFileSync(join(root,"scripts/dx6-clock-consumer.mjs"),join(cwd,"consumer.mjs"));
  const child=spawn(process.execPath,["consumer.mjs"],{cwd,env:{...process.env,SNAPBACK4_BIN:process.env.SNAPBACK4_BIN??join(root,"target/debug/snapback4")},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",v=>output+=v);child.stderr.on("data",v=>output+=v);
  const timer=setTimeout(()=>child.kill("SIGTERM"),110000);
  try {const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve)});assert.equal(code,0,output);}
  finally {clearTimeout(timer);}
});
