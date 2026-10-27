// Published old CLIs acquire a candidate alias; executable bytes stay unchanged.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {runToolchainCommand} from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-starters.mjs";
const schema=`table docs:
  photo: image <=10000 ?
  read <- allow
  insert <- deny
  online only
invariant docs always .photo != null
mutation add(photo: image <=10000 ?):
  return insert docs {photo}
`;
export async function proveDX7Upgrades(client,platform){
 const scratch=mkdtempSync(join(tmpdir(),"sb4-dx7-upgrade-")),candidate="0.4.40",artifacts=[],results=[];
 let registry;
 try{
  const sync=(cmd,args,cwd=scratch)=>{const r=spawnSync(cmd,args,{cwd,encoding:"utf8",timeout:120000,maxBuffer:8<<20});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  for(const [i,path] of [client,platform].entries()){
   const unpack=join(scratch,"candidate-"+i);mkdirSync(unpack);sync("tar",["-xzf",resolve(path),"-C",unpack]);
   const pkg=join(unpack,"package"),manifest=JSON.parse(readFileSync(join(pkg,"package.json")));manifest.version=candidate;
   if(manifest.name==="snapback4")for(const name of Object.keys(manifest.optionalDependencies??{}))if(name.startsWith("snapback4-"))manifest.optionalDependencies[name]=candidate;
   writeFileSync(join(pkg,"package.json"),JSON.stringify(manifest));
   const packed=JSON.parse(sync("npm",["pack","--ignore-scripts","--json","--pack-destination",unpack],pkg))[0];
   const bytes=readFileSync(join(unpack,packed.filename));artifacts.push({manifest,bytes,integrity:"sha512-"+createHash("sha512").update(bytes).digest("base64")});
  }
  let origin;
  registry=createServer(async(req,res)=>{try{
   const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
   if(path.startsWith("/_tar/")){const item=artifacts[Number(path.slice(6))];if(!item){res.writeHead(404).end();return;}res.end(item.bytes);return;}
   const item=artifacts.find(a=>["/"+a.manifest.name,"/"+a.manifest.name+"/"+candidate,"/"+a.manifest.name+"/latest"].includes(path));
   if(item){const manifest={...item.manifest,dist:{tarball:origin+"/_tar/"+artifacts.indexOf(item),integrity:item.integrity}};res.setHeader("content-type","application/json");res.end(JSON.stringify(path==="/"+manifest.name?{name:manifest.name,"dist-tags":{latest:candidate},versions:{[candidate]:manifest}}:manifest));return;}
   const upstream=await fetch("https://registry.npmjs.org"+req.url,{signal:AbortSignal.timeout(30000)});res.writeHead(upstream.status,{"content-type":upstream.headers.get("content-type")??"application/json"});res.end(Buffer.from(await upstream.arrayBuffer()));
  }catch{res.writeHead(502).end("registry proxy failed");}});
  await new Promise(resolve=>registry.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+registry.address().port;
  writeFileSync(join(scratch,"empty-global.npmrc"),"");
  const env={...process.env,NPM_CONFIG_USERCONFIG:"/dev/null",NPM_CONFIG_GLOBALCONFIG:join(scratch,"empty-global.npmrc"),CI:"1",npm_config_registry:origin,npm_config_audit:"false",npm_config_fund:"false",npm_config_update_notifier:"false"};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  for(const version of ["0.4.35","0.4.37"]){
   const metadata=await fetch(`https://registry.npmjs.org/snapback4/${version}`,{signal:AbortSignal.timeout(30000)});assert.equal(metadata.status,200,`published ${version} required`);const published=await metadata.json();
   const cwd=join(scratch,version);mkdirSync(join(cwd,"snapback"),{recursive:true});writeFileSync(join(cwd,"package.json"),JSON.stringify({name:"dx7-old-cli-proof",private:true,type:"module"}));
   const recorder=join(cwd,"record.cjs");writeFileSync(recorder,`const {spawnSync}=require('node:child_process');const {writeFileSync}=require('node:fs');const [command,...args]=process.argv.slice(2);const result=spawnSync(command,args,{encoding:'utf8',timeout:240000,maxBuffer:8<<20});writeFileSync('result.json',JSON.stringify({status:result.status,stdout:result.stdout??'',stderr:result.stderr??''}));`);
   const run=async(cmd,args,extra={})=>{await runToolchainCommand(process.execPath,[recorder,cmd,...args],{cwd,env:{...env,...extra},timeout:270000});return JSON.parse(readFileSync(join(cwd,"result.json")));};
   let r=await run("npm",["install","--save-exact",`snapback4@${version}`],{npm_config_registry:"https://registry.npmjs.org"});assert.equal(r.status,0,"published old CLI install failed: "+(r.stderr.match(/npm (?:error|ERR!) code ([A-Z0-9_]+)/)?.[1]??"see private npm log"));
   const cli=join(cwd,"node_modules/snapback4/bin/snapback4.js"),oldWrapperSha256=createHash("sha256").update(readFileSync(cli)).digest("hex");
   writeFileSync(join(cwd,"snapback/schema.q"),schema);
   r=await run(process.execPath,[cli,"check","--json"]);assert.equal(r.status,0,`old ${version} accepts the gate fixture`);
   r=await run(process.execPath,[cli,"upgrade",candidate]);console.log("DX7-DIAG upgrade from "+version+" status="+r.status+"\n--- stdout ---\n"+r.stdout+"\n--- stderr ---\n"+r.stderr);assert.equal(r.status,1,"new check must refuse the security gate during old-CLI upgrade");
   assert.equal(JSON.parse(readFileSync(join(cwd,"node_modules/snapback4/package.json"))).version,candidate);
   const transcript=r.stdout+r.stderr;assert.match(transcript,/pending security review gates: N_OPTIONAL_UPLOAD_CREATE/);assert.match(transcript,/check --ack-security [a-f0-9]{64} --reason/);assert.doesNotMatch(transcript,/new refusals: none/);
   r=await run(process.execPath,[cli,"check","--json"]);assert.equal(r.status,1);let facts=JSON.parse(r.stdout);const id=facts.securityReviews.find(d=>d.gated).id;
   r=await run(process.execPath,[cli,"check","--ack-security",id,"--reason","draft creator is unreachable under deny insert"]);assert.equal(r.status,0,r.stderr);
   const review=readFileSync(join(cwd,"snapback/security-reviews.json"));
   writeFileSync(join(cwd,"snapback/schema.q"),schema+"table exposed:\n  owner: principal\n  read <- allow\n  online only\ninvariant exposed.read only .owner = viewer\n");
   mkdirSync(join(cwd,"fixtures"));writeFileSync(join(cwd,"fixtures/exposed.jsonl"),JSON.stringify({id:"one",owner:"dev:other"})+"\n");
   r=await run(process.execPath,[cli,"test","--fixture-only"]);assert.equal(r.status,1,"fixture gives a reachable refutation");
   r=await run(process.execPath,[cli,"check","--json","--ack-security",id,"--reason","cannot override a counterexample"]);assert.equal(r.status,1);facts=JSON.parse(r.stdout);assert.match(facts.acknowledgmentNotApplied,/cannot override a concrete counterexample/);assert.deepEqual(readFileSync(join(cwd,"snapback/security-reviews.json")),review);
   results.push({from:version,publishedIntegrity:published.dist.integrity,oldWrapperSha256,candidateAlias:candidate,status:"passed",gate:"new installed check refuses; explicit individual review clears gate",refutation:"acknowledgment suppressed, persisted review unchanged"});
  }
  return results;
 }finally{if(registry?.listening){registry.closeAllConnections();await new Promise(resolve=>registry.close(resolve));}rmSync(scratch,{recursive:true,force:true});}
}
