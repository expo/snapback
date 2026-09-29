import { existence } from "../dist/contract.js";
import { readyRead } from "../dist/read-existence.js";
import { sessionKey } from "../dist/auth.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
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
const apiStub = `import type { Query, Mutation, Ephemeral, Action, Cursor } from "snapback4/contract";
import type { OidcTransactionOperations } from "snapback4/identity";
type Message = { id: string; body: string | null; photo?: { id: string } | null };
export declare const api: {
  myMembership: Query<{ conversationId: string }, { id: string } | null>;
  members: Query<{ conversationId: string }, { id: string }[]>;
  inboxCards: Query<{ c?: Cursor | null }, { id: string; title: string; memberCount: number }[]>;
  messagePhoto: Query<{ id: string }, { photo: { id: string } | null; tombstone: boolean; expiresAt: number | null } | null>;
  setTyping: Ephemeral<{ room: string }, null>;
  stopTyping: Ephemeral<{ room: string }, null>;
  typingIn: Query<{ room: string }, { principal: string }[]>;
  handleAvailable: Query<{ handle: string }, boolean>;
  myProfile: Query<{}, { id: string; principal: string; handle: string } | null>;
  createProfile: Mutation<{ handle: string }, { id: string; principal: string; handle: string }>;
  thread: Query<{ conversationId: string; c?: Cursor | null }, Message[]>;
  inbox: Query<{ c?: Cursor | null }, { conversationId: string }[]>;
  send: Mutation<{ conversationId: string; body: string }, { id: string }>;
  sendPhoto: Mutation<{ conversationId: string; photo: { id: string } }, { id: string }>;
  invite: Action<{ email: string }, { principal: string }>;
  social: { follow: Mutation<{ principal: string }, null> };
  identityByInvocation: OidcTransactionOperations["byInvocation"];
  identityByState: OidcTransactionOperations["byState"];
  identityBegin: OidcTransactionOperations["begin"];
  identityClaim: OidcTransactionOperations["claim"];
  identityVerified: OidcTransactionOperations["verified"];
  documentAt: Query<{ doc: string; revision: number }, { text: string }>;
  saveSummary: Mutation<{ doc: string; revision: number; text: string }, unknown>;
  applyBillingEvent: Mutation<unknown, unknown>;
};\n`;
const serverStub = `import type { OidcBeginArguments, OidcBeginResult, OidcCompleteArguments, OidcSession } from "snapback4/identity";
import type { RouteRequest, ServerContext, VerificationContext } from "snapback4/server";
import type { Worker } from "snapback4/worker";
type MaybePromise<T> = T | Promise<T>;
export declare const manifest: import("snapback4/server").ServerManifest;
export declare function server(handlers: {
  actions?: {
    beginOidc?: (args: OidcBeginArguments, ctx: ServerContext<"OIDC_CLIENT_SECRET">) => MaybePromise<OidcBeginResult>;
    completeOidc?: (args: OidcCompleteArguments, ctx: ServerContext<"OIDC_CLIENT_SECRET">) => MaybePromise<OidcSession>;
    summarize?: (args: { doc: string; revision: number }, ctx: ServerContext) => MaybePromise<{ saved: boolean }>;
  };
  routes?: {
    reportDownload?: (req: RouteRequest, ctx: ServerContext) => MaybePromise<Response>;
    billingHook?: {
      verify(req: RouteRequest, ctx: VerificationContext<"BILLING_KEY">): MaybePromise<boolean>;
      handle(req: RouteRequest, ctx: ServerContext<"BILLING_KEY">): MaybePromise<Response>;
    };
  };
}): Worker;\n`;

