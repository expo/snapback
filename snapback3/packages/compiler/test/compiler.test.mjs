import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { compileProject, lowerSeed } from "../../snapback3/dist/compiler-api.mjs";

const compiler = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(compiler, "../snapback3/dist");
const chat = resolve(compiler, "fixtures/quarry-chat");
const todos = resolve(compiler, "fixtures/quarry-todos");

function worker(path, requests) {
  const result = spawnSync(process.execPath, [path, "--worker"], {
    input: requests.map(request => typeof request === "string" ? request : JSON.stringify(request)).join("\n") + "\n",
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n").map(line => JSON.parse(line));
}

async function temporary(t) {
  const root = await mkdtemp(resolve(tmpdir(), "snapback3-compiler-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("bundled compiler and worker compile the same real Quarry chat application", async () => {
  const compiled = await compileProject(chat);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.ok(compiled.project.programs.some(program => program.name === "messages.send"));
  assert.ok(compiled.project.programs.some(program => program.name === "messages.thread"));
  assert.equal(compiled.project.effects[0].name, "delivery.notify");
  assert.match(compiled.apiDts, /declare module 'snapback3\/client'/);
  assert.ok(Object.values(compiled.sources).some(source => source.file === "snapback/messages.q"));

  const [invalid, probe, lowered, seeded] = worker(resolve(dist, "compiler.mjs"), [
    "{invalid json",
    { id: 1, op: "probe", root: chat },
    { id: 2, op: "compile", root: chat },
    { id: 3, op: "seed", root: chat },
  ]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].code, "E_OP_INVALID");
  assert.deepEqual(probe, {
    id: 1, ok: true, protocol: "snapback3/compiler-worker/v1", operations: ["compile", "seed", "journeys"],
  });
  assert.equal(lowered.id, 2);
  assert.deepEqual(lowered.project, JSON.parse(JSON.stringify(compiled.project)));
  assert.equal(lowered.apiDts, compiled.apiDts);
  assert.equal(seeded.id, 3);
  const seed = await lowerSeed(chat);
  assert.equal(seed.ok, true, JSON.stringify(seed));
  assert.deepEqual(seeded.seed, JSON.parse(JSON.stringify(seed.seed)));
  assert.deepEqual(seed.seed.personas, ["alice", "bob", "charlie"]);
});

test("probe reports a missing fixed compiler leaf without importing the lowering graph", async t => {
  const root = await temporary(t);
  const copiedWorker = resolve(root, "compiler.mjs");
  await cp(resolve(dist, "compiler.mjs"), copiedWorker);
  const [probe] = worker(copiedWorker, [{ id: 1, op: "probe", root: chat }]);
  assert.equal(probe.ok, false);
  assert.equal(probe.dependency, "compiler-core.mjs");
});

test("invalid Quarry and seed input refuse without a partial executable artifact", async t => {
  const root = await temporary(t);
  await cp(todos, root, { recursive: true });
  const source = resolve(root, "snapback/todos.q");
  await writeFile(source, "query broken():\n  return unknownValue\n");
  const invalid = await compileProject(root);
  assert.equal(invalid.ok, false);
  assert.equal("project" in invalid, false);
  assert.ok(invalid.diagnostics.some(item => item.site.startsWith("snapback/todos.q:")));
  await cp(resolve(todos, "snapback/todos.q"), source);
  await writeFile(resolve(root, "snapback/seed.ts"), `import { seed } from "snapback3";
export default seed({personas: ["alice"], rows: {
  todos: [{id: "one", title: "hello", done: "yes", ownerId: "dev:alice"}]
}});\n`);
  const invalidSeed = await lowerSeed(root);
  assert.equal(invalidSeed.ok, false);
  assert.ok(invalidSeed.diagnostics.some(item => item.code === "E_SEED_VALUE" && /boolean/.test(item.message)));
});

test("generated API retains exact arguments, row fields, and nominal principals under TypeScript", async t => {
  const root = await temporary(t);
  const compiled = await compileProject(chat);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  const declaration = resolve(root, "api.d.ts");
  const consumer = resolve(root, "consumer.ts");
  // The actual reference declarations are also re-exported by the SDK. This
  // compiler-only test does not require the platform client to be bundled.
  const contract = resolve(dist, "types/snapback3/src/api.d.ts");
  await writeFile(declaration, compiled.apiDts);
  await writeFile(consumer, `import { api, type Op } from "snapback3/client";
import type { Principal } from "snapback3";
type Args<T> = T extends Op<infer A, any, any> ? A : never;
type Result<T> = T extends Op<any, infer R, any> ? R : never;
const send: Args<typeof api.messages.send> = {conversationId: "one", recipientId: "bob", body: "hello"};
// @ts-expect-error all required arguments survive generated API output
const missing: Args<typeof api.messages.send> = {conversationId: "one", body: "hello"};
// @ts-expect-error body is text
const wrongBody: Args<typeof api.messages.send> = {...send, body: 123};
declare const messages: Result<typeof api.messages.thread>;
const author: Principal = messages[0]!.authorId;
const body: string | null | undefined = messages[0]!.body;
// @ts-expect-error an authority principal is not a Boolean
const wrongAuthor: boolean = messages[0]!.authorId;
// @ts-expect-error generated query rows retain numeric timestamps
const wrongTime: string = messages[0]!.at;
void [send, missing, wrongBody, author, body, wrongAuthor, wrongTime];\n`);
  const program = ts.createProgram([consumer, declaration], {
    noEmit: true, strict: true, skipLibCheck: false, types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { "snapback3": [resolve(dist, "index.d.ts")], "snapback3/client": [contract] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
});

test("TypeScript effect checking survives the Rolldown package boundary", async t => {
  const root = await temporary(t);
  await cp(chat, root, { recursive: true });
  const source = resolve(root, "snapback/delivery.ts");
  await writeFile(source, (await readFile(source, "utf8")).replace(
    'method: requestDefaults.method,', 'method: 42,'));
  const invalid = await compileProject(root);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.diagnostics.some(item => item.code === "E_EFFECT_TYPE"));
});

// @ref LLP 1023.001#read-rule-comparison-diagnostic-follow-up — write preconditions cannot replace read or channel authorization.
test("comparison advice preserves read authority and distinguishes write preconditions", async t => {
  const root = await temporary(t);
  await mkdir(resolve(root, "snapback"));
  const schema = resolve(root, "snapback/schema.q");
  for (const op of ["<", "<=", ">", ">="]) {
    for (const effect of ["read", "insert", "update", "delete"]) {
      await writeFile(schema, `table rows:\n  owner: principal\n  expiresAt: time ?\n  ${effect} <- .owner = viewer and (.expiresAt = null or .expiresAt ${op} now)\n`);
      const result = await compileProject(root);
      assert.equal(result.ok, false, `${effect} ${op} unexpectedly compiled`);
      assert.equal(result.diagnostics.length, 1, JSON.stringify(result));
      const diagnostic = result.diagnostics[0];
      assert.equal(diagnostic.code, "E_QUARRY_UNKNOWN");
      assert.equal(diagnostic.family, "quarry");
      assert.match(diagnostic.site, /^snapback\/schema.q:4:/);
      assert.ok(diagnostic.message.includes(`rule vocabulary has eq/ne but not ${op}`));
      if (effect === "read") {
        assert.match(diagnostic.rewrite, /preserve this rule's authorization/);
        assert.match(diagnostic.rewrite, /not an automatic equivalent rewrite/);
        assert.doesNotMatch(diagnostic.rewrite, /move the bounded comparison/);
      } else {
        assert.match(diagnostic.rewrite, /move the bounded comparison into a mutation require/);
      }
    }
  }
  await writeFile(schema, "table rows:\n  owner: principal\n  value: int\n  read <- .owner = viewer\n  insert <- .owner = viewer\n");
  await writeFile(resolve(root, "snapback/rows.q"), "mutation add(value: int):\n  require value > 0 else POSITIVE_REQUIRED\n  return insert rows { owner: viewer, value }\n");
  const supported = await compileProject(root);
  assert.equal(supported.ok, true, JSON.stringify(supported));
  assert.ok(supported.project.programs[0].body.some(statement => typeof statement === "object" && "Require" in statement));
});

test("comparison advice preserves channel authority before runtime admission", async t => {
  const root = await temporary(t);
  await mkdir(resolve(root, "snapback"));
  for (const op of ["<", "<=", ">", ">="]) {
    for (const effect of ["publish", "subscribe"]) {
      await writeFile(resolve(root, "snapback/schema.q"), `table rows:\n  value: bool\n  public\n\nchannel activity(owner: principal, deadline: time):\n  value: { active: bool }\n  publish <- ${effect === "publish" ? `owner = viewer and deadline ${op} now` : "owner = viewer"}\n  subscribe <- ${effect === "subscribe" ? `owner = viewer and deadline ${op} now` : "owner = viewer"}\n  ttl 5s\n`);
      const result = await compileProject(root);
      assert.equal(result.ok, false);
      assert.equal(result.diagnostics.length, 1, JSON.stringify(result));
      const diagnostic = result.diagnostics[0];
      assert.equal(diagnostic.code, "E_QUARRY_UNKNOWN");
      assert.equal(diagnostic.family, "quarry");
      assert.ok(diagnostic.site.startsWith(`snapback/schema.q:${effect === "publish" ? 7 : 8}:`));
      assert.ok(diagnostic.message.includes(`rule vocabulary has eq/ne but not ${op}`));
      assert.match(diagnostic.rewrite, /preserve this rule's authorization/);
      assert.match(diagnostic.rewrite, /not an automatic equivalent rewrite/);
      assert.doesNotMatch(diagnostic.rewrite, /move the bounded comparison/);
    }
  }
});
