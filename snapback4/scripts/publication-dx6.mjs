// Packed DX6 regressions, using the installed platform executable and SDK.
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runToolchainCommand} from "./publication-starters.mjs";
import {chromiumExecutable} from "../witness/lib.mjs";

export async function proveDX6(directory) {
  const parent=resolve(directory),scratch=mkdtempSync(join(parent,"dx6-"));
  const root=fileURLToPath(new URL("../",import.meta.url));
  const env={...process.env,CHROME:chromiumExecutable()};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const run=(args,cwd=scratch)=>runToolchainCommand(process.execPath,args,{cwd,env,timeout:240000});
  try {
    const clock=join(scratch,"clock");mkdirSync(clock);
    writeFileSync(join(clock,"consumer.mjs"),readFileSync(join(root,"scripts/dx6-clock-consumer.mjs")));
    await run(["consumer.mjs"],clock);
    writeFileSync(join(scratch,"text.mjs"),textConsumer);
    await run(["text.mjs"]);
    // Inspection must refuse before reading a future store's application rows.
    await runToolchainCommand("python3",["-c",`import sqlite3,sys
p=sys.argv[1]
c=sqlite3.connect(p)
c.execute("UPDATE _meta SET value = ? WHERE key = 'version'",('snapback4-release-store-99',))
c.commit()
c.close()`,join(clock,"staging/store.sqlite")],{cwd:scratch,env,timeout:30000});
    const wrapper=join(parent,"node_modules/snapback4/bin/snapback4.js");
    writeFileSync(join(scratch,"future.mjs"),`import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const r=spawnSync(process.execPath,[${JSON.stringify(wrapper)},'sql','SELECT * FROM items','--release',${JSON.stringify(join(clock,'staging'))},'--json'],{encoding:'utf8',timeout:30000});
assert.notEqual(r.status,0);assert.match(r.stderr,/E_SCHEMA_CAPABILITY.*newer Snapback/);assert.equal(r.stdout.trim(),'');`);
    await run(["future.mjs"]);
    return {status:"passed",installedSDK:true,clock:"preserved session, deadline before sweep, pause/drain, explicit expiry, held refusal",sessions:"complete seeded account and legacy partial literal",numericAdvance:"valueOf/date/arithmetic",text:"composed RN, wrapping label, scoped exactness and strict ambiguity",futureStore:"nonzero sql refusal before inspection"};
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
const textConsumer=String.raw`
import assert from 'node:assert/strict';
import {withBrowser,renderedText,statusText,waitForFresh} from 'snapback4/proof';
await withBrowser({executablePath:process.env.CHROME,cwd:process.cwd()},async context=>{
 const page=await context.newPage();
 await page.setContent('<section aria-label="Rows"><div><span>Order </span><span>42</span><span> saved</span></div><label><span>Due </span><b>tomorrow</b><input value="secret"></label></section>');
 const within=page.getByRole('region',{name:'Rows'});
 assert.equal(await waitForFresh(renderedText(page,'Order 42 saved',{within}),null,1000),'Order 42 saved');
 assert.equal(await statusText(page,'Due tomorrow').count(),1);
 assert.equal(await renderedText(page,'secret',{within}).count(),0);
 await within.evaluate(el=>el.insertAdjacentHTML('beforeend','<p>Order 42 saved</p>'));
 await assert.rejects(waitForFresh(renderedText(page,'Order 42 saved',{within}),null,1000),/strict mode violation/);
});
`;
