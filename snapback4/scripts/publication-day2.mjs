// @ref LLP 3000.011.003.000.000#9-wave-13-saved-version-proofs-day3-2026-10-16 — packed feature compositions must execute together.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runToolchainCommand } from "./publication-starters.mjs";

// Both exports can also run against an installed older package as negative controls.
export function checkExpoPorts(cwd, output, low, high) {
  assert.match(output, new RegExp(`backend is http://127\\.0\\.0\\.1:${low}\\b`));
  assert.match(output, new RegExp(`serves http://localhost:${low + 1}\\b`));
  const client = readFileSync(join(cwd, "src/client.ts"), "utf8");
  assert.ok(client.includes(`http://127.0.0.1:${low}`), "printed backend must equal written client fallback");
  assert.ok(!client.includes("127.0.0.1:4400"), "range init must not retain the default client port");
  const launcher = readFileSync(join(cwd, "scripts/launch.mjs"), "utf8");
  const ports = [...launcher.matchAll(/low === null \? (\d+)/g)].map(match => Number(match[1]));
  assert.deepEqual(ports, [low, low + 1], "every written launcher fallback agrees with printed ports");
  for (const path of ["README.md", "src/client.ts", "scripts/launch.mjs"]) {
    const text = readFileSync(join(cwd, path), "utf8");
    for (const match of text.matchAll(/(?:127\.0\.0\.1|localhost):(\d+)/g)) {
      const port = Number(match[1]);
      assert.ok(port >= low && port <= high, `${path} writes ${port} outside ${low}-${high}`);
    }
  }
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
  assert.equal(pkg.scripts.backend, "node scripts/launch.mjs backend");
  assert.equal(pkg.scripts.web, "node scripts/launch.mjs expo-web");
  assert.equal(pkg.dependencies.expo, "57.0.30", "Expo is pinned before installing adapter peers");
}

export const day2Consumer = String.raw`
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
`;

export async function proveDay2(client, platform, directory) {
  const cwd = join(resolve(directory), "day2-compatibility"); mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}');
  const env = { ...process.env, CI: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN; delete env.PORT_LO; delete env.PORT_HI;
  const run = (command, args, dir = cwd, extra = {}) => runToolchainCommand(command, args, { cwd: dir, env: { ...env, ...extra }, timeout: 300_000 });
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(client), resolve(platform)]);
  writeFileSync(join(cwd, "day2.mjs"), day2Consumer);
  await run(process.execPath, ["day2.mjs"]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packedBinary = join(cwd, "node_modules/snapback4-linux-x64/snapback4");
  await run(process.execPath, ["--test", "--test-name-pattern", "H9", join(root, "packages/snapback4/test/wave13-previews.test.mjs")], root,
    { SNAPBACK4_BIN: packedBinary });
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "playwright-core@1.55.1"]);
  await run(process.execPath, ["--test", join(root, "packages/snapback4/test/proof-contract.test.mjs")], root,
    { KIT2_BASELINE_DIST: join(cwd, "node_modules/snapback4/dist"), SNAPBACK4_BIN: packedBinary });
  const agreement = join(cwd, "fixture-agreement"); mkdirSync(join(agreement, "snapback"), {recursive:true}); mkdirSync(join(agreement, "fixtures"));
  writeFileSync(join(agreement, "snapback/schema.q"), "use personas alice\nquery clock(at: time, optional: time ?, times: [time] <=4):\n  return at\n");
  writeFileSync(join(agreement, "fixtures/test.cases.jsonl"), JSON.stringify({op:"clock",args:{at:"now+2h",optional:"now-1h",times:["now","now+1ms"]}})+"\n");
  writeFileSync(join(cwd, "agreement.mjs"), `import assert from 'node:assert/strict'; import {cli} from 'snapback4/proof';
    const options={cwd:${JSON.stringify(agreement)}};
    const tested=await cli(['test'],options); assert.equal(tested.code,0,tested.stdout+tested.stderr);
    const checked=await cli(['check','--json'],options); assert.equal(checked.code,0,checked.stdout+checked.stderr);
    assert.doesNotMatch(checked.stdout,/N_FIXTURE_ARGUMENT_DRIFT/);
    console.log('packed fixture check/test agreement passed');`);
  await run(process.execPath, ["agreement.mjs"]);
  const expo = join(cwd, "expo-ports"); mkdirSync(expo);
  // Capture output through the published kit, so only packed modules/binary are used.
  writeFileSync(join(cwd, "ports.mjs"), `import {cli} from 'snapback4/proof'; import {writeFileSync} from 'node:fs'; const result=await cli(['init','--expo'],{cwd:${JSON.stringify(expo)},env:{PORT_LO:'29120',PORT_HI:'29129'}}); writeFileSync('expo-init.stdout',result.stdout); if(result.code) throw Error(result.stderr);`);
  await run(process.execPath, ["ports.mjs"]);
  checkExpoPorts(expo, readFileSync(join(cwd, "expo-init.stdout"), "utf8"), 29120, 29129);
  return { status: "passed", directory: cwd, savedSourceCompatibility: "passed", expoPrintedWrittenPorts: "passed", previewNoise: "passed", helperContracts: "passed", fixtureAgreement: "passed" };
}
