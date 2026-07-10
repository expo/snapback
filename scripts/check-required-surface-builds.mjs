#!/usr/bin/env node
// @ref LLP 0015#peer-checkout-versus-submodule — production-build gate for every REQUIRED demo web
// surface, one code path shared by local verify and CI (ENG-22543, Diary 0011
// flip-condition 2 + the read-only judge's flip-condition 4).
//
// Why this exists (Diary 0011, Exact LLP 0286 cadence run #3): the required
// cursors-web Contract surface was DEV-GREEN, SHIP-BROKEN on the pin — it had
// never been production-built, so a `vite build` regression (Exact stage-0
// channels dragged the TypeScript compiler into the client graph, ENG-22537)
// shipped silently behind a green dev loop. The structural fix is a gate that
// production-builds EVERY required web surface on every Exact pin bump, so this
// class cannot recur silently. Every surface now pins Exact through its own
// committed bun.lock; this gate runs on every push/PR, which covers every
// package-version bump.
//
// Surface set is DERIVED from the demo manifests (demos/*/demo.snapback.json),
// not a second hand-maintained list: a web surface is gated iff its manifest
// entry is `requirement: "required"` AND a buildable `surfaces/<name>/` dir
// with a package.json exists. A required web surface with no `build` script is
// a FAILURE (the original cursors-web bug), never a skip.
//
// ENG-22564 removes the old checkout mode completely: no exact.pin.json, no
// SNAPBACK_EXACT_ROOT, and no sibling source tree used as a native-asset bridge.
// A missing lockfile or surviving pin file is a hard failure.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMOS_DIR = join(ROOT, 'demos');
const BUILD_TIMEOUT_MS = Number(process.env.SNAPBACK_SURFACE_BUILD_TIMEOUT_MS ?? 300_000);
const LIST_ONLY = process.argv.includes('--list');

function log(msg) {
  process.stdout.write(`[required-surface-builds] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[required-surface-builds] FAIL: ${msg}\n`);
  process.exit(1);
}

// Collect the gated surfaces from the demo manifests (single source of truth).
function collectRequiredWebSurfaces() {
  const surfaces = [];
  const demoIds = existsSync(DEMOS_DIR)
    ? readdirSync(DEMOS_DIR).filter((name) => statSync(join(DEMOS_DIR, name)).isDirectory())
    : [];
  for (const demoId of demoIds.sort()) {
    const manifestPath = join(DEMOS_DIR, demoId, 'demo.snapback.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      fail(`${demoId}/demo.snapback.json is not valid JSON: ${err.message}`);
    }
    for (const [surfaceName, entry] of Object.entries(manifest.surfaces ?? {})) {
      if (!entry || entry.requirement !== 'required') continue;
      const surfaceDir = join(DEMOS_DIR, demoId, 'surfaces', surfaceName);
      const pkgPath = join(surfaceDir, 'package.json');
      // Only buildable web surfaces have a surfaces/<name>/package.json; the
      // node-runner "surfaces" (headless/cron/egress/real-data) do not, so they
      // are naturally excluded.
      if (!existsSync(pkgPath)) continue;
      surfaces.push({ demoId, surfaceName, surfaceDir, pkgPath });
    }
  }
  return surfaces;
}

function classify(surface) {
  const pkg = JSON.parse(readFileSync(surface.pkgPath, 'utf8'));
  const hasBuild = Boolean(pkg.scripts?.build);
  return {
    ...surface,
    hasBuild,
    hasLock: existsSync(join(surface.surfaceDir, 'bun.lock')),
    hasLegacyPin: existsSync(join(surface.surfaceDir, 'exact.pin.json')),
  };
}

function distHasArtifact(surfaceDir) {
  // Record that the build produced something (flip-condition 4: a recorded
  // Contract build artifact from source). Look for any emitted index.html.
  const distDir = join(surfaceDir, 'dist');
  if (!existsSync(distDir)) return false;
  const stack = [distDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name === 'index.html' && st.size > 0) return true;
    }
  }
  return false;
}

