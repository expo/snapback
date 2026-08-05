#!/usr/bin/env node
// LLP 0105 P0.1 real Workers for Platforms dispatch-namespace spike.
//
// This is intentionally a disposable, API-driven proof. It creates one
// untrusted dispatch namespace, uploads two apps x two releases x two roles,
// runs the LLP 0009/0047 boundary cases, records the exact user-Worker binding
// metadata, and deletes every remote resource it created.
//
// @ref LLP 0105#p01-wfp-handler-and-host-bridge — the live namespace topology,
// binding receipt, and two-app/two-release adversarial matrix are Phase 0 gates.
// @ref LLP 0009#invocation-isolation — user code receives ctx-shaped host powers,
// not env or a raw host capability, and each dispatched script is isolated.
// @ref LLP 0047#acceptance — CPU/subrequest kills, denied ambient fetch, stale
// continuation/capability refusal, and structured failure are witnessed live.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { resolve4, resolve6 } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const DEFAULT_NAMESPACE = 'eas-p0-spike-20260803';
const COMPATIBILITY_DATE = '2026-07-01';
const CPU_MS = 20;
const SUBREQUESTS = 5;
const RESPONSE_BYTES = 64 * 1024;
const HANDLER_CONCURRENCY = 2;
const ACTION_CONCURRENCY = 1;
const QUEUE_DEPTH = 2;
const INVOCATION_DEADLINE_MS = 10_000;
const EDGE_PROBE_CONCURRENCY = 8;
const EDGE_STABLE_ROUNDS = 3;
const EDGE_MAX_ROUNDS = 90;
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultReceipt = path.resolve(here, '../receipts/p0.1-wfp-dispatch-namespace.json');

