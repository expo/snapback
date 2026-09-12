import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { compileProject, lowerSeed, type FrontendDiagnostic, type ProjectResult } from "../compiler.js";
import { createOwnerServer } from "./http.js";
import { findWorker, OwnerError, WorkerClient } from "./worker.js";

const executeFile = promisify(execFile);
type Compiled = Extract<ProjectResult, { ok: true }>;
type Seed = Extract<Awaited<ReturnType<typeof lowerSeed>>, { ok: true }>['seed'];

function workerProject(project: Compiled["project"]) {
  return { version: 1, ...project, auth: project.schema.auth ?? { password: false, guests: false } };
}

export class CompilationError extends OwnerError {
  constructor(readonly diagnostics: readonly FrontendDiagnostic[]) {
    super("S3_COMPILE", diagnostics.map(diagnostic => `${diagnostic.code} ${diagnostic.site}: ${diagnostic.message}\n${diagnostic.rewrite}`).join("\n\n"));
  }
}

async function compile(root: string, includeSeed: boolean): Promise<{ compiled: Compiled; seed?: Seed }> {
  const compiled = await compileProject(root);
  if (!compiled.ok) throw new CompilationError(compiled.diagnostics);
  if (!includeSeed) return { compiled };
  const seed = await lowerSeed(root);
  if (!seed.ok) throw new CompilationError(seed.diagnostics);
  return { compiled, seed: seed.seed };
}

