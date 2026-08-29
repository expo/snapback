import { lowerSource } from "./compiler";
import { rustCheck } from "./rust-check";

const input = Bun.argv[2];
if (!input) {
  console.error("usage: bun src/cli.ts <module.ts> [--synthetic-schema]");
  Bun.exit(2);
}
const source = await Bun.file(input).text();
const libText = await Bun.file(new URL("../lib.d.ts", import.meta.url)).text();
const lowered = lowerSource(source, input, libText);
if (!lowered.ok) {
  console.log(JSON.stringify(lowered, null, 2));
  Bun.exit(1);
  throw new Error("unreachable");
}
const schemaMode = Bun.argv.includes("--synthetic-schema") ? "synthetic" : "spike";
const checked = rustCheck(lowered.programs, schemaMode);
console.log(JSON.stringify({ ...lowered, checked }, null, 2));
if (checked.some((result) => result.error !== null)) Bun.exit(1);
