#!/usr/bin/env node
// Snapback 2's checks that are too slow or too host-bound to block a push run here, on a schedule
// (rules/NOT-DOING.md). Each run moves a warm clone to origin/main, builds it, runs the named checks,
// and keeps one open ticket per red check on main that names the last green commit, so the breaking
// range is visible. A check that exits 2 cannot run on this host; that is logged, not ticketed.
//
//   node scripts/scheduled.mjs install --checks web [--every 10800]   # a launchd agent on this Mac
//   node scripts/scheduled.mjs status | uninstall
//   node scripts/scheduled.mjs run --checks web,expo [--dry-run]       # what the agent runs
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const label = "com.snapback2.scheduled";
const home = process.env.SNAPBACK2_SCHEDULED_HOME ?? join(homedir(), ".snapback2-scheduled");
const clone = join(home, "repo");
const agent = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
const agentLog = join(homedir(), "Library/Logs/snapback2-scheduled.log");
const source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Commands are [directory under snapback2/, program, ...args]; they run in order and the first failure decides.
const build = { systems: "the build of the scheduled clone", timeout: 30 * 60_000,
  commands: [[".", "bun", "install", "--frozen-lockfile"], [".", "cargo", "build", "--workspace", "--bins"], ["packages/snapback2", "node", "build.mjs"]] };
export const checks = {
  web: { systems: "the React chat starter in real Chromium (`scripts/witness-web.mjs`)", timeout: 10 * 60_000,
    commands: [[".", "node", "scripts/witness-web.mjs"], [".", "node", "scripts/witness-web.mjs", "--signup"],
      [".", "node", "scripts/witness-web.mjs", "--offline-replay"]] },
  expo: { systems: "the Expo chat starter on the iOS simulator (`scripts/witness-expo.mjs`)", timeout: 90 * 60_000,
    commands: [[".", "node", "scripts/witness-expo.mjs"]] },
};
const definition = (name) => (name === "build" ? build : checks[name]);
const shown = ([cwd, ...argv]) => (cwd === "." ? argv.join(" ") : `(cd ${cwd} && ${argv.join(" ")})`);

const say = (text) => process.stdout.write(`[snapback2-scheduled ${new Date().toISOString()}] ${text}\n`);
const git = (args, cwd = clone) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const today = () => new Date().toISOString().slice(0, 10);
const indent = (text) => text.split("\n").map((entry) => `    ${entry}`).join("\n");

function hostName() {
  try { return execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim(); } catch { return hostname(); }
}

function spawnLogged([cwd, program, ...args], { workspace, timeout, log }) {
  return new Promise((done) => {
    const child = spawn(program === "node" ? process.execPath : program, args, { cwd: join(workspace, cwd), detached: true,
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LANG: process.env.LANG || "en_US.UTF-8" } });
    let tail = "";
    const keep = (data) => { log.write(data); tail = (tail + data).slice(-1_000_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    // The child leads its own process group, so a timeout also stops the browsers it started.
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeout);
    child.on("error", (error) => { clearTimeout(timer); done({ code: 127, output: String(error) }); });
    child.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 124, output: tail }); });
  });
}

async function runCheck(name, workspace) {
  const check = definition(name), logPath = join(home, "logs", `${name}.log`), log = createWriteStream(logPath);
  try {
    for (const command of check.commands) {
      const { code, output } = await spawnLogged(command, { workspace, timeout: check.timeout, log });
      if (code === 0) continue;
      return { verdict: code === 2 && name !== "build" ? "unavailable" : "red", code, command: shown(command), excerpt: excerpt(output), log: logPath };
    }
    return { verdict: "green" };
  } finally { log.end(); }
}

