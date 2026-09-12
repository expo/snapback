import { readFile, writeFile } from "node:fs/promises";

const [input = "config/windows.json", output = "snapback/config.q"] = process.argv.slice(2);
const config = JSON.parse(await readFile(input, "utf8"));
const lines = Object.entries(config).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a Quarry identifier with an i53 integer value`);
  }
  return `fn ${name}(): ${value}`;
});
if (lines.length === 0) throw new TypeError("window config must contain at least one integer");
await writeFile(output, `-- generated from ${input}; rerun this recipe after config changes\n${lines.join("\n")}\n`);
