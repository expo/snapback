#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkProject, errorMessage, startProject } from "./node/project.js";
import { OwnerError } from "./node/worker.js";
import { readOperatorCredential } from "./node/operator.js";

const usage = `Snapback 3 — experimental application backend

  snapback3 check [projectDir] [--json]
  snapback3 dev [projectDir] [--port 4383] [--host 127.0.0.1] [--adopt-legacy-project]
  snapback3 serve [projectDir] [--port 4383] [--host 127.0.0.1] [--adopt-legacy-project]
  snapback3 run <operation> [JSON] --as alice|system [--project projectDir]
  snapback3 operator logs --as system [--project projectDir]
  snapback3 job enqueue|plan <job> [JSON] --as system [--project projectDir]
  snapback3 job status|resume|cancel <jobId> --as system [--project projectDir]
  snapback3 job recover [JSON] --as system [--project projectDir]
  snapback3 effect logs | list [JSON] | requeue <outboxId> --as system [--project projectDir]

dev runs in the foreground and updates accepted Quarry changes automatically.
serve disables personas. Both can serve the project's dist/ or public/ files.
Set SNAPBACK3_WORKER to choose a built worker executable.
`;

function parse(argv: string[]) {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  const valued = new Set(["port", "host", "as", "project", "url", "origin"]);
  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at];
    if (!argument.startsWith("--")) { positionals.push(argument); continue; }
    const [key, ...inline] = argument.slice(2).split("=");
    if (options.has(key)) throw new OwnerError("S3_INPUT", `--${key} was provided more than once.`);
    if (key === "help" || key === "json" || key === "adopt-legacy-project") {
      if (inline.length) throw new OwnerError("S3_INPUT", `--${key} does not take a value.`);
      options.set(key, true); continue;
    }
    if (!valued.has(key)) throw new OwnerError("S3_INPUT", `Unknown option --${key}.`);
    const value = inline.length ? inline.join("=") : argv[++at];
    if (!value || value.startsWith("--")) throw new OwnerError("S3_INPUT", `--${key} needs a value.`);
    options.set(key, value);
  }
  return { positionals, options };
}

