// Run the production guide's complete starter slice using the installed packs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runToolchainCommand } from "./publication-starters.mjs";

const ignored = new Set(["node_modules", ".git", "target", "dist", "build", ".expo", ".snapback4", "logs", "fixtures", "versions", "recipes"]);
const frontend = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html"]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

/** Only authored schema/frontend sources enter the private external-lane copy.
 * Symlinks are not followed; dependencies, fixtures, logs and outputs stay out. */
export function productionSources(root) {
  const files = new Map();
  function walk(relative = "", depth = 20) {
    assert.ok(depth > 0, `source directory nesting exceeds qualification bound: ${relative}`);
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) { if (!ignored.has(entry.name) && entry.name !== "generated") walk(path, depth - 1); }
      else if (entry.isFile() && (frontend.has(extname(path)) || (path.startsWith(`snapback${sep}`) && extname(path) === ".q")))
        files.set(path, readFileSync(join(root, path)));
    }
  }
  walk();
  assert.ok(files.has(join("snapback", "schema.q")), `${root} has snapback/schema.q`);
  return files;
}

function snapshot(root) {
  return [...productionSources(root)].map(([path, bytes]) => [path, sha(bytes)]);
}

function privateSnapshot(root) {
  const files = [];
  function walk(relative = "") {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) { if (!ignored.has(entry.name) && entry.name !== "generated") walk(path); }
      else if (entry.isFile() && !/^production-.*\.log$/.test(entry.name)) files.push([path, sha(readFileSync(join(root, path)))]);
    }
  }
  walk(); return files;
}

function capture(cli, args, cwd, env, log) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(log, result.stdout + result.stderr);
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.error?.message ?? ""}\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** The CLI only receives the private copy's cwd; original lanes are read-only. */
export function proveProductionAdaptation(cli, cwd, env, { original } = {}) {
  const originalBefore = original ? snapshot(original) : undefined;
  const before = privateSnapshot(cwd), frontendBefore = before.filter(([path]) => !path.startsWith(`snapback${sep}`));
  const sourcesBefore = productionSources(cwd);
  const identityBefore = [...sourcesBefore].filter(([path]) => path.startsWith(`snapback${sep}`)).map(([, bytes]) => bytes.toString().match(/^use identity[^\n]*/gm) ?? []).flat();
  const preview = capture(cli, ["init", "--adapt", "--production"], cwd, env, join(cwd, "production-preview.log"));
  assert.match(preview, /preview; no files written/);
  assert.match(preview, /N_NO_PRODUCTION_WRITER tables/);
  if ([...sourcesBefore].some(([path, bytes]) => !path.startsWith(`snapback${sep}`) && bytes.includes("dev:")))
    assert.match(preview, /hard-coded dev: principal/, "authored development principals are listed for review");
  assert.deepEqual(privateSnapshot(cwd), before, "preview leaves every private application byte untouched");
  const writers = [...preview.matchAll(/: add (\w+); allow service:ops/g)].map(match => match[1]);
  assert.ok(writers.length > 0, "fixture-only rosters receive provisioning mutations");
  const applied = capture(cli, ["init", "--adapt", "--production", "--apply"], cwd, env, join(cwd, "production-apply.log"));
  assert.match(applied, /Signup grants no role/);
  const after = privateSnapshot(cwd);
  assert.deepEqual(after.filter(([path]) => !path.startsWith(`snapback${sep}`)), frontendBefore, "apply preserves every screen and frontend source byte");
  const schema = [...productionSources(cwd)].filter(([path]) => path.startsWith(`snapback${sep}`)).map(([, bytes]) => bytes.toString()).join("\n");
  const identityAfter = schema.match(/^use identity[^\n]*/gm) ?? [];
  assert.deepEqual(identityAfter, identityBefore.length ? identityBefore : ["use identity"], "existing identity policy is preserved; persona-only sources gain bare identity");
  for (const name of writers) {
    assert.equal([...schema.matchAll(new RegExp(`^mutation ${name}\\(`, "gm"))].length, 1, `one ${name} provisioning mutation`);
  }
  assert.match(schema, /require viewer = 'service:ops' else NOT_OPERATOR/);
  capture(cli, ["check"], cwd, env, join(cwd, "production-check.log"));
  capture(cli, ["init", "--adapt", "--production", "--apply"], cwd, env, join(cwd, "production-second-apply.log"));
  assert.deepEqual(privateSnapshot(cwd), after, "a repeated apply is idempotent");
  if (original) assert.deepEqual(snapshot(original), originalBefore, "original evidence lane remains byte-identical");
  return { status: "passed", preview: "unchanged", apply: "compiled", frontend: "unchanged", identity: identityAfter, writers,
    idempotent: true, ...(original ? { original, originalSources: originalBefore, originalUnchanged: true } : {}) };
}