function runBuild(surface, env) {
  return new Promise((resolveBuild) => {
    log(`$ bun run --cwd ${surface.surfaceDir.replace(ROOT + '/', '')} build`);
    let timedOut = false;
    const child = spawn('bun', ['run', '--cwd', surface.surfaceDir, 'build'], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    // A DNF must fail CI, not park it (ENG-22441): kill the build past the
    // watchdog and report a timeout.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, BUILD_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolveBuild({ ok: false, reason: `failed to spawn bun: ${err.message}` });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolveBuild({ ok: false, reason: `build DNF: exceeded ${BUILD_TIMEOUT_MS}ms watchdog` });
      } else if (code === 0) {
        resolveBuild({ ok: true });
      } else {
        resolveBuild({ ok: false, reason: `build exited ${code ?? signal}` });
      }
    });
  });
}

async function ensureRegistryInstall(surface) {
  if (existsSync(join(surface.surfaceDir, 'node_modules/@exact/contract/package.json'))) {
    return { ok: true };
  }
  log(`$ bun install --frozen-lockfile --cwd ${surface.surfaceDir.replace(ROOT + '/', '')}`);
  const result = await new Promise((resolveInstall) => {
    const child = spawn('bun', ['install', '--frozen-lockfile', '--cwd', surface.surfaceDir], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('error', (err) => resolveInstall({ ok: false, reason: `bun install spawn failed: ${err.message}` }));
    child.on('exit', (code) => resolveInstall(code === 0 ? { ok: true } : { ok: false, reason: `bun install exited ${code}` }));
  });
  if (!result.ok) return result;
  if (!existsSync(join(surface.surfaceDir, 'node_modules/@exact/contract/package.json'))) {
    return { ok: false, reason: '@exact/contract missing from surface node_modules after install' };
  }
  return { ok: true };
}

async function main() {
  const surfaces = collectRequiredWebSurfaces().map(classify);
  if (surfaces.length === 0) {
    fail('no required web surfaces found — the manifest-derivation is broken (expected all-aboard + cursors-web)');
  }

  log(`required web surfaces (from demos/*/demo.snapback.json):`);
  for (const s of surfaces) {
    log(`  - ${s.demoId}/${s.surfaceName} [registry]${s.hasBuild ? '' : ' (NO build script)'}`);
  }
  if (LIST_ONLY) return;

  let built = 0;
  for (const surface of surfaces) {
    const id = `${surface.demoId}/${surface.surfaceName}`;
    process.stdout.write(`\n[required-surface-builds] == ${id} (registry) ==\n`);

    // The original bug: a required web surface with no build script at all.
    if (!surface.hasBuild) {
      fail(`${id} is a required web surface but its package.json declares no \`build\` script — it can never be production-built (the ENG-22543 root cause). Add a build script.`);
    }

    if (surface.hasLegacyPin) {
      fail(`${id}: legacy exact.pin.json survives; ENG-22564 requires registry packages + bun.lock only`);
    }
    if (!surface.hasLock) {
      fail(`${id}: no committed bun.lock; registry Exact consumption is not reproducibly pinned`);
    }
    const install = await ensureRegistryInstall(surface);
    if (!install.ok) fail(`${id}: ${install.reason}`);

    const result = await runBuild(surface, {});
    if (!result.ok) {
      fail(`${id}: production build failed — ${result.reason}`);
    }
    if (!distHasArtifact(surface.surfaceDir)) {
      fail(`${id}: build reported success but emitted no dist/**/index.html artifact`);
    }
    log(`OK: ${id} production-built (artifact recorded under dist/)`);
    built += 1;
  }

  process.stdout.write('\n');
  log(`verdict: ${built} required surface(s) production-built from committed registry locks`);
  if (built === 0) {
    fail('no required surface was actually built; the gate proved nothing');
  }
  log('REQUIRED-SURFACE-BUILDS PASS');
}

main().catch((err) => fail(err?.stack ?? String(err)));
