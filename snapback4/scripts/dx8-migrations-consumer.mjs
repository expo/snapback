// Runs with the installed tarball's CLI and SDK; the wrapper owns/removes scratch.
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {cli,deploy,rollback,startServe} from "snapback4/proof";
const checked=async(args,options={})=>{const r=await cli(args,options);assert.equal(r.code,0,r.stderr+r.stdout);return r;};
const save=(path,text)=>{mkdirSync(path.slice(0,path.lastIndexOf("/")),{recursive:true});writeFileSync(path,text);};
const evolution=await checked(["guide","evolution","--section","One record per photo in a list"]);
const each=evolution.stdout.match(/```quarry\n([\s\S]*?)```/)?.[1];assert.ok(each,"installed complete each recipe");
const before=`use identity password
table albums:
  owner: principal
  photos: [image <=10000] <=8
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation add(photos: [image <=10000] <=8):
  return insert albums {owner:viewer,photos}
`;
save("versions/v1/schema.q",before);save("versions/v2/schema.q",each);save("snapback/schema.q",before);
await deploy("deployment","versions/v1/schema.q");
let host=await startServe("deployment");let assets,parent;
try{
 const token=await host.operatorToken();assets=[];
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
 for(let n=0;n<2;n++){
  const r=await fetch(host.url+"/assets",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"image/png"},body:png,signal:AbortSignal.timeout(10000)});
  const u=await r.json();assert.ok(u.asset?.id,"real upload");assets.push(u.asset);
 }
 const r=await fetch(host.url+"/m/add",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({args:{photos:assets.map(a=>({id:a.id}))}}),signal:AbortSignal.timeout(10000)});
 const inserted=await r.json();assert.equal(inserted.state,"sent");parent=inserted.result.id;
}finally{await host.stop();}
await deploy("deployment","versions/v2/schema.q");
let expected;
for(let cycle=0;cycle<3;cycle++){
 const rows=JSON.parse((await checked(["sql","SELECT id, album, photo FROM albumPhotos ORDER BY id","--release","deployment","--json-objects"])).stdout).rows;
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.album===parent));
 assert.deepEqual(rows.map(row=>row.photo.id).sort(),assets.map(a=>a.id).sort());
 if(expected)assert.deepEqual(rows,expected,"element children retain stable identities");else expected=rows;
 await rollback("deployment",1,{args:["--exact"]});
 const old=JSON.parse((await checked(["sql","SELECT photos FROM albums","--release","deployment","--json-objects"])).stdout).rows;
 assert.deepEqual(old[0].photos.map(a=>a.id),assets.map(a=>a.id),"exact old list keeps every original element and order");
 await rollback("deployment","latest");
}
// Run the corrected language snippet unchanged against real pre-patch input names.
const language=await checked(["guide","language","--full"]);
const example=[...language.stdout.matchAll(/```quarry\n([\s\S]*?)```/g)].map(m=>m[1]).find(s=>s.includes("backfill parcels quantities"));
assert.ok(example?.includes("quantities(legacyManifest:"));
const oldLanguage=`use identity password
table shipments:
  legacyManifest: file <=100000 ?
  weight: int
  read <- deny
  insert <- allow
  online only
mutation add():
  return insert shipments {legacyManifest:null,weight:4000}
`;
save("language/versions/v1/schema.q",oldLanguage);save("language/versions/v2/schema.q",example);save("language/snapback/schema.q",oldLanguage);
const cwd=resolve("language"),directory=resolve("language/deployment");
await deploy(directory,"versions/v1/schema.q",{cwd});host=await startServe(directory,{cwd});
try{
 const token=await host.operatorToken();const r=await fetch(host.url+"/m/add",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:'{"args":{}}',signal:AbortSignal.timeout(10000)});
 assert.equal((await r.json()).state,"sent");
}finally{await host.stop();}
await deploy(directory,"versions/v2/schema.q",{cwd});
const actual=JSON.parse((await checked(["sql","SELECT quantity, sizeClass, manifest FROM parcels","--release",directory,"--json-objects"],{cwd})).stdout).rows;
assert.deepEqual(actual,[{quantity:0,sizeClass:"large",manifest:null}],"backfill consumes historical legacyManifest before simultaneous rename");
console.log("DX8 migration consumer passed: exact shipped fan-out and historical-input language snippets over real stores and bytes");
