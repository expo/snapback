import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

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
  const readme = read(join(root, "README.md"));
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
    "expo-secure-store": [expoRequire.resolve("expo-secure-store/build/SecureStore.d.ts")],
  } });
  const program = ts.createProgram([...blocks.map(b => b.file), ...publicSources.map(s => s.path)], options);
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
