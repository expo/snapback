// Runs unchanged with a packed client/platform installation in the cwd.
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {cli,startServe,withBrowser,renderedText} from "snapback4/proof";

const guide=await cli(["guide","rule-recipes","--section","Private immutable payloads and audience helpers"]);
assert.equal(guide.code,0,guide.stderr);
const schema=guide.stdout.match(/```quarry\n([\s\S]*?)```/)?.[1];
assert.ok(schema,"installed guide supplies its runnable Quarry");
mkdirSync("snapback",{recursive:true});writeFileSync("snapback/schema.q",schema+`
table dxTicks:
  n: int
  public 'clock regression counter'
  insert <- allow
  online only
job dxTick():
  for row in dxTicks:
    update dxTicks[row.id] { n: row.n + 1 }
schedule dxHourly every 1h: dxTick
mutation dxMakeTick():
  return insert dxTicks {n:0}
query dxTickCount():
  return dxTicks first 10 by .id
mutation dxGuess(id: dxOrders, price: int):
  return update dxOrders[id] {price}
mutation dxPut(id: dxOrders, price: int):
  return upsert dxOrders[id] {owner:viewer,title:'same',price}
`);
const checked=await cli(["check","--json"]);assert.equal(checked.code,0,checked.stderr+checked.stdout);
const facts=JSON.parse(checked.stdout);
assert.ok(facts.notes.some(n=>n.code==="N_UNREADABLE_PROBE"&&n.message.includes("dxRoles")&&n.message.includes(".principal")),"positive require names its hiding rule");
assert.ok(facts.notes.some(n=>n.code==="N_IMMUTABLE_PATCH"&&n.message.includes("ignored")));
assert.equal((await cli(["deploy","staging","--staging"])).code,0);
let host=await startServe("staging");let token,peer,id,firstNow;
const call=async(kind,name,args={},bearer=token)=>{
 const response=await fetch(host.url+`/${kind}/${name}`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${bearer}`},body:JSON.stringify({args})});
 assert.equal(response.status,200);return response.json();
};
try{
 token=await host.operatorToken("operator");peer=await host.operatorToken("peer");
 const opened=await call("m","dxOpen",{title:"intake",price:100});assert.equal(opened.state,"sent");id=opened.result.id;
 assert.equal((await call("q","dxOrder",{id})).data.price,100);
 assert.equal(Object.hasOwn((await call("q","dxOrder",{id},peer)).data,"price"),false);
 for(const name of ["dxGuess","dxPut"]){for(const price of [100,999]){
  const result=await call("m",name,{id,price});assert.equal(result.state,"sent");
  assert.equal((await call("q","dxOrder",{id})).data.price,100,"private immutable payload retained");
 }}
 assert.equal((await call("m","dxRole",{principal:"service:peer",role:"customer"})).state,"sent");
 assert.equal((await call("q","dxIsCustomer",{principal:"service:peer"})).data,false);
 assert.equal((await call("q","dxPublicCustomer",{principal:"service:peer"})).data,true,"minimal public projection answers the intended cross-reader check");
 assert.equal((await call("q","dxIsCustomer",{principal:"service:missing"})).data,false);
 assert.equal((await call("q","dxIsCustomer",{principal:"service:peer"},peer)).data,true);
 assert.equal((await call("m","dxCustomerGuard",{principal:"service:peer"})).why.code,"NOT_CUSTOMER");
 assert.equal((await call("m","dxCustomerGuard",{principal:"service:missing"})).why.code,"NOT_CUSTOMER","hidden-present and absent have the same authored refusal");
 await call("m","dxMakeTick");
 const advanced=await host.advance("8d",{drain:false});assert.equal(advanced.maintenancePaused,true);firstNow=advanced.now;
 assert.equal((await call("q","dxTickCount")).data[0].n,0);
}finally{await host.stop();}
host=await startServe("staging");
try{
 assert.ok(await host.now()>=firstNow,"restart resumes clock, including paused advance");
 assert.equal((await call("q","dxTickCount")).data[0].n,0,"restart preserves maintenance pause");
 const drained=await host.drain();assert.equal(drained.fired[0].name,"dxHourly");
 assert.equal((await call("q","dxTickCount")).data[0].n,1);
 assert.equal((await host.drain()).held[0].holdCode,"not-due");
 assert.equal((await host.advance("2h")).fired[0].name,"dxHourly");
 assert.equal((await call("q","dxTickCount")).data[0].n,2);firstNow=await host.now();
}finally{await host.stop();}
host=await startServe("staging",{clockOffset:"+1h"});
try{
 assert.ok(await host.now()>=firstNow,"explicit smaller offset never rewinds reused store");
 assert.equal((await host.advance("2h")).fired[0].name,"dxHourly");
 assert.equal((await call("q","dxTickCount")).data[0].n,3);
}finally{await host.stop();}
const production=await cli(["deploy","production"]);assert.equal(production.code,0,production.stderr);
host=await startServe("production");try{await assert.rejects(host.advance("1h"),/E_CLOCK_DEV_ONLY/);}finally{await host.stop();}

await withBrowser({logsDir:"browser-logs",executablePath:process.env.CHROME},async context=>{
 const page=await context.newPage();await page.setViewportSize({width:700,height:400});
 await page.setContent(`<style>.scroll{height:80px;width:400px;overflow:auto}.spacer{height:600px}.clip{height:80px;overflow:hidden}.label{display:block}</style>
 <div class="scroll" id="rn"><div class="spacer"></div><div class="label"><span>Order </span><span>ready</span></div></div>
 <div class="clip"><div class="scroll" id="nested"><div class="spacer"></div><div>Nested reachable</div></div></div>
 <div class="scroll" style="position:relative"><div style="position:absolute;top:-100px">Negative unreachable</div><div class="spacer"></div></div>
 <div class="clip"><div class="spacer"></div><div>Clipped secret</div></div>
 <div style="opacity:0">Transparent secret</div><div style="display:none">Display secret</div>
 <div style="visibility:hidden">Hidden secret<span style="visibility:visible">Override visible</span></div>
 <div style="height:0;overflow:auto">Zero scroll secret</div><div style="position:fixed;top:-100px">Fixed unreachable</div><div style="position:fixed;top:10px;right:10px">Fixed visible</div>`);
 for(const text of ["Order ready","Nested reachable","Override visible","Fixed visible"]) assert.equal(await renderedText(page,text).count(),1,text);
 for(const text of ["Negative unreachable","Clipped secret","Transparent secret","Display secret","Hidden secret","Zero scroll secret","Fixed unreachable"]) assert.equal(await renderedText(page,text).count(),0,text);
 assert.ok(await page.locator("#rn").evaluate(e=>e.scrollTop)>0,"a unique reachable match scrolls into view");
 assert.ok(await page.locator("#nested").evaluate(e=>e.scrollTop)>0,"nested reachable text scrolls its own container");
});
console.log("DX7 consumer passed: guide rules, protected immutable patches, hidden positive probes, repeated staging time/pause/drain and scrollable text");
