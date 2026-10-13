import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";
import { createApp } from "../dist/app.js";
import { memorySessionStore } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.SNAPBACK4_BIN ?? resolve(pkg, "../../target/debug/snapback4");
const readme = readFileSync(join(pkg, "README.md"), "utf8");
const blocks = [...readme.matchAll(/^```(quarry|tsx?)\n([\s\S]*?)^```/gm)];
const until = async (read, label) => { return awaitState(read, label); };

test("README first-account package imports execute through public exports", async () => {
  const imports = blocks.filter(block => block[1] !== "quarry").flatMap(block =>
    [...block[2].matchAll(/^import \{([^}]+)\} from "(snapback4(?:\/[^\"]+)?|react)";/gm)]);
  assert.equal(imports.length, 6);
  for (const [, names, specifier] of imports) {
    const module = await import(specifier);
    for (const name of names.split(",").map(name => name.trim())) assert.equal(typeof module[name], "function", `${specifier}: ${name}`);
  }
  const intent = blocks.find(block => block[2].includes("const intent ="))[2];
  const body = intent.replace(/^import .+;\n/m, "");
  // Execute the exact kept-intent example with the actual export and capture its call.
  const { mintId } = await import(imports.find(([, names]) => names.includes("mintId"))[2]);
  let submitted;
  const client = { mutate: async (...args) => { submitted = args; } }, api = { saveProfile: { kind: "mutation", name: "saveProfile" } };
  await new Function("mintId", "client", "api", `return (async () => { ${body} })();`)(mintId, client, api);
  assert.equal(submitted[0], api.saveProfile); assert.deepEqual(submitted[1], { handle: "alice" });
  assert.match(submitted[2].id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
});

test("README Following reader matches the feeds card", () => {
  const name = readme.match(/Name its reader `query (\w+)`/)[1];
  const feeds = readFileSync(resolve(pkg, "../../crates/snapback4-lang/src/guide/feeds.md"), "utf8");
  assert.ok(feeds.includes(`query ${name}(`), name);
});

