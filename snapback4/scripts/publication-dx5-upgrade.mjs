// Real old executables perform acquisition; only candidate package metadata is substituted.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runToolchainCommand } from "./publication-starters.mjs";

export async function proveDX5Upgrades(client, platform) {
  const scratch=mkdtempSync(join(tmpdir(),"sb4-dx5-upgrade-")), artifacts=[], results=[];
  let registry;
  try {
  const sync=(cmd,args,options={})=>{
    const r=spawnSync(cmd,args,{cwd:scratch,encoding:"utf8",timeout:120000,maxBuffer:4<<20,...options});
    assert.equal(r.status,0,(r.stdout??"")+(r.stderr??"")); return r.stdout.trim();
  };
  // The source stays at its commissioned version. An isolated 0.4.36 package
  // alias forces replacement even when the candidate and old CLI are 0.4.35.
  // The native executable bytes are unchanged, and this is never published.
  const candidate="0.4.36";
  for(const [i,path] of [client,platform].entries()) {
    const unpack=join(scratch,"candidate-"+i);mkdirSync(unpack);
    sync("tar",["-xzf",resolve(path),"-C",unpack]);
    const pkg=join(unpack,"package"),manifest=JSON.parse(readFileSync(join(pkg,"package.json")));
    manifest.version=candidate;
    if(manifest.name==="snapback4") for(const name of Object.keys(manifest.optionalDependencies??{})) if(name.startsWith("snapback4-")) manifest.optionalDependencies[name]=candidate;
    writeFileSync(join(pkg,"package.json"),JSON.stringify(manifest));
    const packed=JSON.parse(sync("npm",["pack","--ignore-scripts","--json","--pack-destination",unpack],{cwd:pkg}))[0];
    const bytes=readFileSync(join(unpack,packed.filename));
    artifacts.push({manifest,bytes,integrity:"sha512-"+createHash("sha512").update(bytes).digest("base64")});
  }
  const oldRegistries={};
  // 0.4.35 may still be in its publication gate; keep source provenance explicit.
  for(const version of ["0.4.33","0.4.35"]) {
    let response=await fetch(`https://registry.npmjs.org/snapback4/${version}`,{signal:AbortSignal.timeout(30000)});
    let registry="https://registry.npmjs.org";
    if(response.status===404 && version==="0.4.35") {
      registry="http://127.0.0.1:4873";
      response=await fetch(`${registry}/snapback4/${version}`,{signal:AbortSignal.timeout(10000)});
    }
    assert.equal(response.status,200,`old ${version} must be available from its recorded registry`);
    const metadata=await response.json();oldRegistries[version]={registry,integrity:metadata.dist.integrity};
  }
  let origin;
  registry=createServer(async(req,res)=>{
    try {
      const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
      const item=artifacts.find(a=>path==="/"+a.manifest.name||path==="/"+a.manifest.name+"/"+candidate||path==="/"+a.manifest.name+"/latest");
      if(path.startsWith("/_tar/")){const a=artifacts[Number(path.slice(6))];if(!a){res.writeHead(404).end();return;}res.end(a.bytes);return;}
      if(item){const manifest={...item.manifest,dist:{tarball:origin+"/_tar/"+artifacts.indexOf(item),integrity:item.integrity}};res.setHeader("content-type","application/json");res.end(JSON.stringify(path==="/"+manifest.name?{name:manifest.name,"dist-tags":{latest:candidate},versions:{[candidate]:manifest}}:manifest));return;}
      const upstream=await fetch("https://registry.npmjs.org"+req.url,{signal:AbortSignal.timeout(30000)});
      res.writeHead(upstream.status,{"content-type":upstream.headers.get("content-type")??"application/json"});res.end(Buffer.from(await upstream.arrayBuffer()));
    }catch(error){res.writeHead(502).end(String(error));}
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
    for(const version of ["0.4.33","0.4.35"]) for(const flags of [[],["--quiet"],["--json","--quiet"]]) {
      const cwd=join(scratch,version+"-"+(flags.join("-")||"ordinary"));mkdirSync(join(cwd,"snapback"),{recursive:true});mkdirSync(join(cwd,"scripts"));
      const run=async(cmd,args,extra={})=>{
        const capture=join(cwd,"command-result.json");
        await runToolchainCommand(process.execPath,[recorder,cmd,...args],{cwd,env:{...env,...extra,DX5_CAPTURE_RESULT:capture},timeout:180000});
        return JSON.parse(readFileSync(capture));
      };
      writeFileSync(join(cwd,"package.json"),JSON.stringify({name:"old-cli-proof",private:true,type:"module"}));
      await run("npm",["install","--save-exact",`snapback4@${version}`],{npm_config_registry:oldRegistries[version].registry});
      assert.equal(JSON.parse(readFileSync(join(cwd,"node_modules/snapback4/package.json"))).version,version);
      const oldWrapper=readFileSync(join(cwd,"node_modules/snapback4/bin/snapback4.js"));
      assert.doesNotMatch(oldWrapper.toString(),/firstCheckWarnings/);
      writeFileSync(join(cwd,"snapback/schema.q"),"use identity password\ntable notes:\n  body: text <=80\n  public\nquery list():\n  return notes first 10 by .id\n");
      writeFileSync(join(cwd,"scripts/legacy.mjs"),'startDev(); fetch("/seed"); const rows=JSON.parse(run(["data","notes","--json"])); rows.map(row=>row.id);\n');
      const upgrade=await run("npx",["--no-install","snapback4","upgrade",candidate,...flags]);
      assert.equal(JSON.parse(readFileSync(join(cwd,"node_modules/snapback4/package.json"))).version,candidate);
      assert.match(readFileSync(join(cwd,"node_modules/snapback4/bin/snapback4.js"),"utf8"),/firstCheckWarnings/);
      const transcript=upgrade.stdout+upgrade.stderr;
      if(!flags.includes("--quiet")) for(const phrase of [/doors are CLOSED/,/startDev\(\) persists/,/JSON.parse\(stdout\).rows/,/scripts\/legacy.mjs/]) assert.match(transcript,phrase);
      if(flags.includes("--json")) assert.equal(JSON.parse(upgrade.stdout).ok,true);
      const check=await run("npx",["--no-install","snapback4","check","--json"]);
      assert.equal(JSON.parse(check.stdout).ok,true);
      for(const phrase of [/doors are CLOSED/,/startDev\(\) persists/,/JSON.parse\(stdout\).rows/,/scripts\/legacy.mjs/]) assert.match(check.stderr,phrase,"captured old quiet output must not acknowledge warnings");
      results.push({from:version,flags,candidate,oldPackage:oldRegistries[version],oldWrapperSha256:createHash("sha256").update(oldWrapper).digest("hex"),status:"passed",acquisition:"installed old npx snapback4 upgrade",warnings:flags.includes("--quiet")?"deferred to next check":"during upgrade and next visible check"});
    }
    return results;
  } finally {if(registry?.listening){registry.closeAllConnections();await new Promise(resolve=>registry.close(resolve));}rmSync(scratch,{recursive:true,force:true});}
}
