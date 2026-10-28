// @ref LLP 3000.037.000#12-repeat-command-output-budgets-tok2 — complete proof receipts stay off the default terminal path.
import { constants, lstatSync, mkdirSync, chmodSync, openSync, closeSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServeCheckReport } from "./proof-serve-check.js";

/** Print a bounded proof verdict; --json preserves the complete receipt.
 * @throws invalid command name, or terminal output failure. Detail-file failures print the complete receipt. */
export function printProofReport(command: string, report: ServeCheckReport, args: readonly string[] = process.argv.slice(2)): void {
  if (args.includes("--json")) { console.log(JSON.stringify(report)); return; }
  if (!/^[a-z][a-z0-9:-]*$/.test(command)) throw Error("invalid proof report command");
  const text = JSON.stringify(report, null, 2) + "\n";
  const path = join(".snapback4", "last", `${command.replaceAll(":", "-")}.txt`);
  try {
    for (const directory of [".snapback4", join(".snapback4", "last")]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("detail directory must be a real directory");
      chmodSync(directory, 0o700);
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeFileSync(fd, text); } finally { closeSync(fd); }
    try { renameSync(temporary, path); } finally { try { unlinkSync(temporary); } catch {} }
  } catch (error) {
    console.log(text.trimEnd());
    console.error(`${command}: details unavailable: ${String(error)}; complete receipt shown`);
    return;
  }
  if (args.includes("--verbose") || args.includes("--explain")) { console.log(text.trimEnd()); return; }
  console.log(`${command}: ${report.ok ? "passed" : "FAIL"}; ready ${report.ready}; observed ${report.upMs}ms; store lock ${report.lockReleased ? "released" : "NOT released"}${report.commandCode === undefined ? "" : `; command exit ${report.commandCode}`}`);
  if (report.failures.length) console.log(report.failures.map(f => `${f.code}: ${f.message.replaceAll("\n", " ")}`).join("; "));
  console.log(`details: ${path}; --explain for the complete receipt`);
}
