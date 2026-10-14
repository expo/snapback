// @ref LLP 3000.011.003.000#10 — packed starters must pass their real web toolchains
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// Runs outside a checkout, using only packed release artifacts. Registry access
// is needed for Expo/Vite dependencies; npm prefers cached downloads when present.
export function proveStarters(client, platform, expo, directory) {
  const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN;
  const deadline = performance.now() + 1_200_000;
  const run = (cmd, args, cwd) => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw Error("starter qualification exceeded its twenty-minute guard");
    return execFileSync(cmd, args, { cwd, env, stdio: "inherit", timeout: Math.min(300_000, remaining) });
  };
  const artifacts = [client, platform, expo].map(path => resolve(path));
  const results = [];
  for (const [kind, template] of [["web", null], ["expo", null], ["web", "chat"], ["expo", "chat"], ["expo", "social"]]) {
    const cwd = join(directory, `starter-${kind}${template ? `-${template}` : ""}`); mkdirSync(cwd);
    writeFileSync(join(cwd, "package.json"), '{"private":true}');
    // Install the CLI first so init and all later package scripts resolve the
    // packed binary. Pin native JS in init's manifest before dependency install.
    run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", ...artifacts.slice(0, 2)], cwd);
    const cli = join(cwd, "node_modules/.bin/snapback4");
    run(cli, ["init", ...(template === "social" ? ["--template", "social"] : [`--${kind}`, ...(template ? ["--template", template] : [])])], cwd);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
    pkg.dependencies.snapback4 = `file:${artifacts[0]}`;
    pkg.optionalDependencies = { [`snapback4-${process.platform}-${process.arch}`]: `file:${artifacts[1]}` };
    if (kind === "expo") pkg.dependencies["snapback4-expo"] = `file:${artifacts[2]}`;
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
    // Lifecycle scripts are enabled: esbuild and the other real tools need them.
    run("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], cwd);
    const build = () => {
      run(cli, ["check"], cwd);
      run("npm", ["run", "typecheck"], cwd);
      if (kind === "expo") run(join(cwd, "node_modules/.bin/expo"), ["export", "-p", "web", "--max-workers", "2"], cwd);
      run("npm", ["run", kind === "expo" ? "build:web" : "build"], cwd);
      assert.ok(existsSync(join(cwd, "dist/index.html")), `${kind} produced a web page`);
    };
    build();
    if (template) {
      results.push({ kind, template, status: "passed", typecheck: "passed", build: "passed" });
      continue;
    }
    // Exercise init-first adaptation with a different online-only schema: Home,
    // generated API, identity, README and the no-wasm journal must build together.
    writeFileSync(join(cwd, "snapback/schema.q"), `use identity guests\ntable notes:\n  owner: principal\n  title: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nquery mine():\n  return notes where .owner = viewer first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { owner: viewer, title }\n`);
    run(cli, ["init", "--adapt"], cwd);
    build();
    results.push({ kind, status: "passed", adapted: "passed", typecheck: "passed", build: "passed" });
  }
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [client, platform, expo] = process.argv.slice(2);
  if (!client || !platform || !expo) throw Error("usage: publication-starters.mjs client.tgz platform.tgz expo.tgz");
  const results = proveStarters(client, platform, expo, process.cwd());
  console.log(JSON.stringify({ starters: results, dependencies: "npm registry (prefer-offline), Expo network checks disabled" }));
}
