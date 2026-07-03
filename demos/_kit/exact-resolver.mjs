// Capability-probed Exact resolver.
//
// @ref LLP 0015#exact-dependency-policy — resolve Exact through an explicit,
//   capability-probed resolver (env, untracked local config, sibling checkout,
//   optional submodule, published packages) in that order. This is
//   capability-based resolution, not directory-based: a stale peer checkout that
//   lacks the required capability must report a structured gap, not be treated as
//   valid just because the directory exists.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACT = 'packages/exact-contract/src';
const DEVTOOLS = 'packages/exact-devtools/src';

// Every resolution requires at least these; a demo may require more via
// `requiredCapabilities` (for example graffiti's ephemeralBinding +
// valueChannels).
const BASELINE_CAPABILITIES = ['contractCompiler', 'runtime', 'dataBinding'];

export function resolveExact({ repoRoot, requiredCapabilities = [] } = {}) {
  const root = repoRoot ?? process.cwd();
  // A required capability the probe table does not know stays in `missing`
  // and fails the candidate loudly here, instead of failing deep inside a
  // compile against an old checkout.
  const required = [...new Set([...BASELINE_CAPABILITIES, ...requiredCapabilities])];
  const candidates = [];

  if (process.env.SNAPBACK_EXACT_ROOT) {
    candidates.push({ kind: 'environment', path: process.env.SNAPBACK_EXACT_ROOT });
  }
  const localConfig = join(root, '.snapback', 'local.json');
  if (existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(localConfig, 'utf8'));
      if (cfg.exactRoot) candidates.push({ kind: 'local-config', path: cfg.exactRoot });
    } catch { /* ignore malformed config */ }
  }
  candidates.push({ kind: 'sibling-checkout', path: join(root, '..', 'exact') });
  candidates.push({ kind: 'submodule', path: join(root, 'vendor', 'exact') });

  for (const candidate of candidates) {
    if (!candidate.path || !existsSync(candidate.path)) continue;
    const caps = probeCapabilities(candidate.path);
    const missing = required.filter((name) => caps[name] !== true);
    if (missing.length === 0) {
      return {
        sourceKind: candidate.kind,
        path: candidate.path,
        commit: gitCommit(candidate.path),
        capabilities: caps,
        diagnostics: [],
      };
    }
    // Present but incompatible — record why, keep probing.
    candidate.caps = caps;
    candidate.missing = missing;
  }

  const probed = candidates
    .filter((c) => c.path && existsSync(c.path))
    .map((c) => `${c.kind}@${c.path} (missing: ${(c.missing ?? []).join(', ')}; caps: ${JSON.stringify(c.caps ?? {})})`);

  return {
    sourceKind: 'missing',
    path: null,
    capabilities: {},
    diagnostics: [
      {
        code: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
        severity: 'warning',
        subsystem: 'contract-integration',
        message:
          `No Exact checkout with the required capabilities (${required.join(', ')}) was found.`,
        details: {
          target_surface: 'Contract/Exact',
          requiredCapabilities: required,
          searched: candidates.map((c) => `${c.kind}:${c.path}`),
          probed,
        },
        suggestedFix:
          'Set SNAPBACK_EXACT_ROOT, add .snapback/local.json {"exactRoot":"..."}, or place an Exact checkout at ../exact.',
      },
    ],
  };
}

function probeCapabilities(root) {
  return {
    contractCompiler: existsSync(join(root, CONTRACT, 'compiler', 'index.ts')),
    runtime: existsSync(join(root, CONTRACT, 'runtime', 'index.ts')),
    // Data-binding capability is the presence of the LLP 0263 provider seam, not
    // just any Exact checkout — this is the "probe the feature, not the directory" rule.
    dataBinding: existsSync(join(root, CONTRACT, 'runtime', 'data-provider.ts')),
    agentApi: existsSync(join(root, DEVTOOLS, 'agent', 'server.ts')),
    // The `ephemeral` binding kind (Exact LLP 0284 §2.5 / ENG-22479): probe the
    // provider seam for its handle projection, not just the file.
    ephemeralBinding: fileContains(
      join(root, CONTRACT, 'runtime', 'data-provider.ts'),
      'createProviderEphemeralHandle',
    ),
    // Value channels + the authored rated publish line (Exact LLP 0281 stage 0 /
    // ENG-22524): the channels export the .contract `use ... from
    // "@exact/contract/channels"` resolves.
    valueChannels: fileContains(join(root, CONTRACT, 'channels.ts'), 'pointerChannel'),
  };
}

function fileContains(path, needle) {
  try {
    return existsSync(path) && readFileSync(path, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

function gitCommit(root) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// Resolve absolute module paths for the Contract compiler + runtime under a root.
export function exactModulePaths(root) {
  return {
    compiler: join(root, CONTRACT, 'compiler', 'index.ts'),
    runtime: join(root, CONTRACT, 'runtime', 'index.ts'),
  };
}
