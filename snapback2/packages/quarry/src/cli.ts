#!/usr/bin/env bun
import { resolve } from "node:path";
import { compileApp } from "./compiler";
import { formatDiagnostic } from "./diagnostics";

async function main(): Promise<void> {
  const app = process.argv[2];
  if (!app || process.argv.length !== 3) {
    console.error("usage: quarryc <appdir>");
    process.exitCode = 2;
    return;
  }
  const result = await compileApp(resolve(app));
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
    process.exitCode = 1;
    return;
  }
  console.log(`quarryc ok ${result.files.length} files`);
}

await main();
