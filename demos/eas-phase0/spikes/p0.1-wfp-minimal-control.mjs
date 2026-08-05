#!/usr/bin/env node
// Minimal real-account control for the two P0.1 Cloudflare observations.
//
// The topology deliberately matches Cloudflare's custom-limits example: one
// ordinary dynamic dispatcher, one binding-free user Worker, and one dispatch
// namespace. It also records workers.dev control-plane, DNS, cache, and Ray-ID
// evidence while waiting for a stable public route.
//
// @ref LLP 0105#p01-wfp-handler-and-host-bridge — native CPU/subrequest
// enforcement must be proved independently of Snapback's HOST/outbound bridge.
// @ref LLP 0047#acceptance — a configured limit counts only when a real user
// Worker is terminated at the requested ceiling.

import { createHash, randomBytes } from 'node:crypto';
import { resolve4, resolve6 } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const DEFAULT_NAMESPACE = 'eas-p0-limits-20260804';
const COMPATIBILITY_DATE = '2026-07-01';
const CPU_MS = 20;
const SUBREQUESTS = 5;
const EDGE_PROBE_CONCURRENCY = 8;
const EDGE_STABLE_ROUNDS = 3;
const EDGE_MAX_ROUNDS = 90;
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultReceipt = path.resolve(here, '../receipts/p0.1-wfp-minimal-control.json');

function parseArgs(argv) {
  const parsed = { namespace: DEFAULT_NAMESPACE, receipt: defaultReceipt };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--namespace') parsed.namespace = argv[++index];
    else if (flag === '--receipt') parsed.receipt = path.resolve(argv[++index]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!/^eas-p0-limits-[0-9]{8}$/.test(parsed.namespace || '')) {
    throw new Error('--namespace must match eas-p0-limits-YYYYMMDD');
  }
  return parsed;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeMessage(error, accountId) {
  return String(error?.message || error || 'unknown error')
    .replaceAll(accountId, '<account-id>')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gu, 'Bearer <redacted>')
    .slice(0, 1_000);
}

function userWorkerSource() {
  return `
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/noop") return json(200, { ok: true });
    if (path === "/subrequests") {
      for (let index = 0; index < 12; index += 1) {
        const response = await fetch("https://example.com/?wfp-minimal-subrequest=" + index);
        await response.arrayBuffer();
      }
      return json(200, { ok: true, unexpected: "subrequest limit did not fire", completed: 12 });
    }
    if (path === "/cpu") {
      let checksum = 2_166_136_261;
      const witness = new Uint32Array(256);
      for (let index = 0; index < 200_000_000; index += 1) {
        checksum = Math.imul(checksum ^ (index + witness[index & 255]), 16_777_619) >>> 0;
        if ((index & 1_048_575) === 0) witness[(index >>> 20) & 255] = checksum;
      }
      return json(200, { ok: true, unexpected: "CPU limit did not fire", checksum });
    }
    return json(404, { ok: false });
  },
};
`;
}

function dispatcherWorkerSource(scriptName) {
  return `
const SCRIPT_NAME = ${JSON.stringify(scriptName)};

export default {
  async fetch(request, env) {
    try {
      const worker = env.DISPATCHER.get(SCRIPT_NAME, {}, {
        limits: { cpuMs: ${CPU_MS}, subRequests: ${SUBREQUESTS} },
      });
      return await worker.fetch(request);
    } catch (error) {
      return new Response(JSON.stringify({
        ok: false,
        caught: true,
        name: String(error?.name || "Error").slice(0, 120),
        message: String(error?.message || error).slice(0, 500),
      }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  },
};
`;
}

function responseEvidence(response, body, elapsedMs) {
  return {
    status: response.status,
    body,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    cfRay: response.headers.get('cf-ray'),
    cfCacheStatus: response.headers.get('cf-cache-status'),
    age: response.headers.get('age'),
    server: response.headers.get('server'),
  };
}

async function fetchEvidence(url, init) {
  const started = performance.now();
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 500) }; }
  return responseEvidence(response, body, performance.now() - started);
}

