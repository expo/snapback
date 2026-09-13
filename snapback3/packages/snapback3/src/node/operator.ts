import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { OwnerError, type WorkerTransport } from "./worker.js";
import type { CommitDetails, EffectRunnerEvent } from "./background.js";

const CREDENTIAL_FILE = "operator.json";
const EVENT_LIMIT = 512;

export type OperatorCommand =
  | { kind: "operator.run" }
  | { kind: "job.enqueue" }
  | { kind: "job.recover" }
  | { kind: "job.plan" }
  | { kind: "job.status"; id: string }
  | { kind: "job.resume"; id: string }
  | { kind: "job.cancel"; id: string }
  | { kind: "effect.list" }
  | { kind: "effect.requeue"; id: string }
  | { kind: "operator.logs" }
  | { kind: "effect.logs" };

export interface OperatorEvent {
  at: number;
  kind: string;
  op?: string;
  id?: string;
  effect?: string;
  state?: string;
  attempt?: number;
  seq?: number;
  code?: string;
  capture?: unknown;
}

export interface OperatorOptions {
  root: string;
  worker: WorkerTransport;
  onCommit(details: CommitDetails): void;
  poke(): void;
  log?: (message: string) => void;
}

interface Credential {
  version: 1;
  id: string;
  token: string;
}

// @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — the operator is a separately authenticated owner seat, never a persona.
export class OperatorSurface {
  private readonly events: OperatorEvent[] = [];

  private constructor(private readonly options: OperatorOptions, private readonly credential: Credential) {}

  static async open(options: OperatorOptions): Promise<OperatorSurface> {
    return new OperatorSurface(options, await loadOrCreateCredential(options.root));
  }

