import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, "../../..");
const dist = process.env.SNAPBACK4_CLIENT_DIST ?? join(root,"packages/snapback4/dist");
const { ReadState, QueryRefusal } = await import(pathToFileURL(join(dist,"react.js")).href);
const ready = (data, extra = {}) => ({data,existence:data.length?"present":"absent",complete:true,fresh:true,cut:null,...extra});

test("DX5 ReadState presents each list state without losing refusal or partial/stale evidence", () => {
  let received;
  const props = { loading:h("p",null,"Loading"), empty:h("p",null,"Empty"), denied:why=>h("p",null,why.message),
    children:(rows, read)=>{received={rows,read};return h("p",null,rows.map(r=>r.title).join(","));} };
  const render = read=>renderToStaticMarkup(h(ReadState,{...props,read}));
  assert.equal(render({loading:true}),"<p>Loading</p>");
  assert.equal(render(ready([])),"<p>Empty</p>");
  const why={code:"PRIVATE",family:"auth",message:"No access"};
  assert.equal(render({denied:why}),"<p>No access</p>");
  const rows=[{id:"1",title:"Saved"}],read=ready(rows,{existence:"partial",complete:false,fresh:false});
  assert.equal(render({read,items:rows,hasMore:true,loadMore(){}}),"<p>Saved</p>");
  assert.equal(received.rows,rows);assert.equal(received.read,read);
  assert.equal(render(ready([],{existence:"partial",complete:false})),"<p>Empty</p>");
  assert.throws(()=>ReadState({read:{denied:why},children:()=>null}),error=>error instanceof QueryRefusal && error.why===why);
  assert.equal(ReadState({read:{loading:true},children:()=>null}),null);
});

test("DX5 exact published ListScreen snippet renders loading, denied, empty and partial data", async () => {
  const guide=readFileSync(join(dist,"../reference/CLIENT-AND-OPERATIONS.md"),"utf8");
  const snippet=[...guide.matchAll(/```tsx\n([\s\S]*?)\n```/g)].map(m=>m[1]).find(s=>s.includes("function ListScreen"));
  assert.ok(snippet);
  // Transpile the snippet unchanged, then resolve its import to the candidate.
  const compiled=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const source=compiled.replaceAll('"snapback4/react"',JSON.stringify(pathToFileURL(join(dist,"react.js")).href))
    .replaceAll('"react/jsx-runtime"',JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve("react/jsx-runtime")).href));
  const module=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
  const render=read=>renderToStaticMarkup(h(module.ListScreen,{read}));
  assert.match(render({loading:true}),/Loading/); assert.match(render(ready([])),/No results/);
  assert.match(render({denied:{message:"No access"}}),/role="alert".*No access/);
  assert.match(render(ready([{id:"one",title:"Partial"}],{existence:"partial",complete:false,fresh:false})),/data-complete="false".*Partial/);
});

test("DX5 list types infer items and retain precise ready metadata", () => {
  const cwd=mkdtempSync(join(tmpdir(),"sb4-dx5-types-"));
  try {
    const file=join(cwd,"types.ts");
    writeFileSync(file,`import {ReadState,type Read} from ${JSON.stringify(join(dist,"react.js"))};
declare const read:Read<readonly {id:string; title:string}[]>;
ReadState({read,children:(rows,answer)=>{const title:string=rows[0]!.title; const complete:boolean=answer.complete;return title+complete;}});
ReadState({read:{read},children:rows=>rows[0]?.id});
// @ts-expect-error result fields are inferred, not widened
ReadState({read,children:rows=>rows[0]!.missing});
// @ts-expect-error only list reads fit
ReadState({read:{data:42,existence:'present',complete:true,fresh:true,cut:null},children:()=>null});
`);
    const require=createRequire(join(root,"packages/snapback4/package.json"));
    const result=spawnSync(process.execPath,[require.resolve("typescript/bin/tsc"),"--strict","--skipLibCheck","--noEmit","--target","ES2022","--module","ESNext","--moduleResolution","Bundler",file],{encoding:"utf8",timeout:60000});
    assert.equal(result.status,0,result.stdout+result.stderr);
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

test("DX5 packaged native smoke signs in only on an owned prime with the explicit identity mode", async () => {
  try {
    const entry=join(root,"packages/snapback4-expo/src/native-smoke.ts");
    const stub=code=>JSON.stringify("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
    const source=ts.transpileModule(readFileSync(entry,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
      .replace('"react"',stub('export const useRef=()=>globalThis.smokeTest.ref;export const useEffect=fn=>fn();'))
      .replace('"snapback4/react"',stub('export const useAuth=()=>globalThis.smokeTest.auth;'))
      .replace('"./witness"',stub('export const smokeSegment=()=>globalThis.smokeTest.segment;export const smokeAccount=()=>globalThis.smokeTest.account;'));
    const {useNativeSmoke}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
    const calls=[];globalThis.smokeTest={ref:{current:false},auth:{state:"signed-out",guest:()=>calls.push("guest"),signup:(email,password)=>calls.push([email,password])},segment:null,account:{email:"smoke@example.test",password:"disposable"}};
    for(const segment of [null,"offline","restart"]) {smokeTest.segment=segment;useNativeSmoke();useNativeSmoke(true);}
    assert.deepEqual(calls,[]);
    smokeTest.segment="prime";useNativeSmoke();useNativeSmoke();assert.deepEqual(calls,["guest"]);
    smokeTest.ref={current:false};useNativeSmoke(true);useNativeSmoke(true);assert.deepEqual(calls,["guest",["smoke@example.test","disposable"]]);
    smokeTest.ref={current:false};smokeTest.account=null;useNativeSmoke(true);assert.equal(calls.length,2);
    smokeTest.auth.state="signed-in";useNativeSmoke();assert.equal(calls.length,2);
  } finally {delete globalThis.smokeTest;}
});
