// Read-only wave-20 originals; all edits and generated APIs live in a cleaned copy.
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const { _codeFiles, bucketOf }=await import(pathToFileURL(join(homedir(),"sb4-loop/wave20-repro/front/lib-copy.mjs")).href);
const lanes=join(homedir(),"sb4-loop/wave20/apps"),scratch=mkdtempSync(join(tmpdir(),"sb4-dx5-front-"));
const hash=text=>createHash("sha256").update(text).digest("hex");
function census(dir) {
  return [..._codeFiles(dir)].filter(file=>bucketOf(file)==="frontend").sort().map(file=>{
    const source=readFileSync(join(dir,file),"utf8");return {file,characters:source.replace(/\s/g,"").length,sha256:hash(source)};
  });
}
const sum=files=>files.reduce((n,f)=>n+f.characters,0),results=[];
try {
  for(const number of ["006","032","033"]) {
    const name=readdirSync(lanes).find(name=>name.startsWith(number+"-snapback-")),source=join(lanes,name),cwd=join(scratch,name);
    const before=census(source);
    const rootFiles=new Set([...before.map(f=>f.file.split("/")[0]),"package.json","tsconfig.json","app.json","expo-env.d.ts","snapback"]);
    cpSync(source,cwd,{recursive:true,filter:path=>{
      const parts=relative(source,path).split(/[\\/]/);
      return (!parts[0] || rootFiles.has(parts[0])) && !parts.some(part=>["node_modules","generated","dist","deploy","logs","artifacts","ios","android","probe"].includes(part)||part.startsWith("."));
    }});
    writeFileSync(join(cwd,"metro.config.js"),readFileSync(join(root,"crates/snapback4/src/verbs/init/metro.config.js")));
    rmSync(join(cwd,"metro-wasm-transformer.cjs"));
    const smokePath=join(cwd,"src/native-smoke.ts"),password=readFileSync(smokePath,"utf8").includes("auth.signup");
    rmSync(smokePath);
    const appPath=join(cwd,"App.tsx");let app=readFileSync(appPath,"utf8").replace('import { useNativeSmokeGuest } from "./src/native-smoke";', 'import { useNativeSmoke } from "snapback4-expo/native-smoke";')
      .replaceAll("useNativeSmokeGuest();",password?"useNativeSmoke(true);":"useNativeSmoke();");
    let listComponents=0;
    if(number==="032") {
      app=app.replace('AppProvider,', 'AppProvider, ReadState,');
      for(const [variable,loading,empty] of [["animals","Loading animals…","No animals yet."],["route","Loading your route…","No animals on your route yet."]]) {
        const start=`    {"denied" in ${variable}.read && <Text>Not available: {${variable}.read.denied.message}</Text>}\n    {"loading" in ${variable}.read && <Text>${loading}</Text>}\n`;
        const end=`    {${variable}.items.length === 0 && !("loading" in ${variable}.read) && <Text>${empty}</Text>}`;
        const at=app.indexOf(start),tail=app.indexOf(end,at);if(at<0||tail<0)throw Error("source drift in "+variable);
        const view=app.slice(at+start.length,tail).trim().replace(`${variable}.items.map`,"rows.map");
        app=app.slice(0,at)+`    <ReadState read={${variable}} loading={<Text>${loading}</Text>} empty={<Text>${empty}</Text>} denied={why => <Text>Not available: {why.message}</Text>}>{rows => ${view}}</ReadState>\n`+app.slice(tail+end.length);
        listComponents++;
      }
    }
    writeFileSync(appPath,app);
    const after=census(cwd);
    // The same frozen harness file classification, with authored long lines kept.
    symlinkSync(join(root,"node_modules"),join(cwd,"node_modules"));
    const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd,env:{...process.env,SNAPBACK4_BIN:join(root,"target/debug/snapback4")},encoding:"utf8",timeout:120000,maxBuffer:4<<20});if(r.status!==0)throw Error(name+": "+r.stdout+r.stderr);};
    run(join(root,"target/debug/snapback4"),["check"]);
    const require=createRequire(join(root,"packages/snapback4/package.json"));
    run(process.execPath,[require.resolve("typescript/bin/tsc"),"-p","tsconfig.json","--noEmit"]);
    for(const file of before) if(hash(readFileSync(join(source,file.file),"utf8"))!==file.sha256)throw Error("original changed");
    results.push({lane:name,before:sum(before),after:sum(after),saved:sum(before)-sum(after),listComponents,typecheck:"passed",originalHashesUnchanged:true,filesBefore:before,filesAfter:after});
  }
  const report={date:new Date().toISOString(),metric:"non-whitespace frontend characters; frozen wave-20 bucketOf; no looksBuilt filter",changes:"packaged Metro/native smoke; two ReadState lists in 032",results};
  writeFileSync(join(root,"reports/dx5/frontend.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(results.map(({lane,before,after,saved,listComponents,typecheck})=>({lane,before,after,saved,listComponents,typecheck}))));
} finally {rmSync(scratch,{recursive:true,force:true});}
