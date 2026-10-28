// @ref LLP 3000.000.000.002#5-evidence — execute the installed guide's persistent production lifecycle verbatim.
import assert from "node:assert/strict";
import { proveRollInstalled } from "./publication-roll.mjs";
import { proveREL3 } from "./publication-rel3.mjs";
import { proveREL4 } from "./publication-rel4.mjs";
import { provePromote } from "./publication-promote.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runToolchainCommand } from "./publication-starters.mjs";

export async function proveMigrations(client, platform, directory) {
  const cwd = join(resolve(directory), "migration-recipe"); mkdirSync(cwd, { recursive:true });
  const env = { ...process.env, npm_config_audit:"false", npm_config_fund:"false" };
  delete env.SNAPBACK4_BIN; delete env.PORT_LO; delete env.PORT_HI;
  const run = (cmd,args,at=cwd) => runToolchainCommand(cmd,args,{cwd:at,env,timeout:300_000});
  try {
    writeFileSync(join(cwd,"package.json"), '{"private":true,"type":"module"}');
    await run("npm",["install","--ignore-scripts","--no-audit","--no-fund",resolve(client),resolve(platform)]);
    const binary=join(cwd,"node_modules/snapback4/bin/snapback4.js");
    const guide=spawnSync(process.execPath,[binary,"guide","deploy","--full"],{cwd,env,encoding:"utf8",timeout:30000});
    assert.equal(guide.status,0,guide.stderr);
    // Compile the new self-contained language example using the installed CLI.
    const language=spawnSync(process.execPath,[binary,"guide","language","--full"],{cwd,env,encoding:"utf8",timeout:30000});
    assert.equal(language.status,0,language.stderr);
    const evolution=spawnSync(process.execPath,[binary,"guide","evolution","--full"],{cwd,env,encoding:"utf8",timeout:30000});
    assert.equal(evolution.status,0,evolution.stderr);
    const examples=[...(language.stdout+evolution.stdout).matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(m=>m[1]).filter(s=>s.includes("backfill parcels sizes")||s.includes("extract scans from orders"));
    assert.equal(examples.length,2);
    const example=join(cwd,"language-example");
    mkdirSync(join(example,"snapback"),{recursive:true});
    for(const [index,source]of examples.entries()){writeFileSync(join(example,"snapback/schema.q"),source);await run(process.execPath,[binary,"check"],example);await run(process.execPath,[binary,"deploy",join(example,`deployment-${index}`)],example);}
    const scripts=[...guide.stdout.matchAll(/```js\n([\s\S]*?)\n```/g)].map(m=>m[1]).filter(s=>s.startsWith("// day-two-production.mjs"));
    assert.equal(scripts.length,1,"one complete installed production recipe");
    writeFileSync(join(cwd,"day-two-production.mjs"),scripts[0]);
    // The second run starts from the first run's actual v2 rows and users.
    // No reset, snapshot replacement, fixture seed, or production deletion.
    await run(process.execPath,["day-two-production.mjs"]);
    await run(process.execPath,["day-two-production.mjs"]);
    const roll=await proveRollInstalled(cwd,binary,run);
    const rel3=await proveREL3(cwd);
    const rel4=await proveREL4(cwd);
    const promotion=await provePromote(cwd);
    return {roll,rel3,rel4,promotion,status:"passed",guide:"deploy",recipe:"verbatim installed card",runs:2,persistentProduction:true,realUsers:true,backfill:true,privacyInvariant:true,rollback:true,forwardCatchup:true,fullPopulationAssertions:true};
  } finally { rmSync(cwd,{recursive:true,force:true}); }
}
