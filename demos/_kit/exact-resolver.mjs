// Capability-probed Exact resolver.
//
// @ref LLP 0041#demo-dependency-policy — ordinary verification resolves the
// committed package install; unpublished checkout use requires an explicit env
// or untracked local-config override and never happens merely because a sibling
// directory exists.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACT = 'packages/exact-contract/src';
const DEVTOOLS = 'packages/exact-devtools/src';

// Every resolution requires at least these; a demo may require more via
// `requiredCapabilities` (for example graffiti's ephemeralBinding +
// valueChannels).
const BASELINE_CAPABILITIES = ['contractCompiler', 'runtime', 'dataBinding'];

export function resolveExact({ repoRoot, requiredCapabilities = [], logger = console.error } = {}) {
  const root = repoRoot ?? process.cwd();
  // A required capability the probe table does not know stays in `missing`
  // and fails the candidate loudly here, instead of failing deep inside a
  // compile against an old checkout.
  const required = [...new Set([...BASELINE_CAPABILITIES, ...requiredCapabilities])];
  const overrides = [];

  if (process.env.SNAPBACK_EXACT_ROOT) {
    overrides.push({ kind: 'environment', path: process.env.SNAPBACK_EXACT_ROOT });
  }
  const localConfig = join(root, '.snapback', 'local.json');
  if (existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(localConfig, 'utf8'));
      if (cfg.exactRoot) overrides.push({ kind: 'local-config', path: cfg.exactRoot });
    } catch (error) {
      overrides.push({ kind: 'local-config', path: null, configError: error.message });
    }
  }

  for (const candidate of overrides) {
    if (!candidate.path || !existsSync(candidate.path)) continue;
    const caps = probeCapabilities(candidate.path);
    const missing = required.filter((name) => caps[name] !== true);
    if (missing.length === 0) {
      const selected = {
        sourceKind: candidate.kind,
        path: candidate.path,
        commit: gitCommit(candidate.path),
        capabilities: caps,
        diagnostics: [],
      };
      logger?.(`[snapback-exact] selected explicit ${selected.sourceKind} checkout ${selected.path} (commit ${selected.commit ?? 'unknown'})`);
      return selected;
    }
    // Present but incompatible — record why, keep probing.
    candidate.caps = caps;
    candidate.missing = missing;
  }

  // An explicit override is fail-closed: a typo or incompatible checkout must
  // not silently fall through to a different locked implementation.
  if (overrides.length > 0) {
    return missingResult({ root, required, overrides, packageCandidates: [], explicit: true });
  }

  // LLP 0041's default resolver rung: published packages. Each Contract app
  // owns its package install deliberately, so discover installed surface/admin
  // roots instead of making the Snapback workspace root a hidden dependency.
  const packageCandidates = installedPackageCandidates(root);
  for (const candidate of packageCandidates) {
    const caps = probePackageCapabilities(candidate.packageRoot, candidate.installRoot);
    const missing = required.filter((name) => caps[name] !== true);
    if (missing.length === 0) {
      const selected = {
        sourceKind: 'package',
        path: candidate.installRoot,
        packageRoot: candidate.packageRoot,
        commit: null,
        version: candidate.version,
        capabilities: caps,
        diagnostics: [],
      };
      logger?.(`[snapback-exact] selected locked package ${selected.version ?? 'unknown'} at ${selected.path}`);
      return selected;
    }
    candidate.caps = caps;
    candidate.missing = missing;
  }

  return missingResult({ root, required, overrides, packageCandidates, explicit: false });
}

function missingResult({ root, required, overrides, packageCandidates, explicit }) {
  const probed = overrides
    .filter((c) => c.path && existsSync(c.path))
    .map((c) => `${c.kind}@${c.path} (missing: ${(c.missing ?? []).join(', ')}; caps: ${JSON.stringify(c.caps ?? {})})`);
  const packageProbed = packageCandidates.map(
    (candidate) =>
      `package@${candidate.installRoot} (${candidate.version}; missing: ${(candidate.missing ?? []).join(', ')}; caps: ${JSON.stringify(candidate.caps ?? {})})`,
  );

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
          explicit
            ? `The explicit Exact checkout does not provide the required capabilities (${required.join(', ')}).`
            : `No locked Exact package set with the required capabilities (${required.join(', ')}) was found.`,
        details: {
          target_surface: 'Contract/Exact',
          requiredCapabilities: required,
          searched: [
            ...overrides.map((c) => `${c.kind}:${c.path ?? `<invalid config: ${c.configError}>`}`),
            ...packageInstallRoots(root).map((path) => `package:${path}`),
          ],
          probed: [...probed, ...packageProbed],
        },
        suggestedFix:
          explicit
            ? 'Fix or remove the explicit SNAPBACK_EXACT_ROOT / .snapback/local.json override.'
            : 'Run bun install --frozen-lockfile in a Contract surface, or set SNAPBACK_EXACT_ROOT / .snapback/local.json for local Exact development.',
      },
    ],
  };
}

function packageInstallRoots(root) {
  const roots = [process.cwd(), root, join(root, 'admin-ui')];
  const demosDir = join(root, 'demos');
  try {
    for (const entry of readdirSync(demosDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        roots.push(join(demosDir, entry.name, 'surfaces', 'contract'));
      }
    }
  } catch {
    // A consumer can use the resolver without the demo corpus present.
  }
  return [...new Set(roots)];
}

function installedPackageCandidates(root) {
  const candidates = [];
  for (const installRoot of packageInstallRoots(root)) {
    const packageRoot = join(installRoot, 'node_modules', '@exact', 'contract');
    const manifest = readJson(join(packageRoot, 'package.json'));
    if (!manifest || !existsSync(packageRoot)) continue;
    candidates.push({
      kind: 'package',
      installRoot,
      packageRoot,
      version: manifest.version ?? null,
    });
  }
  return candidates;
}

function probePackageCapabilities(packageRoot, installRoot) {
  const runtimeDataProvider = join(packageRoot, 'src', 'runtime', 'data-provider.ts');
  const channels = join(packageRoot, 'src', 'channels.ts');
  return {
    contractCompiler: packageExportExists(packageRoot, './compiler'),
    runtime: packageExportExists(packageRoot, './runtime'),
    dataBinding: existsSync(runtimeDataProvider),
    agentApi: existsSync(join(installRoot, 'node_modules', '@exact', 'devtools', 'src', 'agent', 'server.ts')),
    ephemeralBinding: fileContains(runtimeDataProvider, 'createProviderEphemeralHandle'),
    valueChannels: fileContains(channels, 'pointerChannel'),
  };
}

function packageExportExists(packageRoot, subpath) {
  const manifest = readJson(join(packageRoot, 'package.json'));
  const entry = manifest?.exports?.[subpath];
  const target = typeof entry === 'string' ? entry : entry?.import ?? entry?.default;
  return typeof target === 'string' && existsSync(join(packageRoot, target));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
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
