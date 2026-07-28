import { spawn } from 'node:child_process';
import {
  validateColdInstallBrowserEvidence,
  validateCandidateLedger,
  validateQualifiedStagingLedger,
} from './snapback-publish-core.mjs';

export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';
export { validateColdInstallBrowserEvidence };

export function browserAssetsContainSecretCanary(builtAssets, canary) {
  if (typeof builtAssets !== 'string') {
    throw new TypeError('built browser assets must be text');
  }
  if (typeof canary !== 'string' || canary.length < 32) {
    throw new TypeError('browser secret canary must be an unguessable string');
  }
  return builtAssets.includes(canary);
}

export function findBrowserVisibleLeaks({ surfaces, forbiddenMarkers }) {
  if (!Array.isArray(surfaces) || surfaces.some((value) => typeof value !== 'string')) {
    throw new TypeError('browser-visible surfaces must be an array of strings');
  }
  if (
    !Array.isArray(forbiddenMarkers)
    || forbiddenMarkers.some(({ kind, value } = {}) => (
      typeof kind !== 'string'
      || kind.length === 0
      || typeof value !== 'string'
      || value.length === 0
    ))
  ) {
    throw new TypeError('browser forbidden markers must be non-empty kind/value pairs');
  }
  const visible = surfaces.join('\n');
  return [...new Set(
    forbiddenMarkers
      .filter(({ value }) => visible.includes(value))
      .map(({ kind }) => kind),
  )].sort();
}

// @ref LLP 0041#acceptance — the external package proof exposes a closed
// bootstrap surface and fails before it can silently run a different proof.
export const usage = `Usage:
  node scripts/snapback-package-cold-install.mjs [options]

Prove the packaged Snapback closure through either a disposable staged
registry or the public registry, in a fresh external application directory.

Options:
  --ledger <path>   Publication ledger to prove
                    (default: dist-publish/publish-ledger.json)
  --install-source <staged|public>
                    Resolve immutable tarballs from the staged ledger
                    (default) or install the published version from npm
  --registry <url>  Registry used by --install-source public
                    (default: https://registry.npmjs.org)
  --root-selector <exact|latest>
                    Install all exact aliases (default), or first install only
                    @ccheever/snapback-cli@latest and verify its selected
                    closure/default-tag vector before expanding the proof
  --receipt <path>  Write the retained proof receipt to this path
  --keep            Keep the temporary external application directory
  -h, --help        Print this help without staging or installing packages
`;

export function parseArguments(args) {
  if (!Array.isArray(args)) throw new TypeError('arguments must be an array');
  const parsed = {
    help: false,
    ledger: null,
    installSource: 'staged',
    registry: PUBLIC_NPM_REGISTRY,
    receipt: null,
    keep: false,
    rootSelector: 'exact',
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      if (seen.has('help')) throw new TypeError('duplicate argument: --help');
      seen.add('help');
      parsed.help = true;
      continue;
    }
    if (argument === '--keep') {
      if (seen.has(argument)) throw new TypeError('duplicate argument: --keep');
      seen.add(argument);
      parsed.keep = true;
      continue;
    }
    if (
      argument === '--ledger'
      || argument === '--receipt'
      || argument === '--install-source'
      || argument === '--registry'
      || argument === '--root-selector'
    ) {
      if (seen.has(argument)) throw new TypeError(`duplicate argument: ${argument}`);
      seen.add(argument);
      const value = args[index + 1];
      if (value == null || value.startsWith('-')) {
        throw new TypeError(`${argument} requires a value`);
      }
      const key = argument === '--install-source'
        ? 'installSource'
        : argument === '--root-selector'
          ? 'rootSelector'
          : argument.slice(2);
      parsed[key] = value;
      index += 1;
      continue;
    }
    throw new TypeError(`unrecognized argument: ${argument}`);
  }
  if (!['staged', 'public'].includes(parsed.installSource)) {
    throw new TypeError('--install-source must be staged or public');
  }
  if (!['exact', 'latest'].includes(parsed.rootSelector)) {
    throw new TypeError('--root-selector must be exact or latest');
  }
  if (parsed.rootSelector === 'latest' && parsed.installSource !== 'public') {
    throw new TypeError('--root-selector latest requires --install-source public');
  }
  let registry;
  try {
    registry = new URL(parsed.registry);
  } catch {
    throw new TypeError('--registry must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(registry.protocol)) {
    throw new TypeError('--registry must be an absolute http(s) URL');
  }
  parsed.registry = registry.href.replace(/\/$/u, '');
  return parsed;
}

