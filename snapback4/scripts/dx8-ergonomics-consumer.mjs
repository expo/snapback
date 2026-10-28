import {guideReference} from "./publication-guide.mjs";
import {resolveBinary} from "snapback4/bin-path";
// Runs unchanged with a packed client/platform installation in the cwd.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanup, cli, deploy, exhaustPages, renderedText, startDev, startServe, waitForFresh, withBrowser } from "snapback4/proof";

const guide = async name => guideReference(resolveBinary(),name,{packageRoot:dirname(dirname(fileURLToPath(import.meta.resolve("snapback4/proof"))))});

const [clientGuide, wireGuide, rulesGuide, recipesGuide, testingGuide, cheatsheetGuide, productionGuide] = await Promise.all([
  guide("client"), guide("wire"), guide("rules"), guide("rule-recipes"),
  guide("testing"), guide("cheatsheet"), guide("production"),
]);
assert.match(clientGuide, /exhaustPages/); assert.match(clientGuide, /treat the cursor as opaque/i);
assert.match(wireGuide, /opaque continuation/); assert.match(wireGuide, /projected `id`/);
assert.match(rulesGuide, /`require` decides intent; it never grants table authority/);
assert.match(rulesGuide, /`read through live \.parent`/); assert.match(recipesGuide, /audience and lifetime captured/);
assert.match(testingGuide, /compareById/); assert.match(testingGuide, /v1ClientWrites/); assert.match(testingGuide, /v2Native/);
assert.match(cheatsheetGuide, /return items .* last 50 by \.id after c/);
assert.match(productionGuide, /return profiles last 20 by \.id after c \{ principal, displayName \}/);

