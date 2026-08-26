import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { diagnosticSourceSites } from './diagnostics-registry-source.mjs';

// @ref LLP 0193#program — diagnostic removals remain explicit, classified,
// and reviewable instead of disappearing behind regenerated projections.

function gitOutput(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function stableRegistryHistory(repoRoot, dirtyPath) {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', dirtyPath], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    if (error.status === 1) return { baseline: 'HEAD' };
    throw error;
  }

  try {
    const baseline = gitOutput(repoRoot, ['merge-base', 'HEAD', 'origin/main']);
    const head = gitOutput(repoRoot, ['rev-parse', 'HEAD']);
    if (baseline !== head) return { baseline };
  } catch {
    // Fall through to the local registry history when origin/main is absent.
  }

  try {
    const latestRegistryCommit = gitOutput(repoRoot, [
      'log',
      '-1',
      '--format=%H',
      'HEAD',
      '--',
      dirtyPath,
    ]);
    if (latestRegistryCommit !== '') {
      return { baseline: gitOutput(repoRoot, ['rev-parse', `${latestRegistryCommit}^`]) };
    }
  } catch {
    // A root registry commit has no earlier snapshot; use the registry itself.
  }
  return { baseline: 'HEAD' };
}

function committedJson(repoRoot, revision, path, fallback = undefined) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${revision}:${path}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (error) {
    if (fallback !== undefined && error.status === 128) return fallback;
    throw error;
  }
}

function sourceLine(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

export function diagnosticEmitterEvidence(classifierSources) {
  const evidence = new Map();
  const add = (code, region, location) => {
    const record = evidence.get(code) ?? { production: [], test: [] };
    if (!record[region].includes(location)) record[region].push(location);
    evidence.set(code, record);
  };
  for (const { path, source, options = {} } of classifierSources) {
    // Run the same source once with every region visible and once with Rust
    // test regions masked. Only the masked result can disprove a removal
    // ledger's claim that a spelling is reference-only or test-only.
    const allSites = diagnosticSourceSites(source, {
      ...options,
      excludeRustTestRegions: false,
    }).filter(({ kind }) => kind === 'emission');
    const productionSites = diagnosticSourceSites(source, {
      ...options,
      excludeRustTestRegions: path.endsWith('.rs'),
    }).filter(({ kind }) => kind === 'emission');
    const productionKeys = new Set(productionSites.map(({ match }) => (
      `${match[0]}\0${match.index}`
    )));
    for (const { match } of productionSites) {
      add(match[0], 'production', `${path}:${sourceLine(source, match.index)}`);
    }
    for (const { match } of allSites) {
      if (productionKeys.has(`${match[0]}\0${match.index}`)) continue;
      add(match[0], 'test', `${path}:${sourceLine(source, match.index)}`);
    }
  }
  return evidence;
}

export function codeRemovalProblems(
  previousCodes,
  currentCodes,
  allowlist,
  previousAllowlist = { removals: {} },
  emitterEvidence = null,
) {
  const validReasons = new Set([
    'environment',
    'prefix',
    'reference-only',
    'renamed',
    'test-only',
  ]);
  const problems = [];
  assert.equal(
    allowlist.schemaVersion,
    'snapback-diagnostics-code-removals.v1',
    'diagnostics removal allowlist schema version',
  );
  assert.equal(
    allowlist.removals !== null && typeof allowlist.removals === 'object'
      && !Array.isArray(allowlist.removals),
    true,
    'diagnostics removal allowlist must contain an object-valued removals map',
  );
  for (const [code, justification] of Object.entries(allowlist.removals)) {
    assert.equal(
      justification !== null && typeof justification === 'object'
        && !Array.isArray(justification),
      true,
      `${code} removal justification must be an object`,
    );
    assert.match(
      code,
      justification.reason === 'prefix'
        ? /^SNAPBACK_[A-Z0-9_]*_$/u
        : /^SNAPBACK_[A-Z0-9_]*[A-Z0-9]$/u,
    );
    assert.ok(
      validReasons.has(justification.reason),
      `${code} removal reason must be environment, prefix, reference-only, renamed, or test-only`,
    );
    assert.ok(
      typeof justification.detail === 'string' && justification.detail.trim().length >= 12,
      `${code} removal detail must explain the source-classification change`,
    );
    if (justification.reason === 'renamed') {
      assert.match(
        justification.replacement ?? '',
        /^SNAPBACK_[A-Z0-9_]*[A-Z0-9]$/u,
        `${code} renamed removal must name its replacement`,
      );
    }
    if (emitterEvidence !== null) {
      const evidence = emitterEvidence.get(code) ?? { production: [], test: [] };
      if (
        justification.reason === 'reference-only'
        && evidence.production.length > 0
      ) {
        problems.push(
          `${code}: reference-only removal has a classified emitter at ${evidence.production[0]}`,
        );
      }
      if (justification.reason === 'test-only' && evidence.production.length > 0) {
        problems.push(
          `${code}: test-only removal has a classified production emitter at ${evidence.production[0]}`,
        );
      }
    }
  }
  for (const code of previousCodes) {
    if (currentCodes.has(code)) continue;
    const justification = allowlist.removals[code];
    if (justification === undefined) {
      problems.push(`${code}: missing checked-in removal justification`);
    } else if (
      JSON.stringify(previousAllowlist.removals?.[code]) === JSON.stringify(justification)
    ) {
      problems.push(`${code}: removal justification was not added or revised with this change`);
    }
  }
  for (const code of Object.keys(allowlist.removals)) {
    const existedInBaselineLedger = Object.hasOwn(previousAllowlist.removals ?? {}, code);
    if (
      currentCodes.has(code)
      || (!existedInBaselineLedger && !previousCodes.has(code))
    ) {
      problems.push(`${code}: unused checked-in removal justification`);
    }
  }
  return problems;
}

export function registryRemovalProblems(
  repoRoot,
  registryPath,
  allowlistPath,
  classifierSources = null,
) {
  const allowlist = JSON.parse(readFileSync(resolve(repoRoot, allowlistPath), 'utf8'));
  const { baseline } = stableRegistryHistory(repoRoot, registryPath);
  const baselineRegistry = committedJson(
    repoRoot,
    baseline,
    registryPath,
    { diagnostics: {} },
  );
  const previousCodes = new Set(Object.keys(baselineRegistry.diagnostics));
  const currentRegistry = JSON.parse(readFileSync(resolve(repoRoot, registryPath), 'utf8'));
  const previousAllowlist = committedJson(
    repoRoot,
    baseline,
    allowlistPath,
    { removals: {} },
  );
  return codeRemovalProblems(
    previousCodes,
    new Set(Object.keys(currentRegistry.diagnostics)),
    allowlist,
    previousAllowlist,
    classifierSources === null ? null : diagnosticEmitterEvidence(classifierSources),
  );
}