/** The failure's first telling lines: from the first FAIL or error line, else the tail. */
export function excerpt(output) {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const start = lines.findIndex((entry) => /^(FAIL\b|\d+\. FAIL\b|witness-web: |Error\b|error(\[|:)|AssertionError\b)/.test(entry));
  const picked = start < 0 ? lines.slice(-40) : lines.slice(start, start + 40);
  return picked.map((entry) => (entry.length > 240 ? `${entry.slice(0, 240)}…` : entry)).join("\n").trim();
}
// Two lines, because a witness names the failing step first and the error second; ids and numbers vary per run.
const signature = (text) => text.trim().split("\n").slice(0, 2).join(" ").replace(/[0-9a-f]{7,}|\d+/gi, "#");

const field = (key, value) => `**${key}:** ${value}`;
const line = (key) => new RegExp(`^\\*\\*${key}:\\*\\* .*\\n`, "m");
const failureBlock = /<!-- scheduled failure -->\n[\s\S]*?\n<!-- \/scheduled failure -->/;

/** Creates, refreshes or annotates the one open ticket for a check; returns the path it wrote, if any. */
export async function updateTicket({ repo, name, result, sha, lastGreen, date = today(), host = hostName() }) {
  const issues = join(repo, "issues"), marker = field("Scheduled check", `\`${name}\``);
  let path, text;
  for (const file of (await readdir(issues)).filter((entry) => entry.endsWith(".md")).sort()) {
    const body = await readFile(join(issues, file), "utf8");
    if (body.includes(marker)) { path = join(issues, file); text = body; break; }
  }
  if (result.verdict === "green") {
    if (!text || line("Passed again").test(text)) return undefined;
    await writeFile(path, text.replace(line("Last red"), (last) => `${last}${field("Passed again", `\`${sha}\` (${date})`)}\n`));
    return path;
  }
  const failure = ["<!-- scheduled failure -->", `\`cd snapback2 && ${result.command}\` exited ${result.code} at \`${sha.slice(0, 9)}\``
    + ` on ${host}; the full output is in \`${result.log}\` there.`, "", indent(result.excerpt), "<!-- /scheduled failure -->"].join("\n");
  if (text) {
    const lastRed = text.match(/^\*\*Last red:\*\* `[0-9a-f]+` \((\d{4}-\d{2}-\d{2})\)$/m)?.[1];
    const previous = (text.match(failureBlock)?.[0].split("\n") ?? []).filter((entry) => entry.startsWith("    "))
      .map((entry) => entry.slice(4)).join("\n");
    if (!line("Passed again").test(text) && lastRed === date && signature(previous) === signature(result.excerpt)) return undefined;
    await writeFile(path, text.replace(line("Passed again"), "")
      .replace(line("Last red"), () => `${field("Last red", `\`${sha}\` (${date})`)}\n`).replace(failureBlock, () => failure));
    return path;
  }
  let range = "No green run of this check is recorded on this host yet.";
  if (lastGreen) {
    try {
      const commits = git(["log", "--format=%h %s", `${lastGreen}..${sha}`, "--", "snapback2"], repo).split("\n").filter(Boolean);
      range = commits.length ? indent(commits.slice(0, 20).join("\n")) : "None.";
    } catch { range = `The last green commit \`${lastGreen}\` is not in this clone's history.`; }
  }
  path = join(issues, `${date.replaceAll("-", "")}-snapback2-scheduled-${name}-red.md`);
  await writeFile(path, [`# Snapback 2 scheduled check \`${name}\` is red`, "",
    field("Status", "Open"), field("Priority", "P2"), field("Date", date),
    field("Systems", `Snapback 2 scheduled checks (\`snapback2/scripts/scheduled.mjs\`), ${definition(name).systems}`),
    marker, field("Host", host), field("First red", `\`${sha}\` (${date})`), field("Last red", `\`${sha}\` (${date})`),
    field("Last green before it", lastGreen ? `\`${lastGreen}\`` : "none recorded on this host"), "",
    "## Evidence and impact", "", failure, "", "Commits touching `snapback2/` since that green run, newest first (at most 20):", "",
    range, "", "## Requested outcome and acceptance", "",
    "- Fix the regression, or the check if it is stale, and close this ticket in the commit that makes",
    `  \`cd snapback2 && ${definition(name).commands.map(shown).join(" && ")}\` pass. Each scheduled run`,
    "  refreshes **Last red** at most once a day or when the failure changes, and adds **Passed again**",
    "  once the check passes.", ""].join("\n"));
  return path;
}

