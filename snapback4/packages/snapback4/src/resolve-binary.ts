// One resolver for the CLI shim and the Node device opener.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function resolveBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const platform = `snapback4-${process.platform}-${process.arch}`;
  const candidates: string[] = [];
  if (process.env.SNAPBACK4_BIN) candidates.push(resolve(process.env.SNAPBACK4_BIN));
  try { candidates.push(join(dirname(require.resolve(`${platform}/package.json`)), "snapback4")); } catch { /* not installed for this platform */ }
  candidates.push(resolve(here, "../../../target/release/snapback4"), resolve(here, "../../../target/debug/snapback4"));
  const binary = candidates.find((path) => existsSync(path));
  if (!binary) throw new Error(`snapback4: no binary for ${process.platform}-${process.arch}. Packages exist for darwin-arm64; elsewhere, build with \`cargo build --release -p snapback4\` and set SNAPBACK4_BIN.`);
  return binary;
}
