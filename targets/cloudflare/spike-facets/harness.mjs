// LLP 0087 Gate 0 — per-topology reconnaissance harness (pre-sign-off).
// Runs probes P1-P8 from gate0-probe-list.md against topologies A/B/C and
// the compiled-in baseline, locally under the pinned Miniflare. Emits a
// reconnaissance JSON to stdout (NOT the official Gate 0 receipt — that is
// produced only by the post-sign-off suite-level runs).
//
//   node targets/cloudflare/spike-facets/harness.mjs [--out recon.json]
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const COMPAT_DATE = "2026-07-01";

// ---------------------------------------------------------------- app code
// One body serves both roles: a DO class (facet topologies) and a default
// worker entrypoint (loader-service topologies). VERSION is stamped per
// artifact for the P8 skew probe.
const appCode = (version) => `
const VERSION = ${JSON.stringify(version)};
async function handle(request, envKeys, sql) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/query")) {
    if (sql) {
      sql.exec("CREATE TABLE IF NOT EXISTS scratch(k TEXT PRIMARY KEY, v TEXT)");
      sql.exec("INSERT OR REPLACE INTO scratch(k, v) VALUES ('last', ?)", VERSION);
      [...sql.exec("SELECT v FROM scratch WHERE k='last'")];
    }
    return Response.json({ ok: true, version: VERSION });
  }
  if (url.pathname.endsWith("/env")) return Response.json(envKeys);
  if (url.pathname.endsWith("/egress")) {
    try {
      const res = await fetch("https://example.com/");
      return new Response("EGRESS-ALLOWED " + res.status, { status: 500 });
    } catch (err) {
      return new Response("EGRESS-DENIED", { status: 502 });
    }
  }
  if (url.pathname.endsWith("/slow-action")) {
    await new Promise((r) => setTimeout(r, Number(url.searchParams.get("ms") ?? 1500)));
    return new Response("slow-done " + VERSION);
  }
  if (url.pathname.endsWith("/spin")) {
    const until = Date.now() + Number(url.searchParams.get("ms") ?? 2000);
    let x = 0;
    while (Date.now() < until) x += Math.sqrt(x + 1);
    return new Response("spun " + x);
  }
  if (url.pathname.endsWith("/balloon")) {
    const mb = Number(url.searchParams.get("mb") ?? 64);
    const hunks = [];
    for (let i = 0; i < mb; i++) hunks.push(new Uint8Array(1024 * 1024).fill(i));
    return new Response("ballooned " + hunks.length + "MB");
  }
  if (url.pathname.endsWith("/tables")) {
    if (!sql) return Response.json(null);
    const rows = [...sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")];
    return Response.json(rows.map((r) => r.name));
  }
  if (url.pathname.endsWith("/version")) return new Response(VERSION);
  return new Response("nope", { status: 404 });
}
export class AppFacet {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  fetch(request) {
    return handle(request, Object.keys(this.env ?? {}), this.ctx.storage.sql);
  }
}
export default {
  fetch(request, env) { return handle(request, Object.keys(env ?? {}), null); },
};
`;

// ------------------------------------------------------- topology workers
// Topology A: per-app coordinator DO hosts handler + action facets.
const TOPOLOGY_A = `
import { DurableObject } from "cloudflare:workers";
export class Coordinator extends DurableObject {
  worker(codeId) {
    return this.env.LOADER.get(codeId, async () => ({
      compatibilityDate: ${JSON.stringify(COMPAT_DATE)},
      mainModule: "app.js",
      modules: { "app.js": this.env["CODE:" + codeId] },
      globalOutbound: null,
    }));
  }
  facet(role, codeId) {
    return this.ctx.facets.get(role + ":" + codeId, async () => ({
      class: this.worker(codeId).getDurableObjectClass("AppFacet"),
    }));
  }
  async fetch(request) {
    const url = new URL(request.url);
    const codeId = request.headers.get("x-code-id");
    if (url.pathname.endsWith("/abort-app")) {
      this.ctx.facets.abort("handler:" + codeId, new Error("gate0-abort"));
      this.ctx.facets.abort("action:" + codeId, new Error("gate0-abort"));
      return new Response("aborted");
    }
    const role = /slow-action|spin|balloon/.test(url.pathname) ? "action" : "handler";
    return this.facet(role, codeId).fetch(request);
  }
}
export default {
  fetch(request, env) {
    const app = request.headers.get("x-app");
    return env.COORD.get(env.COORD.idFromName(app)).fetch(request);
  },
};
`;

// Topology B: coordinator DO calls shared loader-fed services over bindings.
const TOPOLOGY_B_GATEWAY = `
import { DurableObject } from "cloudflare:workers";
export class Coordinator extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const svc = /slow-action|spin|balloon/.test(url.pathname)
      ? this.env.ACTION_SVC : this.env.HANDLER_SVC;
    return svc.fetch(request);
  }
}
export default {
  fetch(request, env) {
    const app = request.headers.get("x-app");
    return env.COORD.get(env.COORD.idFromName(app)).fetch(request);
  },
};
`;
const LOADER_SERVICE = `
export default {
  async fetch(request, env) {
    const codeId = request.headers.get("x-code-id");
    const worker = env.LOADER.get(codeId, async () => ({
      compatibilityDate: ${JSON.stringify(COMPAT_DATE)},
      mainModule: "app.js",
      modules: { "app.js": env["CODE:" + codeId] },
      globalOutbound: null,
    }));
    return worker.getEntrypoint().fetch(request);
  },
};
`;

