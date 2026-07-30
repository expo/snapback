#!/usr/bin/env node
// ENG-24452: committed production bundles must not embed absolute checkout
// paths.
//
// The Exact Contract Vite compiler serialized Vite's absolute module id into
// production Contract IR (`ContractFileIR.sourcePath`) and import/witness
// provenance `file` fields, while Exact's static-native module table retained
// imports above an app's Vite root. Snapback's production bundles therefore
// changed bytes (and hashed filenames) across worktrees and disclosed
// developer filesystem paths. Exact 0.1.5 is the first lockstep
// release expected to carry both fixes: ENG-24452 normalizes Contract IR and
// sourcemaps; ENG-25004 canonicalizes workspace imports to
// `/__exact_workspace__/`. This gate is the Snapback-side backstop that rejects
// any absolute checkout-path marker in demo web surface dist trees.
//
// What it scans: every `demos/*/surfaces/*/dist` tree present on disk. For
// the tracked cursors-web dist these are the committed bytes; in
// verify-local-proof this gate runs immediately AFTER
// scripts/check-required-surface-builds.mjs, which production-rebuilds every
// required surface dist IN PLACE from the committed registry locks — so the
// bytes scanned there are exactly the freshly regenerated artifacts a
// contributor would commit next.
// @ref LLP 0015#acceptance-rules — required surfaces build from their own
// committed registry locks and may not silently skip.
//
// NO ALLOWLIST (issues/closed/20260716-upgrade-exact-portable-artifact-pins):
// both required surfaces now pin the @exact/* 0.1.7 registry suite, whose
// production builds are location-independent, so every dist tree present on
// disk is scanned unconditionally. A version rollback to a pre-portability
// pin (0.1.0–0.1.4) is NOT silenced — its rebuilt dist reproduces the leak
// and this gate fails on the leaked bytes themselves.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMOS_DIR = join(ROOT, 'demos');
const EXCERPT_RADIUS = 60;
const MAX_FINDINGS_PER_FILE = 5;

