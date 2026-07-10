// Snapback Contract provider conformance discovery.
//
// @ref LLP 0021#phase-2-ship-the-snapback-contract-adapter - Snapback must
//   pass Exact's provider conformance suite when Exact exposes it, without
//   replacing that suite with a drifting Snapback-local harness.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXACT_PROVIDER_CONFORMANCE_CHECK_ID = 'data-provider-conformance';
export const SNAPBACK_EXACT_PROVIDER_CONFORMANCE_MISSING =
  'SNAPBACK_CAPABILITY_EXACT_PROVIDER_CONFORMANCE_MISSING';

export const EXACT_PROVIDER_CONFORMANCE_CANDIDATE_PATHS = [
  'packages/exact-contract/src/__tests__/data-provider-conformance.test.ts',
  'packages/exact-contract/src/__tests__/contract-data-provider-conformance.test.ts',
  'packages/exact-contract/src/__tests__/provider-conformance.test.ts',
  'packages/exact-contract/src/conformance/data-provider-conformance.ts',
  'packages/exact-contract/src/conformance/data-provider.ts',
  'packages/exact-contract/src/runtime/data-provider-conformance.ts',
  'packages/exact-data-provider-conformance/package.json',
  'packages/data-provider-conformance/package.json',
];

export function discoverExactProviderConformance({
  exactRoot = null,
  providerConformancePath = process.env.SNAPBACK_EXACT_PROVIDER_CONFORMANCE ?? null,
} = {}) {
  const resolvedExactRoot = resolveExactRoot(exactRoot);
  const installedConformance = resolveInstalledProviderConformance(resolvedExactRoot);
  if (installedConformance) {
    return {
      ok: true,
      status: 'available',
      available: true,
      runnable: true,
      exactRoot: resolvedExactRoot,
      expectedCheckId: EXACT_PROVIDER_CONFORMANCE_CHECK_ID,
      exactVerify: {
        path: null,
        present: false,
        check: {
          id: EXACT_PROVIDER_CONFORMANCE_CHECK_ID,
          source: 'package-export',
        },
        relatedChecks: [],
        profiles: [],
      },
      candidates: [installedConformance],
      diagnostics: [],
    };
  }
  const exactVerifyPath = resolve(resolvedExactRoot, 'exact-verify.json');
  const exactContractRuntimePath = resolve(
    resolvedExactRoot,
    'packages/exact-contract/src/runtime/data-provider.ts',
  );

  if (!existsSync(exactVerifyPath) || !existsSync(exactContractRuntimePath)) {
    return {
      ok: false,
      status: 'exact-missing',
      available: false,
      runnable: false,
      exactRoot: resolvedExactRoot,
      expectedCheckId: EXACT_PROVIDER_CONFORMANCE_CHECK_ID,
      exactVerify: {
        path: exactVerifyPath,
        present: existsSync(exactVerifyPath),
      },
      candidates: buildCandidateReport(resolvedExactRoot, providerConformancePath),
      diagnostics: [
        conformanceDiagnostic(
          'SNAPBACK_CAPABILITY_EXACT_MISSING',
          'Exact checkout with Contract runtime support was not found.',
          {
            exact_root: resolvedExactRoot,
            expected_files: [exactVerifyPath, exactContractRuntimePath],
            next_checks: [
              'set SNAPBACK_EXACT_ROOT to a local Exact checkout',
              'install or update Exact so packages/exact-contract/src/runtime/data-provider.ts is present',
            ],
          },
        ),
      ],
    };
  }

  const exactVerify = readExactVerify(exactVerifyPath);
  const candidates = buildCandidateReport(resolvedExactRoot, providerConformancePath);
  const presentCandidates = candidates.filter((candidate) => candidate.present);
  const exactVerifyCheck = exactVerify.check ?? null;
  const available = Boolean(exactVerifyCheck || presentCandidates.length > 0);
  const runnable = Boolean(exactVerifyCheck);
  const status = runnable ? 'available' : available ? 'candidate-found' : 'missing';
  const diagnostics = [];

  if (!available) {
    diagnostics.push(
      conformanceDiagnostic(
        SNAPBACK_EXACT_PROVIDER_CONFORMANCE_MISSING,
        'Exact checkout is present, but no Exact-owned Contract DataProvider conformance suite was found.',
        {
          exact_root: resolvedExactRoot,
          expected_check_id: EXACT_PROVIDER_CONFORMANCE_CHECK_ID,
          exact_verify: exactVerifyPath,
          candidate_paths: candidates.map((candidate) => candidate.path),
          related_exact_checks: exactVerify.relatedChecks.map((check) => check.id),
          next_checks: [
            'land the Exact-owned data-provider-conformance check in exact-verify.json',
            'then run this probe with --run or --require from Snapback',
          ],
        },
      ),
    );
  }

  if (exactVerify.error) {
    diagnostics.push(
      conformanceDiagnostic(
        'SNAPBACK_CAPABILITY_EXACT_VERIFY_INVALID',
        'Exact verify registry could not be parsed while looking for provider conformance.',
        {
          exact_root: resolvedExactRoot,
          exact_verify: exactVerifyPath,
          error: exactVerify.error,
        },
      ),
    );
  }

  return {
    ok: runnable,
    status,
    available,
    runnable,
    exactRoot: resolvedExactRoot,
    expectedCheckId: EXACT_PROVIDER_CONFORMANCE_CHECK_ID,
    exactVerify,
    candidates,
    diagnostics,
  };
}

