import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import ts from "typescript";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type OpRef = string | { op?: string; __op?: string };
type JourneyContext = {
  as(name: string): InlineClient;
  tick(ms: number): Promise<Record<string, unknown>>;
  url: string;
};
type JourneyBody = (context: JourneyContext) => void | Promise<void>;
type RegisteredJourney = { name: string; body: JourneyBody };

const registered: RegisteredJourney[] = [];

/** Register one ≤5 s acceptance journey against the fresh owner started by `snapback2 test`. */
export function journey(name?: string, body?: JourneyBody): void {
  if (typeof name !== "string" || !name.trim() || typeof body !== "function") {
    throw Object.assign(new TypeError("journey(name, fn) requires a name and function"), { code: "E_NOT_BUILT" });
  }
  registered.push({ name, body });
}

function opName(value: OpRef): string {
  if (typeof value === "string") return value;
  const op = value?.op ?? value?.__op;
  if (!op) throw new TypeError("operation must come from api.<module>.<name> or be an op string");
  return op;
}

function apiNode(parts: string[]): unknown {
  return new Proxy(Object.freeze({}), {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "op" || property === "__op") return parts.join(".");
      if (property === "toJSON") return () => ({ op: parts.join(".") });
      if (typeof property !== "string") return undefined;
      return apiNode([...parts, property]);
    },
  });
}

const inlineApi = apiNode([]);

type Subscription = {
  close(): void;
  until(predicate: (value: any) => boolean): Promise<any>;
};

type InlineClient = {
  query(op: OpRef, args?: Record<string, Json>): Promise<any>;
  mutation(op: OpRef, args?: Record<string, Json>): Promise<any>;
  subscribe(op: OpRef, args: Record<string, Json>, listener: (value: any) => void): Subscription;
};

function createInlineClient(options: { url: string; as: string }): InlineClient {
  const headers = { "content-type": "application/json", "x-snapback-as": options.as };
  const request = async (path: string, op: OpRef, args: Record<string, Json> = {}) => {
    const response = await fetch(`${options.url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ op: opName(op), args }),
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.message ?? `HTTP ${response.status}`), value);
    return value;
  };
  return {
    query: (op, args = {}) => request("/api/query", op, args),
    mutation: (op, args = {}) => request("/api/mutation", op, args),
    subscribe(op, args, listener) {
      const controller = new AbortController();
      const waiters: Array<{ predicate(value: any): boolean; resolve(value: any): void; reject(error: unknown): void }> = [];
      void (async () => {
        try {
          const query = new URLSearchParams({ op: opName(op), args: JSON.stringify(args) });
          const response = await fetch(`${options.url}/api/subscribe?${query}`, {
            headers: { "x-snapback-as": options.as },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`subscription HTTP ${response.status}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffered = "";
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffered += decoder.decode(chunk.value, { stream: true });
            for (;;) {
              const boundary = buffered.indexOf("\n\n");
              if (boundary < 0) break;
              const frame = buffered.slice(0, boundary);
              buffered = buffered.slice(boundary + 2);
              const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
              if (!data) continue;
              const value = JSON.parse(data);
              listener(value);
              for (const waiter of [...waiters]) {
                if (waiter.predicate(value)) {
                  waiters.splice(waiters.indexOf(waiter), 1);
                  waiter.resolve(value);
                }
              }
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) for (const waiter of waiters.splice(0)) waiter.reject(error);
        }
      })();
      return {
        close: () => controller.abort(),
        until(predicate) {
          return new Promise((resolve, reject) => waiters.push({ predicate, resolve, reject }));
        },
      };
    },
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runnerFiles(): string[] {
  const separator = process.argv.indexOf("--");
  return separator >= 0 ? process.argv.slice(separator + 1).map((path) => resolve(path)) : [];
}

async function loadJourneyFile(path: string): Promise<RegisteredJourney[]> {
  registered.length = 0;
  const source = await readFile(path, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    reportDiagnostics: true,
  });
  const failures = compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (failures.length) throw new Error(failures.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("; "));
  const module = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string): unknown => {
    if (specifier === "snapback2/test") return { journey };
    if (specifier === "snapback2/client") return { api: inlineApi, createClient: createInlineClient };
    throw new Error(`journey import ${specifier} is not available; use snapback2/test and snapback2/client`);
  };
  const evaluate = new Function("require", "exports", "module", compiled.outputText);
  evaluate(localRequire, module.exports, module);
  if (registered.length === 0) throw new Error("journey file registered zero checks; call journey(name, fn)");
  return [...registered];
}

async function control(url: string, secret: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-snapback-control": secret },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.message ?? `control HTTP ${response.status}`), value);
  return value;
}

async function within<T>(ms: number, body: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      body(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`journey exceeded ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runEntry(): Promise<void> {
  const url = argument("--url");
  const secret = argument("--secret");
  const files = runnerFiles();
  if (!url || !secret || files.length === 0) {
    process.stdout.write(`${JSON.stringify({ name: "journeys", kind: "journey", verdict: "fail", ms: 0, detail: "runner requires --url, --secret, and files" })}\n`);
    process.exitCode = 1;
    return;
  }
  let failed = false;
  for (const file of files) {
    let journeys: RegisteredJourney[];
    try {
      journeys = await loadJourneyFile(file);
    } catch (error) {
      failed = true;
      process.stdout.write(`${JSON.stringify({ name: file, kind: "journey", verdict: "fail", ms: 0, detail: String(error) })}\n`);
      continue;
    }
    for (const check of journeys) {
      const started = performance.now();
      try {
        await within(5_000, async () => check.body({
          as: (name) => createInlineClient({ url, as: name }),
          tick: (ms) => control(url, secret, "/control/clock", { advanceMs: ms }),
          url,
        }));
        process.stdout.write(`${JSON.stringify({ name: check.name, kind: "journey", verdict: "pass", ms: Math.round(performance.now() - started), detail: { file } })}\n`);
      } catch (error) {
        failed = true;
        process.stdout.write(`${JSON.stringify({ name: check.name, kind: "journey", verdict: "fail", ms: Math.round(performance.now() - started), detail: error instanceof Error ? error.message : String(error) })}\n`);
      }
    }
  }
  if (failed) process.exitCode = 1;
}

if (basename(process.argv[1] ?? "") === "test-runner.mjs") await runEntry();