export function validatePublicPublicationLedger(ledger, expectedSourceNames) {
  const legacyLatest = ledger?.schemaVersion === 'snapback.package-publication.v1';
  const candidate = ledger?.schemaVersion === 'snapback.package-candidate-ledger.v1';
  if (!legacyLatest && !candidate) {
    throw new TypeError('unsupported publication ledger');
  }
  if (ledger.mode !== 'publish') {
    throw new TypeError('public install requires a successful publication ledger');
  }
  if (ledger.sourceDirty !== false) {
    throw new TypeError('public install refuses a dirty-source publication ledger');
  }
  if (ledger.scopePreset !== 'ccheever') {
    throw new TypeError('public install requires the decided ccheever public aliases');
  }
  if (ledger.registry !== PUBLIC_NPM_REGISTRY) {
    throw new TypeError('public install requires the official npm registry');
  }
  if (legacyLatest && ledger.tag !== 'latest') {
    throw new TypeError('legacy public ledger must select latest');
  }
  if (candidate) {
    validateCandidateLedger(ledger);
  }
  if (typeof ledger.revision !== 'string' || !/^[0-9a-f]{40}$/u.test(ledger.revision)) {
    throw new TypeError('publication ledger has no immutable source revision');
  }
  const packages = Array.isArray(ledger.packages) ? ledger.packages : [];
  if (packages.length !== expectedSourceNames.length) {
    throw new TypeError('publication ledger is not the exact expected package closure');
  }
  const bySourceName = new Map(packages.map((entry) => [entry.sourceName, entry]));
  if (bySourceName.size !== packages.length) {
    throw new TypeError('publication ledger contains duplicate source package names');
  }
  for (const sourceName of expectedSourceNames) {
    const entry = bySourceName.get(sourceName);
    if (!entry) throw new TypeError(`publication ledger omits ${sourceName}`);
    if (entry.version !== ledger.version) {
      throw new TypeError(`publication ledger version drift for ${sourceName}`);
    }
    if (!['published', 'skipped-already-published'].includes(entry.status)) {
      throw new TypeError(`publication ledger has no successful public status for ${sourceName}`);
    }
    if (candidate && entry.candidateTagVerified !== true) {
      throw new TypeError(`candidate tag was not registry-verified for ${sourceName}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new TypeError(`publication ledger has no immutable sha256 for ${sourceName}`);
    }
    if (
      typeof entry.registrySha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(entry.registrySha256)
    ) {
      throw new TypeError(`publication ledger has no registry sha256 for ${sourceName}`);
    }
    const expectedPublicName = `@ccheever/snapback-${sourceName.slice('@snapback/'.length)}`;
    if (entry.name !== expectedPublicName) {
      throw new TypeError(`publication ledger alias drift for ${sourceName}`);
    }
  }
  return bySourceName;
}

export function validateStagedPublicationLedger(ledger) {
  if (ledger?.schemaVersion === 'snapback.package-qualified-staging-ledger.v1') {
    return validateQualifiedStagingLedger(ledger);
  }
  if (
    ledger?.schemaVersion !== 'snapback.package-candidate-ledger.v1'
    && ledger?.schemaVersion !== 'snapback.package-publication.v1'
  ) {
    throw new TypeError('unsupported staged publication ledger');
  }
  return ledger;
}

function collectInstalledSnapbackVersions(node, output = new Map()) {
  for (const [dependency, child] of Object.entries(node?.dependencies ?? {})) {
    if (dependency.startsWith('@snapback/')) {
      if (typeof child?.version !== 'string') {
        throw new TypeError(`latest-root dependency ${dependency} has no installed version`);
      }
      const prior = output.get(dependency);
      if (prior && prior !== child.version) {
        throw new TypeError(`latest-root dependency ${dependency} resolved multiple versions`);
      }
      output.set(dependency, child.version);
    }
    collectInstalledSnapbackVersions(child, output);
  }
  return output;
}

export function validateLatestRootResolution({
  tree,
  ledger,
  hostRuntime,
  tagVector,
}) {
  validateCandidateLedger(ledger);
  const installed = collectInstalledSnapbackVersions(tree);
  for (const sourceName of [
    '@snapback/cli',
    '@snapback/client',
    '@snapback/codegen',
    '@snapback/contract',
    hostRuntime,
  ]) {
    if (installed.get(sourceName) !== ledger.version) {
      throw new TypeError(`latest root did not resolve ${sourceName}@${ledger.version}`);
    }
  }
  for (const sourceName of installed.keys()) {
    const row = ledger.packages.find((entry) => entry.sourceName === sourceName);
    if (!row || installed.get(sourceName) !== row.version) {
      throw new TypeError(`latest root escaped the candidate ledger at ${sourceName}`);
    }
  }
  if (tagVector === null || typeof tagVector !== 'object' || Array.isArray(tagVector)) {
    throw new TypeError('latest-root proof has no complete default-tag vector');
  }
  for (const row of ledger.packages) {
    if (tagVector[row.name] !== row.version) {
      throw new TypeError(`latest default-tag vector drifted for ${row.name}`);
    }
  }
  return {
    root: '@snapback/cli',
    selected: ledger.version,
    installed: Object.fromEntries([...installed.entries()].sort()),
    defaultTagVector: Object.fromEntries(ledger.packages.map((row) => [
      row.name,
      tagVector[row.name],
    ])),
  };
}

export function validateFinalLatestReceipts({ ledger, records }) {
  validateCandidateLedger(ledger);
  if (!Array.isArray(records) || records.length !== 2) {
    throw new TypeError('final promotion requires two latest-root receipts');
  }
  const byPlatform = new Map();
  for (const record of records) {
    const receipt = record.receipt;
    const platform = `${receipt?.machine?.platform}-${receipt?.machine?.architecture}`;
    const hostRuntime = platform === 'darwin-arm64'
      ? '@snapback/runtime-darwin-arm64'
      : platform === 'linux-x64'
        ? '@snapback/runtime-linux-x64'
        : null;
    if (
      receipt?.schemaVersion !== 'snapback.package-cold-install.v1'
      || receipt.ok !== true
      || receipt.rootSelector !== 'latest'
      || receipt.latestRootResolution?.selected !== ledger.version
      || receipt.candidateLedgerSha256 !== ledger.candidateLedgerSha256
      || receipt.sourceRevision !== ledger.revision
      || receipt.sourceDirty !== false
      || receipt.version !== ledger.version
      || receipt.scopePreset !== ledger.scopePreset
      || receipt.installSource !== 'public'
      || receipt.registry !== PUBLIC_NPM_REGISTRY
      || receipt.machine?.separatelyProvisionedCleanMachine !== true
      || receipt.checks?.latestRootCandidateClosure !== true
      || receipt.checks?.publicRegistryTarballDigestMatch !== true
    ) {
      throw new TypeError(`invalid final latest-root receipt: ${platform}`);
    }
    validateColdInstallBrowserEvidence(receipt);
    if (!['darwin-arm64', 'linux-x64'].includes(platform) || byPlatform.has(platform)) {
      throw new TypeError(`duplicate or unsupported final latest-root receipt: ${platform}`);
    }
    if (receipt.machine.runtimePackage !== hostRuntime) {
      throw new TypeError(`final latest-root receipt selected the wrong runtime: ${platform}`);
    }
    const receiptRows = Array.isArray(receipt.packages) ? receipt.packages : [];
    const packagesBySource = new Map(
      receiptRows.map((row) => [row.sourceName, row]),
    );
    if (
      receiptRows.length !== ledger.packages.length
      || packagesBySource.size !== ledger.packages.length
    ) {
      throw new TypeError(`final latest-root package closure drifted: ${platform}`);
    }
    for (const candidate of ledger.packages) {
      const observed = packagesBySource.get(candidate.sourceName);
      if (
        observed?.publishedName !== candidate.name
        || observed.version !== candidate.version
        || observed.sha256 !== candidate.sha256
        || observed.registrySha256 !== candidate.registrySha256
      ) {
        throw new TypeError(
          `final latest-root package evidence drifted for ${candidate.sourceName}: ${platform}`,
        );
      }
    }
    const resolution = receipt.latestRootResolution;
    if (
      resolution.root !== '@snapback/cli'
      || resolution.defaultTagVector === null
      || typeof resolution.defaultTagVector !== 'object'
      || Array.isArray(resolution.defaultTagVector)
      || Object.keys(resolution.defaultTagVector).length !== ledger.packages.length
    ) {
      throw new TypeError(`final latest-root tag vector is incomplete: ${platform}`);
    }
    for (const candidate of ledger.packages) {
      if (resolution.defaultTagVector[candidate.name] !== candidate.version) {
        throw new TypeError(
          `final latest-root tag vector drifted for ${candidate.name}: ${platform}`,
        );
      }
    }
    const installed = resolution.installed;
    if (installed === null || typeof installed !== 'object' || Array.isArray(installed)) {
      throw new TypeError(`final latest-root installed closure is missing: ${platform}`);
    }
    const candidateBySource = new Map(
      ledger.packages.map((row) => [row.sourceName, row]),
    );
    for (const sourceName of [
      '@snapback/cli',
      '@snapback/client',
      '@snapback/codegen',
      '@snapback/contract',
      hostRuntime,
    ]) {
      if (installed[sourceName] !== candidateBySource.get(sourceName)?.version) {
        throw new TypeError(
          `final latest-root installed closure drifted for ${sourceName}: ${platform}`,
        );
      }
    }
    for (const [sourceName, version] of Object.entries(installed)) {
      if (candidateBySource.get(sourceName)?.version !== version) {
        throw new TypeError(
          `final latest-root installed closure escaped at ${sourceName}: ${platform}`,
        );
      }
    }
    if (!/^[0-9a-f]{64}$/u.test(record.sha256 ?? '')) {
      throw new TypeError(`${platform} final receipt has no file digest`);
    }
    byPlatform.set(platform, {
      platform,
      sha256: record.sha256,
      machine: receipt.machine,
      latestRootResolution: resolution,
    });
  }
  return ['darwin-arm64', 'linux-x64'].map((platform) => {
    const record = byPlatform.get(platform);
    if (!record) throw new TypeError(`missing final latest-root receipt: ${platform}`);
    return record;
  });
}

export function aggregatePublicPackageProofs({
  ledger,
  expectedSourceNames,
  expectedPlatforms,
  receipts,
}) {
  const ledgerEntries = validatePublicPublicationLedger(ledger, expectedSourceNames);
  if (!Array.isArray(receipts)) throw new TypeError('platform receipts must be an array');
  const byPlatform = new Map();
  for (const record of receipts) {
    const receipt = record?.receipt;
    if (receipt?.schemaVersion !== 'snapback.package-cold-install.v1' || receipt.ok !== true) {
      throw new TypeError(`invalid platform receipt: ${record?.path ?? '<unknown>'}`);
    }
    const platform = `${receipt.machine?.platform}-${receipt.machine?.architecture}`;
    if (!expectedPlatforms.has(platform)) {
      throw new TypeError(`unsupported platform receipt: ${platform}`);
    }
    if (byPlatform.has(platform)) throw new TypeError(`duplicate platform receipt: ${platform}`);
    if (
      receipt.platformClaimSatisfied !== true
      || receipt.installSource !== 'public'
      || (ledger.schemaVersion === 'snapback.package-candidate-ledger.v1'
        && receipt.rootSelector !== 'exact')
      || receipt.publicationMode !== 'publish'
      || receipt.registry !== PUBLIC_NPM_REGISTRY
      || receipt.sourceDirty !== false
      || receipt.machine?.separatelyProvisionedCleanMachine !== true
    ) {
      throw new TypeError(`platform receipt is not independently public and clean: ${platform}`);
    }
    if (receipt.machine?.runtimePackage !== expectedPlatforms.get(platform)) {
      throw new TypeError(`platform receipt selected the wrong runtime package: ${platform}`);
    }
    if (
      receipt.sourceRevision !== ledger.revision
      || receipt.version !== ledger.version
      || receipt.scopePreset !== ledger.scopePreset
    ) {
      throw new TypeError(`platform receipt identity drift: ${platform}`);
    }
    validateColdInstallBrowserEvidence(receipt);
    if (
      receipt.checks?.publicRegistryAliasResolution !== true
      || receipt.checks?.publicRegistryTarballDigestMatch !== true
      || receipt.checks?.registryTarballCount !== expectedSourceNames.length
      || receipt.checks?.noSiblingSourceCheckout !== true
      || receipt.checks?.localCodegenOffline !== true
      || receipt.checks?.remoteCodegenOffline !== true
      || receipt.checks?.packagedCliIntrospection !== true
      || receipt.checks?.packagedRuntimeDoctor !== true
      || receipt.checks?.packagedComparatorProfile !== true
      || receipt.checks?.packagedScaffoldAndOfflineGenerate !== true
      || receipt.checks?.packagedDeployBuildAndVerify !== true
      || receipt.checks?.packagedManagedDevReadyAttachWatchAndStop !== true
      || receipt.checks?.packedReactWebTypecheckTestBuildAndLiveAcceptance !== true
      || receipt.checks?.packedReactOneCommandBackendViteJourney !== true
      || receipt.checks?.packedReactExpoTypecheckAndIosExport !== true
      || receipt.checks?.packagedViteRelativeVersionedSeedSeam !== true
      || receipt.checks?.browserAdapterBundle !== true
    ) {
      throw new TypeError(`platform receipt lacks the complete packaged-loop proof: ${platform}`);
    }
    const receiptPackageRows = Array.isArray(receipt.packages) ? receipt.packages : [];
    const receiptPackages = new Map(
      receiptPackageRows.map((entry) => [entry.sourceName, entry]),
    );
    if (
      receiptPackageRows.length !== expectedSourceNames.length
      || receiptPackages.size !== expectedSourceNames.length
    ) {
      throw new TypeError(`platform receipt package closure drift: ${platform}`);
    }
    for (const sourceName of expectedSourceNames) {
      const ledgerEntry = ledgerEntries.get(sourceName);
      const receiptEntry = receiptPackages.get(sourceName);
      if (
        receiptEntry?.publishedName !== ledgerEntry.name
        || receiptEntry?.version !== ledgerEntry.version
        || receiptEntry?.registrySha256 !== ledgerEntry.registrySha256
      ) {
        throw new TypeError(`platform receipt package drift for ${sourceName}: ${platform}`);
      }
    }
    byPlatform.set(platform, {
      platform,
      sha256: record.sha256,
      machine: receipt.machine,
      checks: receipt.checks,
    });
  }
  for (const platform of expectedPlatforms.keys()) {
    if (!byPlatform.has(platform)) throw new TypeError(`missing platform receipt: ${platform}`);
  }
  return {
    schemaVersion: 'snapback.package-cold-install.aggregate.v1',
    ok: true,
    claimTreatment: 'authoritative',
    claimSatisfied: true,
    sourceRevision: ledger.revision,
    sourceDirty: false,
    publicationMode: ledger.mode,
    publicationLedgerSchema: ledger.schemaVersion,
    publicationTag: ledger.tag,
    candidateLedgerSha256: ledger.candidateLedgerSha256 ?? null,
    installSource: 'public',
    scopePreset: ledger.scopePreset,
    version: ledger.version,
    registry: PUBLIC_NPM_REGISTRY,
    packages: expectedSourceNames.map((sourceName) => {
      const entry = ledgerEntries.get(sourceName);
      return {
        sourceName,
        publishedName: entry.name,
        version: entry.version,
        registrySha256: entry.registrySha256,
        registryIntegrity: entry.registryIntegrity ?? null,
      };
    }),
    platforms: [...byPlatform.values()],
    checks: {
      completePublicRegistryClosure: true,
      registryTarballDigestsMatchPublication: true,
      separatelyProvisionedCleanMachines: true,
      completeSupportedRuntimeMatrix: true,
      packagedRuntimeDoctor: true,
      packagedScaffoldGenerateDevTestAndWatch: true,
      realBrowserSeedLiveReloadOnEveryPlatform: true,
      browserPrivateSurfaceAbsenceOnEveryPlatform: true,
      noSiblingSourceCheckout: true,
    },
    nonclaims: [],
  };
}

export function runAsync(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let settled = false;
    let timeout;
    let stdout = '';
    let stderr = '';
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    let child;
    try {
      child = spawn(command, commandArgs, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      settle(
        rejectRun,
        new Error(`${command} ${commandArgs.join(' ')} failed to spawn: ${error.message}`, { cause: error }),
      );
      return;
    }

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      settle(
        rejectRun,
        new Error(`${command} ${commandArgs.join(' ')} failed to spawn: ${error.message}`, { cause: error }),
      );
    });
    child.once('close', (status, signal) => {
      if (status !== 0) {
        settle(
          rejectRun,
          new Error(`${command} ${commandArgs.join(' ')} failed (${status ?? signal}):\n${stderr || stdout}`),
        );
        return;
      }
      settle(resolveRun, stdout);
    });
    timeout = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? 360_000);
  });
}