function resolveInstalledProviderConformance(root) {
  const packageRoot = join(root, 'node_modules', '@exact', 'contract');
  const packageJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
  const entry = manifest.exports?.['./conformance'];
  const target = typeof entry === 'string' ? entry : entry?.import ?? entry?.default;
  if (typeof target !== 'string') {
    return null;
  }
  const path = resolve(packageRoot, target);
  if (!existsSync(path)) {
    return null;
  }
  return {
    source: 'package-export',
    label: '@exact/contract/conformance',
    path,
    present: true,
  };
}

export function conformanceDiagnostic(code, message, details = {}) {
  return {
    code,
    severity: code === SNAPBACK_EXACT_PROVIDER_CONFORMANCE_MISSING ? 'warning' : 'error',
    subsystem: 'contract-integration',
    message,
    details: {
      target_surface: 'Contract/Exact provider conformance',
      ...details,
    },
  };
}

function resolveExactRoot(exactRoot) {
  return resolve(
    exactRoot ??
      process.env.SNAPBACK_EXACT_ROOT ??
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'exact'),
  );
}

function buildCandidateReport(exactRoot, providerConformancePath) {
  const explicitPath = providerConformancePath
    ? {
        source: 'SNAPBACK_EXACT_PROVIDER_CONFORMANCE',
        label: 'explicit provider conformance suite',
        path: resolveMaybeRelative(exactRoot, providerConformancePath),
      }
    : null;

  return [
    ...(explicitPath ? [explicitPath] : []),
    ...EXACT_PROVIDER_CONFORMANCE_CANDIDATE_PATHS.map((relativePath) => ({
      source: 'known-path',
      label: relativePath,
      path: resolve(exactRoot, relativePath),
    })),
  ].map((candidate) => ({
    ...candidate,
    present: existsSync(candidate.path),
  }));
}

function readExactVerify(exactVerifyPath) {
  if (!existsSync(exactVerifyPath)) {
    return {
      path: exactVerifyPath,
      present: false,
      check: null,
      relatedChecks: [],
      profiles: [],
    };
  }

  try {
    const registry = JSON.parse(readFileSync(exactVerifyPath, 'utf8'));
    const checks = Array.isArray(registry.checks) ? registry.checks : [];
    const profiles = Array.isArray(registry.profiles) ? registry.profiles : [];
    const check = checks.find((entry) => entry?.id === EXACT_PROVIDER_CONFORMANCE_CHECK_ID) ?? null;
    const relatedChecks = checks
      .filter((entry) => entry?.id !== EXACT_PROVIDER_CONFORMANCE_CHECK_ID && isRelatedCheck(entry))
      .map(summarizeCheck);

    return {
      path: exactVerifyPath,
      present: true,
      schemaVersion: registry.schemaVersion ?? null,
      check: check ? summarizeCheck(check) : null,
      relatedChecks,
      profiles: profiles
        .filter((profile) => Array.isArray(profile.checkIds) && profile.checkIds.includes(EXACT_PROVIDER_CONFORMANCE_CHECK_ID))
        .map((profile) => ({ id: profile.id, title: profile.title ?? null })),
    };
  } catch (error) {
    return {
      path: exactVerifyPath,
      present: true,
      check: null,
      relatedChecks: [],
      profiles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRelatedCheck(entry) {
  const haystack = [
    entry?.id,
    entry?.title,
    entry?.notes,
    ...(Array.isArray(entry?.systems) ? entry.systems : []),
    ...(Array.isArray(entry?.artifacts) ? entry.artifacts : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    haystack.includes('data-provider-conformance') ||
    haystack.includes('provider conformance') ||
    (haystack.includes('dataprovider') && haystack.includes('conformance')) ||
    (haystack.includes('data provider') && haystack.includes('conformance'))
  );
}

function summarizeCheck(entry) {
  return {
    id: entry.id,
    title: entry.title ?? null,
    command: entry.command ?? null,
    manual: Boolean(entry.manual),
    artifacts: Array.isArray(entry.artifacts) ? entry.artifacts : [],
    notes: entry.notes ?? null,
  };
}

function resolveMaybeRelative(base, candidatePath) {
  return isAbsolute(candidatePath) ? candidatePath : resolve(base, candidatePath);
}

function parseArgs(argv) {
  const parsed = {
    exactRoot: null,
    pretty: true,
    require: false,
    run: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--exact-root') {
      parsed.exactRoot = argv[++i] ?? null;
    } else if (arg === '--compact-json') {
      parsed.pretty = false;
    } else if (arg === '--require') {
      parsed.require = true;
    } else if (arg === '--run') {
      parsed.run = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    }
  }

  return parsed;
}

function usage() {
  return `Usage: node packages/snapback-contract/exact-conformance.mjs [options]

Options:
  --exact-root <path>  Exact checkout to inspect (defaults to SNAPBACK_EXACT_ROOT or ../exact)
  --run                Run Exact's registered data-provider-conformance check
  --require            Exit non-zero unless the registered Exact check is present
  --compact-json       Print compact JSON instead of pretty JSON
  --help               Show this help
`;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const report = discoverExactProviderConformance({ exactRoot: args.exactRoot });

  if (args.run) {
    if (!report.exactVerify.check) {
      console.log(JSON.stringify(report, null, args.pretty ? 2 : 0));
      return 1;
    }
    if (report.exactVerify.check.source === 'package-export') {
      console.error(
        '--run executes an Exact checkout registry command; an installed ' +
          '@exact/contract/conformance export must be driven by a consumer provider fixture.',
      );
      return 1;
    }
    const result = spawnSync(
      'bun',
      ['scripts/exact-verify.mjs', '--check', report.exactVerify.check.id, '--json'],
      {
        cwd: report.exactRoot,
        stdio: 'inherit',
      },
    );
    return result.status ?? 1;
  }

  console.log(JSON.stringify(report, null, args.pretty ? 2 : 0));
  return args.require && !report.runnable ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exit(await main(process.argv.slice(2)));
}
