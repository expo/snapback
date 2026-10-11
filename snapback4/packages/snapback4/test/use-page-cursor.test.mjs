// usePage supplies the cursor itself, so its query must take `c`; a query that
// does not names that contract in its type error instead of a bare mismatch.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("usePage accepts queries with a `c` cursor and names the contract otherwise", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "sb4-use-page-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const file = join(scratch, "pages.tsx");
  writeFileSync(file, `import { usePage } from "snapback4/react";
import type { Cursor, Query } from "snapback4/contract";
declare const noCursor: Query<{ drive: string }, { id: string }[]>;
declare const renamed: Query<{ drive: string; cursor?: Cursor | null }, { id: string }[]>;
declare const paged: Query<{ drive: string; c?: Cursor | null }, { id: string }[]>;
declare const bare: Query<{ c?: Cursor | null }, { id: string }[]>;
export function Bad() { usePage(noCursor, { drive: "x" }); usePage(renamed, { drive: "x" }); return null; }
export function Good() { const page = usePage(paged, { drive: "x" }); usePage(bare, {}); const id: string | undefined = page.items[0]?.id; return id ?? null; }
`);
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  Object.assign(options, { noEmit: true, baseUrl: root, paths: { "snapback4/*": ["src/*"], "react": ["node_modules/@types/react/index.d.ts"], "react/*": ["node_modules/@types/react/*"] } });
  const program = ts.createProgram([file], options);
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === file).map(d => ({ line: d.file.getLineAndCharacterOfPosition(d.start).line + 1, text: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  assert.deepEqual(errors.map(e => e.line), [7, 7], JSON.stringify(errors, null, 2));
  for (const { text } of errors) assert.match(text, /usePage needs a query that declares `c: cursor \?` and reads `after c`; see `snapback4 guide reads`/);
});
