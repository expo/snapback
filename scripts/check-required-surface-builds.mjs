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
// class cannot recur silently. A "pin bump" is any change to a surface's pin
// (all-aboard: surfaces/contract/bun.lock; cursors-web: surfaces/contract/
// exact.pin.json) — this gate runs on every push/PR, which covers them.
//
// Surface set is DERIVED from the demo manifests (demos/*/demo.snapback.json),
// not a second hand-maintained list: a web surface is gated iff its manifest
// entry is `requirement: "required"` AND a buildable `surfaces/<name>/` dir
// with a package.json exists. A required web surface with no `build` script is
// a FAILURE (the original cursors-web bug), never a skip.
//
// Two consumption modes, matching LLP 0015's two-lane CI model:
//   * registry  — @exact/* installed from npm; the surface's bun.lock is the
//                 package pin (all-aboard). Today @ccheever/exact-devtools
//                 still needs SNAPBACK_EXACT_ROOT as a native-asset bridge
//                 until ENG-22564 publishes packages that ship those assets.
//   * checkout  — interim sibling-Exact-source bridge, pinned by exact.pin.json
//                 (cursors-web, ENG-22797; durable fix ENG-22564). Builds only
//                 in the integration lane when a clean checkout at the pinned
//                 revision is present; otherwise LOUD-SKIPS in the core lane
//                 with a declared reason — never a silent gap.
//
// SNAPBACK_REQUIRE_EXACT=1 upgrades every checkout-mode skip into a hard
// failure (the integration lane / cold-clone discipline: required means
// required, never skip).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMOS_DIR = join(ROOT, 'demos');
const BUILD_TIMEOUT_MS = Number(process.env.SNAPBACK_SURFACE_BUILD_TIMEOUT_MS ?? 300_000);
const REQUIRE_EXACT = process.env.SNAPBACK_REQUIRE_EXACT === '1';
const LIST_ONLY = process.argv.includes('--list');

function log(msg) {
  process.stdout.write(`[required-surface-builds] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[required-surface-builds] FAIL: ${msg}\n`);
  process.exit(1);
}

// The interim checkout bridge (ENG-22797) resolves @exact/* against a sibling
// Exact SOURCE checkout. Same discovery order the surface vite.config uses,
// but the gate only treats a clean checkout at exact.pin.json as integration
// proof. A random sibling worktree must not silently bless a required surface.
function exactCheckoutCandidates() {
  if (process.env.SNAPBACK_EXACT_ROOT) {
    const p = resolve(process.env.SNAPBACK_EXACT_ROOT);
    return existsSync(p) ? [p] : [];
  }
  return [resolve(ROOT, '../exact'), resolve(ROOT, 'vendor/exact')].filter((candidate) =>
    existsSync(join(candidate, 'packages/exact-devtools/src/contract-web.ts')),
  );
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
  // exact.pin.json marks the interim sibling-checkout bridge; a registry
  // surface pins through its committed lockfile instead.
  const pinPath = join(surface.surfaceDir, 'exact.pin.json');
  const mode = existsSync(pinPath) ? 'checkout' : 'registry';
  const exactPin = mode === 'checkout' ? readExactPin(pinPath) : null;
  return { ...surface, hasBuild, mode, exactPin };
}

function readExactPin(pinPath) {
  try {
    const parsed = JSON.parse(readFileSync(pinPath, 'utf8'));
    return typeof parsed.revision === 'string' && parsed.revision.length > 0
      ? parsed.revision
      : null;
  } catch (err) {
    fail(`${pinPath.replace(ROOT + '/', '')} is not valid JSON: ${err.message}`);
  }
}

function gitOutput(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function resolvePinnedExactCheckout(surface) {
  const candidates = exactCheckoutCandidates();
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: process.env.SNAPBACK_EXACT_ROOT
        ? `SNAPBACK_EXACT_ROOT does not exist or is not an Exact checkout: ${process.env.SNAPBACK_EXACT_ROOT}`
        : 'no Exact checkout is available (set SNAPBACK_EXACT_ROOT or place a checkout at ../exact)',
    };
  }

  const rejected = [];
  for (const root of candidates) {
    const head = gitOutput(root, ['rev-parse', 'HEAD']);
    if (!head) {
      rejected.push(`${root}: not a git checkout`);
      continue;
    }
    if (surface.exactPin && head !== surface.exactPin) {
      rejected.push(`${root}: HEAD ${head.slice(0, 12)} != exact.pin.json ${surface.exactPin.slice(0, 12)}`);
      continue;
    }
    const dirty = gitOutput(root, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty) {
      rejected.push(`${root}: checkout has tracked local changes`);
      continue;
    }
    return { ok: true, root, head };
  }
  return { ok: false, reason: rejected.join('; ') };
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
    log(`  - ${s.demoId}/${s.surfaceName} [${s.mode}]${s.hasBuild ? '' : ' (NO build script)'}`);
  }
  if (LIST_ONLY) return;

  let built = 0;
  let skipped = 0;

  for (const surface of surfaces) {
    const id = `${surface.demoId}/${surface.surfaceName}`;
    process.stdout.write(`\n[required-surface-builds] == ${id} (${surface.mode}) ==\n`);

    // The original bug: a required web surface with no build script at all.
    if (!surface.hasBuild) {
      fail(`${id} is a required web surface but its package.json declares no \`build\` script — it can never be production-built (the ENG-22543 root cause). Add a build script.`);
    }

    const env = { SNAPBACK_REQUIRE_EXACT: REQUIRE_EXACT ? '1' : process.env.SNAPBACK_REQUIRE_EXACT ?? '' };

    if (surface.mode === 'checkout') {
      const checkout = resolvePinnedExactCheckout(surface);
      if (!checkout.ok) {
        const reason = `${id} consumes Exact from a pinned sibling SOURCE checkout (interim ENG-22797 bridge; durable fix ENG-22564), but no clean checkout at ${surface.exactPin?.slice(0, 12) ?? 'the pinned revision'} is available: ${checkout.reason}.`;
        if (REQUIRE_EXACT) {
          fail(`${reason} SNAPBACK_REQUIRE_EXACT=1 forbids skipping a required surface build.`);
        }
        log(`SKIP (declared): ${reason}`);
        log(`  core lane loud-skip — this surface is gated in the integration lane. Not a silent gap.`);
        skipped += 1;
        continue;
      }
      env.SNAPBACK_EXACT_ROOT = checkout.root;
      log(`using Exact checkout: ${checkout.root} @ ${checkout.head.slice(0, 12)}`);
    } else {
      const install = await ensureRegistryInstall(surface);
      if (!install.ok) fail(`${id}: ${install.reason}`);
    }

    const result = await runBuild(surface, env);
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
  log(`verdict: ${built} required surface(s) production-built, ${skipped} declared-skip(s)`);
  if (built === 0) {
    fail('no required surface was actually built — every gated surface skipped; the gate proved nothing');
  }
  log('REQUIRED-SURFACE-BUILDS PASS');
}

main().catch((err) => fail(err?.stack ?? String(err)));