function prepareClone() {
  if (existsSync(join(clone, ".git"))) return;
  say(`cloning ${source} into ${clone}`);
  execFileSync("git", ["clone", "--quiet", source, clone], { stdio: "inherit" });
  git(["remote", "set-url", "origin", git(["remote", "get-url", "origin"], source)]);
}

function refresh() {
  // The clone belongs to this runner; interrupted runs and the witnesses can leave tracked byproducts behind.
  git(["fetch", "--quiet", "origin"]);
  git(["checkout", "--quiet", "--force", "-B", "snapback2-scheduled", "origin/main"]);
  git(["clean", "-fdq"]);
}

function publish(changed) {
  git(["add", "--", "issues"]);
  git(["-c", "user.name=Snapback 2 scheduled checks", "-c", "user.email=noreply@anthropic.com", "commit", "--quiet",
    "-m", "chore(scheduled): update Snapback 2 scheduled check tickets", "-m", changed.join("\n")]);
  git(["checkout", "--quiet", "--", "."]);
  git(["clean", "-fdq"]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      git(["fetch", "--quiet", "origin"]);
      git(["rebase", "--quiet", "origin/main"]);
      git(["push", "--quiet", "origin", "HEAD:main"]);
      return say(`pushed: ${changed.join("; ")}`);
    } catch (error) {
      try { git(["rebase", "--abort"]); } catch {}
      say(`push attempt ${attempt} of 3 failed: ${String(error.stderr || error.message).trim().split("\n")[0]}`);
    }
  }
  throw new Error("could not push the ticket commit after 3 attempts");
}