// The only application inputs are README blocks and the named init --expo starter.
// No handwritten Query/Mutation declarations or alternate account schema can mask a broken path.
for (const tier of ["online", "local"]) test(`README first account: ${tier}, generated API, password, avatar, reopen and denied read`, { timeout: hangBudget(27) }, async t => {
  const schema = blocks.find(b => b[1] === "quarry" && b[2].includes("table profiles:"))?.[2];
  assert.ok(schema, "README must contain its password profile schema");
  const examples = blocks.filter(b => b[1] !== "quarry" && b[2].startsWith("// ")).map(b => ({ text: b[2], file: b[2].match(/^\/\/ (src\/\w+\.ts|App\.tsx)\n/)?.[1] }));
  assert.deepEqual(examples.map(b => b.file), ["src/client.ts", "App.tsx"]);
  const dir = mkdtempSync(join(pkg, ".first-account-"));
  let host, client, screen;
  t.after(async () => {
    await screen?.close();
    if (host && host.exitCode === null) { const done = new Promise(r => host.once("exit", r)); host.kill("SIGTERM"); await done; }
    rmSync(dir, { recursive: true, force: true });
  });
  const run = args => {
    const result = spawnSync(binary, args, { cwd: dir, encoding: "utf8", timeout: hangBudget() });
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  run(["init", "--expo"]);
  writeFileSync(join(dir, "snapback/schema.q"), schema);
  // Compile the README entry against its freshly generated API and actual package types.
  for (const { file, text } of examples) writeFileSync(join(dir, file), text);
  run(["init", "--adapt"]); // README retires untouched todo fixtures after replacing the schema.
  const checked = JSON.parse(run(["check", "--json"]));
  assert.deepEqual(checked.diagnostics ?? [], []);
  assert.deepEqual(checked.notes, []);
  const expo = createRequire(resolve(pkg, "../../apps/chat-expo/package.json"));
  const options = { noEmit: true, strict: true, skipLibCheck: true, allowImportingTsExtensions: true, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: pkg, paths: { "snapback4/*": ["dist/*"], "react": ["node_modules/@types/react/index.d.ts"], "react/*": ["node_modules/@types/react/*"],
      "react-native": [expo.resolve("react-native/types/index.d.ts")], "expo-secure-store": [expo.resolve("expo-secure-store/build/SecureStore.d.ts")],
      "snapback4-expo": ["../snapback4-expo/src/index.ts"] } };
  const program = ts.createProgram(examples.map(b => join(dir, b.file)), options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => dir, getCanonicalFileName: p => p, getNewLine: () => "\n" }));
  // The retained Expo entry point must be able to import the README's replacement App.
  const checker = program.getTypeChecker();
  const appSymbol = checker.getSymbolAtLocation(program.getSourceFile(join(dir, "App.tsx")));
  assert.ok(appSymbol, "README App.tsx must be a module");
  const appExports = checker.getExportsOfModule(appSymbol).map(symbol => symbol.getName()).sort();
  const entry = ts.createSourceFile("index.js", readFileSync(join(dir, "index.js"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const statement of entry.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "./App") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const name = (specifier.propertyName ?? specifier.name).text;
      assert.ok(appExports.includes(name), `starter index.js imports missing symbol ${name} from README App.tsx; exports found: ${appExports.join(", ") || "(none)"}`);
    }
  }
  const generated = readFileSync(join(dir, "snapback/generated/api.ts"), "utf8");
  assert.match(generated, /saveProfile/);
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(pkg, join(dir, "node_modules/snapback4"));
  for (const file of ["snapback/generated/api.ts"]) {
    const source = readFileSync(join(dir, file), "utf8").replace('"../snapback/generated/api"', '"../snapback/generated/api.mjs"');
    writeFileSync(join(dir, file.replace(/\.ts$/, ".mjs")), ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }));
  }
  const { api } = await import(pathToFileURL(join(dir, "snapback/generated/api.mjs")));
  let output = "";
  host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(host);
  for (const stream of [host.stdout, host.stderr]) stream.on("data", bytes => { output += bytes; });
  const url = await until(() => { assert.equal(host.exitCode, null, output); return readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; }, "server");
  const originalFetch = globalThis.fetch;
  let loseSaveReply = false, replyLost = false;
  globalThis.fetch = async (...args) => {
    if (replyLost && ["/m/saveProfile", "/sync"].includes(new URL(args[0]).pathname)) throw Error("link remains unavailable");
    const response = await originalFetch(...args);
    if (loseSaveReply && new URL(args[0]).pathname === "/m/saveProfile") {
      loseSaveReply = false; replyLost = true;
      await response.arrayBuffer();
      throw Error("response lost after commit");
    }
    return response;
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = memorySessionStore();
  const device = tier === "local" ? processDevice({ dir: join(dir, "device"), binary }) : undefined;
  const open = () => createApp({ url, sessionStore: store, device });
  screen = open(); await screen.ready;
  assert.equal(screen.auth.state, "signed-out");
  assert.equal((await screen.auth.signup(`${tier}@example.com`, "long-password")).ok, true);
  client = screen.client;
  const principal = client.viewer();
  if (tier === "local") assert.equal(client.acquired, true, "the documented opener completes acquisition");
  assert.equal((await client.query(api.handleAvailable, { handle: "alice" })).data, true, "availability is checked after signup");
  assert.equal((await client.query(api.myProfile, {})).data, null, "a signed-in account without a profile resumes onboarding");
  loseSaveReply = true;
  const saved = await screen.mutate(api.saveProfile, { handle: "alice" });
  assert.equal(saved.state, "pending", "a lost confirmation keeps the recorded intent");
  await screen.close(); client = undefined; replyLost = false;
  screen = open(); await screen.ready; client = screen.client;
  const settled = await until(async () => { const w = await client.write(saved.id); return w?.state === "pending" ? undefined : w; }, "same-ID save after reopen");
  assert.equal(settled.state, "sent");
  assert.equal(settled.id, saved.id);
  assert.equal(client.viewer(), principal, "pending recovery keeps the signed-in account");
  // A real supported PNG: upload first, then place its ID through the generated mutation.
  const png = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64")], { type: "image/png" });
  const uploaded = await client.upload(png); assert.equal(uploaded.ok, true);
  assert.equal((await screen.mutate(api.placeAvatar, { avatar: { id: uploaded.asset.id } })).state, "sent");
  const profile = (await client.query(api.myProfile, {})).data;
  assert.equal(profile.handle, "alice");
  assert.ok(profile.avatar?.id);
  const asset = await client.asset(profile.avatar.id);
  assert.ok("url" in asset); asset.revoke();
  await screen.close(); client = undefined;
  screen = open(); await screen.ready; client = screen.client;
  assert.equal(client.viewer(), principal, "reopen restores the persisted password session");
  assert.equal(((await client.query(api.myProfile, {})).data).avatar.id, profile.avatar.id);
  await screen.close(); client = undefined;
  screen = open(); await screen.ready; assert.equal((await screen.auth.login(`${tier}@example.com`, "long-password")).ok, true); client = screen.client;
  assert.equal(client.viewer(), principal);
  assert.equal(((await client.query(api.myProfile, {})).data).handle, "alice");
  const refused = await client.query(api.profileFor, { owner: "user:someone-else" });
  assert.equal(refused.denied?.code, "PROFILE_PRIVATE", "a denied read is not missing-profile onboarding");
  t.diagnostic(`first account ${tier}: generated_types=1 signup=1 login=1 profile=1 avatar=1 reopen=1 denied=1 pending_same_id=1`);
});
