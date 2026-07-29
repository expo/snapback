import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(workDir, ".runtime");
const directories = [
  runtimeDir,
  path.join(runtimeDir, "xdg", "config"),
  path.join(runtimeDir, "xdg", "cache"),
  path.join(runtimeDir, "java"),
];
await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
const refreshSecret = `llp0102-canary-${randomBytes(24).toString("hex")}`;
await writeFile(path.join(runtimeDir, "refresh-secret"), refreshSecret, { mode: 0o600 });

const environment = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(runtimeDir, "xdg", "config"),
  XDG_CACHE_HOME: path.join(runtimeDir, "xdg", "cache"),
  JAVA_TOOL_OPTIONS: `-Djava.io.tmpdir=${path.join(runtimeDir, "java")}`,
  RESEARCH_REFRESH_SECRET: refreshSecret,
  EXTERNAL_SOURCE_URL: "http://127.0.0.1:5042/external-source.json",
};

const child = spawn(
  "npx",
  [
    "--yes",
    "firebase-tools@15.24.0",
    "emulators:start",
    "--project",
    "llp0102-research-firebase-w3",
    "--only",
    "auth,firestore,functions,storage,hosting,pubsub,eventarc,tasks",
  ],
  {
    cwd: workDir,
    env: environment,
    stdio: "inherit",
  },
);

const stop = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