async function runLocked(names, dryRun) {
  prepareClone();
  refresh();
  const sha = git(["rev-parse", "HEAD"]), workspace = join(clone, "snapback2"), statePath = join(home, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8").catch(() => "{}"));
  say(`${names.join(",")} at ${sha.slice(0, 9)}${dryRun ? " (dry run)" : ""}`);
  const results = [["build", await runCheck("build", workspace)]];
  if (results[0][1].verdict === "green") for (const name of names) results.push([name, await runCheck(name, workspace)]);
  const changed = [];
  for (const [name, result] of results) {
    say(`${name}: ${result.verdict}${result.command ? ` (${result.command} exited ${result.code})` : ""}`);
    if (result.verdict === "unavailable") continue;
    if (await updateTicket({ repo: clone, name, result, sha, lastGreen: state[name]?.lastGreen })) {
      changed.push(`${name}: ${result.verdict === "green" ? "passed again" : "red"} at ${sha.slice(0, 9)}`);
    }
    state[name] = { ...state[name], ...(result.verdict === "green" ? { lastGreen: sha } : {}),
      last: { sha, at: new Date().toISOString(), verdict: result.verdict } };
  }
  if (dryRun) {
    if (changed.length) { git(["add", "--intent-to-add", "--", "issues"]); say(`would commit:\n${git(["diff", "--", "issues"])}`); }
    refresh();
  } else {
    if (changed.length) publish(changed);
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
  const verdicts = results.map(([, result]) => result.verdict);
  return verdicts.includes("unavailable") ? 2 : verdicts.includes("red") ? 1 : 0;
}

async function runScheduled(names, dryRun) {
  const lock = join(home, "lock");
  await mkdir(join(home, "logs"), { recursive: true });
  try { await mkdir(lock); }
  catch {
    const holder = Number(await readFile(join(lock, "pid"), "utf8").catch(() => "0"));
    // Signal 0 only asks whether the recorded run still exists.
    const alive = holder > 0 && (() => { try { process.kill(holder, 0); return true; } catch (error) { return error.code === "EPERM"; } })();
    if (alive) { say(`skipped: run ${holder} still holds ${lock}`); return 0; }
    say(`reclaiming the lock left by ${holder || "an unknown run"}`);
  }
  await writeFile(join(lock, "pid"), String(process.pid));
  try { return await runLocked(names, dryRun); } finally { await rm(lock, { recursive: true, force: true }); }
}

async function install(names, every) {
  if (process.platform !== "darwin") throw new Error("the scheduled agent is a macOS launchd job");
  prepareClone();
  refresh();
  const program = join(clone, "snapback2/scripts/scheduled.mjs");
  if (!existsSync(program)) throw new Error("origin/main has no snapback2/scripts/scheduled.mjs yet");
  const pinned = (await readFile(join(clone, ".node-version"), "utf8")).trim();
  const volta = join(homedir(), ".volta/tools/image/node", pinned, "bin/node");
  const node = existsSync(volta) ? volta : process.execPath;
  const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const string = (value) => `<string>${xml(value)}</string>`;
  const entry = (key, value) => `  <key>${key}</key>${value}\n`;
  const path = [dirname(node), join(homedir(), ".bun/bin"), join(homedir(), ".cargo/bin"), "/opt/homebrew/bin", "/usr/local/bin",
    "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const environment = `<dict><key>PATH</key>${string(path)}<key>LANG</key>${string("en_US.UTF-8")}`
    + `${process.env.SNAPBACK2_SCHEDULED_HOME ? `<key>SNAPBACK2_SCHEDULED_HOME</key>${string(home)}` : ""}</dict>`;
  await mkdir(dirname(agent), { recursive: true });
  await mkdir(dirname(agentLog), { recursive: true });
  await writeFile(agent, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" `
    + `"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${entry("Label", string(label))}`
    + entry("ProgramArguments", `<array>${[node, program, "run", "--checks", names.join(",")].map(string).join("")}</array>`)
    + entry("WorkingDirectory", string(join(clone, "snapback2"))) + entry("StartInterval", `<integer>${every}</integer>`)
    + entry("RunAtLoad", "<false/>") + entry("StandardOutPath", string(agentLog)) + entry("StandardErrorPath", string(agentLog))
    + entry("EnvironmentVariables", environment) + "</dict>\n</plist>\n");
  const domain = `gui/${process.getuid()}`;
  try { execFileSync("launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" }); } catch {}
  execFileSync("launchctl", ["bootstrap", domain, agent], { stdio: "inherit" });
  say(`installed ${label}: ${names.join(",")} every ${every}s from ${clone}; log ${agentLog}`);
}

async function status() {
  try {
    const printed = execFileSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], { encoding: "utf8" });
    say(printed.split("\n").map((entry) => entry.trim()).filter((entry) => /^(state|runs|last exit code|run interval) =/.test(entry)).join("; "));
  } catch { say(`${label} is not loaded on this host`); }
  const state = JSON.parse(await readFile(join(home, "state.json"), "utf8").catch(() => "{}"));
  for (const [name, entry] of Object.entries(state)) {
    say(`${name}: ${entry.last?.verdict} at ${entry.last?.sha?.slice(0, 9)} (${entry.last?.at}); last green ${entry.lastGreen?.slice(0, 9) ?? "none"}`);
  }
}

async function uninstall() {
  try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${label}`], { stdio: "ignore" }); } catch {}
  await rm(agent, { force: true });
  say(`uninstalled ${label}; the clone, state and logs stay in ${home}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [verb, ...rest] = process.argv.slice(2);
  const option = (flag) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined);
  const names = (option("--checks") ?? "").split(",").filter(Boolean);
  try {
    if ((verb === "run" || verb === "install") && (!names.length || names.some((name) => !checks[name]))) {
      throw new Error(`--checks takes a comma-separated subset of ${Object.keys(checks).join(", ")}`);
    }
    if (verb === "run") process.exitCode = await runScheduled(names, rest.includes("--dry-run"));
    else if (verb === "install") await install(names, Number(option("--every") ?? 10_800));
    else if (verb === "status") await status();
    else if (verb === "uninstall") await uninstall();
    else {
      process.stdout.write("usage: node scripts/scheduled.mjs install --checks web[,expo] [--every seconds] | status | uninstall"
        + " | run --checks web[,expo] [--dry-run]\n");
      process.exitCode = 2;
    }
  } catch (error) {
    say(`error: ${error.stack ?? error}`);
    process.exitCode = 2;
  }
}
