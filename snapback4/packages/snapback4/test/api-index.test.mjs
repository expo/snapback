// `guide api` is a hand-written index of the package's subpaths (wave 3, LLP
// 3000.037: builders grepped dist/*.d.ts for signatures). This keeps it true:
// every subpath has a row, every name it lists is exported there, and every
// exported function or value appears somewhere on the card. When an export is
// added, this test names the row to extend.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dirname, "..");
const card = readFileSync(join(root, "../../crates/snapback4-lang/src/guide/api.md"), "utf8");
const subpaths = Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports).map(key => key.slice(2));
const entry = sub => [".ts", ".tsx"].map(ext => join(root, "src", sub + ext)).find(existsSync);

function exportsBySubpath() {
  const files = subpaths.map(entry);
  const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, allowImportingTsExtensions: true,
    noEmit: true, skipLibCheck: true, paths: { "#fetch": ["./src/default-fetch.ts"] }, baseUrl: root });
  const checker = program.getTypeChecker();
  return new Map(subpaths.map((sub, index) => {
    const source = program.getSourceFile(files[index]);
    const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
    const values = symbols.filter(symbol => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return target.flags & ts.SymbolFlags.Value;
    }).map(symbol => symbol.name);
    return [sub, { all: new Set(symbols.map(symbol => symbol.name)), values }];
  }));
}

test("guide api has a row for every subpath, and each name it lists is exported there", () => {
  const exported = exportsBySubpath();
  const rows = new Map(card.split("\n").filter(line => line.startsWith("| `snapback4/"))
    .map(line => line.split("|").map(cell => cell.trim())).map(cells => [cells[1].replaceAll("`", "").slice("snapback4/".length), cells]));
  for (const sub of subpaths) {
    const row = rows.get(sub);
    assert.ok(row, `guide api has no row for snapback4/${sub}`);
    const names = [...`${row[3]} ${row[4]}`.matchAll(/`([A-Za-z_]\w*)`/g)].map(match => match[1]);
    assert.ok(names.length > 0, `snapback4/${sub}: the row names no export`);
    for (const name of names) assert.ok(exported.get(sub).all.has(name), `guide api lists ${name} under snapback4/${sub}, which does not export it`);
  }
  assert.deepEqual([...rows.keys()].filter(sub => !subpaths.includes(sub)), [], "rows for subpaths the package does not export");
  for (const [sub, { values }] of exported) {
    for (const name of values) assert.ok(card.includes(`\`${name}\``), `snapback4/${sub} exports ${name}; add it to its row in crates/snapback4-lang/src/guide/api.md`);
  }
});

test("guide api's Expo names are the Expo package's exports", () => {
  const expo = join(root, "../snapback4-expo/src");
  const source = ["index.ts", "witness.ts"].map(name => readFileSync(join(expo, name), "utf8")).join("\n");
  for (const name of ["nativeDevice", "nativeAvailable", "smokeOrigin"]) {
    assert.ok(card.includes(`\`${name}\``), name);
    assert.match(source, new RegExp(`export (?:async )?(?:function|const) ${name}\\b`), name);
  }
});
