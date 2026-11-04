
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { deploy, rollback, startServe, testSource, cleanup } from "snapback4/proof";
const one = "use identity guests\ntable notes:\n  title: text <=80\n  public 'shared'\n  insert <- allow\n  update <- allow\nquery list():\n  return notes first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { title }\n";
const two = one.replace("  title: text <=80", "  title: text <=80\n  color: text <=20 default 'blue'") + "mutation paint(id: notes, color: text <=20):\n  update notes[id] { color }\n";
for (const [version, source] of [["v1", one], ["v2", two]]) {
  mkdirSync("versions/" + version + "/fixtures", {recursive:true});
  writeFileSync("versions/" + version + "/schema.q", source);
  writeFileSync("versions/" + version + "/fixtures/test.cases.jsonl", JSON.stringify({op:"list",count:1,match:[{title:"fixture"}]})+"\n");
  writeFileSync("versions/" + version + "/fixtures/notes.jsonl", '{"id":"fixture-note","title":"fixture"}\n');
}
mkdirSync("snapback", {recursive:true});
writeFileSync("snapback/schema.q", two);
writeFileSync("snapback/client-compatibility.json", JSON.stringify({baseline:"versions/v1",since_release:2}));
let serve;
try {
  await testSource("versions/v1/schema.q");
  await testSource("versions/v2/schema.q");
  await deploy("deployment", "versions/v1/schema.q");
  serve = await startServe("deployment");
  const guest = await (await fetch(serve.url + "/auth/guest", {method:"POST",headers:{"content-type":"application/json"},body:"{}"})).json();
  assert.ok(guest.session?.token, JSON.stringify(guest));
  const request = async (path, body) => {
    const response = await fetch(serve.url + path, {method:"POST",headers:{"content-type":"application/json",authorization:"Bearer " + guest.session.token},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const created = await request("/m/add", {id:"proof-add-1",args:{title:"persisted across releases"}});
  assert.equal(created.state,"sent",JSON.stringify(created));
  const rows = async () => { const answer = await request("/q/list",{args:{}}); assert.equal(answer.data?.length,1,JSON.stringify(answer)); assert.equal(answer.data[0].title,"persisted across releases"); return answer.data; };
  assert.equal((await rows())[0].color,undefined);
  await deploy("deployment", "versions/v2/schema.q");
  assert.equal((await rows())[0].color,"blue","v2 backfills persisted rows");
  const painted = await request("/m/paint",{id:"proof-paint-1",args:{id:(await rows())[0].id,color:"red"}});
  assert.equal(painted.state,"sent",JSON.stringify(painted));
  await rollback("deployment",1);
  assert.equal((await rows())[0].color,undefined,"v1 hides retained v2 fields");
  await rollback("deployment","latest");
  assert.equal((await rows())[0].color,"red","forward restores retained v2 value");
  assert.equal(readFileSync("snapback/schema.q","utf8"),two);
  assert.equal(readFileSync("versions/v1/schema.q","utf8"),one);
  console.log("packed day-two passed: compatibility baseline, relative saved sources, contemporary fixtures, live backfill, rollback, retained forward");
} finally { await cleanup(() => serve?.stop()); }
