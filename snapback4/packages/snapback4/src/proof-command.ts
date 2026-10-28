// A private process-group leader for proof commands. Its keeper observes
// parent EOF and kills the complete group, including npm-created descendants.
// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — proof cleanup owns wrapper-created descendants and caller death.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [command, ...args] = process.argv.slice(2);
if (!command || process.platform === "win32") throw Error("invalid proof command wrapper invocation");
process.stdin.resume();
let guard: ReturnType<typeof spawn> | undefined;
const abandon = () => guard?.stdin?.destroy();
process.stdin.once("end", abandon);
process.stdin.once("error", abandon);

guard = spawn(process.execPath, [fileURLToPath(new URL("./proof-guard.js", import.meta.url))], { stdio: ["pipe", "inherit", "inherit", "ipc"] });
await new Promise<void>((resolve, reject) => {
  guard!.once("message", message => message === "ready" ? resolve() : reject(Error("invalid proof command keeper")));
  guard!.once("error", reject);
  guard!.once("exit", () => reject(Error("proof command keeper exited early")));
});
guard.once("exit", () => process.exit(1));
process.once("exit", abandon);

const env = { ...process.env };
// Native CLI supervision validates the immediate parent, which is this keeper-
// backed wrapper. Its driver-death pipe remains independently authoritative.
if (env.SNAPBACK4_PROOF_NATIVE_CLI === "1") env.SNAPBACK4_SUPERVISOR_PID = String(process.pid);
delete env.SNAPBACK4_PROOF_NATIVE_CLI;
const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ["ignore", "inherit", "inherit"] });
process.send?.({ type: "started", pid: child.pid });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => child.kill(signal));
child.once("error", error => {
  // kill() can also emit error after a successful spawn. Only absence of the
  // OS-assigned child PID proves this executable never started.
  process.send?.({ type: "result", code: null, signal: null, error: error.message, executableSpawnFailed: child.pid === undefined }, () => process.exit(1));
});
child.once("close", (code, signal) => {
  process.send?.({ type: "result", code, signal }, () => process.exit(code ?? (signal ? 1 : 0)));
});
