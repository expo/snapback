// Other executable section extractors opt into full selected content explicitly.
import {proveDX4} from '../../scripts/publication-dx4.mjs';
import {proveDay5} from '../../scripts/publication-day5.mjs';
import {mkdirSync,symlinkSync,writeFileSync,readFileSync,globSync} from 'node:fs';
import {join} from 'node:path';
process.env.SNAPBACK4_INIT_INSTALL='0';
process.env.CHROME??=globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`).sort().reverse()[0];
const onlyDX4=process.argv.includes('--dx4-only');
const result={qualification:false,installedFrom:'/tmp/tok1-replay/consumers-integrated/packs',steps:onlyDX4?JSON.parse(readFileSync(join(import.meta.dirname,'packed-additional-consumers.json'))).steps.filter(s=>s.name==='Day5'&&s.ok):[]};
for(const [name,prove] of [['DX4',proveDX4],['Day5',proveDay5]].filter(([name])=>!onlyDX4||name==='DX4')){
 const cwd=`/tmp/tok1-replay/additional-${name}${onlyDX4?'-retry':''}`;mkdirSync(cwd,{recursive:true});symlinkSync('/tmp/tok1-replay/install-first/node_modules',join(cwd,'node_modules'),'dir');
 writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',private:true}));const started=Date.now();
 try{const value=await prove(cwd);result.steps.push({name,ok:true,seconds:(Date.now()-started)/1000,value});}
 catch(error){result.steps.push({name,ok:false,seconds:(Date.now()-started)/1000,error:String(error)});}
 writeFileSync(join(import.meta.dirname,onlyDX4?'packed-additional-consumers-final.json':'packed-additional-consumers.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.steps.at(-1)));
}
if(result.steps.some(s=>!s.ok))process.exitCode=1;
