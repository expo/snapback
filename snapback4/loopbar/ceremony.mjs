#!/usr/bin/env node
// @ref LLP 3000.007#10.3 — the same frozen five-shape packet before and after the language landing.
// From snapback4/: node loopbar/ceremony.mjs --n 3 --version 0.2.8 --root /private/tmp/ceremony-before
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, hostname, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareVerificationLane } from "./run.mjs";
import { correctionLoops, measureLane } from "./ceremony-metrics.mjs";
import { command, launch } from "./ceremony-process.mjs";
import { probeLane } from "./ceremony-probes.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "..");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
export function packetHashes() {
  return Object.fromEntries(["ceremony-brief.md", "ceremony.mjs", "ceremony-metrics.mjs", "ceremony-process.mjs", "ceremony-probes.mjs", "run.mjs"].map((name) => [name, sha256(join(here, name))]));
}
function installedPin(lane) {
  const packageFile = join(lane, "node_modules/snapback4/package.json");
  const platform = `snapback4-${process.platform}-${process.arch}`;
  const binary = join(lane, "node_modules", platform, "snapback4");
  return { version: JSON.parse(readFileSync(packageFile, "utf8")).version,
    platformVersion: JSON.parse(readFileSync(join(lane, "node_modules", platform, "package.json"), "utf8")).version,
    binarySha256: sha256(binary), readmeSha256: sha256(join(lane, "node_modules/snapback4/README.md")),
    packageLockSha256: sha256(join(lane, "package-lock.json")) };
}
const resultShape = (result) => ({ ok: result.status === 0 && !result.timedOut && !result.error, status: result.status, timedOut: result.timedOut,
  error: result.error, tail: result.out.slice(-2500) });

