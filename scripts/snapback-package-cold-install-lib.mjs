import { spawn } from 'node:child_process';

export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';

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
    ) {
      if (seen.has(argument)) throw new TypeError(`duplicate argument: ${argument}`);
      seen.add(argument);
      const value = args[index + 1];
      if (value == null || value.startsWith('-')) {
        throw new TypeError(`${argument} requires a value`);
      }
      const key = argument === '--install-source' ? 'installSource' : argument.slice(2);
      parsed[key] = value;
      index += 1;
      continue;
    }
    throw new TypeError(`unrecognized argument: ${argument}`);
  }
  if (!['staged', 'public'].includes(parsed.installSource)) {
    throw new TypeError('--install-source must be staged or public');
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
  if (ledger?.schemaVersion !== 'snapback.package-publication.v1') {
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
  if (ledger.registry !== PUBLIC_NPM_REGISTRY || ledger.tag !== 'latest') {
    throw new TypeError('public install requires the official npm registry under latest');
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
