import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {runToolchainCommand} from '../../scripts/publication-starters.mjs';
const root=import.meta.dirname,sb=resolve(root,'../..'),cwd=join(root,'app-final');mkdirSync(cwd,{recursive:true});
const names=['snapback4','snapback4-linux-x64','snapback4-expo'];
const paths=[join(sb,'target/integ15-pack3/snapback4-0.4.31.tgz'),join(root,'snapback4-linux-x64-0.4.31.tgz'),join(sb,'target/integ15-pack3/snapback4-expo-0.4.31.tgz')];
const items=paths.map((p,i)=>{const bytes=readFileSync(p);return {manifest:JSON.parse(spawnSync('tar',['-xzOf',p,'package/package.json'],{encoding:'utf8',timeout:10000}).stdout),bytes,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};});
const registry=createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://local').pathname);if(path.startsWith('/_tar/')){res.end(items[Number(path.slice(6))].bytes);return;}const item=items.find(x=>path==='/'+x.manifest.name||path==='/'+x.manifest.name+'/0.4.31'||path==='/'+x.manifest.name+'/latest');if(item){const m={...item.manifest,dist:{tarball:origin+'/_tar/'+items.indexOf(item),integrity:item.integrity}};res.setHeader('content-type','application/json');res.end(JSON.stringify(path==='/'+m.name?{name:m.name,'dist-tags':{latest:'0.4.31'},versions:{'0.4.31':m}}:m));return;}const upstream=await fetch('http://127.0.0.1:4873'+req.url,{signal:AbortSignal.timeout(60000)});res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});res.end(Buffer.from(await upstream.arrayBuffer()));}catch(e){res.writeHead(502).end(String(e));}});
await new Promise(ok=>registry.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+registry.address().port;
const env={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1',npm_config_audit:'false',npm_config_fund:'false'};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
const commands=[];async function run(cmd,args,extra={}){commands.push({cmd,args,cwd,registry:extra.npm_config_registry??env.npm_config_registry});writeFileSync(join(root,'commands-final.json'),JSON.stringify(commands,null,2));await runToolchainCommand(cmd,args,{cwd,env:{...env,...extra},timeout:300000});}
let server;let url;const rows=[];
async function stop(){if(server&&server.exitCode===null){const ended=new Promise(ok=>server.once('exit',ok));server.kill('SIGTERM');await Promise.race([ended,new Promise((_,bad)=>setTimeout(()=>bad(Error('server stop deadline')),10000))]);}server=undefined;}
async function start(binary){server=spawn(binary,['dev','--port','0','--no-watch','--hold-schedules'],{cwd,env,stdio:['ignore','pipe','pipe']});let text='';server.stdout.on('data',b=>text+=b);server.stderr.on('data',b=>text+=b);const until=Date.now()+30000;while(!(url=/SNAPBACK4_READY[^\n]*url=(http:\/\/127[.]0[.]0[.]1:\d+)/.exec(text)?.[1])){assert.equal(server.exitCode,null,text);assert.ok(Date.now()<until,text);await new Promise(r=>setTimeout(r,25));}}
async function post(path,body){return fetch(url+path,{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'alice'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}).then(r=>r.json());}
try{
 writeFileSync(join(cwd,'package.json'),JSON.stringify({private:true,dependencies:{expo:'57.0.30',react:'19.2.3','react-dom':'19.2.3','react-native':'0.86.3','expo-modules-core':'57.0.23'}}));
 await run('npm',['install','--save-exact','snapback4@0.4.30','snapback4-expo@0.4.30','--registry','http://127.0.0.1:4873/']);
 const cli=join(cwd,'node_modules/.bin/snapback4');await run(cli,['init','--expo']);await run('npm',['install','--registry','http://127.0.0.1:4873/']);await run(cli,['check']);
 await start(cli);const sent=await post('/m/add',{args:{title:'preserved from 0.4.30'}});assert.equal(sent.state,'sent',JSON.stringify(sent));const before=await post('/q/list',{args:{c:null}});assert.ok(JSON.stringify(before).includes('preserved from 0.4.30'));rows.push({phase:'0.4.30',result:before});await stop();
 const hashes=Object.fromEntries(['App.tsx','src/client.ts','snapback/schema.q'].map(p=>[p,createHash('sha256').update(readFileSync(join(cwd,p))).digest('hex')]));
 env.npm_config_registry=origin;
 await run('npx',['--yes','snapback4@0.4.31','upgrade','--to','0.4.31']);
 assert.equal(JSON.parse(readFileSync(join(cwd,'package.json'))).dependencies.expo,'57.0.30');
 await start(cli);const after=await post('/q/list',{args:{c:null}});assert.ok(JSON.stringify(after).includes('preserved from 0.4.30'));assert.deepEqual(after.data,before.data);assert.equal(after.store_id,before.store_id);rows.push({phase:'0.4.31',result:after});await stop();
 assert.deepEqual(Object.fromEntries(Object.keys(hashes).map(p=>[p,createHash('sha256').update(readFileSync(join(cwd,p))).digest('hex')])),hashes);
 // Exercise a user lowering the Expo manifest below the target floor. The old
 // installed app/store above was valid; upgrade must repair the declared pin.
 const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));pkg.dependencies.expo='57.0.20';writeFileSync(join(cwd,'package.json'),JSON.stringify(pkg,null,2));
 await run('npx',['snapback4','upgrade','--to','0.4.31']);
 const repaired=JSON.parse(readFileSync(join(cwd,'package.json')));assert.equal(repaired.dependencies.expo,'57.0.22');assert.equal(repaired.dependencies['expo-modules-core'],'57.0.23');
 await run(cli,['check']);await run('npm',['run','typecheck']);await run(join(cwd,'node_modules/.bin/expo'),['export','-p','web','--max-workers','2']);
 await start(cli);const final=await post('/q/list',{args:{c:null}});assert.ok(JSON.stringify(final).includes('preserved from 0.4.30'));assert.deepEqual(final.data,before.data);assert.equal(final.store_id,before.store_id);rows.push({phase:'floor-repaired',result:final});await stop();
 writeFileSync(join(root,'result-final.json'),JSON.stringify({status:'passed',from:'0.4.30',to:'0.4.31',preservedRows:rows,frontendUnchanged:true,preservedData:true,preservedStoreId:true,expoPreserved:'57.0.30',loweredManifest:'57.0.20',expoRepaired:'57.0.22',core:'57.0.23',typecheck:'passed',webExport:'passed',commands},null,2));
 console.log('0.4.30 store/app adoption, upgrade and Expo floor repair passed');
}finally{await stop();registry.closeAllConnections();await new Promise(ok=>registry.close(ok));}