async function main(): Promise<void> {
  const { positionals, options } = parse(process.argv.slice(2));
  const command = positionals.shift();
  if (!command || command === "help" || options.has("help")) { process.stdout.write(usage); return; }
  if (command === "check") {
    if (positionals.length > 1) throw new OwnerError("S3_INPUT", "check accepts one project directory.");
    const report = await checkProject(resolve(positionals[0] ?? "."));
    process.stdout.write(options.has("json") ? `${JSON.stringify(report)}\n` : `Snapback 3 checked ${report.root}. ${Array.isArray(report.operations) ? report.operations.length : report.operations ?? "All"} operations certified.\n`);
    return;
  }
  if (command === "dev" || command === "serve") {
    if (positionals.length > 1) throw new OwnerError("S3_INPUT", `${command} accepts one project directory.`);
    const port = Number(options.get("port") ?? 4383);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new OwnerError("S3_INPUT", "--port must be an integer from 0 to 65535.");
    const app = await startProject({
      root: resolve(positionals[0] ?? "."), dev: command === "dev", port,
      host: options.get("host") as string | undefined,
      origins: options.has("origin") ? [String(options.get("origin"))] : undefined,
      adoptLegacyProject: options.has("adopt-legacy-project"),
    });
    process.stdout.write(`SNAPBACK_URL=${app.url}\nSnapback 3 ${command} is ready.\n`);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void app.close().catch(error => { process.stderr.write(`${errorMessage(error)}\n`); process.exitCode = 1; });
    };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    app.server.once("close", () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); });
    return;
  }
  if (command === "run") {
    if (positionals.length < 1 || positionals.length > 2) throw new OwnerError("S3_INPUT", "run needs an operation name and optional JSON arguments.");
    const name = options.get("as");
    if (typeof name !== "string") throw new OwnerError("S3_INPUT", "Use --as <persona|system> to choose an explicit caller.");
    let args: unknown;
    try { args = JSON.parse(positionals[1] ?? "{}"); }
    catch { throw new OwnerError("S3_INPUT", "Operation arguments must be JSON."); }
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new OwnerError("S3_INPUT", "Operation arguments must be a JSON object.");
    const root = resolve(String(options.get("project") ?? "."));
    const url = await ownerUrl(root, options.get("url"));
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new OwnerError("S3_INPUT", "The development URL is invalid.");
    if (name === "system") {
      const token = await operatorToken(root);
      const result = await request(url, "/control/operator/run", { op: positionals[0], args }, token,
        "The operator mutation may have committed. Do not replay it automatically; inspect the authenticated operator log.");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const manifest = await request(url, "/api/manifest");
    const op = positionals[0], operation = manifest.programs?.[op];
    if (!operation) throw new OwnerError("S3_OP_UNKNOWN", `Unknown operation ${op}.`);
    const session = await request(url, "/api/auth/persona", { name });
    if (operation.kind === "query") {
      const result = await request(url, "/api/query", { op, args }, session.token);
      process.stdout.write(`${JSON.stringify({ state: result.state, data: expandRows(result), next: result.next, seq: result.seq }, null, 2)}\n`);
    } else if (operation.kind === "mutation") {
      const intent = `cli-${randomUUID()}`;
      // Print identity before transport: a lost response must remain recoverable.
      process.stderr.write(`Operation ${intent}\n`);
      const result = await request(url, "/api/mutation", { op, args, intent, planHash: operation.planHash, schemaHash: manifest.schemaHash }, session.token);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.state !== "committed") process.exitCode = 1;
    } else throw new OwnerError("S3_OP_KIND", "run currently supports named queries and mutations.");
    return;
  }
  if (command === "operator") {
    if (positionals.length !== 1 || positionals[0] !== "logs") {
      throw new OwnerError("S3_INPUT", "operator currently supports only logs.");
    }
    requireSystem(options);
    const root = resolve(String(options.get("project") ?? "."));
    const url = await ownerUrl(root, options.get("url")), token = await operatorToken(root);
    const result = await request(url, "/control/operator/logs", undefined, token);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "job") {
    const action = positionals.shift();
    if (!action || !["enqueue", "recover", "plan", "status", "resume", "cancel"].includes(action)) {
      throw new OwnerError("S3_INPUT", "job needs enqueue, recover, plan, status, resume, or cancel.");
    }
    requireSystem(options);
    const named = action === "enqueue" || action === "plan";
    const recovering = action === "recover";
    if ((named && (positionals.length < 1 || positionals.length > 2))
      || (recovering && positionals.length > 1)
      || (!named && !recovering && positionals.length !== 1)) {
      throw new OwnerError("S3_INPUT", named
        ? `job ${action} needs a job name and optional JSON arguments.`
        : recovering ? "job recover accepts optional JSON pagination arguments." : `job ${action} needs one job ID.`);
    }
    const root = resolve(String(options.get("project") ?? "."));
    const url = await ownerUrl(root, options.get("url")), token = await operatorToken(root);
    const path = named || recovering
      ? `/control/jobs/${action}`
      : `/control/jobs/${encodeURIComponent(positionals[0])}${action === "status" ? "" : `/${action}`}`;
    const body = named ? { op: positionals[0], args: parseObject(positionals[1]) }
      : recovering ? parseObject(positionals[0]) : {};
    const uncertainty = action === "enqueue"
      ? "The job may have been enqueued. Do not enqueue it again; run `snapback3 job recover --as system --project <projectDir>` to inspect bounded durable IDs."
      : ["resume", "cancel"].includes(action)
        ? `The job ${action} may have committed. Observe the existing job before another operator action.`
        : undefined;
    const result = await request(url, path, action === "status" ? undefined : body, token, uncertainty);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "effect") {
    const action = positionals.shift();
    if (!action || !["logs", "list", "requeue"].includes(action)
      || (action === "logs" && positionals.length !== 0)
      || (action === "list" && positionals.length > 1)
      || (action === "requeue" && positionals.length !== 1)) {
      throw new OwnerError("S3_INPUT", "effect needs logs, list [JSON], or requeue <outboxId>.");
    }
    requireSystem(options);
    const root = resolve(String(options.get("project") ?? "."));
    const url = await ownerUrl(root, options.get("url")), token = await operatorToken(root);
    const path = action === "logs" ? "/control/effects/logs" : action === "list" ? "/control/effects/list" : `/control/effects/${encodeURIComponent(positionals[0])}/requeue`;
    const result = await request(url, path, action === "logs" ? undefined : action === "list" ? parseObject(positionals[0]) : {}, token,
      action === "requeue" ? "The explicit effect requeue may have committed. Inspect effect logs before another recovery action." : undefined);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new OwnerError("S3_INPUT", `Unknown command ${command}. Run snapback3 --help.`);
}

