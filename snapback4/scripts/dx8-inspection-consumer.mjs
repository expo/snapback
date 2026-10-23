// Runs unchanged with a packed client/platform installation in the cwd.
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {cli,startServe} from "snapback4/proof";

const v1=`use personas alice
table photos:
  photo: image <=10000
  public
  insert <- allow
  online only
table legacy:
  label: text <=40
  public
  insert <- allow
  online only
table commissions:
  label: text <=40
  public
  online only
mutation addPhoto(photo: image <=10000):
  return insert photos {photo}
mutation addLegacy(label: text <=40):
  return insert legacy {label}
query allPhotos():
  return photos first 10 by .id
query oneOrder(id: commissions):
  return commissions[id]
`;
mkdirSync("snapback",{recursive:true});writeFileSync("snapback/schema.q",v1);
let result=await cli(["deploy","deployment","--save-version","versions/v1"]);assert.equal(result.code,0,result.stderr);
for(const path of ["versions/v1/generated/api.ts","versions/v1/generated/package.json","versions/v1/release.json"])assert.ok(readFileSync(path).length,path);
let generated=await import(pathToFileURL(resolve("versions/v1/generated/api.ts")).href+"?first");assert.ok(generated.api.addPhoto&&generated.api.oneOrder,"saved-source client has exact v1 operations");
rmSync("versions/v1/generated",{recursive:true});rmSync("versions/v1/release.json");
result=await cli(["deploy","deployment","--save-version","versions/v1"]);assert.equal(result.code,0,result.stderr);assert.match(result.stderr,/refreshed release 1/);
generated=await import(pathToFileURL(resolve("versions/v1/generated/api.ts")).href+"?refresh");assert.ok(generated.api.addLegacy);
writeFileSync("snapback/client-compatibility.json",JSON.stringify({baseline:"versions/v1",since_release:2}));

let host=await startServe("deployment");
try{
 const token=await host.operatorToken("alice");
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
 const call=async(name,args)=>fetch(host.url+`/m/${name}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({args})}).then(r=>r.json());
 for(let n=0;n<2;n++){
  const upload=await fetch(host.url+"/assets",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"image/png"},body:png}).then(r=>r.json());assert.ok(upload.asset,JSON.stringify(upload));
  assert.equal((await call("addPhoto",{photo:{id:upload.asset.id}})).state,"sent");
 }
 assert.equal((await call("addLegacy",{label:"retained"})).state,"sent");
}finally{await host.stop();}

const v2=v1.replace("  photo: image <=10000\n  public","  photo: image <=10000\n  caption: text <=80 ?\n  public")
 .replace(/table legacy:[\s\S]*?  online only\n/,"")
 .replace(/mutation addLegacy\(label: text <=40\):\n  return insert legacy \{label\}\n/,"")
 .replace("table commissions:","table sculptureOrders renamed from commissions:")
 .replaceAll("commissions[id]","sculptureOrders[id]").replace("id: commissions","id: sculptureOrders");
writeFileSync("snapback/schema.q",v2);
const preview=await cli(["deploy","deployment","--check","--json"]);assert.equal(preview.code,0,preview.stderr);
const compatibility=JSON.parse(preview.stdout).clientCompatibility;
assert.ok(compatibility.some(line=>/operation allPhotos: RESULT NOTE: result shape added fields/.test(line)),JSON.stringify(compatibility));
assert.ok(compatibility.every(line=>!/operation oneOrder: INPUT BREAK/.test(line)),JSON.stringify(compatibility));
result=await cli(["deploy","deployment"]);assert.equal(result.code,0,result.stderr);

const objects=await cli(["sql","SELECT id, photo FROM photos ORDER BY id","--release","deployment","--json-objects","--limit","1"]);assert.equal(objects.code,0,objects.stderr);
const inspected=JSON.parse(objects.stdout);assert.equal(typeof inspected.rows[0].photo,"object");assert.equal(typeof inspected.rows[0].photo.id,"string");assert.equal(inspected.more,true);
assert.match(objects.stderr,/result truncated at 1 rows/);assert.match(objects.stderr,/1 dormant row retained/);
const positional=await cli(["sql","SELECT photo FROM photos ORDER BY id","--release","deployment","--json","--limit","1"]);assert.equal(positional.code,0,positional.stderr);assert.match(JSON.parse(positional.stdout).rows[0][0],/Map/);
const missing=await cli(["sql","SELECT * FROM legacy","--release","deployment","--json"]);assert.equal(missing.code,1);assert.match(JSON.parse(missing.stdout).denied.message,/1 retained dormant row.*legacy/);
const data=await cli(["data","legacy","--release","deployment"]);assert.equal(data.code,1);assert.match(data.stderr,/no active table legacy; 1 retained dormant row/);
const releases=await cli(["releases","deployment"]);assert.equal(releases.code,0,releases.stderr);assert.match(releases.stderr,/1 dormant row retained/);
console.log("DX8 inspection consumer passed: saved-source client refresh, media objects, truncation, dormant discovery and old-client diagnostics");