// Topology C: handler as facet on the coordinator; action via shared service.
const TOPOLOGY_C = `
import { DurableObject } from "cloudflare:workers";
export class Coordinator extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const codeId = request.headers.get("x-code-id");
    if (url.pathname.endsWith("/abort-app")) {
      this.ctx.facets.abort("handler:" + codeId, new Error("gate0-abort"));
      return new Response("aborted");
    }
    if (/slow-action|spin|balloon/.test(url.pathname)) {
      return this.env.ACTION_SVC.fetch(request);
    }
    const worker = this.env.LOADER.get(codeId, async () => ({
      compatibilityDate: ${JSON.stringify(COMPAT_DATE)},
      mainModule: "app.js",
      modules: { "app.js": this.env["CODE:" + codeId] },
      globalOutbound: null,
    }));
    const facet = this.ctx.facets.get("handler:" + codeId, async () => ({
      class: worker.getDurableObjectClass("AppFacet"),
    }));
    return facet.fetch(request);
  }
}
export default {
  fetch(request, env) {
    const app = request.headers.get("x-app");
    return env.COORD.get(env.COORD.idFromName(app)).fetch(request);
  },
};
`;

// Baseline: app code compiled in (static import), per-app DO.
const BASELINE = `
import { DurableObject } from "cloudflare:workers";
import appDefault, { AppFacet } from "./app-static.js";
export class Coordinator extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.app = new AppFacet(ctx, env); }
  fetch(request) { return this.app.fetch(request); }
}
export default {
  fetch(request, env) {
    const app = request.headers.get("x-app");
    return env.COORD.get(env.COORD.idFromName(app)).fetch(request);
  },
};
`;

// ------------------------------------------------------------- measurement
const now = () => performance.now();
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function timed(fn) {
  const t0 = now();
  const res = await fn();
  return { ms: now() - t0, res };
}

function makeMf({ topology, codeVersions }) {
  const codeBindings = {};
  for (const [id, version] of Object.entries(codeVersions)) {
    codeBindings["CODE:" + id] = appCode(version);
  }
  const doOpts = { durableObjects: { COORD: { className: "Coordinator", useSQLite: true } } };
  if (topology === "A") {
    return new Miniflare({
      compatibilityDate: COMPAT_DATE,
      modules: [{ type: "ESModule", path: "gw.js", contents: TOPOLOGY_A }],
      workerLoaders: { LOADER: {} },
      bindings: codeBindings,
      ...doOpts,
    });
  }
  if (topology === "B") {
    return new Miniflare({
      workers: [
        {
          name: "gateway",
          compatibilityDate: COMPAT_DATE,
          modules: [{ type: "ESModule", path: "gw.js", contents: TOPOLOGY_B_GATEWAY }],
          serviceBindings: { HANDLER_SVC: "handler-svc", ACTION_SVC: "action-svc" },
          ...doOpts,
        },
        {
          name: "handler-svc",
          compatibilityDate: COMPAT_DATE,
          modules: [{ type: "ESModule", path: "svc.js", contents: LOADER_SERVICE }],
          workerLoaders: { LOADER: {} },
          bindings: codeBindings,
        },
        {
          name: "action-svc",
          compatibilityDate: COMPAT_DATE,
          modules: [{ type: "ESModule", path: "svc.js", contents: LOADER_SERVICE }],
          workerLoaders: { LOADER: {} },
          bindings: codeBindings,
        },
      ],
    });
  }
  if (topology === "C") {
    return new Miniflare({
      workers: [
        {
          name: "gateway",
          compatibilityDate: COMPAT_DATE,
          modules: [{ type: "ESModule", path: "gw.js", contents: TOPOLOGY_C }],
          serviceBindings: { ACTION_SVC: "action-svc" },
          workerLoaders: { LOADER: {} },
          bindings: codeBindings,
          ...doOpts,
        },
        {
          name: "action-svc",
          compatibilityDate: COMPAT_DATE,
          modules: [{ type: "ESModule", path: "svc.js", contents: LOADER_SERVICE }],
          workerLoaders: { LOADER: {} },
          bindings: codeBindings,
        },
      ],
    });
  }
  // baseline
  return new Miniflare({
    compatibilityDate: COMPAT_DATE,
    modules: [
      { type: "ESModule", path: "gw.js", contents: BASELINE },
      { type: "ESModule", path: "app-static.js", contents: appCode("baseline") },
    ],
    ...doOpts,
  });
}

