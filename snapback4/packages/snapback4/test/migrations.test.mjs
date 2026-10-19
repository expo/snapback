import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { command } from "../dist/proof.js";
const root=fileURLToPath(new URL("../../../",import.meta.url));
test("MIG exact production guide runs twice on one persistent store", {timeout:120000}, async()=>{
 const cwd=mkdtempSync(join(tmpdir(),"sb4-migration-guide-"));
 try {
  const text=readFileSync(join(root,"crates/snapback4-lang/src/guide/deploy.md"),"utf8");
  const script=[...text.matchAll(/```js\n([\s\S]*?)\n```/g)].map(m=>m[1]).find(s=>s.startsWith("// day-two-production.mjs"));assert.ok(script);
  const installed=join(root,"packages/snapback4/dist");
  // Only import routing changes for the source-tree unit witness. Qualification
  // executes the exact installed fence with its original package imports.
  writeFileSync(join(cwd,"proof.mjs"),script.replace('"snapback4/proof"',JSON.stringify(join(installed,"proof.js"))).replace('"snapback4/auth"',JSON.stringify(join(installed,"auth.js"))));
  for(let i=0;i<2;i++){
   const out=await command(process.execPath,["proof.mjs"],{cwd,env:{SNAPBACK4_BIN:join(root,"target/debug/snapback4")},timeoutMs:60000});
   assert.equal(out.code,0,out.stderr+out.stdout);assert.match(out.stdout,/"status":"passed"/);
  }
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
