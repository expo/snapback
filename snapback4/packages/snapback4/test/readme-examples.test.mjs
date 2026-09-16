import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(path, "utf8");
const pkg = JSON.parse(read(join(root, "package.json")));
const publicSources = Object.entries(pkg.exports).filter(([key]) => key !== "./contract").map(([key, value]) => {
  const stem = value.types.replace("./dist/", "src/").replace(/\.d\.ts$/, "");
  return { key, path: join(root, stem + (key === "./react" ? ".tsx" : ".ts")) };
});

// Each block is a separate module: no ambient client/api/any can hide a broken example.
// The generated module stands for the app's schema; package imports always reach real source.
const apiStub = `import type { Query, Mutation, Action, Cursor } from "snapback4/contract";
type Message = { id: string; body: string | null; photo?: { id: string } | null };
export declare const api: {
  handleAvailable: Query<{ handle: string }, boolean>;
  myProfile: Query<{}, { id: string; principal: string; handle: string } | null>;
  createProfile: Mutation<{ handle: string }, { id: string; principal: string; handle: string }>;
  thread: Query<{ conversationId: string; c?: Cursor | null }, Message[]>;
  inbox: Query<{ c?: Cursor | null }, { conversationId: string }[]>;
  send: Mutation<{ conversationId: string; body: string }, { id: string }>;
  sendPhoto: Mutation<{ conversationId: string; photo: { id: string } }, { id: string }>;
  invite: Action<{ email: string }, { principal: string }>;
  social: { follow: Mutation<{ principal: string }, null> };
};\n`;

test("README TypeScript examples compile and call every public function", (t) => {
  const started = performance.now();
  const scratch = mkdtempSync(join(root, ".readme-examples-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  mkdirSync(join(scratch, "src"));
  mkdirSync(join(scratch, "snapback/generated"), { recursive: true });
  writeFileSync(join(scratch, "snapback/generated/api.ts"), apiStub);
  const readme = ["README.md", "CLIENT-AND-OPERATIONS.md"].map(name => read(join(root, name))).join("\n");
  const blocks = [...readme.matchAll(/^```(tsx?)\s*\n([\s\S]*?)^```\s*$/gm)].map((match, index) => {
    const line = readme.slice(0, match.index).split("\n").length + 1;
    const file = join(scratch, "src", `block-${index + 1}.${match[1]}`);
    writeFileSync(file, match[2] + "\nexport {};\n");
    return { file, line, text: match[2] };
  });
  assert.ok(blocks.length, "README has fenced TypeScript examples");
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.deepEqual(errors, []);
  const expoRequire = createRequire(join(root, "../../apps/chat-expo/package.json"));
  Object.assign(options, { baseUrl: root, paths: {
    "snapback4/*": ["src/*"],
    "react": ["node_modules/@types/react/index.d.ts"],
    "react/*": ["node_modules/@types/react/*"],
    "snapback4-expo": ["../snapback4-expo/src/index.ts"],
    "snapback4-expo/witness": ["../snapback4-expo/src/witness.ts"],
    "expo-secure-store": [expoRequire.resolve("expo-secure-store/build/SecureStore.d.ts")],
  } });
  const program = ts.createProgram([...blocks.map(b => b.file), ...publicSources.map(s => s.path), join(root, "test/fixtures/client-card.tsx")], options);
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
    const block = blocks.find(b => b.file === d.file?.fileName);
    const at = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    const location = block ? `README.md:${block.line + (at?.line ?? 0)} (block starts at ${block.line})` : d.file?.fileName ?? "tsconfig";
    return `${location}: TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
  });
  const unalias = (symbol) => symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const calls = new Set();
  for (const block of blocks) {
    const visit = (node) => {
      if (ts.isCallExpression(node)) calls.add(unalias(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression)));
      ts.forEachChild(node, visit);
    };
    visit(program.getSourceFile(block.file));
  }
  const functions = publicSources.flatMap(({ key, path }) => {
    const source = program.getSourceFile(path);
    return checker.getExportsOfModule(checker.getSymbolAtLocation(source)).flatMap(symbol => {
      const value = unalias(symbol);
      return checker.getTypeOfSymbolAtLocation(value, source).getCallSignatures().length ? [{ name: `${key.slice(2)}.${symbol.name}`, symbol: value }] : [];
    });
  });
  const missing = functions.filter(f => !calls.has(f.symbol)).map(f => f.name);
  t.diagnostic(`${blocks.length} README blocks; ${functions.length} public functions; ${(performance.now() - started).toFixed(2)} ms`);
  assert.deepEqual([...diagnostics, ...missing.map(name => `${name} needs a call in a README ts/tsx block`)], []);
});

test("R1a Queries lists matching merges over scope lanes", () => {
  const queries = (["README.md", "CLIENT-AND-OPERATIONS.md"].map(name => read(join(root, name))).join("\n").split("- **Reads:")[1]?.split("- **")[0] ?? "").replace(/\s+/g, " ");
  assert.ok(queries.includes("merge t matching q [after c] last N by wordsIndex:"), "Queries must spell the matching merge");
  assert.ok(queries.includes("scope lanes"));
});

test("Expo Go README session store normalizes SecureStore keys and round-trips a session", async () => {
  const readme = ["README.md", "CLIENT-AND-OPERATIONS.md"].map(name => read(join(root, name))).join("\n");
  const source = readme.match(/const sessionStore = [\s\S]*?;/)?.[0];
  assert.ok(source, "README declares its SecureStore adapter");
  const values = new Map();
  const keys = [];
  const valid = (key) => { assert.match(key, /^[A-Za-z0-9._-]+$/); keys.push(key); };
  const SecureStore = {
    async getItemAsync(key) { valid(key); return values.get(key) ?? null; },
    async setItemAsync(key, value) { valid(key); values.set(key, value); },
    async deleteItemAsync(key) { valid(key); values.delete(key); },
  };
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  const store = new Function("SecureStore", `${js}\nreturn sessionStore;`)(SecureStore);
  const key = "snapback4:session:http://127.0.0.1:4400";
  await store.set(key, "saved-session");
  assert.equal(await store.get(key), "saved-session");
  await store.delete(key);
  assert.equal(await store.get(key), null);
  assert.deepEqual(keys, Array(4).fill("snapback4_session_http___127.0.0.1_4400"));
});


test("W9a expiry client form drops deadlines locally and keeps null lifetimes", () => {
  const paths = ["../../crates/snapback4-lang/src/guide.rs", "../../crates/snapback4-lang/src/guide/reads.rs", "CLIENT-AND-OPERATIONS.md"];
  for (const path of paths) {
    const source = read(join(root, path)).match(/const paint = [^\n]+\n\s*paint\(\); const timers = [^\n]+/)?.[0];
    assert.ok(source, `${path}: two-line expiry client form`);
    let now = 1000;
    const rows = [{ id: "kept", expiresAt: null }, { id: "due", expiresAt: 1000 }, { id: "later", expiresAt: 1100 }];
    const painted = [];
    const timers = [];
    runInNewContext(source, {
      rows, render: visible => painted.push(Array.from(visible, row => row.id)), Date: { now: () => now },
      setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    });
    assert.deepEqual(painted, [["kept", "later"]]);
    assert.deepEqual(timers.map(timer => timer.delay), [0, 100]);
    now = 1100;
    timers[1].fn();
    assert.deepEqual(painted.at(-1), ["kept"]);
    assert.equal(rows.length, 3, "the received answer stays intact; rendering drops the expired row");
  }
});