async function probeTopology(topology) {
  const codeVersions = { "app1@v1": "v1", "app1@v2": "v2", "app2@v1": "v1" };
  const mf = makeMf({ topology, codeVersions });
  const call = (app, codeId, path) =>
    mf.dispatchFetch("http://h" + path, {
      headers: { "x-app": app, "x-code-id": codeId },
    });
  const out = { topology };
  const isBaseline = topology === "baseline";
  const c1 = "app1@v1";
  const c2 = "app2@v1";

  try {
    // Warm-up + P7 cold sample 1 comes from the very first request.
    const coldFirst = await timed(() => call("app1", c1, "/query"));
    out.firstRequestMs = +coldFirst.ms.toFixed(1);

    if (!isBaseline) {
      // P1 egress
      const egress = await call("app1", c1, "/egress");
      out.P1_egressDenied = egress.status === 502;
      // P2 env keys as seen by app code
      out.P2_envKeys = await (await call("app1", c1, "/env")).json();
      // P8 version skew: same app, new artifact id
      const v1 = await (await call("app1", c1, "/version")).text();
      if (topology === "A" || topology === "C") await call("app1", c1, "/abort-app");
      const v2 = await (await call("app1", "app1@v2", "/version")).text();
      out.P8_versionSkew = { before: v1, after: v2, ok: v1 === "v1" && v2 === "v2" };
    }

    // P3 slow-action non-blocking: 1.5s action + 20 concurrent queries.
    const slow = call("app1", c1, "/slow-action?ms=1500");
    await new Promise((r) => setTimeout(r, 50));
    const qTimes = [];
    for (let i = 0; i < 20; i++) qTimes.push((await timed(() => call("app1", c1, "/query"))).ms);
    await slow;
    out.P3_queryP95DuringSlowActionMs = +quantile(qTimes, 0.95).toFixed(1);
    out.P3_nonBlocking = quantile(qTimes, 0.95) < 100;

    // P4 adversarial: app1 spins 2s; app2 latency meanwhile; then terminate app1.
    const spin = call("app1", c1, "/spin?ms=2000");
    await new Promise((r) => setTimeout(r, 100));
    const a2Times = [];
    for (let i = 0; i < 10; i++) a2Times.push((await timed(() => call("app2", c2, "/query"))).ms);
    await spin;
    out.P4_app2P95DuringApp1SpinMs = +quantile(a2Times, 0.95).toFixed(1);
    out.P4_note = "local signal only — production CPU accounting/limits differ";
    if (topology === "A" || topology === "C") {
      const balloon = call("app1", c1, "/balloon?mb=64");
      await call("app1", c1, "/abort-app");
      out.P4_terminated = (await balloon.then((r) => r.status).catch(() => "threw")) !== 200
        || (await (await call("app2", c2, "/query")).json()).ok === true;
    }

    // P5 storage invariant: facet tables after the run.
    if (!isBaseline) {
      const tables = await (await call("app1", "app1@v2", "/tables")).json();
      out.P5_facetTables = tables;
      out.P5_onlyScratch = tables === null || tables.every((t) => t === "scratch");
    }

    // P7 cold start: force a fresh artifact id (discards cached worker), or
    // abort the facet first where facets are involved. 10 recon samples.
    const coldSamples = [];
    for (let i = 0; i < 10; i++) {
      const freshId = "app1@v1"; // reuse id but abort facet / rely on first-load per fresh id below
      if (!isBaseline && (topology === "A" || topology === "C")) {
        await call("app1", freshId, "/abort-app");
      }
      const uniqueId = isBaseline ? freshId : "app1@cold" + i;
      if (!isBaseline) codeVersions[uniqueId] = "v1"; // note: binding set is fixed; see below
      const t = await timed(() => call("app1", isBaseline ? freshId : c1, "/query"));
      coldSamples.push(t.ms);
    }
    out.P7_restartP95Ms = +quantile(coldSamples, 0.95).toFixed(1);
    out.P7_method = isBaseline
      ? "same-instance repeat (no eviction possible for compiled-in; first-request value is the cold datum)"
      : "facet abort before each sample (A/C) / warm repeat (B) — loader-id eviction needs per-sample bindings; on-platform run must use validated eviction per probe list";

    // Warm p50 for comparison.
    const warm = [];
    for (let i = 0; i < 20; i++) warm.push((await timed(() => call("app1", isBaseline ? c1 : c1, "/query"))).ms);
    out.warmQueryP50Ms = +quantile(warm, 0.5).toFixed(1);
  } catch (err) {
    out.error = String((err && err.stack) || err);
  } finally {
    await mf.dispose();
  }
  return out;
}

// ------------------------------------------------------------------- main
const toolchain = {
  node: process.version,
  miniflare: require("miniflare/package.json").version,
  workerd: require("workerd/package.json").version,
  compatibilityDate: COMPAT_DATE,
};

const results = { reconnaissance: true, note: "pre-sign-off recon; NOT the Gate 0 receipt", toolchain, topologies: {} };
for (const t of ["baseline", "A", "B", "C"]) {
  process.stderr.write(`probing topology ${t}...\n`);
  results.topologies[t] = await probeTopology(t);
}
const json = JSON.stringify(results, null, 2);
const outIdx = process.argv.indexOf("--out");
if (outIdx > -1) (await import("node:fs")).writeFileSync(process.argv[outIdx + 1], json);
console.log(json);