  authenticate(value: string | undefined): void {
    const match = value && /^Bearer ([^\s]+)$/i.exec(value);
    const supplied = match?.[1] ?? "";
    const expected = Buffer.from(this.credential.token);
    const actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new OwnerError("S3_OPERATOR_AUTH", "A valid local operator credential is required.");
    }
  }

  async execute(command: OperatorCommand, body: Record<string, unknown> = {}): Promise<unknown> {
    switch (command.kind) {
      case "operator.run": return this.named(command.kind, body, true);
      case "job.enqueue": return this.named(command.kind, body, true);
      case "job.recover": return this.recoverJobs(body);
      case "job.plan": return this.named(command.kind, body, false);
      case "job.status": return this.byId(command.kind, command.id, false);
      case "job.resume": exactKeys(body, []); return this.byId(command.kind, command.id, true);
      case "job.cancel": exactKeys(body, []); return this.byId(command.kind, command.id, true);
      case "effect.list": return this.listEffects(body);
      case "effect.requeue": exactKeys(body, []); return this.byId(command.kind, command.id, true);
      case "operator.logs": return { events: this.events.slice(-100) };
      case "effect.logs": return { events: this.events.filter(event => event.kind.startsWith("effect.")).slice(-100) };
    }
  }

  recordEffect(event: EffectRunnerEvent): void {
    this.record({
      at: Date.now(), kind: `effect.${boundedLabel(event.state, "state")}`,
      id: boundedId(event.id), effect: boundedLabel(event.effect, "effect"),
      ...(safePositive(event.attempt) === undefined ? {} : { attempt: safePositive(event.attempt) }),
      ...(event.code ? { code: boundedLabel(event.code, "code") } : {}),
      ...(event.capture === undefined ? {} : { capture: redact(event.capture) }),
    });
  }

  inspect(): readonly OperatorEvent[] {
    return this.events.map(event => ({ ...event }));
  }

  private async named(kind: "operator.run" | "job.enqueue" | "job.plan", body: Record<string, unknown>, writes: boolean): Promise<unknown> {
    exactKeys(body, ["op", "args"]);
    const op = boundedLabel(body.op, "op", 256);
    const args = jsonObject(body.args ?? {}, "args");
    const result = await this.options.worker.request(kind, { by: this.credential.id, op, args });
    const seq = await this.committedSequence(result, writes);
    const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
    const id = kind === "job.enqueue" && typeof record.id === "string" ? boundedId(record.id) : undefined;
    this.record({ at: Date.now(), kind, op, ...(id ? { id } : {}), ...(seq === undefined ? {} : { seq }), state: stateOf(record) });
    if (writes) this.options.poke();
    return result;
  }

  private async byId(kind: "job.status" | "job.resume" | "job.cancel" | "effect.requeue", id: string, writes: boolean): Promise<unknown> {
    const result = await this.options.worker.request(kind, kind.startsWith("job.")
      ? { by: this.credential.id, id }
      : { id });
    const seq = await this.committedSequence(result, writes);
    const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
    this.record({ at: Date.now(), kind, id, ...(seq === undefined ? {} : { seq }), state: stateOf(record) });
    if (writes) this.options.poke();
    return result;
  }

  private async listEffects(body: Record<string, unknown>): Promise<unknown> {
    exactKeys(body, ["state", "after", "limit"]);
    if (!["sent_unknown", "failed"].includes(String(body.state))) throw new OwnerError("S3_INPUT", "state must be sent_unknown or failed.");
    const params: Record<string, unknown> = { state: body.state };
    if (body.after !== undefined) params.after = boundedId(body.after);
    if (body.limit !== undefined) {
      if (!Number.isSafeInteger(body.limit) || (body.limit as number) < 1 || (body.limit as number) > 64) throw new OwnerError("S3_INPUT", "limit must be an integer from 1 to 64.");
      params.limit = body.limit;
    }
    const result = await this.options.worker.request("effect.list", params);
    this.record({ at: Date.now(), kind: "effect.list", state: String(body.state) });
    return result;
  }

  private async recoverJobs(body: Record<string, unknown>): Promise<unknown> {
    exactKeys(body, ["after", "limit"]);
    const params: Record<string, unknown> = { by: this.credential.id };
    if (body.after !== undefined) params.after = boundedId(body.after);
    if (body.limit !== undefined) {
      if (!Number.isSafeInteger(body.limit) || (body.limit as number) < 1 || (body.limit as number) > 64) {
        throw new OwnerError("S3_INPUT", "limit must be an integer from 1 to 64.");
      }
      params.limit = body.limit;
    }
    const result = await this.options.worker.request("job.recover", params);
    this.record({ at: Date.now(), kind: "job.recover" });
    return result;
  }

  private async committedSequence(result: unknown, writes: boolean): Promise<number | undefined> {
    if (!writes) return undefined;
    const direct = result && typeof result === "object" ? safePositive((result as Record<string, unknown>).seq) : undefined;
    let seq = direct;
    if (seq === undefined) {
      try {
        const health = await this.options.worker.request("health", {}) as Record<string, unknown>;
        seq = safePositive(health.seq);
      } catch (error) {
        this.options.log?.(`S3_OPERATOR_OBSERVE: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (seq !== undefined) this.options.onCommit({ seq });
    return seq;
  }

  private record(event: OperatorEvent): void {
    this.events.push(Object.freeze(event));
    if (this.events.length > EVENT_LIMIT) this.events.splice(0, this.events.length - EVENT_LIMIT);
    const identity = event.id ? ` ${event.id}` : event.op ? ` ${event.op}` : "";
    this.options.log?.(`${event.kind}${identity}${event.seq === undefined ? "" : ` seq=${event.seq}`}`);
  }
}

export function matchOperatorRoute(method: string | undefined, path: string): OperatorCommand | undefined {
  if (method === "POST" && path === "/control/operator/run") return { kind: "operator.run" };
  if (method === "POST" && path === "/control/jobs/enqueue") return { kind: "job.enqueue" };
  if (method === "POST" && path === "/control/jobs/recover") return { kind: "job.recover" };
  if (method === "POST" && path === "/control/jobs/plan") return { kind: "job.plan" };
  if (method === "GET" && path === "/control/operator/logs") return { kind: "operator.logs" };
  if (method === "GET" && path === "/control/effects/logs") return { kind: "effect.logs" };
  if (method === "POST" && path === "/control/effects/list") return { kind: "effect.list" };
  const job = /^\/control\/jobs\/([^/]+)(?:\/(resume|cancel))?$/.exec(path);
  if (job) {
    const id = boundedId(job[1]);
    if (!job[2] && method === "GET") return { kind: "job.status", id };
    if (job[2] === "resume" && method === "POST") return { kind: "job.resume", id };
    if (job[2] === "cancel" && method === "POST") return { kind: "job.cancel", id };
  }
  const effect = /^\/control\/effects\/([^/]+)\/requeue$/.exec(path);
  if (effect && method === "POST") return { kind: "effect.requeue", id: boundedId(effect[1]) };
  return undefined;
}

export async function readOperatorCredential(root: string): Promise<string> {
  return (await readCredential(join(root, ".snapback3", CREDENTIAL_FILE))).token;
}

async function loadOrCreateCredential(root: string): Promise<Credential> {
  const directory = join(root, ".snapback3");
  const path = join(directory, CREDENTIAL_FILE);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { return await readCredential(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = `s3op_${randomBytes(32).toString("base64url")}`;
  const credential: Credential = {
    version: 1,
    id: `operator_${createHash("sha256").update(token).digest("hex").slice(0, 24)}`,
    token,
  };
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(credential)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readCredential(path);
    throw error;
  } finally { await handle?.close(); }
  return credential;
}

async function readCredential(path: string): Promise<Credential> {
  const pathInformation = await lstat(path);
  if (pathInformation.isSymbolicLink()) throw new OwnerError("S3_OPERATOR_CREDENTIAL", "The operator credential must not be a symbolic link.");
  const handle = await open(path, "r");
  try {
    const information = await handle.stat();
    if (!information.isFile()) throw new OwnerError("S3_OPERATOR_CREDENTIAL", "The operator credential is not a regular file.");
    if ((information.mode & 0o077) !== 0) await handle.chmod(0o600);
    let parsed: Partial<Credential>;
    try { parsed = JSON.parse(await handle.readFile("utf8")) as Partial<Credential>; }
    catch { throw new OwnerError("S3_OPERATOR_CREDENTIAL", "The local operator credential is invalid; repair it without exposing its contents."); }
    if (parsed.version !== 1 || typeof parsed.id !== "string" || !/^operator_[0-9a-f]{24}$/.test(parsed.id)
      || typeof parsed.token !== "string" || !/^s3op_[A-Za-z0-9_-]{43}$/.test(parsed.token)) {
      throw new OwnerError("S3_OPERATOR_CREDENTIAL", "The local operator credential is invalid; repair it without exposing its contents.");
    }
    return parsed as Credential;
  } finally { await handle.close(); }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new OwnerError("S3_INPUT", `Expected only ${allowed.join(", ")}.`);
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerError("S3_INPUT", `${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function boundedId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(value)) throw new OwnerError("S3_INPUT", "id must be 1–256 safe ASCII characters.");
  return value;
}

function boundedLabel(value: unknown, label: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OwnerError("S3_INPUT", `${label} must be a nonempty single-line string of at most ${max} bytes.`);
  }
  return value;
}

function safePositive(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0) ? value as number : undefined;
}

function stateOf(value: Record<string, unknown>): string | undefined {
  if (typeof value.state === "string") return value.state;
  if (value.job && typeof value.job === "object" && typeof (value.job as Record<string, unknown>).state === "string") {
    return (value.job as Record<string, unknown>).state as string;
  }
  return undefined;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth-capped]";
  if (typeof value === "string") {
    const bounded = value.length > 2_048 ? `${value.slice(0, 2_048)}…` : value;
    return bounded
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/\bs3op_[A-Za-z0-9_-]+\b/g, "[redacted]");
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(child => redact(child, depth + 1));
  if (!value || typeof value !== "object") return String(value);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    result[key] = /authorization|cookie|token|secret|password/i.test(key) ? "[redacted]" : redact(child, depth + 1);
  }
  return result;
}