function isGeneratedNotFound(entry) {
  return entry.status >= 404 && typeof entry.body?.text === 'string' &&
    /(?:Page|Script) not found/iu.test(entry.body.text);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-hex account id');
  if (apiToken.length < 24) throw new Error('CLOUDFLARE_API_TOKEN is missing or implausibly short');

  const startedAt = new Date().toISOString();
  const runId = randomBytes(3).toString('hex');
  const userScript = `limits-control-${runId}`;
  const dispatcher = `snapback-eas-limits-${options.namespace.slice(-8)}-${runId}`;
  const namespacePath = `/accounts/${accountId}/workers/dispatch/namespaces/${encodeURIComponent(options.namespace)}`;
  const userPath = `${namespacePath}/scripts/${encodeURIComponent(userScript)}`;
  const dispatcherPath = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(dispatcher)}`;
  const cleanup = [];
  const created = { namespace: false, userScript: false, dispatcher: false };
  let fatal = null;
  let baseUrl = null;

  const receipt = {
    receipt: 'eas-phase0/p0.1/wfp-minimal-control',
    date: startedAt.slice(0, 10),
    startedAt,
    command: `CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_API_TOKEN=<token> node demos/eas-phase0/spikes/p0.1-wfp-minimal-control.mjs --namespace ${options.namespace}`,
    authority: {
      plan: 'LLP 0105 §P0.1 WfP handler and host bridge',
      security: 'LLP 0047 §Acceptance',
    },
    cloudflare: {
      accountIdRedacted: true,
      namespace: options.namespace,
      runId,
      userScript,
      dispatcher,
      compatibilityDate: COMPATIBILITY_DATE,
      apiDocs: [
        'https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/custom-limits/',
        'https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/',
      ],
    },
    topology: {
      ordinaryWorkers: [dispatcher],
      userWorkers: [userScript],
      userWorkerBindings: [],
      dispatcherBindings: [{ type: 'dispatch_namespace', name: 'DISPATCHER', namespace: options.namespace }],
      outboundWorker: false,
      hostBinding: false,
    },
    limits: { cpuMs: CPU_MS, subRequests: SUBREQUESTS },
    sourceSha256: {
      user: sha256(userWorkerSource()),
      dispatcher: sha256(dispatcherWorkerSource(userScript)),
    },
    activation: null,
    probes: { noop: null, subrequests: [], cpu: [] },
    cleanup,
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
    if (allow404 && response.status === 404) return { absent: true, status: 404 };
    if (!response.ok || payload?.success === false) {
      const details = Array.isArray(payload?.errors)
        ? payload.errors.map((entry) => `${entry.code || 'error'}:${entry.message || 'unknown'}`).join(', ')
        : `HTTP ${response.status}`;
      throw new Error(`${method} ${pathname.replaceAll(accountId, '<account-id>')} failed: ${details}`);
    }
    return { result: payload?.result ?? payload, status: response.status };
  }

  async function upload(pathname, metadata, source) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('worker.mjs', new Blob([source], { type: 'application/javascript+module' }), 'worker.mjs');
    return api(pathname, { method: 'PUT', body: form });
  }

  async function deletePath(resource, pathname) {
    try {
      await api(pathname, { method: 'DELETE', allow404: true });
      cleanup.push({ resource, deleted: true });
    } catch (error) {
      cleanup.push({ resource, deleted: false, error: safeMessage(error, accountId) });
    }
  }

  async function uniqueProbe(pathname) {
    const nonce = randomBytes(8).toString('hex');
    const separator = pathname.includes('?') ? '&' : '?';
    return fetchEvidence(`${baseUrl}${pathname}${separator}probe=${nonce}`, {
      headers: { 'cache-control': 'no-cache, no-store', pragma: 'no-cache' },
    });
  }

  try {
    if (!(await api(namespacePath, { allow404: true })).absent) {
      throw new Error(`refusing to reuse existing namespace ${options.namespace}`);
    }
    if (!(await api(dispatcherPath, { allow404: true })).absent) {
      throw new Error(`refusing to reuse existing Worker ${dispatcher}`);
    }

    await api(`/accounts/${accountId}/workers/dispatch/namespaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: options.namespace }),
    });
    created.namespace = true;

    await upload(userPath, {
      main_module: 'worker.mjs',
      compatibility_date: COMPATIBILITY_DATE,
      compatibility_flags: [],
      bindings: [],
      tags: ['eas-p0-spike', 'disposable', 'minimal-control'],
    }, userWorkerSource());
    created.userScript = true;

    const bindings = await api(`${userPath}/bindings`);
    receipt.topology.userWorkerBindingsReadBack = bindings.result;
    if (!Array.isArray(bindings.result) || bindings.result.length !== 0) {
      throw new Error('minimal user Worker unexpectedly retained bindings');
    }

    await upload(dispatcherPath, {
      main_module: 'worker.mjs',
      compatibility_date: COMPATIBILITY_DATE,
      compatibility_flags: [],
      bindings: [{
        type: 'dispatch_namespace',
        name: 'DISPATCHER',
        namespace: options.namespace,
      }],
    }, dispatcherWorkerSource(userScript));
    created.dispatcher = true;

    const enabled = await api(`${dispatcherPath}/subdomain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });
    const enabledReadBack = await api(`${dispatcherPath}/subdomain`);
    const accountSubdomain = await api(`/accounts/${accountId}/workers/subdomain`);
    const hostname = `${dispatcher}.${accountSubdomain.result?.subdomain}.workers.dev`;
    baseUrl = `https://${hostname}`;
    receipt.cloudflare.dispatcherUrl = baseUrl;

    const dns = { ipv4: [], ipv6: [], errors: [] };
    await Promise.all([
      resolve4(hostname).then((values) => { dns.ipv4 = values; }).catch((error) => {
        dns.errors.push({ family: 4, message: safeMessage(error, accountId) });
      }),
      resolve6(hostname).then((values) => { dns.ipv6 = values; }).catch((error) => {
        dns.errors.push({ family: 6, message: safeMessage(error, accountId) });
      }),
    ]);

    const rounds = [];
    let consecutiveStableRounds = 0;
    for (let round = 1;
      round <= EDGE_MAX_ROUNDS && consecutiveStableRounds < EDGE_STABLE_ROUNDS;
      round += 1) {
      const results = await Promise.all(
        Array.from({ length: EDGE_PROBE_CONCURRENCY }, () => uniqueProbe('/noop')),
      );
      const stable = results.every((entry) => entry.status === 200 && entry.body?.ok === true);
      consecutiveStableRounds = stable ? consecutiveStableRounds + 1 : 0;
      rounds.push({
        round,
        stable,
        results: results.map(({ body, ...evidence }) => ({
          ...evidence,
          generatedNotFound: isGeneratedNotFound({ ...evidence, body }),
        })),
      });
      if (consecutiveStableRounds < EDGE_STABLE_ROUNDS) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    receipt.activation = {
      controlPlanePost: enabled.result,
      controlPlaneReadBack: enabledReadBack.result,
      dns,
      concurrency: EDGE_PROBE_CONCURRENCY,
      requiredConsecutiveStableRounds: EDGE_STABLE_ROUNDS,
      maxRounds: EDGE_MAX_ROUNDS,
      consecutiveStableRounds,
      stable: consecutiveStableRounds >= EDGE_STABLE_ROUNDS,
      rounds,
      generatedNotFoundCount: rounds.flatMap((entry) => entry.results)
        .filter((entry) => entry.generatedNotFound).length,
    };
    if (!receipt.activation.stable) throw new Error('workers.dev did not reach the stable readiness barrier');

    receipt.probes.noop = await uniqueProbe('/noop');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      receipt.probes.subrequests.push({ attempt, ...(await uniqueProbe('/subrequests')) });
    }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await uniqueProbe('/cpu');
      receipt.probes.cpu.push({ attempt, ...result });
      if (result.status >= 500) break;
    }
  } catch (error) {
    fatal = safeMessage(error, accountId);
    process.stderr.write(`${fatal}\n`);
  } finally {
    if (created.dispatcher) await deletePath(`Worker ${dispatcher}`, `${dispatcherPath}?force=true`);
    if (created.namespace) await deletePath(`dispatch namespace ${options.namespace}`, namespacePath);

    const absence = {};
    for (const [resource, pathname] of [
      ['dispatcher', dispatcherPath],
      ['namespace', namespacePath],
    ]) {
      try {
        const result = await api(pathname, { allow404: true });
        absence[resource] = { status: result.status, absent: result.absent === true };
      } catch (error) {
        absence[resource] = { status: null, absent: false, error: safeMessage(error, accountId) };
      }
    }
    receipt.postCleanupAbsence = absence;
  }

  const limitFailure = (entry, pattern) => entry.status >= 500 &&
    (entry.body?.caught === true || typeof entry.body?.text === 'string') && pattern.test(
      `${entry.body?.message || ''} ${entry.body?.text || ''}`,
    );
  const subrequestsPass = receipt.probes.subrequests.length > 0 &&
    receipt.probes.subrequests.every((entry) => limitFailure(entry, /subrequest|limit|resource/iu));
  const cpuPass = receipt.probes.cpu.some((entry) => limitFailure(entry, /cpu|limit|resource|exceed/iu));
  const cleanupPass = cleanup.every((entry) => entry.deleted) &&
    Object.values(receipt.postCleanupAbsence).every((entry) => entry.absent && entry.status === 404);
  receipt.checks = [
    { id: 'workers-dev-stable-readiness', pass: receipt.activation?.stable === true },
    { id: 'binding-free-user-worker', pass: receipt.topology.userWorkerBindingsReadBack?.length === 0 },
    { id: 'native-wfp-subrequest-limit-minimal', pass: subrequestsPass, evidence: receipt.probes.subrequests },
    { id: 'native-wfp-cpu-limit-minimal', pass: cpuPass, evidence: receipt.probes.cpu },
    { id: 'post-cleanup-absence', pass: cleanupPass, evidence: receipt.postCleanupAbsence },
  ];
  receipt.finishedAt = new Date().toISOString();
  receipt.durationMs = Date.parse(receipt.finishedAt) - Date.parse(startedAt);
  receipt.verdict = !fatal && receipt.checks.every((entry) => entry.pass) ? 'PASS' : 'FAIL';
  if (fatal) receipt.failure = fatal;
  mkdirSync(path.dirname(options.receipt), { recursive: true });
  writeFileSync(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  for (const check of receipt.checks) {
    process.stdout.write(`${check.pass ? 'ok' : 'not ok'} - ${check.id}\n`);
  }
  process.stdout.write(`${receipt.verdict}\nreceipt: ${options.receipt}\n`);
  if (receipt.verdict !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});