// Markers, not an exhaustive grammar: each one is a byte pattern that only
// plausibly appears in an artifact because an absolute checkout/workstation
// path leaked into it. The POSIX CI-root marker deliberately names common
// build roots instead of rejecting every leading slash: Exact's canonical
// /__exact_app__/, /__exact_runtime__/, and /__exact_workspace__/ module ids
// are portable artifact tokens, not host paths.
export const ABSOLUTE_PATH_MARKERS = [
  { id: 'macos-home', pattern: /\/Users\/[A-Za-z0-9_.-]+\// },
  { id: 'linux-home', pattern: /\/home\/[A-Za-z0-9_.-]+\// },
  { id: 'posix-tmp', pattern: /\/(?:private\/)?tmp\// },
  { id: 'macos-var', pattern: /\/(?:private\/)?var\/folders\// },
  {
    id: 'posix-ci-root',
    pattern:
      /\/(?:workspace|workspaces|builds|opt|mnt\/(?:agent|workspace)|var\/lib\/(?:buildkite-agent|jenkins))\//,
  },
  { id: 'windows-home', pattern: /[A-Za-z]:[\\/]+Users[\\/]+/ },
  // A drive root must start at a token boundary. Without the guard, the
  // trailing `s:/` in ordinary `https://` URLs is misclassified as a drive.
  // It must also continue with a path segment and a second separator: in
  // string/JSON-escaped artifact bytes (sourcemap `sourcesContent`, embedded
  // source text) a lone `\` after `X:` is usually the start of an escape
  // sequence — `case N:\n` and the regex source `[\s:"]` (as `[\\s:\"]`)
  // both begin with `<letter>:<backslash>` without being paths. A leaked
  // checkout path always carries at least one directory segment
  // (`D:\a\exact\...`, `C:/ci/build/...`), which escape sequences never do.
  {
    id: 'windows-drive-root',
    pattern: /(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/]+[^\s\\/:*?"'`<>|]+[\\/]/,
  },
];

function log(msg) {
  process.stdout.write(`[artifact-path-hygiene] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[artifact-path-hygiene] FAIL: ${msg}\n`);
  process.exit(1);
}

/** Every demo web surface with a dist tree on disk, committed or rebuilt. */
export function collectSurfaceDistTrees({ demosDir = DEMOS_DIR } = {}) {
  const trees = [];
  const demoIds = existsSync(demosDir)
    ? readdirSync(demosDir).filter((name) => statSync(join(demosDir, name)).isDirectory())
    : [];
  for (const demoId of demoIds.sort()) {
    const surfacesDir = join(demosDir, demoId, 'surfaces');
    if (!existsSync(surfacesDir)) continue;
    for (const surfaceName of readdirSync(surfacesDir).sort()) {
      const surfaceDir = join(surfacesDir, surfaceName);
      if (!statSync(surfaceDir).isDirectory()) continue;
      const distDir = join(surfaceDir, 'dist');
      if (!existsSync(distDir)) continue;
      trees.push({ demoId, surfaceName, surfaceDir, distDir });
    }
  }
  return trees;
}

function listFilesRecursively(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else files.push(full);
    }
  }
  return files;
}

/**
 * Scan one artifact's bytes for absolute-path markers. `extraMarkers` lets
 * the runner add the literal current checkout root, which is precise even
 * when a future home-directory shape escapes the generic marker list.
 */
export function scanArtifactBytes(content, { extraMarkers = [] } = {}) {
  const findings = [];
  for (const marker of [...ABSOLUTE_PATH_MARKERS, ...extraMarkers]) {
    const pattern = new RegExp(marker.pattern.source ?? marker.pattern, 'g');
    let match;
    while ((match = pattern.exec(content)) !== null) {
      findings.push({
        marker: marker.id,
        index: match.index,
        excerpt: content.slice(
          Math.max(0, match.index - EXCERPT_RADIUS),
          match.index + match[0].length + EXCERPT_RADIUS,
        ),
      });
      if (findings.length >= MAX_FINDINGS_PER_FILE) return findings;
    }
  }
  return findings;
}

export function auditSurfaceDistTrees({
  demosDir = DEMOS_DIR,
  checkoutRoot = ROOT,
} = {}) {
  const escapedRoot = checkoutRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const extraMarkers = [{ id: 'checkout-root', pattern: new RegExp(escapedRoot) }];
  const results = [];
  for (const tree of collectSurfaceDistTrees({ demosDir })) {
    const id = `${tree.demoId}/${tree.surfaceName}`;
    const findings = [];
    for (const file of listFilesRecursively(tree.distDir)) {
      for (const finding of scanArtifactBytes(readFileSync(file, 'latin1'), { extraMarkers })) {
        findings.push({ file: relative(demosDir, file), ...finding });
      }
    }
    results.push({ id, ...tree, findings });
  }
  return results;
}

function main() {
  const results = auditSurfaceDistTrees();
  if (results.length === 0) {
    fail(
      'no demo surface dist trees found — the tracked cursors-web dist should always be present, ' +
      'so the scan inventory is broken',
    );
  }

  let failures = 0;
  for (const result of results) {
    if (result.findings.length === 0) {
      log(`OK ${result.id}: no absolute checkout-path markers in dist/`);
      continue;
    }
    failures += 1;
    for (const finding of result.findings) {
      process.stderr.write(
        `[artifact-path-hygiene] ${result.id}: ${finding.file} matches ${finding.marker} ` +
        `at byte ${finding.index}:\n  ...${finding.excerpt}...\n`,
      );
    }
  }

  if (failures > 0) {
    fail(
      `${failures} surface dist tree(s) embed absolute checkout paths. Production artifacts must be ` +
      'location-independent: rebuild with the @exact/* 0.1.7-or-newer portable-artifact suite ' +
      '(0.1.5/0.1.6 could not production-build the required surfaces), and never hand-edit dist bytes.',
    );
  }
  log('ARTIFACT-PATH-HYGIENE PASS');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}
