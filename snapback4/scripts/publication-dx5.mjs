import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runToolchainCommand } from "./publication-starters.mjs";
import { proveDX5Upgrades } from "./publication-dx5-upgrade.mjs";
import { chromiumExecutable } from "../witness/lib.mjs";

export async function proveDX5(directory, client, platform, expo) {
  const parent=resolve(directory),scratch=mkdtempSync(join(parent,"dx5-"));
  const root=fileURLToPath(new URL("../",import.meta.url)),cli=join(parent,"node_modules/snapback4/bin/snapback4.js");
  const env={...process.env,CHROME:chromiumExecutable(),CI:"1",EXPO_NO_TELEMETRY:"1"};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const run=(args,cwd=scratch,extra={})=>runToolchainCommand(process.execPath,args,{cwd,env:{...env,...extra},timeout:300000});
  try {
    for(const name of ["clock","diagnostics"]) {
      const cwd=join(scratch,name);mkdirSync(cwd);
      writeFileSync(join(cwd,"consumer.mjs"),readFileSync(join(root,`scripts/dx5-${name}-consumer.mjs`)));
      await run(["consumer.mjs"],cwd);
    }
    await run(["--test",join(root,"packages/snapback4/test/dx5-react.test.mjs")],root,{SNAPBACK4_CLIENT_DIST:join(parent,"node_modules/snapback4/dist")});
    // Retain proof commands and the dependency across an actual init-first adapt.
    const cwd=join(scratch,"adapt");mkdirSync(cwd);
    await run([cli,"init","--expo"],cwd);
    assert.equal(JSON.parse(readFileSync(join(cwd,"package.json"))).devDependencies["playwright-core"],"1.55.1");
    assert.match(readFileSync(join(cwd,"metro.config.js"),"utf8"),/snapback4-expo\/metro/);
    assert.match(readFileSync(join(cwd,"App.tsx"),"utf8"),/snapback4-expo\/native-smoke/);
    writeFileSync(join(cwd,"snapback/schema.q"),"use identity\nquery alive():\n  return true\n");
    await run([cli,"init","--adapt","--apply"],cwd);
    assert.match(readFileSync(join(cwd,"scripts/frontend-proof.mjs"),"utf8"),/E_FRONTEND_SCENARIO/);
    const pkg=JSON.parse(readFileSync(join(cwd,"package.json"))),scripts=pkg.scripts;
    assert.equal(scripts["frontend:proof"],"node scripts/frontend-proof.mjs");assert.equal(scripts["proof:web"],scripts["frontend:proof"]);
    pkg.dependencies.snapback4="file:"+resolve(client);pkg.dependencies["snapback4-expo"]="file:"+resolve(expo);
    pkg.optionalDependencies={"snapback4-linux-x64":"file:"+resolve(platform)};
    writeFileSync(join(cwd,"package.json"),JSON.stringify(pkg));
    await runToolchainCommand("npm",["install","--prefer-offline","--no-audit","--no-fund"],{cwd,env,timeout:300000});
    await run([cli,"check"],cwd);
    await runToolchainCommand("npm",["run","typecheck"],{cwd,env,timeout:300000});
    writeFileSync(join(cwd,"expected-refusal.mjs"),`import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const r=spawnSync(process.execPath,['scripts/frontend-proof.mjs'],{encoding:'utf8',timeout:240000,maxBuffer:8<<20});
assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stderr,/E_FRONTEND_SCENARIO: frontend rendered/);console.log('DX5 adapted proof ran as written and refused the missing write scenario');`);
    await run(["expected-refusal.mjs"],cwd);
    const upgrades=await proveDX5Upgrades(client,platform);
    return {status:"passed",clock:"reused store fired/held/recovery",diagnostics:"source advice and wire privacy",readState:"verbatim packed guide snippet, types and all states",starter:"packaged Metro/smoke, Playwright, retained proof",upgrades};
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
