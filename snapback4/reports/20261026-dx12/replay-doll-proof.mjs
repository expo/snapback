// Reuse the actual copied lane 009 frontend journey, replacing its body.innerText
// workaround with the proof-kit observation; same binary and bundled UI in both arms.
import {readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';
import {command} from '../../packages/snapback4/dist/proof.js';import {chromiumExecutable} from '../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../..'),cwd='/tmp/dx12-replay/text/009-snapback-antique-doll-restorations';
const source=readFileSync('/home/ccheever/sb4-loop/wave29/apps/009-snapback-antique-doll-restorations/scripts/frontend-proof.mjs','utf8');
const noBuild=source.replace(/const build = await command\([\s\S]*?assert.equal\(build.code,[\s\S]*?\n/,'');
const journey=noBuild.replace(/    await waitForServer\(\n      \(\) => page.evaluate\(\(\) => document.body.innerText.includes\("Fee band: below 500"\)\),[\s\S]*?\n    \);/,`    await page.evaluate(()=>{window.scrollTo(0,0);for(const e of document.querySelectorAll('*')){e.scrollTop=0;e.scrollLeft=0;}});
    await waitForFresh(renderedText(page, "Fee band: below 500"), null, 2000);`);
const rows=[];
try{
 for(const [label,module] of [['before','/tmp/dx12-replay/control-client/package/dist/proof.js'],['after','snapback4/proof']]){
  writeFileSync(join(cwd,'scripts/dx12-rendered-proof.mjs'),journey.replace('from "snapback4/proof"',`from ${JSON.stringify(module)}`));
  const begin=performance.now();let result;try{const run=await command(process.execPath,['scripts/dx12-rendered-proof.mjs'],{cwd,secret:true,timeoutMs:90000,env:{SNAPBACK4_BIN:join(root,'target/debug/snapback4'),CHROME:chromiumExecutable()}});result={code:run.code};}catch{result={timeoutOrFailure:true};}
  rows.push({label,...result,ms:Math.round(performance.now()-begin)});console.log(JSON.stringify(rows.at(-1)));
 }
 writeFileSync(join(import.meta.dirname,'doll-text-measurements.json'),JSON.stringify({method:'actual lane009 frontend journey; reuse existing bundled dist instead of rebuild; replace body.innerText workaround with renderedText, reset scroll before assertion; no payload output retained',rows},null,2)+'\n');
}finally{rmSync('/tmp/dx12-replay/text',{recursive:true,force:true});}