test("README TypeScript examples compile and call every public function", (t) => {
  const started = performance.now();
  const scratch = mkdtempSync(join(root, ".readme-examples-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  mkdirSync(join(scratch, "src"));
  mkdirSync(join(scratch, "snapback/generated"), { recursive: true });
  mkdirSync(join(scratch, "src/generated"), { recursive: true });
  writeFileSync(join(scratch, "snapback/generated/api.ts"), apiStub);
  writeFileSync(join(scratch, "src/generated/api.ts"), apiStub);
  writeFileSync(join(scratch, "snapback/generated/server.ts"), serverStub);
  writeFileSync(join(scratch, "src/generated/server.ts"), serverStub);
  // The orientation modules compile together against their generated API in first-account.test.mjs.
  const readme = ["CLIENT-AND-OPERATIONS.md", "SERVER.md", "../../crates/snapback4-lang/src/guide/client.md", "../../crates/snapback4-lang/src/guide/offline_interactions.md"].map(name => read(join(root, name))).join("\n");
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

test("Queries teach predicate reads and engine-chosen scope lanes", () => {
  const queries = read(join(root, "../../crates/snapback4-lang/src/guide/reads.rs")).replace(/\s+/g, " ");
  assert.ok(queries.includes("messages where .roomId = roomId"));
  assert.ok(queries.includes("last 20 by .at after c"));
  const why = execFileSync(process.env.SNAPBACK4_BIN ?? join(root, "../../target/debug/snapback4"), ["why", "N_SPARSE_FILTER"], {encoding: "utf8"}).replace(/\s+/g, " ");
  assert.ok(why.includes("the author writes no lane list"));
  assert.ok(read(join(root, "README.md")).includes("`guide reads`"));
});

test("Expo Go README session store preserves encoded SecureStore keys and round-trips a session", async () => {
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
  const key = sessionKey("http://127.0.0.1:4400");
  await store.set(key, "saved-session");
  assert.equal(await store.get(key), "saved-session");
  await store.delete(key);
  assert.equal(await store.get(key), null);
  assert.deepEqual(keys, Array(4).fill(key));
});


// Execute the published hook with a controlled provider clock. React's actual
// subscriptions, replacement deadlines and unmount run in react.test.mjs.
const expiryPaths = ["../../crates/snapback4-lang/src/guide.rs", "../../crates/snapback4-lang/src/guide/reads.rs", "CLIENT-AND-OPERATIONS.md"];
function expiryRecipe(path, clock, deadlines) {
  const source = read(join(root, path)).match(/function useExpiringRows[\s\S]*?\n}/)?.[0];
  assert.ok(source, `${path}: published server-answer hook`);
  return runInNewContext(`${ts.transpile(source, { target: ts.ScriptTarget.ES2022 })}\nuseExpiringRows;`, {
    useClient: () => ({ now: clock }),
    useNow: deadline => { deadlines.push(deadline); return clock(); },
    Date: { now: () => { throw Error("render recipe must use the client's server time"); } },
  });
}

test("W9a expiry client form drops deadlines locally and keeps null lifetimes", () => {
  for (const path of expiryPaths) {
    let now = 1000;
    const deadlines = [], filter = expiryRecipe(path, () => now, deadlines);
    const rows = [{ id: "kept", expiresAt: null }, { id: "due", expiresAt: 1000 }, { id: "later", expiresAt: 1100 }];
    assert.deepEqual(Array.from(filter(rows), row => row.id), ["kept", "later"]);
    assert.deepEqual(deadlines, [1100]);
    now = 1100;
    assert.deepEqual(Array.from(filter(rows), row => row.id), ["kept"]);
    assert.deepEqual(deadlines, [1100, null]);
    assert.equal(rows.length, 3, "the received answer stays intact; rendering drops the expired row");
  }
});

test("W10b typing guidance hides a short-lived server answer before the next answer", () => {
  for (const path of expiryPaths) {
    const text = read(join(root, path));
    assert.match(text, /[Tt]yping/);
    assert.match(text, /[Hh]eld device observations republish/);
    assert.match(text, /[Oo]nly server-answered reads need a render-deadline/);
    let now = 1000;
    const deadlines = [], filter = expiryRecipe(path, () => now, deadlines);
    const rows = [{ principal: "alice", expiresAt: 5500 }];
    assert.deepEqual(Array.from(filter(rows), row => row.principal), ["alice"]);
    assert.deepEqual(deadlines, [5500]);
    now = 5500;
    assert.deepEqual(Array.from(filter(rows), row => row.principal), []);
    assert.equal(rows.length, 1, "no replacement answer or server removal arrived");
  }
});

// Hold custody open while exercising the actual published composer's event handlers.
test("client card composer clears at submit and offers refused text without replacing edits", async () => {
  const source = read(join(root, "../../crates/snapback4-lang/src/guide/client.md"))
    .match(/export function Composer[\s\S]*?\n}/)?.[0];
  assert.ok(source);
  for (const [edited, outcome, expected] of [
    ["", "pending", ""],
    ["", "failed", "hello"],
    ["hello again", "pending", "hello again"],
    ["hello again", "sent", "hello again"],
    ["replacement", "pending", "replacement"],
    ["hello again", "failed", "hello again"],
    ["replacement", "failed", "replacement"],
  ]) {
    let draft = "hello", admit, submitted, saved = "", slot = 0;
    const custody = new Promise(resolve => { admit = resolve; });
    const send = { inFlight: false, last: undefined, run: (args, options) => {
      submitted = { args, options }; send.inFlight = true; return custody;
    } };
    const Composer = runInNewContext(`${ts.transpile(source.replace("export ", ""), {
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
    })}\nComposer;`, {
      api: { send: {}, myMembership: {} }, useMutation: () => send,
      existence, isReady: read => "data" in read, useQuery: () => readyRead({ data: { id: "me" }, complete: true, cut: null, fresh: true }),
      useState: () => slot++ === 0 ? [draft, update => { draft = typeof update === "function" ? update(draft) : update; }] : [saved, update => { saved = typeof update === "function" ? update(saved) : update; }],
      React: { Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props, children }) },
    });
    const render = () => { slot = 0; return Composer({ conversationId: "room" }).children; };
    const [input, button] = render();
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.equal(draft, "", "submit immediately gives the field to the next draft");
    assert.equal(submitted.args.body, "hello");
    assert.equal(submitted.options.waitSeconds, 0);
    assert.equal(render()[1].props.disabled, true);
    input.props.onChange({ target: { value: edited } });
    assert.equal(draft, edited, "draft stays editable before custody");
    send.last = { state: outcome }; admit(send.last);
    await custody;
    await new Promise(resolve => setImmediate(resolve)); // Drain the VM realm's async continuation too.
    send.inFlight = false; send.pending = outcome === "pending";
    assert.equal(draft, expected, `${outcome}: ${edited}`);
    assert.equal(render()[1].props.disabled, false, "pending settlement does not disable Send");
    if (outcome === "failed") {
      const row = render()[2];
      assert.equal(row.children[1], "hello", "saved text is offered on refusal");
      const before = draft;
      row.children.find(child => child?.props?.onClick && child.children[0] === "Edit").props.onClick();
      assert.equal(draft, before ? before + " hello" : "hello", "Edit appends without replacing current typing");
    }
  }
});

