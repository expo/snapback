// LLP 0087 Phase 0 micro-spike: Worker Loader + DO Facets under the repo's
// pinned Miniflare. Verifies: (1) workerLoaders binding works locally,
// (2) a supervisor DO can start a facet from runtime-supplied code,
// (3) the facet has its own SQLite, isolated from the supervisor's,
// (4) facets.abort/delete lifecycle behaves as documented.
import { Miniflare } from "miniflare";

// Runtime-supplied "app code" — this string is what would live in storage in
// the real design. It defines a DO class used as a facet.
const APP_CODE = `
export class AppFacet {
  constructor(ctx, env) { this.ctx = ctx; }
  async fetch(request) {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, body TEXT)");
    const url = new URL(request.url);
    if (url.pathname === "/write") {
      sql.exec("INSERT INTO notes(body) VALUES (?)", url.searchParams.get("body"));
      return new Response("ok");
    }
    if (url.pathname === "/read") {
      const rows = [...sql.exec("SELECT body FROM notes ORDER BY id")];
      return Response.json(rows.map(r => r.body));
    }
    if (url.pathname === "/tables") {
      const rows = [...sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")];
      return Response.json(rows.map(r => r.name));
    }
    if (url.pathname === "/egress") {
      try {
        const res = await fetch("https://example.com/");
        return new Response("EGRESS-ALLOWED status=" + res.status);
      } catch (err) {
        return new Response("EGRESS-DENIED " + String(err), { status: 502 });
      }
    }
    return new Response("nope", { status: 404 });
  }
}
export default { fetch() { return new Response("app worker root"); } };
`;

const SUPERVISOR = `
import { DurableObject } from "cloudflare:workers";
export class Supervisor extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS supervisor_meta(k TEXT PRIMARY KEY, v TEXT)");
    sql.exec("INSERT OR REPLACE INTO supervisor_meta(k, v) VALUES ('role', 'supervisor')");

    // Load app code dynamically (in the real design: fetched from storage).
    const worker = this.env.LOADER.get("app-v1", async () => ({
      compatibilityDate: "2026-07-01",
      mainModule: "app.js",
      modules: { "app.js": this.env.APP_CODE },
      globalOutbound: null, // no egress for app code
    }));

    if (url.pathname === "/abort") {
      this.ctx.facets.abort("app", new Error("spike-abort"));
      return new Response("aborted");
    }
    if (url.pathname === "/delete") {
      this.ctx.facets.delete("app");
      return new Response("deleted");
    }
    if (url.pathname === "/sup-tables") {
      const rows = [...sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")];
      return Response.json(rows.map(r => r.name));
    }

    const facet = this.ctx.facets.get("app", async () => ({
      class: worker.getDurableObjectClass("AppFacet"),
    }));
    return facet.fetch(request);
  }
}
export default {
  async fetch(request, env) {
    const id = env.SUP.idFromName("spike");
    return env.SUP.get(id).fetch(request);
  },
};
`;

const mf = new Miniflare({
  compatibilityDate: "2026-07-01",
  modules: [{ type: "ESModule", path: "supervisor.js", contents: SUPERVISOR }],
  durableObjects: { SUP: { className: "Supervisor", useSQLite: true } },
  workerLoaders: { LOADER: {} },
  bindings: { APP_CODE },
});

const get = async (path) => {
  const res = await mf.dispatchFetch(`http://spike${path}`);
  return { status: res.status, body: await res.text() };
};

const results = {};
try {
  results.write1 = await get("/write?body=hello-from-facet");
  results.write2 = await get("/write?body=second-row");
  results.read = await get("/read");
  results.facetTables = await get("/tables");       // should show notes, NOT supervisor_meta
  results.egress = await get("/egress");            // globalOutbound: null → must be denied
  results.supTables = await get("/sup-tables");     // should show supervisor_meta, NOT notes
  results.abort = await get("/abort");
  results.readAfterAbort = await get("/read");      // restart via get(): rows should persist
  results.del = await get("/delete");
  results.readAfterDelete = await get("/read");     // fresh DB: rows should be gone
} catch (err) {
  results.error = String(err && err.stack || err);
}
console.log(JSON.stringify(results, null, 2));
await mf.dispose();