async function request(url: string, path: string, body?: unknown, token?: string, uncertainty?: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(new URL(path, url), {
      method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(15_000),
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new OwnerError("S3_TRANSPORT", uncertainty ?? "The development server did not answer. A submitted write may have committed; retain its printed operation ID."); }
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new OwnerError(
      "S3_RESPONSE",
      uncertainty
        ? `The development server returned an unreadable response after submission.\n${uncertainty}`
        : "The development server returned an unreadable response.",
    );
  }
  if (!response.ok) {
    const code = result.error?.code ?? "S3_HTTP";
    const message = result.error?.message ?? `Server returned HTTP ${response.status}.`;
    const submittedUnknown = response.status >= 500 || String(code).startsWith("S3_WORKER");
    throw new OwnerError(code, uncertainty && submittedUnknown && !message.includes("job recover")
      ? `${message}\n${uncertainty}` : message);
  }
  return result;
}

async function ownerUrl(root: string, configured: string | true | undefined): Promise<string> {
  if (typeof configured === "string") return configured;
  try { return JSON.parse(await readFile(join(root, ".snapback3", "dev.json"), "utf8")).url; }
  catch { throw new OwnerError("S3_OWNER_MISSING", "Start snapback3 dev in this project first, or pass --project <directory>."); }
}

async function operatorToken(root: string): Promise<string> {
  try { return await readOperatorCredential(root); }
  catch (error) {
    if (error instanceof OwnerError) throw error;
    throw new OwnerError("S3_OPERATOR_CREDENTIAL", "The local operator credential is unavailable. Start this project's owner first.");
  }
}

function requireSystem(options: Map<string, string | true>): void {
  if (options.get("as") !== "system") throw new OwnerError("S3_FORBIDDEN", "This command requires the explicit local operator seat: --as system.");
}

function parseObject(source: string | undefined): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(source ?? "{}"); }
  catch { throw new OwnerError("S3_INPUT", "Operation arguments must be JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerError("S3_INPUT", "Operation arguments must be a JSON object.");
  return value as Record<string, unknown>;
}

function expandRows(envelope: any): unknown {
  const rows = new Map((envelope.rows ?? []).map((row: any) => [JSON.stringify([row.table, row.id]), row.row]));
  const visit = (value: any): any => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(visit);
    if (Object.keys(value).length === 1 && value.$row) {
      if (Object.hasOwn(value.$row, "$value")) return Object.fromEntries(Object.entries(value.$row.$value).map(([key, child]) => [key, visit(child)]));
      return rows.get(JSON.stringify([value.$row.table, value.$row.id]));
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  return visit(envelope.data);
}

void main().catch(error => { process.stderr.write(`${errorMessage(error)}\n`); process.exitCode = 1; });
