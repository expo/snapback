// Actual old executables acquire the exact candidate packs through a private proxy.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runToolchainCommand } from "/home/ccheever/projects/snapback-sb4loop/snapback4/scripts/publication-starters.mjs";

export async function proveDX5Upgrades(client, platform, expo) {
  const scratch=mkdtempSync(join(tmpdir(),"sb4-dx5-upgrade-")), artifacts=[], results=[];
  let registry, completed=false;
  try {
  const sync=(cmd,args,options={})=>{
    const r=spawnSync(cmd,args,{cwd:scratch,encoding:"utf8",timeout:120000,maxBuffer:4<<20,...options});
    assert.equal(r.status,0,(r.stdout??"")+(r.stderr??"")); return r.stdout.trim();
  };
  const candidate="0.4.38";
  for(const path of [client,platform,expo]) {
    const unpack=join(scratch,"candidate-"+artifacts.length);mkdirSync(unpack);
    sync("tar",["-xzf",resolve(path),"-C",unpack]);
    const manifest=JSON.parse(readFileSync(join(unpack,"package/package.json")));
    assert.equal(manifest.version,candidate);
    const bytes=readFileSync(resolve(path));
    artifacts.push({manifest,bytes,integrity:"sha512-"+createHash("sha512").update(bytes).digest("base64")});
  }
  const oldRegistries={};
  let origin;
  registry=createServer(async(req,res)=>{
    try {
      const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
      if(path.startsWith("/_tar/")){const a=artifacts[Number(path.slice(6))];if(!a){res.writeHead(404).end();return;}res.end(a.bytes);return;}
      const owned=artifacts.filter(a=>path==="/"+a.manifest.name||path==="/"+a.manifest.name+"/"+a.manifest.version||path==="/"+a.manifest.name+"/latest");
      const metadata=a=>({...a.manifest,dist:{tarball:origin+"/_tar/"+artifacts.indexOf(a),integrity:a.integrity}});
      if(owned.length){
        const name=owned[0].manifest.name;
        const body=path==="/"+name?{name,"dist-tags":{latest:candidate},versions:Object.fromEntries(owned.map(a=>[a.manifest.version,metadata(a)]))}:metadata(owned.find(a=>!path.endsWith("/latest")||a.manifest.version===candidate));
        res.setHeader("content-type","application/json");res.end(JSON.stringify(body));return;
      }
      const upstream=await fetch("https://registry.npmjs.org"+req.url,{signal:AbortSignal.timeout(30000)});
      const bytes=Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status,{"content-type":upstream.headers.get("content-type")??"application/json"});res.end(bytes);
    }catch(error){if(res.headersSent)res.destroy(error);else res.writeHead(502).end(String(error));}
  });
  await new Promise(resolve=>registry.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+registry.address().port;
  const env={...process.env,CI:"1",npm_config_registry:origin,npm_config_audit:"false",npm_config_fund:"false",npm_config_update_notifier:"false"};
  delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const recorder=join(scratch,"capture.cjs");
  writeFileSync(recorder,`const {spawnSync}=require('node:child_process'); const {writeFileSync}=require('node:fs');
const [command,...args]=process.argv.slice(2); const result=spawnSync(command,args,{encoding:'utf8',timeout:170000,maxBuffer:8<<20});
writeFileSync(process.env.DX5_CAPTURE_RESULT,JSON.stringify({stdout:result.stdout??'',stderr:result.stderr??'',status:result.status}));
if(result.status!==0) {process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');} process.exit(result.status??1);
`);
    for (const version of ["0.4.35","0.4.37"]) {
      const response=await fetch(`https://registry.npmjs.org/snapback4/${version}`,{signal:AbortSignal.timeout(30000)});
      assert.equal(response.status,200);
      oldRegistries[version]={registry:"https://registry.npmjs.org",integrity:(await response.json()).dist.integrity};
    }
    for(const version of ["0.4.35","0.4.37"]) for(const flags of [[]]) {
      const cwd=join(scratch,version+"-"+(flags.join("-")||"ordinary"));mkdirSync(join(cwd,"snapback"),{recursive:true});mkdirSync(join(cwd,"scripts"));
      const run=async(cmd,args,extra={})=>{
        const capture=join(cwd,"command-result.json");
        await runToolchainCommand(process.execPath,[recorder,cmd,...args],{cwd,env:{...env,...extra,DX5_CAPTURE_RESULT:capture},timeout:180000});
        return JSON.parse(readFileSync(capture));
      };
      writeFileSync(join(cwd,"package.json"),JSON.stringify({name:"old-cli-proof",private:true,type:"module"}));
      await run("npm",["install","--save-exact",`snapback4@${version}`,`snapback4-expo@${version}`],{npm_config_registry:oldRegistries[version].registry});
      assert.equal(JSON.parse(readFileSync(join(cwd,"node_modules/snapback4/package.json"))).version,version);
      const oldNativeVersion=(await run("npx",["--no-install","snapback4","--version"])).stdout.trim();
      assert.ok(oldNativeVersion.includes(version),`installed old native CLI must be ${version}: ${oldNativeVersion}`);
      await run("npx",["--no-install","snapback4","init","--expo"]);
      const initialized=JSON.parse(readFileSync(join(cwd,"package.json")));initialized.dependencies.snapback4=version;initialized.dependencies["snapback4-expo"]=version;writeFileSync(join(cwd,"package.json"),JSON.stringify(initialized,null,2)+"\n");
      await run("npm",["install","--no-audit","--no-fund"],{npm_config_registry:oldRegistries[version].registry});
      assert.equal(JSON.parse(readFileSync(join(cwd,"node_modules/snapback4/package.json"))).version,version,"old Expo application builds against its actual old client");
      writeFileSync(join(cwd,"App.tsx"),readFileSync("/home/ccheever/sb4-loop/integration21/upgrade-App.tsx","utf8"));
      const oldWrapper=readFileSync(join(cwd,"node_modules/snapback4/bin/snapback4.js"));
      if(version==="0.4.35")assert.doesNotMatch(oldWrapper.toString(),/firstCheckWarnings/);
      else assert.match(oldWrapper.toString(),/firstCheckWarnings/);
      writeFileSync(join(cwd,"snapback/schema.q"),"use identity password\ntable notes:\n  body: text <=80\n  public\n  insert <- allow\nquery list():\n  return notes first 10 by .id\nmutation add(body: text <=80):\n  return insert notes {body}\n");
      writeFileSync(join(cwd,"scripts/legacy.mjs"),'startDev(); fetch("/seed"); const rows=JSON.parse(run(["data","notes","--json"])); rows.map(row=>row.id);\n');
      writeFileSync(join(cwd,"production-proof.mjs"),readFileSync("/home/ccheever/sb4-loop/integration21/upgrade-production-proof.mjs","utf8"));
      await run("npx",["--no-install","snapback4","check"]);
      await run("npm",["run","typecheck"]);
      await run("npx",["--no-install","expo","export","--platform","web","--max-workers","2"]);
      await run("node",["production-proof.mjs","before",version]);
      const oldWrite=await run("npx",["--no-install","snapback4","run","add",JSON.stringify({body:"kept from "+version}),"--as","user:alice","--json"]);
      assert.equal(JSON.parse(oldWrite.stdout).state,"sent");
      const oldRead=JSON.parse((await run("npx",["--no-install","snapback4","data","notes","--json"])).stdout);
      const beforeRows=Array.isArray(oldRead)?oldRead:oldRead.rows;assert.equal(beforeRows.length,1);
      const upgrade=await run("npx",["--no-install","snapback4","upgrade",candidate,...flags]);
      assert.equal(JSON.parse(readFileSync(join(cwd,"node_modules/snapback4/package.json"))).version,candidate);
      assert.match(readFileSync(join(cwd,"node_modules/snapback4/bin/snapback4.js"),"utf8"),/firstCheckWarnings/);
      const transcript=upgrade.stdout+upgrade.stderr;
      if(!flags.includes("--quiet")) for (const phrase of [/doors are CLOSED/,/startDev\(\) persists/]) assert.match(transcript,phrase,"published old helpers retain their own legacy scan; the new helper cannot rewrite those bytes");
      if(flags.includes("--json")) assert.equal(JSON.parse(upgrade.stdout).ok,true);
      const check=await run("npx",["--no-install","snapback4","check","--json"]);
      assert.equal(JSON.parse(check.stdout).ok,true);
      assert.doesNotMatch(check.stderr,/upgrade warning:/,"delivered advice is acknowledged and unrelated transitions are quiet");
      const currentRead=JSON.parse((await run("npx",["--no-install","snapback4","data","notes","--json"])).stdout);
      assert.deepEqual(currentRead.rows,beforeRows,"persisted rows and ids survive old-CLI upgrade");
      assert.equal(typeof currentRead.more,"boolean");assert.equal(typeof currentRead.limit,"number");
      await run("npm",["run","typecheck"]);
      await run("npx",["--no-install","expo","export","--platform","web","--max-workers","2"]);
      await run("node",["production-proof.mjs","after",version]);
      results.push({productionRowsPreserved:1,retainedServiceToken:"passed",oldCompleteSessionSuppliedToUpgradedClient:"passed",productionNewWrite:"passed",productionDevDoorsClosed:true,storeRowsPreserved:beforeRows.length,expoTypecheck:"passed before and after",expoWebExport:"passed before and after",expoBrowserBeforeAndAfter:"passed with persisted origin/session and real SDK reads",from:version,oldNativeVersion,flags,candidate,oldPackage:oldRegistries[version],oldWrapperSha256:createHash("sha256").update(oldWrapper).digest("hex"),status:"passed",acquisition:"installed old npx snapback4 upgrade",warnings:"historical advice from published old helper during upgrade; modern next check quiet and no new refusal"});
    }
    completed=true;return results;
  } finally {if(registry?.listening){registry.closeAllConnections();await new Promise(resolve=>registry.close(resolve));}if(completed)rmSync(scratch,{recursive:true,force:true});else writeFileSync("/tmp/integ22/upgrade-failed-scratch.json",JSON.stringify({directory:scratch,reason:"owned synthetic fixture retained for diagnosis; contains private test credentials, never copy to repo"})+"\n");}
}

const result=await proveDX5Upgrades(process.argv[2],process.argv[3],process.argv[4]);writeFileSync(process.argv[5],JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
