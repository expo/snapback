// Guide assets are deliberately outside application source; ordinary init emits none.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = new URL("../../../crates/snapback4/src/verbs/init/starter/production/", import.meta.url);
const target = new URL("../dist/recipes/production/", import.meta.url);
for (const kind of ["web", "expo"]) {
  const dir = new URL(kind + "/", target); mkdirSync(dir, { recursive: true });
  for (const [from, to] of [["schema.q", "schema.q"], ["test.cases.jsonl", "test.cases.jsonl"], [kind + "-app.tsx", "App.tsx"], [kind + "-client.ts", "client.ts"]]) {
    const text = readFileSync(new URL(from, source), "utf8").split("\n").filter(line => !line.includes("@" + "ref LLP")).join("\n");
    writeFileSync(fileURLToPath(new URL(to, dir)), text);
  }
}