async function atomicWrite(path: string, source: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, source, { mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

export async function certifyArtifact(worker: string, path: string): Promise<Record<string, unknown>> {
  try {
    const result = await executeFile(worker, ["--project", path, "--check"], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    const report = JSON.parse(result.stdout);
    if (!report || typeof report !== "object" || report.ok !== true) throw new OwnerError("S3_CHECK", "The worker returned an invalid certification report.");
    return report;
  } catch (error) {
    if (error instanceof OwnerError) throw error;
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    let detail = failure.stderr?.trim() || failure.stdout?.trim();
    if (detail && detail.length > 16_384) detail = detail.slice(0, 16_384);
    throw new OwnerError("S3_CHECK", detail || failure.message || "The worker could not certify this project.");
  }
}

async function buildDirectory(root: string): Promise<string> {
  const directory = join(root, ".snapback3", "build");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export async function checkProject(projectRoot: string): Promise<Record<string, unknown>> {
  const root = resolve(projectRoot), worker = findWorker(root);
  const { compiled } = await compile(root, true);
  const directory = await buildDirectory(root);
  const candidate = join(directory, `check-${process.pid}-${randomUUID()}.json`);
  try {
    await writeFile(candidate, JSON.stringify(workerProject(compiled.project)), { mode: 0o600 });
    const report = await certifyArtifact(worker, candidate);
    await atomicWrite(join(directory, "project.json"), JSON.stringify(workerProject(compiled.project)));
    await atomicWrite(join(directory, "api.d.ts"), compiled.apiDts);
    return { ...report, root, compileMs: compiled.ms };
  } finally { await rm(candidate, { force: true }); }
}

export interface StartOptions {
  root: string;
  dev: boolean;
  host?: string;
  port?: number;
  origins?: string[];
  log?: (message: string) => void;
}

// @ref LLP 2000#9-a-parallel-implementation-with-clear-boundaries — each application owns its S3 artifacts, database, URL and process identity.
export async function startProject(options: StartOptions) {
  const root = resolve(options.root), log = options.log ?? console.error;
  const executable = findWorker(root);
  const { compiled, seed } = await compile(root, options.dev);
  const directory = await buildDirectory(root);
  // check may run while dev serves: its compilation artifact is separate from
  // the last accepted generation used by a restarted worker.
  // Each owner keeps its own restart artifact. A second attempted start may
  // fail to acquire SQLite; it must not change the first owner's recovery code.
  const ownerId = `${process.pid}-${randomUUID()}`;
  const artifact = join(directory, `runtime-${ownerId}.json`);
  const seedPath = join(directory, `seed-${ownerId}.json`);
  const candidate = join(directory, `start-${process.pid}-${randomUUID()}.json`);
  try {
    await writeFile(candidate, JSON.stringify(workerProject(compiled.project)), { mode: 0o600 });
    await certifyArtifact(executable, candidate);
    await atomicWrite(artifact, JSON.stringify(workerProject(compiled.project)));
    await atomicWrite(join(directory, "project.json"), JSON.stringify(workerProject(compiled.project)));
    await atomicWrite(join(directory, "api.d.ts"), compiled.apiDts);
  } catch (error) {
    await rm(artifact, { force: true });
    throw error;
  } finally { await rm(candidate, { force: true }); }
  const workerArgs = ["--project", artifact, "--database", join(root, ".snapback3", "store.sqlite")];
  if (options.dev) workerArgs.push("--dev");
  if (seed) {
    await atomicWrite(seedPath, JSON.stringify(seed)); workerArgs.push("--seed", seedPath);
  }
  let http: ReturnType<typeof createOwnerServer> | undefined;
  const worker = new WorkerClient({
    command: executable, args: workerArgs, cwd: root,
    onStderr: message => process.stderr.write(message),
    onUnavailable: error => { log(`${error.code}: ${error.message}`); http?.closeStreams(); },
  });
  let watcher: FSWatcher | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let updating = false;
  let again = false;
  let url = "";
  const metadata = join(root, ".snapback3", "dev.json");
  const close = () => closing ??= (async () => {
    closed = true; watcher?.close(); clearTimeout(debounce);
    await Promise.all([http?.close(), worker.close()]);
    await Promise.all([rm(artifact, { force: true }), rm(seedPath, { force: true })]);
    if (options.dev) {
      try {
        const state = JSON.parse(await readFile(metadata, "utf8"));
        if (state.pid === process.pid && state.url === url) await rm(metadata, { force: true });
      } catch { /* Another owner or no state: there is nothing of ours to remove. */ }
    }
  })();

  const reload = async () => {
    if (closed) return;
    if (updating) { again = true; return; }
    updating = true;
    try {
      do {
        again = false;
        let installed = false;
        try {
          const next = await compile(root, true);
          if (closed) return;
          const response = await worker.request<Record<string, unknown>>("project", { project: workerProject(next.compiled.project) });
          installed = true;
          // The durable authority has already changed. Notify readers even if
          // an unrelated artifact write now fails; old policy cannot stay fresh.
          http?.invalidate({ generation: response.generation, seq: response.seq });
          await atomicWrite(artifact, JSON.stringify(workerProject(next.compiled.project)));
          await atomicWrite(join(directory, "project.json"), JSON.stringify(workerProject(next.compiled.project)));
          await atomicWrite(join(directory, "api.d.ts"), next.compiled.apiDts);
          log("Snapback 3 updated; existing data is preserved.");
        } catch (error) {
          log(`${errorMessage(error)}\n${installed
            ? "The new generation was installed, but its build files could not be saved. Repair the project directory before restarting."
            : "The previous generation is still serving."}`);
        }
      } while (again && !closed);
    } finally { updating = false; }
  };

  try {
    await worker.request("health");
    http = createOwnerServer({ worker, root, dev: options.dev, origins: options.origins, log });
    const host = options.host ?? "127.0.0.1";
    await new Promise<void>((done, reject) => {
      const failed = (error: Error) => reject(error);
      http!.server.once("error", failed);
      http!.server.listen(options.port ?? 4383, host, () => { http!.server.off("error", failed); done(); });
    });
    const address = http.server.address();
    if (!address || typeof address === "string") throw new OwnerError("S3_LISTEN", "The server did not receive a TCP address.");
    const localHost = ["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
    url = `http://${localHost}:${address.port}`;
    if (options.dev) {
      await atomicWrite(metadata, JSON.stringify({ pid: process.pid, url, root }));
      watcher = watch(join(root, "snapback"), { recursive: true }, (_event, filename) => {
        if (filename && !/\.(q|ts)$/.test(String(filename))) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => { void reload(); }, 100);
      });
      watcher.on("error", error => log(`S3_WATCH: ${error.message}. Restart dev to resume watching.`));
    }
    return { url, root, worker, server: http.server, close };
  } catch (error) { await close(); throw error; }
}

export function errorMessage(error: unknown): string {
  if (error instanceof OwnerError) return error.message.startsWith(`${error.code}:`) ? error.message : `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
