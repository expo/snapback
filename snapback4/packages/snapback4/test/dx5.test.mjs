import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { upgradeWarnings, firstCheckWarnings } from "../bin/upgrade-warnings.js";
import { command } from "../dist/proof.js";
const root = resolve(import.meta.dirname, "../../..");
process.env.SNAPBACK4_BIN ??= join(root, "target/debug/snapback4");
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-dx5-"));
  t.after(() => rmSync(cwd, { recursive:true, force:true })); return cwd;
}
test("DX5 reused staging schedules report every fired or held window", {timeout:120000}, async t => {
  const cwd = fixture(t);
  mkdirSync(join(cwd, "node_modules")); symlinkSync(resolve(import.meta.dirname, ".."), join(cwd, "node_modules/snapback4"));
  writeFileSync(join(cwd,"clock.mjs"), readFileSync(join(root,"scripts/dx5-clock-consumer.mjs")));
  const result = await command(process.execPath, ["clock.mjs"], {cwd,timeoutMs:110000});
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /schedule releaseHourly:.*already processed/);
});
test("DX5 real users receive privacy-preserving lookup and unique diagnostics", {timeout:60000}, async t => {
  const cwd=fixture(t);mkdirSync(join(cwd,"node_modules"));symlinkSync(resolve(import.meta.dirname,".."),join(cwd,"node_modules/snapback4"));
  writeFileSync(join(cwd,"consumer.mjs"),readFileSync(join(root,"scripts/dx5-diagnostics-consumer.mjs")));
  const result=await command(process.execPath,["consumer.mjs"],{cwd,timeoutMs:50000});
  assert.equal(result.code,0,result.stdout+result.stderr);
});
test("DX5 migration scan lists array/shell JSON consumers without source contents and skips generated/symlink trees", t => {
  const cwd = fixture(t); mkdirSync(join(cwd,"scripts")); mkdirSync(join(cwd,"dist"));
  writeFileSync(join(cwd,"scripts/old.mjs"), `const secret='NEVER_PRINT_SOURCE'; JSON.parse(run(['data','notes','--json'])).map(x=>x);`);
  writeFileSync(join(cwd,"scripts/old.sh"), "snapback4 data notes --json | jq '.[]'");
  writeFileSync(join(cwd,"scripts/multiline.mjs"), 'run([\n"data",\n"notes",\n"--json"\n]);');
  writeFileSync(join(cwd,"scripts/unrelated.mjs"), 'const data = run(["check", "--json"]);');
  writeFileSync(join(cwd,"dist/ignored.mjs"), "snapback4 data notes --json");
  symlinkSync(join(cwd,"scripts"),join(cwd,"linked"));
  const warnings = upgradeWarnings(cwd,"use identity password").join("\n");
  assert.match(warnings, /scripts\/old.mjs/); assert.match(warnings, /scripts\/old.sh/);
  assert.match(warnings, /scripts\/multiline.mjs/);assert.doesNotMatch(warnings,/scripts\/unrelated.mjs/);
  assert.match(warnings, /JSON.parse\(stdout\).rows/); assert.doesNotMatch(warnings, /NEVER_PRINT_SOURCE|ignored|linked/);
});
test("DX5 first check emits warnings before a refused compiler and preserves captured quiet-upgrade advice", t => {
  const cwd = fixture(t); mkdirSync(join(cwd,"snapback")); mkdirSync(join(cwd,"scripts"));
  writeFileSync(join(cwd,"package.json"), '{"name":"upgrade-case"}');
  writeFileSync(join(cwd,"snapback/schema.q"), "use identity password\ninvalid schema\n");
  writeFileSync(join(cwd,"scripts/old.mjs"), 'startDev(); fetch("/seed"); const args=["data","notes","--json"];');
  const wrapper = resolve(import.meta.dirname,"../bin/snapback4.js");
  const check = env => spawnSync(process.execPath,[wrapper,"check","--json"],{cwd,env:{...process.env,...env},encoding:"utf8",timeout:30000});
  const baseline=check({SNAPBACK4_UPGRADE_BASELINE:"1"}); assert.doesNotMatch(baseline.stderr,/upgrade warning/);
  for(let n=0;n<2;n++) {
    const result=check({SNAPBACK4_UPGRADE_BASELINE:""}); assert.notEqual(result.status,0);
    assert.equal(JSON.parse(result.stdout).ok,false);
    for(const text of [/doors are CLOSED/,/startDev\(\) persists/,/JSON.parse\(stdout\).rows/]) assert.match(result.stderr,text);
    assert.equal(existsSync(join(cwd,".snapback4/project-warnings-version.json")),false,"captured stderr is not proof of delivery");
  }
});
test("DX5 terminal delivery acknowledges project warnings separately from compiler history", t => {
  const cwd=fixture(t);mkdirSync(join(cwd,"snapback"));
  writeFileSync(join(cwd,"package.json"),'{"name":"visible-check"}');
  writeFileSync(join(cwd,"snapback/schema.q"),"use identity password\n");
  const descriptor=Object.getOwnPropertyDescriptor(process.stderr,"isTTY"),write=process.stderr.write,lines=[];
  try {
    Object.defineProperty(process.stderr,"isTTY",{configurable:true,value:true});
    process.stderr.write=text=>{lines.push(String(text));return true;};
    firstCheckWarnings(cwd);assert.equal(lines.length,1);assert.match(lines[0],/doors are CLOSED/);
    assert.ok(existsSync(join(cwd,".snapback4/project-warnings-version.json")));
    assert.equal(existsSync(join(cwd,".snapback4/runtime-version.json")),false);
    firstCheckWarnings(cwd);assert.equal(lines.length,1);
  } finally {
    process.stderr.write=write;
    if(descriptor)Object.defineProperty(process.stderr,"isTTY",descriptor);else delete process.stderr.isTTY;
  }
});
