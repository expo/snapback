import type { Program } from "./ir";

export type RustCheckResult = {
  program: string;
  certificate: Record<string, unknown> | null;
  error: { family: string; message: string; rewrite: string } | null;
};

export function rustCheck(
  programs: Program[],
  schemaMode: "spike" | "synthetic" = "spike",
): RustCheckResult[] {
  const crate = decodeURIComponent(new URL("../../", import.meta.url).pathname);
  const process = Bun.spawnSync({
    cmd: ["cargo", "run", "--quiet", "--bin", "check"],
    cwd: crate,
    stdin: new TextEncoder().encode(JSON.stringify({ programs, schemaMode })),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (process.exitCode !== 0) {
    throw new Error(`Rust checker failed: ${new TextDecoder().decode(process.stderr)}`);
  }
  const output = JSON.parse(new TextDecoder().decode(process.stdout)) as { results: RustCheckResult[] };
  return output.results;
}
