// Local Snapback server lifecycle for tests/demos.
//
// @ref LLP 0010#required-tool-surfaces — copies Valet's orchestrator disciplines:
//   reuse an already-running server via a health probe, and tear down with
//   SIGTERM->SIGKILL. The two corrections from that section apply: never serve
//   stale output, and local tooling must exit cleanly.
//
// Reuse is *verified*, never assumed (ENG-22757, extending ENG-22753's
// browser-suite fix; the Diary 0008 2026-07-01 :4420 gotcha): "something
// answers /health on the port" says nothing about WHICH server it is — a
// weeks-old binary from another checkout squatting the port used to be
// silently reused. A running server is reused only when the caller declares
// its committed app identity (`provenance: { appId, artifactsPath }` — or an
// explicit `bundleHash`) AND the live server's loaded bundle
// (`GET /inspect` → functions.appId/bundleHash) matches it. Every other
// outcome — no provenance declared, unreachable /inspect, unprovisioned
// server, foreign app, hash drift — refuses reuse and starts a fresh
// isolated server on an OS-assigned port instead (so the returned `baseUrl`
// may differ from the requested port; callers must use the returned value).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { freePort, readCommittedBundleHash, verifyApiProvenance } from './provenance.mjs';

export async function startServer({ port = 4399, db = ':memory:', cwd = process.cwd(), provenance = null } = {}) {
  let baseUrl = `http://127.0.0.1:${port}`;

  // Something answers on the port. Reuse it ONLY on verified provenance;
  // otherwise fall back — loudly — to a fresh isolated server (ENG-22757).
  if (await isHealthy(baseUrl)) {
    const verdict = await reuseVerdict(baseUrl, provenance);
    if (verdict.ok) {
      console.log(`REUSED snapback server at :${port} (bundleHash ${verdict.bundleHash})`);
      return { baseUrl, stop: async () => {}, reused: true };
    }
    const isolated = await freePort();
    console.error(
      `PROVENANCE MISMATCH: a server answers /health on :${port} but ${verdict.reason}. ` +
        `NOT reusing it — starting a fresh isolated server on :${isolated} (ENG-22757).`,
    );
    port = isolated;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  const runtimeEnv = preflightLocalRuntime({ cwd });

  const args = ['run', '--quiet', '--', '--port', String(port)];
  if (db === ':memory:') args.push('--memory');
  else args.push('--db', db);

  const child = spawn('cargo', args, {
    cwd,
    env: { ...process.env, ...runtimeEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const deadline = Date.now() + 60_000; // first run may compile
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`snapback server exited early (code ${child.exitCode}):\n${log}`);
    }
    if (await isHealthy(baseUrl)) {
      return { baseUrl, reused: false, stop: () => stopChild(child) };
    }
    await sleep(250);
  }
  await stopChild(child);
  throw new Error(`snapback server did not become healthy on ${baseUrl}:\n${log}`);
}

// The reuse verdict for a healthy port. Without a declared committed
// identity there is nothing to verify against — /health carries no
// engine/build identity — so an externally started server is refused
// (the safe default, not an error).
async function reuseVerdict(baseUrl, provenance) {
  if (!provenance) {
    return {
      ok: false,
      reason:
        'this caller declares no committed app identity to verify it against ' +
        '(pass `provenance: { appId, artifactsPath }` to startServer to enable verified reuse)',
    };
  }
  const bundleHash = provenance.bundleHash ?? readCommittedBundleHash(provenance.artifactsPath);
  return verifyApiProvenance(baseUrl, { appId: provenance.appId ?? null, bundleHash });
}

async function isHealthy(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.on('exit', () => { clearTimeout(kill); resolve(); });
    child.kill('SIGTERM');
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function preflightLocalRuntime({ cwd }) {
  if (process.platform !== 'darwin') return {};

  const ibexRoot = join(cwd, 'vendor', 'ibex');
  if (!existsSync(join(ibexRoot, 'build.rs'))) return {};

  const includeDir =
    envPath('HERMES_INCLUDE_DIR', cwd) ?? join(ibexRoot, 'ios', 'Frameworks', 'hermes-headers');
  const libDir = envPath('HERMES_LIB_DIR', cwd) ?? join(ibexRoot, 'ios', 'Frameworks');
  const hermesc =
    envPath('HERMESC', cwd) ??
    envPath('HERMES_COMPILER', cwd) ??
    defaultHermescPath(ibexRoot);

  const missing = [];
  if (!existsSync(join(includeDir, 'hermes', 'hermes.h')) || !existsSync(join(includeDir, 'jsi', 'jsi.h'))) {
    missing.push(`Hermes headers at ${includeDir}`);
  }
  const framework = resolveMacosHermesFramework(libDir);
  if (!framework) {
    missing.push(`macOS Hermes framework under ${libDir}`);
  }
  if (!existsSync(hermesc)) {
    missing.push(`hermesc at ${hermesc}`);
  }

  if (missing.length === 0) {
    return {
      DYLD_FRAMEWORK_PATH: withFrameworkPath(process.env, framework.searchDir),
    };
  }

  const error = new Error([
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING: macOS Ibex/Hermes prerequisites are missing.',
    '',
    'Missing:',
    ...missing.map((item) => `- ${item}`),
    '',
    'Run this once from the Snapback repo:',
    '  vendor/ibex/scripts/download-hermes.sh',
    '',
    'Or point Cargo at an existing Ibex/Hermes checkout with:',
    '  HERMES_INCLUDE_DIR=/path/to/ibex/ios/Frameworks/hermes-headers',
    '  HERMES_LIB_DIR=/path/to/ibex/ios/Frameworks',
    '  HERMESC=/path/to/hermesc',
  ].join('\n'));
  error.code = 'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING';
  throw error;
}

function envPath(name, cwd) {
  const value = process.env[name];
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function defaultHermescPath(ibexRoot) {
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const toolsDir = join(ibexRoot, 'tools', 'hermes');
  const bare = join(toolsDir, 'hermesc');
  const suffixed = join(toolsDir, `hermesc-macos-${arch}`);
  return !existsSync(bare) && existsSync(suffixed) ? suffixed : bare;
}

function resolveMacosHermesFramework(libRoot) {
  const searchDirs = [
    libRoot,
    join(libRoot, 'macosx'),
    join(libRoot, 'hermes.xcframework', 'macos-arm64_x86_64'),
    join(libRoot, 'hermes.xcframework', 'macos-arm64'),
  ];

  for (const searchDir of searchDirs) {
    for (const frameworkName of ['hermesvm', 'hermes']) {
      if (findFrameworkBinary(join(searchDir, `${frameworkName}.framework`), frameworkName)) {
        return { searchDir, frameworkName };
      }
    }
  }
  return null;
}

function withFrameworkPath(env, frameworkDir) {
  const existing = env.DYLD_FRAMEWORK_PATH;
  if (!existing) return frameworkDir;
  const parts = existing.split(':').filter(Boolean);
  return parts.includes(frameworkDir) ? existing : [frameworkDir, ...parts].join(':');
}

function findFrameworkBinary(frameworkDir, frameworkName) {
  return [
    join(frameworkDir, 'Versions', 'Current', frameworkName),
    join(frameworkDir, 'Versions', '1', frameworkName),
    join(frameworkDir, 'Versions', '0', frameworkName),
    join(frameworkDir, frameworkName),
  ].some((candidate) => existsSync(candidate));
}