const quarryBlocks = markdown => [...markdown.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(match => match[1]);
async function checkGuideBlock(name, source) {
  assert.ok(source, `${name} Quarry block is shipped`);
  const cwd = join(process.cwd(), `guide-${name}`); mkdirSync(join(cwd, "snapback"), { recursive: true });
  writeFileSync(join(cwd, "snapback/schema.q"), source);
  const checked = await cli(["check", "--json"], { cwd });
  assert.equal(checked.code, 0, checked.stderr + checked.stdout);
}
const cheatsheetBlocks = quarryBlocks(cheatsheetGuide);
await checkGuideBlock("cheatsheet-board", cheatsheetBlocks.find(block => block.includes("query itemsOf")));
await checkGuideBlock("cheatsheet-division", cheatsheetBlocks.find(block => block.includes("query divisionTeams")));
await checkGuideBlock("production-lists", quarryBlocks(productionGuide).find(block => block.includes("query directory(c: cursor ?)")));

const cursors = [];
const rows = await exhaustPages(async cursor => {
  cursors.push(cursor);
  return cursor === null
    ? { data: [{ id: "newest" }], next: "opaque:not-a-row-id", complete: true, cut: null }
    : { data: [{ id: "older" }], next: null, complete: true, cut: null };
}, { label: "packed board" });
assert.deepEqual(cursors, [null, "opaque:not-a-row-id"]);
assert.deepEqual(rows.map(row => row.id), ["newest", "older"]);
await assert.rejects(exhaustPages(async () => ({ data: [], next: null, cut: null })), /E_PROOF_PAGE.*complete must be true/);
await assert.rejects(exhaustPages(async () => ({ data: [], next: "would-continue", complete: false, cut: "meter" })), /E_PROOF_PAGE.*incomplete/);
await assert.rejects(exhaustPages(async () => ({ data: [], next: null, complete: true, cut: null, existence: "partial" })), /E_PROOF_PAGE.*partial existence/);

await withBrowser({ logsDir: "browser-logs", executablePath: process.env.CHROME }, async context => {
  const page = await context.newPage(); await page.setViewportSize({ width: 700, height: 400 });
  await page.setContent('<main style="height:90px;overflow-y:auto"><div style="height:600px"></div><div><span>Pump </span><span>logged.</span></div></main>');
  const root = page.locator("main");
  assert.equal(await renderedText(page, "Pump logged.", null).count(), 1, "null uses default options");
  assert.equal(await waitForFresh(renderedText(page, "Pump logged.", { within: root, exact: false }), null), "Pump logged.");
  assert.ok(await root.evaluate(element => element.scrollTop) > 0, "text proof scrolls the match into view");
  assert.equal(await root.evaluate(element => {
    const match = element.lastElementChild.getBoundingClientRect(), viewport = element.getBoundingClientRect();
    return match.top >= viewport.top && match.bottom <= viewport.bottom;
  }), true, "the composed status line is inside the scrollport");
});

async function initialized(name, args) {
  const cwd = join(process.cwd(), name); mkdirSync(cwd);
  const result = await cli(["init", "--no-install", ...args], { cwd }); assert.equal(result.code, 0, result.stderr);
  const schema = readFileSync(join(cwd, "snapback/schema.q"), "utf8");
  const checked = await cli(["check", "--json"], { cwd }); assert.equal(checked.code, 0, checked.stderr + checked.stdout);
  return schema;
}
for (const [name, args] of [["local", []], ["online", ["--online"]], ["web", ["--web"]], ["web-online", ["--web", "--online"]]]) {
  assert.match(await initialized(name, args), /return todos .* last 100 by \.id/, `${name} lists newest first`);
}
const social = await initialized("social", ["--template", "social"]);
assert.match(social, /return members .* last 50 by \.conversation after c/, "social inbox lists newest first");

const localCwd = join(process.cwd(), "local");
let dev;
try {
  dev = await startDev({ cwd: localCwd, args: ["--memory"] });
  const seeded = Array.from({ length: 101 }, (_, index) => ({ table: "todos", row: {
    id: `todo-${String(index).padStart(3, "0")}`, title: `Todo ${index}`, done: false, ownerId: "dev:alice",
  } }));
  const seedResponse = await fetch(`${dev.url}/seed`, { method: "POST", headers: { "content-type": "application/json", "x-snapback-persona": "alice" }, body: JSON.stringify(seeded) });
  assert.equal(seedResponse.status, 200); assert.equal((await seedResponse.json()).seeded, 101);
  const readPage = async c => {
    const response = await fetch(`${dev.url}/q/list`, { method: "POST", headers: { "content-type": "application/json", "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { c } }) });
    assert.equal(response.status, 200); return response.json();
  };
  const first = await readPage(null);
  assert.equal(first.data.length, 100); assert.ok(first.next, "101 rows cross the starter's page boundary");
  assert.deepEqual(first.data.map(row => row.id), seeded.slice(1).map(item => item.row.id).reverse(), "page one is newest first");
  const all = await exhaustPages(readPage, { label: "packed starter list" });
  assert.deepEqual(all.map(row => row.id), seeded.map(item => item.row.id).reverse(), "opaque continuation exhausts all rows in newest-first order");
} finally { await cleanup(() => dev?.stop()); }

const proofModule = fileURLToPath(import.meta.resolve("snapback4/proof"));
const packageRoot = dirname(dirname(proofModule));
const clientOperations = readFileSync(join(packageRoot, "CLIENT-AND-OPERATIONS.md"), "utf8");
const typescriptBlocks = [...clientOperations.matchAll(/^```ts\n([\s\S]*?)^```\s*$/gm)].map(match => match[1]);
async function installedExample(name, needle) {
  const matches = typescriptBlocks.filter(block => block.includes(needle));
  assert.equal(matches.length, 1, `${name} has one installed TypeScript fence`);
  const path = join(process.cwd(), `${name}.ts`); writeFileSync(path, matches[0]);
  return import(pathToFileURL(path).href);
}
const { readEveryRow } = await installedExample("guide-read-every-row", "function readEveryRow<Row>");
const pagedRows = await readEveryRow(async cursor => cursor === null
  ? { data: [{ id: "new" }], next: "opaque:guide", complete: true, cut: null }
  : { data: [{ id: "old" }], next: null, complete: true, cut: null });
assert.deepEqual(pagedRows.map(row => row.id), ["new", "old"], "installed paging fence exhausts every row");

const accountSource = join(process.cwd(), "account-source"); mkdirSync(accountSource);
writeFileSync(join(accountSource, "schema.q"), `use identity password
table roles:
  principal: principal
  role: enum('member')
  unique principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('member')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal, role}
`);
await deploy("account-deployment", "account-source");
const accountHost = await startServe("account-deployment");
try {
  const { prepareProduction } = await installedExample("guide-prepare-production", "function prepareProduction(host: ServeHost)");
  const prepared = await prepareProduction(accountHost);
  assert.equal(prepared.member.length, 1, "installed production fence provisions its requested role");
} finally { await accountHost.stop(); }

const production = readFileSync(join(packageRoot, "dist/recipes/production/web/schema.q"), "utf8");
for (const query of [
  /return members where \.principal = viewer after c last 100 by \.id/,
  /return members where \.teamId = teamId after c last 100 by \.id/,
]) assert.match(production, query);
const productionCwd = join(process.cwd(), "production"); mkdirSync(join(productionCwd, "snapback"), { recursive: true });
writeFileSync(join(productionCwd, "snapback/schema.q"), production);
const productionCheck = await cli(["check", "--json"], { cwd: productionCwd });
assert.equal(productionCheck.code, 0, productionCheck.stderr + productionCheck.stdout);

const deniedCwd = join(process.cwd(), "write-auth"); mkdirSync(join(deniedCwd, "snapback"), { recursive: true });
writeFileSync(join(deniedCwd, "snapback/schema.q"), "use personas alice\ntable notes:\n  title: text <=80\n  read <- allow\n  online only\nmutation add(title: text <=80):\n  require viewer = 'dev:alice' else NO\n  return insert notes {title}\n");
const deniedCheck = await cli(["check", "--json"], { cwd: deniedCwd });
assert.equal(deniedCheck.code, 0, deniedCheck.stderr + deniedCheck.stdout);
const deniedFacts = JSON.parse(deniedCheck.stdout);
assert.ok(deniedFacts.notes.some(note => note.code === "N_WRITE_DENIED" && note.rewrite.includes("never grants table authority")));

console.log("DX8 ergonomics consumer passed: day-two comparison, null/full-line text, opaque paging, newest-first starters, and two-layer authorization guidance");
