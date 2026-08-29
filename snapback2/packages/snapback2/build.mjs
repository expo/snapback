import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    index: resolve(here, "src/index.ts"),
    client: resolve(here, "src/client.ts"),
    react: resolve(here, "src/react.ts"),
    test: resolve(here, "src/test.ts"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
});

await build({
  entryPoints: [resolve(here, "../compiler/src/worker.ts")],
  outfile: resolve(dist, "compiler.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["typescript"],
});

await cp(resolve(here, "../compiler/lib.d.ts"), resolve(dist, "index.d.ts"));
await cp(resolve(here, "../compiler/subset-lib.d.ts"), resolve(dist, "compiler-lib.d.ts"));
await cp(resolve(here, "types/client.d.ts"), resolve(dist, "client.d.ts"));
await cp(resolve(here, "types/placeholder.d.ts"), resolve(dist, "placeholder.d.ts"));
