import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { receiptsRoot, vitePort, workRoot } from "./constants.mjs";

await mkdir(receiptsRoot, { recursive: true });
const child = spawn(
  path.resolve(workRoot, "node_modules/.bin/vite"),
  ["--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"],
  {
    cwd: workRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  },
);
child.unref();
await writeFile(path.resolve(receiptsRoot, "vite.pid"), `${child.pid}\n`);
let ready = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${vitePort}`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error("Vite failed readiness");
console.log(JSON.stringify({
  ok: true,
  pid: child.pid,
  executable: "vite",
  port: vitePort,
}));
