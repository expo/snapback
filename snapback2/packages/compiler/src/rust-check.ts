import { existsSync } from "node:fs";
import type { Program } from "./ir";

export type RustCheckResult = {
  program: string;
  certificate: Record<string, unknown> | null;
  error: { code: string; family: string; message: string; site: string; rewrite: string; guide: string } | null;
};

export function rustCheck(
  programs: Program[],
  schemaMode: "spike" | "synthetic" = "spike",
  schema?: Record<string, unknown>,
  ceilings?: Record<string, number>,
): RustCheckResult[] {
  const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
  // Prefer the prebuilt debug binary: `cargo run` per check costs seconds of lock/probe
  // overhead and rebuilds whenever a differently-featured build last touched target/.
  const prebuilt = `${crate}target/debug/snapback2`;
  const cmd = existsSync(prebuilt)
    ? [prebuilt, "check", "--ir", "--json"]
    : ["cargo", "run", "--quiet", "-p", "snapback2", "--", "check", "--ir", "--json"];
  const process = Bun.spawnSync({
    cmd,
    cwd: crate,
    stdin: new TextEncoder().encode(JSON.stringify({ programs, schemaMode, schema, ceilings })),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (process.exitCode !== 0 && process.exitCode !== 1) {
    throw new Error(`Rust checker failed: ${new TextDecoder().decode(process.stderr)}`);
  }
  const output = JSON.parse(new TextDecoder().decode(process.stdout)) as { results: RustCheckResult[] };
  return output.results;
}
