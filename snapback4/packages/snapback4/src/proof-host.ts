// @ref LLP 3000.011.003.000.000#1 — bind first, retain the listener and identify the frontend over HTTP.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const [kind, directory, ports, vitePath] = process.argv.slice(2);
if (!directory || !ports || !["static", "vite"].includes(kind!)) throw Error("invalid proof host invocation");
// @ref LLP 3000.011.003.000.000#8 — missing-export errors flush before keeper cleanup.
// Validate the static export before creating a keeper: an error must flush
// before group cleanup can terminate this host.
const root = realpathSync(directory);
if (kind === "static" && !existsSync(join(root, "index.html"))) throw Error(`static proof needs ${join(root, "index.html")}; build the app first`);
// The driver owns this pipe: kernel EOF survives a SIGKILLed driver. Closing
// the host also closes its keeper's pipe, which sweeps this private group.
process.stdin.resume();
process.stdin.once("end", () => process.exit(1));
process.stdin.once("error", () => process.exit(1));
// A keeper in this private group survives an abruptly killed host. Its stdin
// closes on parent death, so it can signal its own pinned group, never another.
if (process.platform !== "win32") {
  const guard = spawn(process.execPath, [fileURLToPath(new URL("./proof-guard.js", import.meta.url))], { stdio: ["pipe", "inherit", "inherit", "ipc"] });
  await new Promise<void>((resolve, reject) => {
    guard.once("message", message => message === "ready" ? resolve() : reject(Error("invalid proof keeper")));
    guard.once("error", reject); guard.once("exit", () => reject(Error("proof keeper exited early")));
  });
  guard.once("exit", () => process.exit(1));
  // Keep the write end reachable for the entire host lifetime.
  process.once("exit", () => guard.stdin!.destroy());
}
const marker = `${process.pid}:${process.env.SNAPBACK4_PROOF_LAUNCH}`;
const range = ports === "0" ? [0, 0] : ports.split("-").map(Number);
const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
function inside(path: string) { const rel = relative(root, path); return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }
async function host(port: number) {
  if (kind === "vite") {
    // Vite is a development dependency of the app, not a runtime dependency of
    // the proof kit. Use its config and supported API in this direct Node child.
    const { createServer: createVite } = await import(pathToFileURL(vitePath!).href);
    const server = await createVite({ root, server: { host: "127.0.0.1", port, strictPort: true },
      plugins: [{ name: "snapback4-proof-identity", configureServer(server: any) {
        server.middlewares.use((_req: any, res: any, next: () => void) => { res.setHeader("x-snapback4-proof", marker); next(); });
      } }] });
    try { await server.listen(); }
    catch (error) { await server.close(); throw error; }
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw Error("Vite has no bound TCP listener");
    return { port: address.port, stop: () => server.close() };
  }
  const server = createServer((req, res) => {
    res.setHeader("x-snapback4-proof", marker);
    res.setHeader("cache-control", "no-store");
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname); }
    catch { res.writeHead(400).end(); return; }
    let file = resolve(root, `.${pathname}`);
    if (!inside(file)) { res.writeHead(403).end(); return; }
    try {
      if (statSync(file).isDirectory()) file = join(file, "index.html");
    } catch {
      // Extensionless app routes share the generic shell. Missing assets 404.
      if (extname(file)) { res.writeHead(404).end(); return; }
      file = join(root, "index.html");
    }
    try {
      file = realpathSync(file);
      if (!inside(file) || !statSync(file).isFile()) { res.writeHead(403).end(); return; }
      res.setHeader("content-type", mime[extname(file)] ?? "application/octet-stream");
      if (req.method === "HEAD") { res.end(); return; }
      const stream = createReadStream(file); stream.on("error", () => res.destroy()); stream.pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("static server has no bound TCP listener");
  return { port: address.port, stop: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}
let started;
for (let port = range[0]!; port <= range[1]!; port++) {
  try { started = await host(port); break; }
  catch (error) {
    if (!/EADDRINUSE|Port \d+ is already in use/.test(String(error))) throw error;
  }
}
if (!started) throw Error(`E_ADDRINUSE: every frontend port in ${ports} is in use`);
console.log(`SNAPBACK4_PROOF_READY ${JSON.stringify({ kind, url: `http://127.0.0.1:${started.port}`, pid: process.pid })}`);
const stop = started.stop;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  const timer = setTimeout(() => process.exit(1), 4000);
  stop().then(() => { clearTimeout(timer); process.exit(0); }, () => process.exit(1));
});
