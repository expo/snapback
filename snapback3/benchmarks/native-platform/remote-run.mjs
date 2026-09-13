#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { assert, assertAcquisitionSequence, assertBodies, assertClientDatabase, assertDeepEqual,
  assertOfflineProbes, assertOperations, assertProcessSequence, assertRequestChain, offlineBodies,
  parseJsonColumn, queryData } from "./harness-proof.mjs";
import { comparePackagePayload, extractArchivePayload, verifyInstalledPackage,
  verifyMetroSourceMap } from "./package-binding.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(process.argv[2] ?? ".");
const configPath = resolve(process.argv[3] ?? join(root, "run-config.json"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const appRoot = join(root, "app");
const backendRoot = join(root, "backend");
const evidence = join(root, "evidence");
const device = config.device;
const bundle = config.bundle ?? "host.exp.Exponent";
const ports = config.ports;
const hostAddress = config.hostAddress;
const backendUrl = `http://${hostAddress}:${ports.proxy}`;
const controlUrl = `http://${hostAddress}:${ports.control}`;
const runId = config.runId;
const packageReport = JSON.parse(await readFile(join(root, "artifacts/package-report.json"), "utf8"));
const packageArchive = join(root, "artifacts/snapback3-native-witness.tgz");
const eventsPath = join(evidence, "events.jsonl");
const proxyPath = join(evidence, "proxy.jsonl");
const processesPath = join(evidence, "processes.jsonl");
const reports = [];
const children = new Map();
const proxySockets = new Set();
const expoProcesses = [];
let activeExpo;
let proxyMode = "online";
let stage = "online";
let boot = 1;
let command = "wait";
let operationIds = [];
let failed = false;

await mkdir(evidence, { recursive: true });
await writeFile(eventsPath, "");
await writeFile(proxyPath, "");
await writeFile(processesPath, "");

const now = () => new Date().toISOString();
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const jsonLine = (path, value) => appendFile(path, `${JSON.stringify(value)}\n`);
const event = async (type, details = {}) => jsonLine(eventsPath, { at: now(), type, ...details });

assert(typeof device === "string" && device.length > 0, "run config needs an exact device UDID");
assert(typeof hostAddress === "string" && hostAddress.length > 0, "run config needs a host address");
assert(typeof runId === "string" && runId.length > 0, "run config needs a unique runId");
for (const [name, port] of Object.entries(ports ?? {}))
  assert(Number.isInteger(port) && port > 0 && port < 65536, `run config has invalid ${name} port`);
assert(["backend", "proxy", "control", "metro"].every(name => Number.isInteger(ports[name])),
  "run config needs backend, proxy, control, and Metro ports");

async function hash(path) {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

async function run(commandName, args, label) {
  const startedAt = now();
  try {
    const result = await execFile(commandName, args, { maxBuffer: 16 * 1024 * 1024 });
    await event("command", { label, command: [commandName, ...args], startedAt, exit: 0,
      stdout: result.stdout.trim().slice(0, 16_384), stderr: result.stderr.trim().slice(0, 16_384) });
    return result.stdout.trim();
  } catch (error) {
    await event("command", { label, command: [commandName, ...args], startedAt,
      exit: error.code ?? 1, signal: error.signal ?? null,
      stdout: String(error.stdout ?? "").trim().slice(0, 16_384),
      stderr: String(error.stderr ?? error.message).trim().slice(0, 16_384) });
    throw error;
  }
}

function spawnOwned(name, executable, args, options = {}) {
  const stdoutPath = join(evidence, `${name}.stdout.log`);
  const stderrPath = join(evidence, `${name}.stderr.log`);
  const child = spawn(executable, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  child.stdout.pipe(createWriteStream(stdoutPath, { flags: "a" }));
  child.stderr.pipe(createWriteStream(stderrPath, { flags: "a" }));
  const record = { name, pid: child.pid, command: [executable, ...args], cwd: options.cwd ?? root,
    startedAt: now(), stdoutPath, stderrPath, child };
  children.set(name, record);
  void jsonLine(processesPath, { ...record, child: undefined });
  child.once("exit", (code, signal) => {
    record.exit = code; record.signal = signal; record.exitedAt = now();
    void jsonLine(processesPath, { name, pid: child.pid, exit: code, signal, exitedAt: record.exitedAt });
  });
  return child;
}

async function waitForHttp(url, timeoutMs = 60_000) {
  await event("wait-start", { kind: "http", url, timeoutMs });
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) { await event("wait-end", { kind: "http", url, elapsedMs: Date.now() - started }); return response; }
      last = new Error(`HTTP ${response.status}`);
    } catch (error) { last = error; }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}: ${last instanceof Error ? last.message : last}`);
}

async function waitForReport(phase, expectedBoot = boot, timeoutMs = 90_000) {
  await event("wait-start", { kind: "app-report", phase, expectedBoot, timeoutMs });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = reports.find(report => report.phase === phase && report.boot === expectedBoot);
    if (found) { await event("wait-end", { kind: "app-report", phase, expectedBoot,
      elapsedMs: Date.now() - started }); return found; }
    const failure = reports.find(report => report.phase === "app-failure" && report.boot === expectedBoot);
    if (failure) throw new Error(`app failure on boot ${expectedBoot}: ${JSON.stringify(failure.details)}`);
    await sleep(200);
  }
  throw new Error(`timed out waiting for app report ${phase} on boot ${expectedBoot}`);
}

async function readBody(request, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("instrumentation request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json", "content-length": body.length,
    "access-control-allow-origin": "*", "cache-control": "no-store" });
  response.end(body);
}

const controlServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, controlUrl);
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST",
        "access-control-allow-headers": "content-type" }); response.end(); return;
    }
    if (request.method === "GET" && url.pathname === "/health") { json(response, 200, { ok: true }); return; }
    if (request.method === "GET" && url.pathname === "/boot") {
      json(response, 200, { stage, boot, operationIds }); return;
    }
    if (request.method === "GET" && url.pathname === "/command") {
      json(response, 200, { command: Number(url.searchParams.get("boot")) === boot ? command : "stale" }); return;
    }
    if (request.method === "POST" && url.pathname === "/report") {
      const value = JSON.parse((await readBody(request)).toString("utf8"));
      reports.push(value);
      await jsonLine(join(evidence, "app-reports.jsonl"), { receivedAt: now(), ...value });
      json(response, 200, { accepted: true }); return;
    }
    json(response, 404, { error: "not found" });
  } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
});

const proxyServer = createServer(async (request, response) => {
  const requestAt = now();
  const body = await readBody(request).catch(() => Buffer.alloc(0));
  const route = new URL(request.url, backendUrl).pathname;
  const base = { requestAt, mode: proxyMode, method: request.method, route,
    body: route === "/api/mutation" ? body.toString("utf8") : undefined };
  if (proxyMode !== "online") {
    await jsonLine(proxyPath, { ...base, responseAt: now(), status: 503, denied: true });
    json(response, 503, { error: { code: "S3_WITNESS_OFFLINE", message: "Backend denied by native witness." } });
    return;
  }
  const headers = { ...request.headers, host: `127.0.0.1:${ports.backend}` };
  const upstream = httpRequest({ hostname: "127.0.0.1", port: ports.backend,
    method: request.method, path: request.url, headers }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
    void jsonLine(proxyPath, { ...base, responseAt: now(), status: upstreamResponse.statusCode,
      streaming: route === "/api/events" });
  });
  proxySockets.add(upstream);
  upstream.once("close", () => proxySockets.delete(upstream));
  upstream.once("error", async error => {
    await jsonLine(proxyPath, { ...base, responseAt: now(), error: error.message });
    if (!response.headersSent) json(response, 502, { error: { code: "S3_WITNESS_PROXY", message: "Backend unavailable." } });
    else response.destroy();
  });
  if (body.length) upstream.end(body); else upstream.end();
});

async function setProxyMode(mode) {
  proxyMode = mode;
  if (mode !== "online") for (const socket of [...proxySockets]) socket.destroy();
  await event("proxy-mode", { mode });
}

async function api(path, body, token) {
  const response = await fetch(`${backendUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

async function serverMutation(persona, intent, body, clientTag) {
  const session = await api("/api/auth/persona", { name: persona });
  const manifest = await api("/api/manifest");
  return api("/api/mutation", { op: "messages.send", args: { conversationId: "native-room", body, clientTag },
    intent, planHash: manifest.programs["messages.send"].planHash, schemaHash: manifest.schemaHash }, session.token);
}

async function serverQuery() {
  const session = await api("/api/auth/persona", { name: "alice" });
  const result = await api("/api/query",
    { op: "messages.page", args: { conversationId: "native-room", c: null } }, session.token);
  return queryData(result, "owner control query");
}

async function directBackendApi(path, body, token) {
  const response = await fetch(`http://127.0.0.1:${ports.backend}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`direct backend ${path} returned ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

async function directServerQuery() {
  const session = await directBackendApi("/api/auth/persona", { name: "alice" });
  const result = await directBackendApi("/api/query",
    { op: "messages.page", args: { conversationId: "native-room", c: null } }, session.token);
  return queryData(result, "direct owner control query");
}

async function setStage(nextStage, nextBoot) {
  stage = nextStage; boot = nextBoot; command = "wait";
  await event("stage", { stage, boot, operationIds });
}

async function launch(label) {
  const launchCommand = ["simctl", "launch", device, bundle,
    "--initialUrl", `exp://${hostAddress}:${ports.metro}`];
  const launchOutput = await run("xcrun", launchCommand, `${label}-launch`);
  const match = /:\s*(\d+)\s*$/.exec(launchOutput);
  assert(match, `${label} launch did not report an Expo Go PID: ${JSON.stringify(launchOutput)}`);
  const record = { name: `${label}-expo-go`, pid: Number(match[1]), command: ["xcrun", ...launchCommand],
    startedAt: now(), bundle, device };
  assert(!expoProcesses.some(previous => previous.pid === record.pid),
    `${label} reused a prior Expo Go PID instead of crossing process death`);
  expoProcesses.push(record); activeExpo = record;
  await jsonLine(processesPath, record);
  return record;
}

async function terminate(label) {
  const record = activeExpo;
  await run("xcrun", ["simctl", "terminate", device, bundle], `${label}-terminate`);
  if (record) {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      try { process.kill(record.pid, 0); await sleep(100); }
      catch { break; }
    }
    let alive = true;
    try { process.kill(record.pid, 0); } catch { alive = false; }
    assert(!alive, `${label} left Expo Go PID ${record.pid} alive`);
    record.endedAt = now(); record.termination = label;
    await jsonLine(processesPath, { name: record.name, pid: record.pid, endedAt: record.endedAt,
      termination: label, exit: "simctl-terminate" });
    activeExpo = undefined;
  }
}

async function screenshot(label) {
  await run("xcrun", ["simctl", "io", device, "screenshot", join(evidence, `${label}.png`)], `${label}-screenshot`);
}

async function findDatabases(directory) {
  const found = [];
  async function walk(path, depth) {
    if (depth > 5) return;
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (entry.isFile() && /^snapback3-[a-f0-9]{64}\.db$/.test(entry.name)) found.push(child);
    }
  }
  await walk(directory, 0);
  return found;
}

async function captureClientDatabase(label) {
  const container = await run("xcrun", ["simctl", "get_app_container", device, bundle, "data"], `${label}-container`);
  const databases = await findDatabases(container);
  const expectedName = `snapback3-${createHash("sha256").update(backendUrl).digest("hex")}.db`;
  const matching = databases.filter(path => path.endsWith(`/${expectedName}`));
  if (matching.length !== 1) {
    throw new Error(`expected URL-scoped Snapback3 database ${expectedName}, found ${JSON.stringify(databases)}`);
  }
  const source = matching[0];
  const backup = join(evidence, `${label}-client.sqlite`);
  await run("sqlite3", [source, `.backup '${backup.replaceAll("'", "''")}'`], `${label}-sqlite-backup`);
  const operations = await run("sqlite3", ["-json", backup,
    "SELECT ordinal,id,json(value) AS value FROM s3_operations ORDER BY ordinal;"], `${label}-client-operations`);
  const state = await run("sqlite3", ["-json", backup,
    "SELECT key,json(value) AS value FROM s3_state ORDER BY key;"], `${label}-client-state`);
  const acquisitions = await run("sqlite3", ["-json", backup,
    "SELECT key,json(value) AS value FROM s3_acquisitions ORDER BY key;"], `${label}-client-acquisitions`);
  const rows = await run("sqlite3", ["-json", backup,
    "SELECT key,json(value) AS value FROM s3_rows ORDER BY key;"], `${label}-client-rows`);
  const resources = await run("sqlite3", ["-json", backup,
    "SELECT key,json(value) AS value FROM s3_resources ORDER BY key;"], `${label}-client-resources`);
  const acquisitionRows = await run("sqlite3", ["-json", backup,
    "SELECT key,json(value) AS value FROM s3_acquisition_rows ORDER BY key;"], `${label}-client-acquisition-rows`);
  const acquisitionResources = await run("sqlite3", ["-json", backup,
    "SELECT key,json(value) AS value FROM s3_acquisition_resources ORDER BY key;"], `${label}-client-acquisition-resources`);
  const receipt = { label, source, expectedName, allSnapbackDatabases: databases, backup, sourceSize: (await stat(source)).size,
    backupSize: (await stat(backup)).size, backupSha256: await hash(backup),
    operations: operations ? JSON.parse(operations) : [], state: state ? JSON.parse(state) : [],
    acquisitions: acquisitions ? JSON.parse(acquisitions) : [], rows: rows ? JSON.parse(rows) : [],
    resources: resources ? JSON.parse(resources) : [], acquisitionRows: acquisitionRows ? JSON.parse(acquisitionRows) : [],
    acquisitionResources: acquisitionResources ? JSON.parse(acquisitionResources) : [] };
  await writeFile(join(evidence, `${label}-client-sqlite.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function captureServerDatabase(messages) {
  const owner = children.get("backend")?.child;
  assert(owner && (owner.exitCode !== null || owner.signalCode !== null),
    "server SQLite backup attempted before its exclusive owner exited");
  const database = join(backendRoot, ".snapback3/store.sqlite");
  const output = join(evidence, "server-final.sqlite");
  await run("sqlite3", [database, `.backup '${output.replaceAll("'", "''")}'`], "server-sqlite-backup");
  const terminals = await run("sqlite3", ["-json", output,
    "SELECT principal,intent,request_digest,json(response) AS response,seq,at FROM _operation_intents ORDER BY seq,intent;"], "server-terminals");
  const rawTerminals = terminals ? JSON.parse(terminals) : [];
  const decodedTerminals = rawTerminals.map((row, index) => ({ ...row,
    response: parseJsonColumn(row.response, `server terminal[${index}].response`) }));
  const receipt = { backup: output, sha256: await hash(output), rawTerminals,
    terminals: decodedTerminals, messages };
  await writeFile(join(evidence, "server-audit.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function captureServerDuringOutage() {
  const messages = await directServerQuery();
  const receipt = { inspection: "direct read-only authenticated query while client proxy remained unavailable", messages };
  await writeFile(join(evidence, "server-during-outage.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function recordDescendants() {
  const ps = await run("ps", ["-axo", "pid=,ppid=,command="], "process-tree");
  const rows = ps.split("\n").map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null;
  }).filter(Boolean);
  const roots = new Set([process.pid, ...[...children.values()].map(record => record.pid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (roots.has(row.ppid) && !roots.has(row.pid)) { roots.add(row.pid); changed = true; }
  }
  const owned = rows.filter(row => roots.has(row.pid));
  await writeFile(join(evidence, "process-tree.json"), `${JSON.stringify({ at: now(), owned }, null, 2)}\n`);
}

async function stopChild(record) {
  if (!record || record.child.exitCode !== null || record.child.signalCode !== null) return;
  await event("process-stop-start", { name: record.name, pid: record.pid, signal: "SIGTERM" });
  record.child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise(resolveExit => record.child.once("exit", () => resolveExit(true))),
    sleep(5_000).then(() => false),
  ]);
  if (!exited && record.child.exitCode === null && record.child.signalCode === null) {
    record.child.kill("SIGKILL");
    await new Promise(resolveExit => record.child.once("exit", resolveExit));
  }
  await event("process-stop-end", { name: record.name, pid: record.pid, exit: record.child.exitCode,
    signal: record.child.signalCode });
}

async function closeServer(server) {
  await new Promise(resolveClose => server.close(() => resolveClose()));
}

try {
  await event("start", { pid: process.pid, runId, device, bundle, ports, hostAddress, configPath, packageReport });
  controlServer.listen(ports.control, hostAddress);
  proxyServer.listen(ports.proxy, hostAddress);
  await Promise.all([new Promise(resolveListen => controlServer.once("listening", resolveListen)),
    new Promise(resolveListen => proxyServer.once("listening", resolveListen))]);
  await jsonLine(processesPath, { name: "remote-run-control-proxy", pid: process.pid,
    command: [process.execPath, ...process.argv.slice(1)], ports, startedAt: now() });

  spawnOwned("backend", process.execPath,
    [join(appRoot, "node_modules/snapback3/dist/cli.mjs"), "dev", backendRoot,
      "--port", String(ports.backend), "--host", "127.0.0.1"], {
      env: { SNAPBACK3_WORKER: join(root, "artifacts/snapback3-worker"),
        SNAPBACK3_MEDIA: join(root, "artifacts/snapback3-media") },
    });
  await waitForHttp(`http://127.0.0.1:${ports.backend}/api/health`);

  const extractedPackageRoot = await extractArchivePayload(packageArchive, join(root, "package-archive-payload"));
  const packageBindingBefore = await verifyInstalledPackage({ archivePath: packageArchive, appRoot,
    archivePackageRoot: extractedPackageRoot, expectedArchiveSha256: packageReport.sha256,
    label: "pre-Metro installed package" });
  await writeFile(join(evidence, "package-binding-before.json"), `${JSON.stringify(packageBindingBefore, null, 2)}\n`);
  await event("package-binding-before", { archiveSha256: packageBindingBefore.archiveSha256,
    installedManifestSha256: packageBindingBefore.manifestSha256,
    resolvedEntry: packageBindingBefore.resolvedEntry, files: packageBindingBefore.files });

  spawnOwned("metro", process.execPath,
    [join(appRoot, "node_modules/expo/bin/cli"), "start", "--lan", "--port", String(ports.metro), "--go"], {
      cwd: appRoot,
      env: { CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_PUBLIC_CONTROL_URL: controlUrl,
        EXPO_PUBLIC_BACKEND_URL: backendUrl, EXPO_PUBLIC_PACKAGE_SHA256: packageReport.sha256,
        EXPO_PUBLIC_PACKAGE_SOURCE_SHA256: packageReport.sourceSha256, EXPO_PUBLIC_RUN_ID: runId },
  });
  await waitForHttp(`http://${hostAddress}:${ports.metro}/status`, 90_000);
  const bundleUrl = `http://${hostAddress}:${ports.metro}/node_modules/expo/AppEntry.bundle?platform=ios&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable`;
  const bundleResponse = await fetch(bundleUrl);
  assert(bundleResponse.ok, `Metro bundle preflight returned ${bundleResponse.status}`);
  const bundleBytes = Buffer.from(await bundleResponse.arrayBuffer());
  await writeFile(join(evidence, "metro-bundle.js"), bundleBytes);
  const sourceMapUrl = bundleUrl.replace(".bundle?", ".map?");
  const sourceMapResponse = await fetch(sourceMapUrl);
  assert(sourceMapResponse.ok, `Metro source map preflight returned ${sourceMapResponse.status}`);
  const sourceMapBytes = Buffer.from(await sourceMapResponse.arrayBuffer());
  await writeFile(join(evidence, "metro-source-map.json"), sourceMapBytes);
  const bundleSha256 = createHash("sha256").update(bundleBytes).digest("hex");
  const metroLoadedSdk = verifyMetroSourceMap({ sourceMapBytes, packageBinding: packageBindingBefore,
    bundleBytes: bundleBytes.length, bundleSha256, bundleUrl });
  await writeFile(join(evidence, "metro-loaded-sdk.json"), `${JSON.stringify(metroLoadedSdk, null, 2)}\n`);
  const bundlePreflight = { at: now(), bundleUrl, status: bundleResponse.status,
    contentType: bundleResponse.headers.get("content-type"), bytes: bundleBytes.length,
    sha256: bundleSha256, sourceMapUrl, sourceMapStatus: sourceMapResponse.status,
    sourceMapSha256: metroLoadedSdk.sourceMapSha256, loadedSdkModules: metroLoadedSdk.modules,
    launch: ["xcrun", "simctl", "launch", device, bundle, "--initialUrl", `exp://${hostAddress}:${ports.metro}`],
    bindings: { backend: `127.0.0.1:${ports.backend}`, proxy: `${hostAddress}:${ports.proxy}`,
      control: `${hostAddress}:${ports.control}`, metro: `${hostAddress}:${ports.metro}` } };
  await writeFile(join(evidence, "bundle-preflight.json"), `${JSON.stringify(bundlePreflight, null, 2)}\n`);
  await event("bundle-preflight", bundlePreflight);
  await recordDescendants();

  await launch("initial");
  const online = await waitForReport("online-ready", 1, 120_000);
  if (online.hermes !== true) throw new Error("online report did not assert Hermes");
  assertBodies(online.details.messages, ["Known durable row one", "Known durable row two"], "online rows");
  assert(online.details.principal?.id === "dev:alice",
    `unexpected online principal ${JSON.stringify(online.details.principal)}`);
  assert(online.details.acquisition?.id === "native-room-history"
    && online.details.acquisition?.status === "ready" && online.details.acquisition?.pages >= 1,
    `online acquisition did not complete: ${JSON.stringify(online.details.acquisition)}`);
  await screenshot("01-online-ready");
  const live = await serverMutation("bob", "native-live-control", "Live update arrived through Expo streaming fetch", "live-control");
  await event("live-control-mutation", { receipt: live });
  command = "observe-live";
  const liveReport = await waitForReport("live-update", 1);
  assertBodies(liveReport.details.messages, ["Live update arrived through Expo streaming fetch"],
    "live streaming rows");
  await screenshot("02-live-update");

  await setProxyMode("offline");
  command = "queue-offline";
  const queued = await waitForReport("offline-queued", 1);
  operationIds = queued.details.operationIds;
  if (!Array.isArray(operationIds) || operationIds.length !== 2 || new Set(operationIds).size !== 2) {
    throw new Error(`invalid queued operation identities: ${JSON.stringify(operationIds)}`);
  }
  assertOperations(queued.details.operations, operationIds,
    offlineBodies,
    "queued", "first-process durable queue");
  assertOfflineProbes(queued.details.probes, "first-process outage");
  assert(queued.details.pending.map(operation => operation.id).join("\n") === operationIds.join("\n"),
    `first-process pending FIFO order changed: ${JSON.stringify(queued.details.pending)}`);
  assertBodies(queued.details.cached, ["Known durable row one", "Known durable row two"], "offline cached rows");
  await screenshot("03-offline-queued");
  await terminate("first-process-death");
  const queuedDatabase = await captureClientDatabase("after-first-termination");
  const queuedProof = assertClientDatabase(queuedDatabase, operationIds, offlineBodies, "queued", "first termination");
  const outageTrafficAfterQueue = (await readFile(proxyPath, "utf8")).trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line)).filter(item => item.mode === "offline");
  assert(outageTrafficAfterQueue.every(item => item.denied === true && item.status === 503),
    `an outage proxy request was not denied: ${JSON.stringify(outageTrafficAfterQueue)}`);
  assert(!outageTrafficAfterQueue.some(item => item.route === "/api/mutation"),
    `an offline mutation reached the outage proxy: ${JSON.stringify(outageTrafficAfterQueue)}`);
  const serverDuringOutage = await captureServerDuringOutage();
  assertBodies(serverDuringOutage.messages,
    ["Known durable row one", "Known durable row two", "Live update arrived through Expo streaming fetch"],
    "server rows during outage");
  for (const body of ["Offline FIFO alpha survives OS process death", "Offline FIFO beta survives OS process death"]) {
    const matches = serverDuringOutage.messages.filter(row => row?.body === body);
    assert(matches.length === 0, `offline body reached server during outage: ${JSON.stringify(body)}`);
  }

  await setStage("restart-offline", 2);
  await launch("restart-offline");
  const restored = await waitForReport("restored-offline", 2, 120_000);
  assertOperations(restored.details.operations, operationIds,
    offlineBodies,
    "queued", "post-process-death restored queue");
  assertOfflineProbes(restored.details.probes, "offline process relaunch");
  assert(restored.details.pending.map(operation => operation.id).join("\n") === operationIds.join("\n"),
    `restored pending FIFO order changed: ${JSON.stringify(restored.details.pending)}`);
  assertBodies(restored.details.cached, ["Known durable row one", "Known durable row two"], "restored cached rows");
  const reopenedDatabase = await captureClientDatabase("after-offline-reopen");
  const reopenedProof = assertClientDatabase(reopenedDatabase, operationIds, offlineBodies, "queued",
    "offline reopened database", ["ready", "acquiring"], queuedProof.requests);
  await screenshot("04-restored-offline");
  await event("restored-before-reconnect", { report: restored, queuedDatabase, reopenedDatabase });

  await setProxyMode("online");
  command = "reconnect";
  const settled = await waitForReport("reconnected-settled", 2, 120_000);
  assertOperations(settled.details.operations, operationIds,
    offlineBodies,
    "committed", "reconnected operations");
  assert(Array.isArray(settled.details.pending) && settled.details.pending.length === 0,
    `terminal operations remained pending: ${JSON.stringify(settled.details.pending)}`);
  assertBodies(settled.details.messages,
    offlineBodies,
    "reconnected server rows");
  await screenshot("05-reconnected-settled");
  const finalServerMessages = await serverQuery();
  await stopChild(children.get("backend"));
  const serverAudit = await captureServerDatabase(finalServerMessages);
  await event("server-audit", { receipt: serverAudit });

  await terminate("second-process-death");
  const settledDatabase = await captureClientDatabase("after-second-termination");
  const settledProof = assertClientDatabase(settledDatabase, operationIds, offlineBodies, "committed",
    "second termination", ["ready", "acquiring"], queuedProof.requests);
  await setProxyMode("offline");
  await setStage("final-relaunch", 3);
  await launch("final-relaunch");
  const final = await waitForReport("final-restored", 3, 120_000);
  assertOperations(final.details.operations, operationIds,
    offlineBodies,
    "committed", "second-relaunch terminal restore");
  assert(Array.isArray(final.details.pending) && final.details.pending.length === 0,
    `second relaunch restored terminal operations as pending: ${JSON.stringify(final.details.pending)}`);
  assertBodies(final.details.cached,
    offlineBodies,
    "second-relaunch cached rows");
  await screenshot("06-final-restored");
  await terminate("final-teardown");
  const finalDatabase = await captureClientDatabase("after-final-termination");
  const finalProof = assertClientDatabase(finalDatabase, operationIds, offlineBodies, "committed",
    "final termination", ["ready", "acquiring"], queuedProof.requests);

  const successfulEvents = (await readFile(proxyPath, "utf8")).trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line)).filter(item => item.route === "/api/events" && item.status === 200);
  const offlineTraffic = (await readFile(proxyPath, "utf8")).trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line)).filter(item => item.mode === "offline");
  assert(successfulEvents.length >= 1, "no successful default Expo streaming request was observed");
  assert(offlineTraffic.every(item => item.denied === true && item.status === 503),
    `an offline proxy request was not denied: ${JSON.stringify(offlineTraffic)}`);
  assert(!offlineTraffic.some(item => item.route === "/api/mutation"),
    `an offline mutation reached the outage proxy: ${JSON.stringify(offlineTraffic)}`);
  const replayRequests = (await readFile(proxyPath, "utf8")).trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line)).filter(item => item.mode === "online" && item.route === "/api/mutation")
    .map(item => JSON.parse(item.body)).filter(body => operationIds.includes(body.intent));
  assert(replayRequests.length === 2 && replayRequests.map(body => body.intent).join("\n") === operationIds.join("\n"),
    `replay transport did not submit the original identities once in FIFO order: ${JSON.stringify(replayRequests)}`);
  const acquisitionBinding = assertAcquisitionSequence([queuedProof, reopenedProof, settledProof, finalProof]);
  const offlineTerminals = assertRequestChain({ proofs: [queuedProof, reopenedProof, settledProof, finalProof],
    replayRequests, serverAudit, settledOperations: settled.details.operations, finalOperations: final.details.operations });
  assertProcessSequence(expoProcesses);
  const packageBindingAfter = await verifyInstalledPackage({ archivePath: packageArchive, appRoot,
    archivePackageRoot: extractedPackageRoot, expectedArchiveSha256: packageReport.sha256,
    label: "post-witness installed package" });
  comparePackagePayload(packageBindingBefore.installedManifest, packageBindingAfter.installedManifest,
    "pre-Metro/post-witness installed package");
  assertDeepEqual(packageBindingAfter.resolvedEntry, packageBindingBefore.resolvedEntry,
    "pre-Metro/post-witness resolved snapback3/expo entry");
  await writeFile(join(evidence, "package-binding-after.json"), `${JSON.stringify(packageBindingAfter, null, 2)}\n`);
  const result = { ok: true, runId, packageReport, device, bundle, ports, operationIds,
    reports: { online, live: liveReport, restored, settled, final }, successfulStreamingEvents: successfulEvents.length,
    expoProcesses, replayRequests, offlineTerminals, acquisitionBinding, metroLoadedSdk,
    packageBindings: { before: packageBindingBefore, after: packageBindingAfter },
    offlineTraffic, databases: { queuedDatabase, reopenedDatabase, settledDatabase, finalDatabase },
    serverDuringOutage, serverAudit };
  await writeFile(join(evidence, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await event("complete", { result: "PASS" });
  process.stdout.write(`${JSON.stringify({ ok: true, evidence, operationIds }, null, 2)}\n`);
} catch (error) {
  failed = true;
  const failure = { at: now(), message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined };
  await writeFile(join(evidence, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`);
  await event("complete", { result: "FAIL", failure });
  process.stderr.write(`${failure.stack ?? failure.message}\n`);
} finally {
  for (const socket of [...proxySockets]) socket.destroy();
  if (failed) await terminate("failure-teardown").catch(() => {});
  await stopChild(children.get("metro"));
  await stopChild(children.get("backend"));
  await closeServer(proxyServer).catch(() => {});
  await closeServer(controlServer).catch(() => {});
  await recordDescendants().catch(() => {});
}

process.exitCode = failed ? 1 : 0;
