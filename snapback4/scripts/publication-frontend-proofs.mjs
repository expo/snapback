// @ref LLP 3000.011.003.000.000#3 — both generated proofs run twice under occupied-port and CPU load.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runToolchainCommand, starterCases, proveFrontendTwice } from "./publication-starters.mjs";
export async function proveGeneratedProofs(client, platform, expo, directory) {
  const artifacts = [client, platform, expo].map(path => resolve(path));
  const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN;
  const run = (command, args, cwd, overrides = {}) => runToolchainCommand(command, args, { cwd, env: { ...env, ...overrides }, timeout: 300_000 });
  const results = [];
  for (const starter of starterCases) {
    const { kind, id, flags } = starter;
    const cwd = join(directory, `frontend-${id}`); mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "package.json"), '{"private":true}');
    await run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", ...artifacts.slice(0, 2)], cwd);
    const cli = join(cwd, "node_modules/.bin/snapback4");
    // The init owner's environment must never survive in generated files.
    await run(cli, ["init", ...flags], cwd, { PORT_LO: "29040", PORT_HI: "29049" });
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
    assert.equal(pkg.scripts["frontend:proof"], "node scripts/frontend-proof.mjs");
    assert.equal(pkg.devDependencies["playwright-core"], "1.55.1");
    assert.ok(!readFileSync(join(cwd, "scripts/frontend-proof.mjs"), "utf8").includes("29040"));
    pkg.dependencies.snapback4 = `file:${artifacts[0]}`;
    pkg.optionalDependencies = { [`snapback4-${process.platform}-${process.arch}`]: `file:${artifacts[1]}` };
    if (kind === "expo") pkg.dependencies["snapback4-expo"] = `file:${artifacts[2]}`;
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
    await run("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], cwd);
    await run(cli, ["check"], cwd);
    await run("npm", ["run", "typecheck"], cwd);
    await run("npm", ["run", kind === "web" ? "build" : "build:web"], cwd);
    results.push(...await proveFrontendTwice(run, cwd, starter));
  }
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [client, platform, expo, out] = process.argv.slice(2);
  if (!client || !platform || !expo || !out) throw Error("usage: publication-frontend-proofs.mjs client.tgz platform.tgz expo.tgz output-directory");
  mkdirSync(resolve(out), { recursive: true });
  const results = await proveGeneratedProofs(client, platform, expo, resolve(out));
  writeFileSync(join(resolve(out), "frontend-proofs.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
