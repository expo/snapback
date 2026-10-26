// Reuse the actual copied lane 009 frontend journey, replacing its body.innerText
// workaround with the proof-kit observation; same binary and bundled UI in both arms.
import {readFileSync,writeFileSync,readdirSync,rmSync,mkdirSync,cpSync,symlinkSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {command} from '../../packages/snapback4/dist/proof.js';import {chromiumExecutable} from '../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../..'),cwd='/tmp/dx12-replay/text/009-snapback-antique-doll-restorations';
const evidence='/home/ccheever/sb4-loop/wave29/apps/009-snapback-antique-doll-restorations';
const control='/tmp/dx12-replay/control-client', createdControl=!existsSync(join(control,'package/dist/proof.js'));
if(createdControl){mkdirSync(control,{recursive:true,mode:0o700});execFileSync('tar',['-xzf','/home/ccheever/sb4-loop/dist/0.4.42/snapback4-0.4.42.tgz','-C',control]);symlinkSync(join(root,'node_modules'),join(control,'package/node_modules'));}
mkdirSync(cwd,{recursive:true,mode:0o700});
for(const name of ['snapback','scripts','versions','dist','src','app','lib','package.json','tsconfig.json'])if(existsSync(join(evidence,name)))cpSync(join(evidence,name),join(cwd,name),{recursive:true});
mkdirSync(join(cwd,'node_modules'),{recursive:true});
for(const name of readdirSync(join(root,'node_modules')))if(!['snapback4','.bin'].includes(name))try{symlinkSync(join(root,'node_modules',name),join(cwd,'node_modules',name));}catch{}
try{symlinkSync(join(root,'packages/snapback4'),join(cwd,'node_modules/snapback4'));}catch{}
const source=readFileSync(join(evidence,'scripts/frontend-proof.mjs'),'utf8');
const noBuild=source.replace(/const build = await command\([\s\S]*?assert.equal\(build.code,[\s\S]*?\n/,'');
const journey=noBuild.replace(/    await waitForServer\(\n      \(\) => page.evaluate\(\(\) => document.body.innerText.includes\("Fee band: below 500"\)\),[\s\S]*?\n    \);/,`    await page.evaluate(()=>{window.scrollTo(0,0);for(const e of document.querySelectorAll('*')){e.scrollTop=0;e.scrollLeft=0;}});
    await waitForFresh(renderedText(page, "Fee band: below 500"), null, 2000);`);
const rows=[];
try{
 for(const [label,module] of [['before','/tmp/dx12-replay/control-client/package/dist/proof.js'],['after','snapback4/proof']]){
  writeFileSync(join(cwd,'scripts/dx12-rendered-proof.mjs'),journey.replace('from "snapback4/proof"',`from ${JSON.stringify(module)}`));
  const begin=performance.now();let result;try{const run=await command(process.execPath,['scripts/dx12-rendered-proof.mjs'],{cwd,secret:true,timeoutMs:90000,env:{SNAPBACK4_BIN:join(root,'target/debug/snapback4'),CHROME:chromiumExecutable()}});result={code:run.code,...(run.code===0?{}:{failureKind:/no fresh signal/.test(run.stderr)?'renderedText missing fresh text':(run.stderr.match(/\b(?:ERR|E)_[A-Z0-9_]+\b/)?.[0]??'other'),errorName:run.stderr.match(/\b(?:TypeError|ReferenceError|SyntaxError)\b/)?.[0]})};}catch{result={timeoutOrFailure:true};}
  rows.push({label,...result,ms:Math.round(performance.now()-begin)});console.log(JSON.stringify(rows.at(-1)));
 }
 writeFileSync(join(import.meta.dirname,'doll-text-measurements.json'),JSON.stringify({method:'actual lane009 frontend journey; reuse existing bundled dist instead of rebuild; replace body.innerText workaround with renderedText, reset scroll before assertion; no payload output retained',rows},null,2)+'\n');
}finally{rmSync('/tmp/dx12-replay/text',{recursive:true,force:true});if(createdControl)rmSync(control,{recursive:true,force:true});}
