// Runtime launcher: copied apps read their current owner's range on every run.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { resolveBinary } from "snapback4/bin-path";
import { portRange, stopChild } from "snapback4/proof";
const require = createRequire(new URL("../package.json", import.meta.url));
const mode = process.argv[2];
const range = portRange();
const low = range === "0" ? null : Number(range.split("-")[0]);
const high = range === "0" ? null : Number(range.split("-")[1]);
if (low !== null && high === low && mode !== "backend") throw Error("the starter needs two runtime ports");
const port = mode === "backend" ? low === null ? BACKEND : low : low === null ? FRONTEND : low + 1;
const command = mode === "backend" ? resolveBinary() : process.execPath;
const args = mode === "backend" ? ["dev", "--port", String(port)]
  : mode.startsWith("vite") ? [join(dirname(require.resolve("vite/package.json")), "bin/vite.js"), ...(mode === "vite-preview" ? ["preview"] : []), "--port", String(port), "--strictPort"]
  : [join(dirname(require.resolve("expo/package.json")), "bin/cli"), "start", ...(mode === "expo-web" ? ["--web"] : []), "--port", String(port)];
const env = { ...process.env };
if (low !== null) {
  env.VITE_SNAPBACK_URL = `http://127.0.0.1:${low}`;
  env.EXPO_PUBLIC_SNAPBACK_URL = env.VITE_SNAPBACK_URL;
}
const child = spawn(command, args, { stdio: "inherit", env });
process.once("exit", () => child.kill("SIGKILL"));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  stopChild(child).then(() => process.exit(0), error => { console.error(error); process.exit(1); });
});
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.once("close", code => { process.exitCode = code ?? 1; });
