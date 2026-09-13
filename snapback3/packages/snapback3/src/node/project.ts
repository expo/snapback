import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { compileProject, lowerSeed, type FrontendDiagnostic, type ProjectResult } from "../compiler.js";
import { createOwnerServer } from "./http.js";
import { findWorker, OwnerError, WorkerClient } from "./worker.js";
import { AssetRuntime } from "./assets.js";
import { qualifiedMediaHelper, SubprocessMediaValidator } from "./media.js";
import { BackgroundOwner } from "./background.js";
import { OperatorSurface } from "./operator.js";

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

export async function certifyArtifact(worker: string, path: string, capabilities: readonly string[] = []): Promise<Record<string, unknown>> {
  try {
    const args = ["--project", path, "--check"];
    if (capabilities.length) args.push("--runtime-capabilities", capabilities.join(","));
    const result = await executeFile(worker, args, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
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
  const mediaHelper = await qualifiedMediaHelper(root);
  const capabilities = runtimeCapabilities(mediaHelper);
  const { compiled } = await compile(root, true);
  const directory = await buildDirectory(root);
  const candidate = join(directory, `check-${process.pid}-${randomUUID()}.json`);
  try {
    await writeFile(candidate, JSON.stringify(workerProject(compiled.project)), { mode: 0o600 });
    const report = await certifyArtifact(worker, candidate, capabilities);
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
  /** One-time, explicit adoption path for a legacy store that predates atomic
   * project recovery custody. The worker still applies successor checks. */
  adoptLegacyProject?: boolean;
  /** The presence/channel owner can supply its exact in-memory counts. An
   * empty snapshot keeps restart ordering correct without claiming support. */
  presence?: { snapshot(): Readonly<Record<string, number>> };
}

// @ref LLP 2000#9-a-parallel-implementation-with-clear-boundaries — each application owns its S3 artifacts, database, URL and process identity.
export async function startProject(options: StartOptions) {
  const root = resolve(options.root), log = options.log ?? console.error;
  const executable = findWorker(root);
  const mediaHelper = await qualifiedMediaHelper(root);
  const capabilities = runtimeCapabilities(mediaHelper);
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
    await certifyArtifact(executable, candidate, capabilities);
    await atomicWrite(artifact, JSON.stringify(workerProject(compiled.project)));
    await atomicWrite(join(directory, "project.json"), JSON.stringify(workerProject(compiled.project)));
    await atomicWrite(join(directory, "api.d.ts"), compiled.apiDts);
  } catch (error) {
    await rm(artifact, { force: true });
    throw error;
  } finally { await rm(candidate, { force: true }); }
  const recoveryArgs = ["--database", join(root, ".snapback3", "store.sqlite")];
  if (capabilities.length) recoveryArgs.push("--runtime-capabilities", capabilities.join(","));
  if (options.dev) recoveryArgs.push("--dev");
  const workerArgs = [...recoveryArgs, "--project", artifact, "--accept-project"];
  if (options.adoptLegacyProject) workerArgs.push("--adopt-legacy-project");
  if (seed) {
    await atomicWrite(seedPath, JSON.stringify(seed));
    workerArgs.push("--seed", seedPath);
    recoveryArgs.push("--seed", seedPath);
  }
  let http: ReturnType<typeof createOwnerServer> | undefined;
  let assets: AssetRuntime | undefined;
  let background: BackgroundOwner | undefined;
  let operator: OperatorSurface | undefined;
  const worker = new WorkerClient({
    command: executable, args: workerArgs, restartArgs: recoveryArgs, cwd: root,
    initialize: async (fresh, child) => {
      // Recovery is a fresh-child barrier: unknown provider outcomes and the
      // complete volatile presence snapshot are established before health,
      // HTTP, background, or another ordinary request can reach this child.
      await fresh.request("effect.recover", {});
      await fresh.request("presence.replace", { counts: { ...(options.presence?.snapshot() ?? {}) } });
      const recovered = await fresh.request<Record<string, unknown>>("manifest", {});
      // A replacement child recertifies durable custody before this callback;
      // publish that actual generation before any ordinary read may pass.
      background?.noteCommit({ generation: recovered.generation, seq: recovered.seq });
      if (child.replacement) {
        log(`S3_WORKER_RECOVERED: generation=${String(recovered.generation)} seq=${String(recovered.seq)}`);
      }
    },
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
    // Fence HTTP and each admitted owner immediately, then keep the serial
    // worker alive until their bounded cleanup promises have all settled.
    const failures: unknown[] = [];
    for (const result of await Promise.allSettled([http?.close(), background?.close(), assets?.close()])) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    try { await worker.close(); }
    catch (error) { failures.push(error); }
    for (const result of await Promise.allSettled([rm(artifact, { force: true }), rm(seedPath, { force: true })])) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    if (options.dev) {
      try {
        const state = JSON.parse(await readFile(metadata, "utf8"));
        if (state.pid === process.pid && state.url === url) await rm(metadata, { force: true });
      } catch (error) {
        // Missing or another owner's file is benign; an owned cleanup failure
        // remains observable through the aggregate close promise.
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Snapback 3 owner shutdown did not complete cleanly.");
  })();

  const reload = async () => {
    if (closed) return;
    if (updating) { again = true; return; }
    updating = true;
    try {
      do {
        again = false;
        let next: Awaited<ReturnType<typeof compile>>;
        try {
          next = await compile(root, true);
        } catch (error) {
          log(`${errorMessage(error)}\nThe project source was refused before submission. The previous generation is still serving.`);
          continue;
        }
        if (closed) return;
        let response: Record<string, unknown>;
        try {
          response = await worker.request<Record<string, unknown>>("project", { project: workerProject(next.compiled.project) });
        } catch (error) {
          if (error instanceof OwnerError && error.code === "S3_OWNER_BUSY") {
            log(`${errorMessage(error)}\nThe project update was not submitted; it will retry after current owner work yields.`);
            again = true;
            await new Promise(done => setTimeout(done, 10));
          } else if (projectDefinitelyNotSubmitted(error)) {
            log(`${errorMessage(error)}\nThe project update was not submitted; the installed generation is unchanged.`);
          } else if (projectOutcomeUnconfirmed(error)) {
            log(`${errorMessage(error)}\nThe project update was submitted, but its commit is unconfirmed. A fresh worker will report the generation recovered from SQLite before serving further work.`);
          } else {
            log(`${errorMessage(error)}\nThe worker refused the submitted project update; the installed generation is unchanged.`);
          }
          continue;
        }
        // The durable authority has already changed. Notify readers even if
        // an unrelated artifact write now fails; old policy cannot stay fresh.
        background?.noteCommit({ generation: response.generation, seq: response.seq });
        try {
          await atomicWrite(artifact, JSON.stringify(workerProject(next.compiled.project)));
          await atomicWrite(join(directory, "project.json"), JSON.stringify(workerProject(next.compiled.project)));
          await atomicWrite(join(directory, "api.d.ts"), next.compiled.apiDts);
          log("Snapback 3 updated; existing data is preserved.");
        } catch (error) {
          log(`${errorMessage(error)}\nThe new generation was confirmed installed, but its build files could not be saved. Repair the project directory; SQLite remains restart authority.`);
        }
      } while (again && !closed);
    } finally { updating = false; }
  };

  try {
    const { health, manifest } = await initialWorkerState(worker);
    background = new BackgroundOwner({
      worker,
      onCommit: details => http?.invalidate(details),
      onClock: operations => http?.refreshClock(operations),
      onFatal: error => {
        if (closed) return;
        log(`S3_OWNER_UNAVAILABLE: ${error.code}: ${error.message}`);
        // Fence foreground admission and invalidation immediately. Defer the
        // aggregate close until this background turn and its finalizer settle,
        // so BackgroundOwner.close never waits on the turn calling it.
        http?.closeStreams();
        http?.server.close();
        http?.server.closeAllConnections();
        setImmediate(() => { void close().catch(closeError => log(`S3_OWNER_CLOSE: ${errorMessage(closeError)}`)); });
      },
      log,
    });
    operator = await OperatorSurface.open({
      root, worker,
      onCommit: details => background?.noteCommit(details),
      poke: () => background?.poke(),
      log,
    });
    // Media directories are opened only after the worker owns the database,
    // so startup recovery cannot race another owner for this project.
    assets = mediaHelper
      ? await AssetRuntime.open({
        root, worker, validator: new SubprocessMediaValidator({ command: mediaHelper }),
        onCommit: details => background?.noteCommit(details),
      })
      : undefined;
    http = createOwnerServer({ worker, assets, operator, activity: background, root, dev: options.dev, origins: options.origins, log });
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
    background.start({ seq: health.seq ?? manifest.seq, generation: manifest.generation });
    if (options.dev) {
      await atomicWrite(metadata, JSON.stringify({ pid: process.pid, url, root }));
      watcher = watch(join(root, "snapback"), { recursive: true }, (_event, filename) => {
        if (filename && !/\.(q|ts)$/.test(String(filename))) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => { void reload(); }, 100);
      });
      watcher.on("error", error => log(`S3_WATCH: ${error.message}. Restart dev to resume watching.`));
    }
    return { url, root, worker, background, operator, server: http.server, close };
  } catch (error) { await close(); throw error; }
}

export function errorMessage(error: unknown): string {
  if (error instanceof OwnerError) return error.message.startsWith(`${error.code}:`) ? error.message : `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function initialWorkerState(worker: WorkerClient): Promise<{
  health: Record<string, unknown>;
  manifest: Record<string, unknown>;
}> {
  let failure: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const health = await worker.request<Record<string, unknown>>("health");
      const manifest = await worker.request<Record<string, unknown>>("manifest");
      return { health, manifest };
    } catch (error) {
      failure = error;
      if (!startupRecoverable(error) || attempt === 5) throw error;
      await new Promise(done => setTimeout(done, Math.min(100, 10 * (attempt + 1))));
    }
  }
  throw failure;
}

function startupRecoverable(error: unknown): boolean {
  return error instanceof OwnerError
    && (error.code.startsWith("S3_WORKER") || error.code === "S3_OWNER_BUSY");
}

function projectDefinitelyNotSubmitted(error: unknown): boolean {
  return error instanceof OwnerError
    && ["S3_WORKER_START", "S3_WORKER_INIT", "S3_WORKER_STOPPING", "S3_OWNER_CLOSED"].includes(error.code);
}

function projectOutcomeUnconfirmed(error: unknown): boolean {
  return error instanceof OwnerError
    && ["S3_WORKER_EXIT", "S3_WORKER_IO", "S3_WORKER_TIMEOUT", "S3_WORKER_PROTOCOL"].includes(error.code);
}

function runtimeCapabilities(mediaHelper: string | undefined): string[] {
  return [...(mediaHelper ? ["media"] : []), "jobs", "schedules", "clock"];
}
