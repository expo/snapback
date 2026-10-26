// @ref LLP 3000.011.003.000.000#17-wave-29-serve-proofs-and-proof-residue-dx12 — the proof command shares the pinned serve group and private readiness.
// @ref LLP 3000.011.003.000.000#16-wave-27-process-checks-dx10 — keep group identity pinned until inspection, then reap it on EOF.
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";
process.stdin.resume();
process.on("SIGTERM", () => {}); process.on("SIGINT", () => {});
if (process.argv[2] === "--keeper") {
  process.stdin.once("end", () => process.kill(0, "SIGKILL"));
  process.stdin.once("error", () => process.kill(0, "SIGKILL"));
  process.send?.("ready");
} else {
  const guard = spawn(process.execPath, [fileURLToPath(import.meta.url), "--keeper"], {stdio:["pipe", "ignore", "inherit", "ipc"]});
  guard.stdin!.on("error", () => {});
  process.stdin.once("end", () => guard.stdin!.destroy());
  process.stdin.once("error", () => guard.stdin!.destroy());
  await new Promise<void>((resolve, reject) => { guard.once("message", () => resolve()); guard.once("error", reject); guard.once("exit", () => reject(Error("serve-check keeper exited"))); });
  guard.once("exit", () => process.exit(1));
  const child = spawn("npm", ["run", "--silent", ...process.argv.slice(2)], {stdio:["ignore", "inherit", "inherit"]});
  process.on("message", (message: {type:string;command:string;ready:Record<string,unknown>}) => {
    if (message.type !== "then") return;
    const ready = message.ready;
    const command = spawn("sh", ["-c", message.command], {env:{...process.env,
      SNAPBACK4_SERVE_JSON:JSON.stringify(ready),
      ...(typeof ready.backendUrl === "string" ? {SNAPBACK_URL:ready.backendUrl, BACKEND_URL:ready.backendUrl} : {}),
      ...(typeof ready.frontendUrl === "string" ? {FRONTEND_URL:ready.frontendUrl} : {})}, stdio:["ignore","pipe","pipe"]});
    for (const stream of ["stdout", "stderr"] as const) command[stream].on("data", data => process.send?.({type:"then-output", stream, data:data.toString()}));
    command.once("error", () => process.send?.({type:"then-result", code:127}));
    command.once("close", (code, signal) => process.send?.({type:"then-result", code:code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1)}));
  });
  process.send?.({type:"started", keeper:guard.pid});
  child.once("error", () => process.send?.({type:"exited", code:null}));
  child.once("exit", (code, signal) => process.send?.({type:"exited", code, signal}));
}
