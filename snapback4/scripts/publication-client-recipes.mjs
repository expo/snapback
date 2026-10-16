// Packed client contracts: execute the guide's narrowing recipe verbatim and
// typecheck the handler argument shapes against the installed declarations.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runToolchainCommand } from "./publication-starters.mjs";

export async function proveClientRecipes(client, platform, directory) {
  const cwd = join(resolve(directory), "client-recipes");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}');
  const env = { ...process.env, CI: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN;
  const run = (command, args, overrides = {}) => runToolchainCommand(command, args, { cwd, env: { ...env, ...overrides }, timeout: 300_000 });
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(client), resolve(platform),
    "typescript@5.9.3", "react@19.3.0", "react-dom@19.3.0", "@types/react@19.3.0", "@types/react-dom@19.3.0"]);
  const cli = join(cwd, "node_modules/snapback4/bin/snapback4.js");
  const guide = spawnSync(process.execPath, [cli, "guide", "client", "--full"], { cwd, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(guide.status, 0, guide.stdout + guide.stderr);
  const recipe = [...guide.stdout.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(match => match[1]).find(text => text.includes("function listLabel"));
  assert.ok(recipe, "packed guide has the data-narrowing recipe");
  writeFileSync(join(cwd, "recipe.ts"), recipe);
  writeFileSync(join(cwd, "handlers.ts"), handlers);
  const workspace = [...guide.stdout.matchAll(/```tsx\n([\s\S]*?)\n```/g)].map(match => match[1]).find(text => text.includes("function StaffWorkspace"));
  assert.ok(workspace, "packed guide has the role/release screen");
  mkdirSync(join(cwd, "src"), { recursive: true });
  mkdirSync(join(cwd, "snapback"), { recursive: true });
  writeFileSync(join(cwd, "src/workspace.tsx"), workspace);
  writeFileSync(join(cwd, "snapback/schema.q"), schema);
  await run(process.execPath, [cli, "check"]);
  await run(process.execPath, [join(cwd, "node_modules/typescript/bin/tsc"), "--strict", "--skipLibCheck", "--target", "ES2022",
    "--module", "NodeNext", "--moduleResolution", "NodeNext", "--outDir", "compiled", "recipe.ts", "handlers.ts"]);
  // Bundler resolution preserves the extensionless generated-api import exactly
  // as the guide writes it; this same form is used by both starter toolchains.
  await run(process.execPath, [join(cwd, "node_modules/typescript/bin/tsc"), "--strict", "--skipLibCheck", "--target", "ES2022",
    "--module", "ESNext", "--moduleResolution", "Bundler", "--jsx", "react-jsx", "--noEmit", "src/workspace.tsx"]);
  writeFileSync(join(cwd, "verify.mjs"), verify);
  await run(process.execPath, ["verify.mjs"]);
  writeFileSync(join(cwd, "guide-client.md"), guide.stdout);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await run(process.execPath, ["--test", join(root, "packages/snapback4/test/kit2-client-react.test.mjs")], {
    SNAPBACK4_CLIENT_GUIDE: join(cwd, "guide-client.md"), SNAPBACK4_CLIENT_DIST: join(cwd, "node_modules/snapback4/dist"),
  });
  return { status: "passed", recipes: ["guide client listLabel", "guide client StaffWorkspace"], contracts: ["matchRead", "matchReadList", "otherwiseAll", "usePage", "useAuth configuration refusal"] };
}

const schema = `use identity
table roles:
  team: text <=80
  principal: principal
  role: enum('staff', 'member')
  unique team, principal
  read <- .principal = viewer
  online only
table notes:
  team: text <=80
  title: text <=200
  category: text <=80
  priority: text <=20 ?
  read <- allow
  insert <- allow
  online only
query myRole(team: text <=80):
  return roles[team = team, principal = viewer] {role}
query staffNotes(team: text <=80):
  return notes first 20 by .id
mutation addStaffNote(team: text <=80, title: text <=200, category: text <=80):
  return insert notes {team, title, category, priority: null}
`;

const handlers = String.raw`
import {createElement} from "react";
import {matchRead, matchReadList, otherwiseAll, usePage} from "snapback4/react";
import type {Read, Query, Cursor, Refusal} from "snapback4/contract";
type Row = {id:string; title:string};
export function point(read:Read<Row|null>) {
  return matchRead(read, {
    loading: current => current.loading ? "loading" : "invalid",
    denied: (why, current) => {const refusal:Refusal = why; return current.denied === refusal ? "not available" : "invalid";},
    absent: current => current.data === null ? "absent" : "invalid",
    partial: (data, current) => data === current.data ? "partial" : "invalid",
    present: (data, current) => data.title === current.data.title ? "present" : "invalid",
  });
}
export function list(read:Read<Row[]>) {
  return matchReadList(read, {denied:why => why.message, absent:current => String(current.data.length),
    present:(rows,current) => String(rows.length + current.data.length), otherwise:current => "data" in current ? "partial" : "loading"});
}
export function all(read:Read<Row|null>) {
  return matchRead(read, {...otherwiseAll(current => "denied" in current ? current.denied.message : "fallback"), present:data => data.title});
}
const pageOp:Query<{team:string;c?:Cursor|null},Row[]> = {kind:"query",name:"list"};
export function Page() {
  const page=usePage(pageOp,{team:"one"},{skip:true});
  const rows:Row[]=page.items;
  const more:boolean=page.hasMore;
  const next:()=>void=page.loadMore;
  next();
  return createElement("p",null,matchReadList(page,{denied:why=>why.message,otherwise:()=>rows.length + ":" + more}));
}
`;

const verify = String.raw`
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToString} from "react-dom/server";
import {AppProvider,SnapbackProvider,useAuth} from "snapback4/react";
import {createApp} from "snapback4/app";
import {listLabel} from "./compiled/recipe.js";
import {point,list,all,Page} from "./compiled/handlers.js";
const why={code:"NO",family:"rule",message:"not available"};
const ready=(data,existence="present",complete=true)=>({data,existence,complete,fresh:true,cut:complete?null:"meter"});
assert.equal(listLabel({loading:true}),"Loading…");
assert.equal(listLabel({denied:why}),"not available");
assert.equal(listLabel(ready([],"absent")),"No rows");
assert.equal(listLabel(ready([{id:"one"}])),"1 rows");
for(const [read,expected] of [[{loading:true},"loading"],[{denied:why},"not available"],
  [ready(null,"absent"),"absent"],[ready(null,"partial",false),"partial"],[ready({id:"one",title:"title"}),"present"]])
  assert.equal(point(read),expected);
assert.equal(list(ready([],"absent")),"0");
assert.equal(list(ready([],"partial",false)),"partial");
assert.equal(list({denied:why}),"not available");
assert.equal(all({denied:why}),"not available");
assert.equal(all(ready(null,"partial",false)),"fallback");
assert.equal(all(ready({id:"one",title:"title"})),"title");
assert.equal(renderToString(createElement(SnapbackProvider,{client:{}},createElement(Page))),"<p>0:false</p>");
let calls=0;
const app=createApp({url:"http://127.0.0.1:1",writes:"online",device:async()=>{calls++;throw Error("device opened")},
  fetch:async()=>{calls++;throw Error("network opened")}});
const result=await app.ready;
assert.equal(result.ok,false);assert.equal(result.why.code,"E_CLIENT");
function Refusal(){const auth=useAuth();return createElement("p",null,auth.why?.site);}
assert.equal(renderToString(createElement(AppProvider,{app},createElement(Refusal))),"<p>createApp.writes</p>");
assert.equal((await app.auth.guest()).ok,false);assert.equal(calls,0);await app.close();
console.log("packed client recipes passed: data narrowing, handler signatures/states, page envelope, useAuth configuration refusal");
`;

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [client, platform, out] = process.argv.slice(2);
  if (!client || !platform || !out) throw Error("usage: publication-client-recipes.mjs client.tgz platform.tgz output-directory");
  console.log(JSON.stringify(await proveClientRecipes(client, platform, out)));
}
