// The consumer installs ONLY snapback4; a read-only fixture registry serves its
// exact client/native tarballs and proxies unrelated dependency metadata.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const root=resolve(import.meta.dirname,'../..'),base='/tmp/tok1-replay/install-first';mkdirSync(base,{recursive:true});
const packs='/tmp/tok1-replay/consumers-integrated/packs',version='0.4.43';
const artifacts=new Map(['snapback4','snapback4-linux-x64'].map(name=>[name,{manifest:JSON.parse(readFileSync(join(root,'packages',name,'package.json'))),bytes:readFileSync(join(packs,`${name}-${version}.tgz`))}]));
let url;
const server=createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(req.url.split('?')[0]).slice(1),name=path.replace(/\.tgz$/,'');const artifact=artifacts.get(name);
  if(artifact){
   if(path.endsWith('.tgz')){res.end(artifact.bytes);return;}
   const manifest={...artifact.manifest,dist:{tarball:`${url}/${name}.tgz`,integrity:'sha512-'+createHash('sha512').update(artifact.bytes).digest('base64')}};
   res.setHeader('content-type','application/json');res.end(JSON.stringify({name,'dist-tags':{latest:version},versions:{[version]:manifest}}));return;
  }
  const response=await fetch('https://registry.npmjs.org'+req.url);res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json'});res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.statusCode=500;res.end('fixture registry failed');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;
const env={...process.env,npm_config_registry:url,npm_config_cache:join(base,'npm-cache')};delete env.SNAPBACK4_INIT_INSTALL;
async function run(binary,args){const start=Date.now();const child=spawn(binary,args,{cwd:base,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);const code=await new Promise(r=>child.once('exit',r));return{code,seconds:(Date.now()-start)/1000,stdout,stderr};}
const report={qualification:false,sourceCommit:'3fda135dfc',steps:[]};
try{
 const install=await run('npm',['i','snapback4','--no-audit','--no-fund']);report.steps.push({name:'npm i snapback4 only',code:install.code,seconds:install.seconds});if(install.code!==0)throw Error(install.stderr);
 const guide=await run(process.execPath,['node_modules/snapback4/bin/snapback4.js','guide','start']);report.steps.push({name:'guide before frontend installation',code:guide.code,bytes:Buffer.byteLength(guide.stdout),vitePresent:existsSync(join(base,'node_modules/vite')),expoPresent:existsSync(join(base,'node_modules/expo'))});if(guide.code!==0||!guide.stdout.includes('mutation openRequest'))throw Error('start unavailable');
 const init=await run(process.execPath,['node_modules/snapback4/bin/snapback4.js','init','--web','--online','--password']);report.steps.push({name:'init default background install',code:init.code,seconds:init.seconds,announcedBackground:init.stdout.includes('frontend install running in background')});if(init.code!==0)throw Error(init.stderr);
 const status=await run(process.execPath,['scripts/install.mjs','--status']);report.steps.push({name:'status while frontend installs',code:status.code,stdout:status.stdout.trim()});
 const check=await run(process.execPath,['node_modules/snapback4/bin/snapback4.js','check']);report.steps.push({name:'compile schema independently of frontend',code:check.code,seconds:check.seconds});if(check.code!==0)throw Error(check.stderr);
 const wait=await run(process.execPath,['scripts/install.mjs','--wait']);report.steps.push({name:'join actual frontend installer',code:wait.code,seconds:wait.seconds,stdout:wait.stdout.trim()});if(wait.code!==0)throw Error(wait.stderr);
 const types=await run('npm',['run','typecheck']);report.steps.push({name:'installed frontend typecheck',code:types.code,seconds:types.seconds});if(types.code!==0)throw Error(types.stderr);
 report.ok=true;
}catch(error){report.ok=false;report.error=String(error);process.exitCode=1;}
finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));writeFileSync(join(import.meta.dirname,'install-first.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