export async function verifyCeremony(lane) {
  const directory = prepareVerificationLane(lane);
  const check = resultShape(await command("npx", ["snapback4", "check"], { cwd: directory, log: join(directory, "verify-check.log") }));
  const acceptanceDirectory = prepareVerificationLane(lane);
  const acceptance = resultShape(await command("npm", ["run", "acceptance"], { cwd: acceptanceDirectory,
    log: join(acceptanceDirectory, "verify-acceptance.log"), limitMs: 420_000 }));
  const probeDirectory = prepareVerificationLane(lane);
  const probes = await probeLane(probeDirectory);
  const result = { directory, acceptanceDirectory, probeDirectory, check, acceptance, probes,
    ok: check.ok && acceptance.ok && probes.ok };
  writeFileSync(join(directory, "verification.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

async function main(argv) {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("ceremony bar requires Node 24");
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw new Error("arguments are --name value pairs");
    args[argv[i].slice(2)] = argv[i + 1];
  }
  const metrics = resolve(args.metrics ?? join(root, "metrics/ceremonybar.jsonl"));
  mkdirSync(dirname(metrics), { recursive: true });
  if (args.reverify) {
    const result = { at: new Date().toISOString(), reverify: resolve(args.reverify), packet: packetHashes(), verify: await verifyCeremony(resolve(args.reverify)) };
    // Reverification is separate evidence, never a fourth trial in JSONL.
    writeFileSync(resolve(args.output ?? join(args.reverify, "reverification.json")), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result)); process.exitCode = result.verify.ok ? 0 : 1; return;
  }
  const n = Number(args.n ?? 3), version = args.version ?? "0.2.8", model = args.model ?? "gpt-6-astra", effort = args.effort ?? "medium";
  if (!Number.isInteger(n) || n < 1) throw new Error("--n must be a positive integer");
  const runsRoot = resolve(args.root ?? join(tmpdir(), `snapback4-ceremony-${new Date().toISOString().replaceAll(":", "-")}`));
  mkdirSync(runsRoot, { recursive: true });
  const brief = readFileSync(join(here, "ceremony-brief.md"), "utf8").replaceAll("{VERSION}", version), packet = packetHashes();
  let failures = 0;
  for (let run = 1; run <= n; run++) {
    const lane = join(runsRoot, `run-${run}`);
    if (existsSync(lane)) throw new Error(`refusing to reuse an existing lane: ${lane}`);
    mkdirSync(lane); writeFileSync(join(lane, "brief.md"), brief);
    const start = Date.now();
    const out = { at: new Date(start).toISOString(), run, version, model, effort, lane, packet,
      host: { name: hostname(), platform: process.platform, arch: process.arch, cpus: cpus().length, cpu: cpus()[0]?.model, loadAverage: loadavg(), sharedAndLoaded: true },
      node: process.version, timedOut: false };
    console.log(JSON.stringify({ phase: "start", ...out }));
    let install;
    try {
      writeFileSync(join(lane, "package.json"), JSON.stringify({ name: `ceremony-run-${run}`, private: true, type: "module" }, null, 2) + "\n");
      install = await command("npm", ["install", "--save-exact", `snapback4@${version}`], { cwd: lane, log: join(lane, "install.log"), limitMs: 180_000 });
      out.installSeconds = +((Date.now() - start) / 1000).toFixed(3);
      if (install.status !== 0) throw new Error(`install failed: ${install.out}`);
      out.installedBefore = installedPin(lane);
      if (out.installedBefore.version !== version || out.installedBefore.platformVersion !== version) throw new Error("installed package/binary pin mismatch");
      const agentStart = Date.now();
      out.agentStartedAt = new Date(agentStart).toISOString();
      console.log(JSON.stringify({ phase: "agent", run, lane, installSeconds: out.installSeconds }));
      const invocation = ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--json", "--color", "never", "-m", model,
        "-c", `model_reasoning_effort=${effort}`, "-C", lane, "-o", join(lane, "FINAL.md"), "-"];
      out.invocation = { command: join(process.env.HOME, ".volta/bin/codex"), args: invocation };
      const agent = launch(out.invocation.command, invocation, { cwd: lane, input: brief, log: join(lane, "codex.ndjson"), limitMs: Math.max(1, 1_800_000 - (Date.now() - start)) });
      out.agentPid = agent.child.pid;
      const result = await agent.done;
      out.timedOut = result.timedOut; out.exitCode = result.status; out.exitSignal = result.signal; out.agentError = result.error;
      out.agentWallSeconds = +((Date.now() - agentStart) / 1000).toFixed(3);
      out.wallSeconds = +((Date.now() - start) / 1000).toFixed(3);
      out.installedAfter = installedPin(lane);
      out.pinUnchanged = out.installedAfter.version === version && out.installedAfter.platformVersion === version &&
        out.installedAfter.binarySha256 === out.installedBefore.binarySha256 && out.installedAfter.readmeSha256 === out.installedBefore.readmeSha256;
      const log = existsSync(join(lane, "run-log.md")) ? readFileSync(join(lane, "run-log.md"), "utf8") : "";
      const began = Number(log.match(/^start=(\d+)$/m)?.[1]), green = Number(log.match(/^green=(\d+)$/m)?.[1]);
      out.agentSeconds = began && green >= began ? green - began : null;
      out.correctionLoops = correctionLoops(log);
      out.schemaShape = existsSync(join(lane, "snapback")) ? measureLane(lane, log) : null;
      console.log(JSON.stringify({ phase: "verify", run, wallSeconds: out.wallSeconds, timedOut: out.timedOut, correctionLoops: out.correctionLoops.byAttribution, schemaShape: out.schemaShape }));
      const verificationStart = Date.now();
      out.verify = await verifyCeremony(lane);
      out.verificationSeconds = +((Date.now() - verificationStart) / 1000).toFixed(3);
      out.green = !out.timedOut && out.exitCode === 0 && out.agentSeconds !== null && out.pinUnchanged && out.verify.ok;
      out.measurementComplete = out.schemaShape !== null && out.schemaShape.reportingError === null && out.correctionLoops.malformed.length === 0;
      // Keep the inherited loop-bar comparison explicit; the ceremony RFC names
      // wall and attributed loops, but does not set a new numeric pass threshold.
      out.loopBarComparison = { wallAtMost1200: out.wallSeconds <= 1200, snapbackAttributedAtMost1: out.correctionLoops.snapbackAttributed <= 1 };
    } catch (error) {
      out.error = error.stack; out.green = false;
      out.wallSeconds ??= +((Date.now() - start) / 1000).toFixed(3);
      out.timedOut ||= install?.timedOut ?? false;
    }
    if (!out.green || !out.measurementComplete) failures++;
    appendFileSync(metrics, JSON.stringify(out) + "\n");
    writeFileSync(join(lane, "runner-result.json"), JSON.stringify(out, null, 2) + "\n");
    console.log(JSON.stringify({ phase: "complete", run, green: out.green, wallSeconds: out.wallSeconds, timedOut: out.timedOut,
      verificationSeconds: out.verificationSeconds, checks: out.verify?.probes.checks.map(({ name, ok }) => ({ name, ok })), error: out.error }));
  }
  console.log(`ceremony bar: ${n - failures} passed; ${failures} failed; ${n} runs`);
  process.exitCode = failures ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