export async function proveProduction(client, platform, expo, directory) {
  const artifacts = [client, platform, expo].map(path => resolve(path));
  const output = resolve(directory), root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  mkdirSync(output, { recursive: true });
  const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN; delete env.PORT_LO; delete env.PORT_HI;
  const run = (command, args, cwd, overrides = {}) => runToolchainCommand(command, args, { cwd, env: { ...env, ...overrides }, timeout: 300_000 });
  const starters = [];
  for (const kind of ["web", "expo"]) {
    const cwd = join(output, `production-${kind}`); mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}');
    await run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", ...artifacts.slice(0, 2)], cwd);
    const cli = join(cwd, "node_modules/snapback4/bin/snapback4.js");
    await run(process.execPath, [cli, "init", `--${kind}`], cwd);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
    pkg.dependencies.snapback4 = `file:${artifacts[0]}`;
    pkg.optionalDependencies = { [`snapback4-${process.platform}-${process.arch}`]: `file:${artifacts[1]}` };
    if (kind === "expo") pkg.dependencies["snapback4-expo"] = `file:${artifacts[2]}`;
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
    await run("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], cwd);
    const guide = capture(cli, ["guide", "production", "--full"], cwd, env, join(cwd, "production-guide.log"));
    const blocks = [...guide.matchAll(/```sh\n([\s\S]*?)\n```/g)].map(match => match[1]).filter(text => text.startsWith("cp recipes/production/schema.q"));
    assert.equal(blocks.length, 2, "packed guide carries React and Expo command recipes");
    const commands = blocks[kind === "web" ? 0 : 1].trim().split("\n");
    assert.equal(commands.length, 7, "complete schema/screen/client/check/test/typecheck/build recipe");
    // Execute the actual packed guide lines without changing their arguments.
    // No shell interpolation is needed for these fixed, whitespace-only forms.
    for (const line of commands) {
      const [command, ...args] = line.trim().split(/\s+/);
      assert.ok(["cp", "npx", "npm"].includes(command), `unsupported guide command: ${line}`);
      await run(command, args, cwd);
    }
    starters.push({ kind, cwd, status: "passed", commands, schema: "compiled", savedTests: "passed", typecheck: "passed", build: "passed" });
  }
  const [web, native] = starters;
  await run(process.execPath, ["--test", join(root, "packages/snapback4/test/production-starters.test.mjs")], root, {
    SNAPBACK4_PRODUCTION_WEB_APP: join(web.cwd, "recipes/production/App.tsx"),
    SNAPBACK4_PRODUCTION_EXPO_APP: join(native.cwd, "recipes/production/App.tsx"),
    SNAPBACK4_PRODUCTION_NATIVE_SMOKE: join(native.cwd, "src/native-smoke.ts"),
    SNAPBACK4_PRODUCTION_CLIENT_DIST: join(web.cwd, "node_modules/snapback4/dist"),
  });
  const cli = join(web.cwd, "node_modules/snapback4/bin/snapback4.js");
  const persona = join(output, "production-adapt-persona"); mkdirSync(persona, { recursive: true });
  await run(process.execPath, [cli, "init", "--web"], persona);
  const path = join(persona, "snapback/schema.q");
  writeFileSync(path, readFileSync(path, "utf8").replace(/^use identity[^\n]*\n/gm, "") + personaRoster);
  writeFileSync(join(persona, "src/legacy-principal.ts"), "export const legacyPrincipal = 'dev:alice';\n");
  const adaptation = [{ kind: "persona-only starter", ...proveProductionAdaptation(cli, persona, env) }];
  for (const [index, original] of (process.env.SNAPBACK4_PRODUCTION_LANES ?? "").split(":").filter(Boolean).map(path => resolve(path)).entries()) {
    const cwd = join(output, `production-adapt-lane-${index}-${basename(original)}`); mkdirSync(cwd, { recursive: true });
    const before = snapshot(original);
    for (const [path, bytes] of productionSources(original)) { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), bytes); }
    assert.deepEqual(snapshot(original), before, "copying does not modify original sources");
    adaptation.push({ kind: "evidence copy", ...proveProductionAdaptation(cli, cwd, env, { original }) });
  }
  return { status: "passed", starters, browserRecipes: "passed", adaptation };
}

const personaRoster = `
table staff:
  principal: principal
  role: enum('admin', 'member')
  unique principal
  read <- .principal = viewer
  insert <- exists staff[viewer]
  online only
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [client, platform, expo, out] = process.argv.slice(2);
  if (!client || !platform || !expo || !out) throw Error("usage: publication-production.mjs client.tgz platform.tgz expo.tgz output-directory");
  console.log(JSON.stringify(await proveProduction(client, platform, expo, out)));
}
