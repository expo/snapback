import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const packageRoot = resolve(workspace, "packages/snapback2");
export const binary = resolve(workspace, "target/debug/snapback2");
export const dist = resolve(packageRoot, "dist");
export const project = resolve(workspace, "target/e2-expo-app");
export const environment = { ...process.env, SNAPBACK2_EXPO_WORKSPACE: workspace, SNAPBACK2_COMPILER: resolve(dist, "compiler.mjs"),
  SNAPBACK2_TEMPLATES: resolve(dist, "templates"), SNAPBACK2_GUIDE: resolve(dist, "guide"), EXPO_NO_TELEMETRY: "1" };
export function run(command, args, options = {}) {
  const { timeout = 600_000, ...spawnOptions } = options;
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: workspace, env: environment, stdio: ["ignore", "pipe", "pipe"], ...spawnOptions });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveRun(output);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code ?? signal}\n${output}`));
    });
  });
}
export async function prepareExpoProject() {
  await mkdir(project, { recursive: true });
  // `init` validates an existing app before refreshing it. This directory is
  // witness-owned, so replace its backend first and remove leaves retired by
  // a newer template revision while retaining the native build caches.
  await rm(resolve(project, "snapback"), { recursive: true, force: true });
  await cp(resolve(dist, "templates/chat/snapback"), resolve(project, "snapback"), { recursive: true });
  await run(binary, ["init", project, "--template", "chat", "--client", "expo", "--json"]);
  // This is a dedicated generated measurement/witness project, not an app the
  // user edits: refresh its frontend after rebuilding the package.
  await cp(resolve(dist, "templates/chat/expo"), project, { recursive: true, dereference: true });
  // `init` places `shared/` only when absent; a rebuilt package must refresh it too, or the
  // project mixes revisions (fresh screens over stale reducers).
  await cp(resolve(dist, "templates/chat/shared"), resolve(project, "shared"), { recursive: true, dereference: true });
  await cp(resolve(workspace, "scripts/witness-expo/metro.config.cjs"), resolve(project, "metro.config.cjs"));
  const modules = resolve(project, "node_modules");
  await mkdir(modules, { recursive: true });
  const pkg = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  for (const name of ["snapback2", ...Object.keys(pkg.devDependencies)]) {
    const target = name === "snapback2" ? packageRoot : await realpath(resolve(packageRoot, "node_modules", name));
    const link = resolve(modules, name);
    await mkdir(dirname(link), { recursive: true });
    try { await symlink(target, link); } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  return { project, cli: resolve(project, "node_modules/expo/bin/cli") };
}
export async function walk(root) {
  return (await Promise.all((await readdir(root, { withFileTypes: true })).map((entry) =>
    entry.isDirectory() ? walk(resolve(root, entry.name)) : [resolve(root, entry.name)]))).flat();
}