test("client card composer disables only denied or fresh non-revalidating absent membership", async () => {
  const source = read(join(root, "../../crates/snapback4-lang/src/guide/client.md"))
    .match(/export function Composer[\s\S]*?\n}/)?.[0];
  assert.ok(source);
  for (const [member, blocked] of [
    [{ loading: true }, false], [{ denied: { message: 'no' } }, true],
    [readyRead({ data: null, complete: true, cut: null, fresh: true }), true],
    [readyRead({ data: null, complete: true, cut: null, fresh: false }), false],
    [readyRead({ data: null, complete: true, cut: null, fresh: true, revalidating: true }), false],
    [readyRead({ data: null, complete: false, cut: null, fresh: true }), false],
    [readyRead({ data: null, complete: true, cut: 'budget', fresh: true }), false],
    [readyRead({ data: { id: 'me' }, complete: true, cut: null, fresh: false, revalidating: true }), false],
  ]) {
    let called = false;
    const Composer = runInNewContext(`${ts.transpile(source.replace("export ", ""), {
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
    })}\nComposer;`, {
      api: { send: {}, myMembership: {} }, existence, isReady: read => "data" in read, useQuery: () => member,
      useState: () => ['hello', () => {}],
      useMutation: () => ({ inFlight: false, run: async () => { called = true; return { state: 'pending' }; } }),
      React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }) },
    });
    const button = Composer({ conversationId: 'room' }).children[1];
    assert.equal(button.props.disabled, blocked, existence(member));
    button.props.onClick();
    assert.equal(called, !blocked, 'the handler guards a stale click too');
  }
});

test("profile screen waits for proven existence and uses each replacement", async () => {
  const source = read(join(root, "CLIENT-AND-OPERATIONS.md")).match(/async function profileScreen[\s\S]*?\n}/)?.[0];
  assert.ok(source);
  const screen = runInNewContext(`${ts.transpile(source, { target: ts.ScriptTarget.ES2022 })}\nprofileScreen;`, { api: { myProfile: {} }, existence });
  for (const [answer, expected] of [
    [{ loading: true }, "loading"],
    [readyRead({ data: null, complete: false, cut: null, fresh: false }), "loading"],
    [{ denied: { message: "unavailable" } }, "error"],
    [readyRead({ data: null, complete: true, cut: null, fresh: true }), "profile"],
    [readyRead({ data: { handle: "alice" }, complete: true, cut: null, fresh: true }), "app"],
    [readyRead({ data: null, complete: true, cut: null, fresh: true }), "profile"],
  ]) assert.equal(await screen({ query: async () => answer }), expected);
});