function parseArgs(argv) {
  const parsed = { namespace: DEFAULT_NAMESPACE, receipt: defaultReceipt };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--namespace') parsed.namespace = argv[++index];
    else if (flag === '--receipt') parsed.receipt = path.resolve(argv[++index]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!/^eas-p0-spike-[0-9]{8}$/.test(parsed.namespace || '')) {
    throw new Error('--namespace must match eas-p0-spike-YYYYMMDD');
  }
  return parsed;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function repoFact(args) {
  try {
    return execFileSync('git', args, { cwd: path.resolve(here, '../../..'), encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function safeMessage(error, accountId) {
  return String(error?.message || error || 'unknown error')
    .replaceAll(accountId, '<account-id>')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gu, 'Bearer <redacted>')
    .slice(0, 2_000);
}

function stableJson(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function workerNames(namespace, runId) {
  const date = namespace.slice('eas-p0-spike-'.length);
  const prefix = `snapback-eas-p0-${date}-${runId}`;
  return {
    host: `${prefix}-host`,
    outbound: `${prefix}-outbound`,
    dispatcher: `${prefix}-dispatch`,
  };
}

function hostWorkerSource() {
  return `
const encoder = new TextEncoder();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function verifyCapability(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("SNAPBACK_CAPABILITY_MALFORMED");
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), encoder.encode(parts[0]));
  if (!valid) throw new Error("SNAPBACK_CAPABILITY_SIGNATURE_INVALID");
  return JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
}

export class HostState {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const { cap, op, payload } = await request.json();
    if (op === "delay") {
      const delayMs = Math.max(0, Math.min(1_000, Number(payload?.delayMs || 0)));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return json(200, { ok: true, delayedMs: delayMs, cap });
    }
    if (op === "query") {
      const value = Number(await this.state.storage.get("value") || 0);
      return json(200, { ok: true, value, cap, applicationArgKeys: payload?.applicationArgKeys || [] });
    }
    if (op === "mutation") {
      const operationKey = "operation:" + cap.requestId;
      const prior = await this.state.storage.get(operationKey);
      if (prior) return json(200, { ...prior, replayed: true, cap });
      const current = Number(await this.state.storage.get("value") || 0);
      const next = current + Number(payload?.delta || 1);
      const result = { ok: true, value: next, replayed: false };
      await this.state.storage.put({ value: next, [operationKey]: result });
      return json(200, { ...result, cap });
    }
    return json(400, { ok: false, code: "SNAPBACK_HOST_OPERATION_UNKNOWN" });
  }
}

export default {
  async fetch(request, env) {
    let cap;
    let body;
    try {
      cap = await verifyCapability(request.headers.get("x-snapback-capability"), env.CAP_SECRET);
      body = await request.json();
    } catch (error) {
      return json(401, { ok: false, code: String(error?.message || "SNAPBACK_CAPABILITY_INVALID") });
    }
    const now = Date.now();
    const required = ["appId", "environmentId", "objectId", "release", "operation", "requestId", "deadline"];
    if (required.some((key) => cap[key] === undefined || cap[key] === null)) {
      return json(401, { ok: false, code: "SNAPBACK_CAPABILITY_INCOMPLETE" });
    }
    if (Number(cap.deadline) < now) {
      return json(401, { ok: false, code: "SNAPBACK_CAPABILITY_STALE" });
    }
    if (body?.op !== cap.operation) {
      return json(403, { ok: false, code: "SNAPBACK_CAPABILITY_OPERATION_MISMATCH" });
    }
    const source = body?.source || {};
    if (source.appId !== cap.appId || source.environmentId !== cap.environmentId ||
        source.objectId !== cap.objectId || source.release !== cap.release) {
      return json(403, { ok: false, code: "SNAPBACK_CAPABILITY_SCOPE_MISMATCH" });
    }
    const id = env.HOST_STATE.idFromName(cap.appId + ":" + cap.environmentId + ":" + cap.objectId);
    return env.HOST_STATE.get(id).fetch(new Request("https://host-state.internal/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cap, op: body.op, payload: body.payload || {} }),
    }));
  },
};
`;
}

function outboundWorkerSource() {
  return `
function denied(code, context, url) {
  return new Response(JSON.stringify({ ok: false, code, role: context?.role || null, host: url.hostname }), {
    status: 403,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const context = env.DISPATCH_CONTEXT || {};
    const url = new URL(request.url);
    if (context.role !== "action") {
      return denied("SNAPBACK_HANDLER_AMBIENT_NETWORK_DENIED", context, url);
    }
    if (url.protocol !== "https:" || url.hostname !== "example.com") {
      return denied("SNAPBACK_ACTION_EGRESS_NOT_ALLOWLISTED", context, url);
    }
    return fetch(request);
  },
};
`;
}

function dispatcherWorkerSource({ namespace }) {
  return `
const encoder = new TextEncoder();
const namespace = ${JSON.stringify(namespace)};
const limits = Object.freeze({
  cpuMs: ${CPU_MS},
  subRequests: ${SUBREQUESTS},
  responseBytes: ${RESPONSE_BYTES},
  handlerConcurrency: ${HANDLER_CONCURRENCY},
  actionConcurrency: ${ACTION_CONCURRENCY},
  queueDepth: ${QUEUE_DEPTH},
  deadlineMs: ${INVOCATION_DEADLINE_MS},
});

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).split("+").join("-").split("/").join("_").replace(/=+$/g, "");
}

async function signCapability(cap, secret) {
  const payload = b64url(encoder.encode(JSON.stringify(cap)));
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return payload + "." + b64url(signature);
}

class QueueFull extends Error {
  constructor() {
    super("SNAPBACK_QUEUE_LIMIT");
  }
}

export class Gate {
  constructor(state) {
    this.state = state;
    this.active = 0;
    this.queue = [];
  }

  async acquire(limit) {
    if (this.active < limit) {
      this.active += 1;
      return;
    }
    if (this.queue.length >= limits.queueDepth) throw new QueueFull();
    await new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new Error("SNAPBACK_QUEUE_DEADLINE"));
      }, limits.deadlineMs);
      this.queue.push(entry);
    });
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/release") {
      this.release();
      return json(200, { ok: true });
    }
    if (url.pathname !== "/acquire") {
      return json(404, { ok: false, code: "SNAPBACK_GATE_ROUTE_NOT_FOUND" });
    }
    const role = request.headers.get("x-snapback-role");
    if (!['handler', 'action'].includes(role)) {
      return json(400, { ok: false, code: "SNAPBACK_INTERNAL_IDENTITY_MISSING" });
    }
    const concurrency = role === "action" ? limits.actionConcurrency : limits.handlerConcurrency;
    try {
      await this.acquire(concurrency);
      return json(200, { ok: true });
    } catch (error) {
      return json(error instanceof QueueFull ? 429 : 504, { ok: false, code: error.message });
    }
  }
}

const allowed = new Set([
  "query", "mutation", "mutation-retry", "runtime-facts", "ambient-fetch", "ambient-global-fetch", "allowlisted-fetch",
  "denied-action-fetch", "slow-action", "queue-hold", "oversized-response",
  "subrequest-bomb", "cpu-spin", "stale-capability", "tamper-app-capability",
  "tamper-release-capability",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json(200, { ok: true, namespace, limits });
    }
    if (url.pathname === "/queue-proof") {
      const gate = env.GATES.get(env.GATES.idFromName("app-a:handler"));
      const hold = async () => {
        let admission;
        try {
          admission = await gate.fetch(new Request("https://gate.internal/acquire", {
            method: "POST",
            headers: { "x-snapback-role": "handler" },
          }));
        } catch (error) {
          return { status: 500, body: { ok: false, code: "SNAPBACK_DISPATCHER_GATE_FAILED",
            category: String(error?.message || error).slice(0, 240) } };
        }
        if (!admission.ok) {
          return { status: admission.status, body: await admission.json() };
        }
        try {
          await new Promise((resolve) => setTimeout(resolve, 700));
          return { status: 200, body: { ok: true, delayedMs: 700 } };
        } finally {
          try {
            await gate.fetch(new Request("https://gate.internal/release", { method: "POST" }));
          } catch {}
        }
      };
      return json(200, { ok: true, results: await Promise.all(Array.from({ length: 5 }, hold)) });
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 5 || parts[0] !== "invoke") {
      return json(404, { ok: false, code: "SNAPBACK_ROUTE_NOT_FOUND" });
    }
    const [, appId, release, role, operation] = parts;
    if (!["app-a", "app-b"].includes(appId) || !["r1", "r2"].includes(release) ||
        !["handler", "action"].includes(role) || !allowed.has(operation)) {
      return json(404, { ok: false, code: "SNAPBACK_ROUTE_NOT_FOUND" });
    }
    if (role === "handler" && ["allowlisted-fetch", "denied-action-fetch", "slow-action"].includes(operation)) {
      return json(400, { ok: false, code: "SNAPBACK_ROLE_OPERATION_MISMATCH" });
    }
    if (role === "action" &&
        !["allowlisted-fetch", "denied-action-fetch", "slow-action", "subrequest-bomb"].includes(operation)) {
      return json(400, { ok: false, code: "SNAPBACK_ROLE_OPERATION_MISMATCH" });
    }
    const bodyBytes = await request.arrayBuffer();
    if (bodyBytes.byteLength > 16 * 1024) {
      return json(413, { ok: false, code: "SNAPBACK_ARGUMENT_LIMIT" });
    }
    const publicBody = JSON.parse(new TextDecoder().decode(bodyBytes) || "{}");
    const args = publicBody?.args && typeof publicBody.args === "object" ? publicBody.args : {};
    const id = env.GATES.idFromName(appId + ":" + role);
    const gate = env.GATES.get(id);
    let admission;
    try {
      admission = await gate.fetch(new Request("https://gate.internal/acquire", {
        method: "POST",
        headers: { "x-snapback-role": role },
      }));
    } catch (error) {
      return json(500, {
        ok: false,
        code: "SNAPBACK_DISPATCHER_GATE_FAILED",
        category: String(error?.message || error).slice(0, 240),
      });
    }
    if (!admission.ok) return admission;

    try {
      if (operation === "queue-hold") {
        const delayMs = Math.max(0, Math.min(1_000, Number(args.delayMs || 700)));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return json(200, { ok: true, delayedMs: delayMs, layer: "dispatcher-admission-gate" });
      }
      const workerOperation = {
        "mutation-retry": "mutation",
        "stale-capability": "query",
        "tamper-app-capability": "query",
        "tamper-release-capability": "query",
        "subrequest-bomb": "query",
      }[operation] || operation;
      const now = Date.now();
      const cap = {
        appId,
        environmentId: appId + "-environment",
        objectId: "root",
        release,
        operation: workerOperation,
        requestId: operation === "mutation-retry"
          ? "proof:" + appId + ":" + release + ":mutation-retry"
          : crypto.randomUUID(),
        deadline: operation === "stale-capability" ? now - 1 : now + limits.deadlineMs,
      };
      const capability = await signCapability(cap, env.CAP_SECRET);
      const scriptName = appId + "-" + release + "-" + role;
      const controller = new AbortController();
      const timer = operation === "cpu-spin"
        ? null
        : setTimeout(() => controller.abort("SNAPBACK_INVOCATION_DEADLINE"), limits.deadlineMs);
      let response;
      try {
        const dispatchOptions = {
          limits: { cpuMs: limits.cpuMs, subRequests: limits.subRequests },
        };
        if (role === "action") {
          dispatchOptions.outbound = {
            DISPATCH_CONTEXT: { appId, release, role, requestId: cap.requestId },
          };
        }
        const dispatcher = role === "action" ? env.ACTION_DISPATCHER : env.HANDLER_DISPATCHER;
        const worker = dispatcher.get(scriptName, {}, dispatchOptions);
        response = await worker.fetch(new Request("https://user-worker.internal/invoke", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-snapback-capability": capability,
            "x-snapback-operation": operation,
          },
          body: JSON.stringify({ args }),
          signal: controller.signal,
        }));
      } catch (error) {
        return json(502, {
          ok: false,
          code: "SNAPBACK_USER_WORKER_FAILED",
          category: String(error?.message || error).slice(0, 240),
        });
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      let bytes;
      try {
        bytes = await response.arrayBuffer();
      } catch (error) {
        return json(502, {
          ok: false,
          code: "SNAPBACK_USER_WORKER_RESPONSE_FAILED",
          category: String(error?.message || error).slice(0, 240),
        });
      }
      if (bytes.byteLength > limits.responseBytes) {
        return json(413, {
          ok: false,
          code: "SNAPBACK_RESPONSE_LIMIT",
          observedBytes: bytes.byteLength,
          limitBytes: limits.responseBytes,
        });
      }
      return new Response(bytes, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") || "application/octet-stream" },
      });
    } finally {
      try {
        await gate.fetch(new Request("https://gate.internal/release", { method: "POST" }));
      } catch {}
    }
  },
};
`;
}

function userWorkerSource({ appId, release, role }) {
  return `
const APP_ID = ${JSON.stringify(appId)};
const ENVIRONMENT_ID = ${JSON.stringify(`${appId}-environment`)};
const RELEASE = ${JSON.stringify(release)};
const ROLE = ${JSON.stringify(role)};
const OBJECT_ID = "root";
const forbiddenScopeKeys = new Set(["appId", "environmentId", "objectId", "release", "requestId", "deadline"]);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

if (ROLE === "handler") {
  Object.defineProperty(globalThis, "fetch", {
    value: async () => json(403, {
      ok: false,
      code: "SNAPBACK_HANDLER_AMBIENT_NETWORK_DENIED",
      role: ROLE,
    }),
    writable: false,
    configurable: false,
  });
}

function toB64url(text) {
  return btoa(text).split("+").join("-").split("/").join("_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
}

function tamper(token, patch) {
  const [payload, signature] = token.split(".");
  const changed = { ...JSON.parse(fromB64url(payload)), ...patch };
  return toB64url(JSON.stringify(changed)) + "." + signature;
}

async function hostCall(request, env, op, payload, capabilityOverride = null) {
  const capability = capabilityOverride || request.headers.get("x-snapback-capability");
  return env.HOST.fetch(new Request("https://host.internal/operation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-snapback-capability": capability,
    },
    body: JSON.stringify({
      op,
      payload,
      source: { appId: APP_ID, environmentId: ENVIRONMENT_ID, objectId: OBJECT_ID, release: RELEASE },
    }),
  }));
}

export default {
  async fetch(request, env) {
    const { args = {} } = await request.json();
    const operation = request.headers.get("x-snapback-operation");
    let subrequests = 0;
    const boundedFetch = async (...fetchArgs) => {
      if (ROLE !== "action") {
        return json(403, { ok: false, code: "SNAPBACK_HANDLER_AMBIENT_NETWORK_DENIED", role: ROLE });
      }
      subrequests += 1;
      if (subrequests > ${SUBREQUESTS}) throw new Error("SNAPBACK_SUBREQUEST_LIMIT");
      return fetch(...fetchArgs);
    };
    const argKeys = Object.keys(args).sort();
    if (argKeys.some((key) => forbiddenScopeKeys.has(key))) {
      return json(400, {
        ok: false,
        code: "SNAPBACK_HOST_SCOPE_ARGUMENT_FORBIDDEN",
        rejectedKeys: argKeys.filter((key) => forbiddenScopeKeys.has(key)),
      });
    }
    if (operation === "cpu-spin") {
      let checksum = 2_166_136_261;
      const witness = new Uint32Array(256);
      for (let index = 0; index < 200_000_000; index += 1) {
        checksum = Math.imul(checksum ^ (index + witness[index & 255]), 16_777_619) >>> 0;
        if ((index & 1_048_575) === 0) witness[(index >>> 20) & 255] = checksum;
      }
      return json(200, { ok: true, unexpected: "CPU limit did not fire", checksum });
    }
    if (operation === "runtime-facts") {
      return json(200, {
        ok: true,
        requestCfType: typeof request.cf,
        cacheDefaultType: typeof caches === "undefined" ? "undefined" : typeof caches.default,
      });
    }
    if (operation === "oversized-response") {
      return json(200, { ok: true, payload: "x".repeat(128 * 1024) });
    }
    if (operation === "ambient-fetch") {
      const response = await boundedFetch("https://example.com/");
      return json(200, { ok: true, outboundStatus: response.status, role: ROLE });
    }
    if (operation === "ambient-global-fetch") {
      const response = await globalThis.fetch("https://example.com/");
      return json(200, { ok: true, outboundStatus: response.status, role: ROLE });
    }
    if (operation === "allowlisted-fetch") {
      const response = await boundedFetch("https://example.com/");
      return json(200, { ok: true, outboundStatus: response.status, role: ROLE });
    }
    if (operation === "denied-action-fetch") {
      const response = await boundedFetch("https://not-allowlisted.invalid/");
      return json(200, { ok: true, outboundStatus: response.status, role: ROLE });
    }
    if (operation === "slow-action") {
      await new Promise((resolve) => setTimeout(resolve, Number(args.delayMs || 1_200)));
      const response = await boundedFetch("https://example.com/");
      return json(200, { ok: true, outboundStatus: response.status, role: ROLE });
    }
    if (operation === "queue-hold") {
      return hostCall(request, env, "delay", { delayMs: Number(args.delayMs || 700), applicationArgKeys: argKeys });
    }
    if (operation === "subrequest-bomb") {
      try {
        for (let index = 0; index < 12; index += 1) {
          const response = await boundedFetch("https://example.com/?snapback-subrequest=" + index);
          await response.arrayBuffer();
        }
      } catch (error) {
        if (error?.message === "SNAPBACK_SUBREQUEST_LIMIT") {
          return json(429, { ok: false, code: "SNAPBACK_SUBREQUEST_LIMIT", limit: ${SUBREQUESTS} });
        }
        throw error;
      }
      return json(200, { ok: true, unexpected: "subrequest limit did not fire" });
    }
    if (operation === "tamper-app-capability") {
      const changed = tamper(request.headers.get("x-snapback-capability"), { appId: "app-b" });
      return hostCall(request, env, "query", { applicationArgKeys: argKeys }, changed);
    }
    if (operation === "tamper-release-capability") {
      const changed = tamper(request.headers.get("x-snapback-capability"), { release: RELEASE === "r1" ? "r2" : "r1" });
      return hostCall(request, env, "query", { applicationArgKeys: argKeys }, changed);
    }
    if (operation === "query" || operation === "stale-capability") {
      return hostCall(request, env, "query", { applicationArgKeys: argKeys, value: args.value ?? null });
    }
    if (operation === "mutation" || operation === "mutation-retry") {
      return hostCall(request, env, "mutation", { applicationArgKeys: argKeys, delta: Number(args.delta || 1) });
    }
    return json(400, { ok: false, code: "SNAPBACK_USER_OPERATION_UNKNOWN" });
  },
};
`;
}

function metadataForUserWorker(hostName) {
  return {
    main_module: 'worker.mjs',
    compatibility_date: COMPATIBILITY_DATE,
    compatibility_flags: [],
    bindings: [{ type: 'service', name: 'HOST', service: hostName }],
    tags: ['eas-p0-spike', 'disposable'],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-hex account id');
  if (apiToken.length < 24) throw new Error('CLOUDFLARE_API_TOKEN is missing or implausibly short');

  const runId = randomBytes(3).toString('hex');
  const names = workerNames(options.namespace, runId);
  const secret = randomBytes(32).toString('base64url');
  const startedAt = new Date().toISOString();
  const created = { namespace: false, workers: [], namespaceScripts: [] };
  const cleanup = [];
  const checks = [];
  const bindingReceipts = [];
  let fatal = null;

  const receipt = {
    receipt: 'eas-phase0/p0.1/wfp-dispatch-namespace',
    date: startedAt.slice(0, 10),
    startedAt,
    command: `CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_API_TOKEN=<token> node demos/eas-phase0/spikes/p0.1-wfp-dispatch-namespace.mjs --namespace ${options.namespace}`,
    authority: {
      plan: 'LLP 0105 §P0.1 WfP handler and host bridge',
      security: ['LLP 0009 §Invocation Isolation', 'LLP 0009 §Capability Model', 'LLP 0047 §Acceptance'],
      enablementReceipt: 'demos/eas-phase0/receipts/p0-access-wfp-enabled.json',
    },
    repository: {
      sha: repoFact(['rev-parse', 'HEAD']),
      dirty: Boolean(repoFact(['status', '--porcelain'])),
    },
    cloudflare: {
      account: 'ccheever@expo.io account',
      accountIdRedacted: true,
      tokenPosture: 'account-scoped API token from the LLP 0040 credential store; value not retained',
      namespace: options.namespace,
      runId,
      namespaceTrustedWorkers: null,
      compatibilityDate: COMPATIBILITY_DATE,
      compatibilityFlags: [],
      apiDocs: [
        'https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/methods/create/',
        'https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/methods/update/',
        'https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/custom-limits/',
        'https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/',
      ],
    },
    topology: {
      regularWorkers: names,
      apps: ['app-a', 'app-b'],
      releases: ['r1', 'r2'],
      roles: ['handler', 'action'],
      userWorkerCount: 8,
      userWorkerBindingEnvelope: [{ type: 'service', name: 'HOST', service: names.host }],
      dispatchPaths: {
        handler: { binding: 'HANDLER_DISPATCHER', outboundWorker: false },
        action: { binding: 'ACTION_DISPATCHER', outboundWorker: names.outbound },
      },
      capabilityFields: ['appId', 'environmentId', 'objectId', 'release', 'operation', 'requestId', 'deadline'],
    },
    limits: {
      nativeWfpPerInvocation: {
        cpuMs: CPU_MS,
        subRequests: SUBREQUESTS,
        fullTopologyCpuScope: 'handler binding without outbound Worker',
        nativeSubrequestControlReceipt: 'demos/eas-phase0/receipts/p0.1-wfp-minimal-control.json',
      },
      generatedHarness: {
        subRequests: SUBREQUESTS,
        note: 'fail-closed before the outbound Worker handoff; the separate minimal-control receipt proves Cloudflare native subrequest enforcement without an outbound Worker',
      },
      dispatcherEnforced: {
        responseBytes: RESPONSE_BYTES,
        handlerConcurrency: HANDLER_CONCURRENCY,
        actionConcurrency: ACTION_CONCURRENCY,
        queueDepth: QUEUE_DEPTH,
        invocationDeadlineMs: INVOCATION_DEADLINE_MS,
      },
    },
    exactMultipartBindingMetadata: bindingReceipts,
    checks,
    cleanup,
    nonClaims: [
      'This disposable proof does not qualify the eas-cloudflare-wfp-v1 capability profile or graduate hosted_untrusted_code.',
      'Cloudflare native CPU enforcement has documented isolate flexibility, so the busy-loop witness repeats until termination and records every attempt rather than asserting a strict elapsed-time cutoff.',
      'The generated user-Worker harness fails closed at the subrequest ceiling before the outbound Worker handoff. Native WfP subrequest enforcement is independently proved by the binding-free minimal-control receipt because outbound interception changes the observed accounting boundary.',
      'Response, concurrency, queue, and wall-clock limits remain disposable dispatcher/Gate code.',
      'The action-role mechanism is a separate namespaced script and admission gate; Gate 0 must still select the production kill-domain mechanism.',
      'The disposable Workers.dev route must cross a three-round concurrent readiness barrier before P0.1 starts; this does not qualify any Expo ingress or production route shape, which remains P0.2 work.',
      'No production Expo-org credential custody, stable identity, billing, hosted auth, or route-shape claim is made.',
    ],
  };

  function authHeaders(extra = {}) {
    return { authorization: `Bearer ${apiToken}`, ...extra };
  }

  async function api(pathname, { method = 'GET', body, headers = {}, allow404 = false } = {}) {
    const response = await fetch(`${API}${pathname}`, {
      method,
      headers: authHeaders(headers),
      body,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 500) }; }
    if (allow404 && response.status === 404) return null;
    if (!response.ok || payload?.success === false) {
      const details = Array.isArray(payload?.errors)
        ? payload.errors.map((entry) => `${entry.code || 'error'}:${entry.message || 'unknown'}`).join(', ')
        : `HTTP ${response.status}`;
      throw new Error(`${method} ${pathname.replaceAll(accountId, '<account-id>')} failed: ${details}`);
    }
    return { result: payload?.result ?? payload, headers: response.headers, status: response.status };
  }

  async function uploadScript(pathname, metadata, source) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('worker.mjs', new Blob([source], { type: 'application/javascript+module' }), 'worker.mjs');
    return api(pathname, { method: 'PUT', body: form });
  }

  async function uploadRegular(name, metadata, source) {
    await uploadScript(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`, metadata, source);
    created.workers.push(name);
  }

  async function uploadNamespaced(name, metadata, source) {
    const base = `/accounts/${accountId}/workers/dispatch/namespaces/${encodeURIComponent(options.namespace)}/scripts/${encodeURIComponent(name)}`;
    const uploaded = await uploadScript(base, metadata, source);
    created.namespaceScripts.push(name);
    const readBack = await api(`${base}/bindings`);
    const returnedBindings = Array.isArray(uploaded.result?.bindings) ? uploaded.result.bindings : [];
    const readBackBindings = Array.isArray(readBack.result) ? readBack.result : [];
    bindingReceipts.push({
      script: name,
      sourceSha256: sha256(source),
      multipartMetadata: metadata.bindings,
      uploadResponseBindings: returnedBindings,
      bindingsEndpoint: readBackBindings,
    });
    const exact = (bindings) => bindings.length === 1 && bindings[0]?.type === 'service' &&
      bindings[0]?.name === 'HOST' && bindings[0]?.service === names.host;
    if (!exact(metadata.bindings) || !exact(readBackBindings) ||
        (returnedBindings.length > 0 && !exact(returnedBindings))) {
      throw new Error(`${name}: persisted binding envelope was not exactly the requested HOST service binding`);
    }
  }

  async function deletePath(label, pathname) {
    try {
      await api(pathname, { method: 'DELETE', allow404: true });
      cleanup.push({ resource: label, deleted: true });
    } catch (error) {
      cleanup.push({ resource: label, deleted: false, error: safeMessage(error, accountId) });
    }
  }

  function check(id, pass, evidence) {
    checks.push({ id, pass: Boolean(pass), evidence });
    process.stdout.write(`${pass ? 'ok' : 'not ok'} - ${id}\n`);
  }

  let baseUrl = null;
  async function invoke(appId, release, role, operation, args = {}, { retryEdge = true } = {}) {
    const started = performance.now();
    for (let activationAttempt = 1; activationAttempt <= 60; activationAttempt += 1) {
      const nonce = randomBytes(8).toString('hex');
      const response = await fetch(`${baseUrl}/invoke/${appId}/${release}/${role}/${operation}?probe=${nonce}`, {
        method: 'POST',
        headers: {
          'cache-control': 'no-cache, no-store',
          'content-type': 'application/json',
          pragma: 'no-cache',
        },
        body: JSON.stringify({ args }),
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 500) }; }
      const workerNotFound = response.status === 500 && body?.category === 'Worker not found.';
      const edgeNotReady = retryEdge && response.status >= 404 && typeof body?.text === 'string' &&
        /(?:Page|Script) not found/iu.test(body.text);
      if ((!workerNotFound && !edgeNotReady) || activationAttempt === 60) {
        return {
          status: response.status,
          body,
          elapsedMs: Math.round((performance.now() - started) * 10) / 10,
          activationAttempts: activationAttempt,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error('unreachable invocation activation loop');
  }

  async function dispatcherRequest(pathname, init = {}) {
    const started = performance.now();
    for (let activationAttempt = 1; activationAttempt <= 60; activationAttempt += 1) {
      const nonce = randomBytes(8).toString('hex');
      const separator = pathname.includes('?') ? '&' : '?';
      const response = await fetch(`${baseUrl}${pathname}${separator}probe=${nonce}`, {
        ...init,
        headers: {
          'cache-control': 'no-cache, no-store',
          pragma: 'no-cache',
          ...(init.headers || {}),
        },
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 500) }; }
      const edgeNotReady = response.status >= 404 && typeof body?.text === 'string' &&
        /(?:Page|Script) not found/iu.test(body.text);
      if (!edgeNotReady || activationAttempt === 60) {
        return {
          status: response.status,
          body,
          elapsedMs: Math.round((performance.now() - started) * 10) / 10,
          activationAttempts: activationAttempt,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error('unreachable dispatcher activation loop');
  }

  try {
    const namespacePath = `/accounts/${accountId}/workers/dispatch/namespaces/${encodeURIComponent(options.namespace)}`;
    const namespaceBefore = await api(namespacePath, { allow404: true });
    if (namespaceBefore) throw new Error(`refusing to reuse existing namespace ${options.namespace}`);
    for (const name of Object.values(names)) {
      const existing = await api(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`, { allow404: true });
      if (existing) throw new Error(`refusing to reuse existing Worker ${name}`);
    }

    const namespaceCreated = await api(`/accounts/${accountId}/workers/dispatch/namespaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: options.namespace }),
    });
    created.namespace = true;
    receipt.cloudflare.namespaceTrustedWorkers = namespaceCreated.result?.trusted_workers ?? null;
    check('namespace-trusted-mode-not-enabled', namespaceCreated.result?.trusted_workers !== true,
      {
        trustedWorkers: namespaceCreated.result?.trusted_workers ?? null,
        note: 'the create response omits this optional field on the current API; runtime-facts below proves the untrusted request surface',
      });

    await uploadRegular(names.host, {
      main_module: 'worker.mjs',
      compatibility_date: COMPATIBILITY_DATE,
      compatibility_flags: [],
      bindings: [
        { type: 'secret_text', name: 'CAP_SECRET', text: secret },
        { type: 'durable_object_namespace', name: 'HOST_STATE', class_name: 'HostState' },
      ],
      migrations: { new_tag: 'v1', steps: [{ new_sqlite_classes: ['HostState'] }] },
    }, hostWorkerSource());

    await uploadRegular(names.outbound, {
      main_module: 'worker.mjs',
      compatibility_date: COMPATIBILITY_DATE,
      compatibility_flags: [],
      bindings: [],
    }, outboundWorkerSource());

    for (const appId of ['app-a', 'app-b']) {
      for (const release of ['r1', 'r2']) {
        for (const role of ['handler', 'action']) {
          const script = `${appId}-${release}-${role}`;
          const metadata = metadataForUserWorker(names.host);
          await uploadNamespaced(script, metadata, userWorkerSource({ appId, release, role }));
        }
      }
    }

    const namespaceScriptList = await api(
      `/accounts/${accountId}/workers/dispatch/namespaces/${encodeURIComponent(options.namespace)}/scripts`,
    );
    const listedScriptNames = (Array.isArray(namespaceScriptList.result) ? namespaceScriptList.result : [])
      .map((entry) => entry?.script?.id || entry?.script_name || entry?.id || entry?.name)
      .filter((entry) => typeof entry === 'string')
      .sort();
    receipt.cloudflare.namespaceScriptNames = listedScriptNames;
    check('namespace-script-list-eight-workers', listedScriptNames.length === 8 &&
      created.namespaceScripts.every((name) => listedScriptNames.includes(name)), {
      names: listedScriptNames,
    });

    await uploadRegular(names.dispatcher, {
      main_module: 'worker.mjs',
      compatibility_date: COMPATIBILITY_DATE,
      compatibility_flags: [],
      bindings: [
        { type: 'secret_text', name: 'CAP_SECRET', text: secret },
        { type: 'durable_object_namespace', name: 'GATES', class_name: 'Gate' },
        {
          type: 'dispatch_namespace',
          name: 'HANDLER_DISPATCHER',
          namespace: options.namespace,
        },
        {
          type: 'dispatch_namespace',
          name: 'ACTION_DISPATCHER',
          namespace: options.namespace,
          outbound: {
            worker: { service: names.outbound },
            params: [{ name: 'DISPATCH_CONTEXT' }],
          },
        },
      ],
      migrations: { new_tag: 'v1', steps: [{ new_sqlite_classes: ['Gate'] }] },
    }, dispatcherWorkerSource({ namespace: options.namespace }));

    const dispatcherSettings = await api(
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(names.dispatcher)}/settings`,
    );
    receipt.cloudflare.dispatcherBindings = (dispatcherSettings.result?.bindings || []).map((binding) => ({
      type: binding.type,
      name: binding.name,
      ...(binding.namespace ? { namespace: binding.namespace } : {}),
      ...(binding.class_name ? { className: binding.class_name } : {}),
      ...(binding.outbound ? { outbound: binding.outbound } : {}),
    }));

    const subdomainEnabled = await api(
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(names.dispatcher)}/subdomain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
      },
    );
    const subdomainReadBack = await api(
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(names.dispatcher)}/subdomain`,
    );
    const accountSubdomain = await api(`/accounts/${accountId}/workers/subdomain`);
    const dispatcherHostname = `${names.dispatcher}.${accountSubdomain.result?.subdomain}.workers.dev`;
    baseUrl = `https://${dispatcherHostname}`;
    receipt.cloudflare.dispatcherUrl = baseUrl;

    const dns = { ipv4: [], ipv6: [], errors: [] };
    await Promise.all([
      resolve4(dispatcherHostname).then((values) => { dns.ipv4 = values; }).catch((error) => {
        dns.errors.push({ family: 4, message: safeMessage(error, accountId) });
      }),
      resolve6(dispatcherHostname).then((values) => { dns.ipv6 = values; }).catch((error) => {
        dns.errors.push({ family: 6, message: safeMessage(error, accountId) });
      }),
    ]);

    const edgeRounds = [];
    let consecutiveStableRounds = 0;
    let health = null;
    for (let round = 1; round <= EDGE_MAX_ROUNDS && consecutiveStableRounds < EDGE_STABLE_ROUNDS; round += 1) {
      const results = await Promise.all(Array.from({ length: EDGE_PROBE_CONCURRENCY }, async () => {
        try {
          const nonce = randomBytes(8).toString('hex');
          const response = await fetch(`${baseUrl}/health?probe=${nonce}`, {
            headers: { 'cache-control': 'no-cache, no-store', pragma: 'no-cache' },
          });
          const text = await response.text();
          let body;
          try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 240) }; }
          if (body?.ok === true && body?.namespace === options.namespace) health = body;
          return {
            status: response.status,
            ok: body?.ok === true && body?.namespace === options.namespace,
            generatedNotFound: response.status >= 404 && typeof body?.text === 'string' &&
              /(?:Page|Script) not found/iu.test(body.text),
            cfRay: response.headers.get('cf-ray'),
            cfCacheStatus: response.headers.get('cf-cache-status'),
            age: response.headers.get('age'),
            server: response.headers.get('server'),
          };
        } catch (error) {
          return { status: 0, ok: false, networkError: safeMessage(error, accountId) };
        }
      }));
      const stable = results.every((entry) => entry.status === 200 && entry.ok);
      consecutiveStableRounds = stable ? consecutiveStableRounds + 1 : 0;
      edgeRounds.push({ round, stable, results });
      if (consecutiveStableRounds < EDGE_STABLE_ROUNDS) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    check('dispatcher-activated', consecutiveStableRounds >= EDGE_STABLE_ROUNDS &&
      health?.ok === true && health?.namespace === options.namespace, {
      namespace: health?.namespace || null,
      limits: health?.limits || null,
      requiredConsecutiveStableRounds: EDGE_STABLE_ROUNDS,
      consecutiveStableRounds,
      rounds: edgeRounds.length,
    });

    receipt.cloudflare.dispatcherEdgeActivationObservation = {
      stable: consecutiveStableRounds >= EDGE_STABLE_ROUNDS,
      controlPlanePost: subdomainEnabled.result,
      controlPlaneReadBack: subdomainReadBack.result,
      dns,
      concurrency: EDGE_PROBE_CONCURRENCY,
      requiredConsecutiveStableRounds: EDGE_STABLE_ROUNDS,
      consecutiveStableRounds,
      maxRounds: EDGE_MAX_ROUNDS,
      rounds: edgeRounds,
      generatedNotFoundCount: edgeRounds.flatMap((entry) => entry.results)
        .filter((entry) => entry.generatedNotFound).length,
      scope: 'P0.2 ingress follow-up; P0.1 starts only after the stable readiness barrier',
    };

    const runtimeFacts = await invoke('app-a', 'r1', 'handler', 'runtime-facts');
    check('namespaced-worker-untrusted-runtime', runtimeFacts.status === 200 &&
      runtimeFacts.body?.requestCfType === 'undefined', {
      status: runtimeFacts.status,
      requestCfType: runtimeFacts.body?.requestCfType,
      cacheDefaultType: runtimeFacts.body?.cacheDefaultType,
      responseCode: runtimeFacts.body?.code,
      responseCategory: runtimeFacts.body?.category,
      responseBody: runtimeFacts.body,
      elapsedMs: runtimeFacts.elapsedMs,
      activationAttempts: runtimeFacts.activationAttempts,
    });

    check('multipart-binding-envelope-eight-workers', bindingReceipts.length === 8 &&
      bindingReceipts.every((entry) => entry.multipartMetadata.length === 1 &&
        [0, 1].includes(entry.uploadResponseBindings.length) && entry.bindingsEndpoint.length === 1), {
      scripts: bindingReceipts.map((entry) => entry.script),
      binding: { type: 'service', name: 'HOST', service: names.host },
      uploadResponseBindingCounts: bindingReceipts.map((entry) => entry.uploadResponseBindings.length),
      note: 'the current API omits bindings from upload responses; the dedicated bindings endpoint is authoritative',
    });

    for (const appId of ['app-a', 'app-b']) {
      for (const release of ['r1', 'r2']) {
        const result = await invoke(appId, release, 'handler', 'query', { value: 'safe-user-value' });
        check(`query-${appId}-${release}`, result.status === 200 && result.body?.ok === true &&
          result.body?.cap?.appId === appId && result.body?.cap?.release === release &&
          result.body?.cap?.environmentId === `${appId}-environment` && result.body?.cap?.objectId === 'root' &&
          result.body?.cap?.operation === 'query' && typeof result.body?.cap?.requestId === 'string' &&
          Number(result.body?.cap?.deadline) > Date.now(), {
          status: result.status,
          elapsedMs: result.elapsedMs,
          activationAttempts: result.activationAttempts,
          capability: result.body?.cap || null,
          responseCode: result.body?.code,
          responseCategory: result.body?.category,
          responseBody: result.body,
          applicationArgKeys: result.body?.applicationArgKeys || null,
        });
      }
    }

    const mutation = await invoke('app-a', 'r1', 'handler', 'mutation', { delta: 1 });
    const sharedRelease = await invoke('app-a', 'r2', 'handler', 'query');
    const isolatedApp = await invoke('app-b', 'r1', 'handler', 'query');
    check('app-isolation-release-shared-data', mutation.status === 200 && mutation.body?.value === 1 &&
      sharedRelease.body?.value === 1 && isolatedApp.body?.value === 0, {
      appAR1MutationValue: mutation.body?.value,
      appAR2QueryValue: sharedRelease.body?.value,
      appBR1QueryValue: isolatedApp.body?.value,
    });

    const retry1 = await invoke('app-a', 'r1', 'handler', 'mutation-retry', { delta: 1 });
    const retry2 = await invoke('app-a', 'r1', 'handler', 'mutation-retry', { delta: 1 });
    check('retry-idempotent-request-capability', retry1.status === 200 && retry2.status === 200 &&
      retry1.body?.value === 2 && retry2.body?.value === 2 && retry1.body?.replayed === false &&
      retry2.body?.replayed === true && retry1.body?.cap?.requestId === retry2.body?.cap?.requestId, {
      requestId: retry1.body?.cap?.requestId || null,
      first: { value: retry1.body?.value, replayed: retry1.body?.replayed },
      retry: { value: retry2.body?.value, replayed: retry2.body?.replayed },
    });

    const scopeArgs = await invoke('app-a', 'r1', 'handler', 'query', {
      value: 'safe', appId: 'app-b', objectId: 'other-root', release: 'r2',
    });
    check('user-arguments-cannot-carry-host-scope', scopeArgs.status === 400 &&
      scopeArgs.body?.code === 'SNAPBACK_HOST_SCOPE_ARGUMENT_FORBIDDEN', {
      status: scopeArgs.status,
      code: scopeArgs.body?.code,
      rejectedKeys: scopeArgs.body?.rejectedKeys,
    });

    const tamperApp = await invoke('app-a', 'r1', 'handler', 'tamper-app-capability');
    const tamperRelease = await invoke('app-a', 'r1', 'handler', 'tamper-release-capability');
    check('cross-app-capability-tamper-rejected', tamperApp.status === 401 &&
      tamperApp.body?.code === 'SNAPBACK_CAPABILITY_SIGNATURE_INVALID', {
      status: tamperApp.status, code: tamperApp.body?.code, responseBody: tamperApp.body,
    });
    check('cross-release-capability-tamper-rejected', tamperRelease.status === 401 &&
      tamperRelease.body?.code === 'SNAPBACK_CAPABILITY_SIGNATURE_INVALID', {
      status: tamperRelease.status, code: tamperRelease.body?.code, responseBody: tamperRelease.body,
    });

    const stale = await invoke('app-a', 'r1', 'handler', 'stale-capability');
    check('stale-capability-rejected', stale.status === 401 && stale.body?.code === 'SNAPBACK_CAPABILITY_STALE', {
      status: stale.status, code: stale.body?.code,
    });

    const deniedHandler = await invoke('app-a', 'r1', 'handler', 'ambient-fetch');
    const deniedGlobalHandler = await invoke('app-a', 'r1', 'handler', 'ambient-global-fetch');
    check('handler-ambient-network-denied', deniedHandler.status === 200 &&
      deniedHandler.body?.outboundStatus === 403 && deniedGlobalHandler.status === 200 &&
      deniedGlobalHandler.body?.outboundStatus === 403, {
      lexicalFetch: {
        status: deniedHandler.status,
        outboundStatus: deniedHandler.body?.outboundStatus,
        role: deniedHandler.body?.role || null,
      },
      globalFetch: {
        status: deniedGlobalHandler.status,
        outboundStatus: deniedGlobalHandler.body?.outboundStatus,
        role: deniedGlobalHandler.body?.role || null,
      },
      layer: 'generated handler harness freezes globalThis.fetch before handler code runs',
    });

    const allowedAction = await invoke('app-a', 'r1', 'action', 'allowlisted-fetch');
    const deniedAction = await invoke('app-a', 'r1', 'action', 'denied-action-fetch');
    check('action-allowlisted-fetch', allowedAction.status === 200 &&
      allowedAction.body?.outboundStatus === 200 && allowedAction.body?.role === 'action', {
      status: allowedAction.status,
      outboundStatus: allowedAction.body?.outboundStatus,
    });
    check('action-nonallowlisted-fetch-denied', deniedAction.status === 200 &&
      deniedAction.body?.outboundStatus === 403 && deniedAction.body?.role === 'action', {
      status: deniedAction.status,
      outboundStatus: deniedAction.body?.outboundStatus,
    });

    const slowStarted = performance.now();
    const slowActionPromise = invoke('app-a', 'r1', 'action', 'slow-action', { delayMs: 1_200 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const concurrentQuery = await invoke('app-a', 'r1', 'handler', 'query');
    const queryFinishedAt = performance.now();
    const slowAction = await slowActionPromise;
    const actionFinishedAt = performance.now();
    check('slow-action-does-not-block-handler-role', slowAction.status === 200 &&
      concurrentQuery.status === 200 && queryFinishedAt < actionFinishedAt, {
      actionStatus: slowAction.status,
      actionBody: slowAction.body,
      queryStatus: concurrentQuery.status,
      queryBody: concurrentQuery.body,
      queryElapsedMs: concurrentQuery.elapsedMs,
      queryFinishedAfterStartMs: Math.round(queryFinishedAt - slowStarted),
      actionFinishedAfterStartMs: Math.round(actionFinishedAt - slowStarted),
      actionScript: 'app-a-r1-action',
      handlerScript: 'app-a-r1-handler',
    });

    const queueProof = await dispatcherRequest('/queue-proof', { method: 'POST' });
    const queueResults = Array.isArray(queueProof.body?.results) ? queueProof.body.results : [];
    check('concurrency-and-queue-bounded', queueResults.filter((entry) => entry.status === 200).length === 4 &&
      queueResults.filter((entry) => entry.status === 429 && entry.body?.code === 'SNAPBACK_QUEUE_LIMIT').length === 1, {
      statuses: queueResults.map((entry) => entry.status),
      codes: queueResults.map((entry) => entry.body?.code || null),
      bodies: queueResults.map((entry) => entry.body),
      elapsedMs: queueProof.elapsedMs,
      activationAttempts: queueProof.activationAttempts,
      layer: 'dispatcher Durable Object admission gate',
    });

    const oversized = await invoke('app-a', 'r1', 'handler', 'oversized-response');
    check('response-size-limit', oversized.status === 413 && oversized.body?.code === 'SNAPBACK_RESPONSE_LIMIT' &&
      oversized.body?.limitBytes === RESPONSE_BYTES, {
      status: oversized.status,
      code: oversized.body?.code,
      observedBytes: oversized.body?.observedBytes,
      limitBytes: oversized.body?.limitBytes,
    });

    const subrequests = await invoke('app-a', 'r1', 'action', 'subrequest-bomb');
    check('generated-harness-subrequest-limit', subrequests.status === 429 &&
      subrequests.body?.code === 'SNAPBACK_SUBREQUEST_LIMIT' &&
      subrequests.body?.limit === SUBREQUESTS, {
      status: subrequests.status,
      code: subrequests.body?.code,
      category: subrequests.body?.category || null,
      responseBody: subrequests.body,
      elapsedMs: subrequests.elapsedMs,
      limit: SUBREQUESTS,
      layer: 'generated user-Worker harness before outbound Worker handoff',
      nativeControlReceipt: 'demos/eas-phase0/receipts/p0.1-wfp-minimal-control.json',
    });

    const cpuAttempts = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await invoke('app-a', 'r1', 'handler', 'cpu-spin');
      cpuAttempts.push({ attempt, ...result });
      if (result.status >= 500) break;
    }
    const cpuTermination = cpuAttempts.find((entry) => entry.status >= 500 &&
      ['SNAPBACK_USER_WORKER_FAILED', 'SNAPBACK_USER_WORKER_RESPONSE_FAILED'].includes(entry.body?.code) &&
      /cpu|limit|resource|exceed/iu.test(String(entry.body?.category || '')));
    check('native-wfp-cpu-termination', Boolean(cpuTermination), {
      attempts: cpuAttempts,
      cpuMs: CPU_MS,
      finiteBurnIterationsPerAttempt: 200_000_000,
      semantics: 'Cloudflare documents isolate flexibility for occasional CPU overages; repeat a calibrated finite burn and require an observed native termination',
    });
  } catch (error) {
    fatal = safeMessage(error, accountId);
    process.stderr.write(`${fatal}\n`);
  } finally {
    if (created.workers.includes(names.dispatcher)) {
      await deletePath(`Worker ${names.dispatcher}`,
        `/accounts/${accountId}/workers/scripts/${encodeURIComponent(names.dispatcher)}?force=true`);
    }
    if (created.namespace) {
      await deletePath(`dispatch namespace ${options.namespace}`,
        `/accounts/${accountId}/workers/dispatch/namespaces/${encodeURIComponent(options.namespace)}`);
    }
    for (const name of [names.host, names.outbound]) {
      if (created.workers.includes(name)) {
        await deletePath(`Worker ${name}`,
          `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}?force=true`);
      }
    }
  }

  receipt.postCleanupAbsence = [];
  for (const [resource, pathname] of [
    [`Worker ${names.dispatcher}`, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(names.dispatcher)}`],
    [`dispatch namespace ${options.namespace}`, `/accounts/${accountId}/workers/dispatch/namespaces/${encodeURIComponent(options.namespace)}`],
    [`Worker ${names.host}`, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(names.host)}`],
    [`Worker ${names.outbound}`, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(names.outbound)}`],
  ]) {
    try {
      const response = await fetch(`${API}${pathname}`, { headers: authHeaders() });
      await response.arrayBuffer();
      receipt.postCleanupAbsence.push({ resource, status: response.status, absent: response.status === 404 });
    } catch (error) {
      receipt.postCleanupAbsence.push({
        resource,
        status: null,
        absent: false,
        error: safeMessage(error, accountId),
      });
    }
  }

  receipt.finishedAt = new Date().toISOString();
  receipt.durationMs = Date.parse(receipt.finishedAt) - Date.parse(startedAt);
  receipt.namespaceLifecycle = {
    created: created.namespace,
    scriptsUploaded: created.namespaceScripts,
    deleted: cleanup.some((entry) => entry.resource === `dispatch namespace ${options.namespace}` && entry.deleted),
  };
  receipt.verdict = !fatal && checks.length >= 21 && checks.every((entry) => entry.pass) &&
    cleanup.every((entry) => entry.deleted) &&
    receipt.postCleanupAbsence.every((entry) => entry.absent && entry.status === 404)
    ? 'PASS: real WfP namespace, exact HOST-only user-Worker bindings, two-app/two-release isolation, action egress, retry, stale/tamper refusal, native CPU termination, and fail-closed resource limits witnessed; disposable resources deleted'
    : 'FAIL';
  if (fatal) receipt.failure = fatal;
  mkdirSync(path.dirname(options.receipt), { recursive: true });
  writeFileSync(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${receipt.verdict}\nreceipt: ${options.receipt}\n`);
  if (receipt.verdict === 'FAIL') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});
