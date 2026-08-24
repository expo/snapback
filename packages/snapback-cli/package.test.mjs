import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  __test,
  attachDevControlChannel,
  addTarget,
  applyDeployPlan,
  buildRelease,
  createAdapterQualificationManifest,
  createDeployPlan,
  createHostedAuthDrillReceipt,
  createPreparedReleaseManifest,
  createRemoteDrillPlan,
  doctor,
  doctorTarget,
  generateApp,
  inspectTarget,
  inspectTargetAdmin,
  listBackups,
  managedDevIdentityCapability,
  packagedRuntimeReadiness,
  queryControlLogs,
  renderScaffoldAuthoringSkill,
  scaffoldApp,
  sealHostedAdmissionEnvelope,
  showTarget,
  validateScaffoldLifecycleManifest,
  validateDevTarget,
  validateTargetDescriptor,
  verifyBackupManifest,
  verifyControlAuditLedger,
  verifyPreparedReleaseArtifacts,
  verifyRemoteDrillPlan,
  verifyRestoreReceipt,
  verifyRelease,
} from './index.mjs';
import { __deploymentTest } from './deployment-control.mjs';
import {
  defineTemplateCarrierConfig,
  selfCheckTemplateCarrierConfig,
} from './carrier-kit.mjs';
import { assertTemplateScriptSurface } from '../../scripts/template-portfolio-qualification-lib.mjs';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'snapback-cli-package-')));
// issues/closed/20260810-expo-chat-template-pins-trail-the-closure: scaffoldApp
// substitutes `__SNAPBACK_VERSION__` with a caret on the CLI's OWN version, so
// a scaffold is self-consistent with the closure that produced it by
// construction. Assert that identity rather than the `^x.y.z` shape — a shape
// match passes on any stamped version, including a hardcoded one.
const SCAFFOLD_PIN = `^${JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version}`;
assert.throws(
  () => validateScaffoldLifecycleManifest({
    scripts: { generate: 'snapback generate snapback', dev: 'snapback dev snapback' },
  }, { template: 'missing-prove-control' }),
  (error) => error?.code === 'SNAPBACK_SCAFFOLD_LIFECYCLE_STAGE_MISSING'
    && error?.diagnostic?.details?.stage === 'prove'
    && error?.message.includes('missing scaffold lifecycle stage prove'),
  'VCF-E-L1 must refuse a missing scaffolded stage before output and name it',
);
// @ref LLP 0259#2-start-packet-not-a-handful-of-independent-cards — every
// scaffold's AGENTS.md transcludes its template start packet with a digest
// comment; identity is a compare against the canonical guide/start page, the
// way the skill's Rosetta block is checked against its records.
const assertStartPacketTransclusion = (agentInstructions, templateName) => {
  assert.doesNotMatch(agentInstructions, /capability index first/u);
  const transcluded = new RegExp(
    `<!-- start-packet:begin ${templateName} digest=sha256:([0-9a-f]{64}) -->\\n([\\s\\S]*?)<!-- start-packet:end -->`,
    'u',
  ).exec(agentInstructions);
  assert.ok(transcluded, `${templateName} AGENTS.md must transclude its start packet`);
  assert.equal(
    createHash('sha256').update(transcluded[2]).digest('hex'),
    transcluded[1],
    `${templateName} transcluded start packet must match its digest comment`,
  );
  const canonical = new RegExp(
    `<!-- start-packet:begin ${templateName} -->\\n([\\s\\S]*?)<!-- start-packet:end -->`,
    'u',
  ).exec(readFileSync(new URL(`../../guide/start/${templateName}.md`, import.meta.url), 'utf8'));
  assert.ok(canonical, `guide/start/${templateName}.md must carry the canonical packet`);
  assert.equal(
    transcluded[2],
    canonical[1]
      .replaceAll('](./', '](/_snapback/guide/start/')
      .replaceAll('](../', '](/_snapback/guide/'),
    `${templateName} transcluded packet must match guide/start/${templateName}.md (run scripts/check-first-read.mjs --write)`,
  );
};
const assertScaffoldScriptSurface = (projectRoot, templateName, manifest) => (
  assertTemplateScriptSurface({
    name: templateName,
    manifest,
    readme: readFileSync(join(projectRoot, 'README.md'), 'utf8'),
    instructions: readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'),
  })
);
try {
  const packagedSkillContent = readFileSync(
    new URL('./skills/snapback-authoring/SKILL.md', import.meta.url),
    'utf8',
  );
  const canonicalSkillContent = readFileSync(
    new URL('../../skills/snapback-authoring/SKILL.md', import.meta.url),
    'utf8',
  );
  assert.equal(
    packagedSkillContent,
    canonicalSkillContent,
    'refresh the packaged snapback-authoring skill by copying the canonical file over it',
  );
  const cliPackageManifest = JSON.parse(readFileSync(
    new URL('./package.json', import.meta.url),
    'utf8',
  ));
  assert.ok(cliPackageManifest.files.includes('skills'), 'the published CLI package must include skills');
  assert.ok(
    cliPackageManifest.files.includes('fixtures/verify'),
    'the published CLI package must include the copyable verify-config fixture',
  );
  assert.ok(cliPackageManifest.files.includes('carrier-kit.mjs'));
  assert.equal(cliPackageManifest.exports['./carrier-kit'].default, './carrier-kit.mjs');
  const carrierSource = readFileSync(new URL('./carrier-kit.mjs', import.meta.url), 'utf8');
  assert.match(carrierSource, /import plistlib/u);
  assert.match(carrierSource, /EXDevMenuIsOnboardingFinished/u);
  assert.match(carrierSource, /'openurl'/u);
  assert.match(carrierSource, /native-offline-relaunch\.png/u);
  const carrierSelfCheck = await selfCheckTemplateCarrierConfig(defineTemplateCarrierConfig({
    schemaVersion: 'snapback.template-carriers.v1',
    verifyCommand: ['npm', 'run', 'prove'],
    verifyReceipt: '.snapback/verify-receipt.json',
    carriers: {
      'native-simulator': {
        command: ['snapback', 'dev', '--ios-udid', '{udid}'],
        scheme: 'exp',
        bundleId: 'host.exp.Exponent',
        driveUrl: 'exp://127.0.0.1:8081/--/proof/carrier-ready',
      },
    },
  }));
  assert.equal(carrierSelfCheck.ok, true);
  assert.equal(
    carrierSelfCheck.plistlib.literalKey,
    'com.apple.CoreSimulator.CoreSimulatorBridge-->exp',
  );
  assert.ok(cliPackageManifest.files.includes('templates'), 'the published CLI package must include the scaffold templates');

  // npm-packlist unconditionally strips literal .gitignore files from the
  // published tarball, even under a files allowlist, so every template must
  // ship the carrier as gitignore.template (scaffoldApp renames it back).
  const templatesRoot = fileURLToPath(new URL('./templates/', import.meta.url));
  const templateNames = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(templateNames.length > 0, 'the CLI package must ship at least one scaffold template');
  const urlFirstScripts = Object.freeze({
    'crud-dashboard': {
      dev: 'snapback dev snapback --write-env',
      'dev:client': 'vite',
    },
    react: {
      dev: 'snapback dev snapback --write-env',
      'dev:client': 'vite',
    },
    'expo-chat': {
      dev: 'snapback dev snapback --write-env',
      'dev:client': 'expo start',
      'dev:supervised': 'snapback dev snapback --expo --expo-platform web',
    },
    'media-feed': {
      dev: 'snapback dev snapback --write-env',
      'dev:client': 'expo start',
      'dev:supervised': 'snapback dev snapback --expo',
    },
  });
  for (const templateName of templateNames) {
    assert.equal(
      existsSync(join(templatesRoot, templateName, 'gitignore.template')),
      true,
      `template ${templateName} must ship gitignore.template so npm pack preserves it`,
    );
    const strippedGitignores = readdirSync(join(templatesRoot, templateName), { recursive: true })
      .filter((entry) => entry === '.gitignore' || entry.endsWith(`/.gitignore`));
    assert.deepEqual(
      strippedGitignores,
      [],
      `template ${templateName} must not ship literal .gitignore files — npm pack silently drops them`,
    );
    // issues/20260809-expo-chat-template-gitignore-restore-lock: the restore
    // lock is a SIBLING of the state directory, so `.snapback/` does not cover
    // it, and it records an absolute host-pinned target-instance reservation.
    // A copy, archive, or `git add` that carries it across a host boundary is
    // what broke the first external 0.1.11 iOS run.
    const ignoreRules = readFileSync(join(templatesRoot, templateName, 'gitignore.template'), 'utf8')
      .split('\n')
      .map((line) => line.trim());
    for (const rule of ['.snapback/', '*.snapback.restore.lock']) {
      assert.ok(
        ignoreRules.includes(rule),
        `template ${templateName} must ignore ${rule} — both local-state forms, per guide/clients/react-expo.md`,
      );
    }
    if (Object.hasOwn(urlFirstScripts, templateName)) {
      const templateManifest = JSON.parse(
        readFileSync(join(templatesRoot, templateName, 'package.json'), 'utf8'),
      );
      for (const [name, command] of Object.entries(urlFirstScripts[templateName])) {
        assert.equal(
          templateManifest.scripts?.[name],
          command,
          `${templateName} ${name} must use the LLP 0301 two-process URL-first shape`,
        );
      }
      assert.equal(templateManifest.scripts?.['snapback:dev'], undefined);
      assert.equal(templateManifest.scripts?.['client:dev'], undefined);
    }
  }

  const expectedSkillFiles = [
    '.claude/skills/snapback-authoring/SKILL.md',
    '.agents/skills/snapback-authoring/SKILL.md',
    '.cursor/skills/snapback-authoring/SKILL.md',
    '.opencode/skills/snapback-authoring/SKILL.md',
  ];
  const assertScaffoldedAuthoringSkill = (projectRoot, scaffoldResult) => {
    assert.deepEqual(scaffoldResult.skillFiles, expectedSkillFiles);
    const expectedContent = renderScaffoldAuthoringSkill(packagedSkillContent);
    const emittedContents = expectedSkillFiles.map((skillFile) => {
      const skillPath = join(projectRoot, skillFile);
      assert.equal(existsSync(skillPath), true, `scaffold must emit ${skillFile}`);
      return readFileSync(skillPath, 'utf8');
    });
    for (const emittedContent of emittedContents) {
      assert.equal(emittedContent, emittedContents[0], 'all emitted authoring skill copies must match');
      assert.equal(emittedContent, expectedContent, 'emitted authoring skill must match the deterministic transform');
      assert.doesNotMatch(emittedContent, /\.\.\/\.\.\/guide\//u);
      assert.match(emittedContent, /\/_snapback\/guide\/capabilities\.md/u);
      assert.match(emittedContent, /snapback guide/u);
    }
  };
  const assertCarrierSelfCheck = (projectRoot, expectedCarriers) => {
    const scope = join(projectRoot, 'node_modules', '@expo');
    const installedCli = join(scope, 'snapback-cli');
    mkdirSync(scope, { recursive: true });
    symlinkSync(
      realpathSync(new URL('.', import.meta.url)),
      installedCli,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    try {
      const result = spawnSync(process.execPath, ['carrier.mjs', '--self-check', '--json'], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, CI: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.schemaVersion, 'snapback.template-carrier-self-check.v1');
      assert.equal(receipt.ok, true);
      assert.deepEqual(receipt.carriers, [...expectedCarriers].sort());
    } finally {
      rmSync(join(projectRoot, 'node_modules'), { recursive: true, force: true });
    }
  };

  const deploymentControlSource = readFileSync(
    new URL('./deployment-control.mjs', import.meta.url),
    'utf8',
  );
  const declaredKeySets = [...deploymentControlSource.matchAll(/const ([A-Z0-9_]+_KEYS) = \[/g)]
    .map((match) => match[1])
    .sort();
  const registeredKeySets = [
    ...__deploymentTest.closedKeySchemaBindings.map(({ name }) => name),
    ...__deploymentTest.nonSchemaKeySets,
  ].sort();
  assert.deepEqual(
    registeredKeySets,
    declaredKeySets,
    'every deployment-control closed-key set must bind to a generated schema or be explicitly classified as non-schema',
  );
  for (const binding of __deploymentTest.closedKeySchemaBindings) {
    const schema = JSON.parse(readFileSync(
      new URL(`../../schemas/${binding.schemaFile}`, import.meta.url),
      'utf8',
    ));
    const schemaObject = binding.definition ? schema.$defs?.[binding.definition] : schema;
    assert.ok(
      schemaObject,
      `${binding.name} references missing ${binding.schemaFile}#/$defs/${binding.definition}`,
    );
    assert.equal(
      schemaObject.additionalProperties,
      false,
      `${binding.name} must bind to a closed schema object`,
    );
    assert.deepEqual(
      [...binding.keys].sort(),
      Object.keys(schemaObject.properties ?? {}).sort(),
      `${binding.name} drifted from ${binding.schemaFile}${binding.definition ? `#/$defs/${binding.definition}` : ''}`,
    );
  }

  assert.deepEqual(__test.runtimePackages, {
    'darwin-arm64': '@expo/snapback-runtime-darwin-arm64',
    'linux-x64': '@expo/snapback-runtime-linux-x64',
  });
  assert.equal(
    __test.sourceCheckoutRoot(realpathSync(new URL('.', import.meta.url))),
    realpathSync(new URL('../..', import.meta.url)),
    'a linked CLI package must recognize its owning Snapback source checkout',
  );
  assert.equal(__test.sourceCheckoutRoot(root), null);

  const capabilityReady = join(root, 'dev-identity.ready.json');
  const capabilityDatabase = join(root, 'dev-identity.sqlite3');
  const databaseCapabilityFile = `${capabilityDatabase}.dev-identity`;
  writeFileSync(databaseCapabilityFile, 'sbdev_database_fixture\n', { mode: 0o600 });
  assert.equal(managedDevIdentityCapability({
    database: { mode: 'file', path: capabilityDatabase },
    devIdentityCapabilityFile: databaseCapabilityFile,
  }, {
    readyFile: capabilityReady,
    database: capabilityDatabase,
  }), 'sbdev_database_fixture', 'file-backed targets resolve the database sibling');

  const readyCapabilityFile = `${capabilityReady}.dev-identity`;
  writeFileSync(readyCapabilityFile, 'sbdev_ready_fixture\n', { mode: 0o600 });
  assert.equal(managedDevIdentityCapability({
    database: { mode: 'memory', path: null },
    devIdentityCapabilityFile: readyCapabilityFile,
  }, {
    readyFile: capabilityReady,
  }), 'sbdev_ready_fixture', 'memory targets resolve the ready-file sibling');
  assert.equal(managedDevIdentityCapability({
    database: { mode: 'memory', path: null },
  }, {
    readyFile: capabilityReady,
  }), null, 'older descriptors without the field remain compatible');
  assert.equal(managedDevIdentityCapability({
    database: { mode: 'file', path: capabilityDatabase },
    devIdentityCapabilityFile: readyCapabilityFile,
  }, {
    readyFile: capabilityReady,
    database: capabilityDatabase,
  }), null, 'a descriptor cannot redirect file-backed custody off the database sibling');
  const missingCapabilityDatabase = join(root, 'missing-dev-identity.sqlite3');
  const missingCapabilityPath = `${missingCapabilityDatabase}.dev-identity`;
  let absentNotice = '';
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    absentNotice += String(chunk);
    return true;
  };
  try {
    const missingDescriptor = {
      database: { mode: 'file', path: missingCapabilityDatabase },
      devIdentityCapabilityFile: missingCapabilityPath,
    };
    assert.equal(__test.resolveDevIdentityCapabilityForCli(missingDescriptor, {
      database: missingCapabilityDatabase,
    }), null);
    assert.equal(__test.resolveDevIdentityCapabilityForCli(missingDescriptor, {
      database: missingCapabilityDatabase,
    }), null);
  } finally {
    process.stderr.write = originalStderrWrite;
  }
  assert.equal(
    absentNotice,
    `SNAPBACK_DEV_IDENTITY_ABSENT: no usable dev-identity capability was found at ${missingCapabilityPath}; continuing without it during Stage 1\n`,
    'the path-bearing Stage-1 absence notice is emitted once per process',
  );
  assert.deepEqual(__test.devIdentityClientEnvironment(
    { PATH: '/fixture/bin' },
    { devIdentityCapabilityFile: databaseCapabilityFile },
    'sbdev_database_fixture',
  ), {
    PATH: '/fixture/bin',
    SNAPBACK_DEV_IDENTITY_FILE: databaseCapabilityFile,
  }, 'spawned clients receive the custody file path through environment only');
  assert.deepEqual(__test.devIdentityClientEnvironment(
    { PATH: '/fixture/bin' },
    { devIdentityCapabilityFile: databaseCapabilityFile },
    null,
  ), {
    PATH: '/fixture/bin',
  }, 'older binaries leave spawned client environments unchanged');
  const freshProjectRoot = join(root, 'fresh-cleanup');
  const freshStoreRoot = join(freshProjectRoot, '.snapback');
  const freshDatabase = join(freshStoreRoot, 'dev.sqlite3');
  const freshReadyFile = join(freshStoreRoot, 'dev.ready.json');
  const freshApplicationReadyFile = join(freshStoreRoot, 'dev.application-ready.json');
  const freshAssetBlobDirectory = join(freshStoreRoot, 'assets', 'blobs');
  const freshAssetBlob = join(freshAssetBlobDirectory, 'sha256-fixture');
  const freshStoreSentinel = join(freshStoreRoot, 'keep-me.txt');
  const freshProjectAssetSentinel = join(freshProjectRoot, 'assets', 'icon.png');
  mkdirSync(freshAssetBlobDirectory, { recursive: true });
  mkdirSync(join(freshProjectRoot, 'assets'), { recursive: true });
  const managedFreshState = [
    freshDatabase,
    `${freshDatabase}-wal`,
    `${freshDatabase}-shm`,
    `${freshDatabase}-journal`,
    `${freshDatabase}.auth-keyring.json`,
    `${freshDatabase}.config.json`,
    `${freshDatabase}.operation-detail-keyring.json`,
    `${freshDatabase}.admin-token`,
    `${freshDatabase}.console-credentials`,
    `${freshDatabase}.dev-identity`,
    join(freshStoreRoot, 'completeness-proof-keyring.json'),
    join(freshStoreRoot, 'resume-keyring.json'),
    freshAssetBlob,
    freshReadyFile,
    `${freshReadyFile}.dev-identity`,
    freshApplicationReadyFile,
  ];
  for (const path of managedFreshState) writeFileSync(path, 'fixture');
  for (const path of [freshStoreSentinel, freshProjectAssetSentinel]) {
    writeFileSync(path, 'preserve');
  }
  __test.removeManagedDatabaseState(
    freshDatabase,
    freshReadyFile,
    freshApplicationReadyFile,
    freshStoreRoot,
  );
  for (const path of managedFreshState) {
    assert.equal(existsSync(path), false, `dev-fresh removes managed state ${path}`);
  }
  assert.equal(
    existsSync(freshAssetBlobDirectory),
    false,
    'dev-fresh removes the finalized asset-blob tree, not only one fixture blob',
  );
  for (const path of [freshStoreSentinel, freshProjectAssetSentinel]) {
    assert.equal(existsSync(path), true, `dev-fresh preserves unmanaged sentinel ${path}`);
    assert.equal(readFileSync(path, 'utf8'), 'preserve');
  }

  const directoryProjectRoot = join(root, 'directory-as-database');
  const directoryStoreRoot = join(directoryProjectRoot, '.snapback');
  const directoryDatabase = join(directoryStoreRoot, 'dev.sqlite3');
  const directorySentinel = join(directoryDatabase, 'keep-me.txt');
  mkdirSync(directoryDatabase, { recursive: true });
  writeFileSync(directorySentinel, 'preserve');
  assert.throws(
    () => __test.removeManagedDatabaseState(
      directoryDatabase,
      null,
      null,
      directoryStoreRoot,
    ),
    (error) => error?.code === 'SNAPBACK_RESET_DATABASE_PATH_INVALID'
      && error?.diagnostic?.details?.observedType === 'directory',
    'dev-fresh refuses a directory passed as its database before deleting its contents',
  );
  assert.equal(readFileSync(directorySentinel, 'utf8'), 'preserve');

  const linkedAssetProjectRoot = join(root, 'linked-asset-root');
  const linkedAssetStoreRoot = join(linkedAssetProjectRoot, '.snapback');
  const linkedAssetDatabase = join(linkedAssetStoreRoot, 'dev.sqlite3');
  const externalAssetRoot = join(root, 'external-asset-root');
  const externalAssetSentinel = join(externalAssetRoot, 'blobs', 'keep-me');
  mkdirSync(linkedAssetStoreRoot, { recursive: true });
  mkdirSync(dirname(externalAssetSentinel), { recursive: true });
  writeFileSync(linkedAssetDatabase, 'preserve');
  writeFileSync(externalAssetSentinel, 'preserve');
  symlinkSync(externalAssetRoot, join(linkedAssetStoreRoot, 'assets'), 'dir');
  assert.throws(
    () => __test.removeManagedDatabaseState(
      linkedAssetDatabase,
      null,
      null,
      linkedAssetStoreRoot,
    ),
    (error) => error?.code === 'SNAPBACK_RESET_STORE_OWNERSHIP_AMBIGUOUS'
      && error?.diagnostic?.details?.member === 'asset-root'
      && error?.diagnostic?.details?.observedType === 'symbolic-link',
    'dev-fresh refuses recursive cleanup through a linked asset root',
  );
  assert.equal(readFileSync(linkedAssetDatabase, 'utf8'), 'preserve');
  assert.equal(readFileSync(externalAssetSentinel, 'utf8'), 'preserve');

  const sharedStoreRoot = join(root, 'shared-store');
  const sharedDatabase = join(sharedStoreRoot, 'first.sqlite3');
  const secondDatabase = join(sharedStoreRoot, 'second.sqlite3');
  const sharedBlob = join(sharedStoreRoot, 'assets', 'blobs', 'second-database-blob');
  const sharedState = [
    sharedDatabase,
    `${sharedDatabase}.auth-keyring.json`,
    secondDatabase,
    `${secondDatabase}.auth-keyring.json`,
    join(sharedStoreRoot, 'resume-keyring.json'),
    join(sharedStoreRoot, 'completeness-proof-keyring.json'),
    sharedBlob,
    join(sharedStoreRoot, 'keep-me.txt'),
  ];
  mkdirSync(dirname(sharedBlob), { recursive: true });
  for (const path of sharedState) writeFileSync(path, 'preserve');
  assert.throws(
    () => __test.removeManagedDatabaseState(
      sharedDatabase,
      null,
      null,
      freshStoreRoot,
    ),
    (error) => error?.code === 'SNAPBACK_RESET_STORE_OWNERSHIP_AMBIGUOUS'
      && error?.diagnostic?.details?.ownedDatabase === freshDatabase,
    'dev-fresh refuses to guess ownership of directory-shared state for a custom database',
  );
  for (const path of sharedState) {
    assert.equal(existsSync(path), true, `shared-store refusal preserves ${path}`);
    assert.equal(readFileSync(path, 'utf8'), 'preserve');
  }
  assert.equal(__test.runtimeReadinessRoot({
    binary: join(root, 'target', 'release', 'snapback'),
    checkoutRoot: root,
  }), root);
  const externalCheckout = join(root, 'external-runtime-checkout');
  const externalBinary = join(externalCheckout, 'target', 'debug', 'snapback');
  mkdirSync(join(externalCheckout, 'packages', 'snapback-cli'), { recursive: true });
  mkdirSync(dirname(externalBinary), { recursive: true });
  writeFileSync(join(externalCheckout, 'Cargo.toml'), '[workspace]\n');
  writeFileSync(join(externalCheckout, 'packages', 'snapback-cli', 'package.json'), '{}\n');
  writeFileSync(externalBinary, 'runtime');
  assert.equal(__test.runtimeReadinessRoot({
    binary: externalBinary,
    source: 'override',
  }), externalCheckout);
  const fakeRuntime = join(root, 'snapback');
  writeFileSync(fakeRuntime, '#!/bin/sh\nexit 0\n');
  chmodSync(fakeRuntime, 0o755);
  const report = await doctor({
    runtimeBinary: fakeRuntime,
    env: { ...process.env, DYLD_FRAMEWORK_PATH: '/must/not/be/needed' },
    verticalSlice: false,
  });
  assert.equal(report.ok, true);
  assert.equal(report.runtime.source, 'override');
  assert.equal(report.runtimeRecovery.schemaVersion, 'snapback.runtime-recovery.v1');
  assert.equal(report.runtimeRecovery.selectedBinary, fakeRuntime);
  assert.equal(report.probe, 'launch-only');

  const packagedRuntimeRoot = join(root, 'packaged-runtime');
  const packagedBinary = join(packagedRuntimeRoot, 'bin', 'snapback');
  mkdirSync(join(packagedRuntimeRoot, 'bin'), { recursive: true });
  const packagedArtifact = process.platform === 'darwin'
    ? join(
      packagedRuntimeRoot,
      'Frameworks',
      'hermesvm.framework',
      'Versions',
      '1',
      'hermesvm',
    )
    : join(packagedRuntimeRoot, 'lib', 'libhermesvm.so');
  mkdirSync(join(packagedArtifact, '..'), { recursive: true });
  writeFileSync(packagedArtifact, 'packaged hermes fixture');
  writeFileSync(packagedBinary, `#!/usr/bin/env node
console.log(JSON.stringify({
  schemaVersion: 'snapback.runtime-qualify.v1',
  probe: 'restricted-no-eval-handler-vm',
  ok: true,
  binary: { gitCommit: 'packaged-ready', gitDirty: false, crateVersion: '1.2.3', buildProfile: 'release' },
}));
`);
  chmodSync(packagedBinary, 0o755);
  const packagedProject = join(root, 'packaged-consumer');
  const persistedReadiness = packagedRuntimeReadiness({
    runtimeBinary: packagedBinary,
    projectRoot: packagedProject,
  });
  assert.equal(persistedReadiness.ok, true);
  assert.equal(
    persistedReadiness.receiptPath,
    join(packagedProject, '.snapback', 'runtime-readiness.json'),
  );
  assert.equal(existsSync(persistedReadiness.receiptPath), true);
  const reverifiedReadiness = packagedRuntimeReadiness({
    runtimeBinary: packagedBinary,
    projectRoot: packagedProject,
    verify: true,
  });
  assert.equal(reverifiedReadiness.ok, true);
  writeFileSync(packagedArtifact, 'drifted packaged hermes fixture');
  assert.equal(packagedRuntimeReadiness({
    runtimeBinary: packagedBinary,
    projectRoot: packagedProject,
    verify: true,
  }).reason, 'framework-drift');

  const project = join(root, 'todo-contract');
  const scaffold = scaffoldApp(project);
  assert.equal(scaffold.ok, true);
  assertScaffoldedAuthoringSkill(project, scaffold);
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['@expo/snapback-cli'], SCAFFOLD_PIN);
  assert.equal(manifest.scripts.test, 'node acceptance.mjs');
  assert.equal(manifest.scripts['test:static'], 'node acceptance.static.mjs');
  assert.equal(manifest.scripts['test:live'], undefined);
  assert.match(manifest.scripts.prove, /^snapback verify snapback /u);
  assert.equal(manifest.scripts['carry:headless'], 'node carrier.mjs headless');
  assert.equal(manifest.scripts['carry:self-check'], 'node carrier.mjs --self-check --json');
  assert.equal(existsSync(join(project, 'snapback.verify.config.mjs')), true);
  assert.match(
    readFileSync(join(project, '.gitignore'), 'utf8'),
    /^node_modules\/$/mu,
    'the todo starter must keep installed package trees out of release source identity',
  );
  assert.equal(
    existsSync(join(project, 'gitignore.template')),
    false,
    'the packed template carrier must materialize only as .gitignore',
  );
  const todoAgentInstructions = readFileSync(join(project, 'AGENTS.md'), 'utf8');
  assertStartPacketTransclusion(todoAgentInstructions, 'todo-contract');
  const todoScriptSurface = assertScaffoldScriptSurface(project, 'todo-contract', manifest);
  assert.deepEqual(todoScriptSurface.commands, {
    ordinaryCompletion: 'bun run prove',
    staticChecking: 'bun run test:static',
    rawAcceptanceDebugging: 'npm test',
    browserObservation: null,
    simulatorObservation: null,
  });
  assert.match(todoAgentInstructions, /snapback guide <query>/u);
  assert.match(todoAgentInstructions, /snapback mcp/u);
  assert.match(todoAgentInstructions, /snapback-authoring/u);
  const generated = await generateApp(join(project, 'snapback'));
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const todoStatic = spawnSync(process.execPath, ['acceptance.static.mjs'], {
    cwd: project,
    encoding: 'utf8',
  });
  assert.equal(todoStatic.status, 0, todoStatic.stderr);
  assertCarrierSelfCheck(project, ['headless']);
  const todoAcceptanceSource = readFileSync(join(project, 'acceptance.mjs'), 'utf8');
  assert.match(todoAcceptanceSource, /snapback\.starter-acceptance\.v1/u);
  assert.match(todoAcceptanceSource, /client\.query\(api\.listTodos/u);
  assert.match(todoAcceptanceSource, /client\.mutate\(api\.createTodo/u);

  const reactProject = join(root, 'react-starter');
  const reactScaffold = scaffoldApp(reactProject, { template: 'react' });
  assert.equal(reactScaffold.ok, true);
  const reactManifest = JSON.parse(readFileSync(join(reactProject, 'package.json'), 'utf8'));
  assert.equal(reactManifest.dependencies['@expo/snapback-acceptance'], SCAFFOLD_PIN);
  assert.match(reactManifest.dependencies['@expo/snapback-react'], /^\^\d+\.\d+\.\d+/);
  assert.equal(reactManifest.scripts.test, 'node acceptance.mjs');
  assert.equal(reactManifest.scripts['test:static'], 'node acceptance.static.mjs');
  assert.equal(reactManifest.scripts['test:live'], undefined);
  assert.match(reactManifest.scripts.prove, /^snapback verify snapback /u);
  assert.equal(reactManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
  assert.equal(existsSync(join(reactProject, 'snapback.verify.config.mjs')), true);
  const reactAgentInstructions = readFileSync(join(reactProject, 'AGENTS.md'), 'utf8');
  assertStartPacketTransclusion(reactAgentInstructions, 'react');
  assertScaffoldScriptSurface(reactProject, 'react', reactManifest);
  assert.match(reactAgentInstructions, /snapback guide <query>/u);
  assert.match(reactAgentInstructions, /snapback mcp/u);
  assert.match(reactAgentInstructions, /snapback-authoring/u);
  const generatedReact = await generateApp(join(reactProject, 'snapback'));
  assert.equal(generatedReact.ok, true, JSON.stringify(generatedReact.diagnostics));
  assert.equal(
    generatedReact.summary.counts.degradedResults,
    0,
    `the untouched React starter must generate without degraded-result advisories: ${JSON.stringify(generatedReact.summary.degradedResults)}`,
  );
  assert.match(readFileSync(join(reactProject, 'src', 'App.tsx'), 'utf8'), /useSnapbackQueries/);
  assert.match(readFileSync(join(reactProject, 'src', 'App.tsx'), 'utf8'), /useSnapbackAuth/);
  assert.match(readFileSync(join(reactProject, 'src', 'App.tsx'), 'utf8'), /useSnapbackCurrentPrincipal/);
  assert.match(readFileSync(join(reactProject, 'src', 'main.tsx'), 'utf8'), /createSnapbackAppClient/);
  assert.doesNotMatch(
    readFileSync(join(reactProject, 'src', 'main.tsx'), 'utf8'),
    /new SnapbackClient|createSnapbackReactProvider|AuthCoordinator|bearer|adoptAuthority/u,
  );
  assert.equal(generatedReact.appDescriptor.authBootstrap.format, 'snapback.application-auth-bootstrap.v1');
  assert(generatedReact.appDescriptor.capabilities.required.includes('auth.application-bootstrap.v1'));
  const reactStatic = spawnSync(process.execPath, ['acceptance.static.mjs'], {
    cwd: reactProject,
    encoding: 'utf8',
  });
  assert.equal(reactStatic.status, 0, reactStatic.stderr);
  assertCarrierSelfCheck(reactProject, ['headless', 'web-browser']);
  const reactAcceptanceSource = readFileSync(join(reactProject, 'acceptance.mjs'), 'utf8');
  assert.match(reactAcceptanceSource, /from '@expo\/snapback-acceptance'/u);
  assert.doesNotMatch(reactAcceptanceSource, /snapback\.starter-acceptance\.v1|expectedCheckCount/u);
  assert.match(reactAcceptanceSource, /createSnapbackAppClient/u);
  assert.match(reactAcceptanceSource, /adminClient\.query\(api\.listTodos/u);
  assert.match(reactAcceptanceSource, /invokeSnapbackMutation/u);

  const crudProject = join(root, 'crud-dashboard');
  const crudScaffold = scaffoldApp(crudProject, { template: 'crud-dashboard' });
  assert.equal(crudScaffold.ok, true);
  assertScaffoldedAuthoringSkill(crudProject, crudScaffold);
  const crudManifest = JSON.parse(readFileSync(join(crudProject, 'package.json'), 'utf8'));
  assert.equal(crudManifest.dependencies['@expo/snapback-acceptance'], SCAFFOLD_PIN);
  assert.match(crudManifest.dependencies['@expo/snapback-react'], /^\^\d+\.\d+\.\d+/);
  assert.equal(crudManifest.scripts.test, 'node acceptance.mjs');
  assert.equal(crudManifest.scripts['test:static'], 'node acceptance.static.mjs');
  assert.equal(crudManifest.scripts['test:live'], undefined);
  assert.match(crudManifest.scripts.prove, /^snapback verify snapback /u);
  assert.equal(crudManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
  assert.equal(existsSync(join(crudProject, 'snapback.verify.config.mjs')), true);
  assertScaffoldScriptSurface(crudProject, 'crud-dashboard', crudManifest);
  const generatedCrud = await generateApp(join(crudProject, 'snapback'));
  assert.equal(generatedCrud.ok, true, JSON.stringify(generatedCrud.diagnostics));
  assert.equal(generatedCrud.summary.counts.degradedResults, 0);
  const crudFunctions = JSON.parse(readFileSync(join(crudProject, 'snapback', 'generated', 'functions.manifest.json'), 'utf8'));
  assert.ok(
    crudFunctions.functions.find(({ name }) => name === 'projectDirectory')?.runtime?.HostPlan?.RelationalQuery,
    'the CRUD template generates its project directory as a relational query',
  );
  assert.match(readFileSync(join(crudProject, 'src', 'App.tsx'), 'utf8'), /optimistic:\s*\{/u);
  const crudStatic = spawnSync(process.execPath, ['acceptance.static.mjs'], { cwd: crudProject, encoding: 'utf8' });
  assert.equal(crudStatic.status, 0, crudStatic.stderr);
  assertCarrierSelfCheck(crudProject, ['headless', 'web-browser']);
  assert.match(readFileSync(join(crudProject, 'acceptance.mjs'), 'utf8'), /client\.liveQuery\(api\.projectDetail/u);

  const mediaProject = join(root, 'media-feed');
  const mediaScaffold = scaffoldApp(mediaProject, { template: 'media-feed' });
  assert.equal(mediaScaffold.ok, true);
  assertScaffoldedAuthoringSkill(mediaProject, mediaScaffold);
  const mediaManifest = JSON.parse(readFileSync(join(mediaProject, 'package.json'), 'utf8'));
  assert.equal(mediaManifest.dependencies['@expo/snapback-acceptance'], SCAFFOLD_PIN);
  assert.match(mediaManifest.dependencies['@expo/snapback-expo'], /^\^\d+\.\d+\.\d+/);
  assert.equal(mediaManifest.dependencies['expo-image-picker'], '~57.0.7');
  assert.equal(mediaManifest.scripts.web, 'expo start --web');
  assert.equal(mediaManifest.scripts.test, 'node acceptance.mjs');
  assert.equal(mediaManifest.scripts['test:static'], 'node acceptance.static.mjs');
  assert.equal(mediaManifest.scripts['test:live'], undefined);
  assert.match(mediaManifest.scripts.prove, /^snapback verify snapback /u);
  assert.equal(mediaManifest.scripts['carry:native-simulator'], 'node carrier.mjs native-simulator');
  assert.equal(existsSync(join(mediaProject, 'snapback.verify.config.mjs')), true);
  assertScaffoldScriptSurface(mediaProject, 'media-feed', mediaManifest);
  const generatedMedia = await generateApp(join(mediaProject, 'snapback'));
  assert.equal(generatedMedia.ok, true, JSON.stringify(generatedMedia.diagnostics));
  assert.equal(generatedMedia.summary.counts.degradedResults, 0);
  const mediaFunctions = JSON.parse(readFileSync(join(mediaProject, 'snapback', 'generated', 'functions.manifest.json'), 'utf8'));
  assert.deepEqual(mediaFunctions.assetUploadIntents.map(({ exportedName }) => exportedName).sort(), ['feedPhotoUpload', 'privatePhotoUpload']);
  const mediaDescriptor = await import(join(mediaProject, 'snapback', 'generated', 'api.mjs'));
  assert.ok(mediaDescriptor.app.commands?.publishEntry, 'the media template generates its upload-and-attach command');
  assert.match(readFileSync(join(mediaProject, 'App.tsx'), 'utf8'), /onEndReached=\{loadOlder\}/u);
  const mediaStatic = spawnSync(process.execPath, ['acceptance.static.mjs'], { cwd: mediaProject, encoding: 'utf8' });
  assert.equal(mediaStatic.status, 0, mediaStatic.stderr);
  assertCarrierSelfCheck(mediaProject, ['headless', 'native-simulator', 'web-browser']);
  assert.match(readFileSync(join(mediaProject, 'acceptance.mjs'), 'utf8'), /createAssetClient\(client\)/u);

  // @ref LLP 0186#w2--context-injection-surface-owned-here — the golden-path scaffold
  // carries the LLP 0176 conversation surface (messages + image upload intent
  // + live queries + command + typing presence) as runnable template code.
  const chatProject = join(root, 'expo-chat');
  const chatScaffold = scaffoldApp(chatProject, { template: 'expo-chat' });
  assert.equal(chatScaffold.ok, true);
  assertScaffoldedAuthoringSkill(chatProject, chatScaffold);
  const chatManifest = JSON.parse(readFileSync(join(chatProject, 'package.json'), 'utf8'));
  assert.equal(chatManifest.dependencies['@expo/snapback-expo'], SCAFFOLD_PIN);
  assert.equal(chatManifest.dependencies['@expo/snapback-cli'], SCAFFOLD_PIN);
  assert.equal(chatManifest.dependencies['@expo/snapback-acceptance'], SCAFFOLD_PIN);
  assert.equal(chatManifest.dependencies['@expo/metro-runtime'], '~57.0.8');
  assert.equal(chatManifest.dependencies['react-dom'], '19.2.3');
  assert.equal(chatManifest.dependencies['react-native-web'], '^0.21.2');
  const chatAppConfig = JSON.parse(readFileSync(join(chatProject, 'app.json'), 'utf8'));
  assert.deepEqual(chatAppConfig.expo.platforms, ['ios', 'android', 'web']);
  assert.equal(chatManifest.scripts.test, 'node acceptance.mjs');
  assert.equal(chatManifest.scripts['test:static'], 'node acceptance.static.mjs');
  assert.equal(chatManifest.scripts['test:live'], undefined);
  assert.equal(chatManifest.scripts.web, 'expo start --web');
  assert.match(chatManifest.scripts.prove, /^snapback verify snapback /u);
  assert.equal(chatManifest.scripts['carry:native-simulator'], 'node carrier.mjs native-simulator');
  assert.equal(existsSync(join(chatProject, 'snapback.verify.config.mjs')), true);
  assertCarrierSelfCheck(chatProject, ['headless', 'native-simulator', 'web-browser']);
  assert.deepEqual(
    ['@expo/metro-runtime', 'react-dom', 'react-native-web'].filter(
      (name) => typeof chatManifest.dependencies[name] === 'string',
    ),
    ['@expo/metro-runtime', 'react-dom', 'react-native-web'],
  );
  const chatExpoManifest = JSON.parse(readFileSync(join(chatProject, 'app.json'), 'utf8'));
  assert.deepEqual(chatExpoManifest.expo.platforms, ['ios', 'android', 'web']);
  const chatAgentInstructions = readFileSync(join(chatProject, 'AGENTS.md'), 'utf8');
  assertStartPacketTransclusion(chatAgentInstructions, 'expo-chat');
  const chatScriptSurface = assertScaffoldScriptSurface(chatProject, 'expo-chat', chatManifest);
  assert.deepEqual(chatScriptSurface.commands, {
    ordinaryCompletion: 'bun run prove',
    staticChecking: 'bun run test:static',
    rawAcceptanceDebugging: 'npm test',
    browserObservation: 'bun run carry:web-browser',
    simulatorObservation: 'bun run carry:native-simulator',
  });
  assert.match(chatAgentInstructions, /snapback guide <query>/u);
  assert.match(chatAgentInstructions, /snapback mcp/u);
  assert.match(chatAgentInstructions, /snapback-authoring/u);
  const generatedChat = await generateApp(join(chatProject, 'snapback'));
  assert.equal(generatedChat.ok, true, JSON.stringify(generatedChat.diagnostics));
  assert.equal(
    generatedChat.summary.counts.degradedResults,
    0,
    `the untouched expo-chat starter must generate without degraded-result advisories: ${JSON.stringify(generatedChat.summary.degradedResults)}`,
  );
  const chatDescriptor = await import(join(chatProject, 'snapback', 'generated', 'api.mjs'));
  assert.ok(
    chatDescriptor.app.surfaces?.conversation,
    'the expo-chat starter must generate the LLP 0179 conversation surface',
  );
  assert.match(readFileSync(join(chatProject, 'App.tsx'), 'utf8'), /SnapbackExpoProvider/);
  assert.match(readFileSync(join(chatProject, 'App.tsx'), 'utf8'), /useSnapbackAuth/);
  assert.match(readFileSync(join(chatProject, 'App.tsx'), 'utf8'), /useSnapbackCurrentPrincipal/);
  assert.equal(generatedChat.appDescriptor.authBootstrap.custody, 'volatile-explicit');
  assert(generatedChat.appDescriptor.capabilities.required.includes('auth.application-bootstrap.v1'));
  assert.match(
    readFileSync(join(chatProject, 'src', 'screens', 'chat-screen.tsx'), 'utf8'),
    /useSurface\(/,
  );
  assert.match(
    readFileSync(join(chatProject, 'src', 'screens', 'inbox-screen.tsx'), 'utf8'),
    /TEST PERSONA/u,
  );
  const chatStatic = spawnSync(process.execPath, ['acceptance.static.mjs'], {
    cwd: chatProject,
    encoding: 'utf8',
  });
  assert.equal(chatStatic.status, 0, chatStatic.stderr);
  const chatAcceptanceSource = readFileSync(join(chatProject, 'acceptance.mjs'), 'utf8');
  assert.match(chatAcceptanceSource, /from '@expo\/snapback-acceptance'/u);
  assert.doesNotMatch(chatAcceptanceSource, /snapback\.starter-acceptance\.v1|expectedCheckCount/u);
  assert.match(chatAcceptanceSource, /zero-config-supervised-connect/u);
  assert.match(chatAcceptanceSource, /runExpoDev/u);
  assert.match(chatAcceptanceSource, /createSnapbackExpoBoot/u);
  assert.doesNotMatch(
    chatAcceptanceSource,
    /new SnapbackClient|AuthCoordinator|adoptAuthority/u,
    'the generated acceptance may use the public external-session wrapper but must not assemble its authority internals',
  );
  assert.match(chatAcceptanceSource, /observeSnapbackSurface/u);
  assert.match(chatAcceptanceSource, /client\.mutate\(api\.sendMessage/u);
  assert.doesNotMatch(
    chatAcceptanceSource,
    /let stdoutRemainder|child\.stdout\.on\('data'/u,
    'platform lifecycle parsing belongs to the shared runner, not the app journey',
  );

  const git = (...args) => {
    const result = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init');
  git('add', '.');
  git('-c', 'user.name=Snapback Test', '-c', 'user.email=snapback-test@example.invalid', 'commit', '-m', 'fixture');
  assert.deepEqual(
    git('ls-files', 'snapback/generated').split('\n').filter(Boolean),
    ['snapback/generated/artifacts.json'],
    'ordinary scaffolds commit only the codegen review manifest',
  );
  const releaseOutput = join(root, 'releases');
  const release = await buildRelease({
    backendDirectory: join(project, 'snapback'),
    outputDirectory: releaseOutput,
  });
  assert.equal(release.ok, true);
  assert.equal(release.schemaVersion, 'snapback.deploy-build.v1');
  assert.equal(release.state, 'built');
  assert.equal(release.sourceDirty, false);
  assert.equal(release.activationEligible, false);
  assert.ok(release.gaps.some((gap) => gap.id === 'control-plane.backup-restore' && gap.blocking));
  assert.equal(verifyRelease(release.releaseDirectory).releaseId, release.releaseId);
  const releaseManifest = JSON.parse(readFileSync(join(release.releaseDirectory, 'release.manifest.json'), 'utf8'));
  const releasedReviewManifest = JSON.parse(readFileSync(join(release.releaseDirectory, 'components', 'app', 'artifacts.json'), 'utf8'));
  assert.equal(releasedReviewManifest.manifestVersion, 2);
  const releasedPaths = new Set(releaseManifest.components.map(({ path }) => path));
  assert(releasedPaths.has('components/app/artifacts.json'));
  for (const file of releasedReviewManifest.files) {
    assert(releasedPaths.has(`components/app/${file.path}`), `release closure omitted reviewed artifact ${file.path}`);
  }
  const reused = await buildRelease({
    backendDirectory: join(project, 'snapback'),
    outputDirectory: releaseOutput,
  });
  assert.equal(reused.state, 'reused');
  assert.equal(reused.releaseId, release.releaseId);
  const defaultRelease = await buildRelease({ backendDirectory: join(project, 'snapback') });
  assert.equal(defaultRelease.state, 'built');
  assert.equal(defaultRelease.releaseId, release.releaseId);
  const defaultReused = await buildRelease({ backendDirectory: join(project, 'snapback') });
  assert.equal(defaultReused.state, 'reused');
  assert.equal(defaultReused.sourceDirty, false);

  // Hosted runtime staging: a fabricated x86-64 ELF pair proves the plumbing
  // (manifest fact, GAP narrowing, verify-time ELF re-check). The real
  // artifacts arrive from the Linux build and are pinned by drill receipts,
  // never by this fixture.
  const runtimeDir = join(root, 'runtime-linux-x64');
  mkdirSync(join(runtimeDir, 'bin'), { recursive: true });
  mkdirSync(join(runtimeDir, 'lib'), { recursive: true });
  const elfBytes = (machine) => {
    const bytes = Buffer.alloc(24);
    bytes[0] = 0x7f;
    bytes.write('ELF', 1, 'ascii');
    bytes[5] = 1;
    bytes.writeUInt16LE(machine, 18);
    return bytes;
  };
  writeFileSync(join(runtimeDir, 'bin', 'snapback'), elfBytes(62));
  writeFileSync(join(runtimeDir, 'lib', 'libhermesvm.so'), elfBytes(62));
  const runtimeRelease = await buildRelease({
    backendDirectory: join(project, 'snapback'),
    outputDirectory: releaseOutput,
    runtimeArtifactDirectory: runtimeDir,
    runtimePlatform: 'linux-x64',
    hermesBundleIdentity: 'hermes-linux-x64-test-bundle-v1',
  });
  assert.notEqual(runtimeRelease.releaseId, release.releaseId);
  const runtimeManifest = JSON.parse(readFileSync(join(runtimeRelease.releaseDirectory, 'release.manifest.json'), 'utf8'));
  assert.equal(runtimeManifest.runtimeArtifact.platform, 'linux-x64');
  assert.equal(runtimeManifest.runtimeArtifact.hermesBundleIdentity, 'hermes-linux-x64-test-bundle-v1');
  assert.ok(runtimeManifest.components.some((component) => component.path === 'components/runtime/linux-x64/bin/snapback'));
  assert.ok(runtimeManifest.components.some((component) => component.path === 'components/runtime/linux-x64/lib/libhermesvm.so'));
  assert.ok(!runtimeManifest.gaps.some((gap) => gap.id === 'control-plane.runtime-artifact'));
  assert.ok(runtimeManifest.gaps.some((gap) => gap.id === 'control-plane.runtime-artifact-adapter-verification' && gap.blocking));
  assert.equal(verifyRelease(runtimeRelease.releaseDirectory).releaseId, runtimeRelease.releaseId);
  writeFileSync(join(runtimeDir, 'bin', 'snapback'), elfBytes(183));
  await assert.rejects(
    buildRelease({
      backendDirectory: join(project, 'snapback'),
      outputDirectory: releaseOutput,
      runtimeArtifactDirectory: runtimeDir,
      runtimePlatform: 'linux-x64',
      hermesBundleIdentity: 'hermes-linux-x64-test-bundle-v1',
    }),
    (error) => error.code === 'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID',
  );
  await assert.rejects(
    buildRelease({
      backendDirectory: join(project, 'snapback'),
      outputDirectory: releaseOutput,
      runtimePlatform: 'linux-x64',
    }),
    (error) => error.code === 'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID',
  );
  writeFileSync(join(runtimeDir, 'bin', 'snapback'), elfBytes(62));

  // Secret scan: a token-shaped credential refuses; the vocabulary around
  // credentials (a PEM header constant, a documentation placeholder) does
  // not. The runtime binary embeds both benign forms via its crypto shim
  // and guide text, so this boundary is what lets real artifacts stage.
  const scanWeb = join(project, 'scan-web');
  mkdirSync(scanWeb, { recursive: true });
  writeFileSync(join(scanWeb, 'app.js'), 'export CLOUDFLARE_API_TOKEN=f00dfeedbeef1234deadbeefcafe5678\n');
  await assert.rejects(
    buildRelease({
      backendDirectory: join(project, 'snapback'),
      outputDirectory: releaseOutput,
      webDirectory: scanWeb,
      allowDirty: true,
    }),
    (error) => error.code === 'SNAPBACK_RELEASE_SECRET_SCAN_FAILED',
  );
  writeFileSync(
    join(scanWeb, 'app.js'),
    'export CLOUDFLARE_API_TOKEN=...\nconst pemHeader = "-----BEGIN PRIVATE KEY-----\\n" + encode(body);\n',
  );
  const benignRelease = await buildRelease({
    backendDirectory: join(project, 'snapback'),
    outputDirectory: releaseOutput,
    webDirectory: scanWeb,
    allowDirty: true,
  });
  assert.equal(benignRelease.ok, true);
  rmSync(scanWeb, { recursive: true, force: true });

  const controlRoot = join(root, 'control');
  const adapterDriver = join(root, 'fixture-vm-adapter.mjs');
  writeFileSync(adapterDriver, `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
if (process.argv.length !== 2 || process.env.NPM_TOKEN) process.exit(13);
const request = JSON.parse(input);
const target = request.target;
const canonicalValue = (value) => Array.isArray(value)
  ? value.map(canonicalValue)
  : (!value || typeof value !== 'object')
    ? value
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const sha256 = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const statePath = new URL('./fixture-vm-adapter.state.json', import.meta.url);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { targets: {}, responses: {} };
const targetState = state.targets[target.targetId] ??= {
  descriptor: target,
  state: 'registered',
  activationGeneration: 0,
  activeReleaseId: null,
  applicationSentinelSha256: null,
  lease: null,
};
targetState.descriptor ??= target;
const observation = () => ({
    targetId: target.targetId,
    environmentId: target.environmentId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    targetProfileId: target.targetProfileId,
    provider: target.adapter.provider,
    accountFingerprint: target.targetId === 'target-mismatch' ? 'wrong-account' : target.adapter.accountFingerprint,
    region: target.adapter.region,
    publicOrigin: target.adapter.publicOrigin,
    resourceId: 'vm-fixture-1',
    state: targetState.state,
    activationGeneration: targetState.activationGeneration,
    activeReleaseId: targetState.activeReleaseId,
    applicationSentinelSha256: targetState.applicationSentinelSha256,
    credentialStatus: 'ready',
    providerFactsSha256: 'sha256:${'3'.repeat(64)}',
    observedAtMs: 2,
    capabilityGaps: target.targetId.startsWith('target-preview') || target.targetId === 'target-mismatch' ? ['hosted-auth'] : [],
});
if (request.schemaVersion === 'snapback.vm-adapter-request.v1') {
  process.stdout.write(JSON.stringify({
    schemaVersion: 'snapback.vm-adapter-response.v1',
    operation: request.operation,
    operationId: request.operationId,
    ok: true,
    observation: observation(),
    diagnostics: [{ code: 'SNAPBACK_FIXTURE_OK', severity: 'info', message: 'fixture read-back completed' }],
  }));
  process.exit(0);
}
if (request.schemaVersion === 'snapback.vm-adapter-query-request.v1') {
  const logs = request.operation === 'logs' ? {
    entries: [{
      timestampMs: request.query.sinceMs,
      severity: 'info',
      deploymentId: target.deploymentId,
      releaseId: targetState.activeReleaseId,
      activationGeneration: targetState.activationGeneration,
      streamIncarnation: target.streamIncarnation,
      correlationId: request.operationId,
      eventCode: 'SNAPBACK_FIXTURE_EVENT',
      eventVersion: 1,
      payload: [{ name: 'status', value: 'verified' }],
    }],
    nextCursor: null,
    retentionClass: 'fixture-seven-days',
    indexingClass: 'deployment-and-operation',
    deliveryLatencyMs: 1,
    droppedEvents: 0,
    backpressure: false,
  } : null;
  const fact = (name, status) => ({ name, status, valueSha256: 'sha256:${'7'.repeat(64)}' });
  const inspection = request.operation === 'inspectAdmin' ? {
    targetId: target.targetId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    activeReleaseId: targetState.activeReleaseId,
    inactiveReleaseIds: [],
    activationGeneration: targetState.activationGeneration,
    schemaGeneration: 0,
    configGeneration: 1,
    authGeneration: 1,
    workerGeneration: 1,
    capabilityManifestSha256: 'sha256:${'8'.repeat(64)}',
    capabilityGaps: observation().capabilityGaps,
    health: [fact('publicHealth', 'ready'), fact('logSink', 'ready')],
    dependencies: [],
    migration: [],
    backups: [],
    queues: [],
    connections: [],
    resources: [],
    operations: [],
    diagnostics: [],
  } : null;
  const inputSha256 = sha256('snapback-vm-adapter-query-input-v1\\0' + canonicalJson(request));
  const outputContent = {
    schemaVersion: 'snapback.vm-adapter-query-response.v1',
    operation: request.operation,
    operationId: request.operationId,
    ok: true,
    remoteEvidence: false,
    inputSha256,
    observation: observation(),
    logs,
    inspection,
    evidence: [{ kind: 'fixtureEvidence', uri: 'fixture://provider/' + request.operation, sha256: 'sha256:${'6'.repeat(64)}', bytes: 0, verified: true }],
    diagnostics: [{ code: 'SNAPBACK_FIXTURE_OK', severity: 'info', message: 'fixture query completed' }],
  };
  process.stdout.write(JSON.stringify({
    ...outputContent,
    outputSha256: sha256('snapback-vm-adapter-query-output-v1\\0' + canonicalJson(outputContent)),
  }));
  process.exit(0);
}
if (request.schemaVersion !== 'snapback.vm-adapter-lifecycle-request.v1') process.exit(14);
const responseKey = target.targetId + ':' + request.operationId + ':' + request.operation;
if (state.responses[responseKey]) {
  const replay = {
    ...state.responses[responseKey],
    idempotentReplay: true,
    inputSha256: sha256('snapback-vm-adapter-lifecycle-input-v1\\0' + canonicalJson(request)),
  };
  const { outputSha256: ignored, ...outputContent } = replay;
  replay.outputSha256 = sha256('snapback-vm-adapter-lifecycle-output-v1\\0' + canonicalJson(outputContent));
  process.stdout.write(JSON.stringify(replay));
  process.exit(0);
}
let backup = null;
let restore = null;
if (request.operation === 'acquireLease') {
  targetState.lease = {
    leaseId: 'lease-' + target.targetId,
    targetId: target.targetId,
    operationId: request.operationId,
    expectedActivationGeneration: request.plan.observedActivationGeneration,
    acquiredAtMs: 20,
    expiresAtMs: 120020,
  };
} else if (request.lease?.leaseId !== targetState.lease?.leaseId) {
  process.exit(15);
} else if (request.operation === 'provisionInactive') {
  targetState.state = 'inactive';
} else if (request.operation === 'createVerifiedBackup') {
  const backupContent = {
    schemaVersion: 'snapback.backup-manifest.v1',
    operationId: request.operationId,
    targetId: target.targetId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    releaseId: request.plan.observedActiveReleaseId,
    schemaIdentitySha256: 'sha256:${'4'.repeat(64)}',
    encryptionClass: 'fixture-external-key',
    storageClass: 'fixture-object-store',
    retentionPolicy: request.plan.retentionPolicy ?? 'fixture-seven-days',
    components: [{ kind: 'sqliteSnapshot', sha256: 'sha256:${'5'.repeat(64)}', bytes: 64, objects: 1, verified: true }],
    excludedSecretClasses: ['application-secrets', 'control-plane-credentials'],
    createdAtMs: 30,
    verifiedAtMs: 31,
  };
  backup = { ...backupContent, backupId: sha256('snapback-backup-manifest-v1\\0' + canonicalJson(backupContent)) };
} else if (request.operation === 'stageRelease') {
  targetState.state = 'ready';
} else if (request.operation === 'activateGeneration') {
  targetState.state = 'active';
  targetState.activationGeneration += 1;
  targetState.activeReleaseId = request.plan.releaseId;
  targetState.applicationSentinelSha256 = 'sha256:${'d'.repeat(64)}';
} else if (request.operation === 'rollback') {
  const destinationReleaseId = request.plan.destinationReleaseId ?? request.plan.observedActiveReleaseId;
  if (targetState.activeReleaseId !== destinationReleaseId) targetState.activationGeneration += 1;
  targetState.activeReleaseId = destinationReleaseId;
  targetState.state = targetState.activeReleaseId === null ? 'registered' : 'active';
} else if (request.operation === 'fenceExternalEffects') {
  targetState.state = 'restoring';
} else if (request.operation === 'restoreBackupInactive') {
  const source = state.targets[request.plan.sourceTargetId]?.descriptor;
  if (!source) process.exit(16);
  targetState.activationGeneration += 1;
  targetState.activeReleaseId = null;
  targetState.applicationSentinelSha256 = 'sha256:${'9'.repeat(64)}';
  targetState.state = 'inactive';
  targetState.restore = {
    backupId: request.plan.backupId,
    sourceTargetId: source.targetId,
    sourceDeploymentId: source.deploymentId,
    sourceDatabaseId: source.databaseId,
    sourceStreamIncarnation: source.streamIncarnation,
    destinationTargetId: target.targetId,
    destinationDeploymentId: target.deploymentId,
    destinationDatabaseId: target.databaseId,
    destinationStreamIncarnation: target.streamIncarnation,
    restoreEpoch: 1,
    effectsFenced: true,
    componentsVerified: true,
    applicationSentinelSha256: targetState.applicationSentinelSha256,
    acceptanceSha256: 'sha256:${'a'.repeat(64)}',
    externalEffectsDisabled: true,
    activated: false,
  };
  restore = targetState.restore;
} else if (request.operation === 'verifyRestoredComponents' || request.operation === 'verifyRestoredApplication') {
  restore = targetState.restore;
} else if (request.operation === 'activateRestoredGeneration') {
  targetState.activationGeneration += 1;
  targetState.activeReleaseId = request.plan.restoredReleaseId;
  targetState.state = 'active';
  targetState.restore = {
    ...targetState.restore,
    effectsFenced: false,
    externalEffectsDisabled: false,
    activated: true,
  };
  restore = targetState.restore;
} else if (request.operation === 'releaseLease') {
  targetState.lease = null;
  if (request.plan.schemaVersion === 'snapback.restore-plan.v1'
      || request.plan.schemaVersion === 'snapback.restore-activation-plan.v1') {
    restore = targetState.restore;
  }
}
const inputSha256 = sha256('snapback-vm-adapter-lifecycle-input-v1\\0' + canonicalJson(request));
const outputContent = {
  schemaVersion: 'snapback.vm-adapter-lifecycle-response.v1',
  operation: request.operation,
  operationId: request.operationId,
  ok: !(target.targetId === 'target-failure' && request.operation === 'verifyServedPath'),
  idempotentReplay: false,
  remoteEvidence: false,
  inputSha256,
  lease: request.operation === 'releaseLease' ? null : targetState.lease,
  observation: observation(),
  evidence: [{ kind: 'fixtureEvidence', uri: 'fixture://provider/' + request.operation, sha256: 'sha256:${'6'.repeat(64)}', bytes: 0, verified: true }],
  backup,
  restore,
  diagnostics: [{ code: 'SNAPBACK_FIXTURE_OK', severity: 'info', message: 'fixture lifecycle step completed' }],
};
const response = {
  ...outputContent,
  outputSha256: sha256('snapback-vm-adapter-lifecycle-output-v1\\0' + canonicalJson(outputContent)),
};
state.responses[responseKey] = response;
writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(JSON.stringify(response));
`);
  chmodSync(adapterDriver, 0o700);
  const driverSha256 = `sha256:${createHash('sha256').update(readFileSync(adapterDriver)).digest('hex')}`;
  const targetDescriptor = {
    schemaVersion: 'snapback.target-descriptor.v1',
    targetId: 'target-preview-1',
    projectId: JSON.parse(readFileSync(join(release.releaseDirectory, 'release.manifest.json'), 'utf8')).projectId,
    environmentId: 'preview-1',
    deploymentId: 'deployment-1',
    databaseId: 'database-1',
    streamIncarnation: 'stream-1',
    targetProfileId: 'local-dev-sqlite-ibex',
    productionClass: 'preview',
    adapter: {
      kind: 'singleInstanceContainerVm',
      version: '1.0.0',
      driverPath: adapterDriver,
      driverSha256,
      provider: 'fixture-provider',
      accountFingerprint: 'account-1',
      region: 'test-1',
      publicOrigin: 'https://preview.example.invalid',
      credentialRef: 'secret-store://snapback/preview-1',
      stateStoreRef: 'object://snapback-control/preview-1',
    },
    createdAtMs: 1,
  };
  assert.equal(validateTargetDescriptor(targetDescriptor), targetDescriptor);
  assert.throws(
    () => validateTargetDescriptor({
      ...targetDescriptor,
      adapter: {
        ...targetDescriptor.adapter,
        credentialRef: 'secret-store://operator:credential@example.invalid/control',
      },
    }),
    (error) => error.code === 'SNAPBACK_TARGET_DESCRIPTOR_INVALID',
  );
  assert.throws(
    () => validateTargetDescriptor({
      ...targetDescriptor,
      adapter: {
        ...targetDescriptor.adapter,
        stateStoreRef: 'object://snapback-control/preview-1?token=forbidden',
      },
    }),
    (error) => error.code === 'SNAPBACK_TARGET_DESCRIPTOR_INVALID',
  );
  const registration = addTarget(targetDescriptor, { controlRoot });
  assert.equal(registration.state, 'registered');
  assert.equal(addTarget(targetDescriptor, { controlRoot }).state, 'reused');
  assert.equal(statSync(join(controlRoot, 'targets', 'target-preview-1.json')).mode & 0o777, 0o600);
  assert.equal(showTarget('target-preview-1', { controlRoot }).deploymentId, 'deployment-1');
  const targetHardlink = join(root, 'target-preview-1.hardlink.json');
  linkSync(join(controlRoot, 'targets', 'target-preview-1.json'), targetHardlink);
  assert.throws(
    () => showTarget('target-preview-1', { controlRoot }),
    (error) => error.code === 'SNAPBACK_TARGET_DESCRIPTOR_INVALID',
  );
  rmSync(targetHardlink);
  assert.equal(doctorTarget('target-preview-1', {
    controlRoot,
    operationId: 'doctor-op',
    env: { ...process.env, NPM_TOKEN: 'super-secret-must-be-scrubbed' },
  }).ok, true);
  assert.equal(inspectTarget('target-preview-1', { controlRoot, operationId: 'inspect-op' }).observation.resourceId, 'vm-fixture-1');
  assert.throws(
    () => queryControlLogs('target-preview-1', {
      controlRoot,
      operationId: 'logs-remote-required',
      sinceMs: 0,
      untilMs: 10,
    }),
    (error) => error.code === 'SNAPBACK_ADAPTER_REMOTE_EVIDENCE_REQUIRED',
  );
  assert.throws(
    () => inspectTargetAdmin('target-preview-1', {
      controlRoot,
      operationId: 'inspect-admin-remote-required',
      sinceMs: 0,
      untilMs: 10,
    }),
    (error) => error.code === 'SNAPBACK_ADAPTER_REMOTE_EVIDENCE_REQUIRED',
  );
  const fixtureLogs = __deploymentTest.logsHarness('target-preview-1', {
    controlRoot,
    operationId: 'logs-op',
    sinceMs: 0,
    untilMs: 10,
    limit: 10,
  });
  assert.equal(fixtureLogs.logs.entries[0].payload[0].value, 'verified');
  const fixtureInspection = __deploymentTest.inspectAdminHarness('target-preview-1', {
    controlRoot,
    operationId: 'inspect-admin-op',
    sinceMs: 0,
    untilMs: 10,
  });
  assert.equal(fixtureInspection.inspection.health.find((fact) => fact.name === 'logSink').status, 'ready');
  const planOptions = {
    releaseDirectory: release.releaseDirectory,
    targetId: 'target-preview-1',
    reason: 'fixture preview planning proof',
    operationId: 'plan-op',
    nowMs: 10_000,
    controlRoot,
    verifyRelease,
  };
  const plan = createDeployPlan(planOptions);
  assert.equal(plan.applyEligible, false);
  assert.equal(plan.observedActivationGeneration, 0);
  assert.equal(plan.releaseId, release.releaseId);
  assert.ok(plan.blockers.some((blocker) => blocker.id === 'adapter.hosted-auth'));
  assert.deepEqual(createDeployPlan(planOptions), plan);
  const planPath = join(controlRoot, 'plans', `${plan.planId.slice('sha256:'.length)}.json`);
  assert.equal(statSync(planPath).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(join(controlRoot, 'targets', 'target-preview-1.json'), 'utf8'), /super-secret/);
  assert.throws(
    () => applyDeployPlan(plan.planId, {
      targetId: 'target-preview-1',
      confirmation: 'wrong-confirmation',
      nowMs: 10_001,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_DEPLOY_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => applyDeployPlan(plan.planId, {
      targetId: 'target-preview-1',
      confirmation: plan.confirmation,
      nowMs: 10_001,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_DEPLOY_PLAN_BLOCKED',
  );
  const eligibleVerifier = (directory) => ({ ...verifyRelease(directory), activationEligible: true });
  const retainHarnessPlan = (descriptor, operationId, verifier = eligibleVerifier) => {
    addTarget(descriptor, { controlRoot });
    const observation = inspectTarget(descriptor.targetId, { controlRoot, operationId: `${operationId}-inspect` }).observation;
    const verification = verifier(release.releaseDirectory);
    const content = {
      artifactKind: 'deployPlan',
      schemaVersion: 'snapback.deploy-plan.v1',
      operationId,
      reason: 'deterministic lifecycle protocol proof',
      targetId: descriptor.targetId,
      projectId: descriptor.projectId,
      environmentId: descriptor.environmentId,
      deploymentId: descriptor.deploymentId,
      databaseId: descriptor.databaseId,
      streamIncarnation: descriptor.streamIncarnation,
      targetProfileId: descriptor.targetProfileId,
      productionClass: descriptor.productionClass,
      targetDescriptorSha256: __deploymentTest.sha256(Buffer.from(__deploymentTest.canonicalJson(descriptor))),
      targetObservationSha256: __deploymentTest.sha256(Buffer.from(__deploymentTest.canonicalJson(observation))),
      observedActivationGeneration: observation.activationGeneration,
      observedActiveReleaseId: observation.activeReleaseId,
      releaseId: verification.releaseId,
      releaseManifestSha256: verification.manifestSha256,
      preparedReleaseId: null,
      preparedReleaseManifestSha256: null,
      steps: [
        'verifyIdentity', 'acquireLease', 'uploadImmutableRelease',
        'provisionInactive', 'compatibilityPreflight', 'createVerifiedBackup',
        'stageRelease', 'activateGeneration', 'verifyServedPath', 'releaseLease',
        'rollbackOnFailure',
      ],
      blockers: [],
      applyEligible: true,
      createdAtMs: 10_000,
      expiresAtMs: 910_000,
    };
    const planId = __deploymentTest.sha256(Buffer.from(`snapback-deploy-plan-v1\0${__deploymentTest.canonicalJson(content)}`));
    const retained = { ...content, planId, confirmation: `confirm:${planId}` };
    writeFileSync(
      join(controlRoot, 'plans', `${planId.slice('sha256:'.length)}.json`),
      `${__deploymentTest.canonicalJson(retained)}\n`,
      { mode: 0o600 },
    );
    return retained;
  };
  const lifecycleTarget = {
    ...targetDescriptor,
    targetId: 'target-lifecycle',
    environmentId: 'lifecycle-preview',
    deploymentId: 'lifecycle-deployment',
    databaseId: 'lifecycle-database',
    streamIncarnation: 'lifecycle-stream',
    targetProfileId: 'trusted-single-tenant-app-complete.v1',
    adapter: { ...targetDescriptor.adapter, publicOrigin: 'https://lifecycle.example.invalid' },
  };
  const lifecyclePlan = retainHarnessPlan(lifecycleTarget, 'lifecycle-op');
  let lifecycleClock = 40;
  const lifecycleReceipt = __deploymentTest.applyHarness(lifecyclePlan.planId, {
    targetId: lifecycleTarget.targetId,
    confirmation: lifecyclePlan.confirmation,
    nowMs: 10_001,
    releaseDirectory: release.releaseDirectory,
    verifyRelease: eligibleVerifier,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(lifecycleReceipt.outcome, 'activated');
  assert.equal(lifecycleReceipt.remoteEvidence, false);
  assert.equal(lifecycleReceipt.activationGenerationAfter, 1);
  assert.equal(lifecycleReceipt.backup.releaseId, null);
  assert.ok(lifecycleReceipt.gaps.some((gap) => gap.id === 'control-plane.remote-evidence'));
  assert.deepEqual(
    lifecycleReceipt.steps.map((step) => step.operation),
    ['acquireLease', 'uploadImmutableRelease', 'provisionInactive', 'compatibilityPreflight', 'createVerifiedBackup', 'stageRelease', 'activateGeneration', 'verifyServedPath', 'releaseLease'],
  );
  for (let index = 1; index < lifecycleReceipt.steps.length; index += 1) {
    assert.equal(lifecycleReceipt.steps[index].previousFactSha256, lifecycleReceipt.steps[index - 1].factSha256);
  }
  assert.equal(
    statSync(join(controlRoot, 'receipts', `${lifecycleReceipt.receiptId.slice('sha256:'.length)}.json`)).mode & 0o777,
    0o600,
  );
  const backupList = listBackups(lifecycleTarget.targetId, { controlRoot });
  assert.equal(backupList.backups.length, 1);
  assert.equal(backupList.backups[0].backupId, lifecycleReceipt.backup.backupId);
  const backupVerification = verifyBackupManifest(lifecycleReceipt.backup.backupId, lifecycleTarget.targetId, { controlRoot });
  assert.equal(backupVerification.ok, true);
  assert.equal(backupVerification.adapterReadBackAttested, true);
  assert.deepEqual(backupVerification.excludedSecretClasses, ['application-secrets', 'control-plane-credentials']);
  assert.equal(
    statSync(join(controlRoot, 'backups', `${lifecycleReceipt.backup.backupId.slice('sha256:'.length)}.json`)).mode & 0o777,
    0o600,
  );
  assert.equal(inspectTarget(lifecycleTarget.targetId, { controlRoot, operationId: 'lifecycle-after' }).observation.activeReleaseId, release.releaseId);
  assert.throws(
    () => __deploymentTest.applyHarness(lifecyclePlan.planId, {
      targetId: lifecycleTarget.targetId,
      confirmation: lifecyclePlan.confirmation,
      nowMs: 10_002,
      releaseDirectory: release.releaseDirectory,
      verifyRelease: eligibleVerifier,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_DEPLOY_PLAN_STALE',
  );
  const secondReleaseId = `sha256:${'c'.repeat(64)}`;
  const secondVerifier = (directory) => ({
    ...eligibleVerifier(directory),
    releaseId: secondReleaseId,
  });
  const secondLifecyclePlan = retainHarnessPlan(lifecycleTarget, 'lifecycle-second-op', secondVerifier);
  const secondLifecycleReceipt = __deploymentTest.applyHarness(secondLifecyclePlan.planId, {
    targetId: lifecycleTarget.targetId,
    confirmation: secondLifecyclePlan.confirmation,
    nowMs: 10_003,
    releaseDirectory: release.releaseDirectory,
    verifyRelease: secondVerifier,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(secondLifecycleReceipt.previousReleaseId, release.releaseId);
  assert.equal(secondLifecycleReceipt.backup.releaseId, release.releaseId);
  assert.equal(secondLifecycleReceipt.releaseId, secondReleaseId);
  const auditEventsBeforeStandaloneBackup = verifyControlAuditLedger({ controlRoot }).events;
  const standaloneBackupPlan = __deploymentTest.createBackupPlanHarness({
    targetId: lifecycleTarget.targetId,
    reason: 'standalone verified backup drill',
    retentionPolicy: 'fixture-thirty-days',
    operationId: 'standalone-backup-op',
    nowMs: 10_004,
    controlRoot,
  });
  assert.equal(standaloneBackupPlan.applyEligible, true);
  assert.equal(standaloneBackupPlan.observedActiveReleaseId, secondReleaseId);
  assert.equal(standaloneBackupPlan.retentionPolicy, 'fixture-thirty-days');
  assert.throws(
    () => __deploymentTest.applyBackupPlanHarness(standaloneBackupPlan.planId, {
      targetId: lifecycleTarget.targetId,
      confirmation: 'wrong',
      nowMs: 10_005,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_MAINTENANCE_CONFIRMATION_REQUIRED',
  );
  const standaloneBackupReceipt = __deploymentTest.applyBackupPlanHarness(standaloneBackupPlan.planId, {
    targetId: lifecycleTarget.targetId,
    confirmation: standaloneBackupPlan.confirmation,
    nowMs: 10_005,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(standaloneBackupReceipt.outcome, 'backedUp');
  assert.equal(standaloneBackupReceipt.releaseIdBefore, secondReleaseId);
  assert.equal(standaloneBackupReceipt.releaseIdAfter, secondReleaseId);
  assert.equal(standaloneBackupReceipt.activationGenerationBefore, standaloneBackupReceipt.activationGenerationAfter);
  assert.equal(
    verifyBackupManifest(standaloneBackupReceipt.backupId, lifecycleTarget.targetId, { controlRoot }).ok,
    true,
  );
  assert.equal(verifyControlAuditLedger({ controlRoot }).events, auditEventsBeforeStandaloneBackup + 5);
  const auditFiles = readdirSync(join(controlRoot, 'audit-events')).filter((name) => name.endsWith('.json'));
  assert.equal(auditFiles.length, auditEventsBeforeStandaloneBackup + 5);
  assert.equal(statSync(join(controlRoot, 'audit-events', auditFiles[0])).mode & 0o777, 0o600);
  const auditLock = join(controlRoot, 'audit-events', '.append.lock');
  writeFileSync(auditLock, 'occupied\n', { mode: 0o600 });
  assert.throws(
    () => __deploymentTest.logsHarness(lifecycleTarget.targetId, {
      controlRoot,
      operationId: 'audit-unavailable-read',
    }),
    (error) => error.code === 'SNAPBACK_CONTROL_AUDIT_UNAVAILABLE',
  );
  rmSync(auditLock);
  const interruptionTarget = {
    ...targetDescriptor,
    targetId: 'target-interruption',
    environmentId: 'interruption-preview',
    deploymentId: 'interruption-deployment',
    databaseId: 'interruption-database',
    streamIncarnation: 'interruption-stream',
    adapter: { ...targetDescriptor.adapter, publicOrigin: 'https://interruption.example.invalid' },
  };
  const interruptionPlan = retainHarnessPlan(interruptionTarget, 'interruption-op');
  assert.throws(
    () => __deploymentTest.applyHarness(interruptionPlan.planId, {
      targetId: interruptionTarget.targetId,
      confirmation: interruptionPlan.confirmation,
      nowMs: 10_001,
      releaseDirectory: release.releaseDirectory,
      verifyRelease: eligibleVerifier,
      controlRoot,
      clock: () => lifecycleClock++,
      simulateInterruptionAfter: 'compatibilityPreflight',
    }),
    (error) => error.code === 'SNAPBACK_TEST_SIMULATED_INTERRUPTION',
  );
  const interruptedJournal = JSON.parse(readFileSync(join(controlRoot, 'operations', 'interruption-op.json'), 'utf8'));
  assert.equal(interruptedJournal.state, 'interrupted');
  assert.equal(interruptedJournal.steps.at(-1).operation, 'compatibilityPreflight');
  const resumedReceipt = __deploymentTest.applyHarness(interruptionPlan.planId, {
    targetId: interruptionTarget.targetId,
    confirmation: interruptionPlan.confirmation,
    nowMs: 10_002,
    releaseDirectory: release.releaseDirectory,
    verifyRelease: eligibleVerifier,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(resumedReceipt.outcome, 'activated');
  assert.deepEqual(
    resumedReceipt.steps.slice(0, 4).map((step) => step.idempotentReplay),
    [true, true, true, true],
  );
  assert.equal(JSON.parse(readFileSync(join(controlRoot, 'operations', 'interruption-op.json'), 'utf8')).attempt, 2);
  const remoteRequiredTarget = {
    ...targetDescriptor,
    targetId: 'target-remote-required',
    environmentId: 'remote-required-preview',
    deploymentId: 'remote-required-deployment',
    databaseId: 'remote-required-database',
    streamIncarnation: 'remote-required-stream',
    adapter: { ...targetDescriptor.adapter, publicOrigin: 'https://remote-required.example.invalid' },
  };
  const remoteRequiredPlan = retainHarnessPlan(remoteRequiredTarget, 'remote-required-op');
  let remoteRequiredError;
  try {
    applyDeployPlan(remoteRequiredPlan.planId, {
      targetId: remoteRequiredTarget.targetId,
      confirmation: remoteRequiredPlan.confirmation,
      nowMs: 10_001,
      releaseDirectory: release.releaseDirectory,
      verifyRelease: eligibleVerifier,
      controlRoot,
      clock: () => lifecycleClock++,
    });
  } catch (error) {
    remoteRequiredError = error;
  }
  assert.equal(remoteRequiredError?.code, 'SNAPBACK_PREPARED_RELEASE_REQUIRED');
  assert.equal(inspectTarget(remoteRequiredTarget.targetId, { controlRoot, operationId: 'remote-required-after' }).observation.activeReleaseId, null);
  assert.throws(
    () => verifyPreparedReleaseArtifacts({
      targetId: remoteRequiredTarget.targetId,
      releaseDirectory: release.releaseDirectory,
      preparedReleasePath: join(root, 'missing-prepared.json'),
      qualificationPath: join(root, 'missing-qualification.json'),
      verifyRelease,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_PREPARED_RELEASE_PROFILE_INVALID',
  );
  const qualifiedTarget = {
    ...targetDescriptor,
    targetId: 'target-qualified',
    environmentId: 'qualified-preview',
    deploymentId: 'qualified-deployment',
    databaseId: 'qualified-database',
    streamIncarnation: 'qualified-stream',
    targetProfileId: 'trusted-single-tenant-app-complete.v1',
    adapter: { ...targetDescriptor.adapter, publicOrigin: 'https://qualified.example.invalid' },
  };
  addTarget(qualifiedTarget, { controlRoot });
  const remoteDrillOptions = {
    targetId: qualifiedTarget.targetId,
    reason: 'pin the complete provider boundary before provisioning',
    storage: {
      computeClass: 'fixture-small',
      persistentVolumeClass: 'fixture-encrypted-volume',
      persistentVolumeEncrypted: true,
      artifactStoreRef: 'object://fixture-artifacts/releases',
      artifactStorageClass: 'fixture-immutable',
      backupStoreRef: 'object://fixture-backups/verified',
      backupStorageClass: 'fixture-retained',
      backupPermissionBoundary: 'separateWriteGrant',
    },
    tls: { issuer: 'fixture-acme' },
    supervisor: { kind: 'systemd' },
    logs: {
      sinkRef: 'logs://fixture-control/deployments',
      retentionClass: 'fixture-thirty-days',
      redactionProfile: 'snapback-secret-private-v1',
    },
    credentials: {
      admissionKeyRef: 'provider-secret://fixture/hosted-admission-key',
      replayFloorStoreRef: 'object://fixture-control/replay-floor',
    },
    cost: {
      currency: 'USD',
      estimatedMonthlyMinorUnits: 1200,
      maximumMonthlyMinorUnits: 2000,
      estimateBasisSha256: `sha256:${'c'.repeat(64)}`,
    },
    nowMs: 40,
    controlRoot,
  };
  const remoteDrillPlan = createRemoteDrillPlan(remoteDrillOptions);
  assert.equal(remoteDrillPlan.provider, qualifiedTarget.adapter.provider);
  assert.equal(remoteDrillPlan.accountFingerprint, qualifiedTarget.adapter.accountFingerprint);
  assert.equal(remoteDrillPlan.provisioningAuthority, 'confirmationRequired');
  assert.deepEqual(remoteDrillPlan.nonclaims, [
    'highAvailability', 'autoscaling', 'multiRegion', 'zeroDowntime',
    'untrustedMultiTenancy', 'managedServiceSla',
  ]);
  assert.deepEqual(createRemoteDrillPlan(remoteDrillOptions), remoteDrillPlan);
  assert.deepEqual(
    verifyRemoteDrillPlan(remoteDrillPlan.planId, {
      targetId: qualifiedTarget.targetId,
      confirmation: remoteDrillPlan.confirmation,
      nowMs: 41,
      controlRoot,
    }),
    remoteDrillPlan,
  );
  assert.throws(
    () => verifyRemoteDrillPlan(remoteDrillPlan.planId, {
      targetId: qualifiedTarget.targetId,
      confirmation: 'confirm:wrong',
      nowMs: 41,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_REMOTE_DRILL_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => verifyRemoteDrillPlan(remoteDrillPlan.planId, {
      targetId: 'target-other',
      confirmation: remoteDrillPlan.confirmation,
      nowMs: 41,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_REMOTE_DRILL_IDENTITY_MISMATCH',
  );
  assert.throws(
    () => verifyRemoteDrillPlan(remoteDrillPlan.planId, {
      targetId: qualifiedTarget.targetId,
      confirmation: remoteDrillPlan.confirmation,
      nowMs: remoteDrillPlan.expiresAtMs + 1,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_REMOTE_DRILL_PLAN_EXPIRED',
  );
  assert.equal(
    statSync(join(
      controlRoot,
      'remote-drill-plans',
      `${remoteDrillPlan.planId.slice('sha256:'.length)}.json`,
    )).mode & 0o777,
    0o600,
  );
  assert.throws(
    () => createRemoteDrillPlan({
      ...remoteDrillOptions,
      storage: {
        ...remoteDrillOptions.storage,
        backupStoreRef: remoteDrillOptions.storage.artifactStoreRef,
      },
    }),
    (error) => error.code === 'SNAPBACK_REMOTE_DRILL_PLAN_INVALID',
  );
  assert.throws(
    () => createRemoteDrillPlan({
      ...remoteDrillOptions,
      cost: {
        ...remoteDrillOptions.cost,
        maximumMonthlyMinorUnits: 1000,
      },
    }),
    (error) => error.code === 'SNAPBACK_REMOTE_DRILL_PLAN_INVALID',
  );
  const remoteAttestation = {
    kind: 'remoteProviderAttestation',
    uri: 'fixture://remote/provider-attestation',
    sha256: `sha256:${'a'.repeat(64)}`,
    bytes: 128,
    verified: true,
  };
  const hostedAuthSupport = {
    externalTls: 'enforced',
    effectiveSource: 'trusted',
    authenticationThrottle: 'sharedEnforced',
    sessionInvalidation: 'globallyFenced',
    clientCredentialPosture: 'senderConstrainedV2',
  };
  const browserArtifactSha256 = `sha256:${'f'.repeat(64)}`;
  const hostedAuthSupportContent = {
    hostedAuth: hostedAuthSupport,
    authenticationThrottleConfig: {
      retentionMs: 900_000,
      maximumKeyCount: 100_000,
      global: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
      source: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
      subject: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
      sourceSubject: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
      family: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
    },
    operatorSurface: 'disabled',
    browserDirectBearerSeam: 'excluded',
    browserArtifactSha256,
  };
  const hostedAuthSupportSha256 = __deploymentTest.sha256(Buffer.from(
    `snapback-hosted-auth-support-v1\0${__deploymentTest.canonicalJson(hostedAuthSupportContent)}`,
  )).slice('sha256:'.length);
  const hostedAuthDrill = createHostedAuthDrillReceipt({
    targetId: qualifiedTarget.targetId,
    browserArtifactSha256,
    admission: {
      version: 1,
      deploymentId: qualifiedTarget.deploymentId,
      configurationSha256: 'e'.repeat(64),
      supportSha256: hostedAuthSupportSha256,
      admissionEpoch: 7,
      senderReplayEpochFloor: 17,
      issuedAtMs: 50,
      expiresAtMs: 300_050,
      limiterEpoch: 11,
      authenticationThrottleConfig: hostedAuthSupportContent.authenticationThrottleConfig,
      invalidationEpoch: 13,
      handlerProtocolVersion: 1,
      handlerIncarnation: 'handler-1',
      operatorSurface: 'disabled',
      browserDirectBearerSeam: 'excluded',
      hostedAuth: hostedAuthSupport,
    },
    liveHealth: {
      admissionEpoch: 7,
      senderReplayEpochFloor: 17,
      senderReplayEpochFloorCurrent: true,
      limiterReachable: true,
      invalidationCurrent: true,
      serializedAuthorityCurrent: true,
      handlerCompatible: true,
      servingAdmitted: true,
      observedAtMs: 80,
    },
    evidence: [remoteAttestation],
    startedAtMs: 60,
    finishedAtMs: 90,
    controlRoot,
  });
  assert.throws(
    () => createHostedAuthDrillReceipt({
      targetId: qualifiedTarget.targetId,
      browserArtifactSha256,
      admission: hostedAuthDrill.admission,
      liveHealth: hostedAuthDrill.liveHealth,
      evidence: [],
      startedAtMs: hostedAuthDrill.startedAtMs,
      finishedAtMs: hostedAuthDrill.finishedAtMs,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_AUTH_DRILL_INCOMPLETE',
  );
  const sealedHostedAdmission = sealHostedAdmissionEnvelope({
    keyId: 'hosted-key-1',
    keyMaterial: Buffer.alloc(32, 29),
    publicOrigin: qualifiedTarget.adapter.publicOrigin,
    admission: hostedAuthDrill.admission,
  });
  assert.equal(sealedHostedAdmission.schemaVersion, 'snapback.hosted-admission-envelope.v1');
  assert.match(sealedHostedAdmission.mac, /^[A-Za-z0-9_-]{43}$/);
  assert.equal('keyMaterial' in sealedHostedAdmission, false);
  const crossLanguageAdmission = {
    ...hostedAuthDrill.admission,
    deploymentId: 'deployment-1',
    configurationSha256: 'a'.repeat(64),
    supportSha256: 'b'.repeat(64),
    issuedAtMs: 1_000,
    expiresAtMs: 301_000,
  };
  assert.equal(
    sealHostedAdmissionEnvelope({
      keyId: 'hosted-key-1',
      keyMaterial: Buffer.alloc(32, 29),
      publicOrigin: 'https://app.example.test',
      admission: crossLanguageAdmission,
    }).mac,
    'tb12sK-_E81LB_DCFs2h4ZSwDewruaUk9S2LFU1RsRo',
    'Node and Rust must share the exact canonical hosted-admission MAC vector',
  );
  const qualificationClaimNames = [
    'identityFencing', 'immutableUploadReadBack', 'tlsOrigin', 'hostedAuth',
    'healthAcceptance', 'logsInspection', 'compatibilityRollback',
    'backupRestore', 'interruptionResume', 'secretScan', 'costCapacity',
  ];
  const qualificationClaimEvidence = Object.fromEntries(
    qualificationClaimNames.map((claim) => [claim, [remoteAttestation]]),
  );
  const qualification = createAdapterQualificationManifest({
    targetId: qualifiedTarget.targetId,
    hostedAuthDrill,
    claimEvidence: qualificationClaimEvidence,
    qualifiedAtMs: 100,
    controlRoot,
  });
  assert.throws(
    () => createAdapterQualificationManifest({
      targetId: qualifiedTarget.targetId,
      hostedAuthDrill,
      claimEvidence: Object.fromEntries(
        qualificationClaimNames.slice(1).map((claim) => [claim, [remoteAttestation]]),
      ),
      qualifiedAtMs: 100,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
  );
  assert.throws(
    () => createAdapterQualificationManifest({
      targetId: qualifiedTarget.targetId,
      hostedAuthDrill,
      claimEvidence: {
        ...qualificationClaimEvidence,
        hostedAuth: [{
          ...remoteAttestation,
          kind: 'localFixtureEvidence',
        }],
      },
      qualifiedAtMs: 100,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_ADAPTER_QUALIFICATION_INCOMPLETE',
  );
  const qualificationId = qualification.qualificationId;
  const qualificationPath = join(root, 'qualified-adapter.json');
  writeFileSync(qualificationPath, `${__deploymentTest.canonicalJson(qualification)}\n`);
  const qualifiedReleaseDirectory = join(root, 'qualified-release');
  mkdirSync(qualifiedReleaseDirectory);
  const qualifiedBaseManifest = {
    ...JSON.parse(readFileSync(join(release.releaseDirectory, 'release.manifest.json'), 'utf8')),
    targetProfileId: qualifiedTarget.targetProfileId,
  };
  const qualifiedBaseManifestBytes = Buffer.from(`${__deploymentTest.canonicalJson(qualifiedBaseManifest)}\n`);
  writeFileSync(join(qualifiedReleaseDirectory, 'release.manifest.json'), qualifiedBaseManifestBytes);
  const qualifiedBaseVerification = {
    releaseId: release.releaseId,
    manifestSha256: __deploymentTest.sha256(qualifiedBaseManifestBytes),
    activationEligible: false,
  };
  const preparedReleaseEvidenceKinds = [
    'runtimeArtifact', 'serverArtifact', 'artifactSignature', 'licenseSbom',
    'buildProvenance', 'compatibilityGenerations', 'migrationPlan',
    'healthProbes', 'acceptanceProbes', 'configRequirements',
  ];
  const preparedReleaseEvidence = Object.fromEntries(
    preparedReleaseEvidenceKinds.map((kind) => [kind, [remoteAttestation]]),
  );
  const preparedReleaseOptions = {
    targetId: qualifiedTarget.targetId,
    releaseDirectory: qualifiedReleaseDirectory,
    qualificationPath,
    verifyRelease: () => ({ ...qualifiedBaseVerification }),
    compatibility: {
      minimumReadableSchemaGeneration: 0,
      maximumReadableSchemaGeneration: 0,
      writeSchemaGeneration: 0,
      minimumRetainedClientGeneration: 0,
      minimumJobGeneration: 0,
      minimumConfigGeneration: 0,
      migrationSha256: `sha256:${'b'.repeat(64)}`,
      migrationTransactional: true,
      irreversibleBoundary: null,
      rollbackMode: 'codeOnly',
    },
    releaseEvidence: preparedReleaseEvidence,
    preparedAtMs: 101,
    controlRoot,
  };
  const preparedRelease = createPreparedReleaseManifest(preparedReleaseOptions);
  assert.throws(
    () => createPreparedReleaseManifest({
      ...preparedReleaseOptions,
      releaseEvidence: Object.fromEntries(
        preparedReleaseEvidenceKinds.slice(1).map((kind) => [kind, [remoteAttestation]]),
      ),
    }),
    (error) => error.code === 'SNAPBACK_PREPARED_RELEASE_INVALID',
  );
  const preparedReleaseId = preparedRelease.preparedReleaseId;
  const preparedReleasePath = join(root, 'qualified-release.json');
  writeFileSync(preparedReleasePath, `${__deploymentTest.canonicalJson(preparedRelease)}\n`);
  const qualifiedVerifier = () => ({ ...qualifiedBaseVerification });
  const preparedVerification = verifyPreparedReleaseArtifacts({
    targetId: qualifiedTarget.targetId,
    releaseDirectory: qualifiedReleaseDirectory,
    preparedReleasePath,
    qualificationPath,
    verifyRelease: qualifiedVerifier,
    controlRoot,
  });
  assert.equal(preparedVerification.activationEligible, true);
  assert.equal(preparedVerification.preparedReleaseId, preparedReleaseId);
  const qualifiedPlan = createDeployPlan({
    releaseDirectory: qualifiedReleaseDirectory,
    targetId: qualifiedTarget.targetId,
    reason: 'qualified artifact production-fence proof',
    operationId: 'qualified-op',
    nowMs: 10_000,
    controlRoot,
    verifyRelease: qualifiedVerifier,
    preparedReleasePath,
    qualificationPath,
  });
  assert.equal(qualifiedPlan.applyEligible, true);
  assert.equal(qualifiedPlan.preparedReleaseId, preparedReleaseId);
  let qualifiedApplyError;
  try {
    applyDeployPlan(qualifiedPlan.planId, {
      targetId: qualifiedTarget.targetId,
      confirmation: qualifiedPlan.confirmation,
      nowMs: 10_001,
      releaseDirectory: qualifiedReleaseDirectory,
      preparedReleasePath,
      qualificationPath,
      verifyRelease: qualifiedVerifier,
      controlRoot,
      clock: () => lifecycleClock++,
    });
  } catch (error) {
    qualifiedApplyError = error;
  }
  assert.equal(qualifiedApplyError?.code, 'SNAPBACK_DEPLOY_REMOTE_EVIDENCE_REQUIRED');
  assert.equal(qualifiedApplyError?.diagnostic?.details?.outcome, 'rolledBack');
  assert.equal(inspectTarget(qualifiedTarget.targetId, { controlRoot, operationId: 'qualified-after' }).observation.activeReleaseId, null);
  const qualifiedCurrentVerifier = () => ({
    ...qualifiedBaseVerification,
    releaseId: secondReleaseId,
    activationEligible: true,
  });
  const qualifiedCurrentPlan = retainHarnessPlan(qualifiedTarget, 'qualified-current-op', qualifiedCurrentVerifier);
  const qualifiedCurrentReceipt = __deploymentTest.applyHarness(qualifiedCurrentPlan.planId, {
    targetId: qualifiedTarget.targetId,
    confirmation: qualifiedCurrentPlan.confirmation,
    nowMs: 10_010,
    releaseDirectory: qualifiedReleaseDirectory,
    verifyRelease: qualifiedCurrentVerifier,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(qualifiedCurrentReceipt.releaseId, secondReleaseId);
  const rollbackPlan = __deploymentTest.createRollbackPlanHarness({
    targetId: qualifiedTarget.targetId,
    destinationReleaseDirectory: qualifiedReleaseDirectory,
    preparedReleasePath,
    qualificationPath,
    verifyRelease: qualifiedVerifier,
    reason: 'code-only rollback drill',
    operationId: 'explicit-rollback-op',
    nowMs: 10_020,
    controlRoot,
  });
  assert.equal(rollbackPlan.applyEligible, true);
  assert.equal(rollbackPlan.observedActiveReleaseId, secondReleaseId);
  assert.equal(rollbackPlan.destinationReleaseId, release.releaseId);
  assert.throws(
    () => __deploymentTest.applyRollbackPlanHarness(rollbackPlan.planId, {
      targetId: qualifiedTarget.targetId,
      confirmation: 'wrong',
      nowMs: 10_021,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_MAINTENANCE_CONFIRMATION_REQUIRED',
  );
  const rollbackReceipt = __deploymentTest.applyRollbackPlanHarness(rollbackPlan.planId, {
    targetId: qualifiedTarget.targetId,
    confirmation: rollbackPlan.confirmation,
    nowMs: 10_021,
    destinationReleaseDirectory: qualifiedReleaseDirectory,
    preparedReleasePath,
    qualificationPath,
    verifyRelease: qualifiedVerifier,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(rollbackReceipt.outcome, 'rolledBack');
  assert.equal(rollbackReceipt.releaseIdBefore, secondReleaseId);
  assert.equal(rollbackReceipt.releaseIdAfter, release.releaseId);
  assert.equal(rollbackReceipt.remoteEvidence, false);
  assert.ok(rollbackReceipt.gaps.some((gap) => gap.id === 'control-plane.remote-evidence'));
  assert.equal(
    statSync(join(controlRoot, 'maintenance-receipts', `${rollbackReceipt.receiptId.slice('sha256:'.length)}.json`)).mode & 0o777,
    0o600,
  );
  const replacementSentinel = `sha256:${'d'.repeat(64)}`;
  const restorePlan = __deploymentTest.createRestorePlanHarness({
    sourceTargetId: lifecycleTarget.targetId,
    destinationTargetId: qualifiedTarget.targetId,
    backupId: secondLifecycleReceipt.backup.backupId,
    reason: 'isolated destructive restore drill',
    operationId: 'restore-op',
    replacementReleaseId: release.releaseId,
    destinationSentinelSha256: replacementSentinel,
    nowMs: 10_030,
    controlRoot,
  });
  assert.equal(restorePlan.applyEligible, true);
  assert.equal(restorePlan.observedActiveReleaseId, release.releaseId);
  assert.throws(
    () => __deploymentTest.applyRestorePlanHarness(restorePlan.planId, {
      targetId: qualifiedTarget.targetId,
      confirmation: 'wrong',
      nowMs: 10_031,
      controlRoot,
    }),
    (error) => error.code === 'SNAPBACK_MAINTENANCE_CONFIRMATION_REQUIRED',
  );
  const restoredPaused = __deploymentTest.applyRestorePlanHarness(restorePlan.planId, {
    targetId: qualifiedTarget.targetId,
    confirmation: restorePlan.confirmation,
    nowMs: 10_031,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(restoredPaused.outcome, 'restoredPaused');
  assert.equal(restoredPaused.restore.effectsFenced, true);
  assert.equal(restoredPaused.restore.externalEffectsDisabled, true);
  assert.equal(restoredPaused.restore.activated, false);
  assert.equal(
    verifyRestoreReceipt(restoredPaused.receiptId, { targetId: qualifiedTarget.targetId, controlRoot }).activated,
    false,
  );
  assert.equal(
    inspectTarget(qualifiedTarget.targetId, { controlRoot, operationId: 'restore-paused-inspect' }).observation.state,
    'inactive',
  );
  const restoreActivationPlan = __deploymentTest.createRestoreActivationPlanHarness({
    restoreReceiptId: restoredPaused.receiptId,
    targetId: qualifiedTarget.targetId,
    reason: 'activate verified restored destination',
    operationId: 'restore-activate-op',
    releaseDirectory: qualifiedReleaseDirectory,
    preparedReleasePath,
    qualificationPath,
    verifyRelease: qualifiedVerifier,
    nowMs: 10_040,
    controlRoot,
  });
  assert.equal(restoreActivationPlan.applyEligible, true);
  const restoredActivated = __deploymentTest.applyRestoreActivationPlanHarness(restoreActivationPlan.planId, {
    targetId: qualifiedTarget.targetId,
    confirmation: restoreActivationPlan.confirmation,
    releaseDirectory: qualifiedReleaseDirectory,
    preparedReleasePath,
    qualificationPath,
    verifyRelease: qualifiedVerifier,
    nowMs: 10_041,
    controlRoot,
    clock: () => lifecycleClock++,
  });
  assert.equal(restoredActivated.outcome, 'restoreActivated');
  assert.equal(restoredActivated.restore.effectsFenced, false);
  assert.equal(restoredActivated.restore.externalEffectsDisabled, false);
  assert.equal(restoredActivated.restore.activated, true);
  assert.equal(restoredActivated.releaseIdAfter, release.releaseId);
  assert.equal(
    verifyRestoreReceipt(restoredActivated.receiptId, { targetId: qualifiedTarget.targetId, controlRoot }).activated,
    true,
  );
  assert.equal(
    inspectTarget(qualifiedTarget.targetId, { controlRoot, operationId: 'restore-active-inspect' }).observation.activeReleaseId,
    release.releaseId,
  );
  const auditedEventTypes = new Set(
    readdirSync(join(controlRoot, 'audit-events'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(controlRoot, 'audit-events', name), 'utf8')).eventType),
  );
  for (const eventType of [
    'deployApply',
    'backupCreate',
    'codeOnlyRollback',
    'destructiveRestore',
    'restoreActivation',
    'controlLogsRead',
    'adminInspect',
    'backupList',
    'backupVerify',
    'restoreVerify',
  ]) {
    assert.equal(auditedEventTypes.has(eventType), true, `missing audit coverage for ${eventType}`);
  }
  const failureTarget = {
    ...targetDescriptor,
    targetId: 'target-failure',
    environmentId: 'failure-preview',
    deploymentId: 'failure-deployment',
    databaseId: 'failure-database',
    streamIncarnation: 'failure-stream',
    adapter: { ...targetDescriptor.adapter, publicOrigin: 'https://failure.example.invalid' },
  };
  const failurePlan = retainHarnessPlan(failureTarget, 'failure-op');
  let rollbackError;
  try {
    __deploymentTest.applyHarness(failurePlan.planId, {
      targetId: failureTarget.targetId,
      confirmation: failurePlan.confirmation,
      nowMs: 10_001,
      releaseDirectory: release.releaseDirectory,
      verifyRelease: eligibleVerifier,
      controlRoot,
      clock: () => lifecycleClock++,
    });
  } catch (error) {
    rollbackError = error;
  }
  assert.equal(rollbackError?.code, 'SNAPBACK_ADAPTER_REJECTED');
  assert.equal(rollbackError?.diagnostic?.details?.outcome, 'rolledBack');
  const rollbackOnFailureReceiptId = rollbackError.diagnostic.details.receiptId;
  const rollbackOnFailureReceipt = JSON.parse(readFileSync(join(controlRoot, 'receipts', `${rollbackOnFailureReceiptId.slice('sha256:'.length)}.json`), 'utf8'));
  assert.equal(rollbackOnFailureReceipt.outcome, 'rolledBack');
  assert.ok(rollbackOnFailureReceipt.steps.some((step) => step.operation === 'rollback' && step.state === 'rolledBack'));
  assert.equal(inspectTarget(failureTarget.targetId, { controlRoot, operationId: 'failure-after' }).observation.activeReleaseId, null);
  assert.throws(
    () => validateTargetDescriptor({ ...targetDescriptor, apiToken: 'must-not-fit' }),
    (error) => error.code === 'SNAPBACK_TARGET_DESCRIPTOR_INVALID',
  );
  const mismatchTarget = {
    ...targetDescriptor,
    targetId: 'target-mismatch',
    environmentId: 'preview-mismatch',
    deploymentId: 'deployment-mismatch',
    databaseId: 'database-mismatch',
    streamIncarnation: 'stream-mismatch',
    adapter: { ...targetDescriptor.adapter, publicOrigin: 'https://mismatch.example.invalid' },
  };
  addTarget(mismatchTarget, { controlRoot });
  assert.throws(
    () => inspectTarget('target-mismatch', { controlRoot, operationId: 'mismatch-op' }),
    (error) => error.code === 'SNAPBACK_TARGET_IDENTITY_MISMATCH',
  );
  writeFileSync(adapterDriver, `${readFileSync(adapterDriver, 'utf8')}\n// tampered\n`);
  assert.throws(
    () => showTarget('target-preview-1', { controlRoot }),
    (error) => error.code === 'SNAPBACK_ADAPTER_DRIVER_TAMPERED',
  );
  await assert.rejects(
    buildRelease({
      backendDirectory: join(project, 'snapback'),
      outputDirectory: join(project, 'snapback', 'release-output'),
    }),
    (error) => error.code === 'SNAPBACK_RELEASE_PATH_OVERLAP',
  );

  const schemaSource = join(project, 'snapback', 'schema.mjs');
  writeFileSync(schemaSource, `${readFileSync(schemaSource, 'utf8')}\n// dirty preview proof\n`);
  await assert.rejects(
    buildRelease({ backendDirectory: join(project, 'snapback'), outputDirectory: releaseOutput }),
    (error) => error.code === 'SNAPBACK_DEPLOY_DIRTY_SOURCE',
  );
  const dirtyRelease = await buildRelease({
    backendDirectory: join(project, 'snapback'),
    outputDirectory: releaseOutput,
    allowDirty: true,
  });
  assert.equal(dirtyRelease.sourceDirty, true);
  assert.notEqual(dirtyRelease.releaseId, release.releaseId);
  const dirtyManifestPath = join(dirtyRelease.releaseDirectory, 'release.manifest.json');
  const dirtyManifest = JSON.parse(readFileSync(dirtyManifestPath, 'utf8'));
  dirtyManifest.source.unexpected = true;
  chmodSync(dirtyManifestPath, 0o644);
  writeFileSync(dirtyManifestPath, `${JSON.stringify(dirtyManifest)}\n`);
  assert.throws(
    () => verifyRelease(dirtyRelease.releaseDirectory),
    (error) => error.code === 'SNAPBACK_RELEASE_MANIFEST_INVALID',
  );

  const unsafeWeb = join(project, 'dist-web');
  mkdirSync(unsafeWeb);
  writeFileSync(join(unsafeWeb, '.env'), 'NPM_TOKEN=must-never-ship\n');
  await assert.rejects(
    buildRelease({
      backendDirectory: join(project, 'snapback'),
      outputDirectory: releaseOutput,
      webDirectory: unsafeWeb,
      allowDirty: true,
    }),
    (error) => error.code === 'SNAPBACK_RELEASE_FORBIDDEN_FILE',
  );

  const retainedManifest = JSON.parse(readFileSync(join(release.releaseDirectory, 'release.manifest.json'), 'utf8'));
  const tampered = join(release.releaseDirectory, ...retainedManifest.components[0].path.split('/'));
  chmodSync(tampered, 0o644);
  writeFileSync(tampered, 'tampered');
  assert.throws(
    () => verifyRelease(release.releaseDirectory),
    (error) => error.code === 'SNAPBACK_RELEASE_ARTIFACT_TAMPERED',
  );

  assert.throws(
    () => validateDevTarget({ database: { path: join(root, 'other.sqlite3') } }, {
      readyFile: join(root, 'ready.json'),
      database: join(root, 'expected.sqlite3'),
    }),
    (error) => error.code === 'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
  );

  const physicalTarget = join(root, 'canonical-target');
  const aliasedTarget = join(root, 'canonical-alias');
  mkdirSync(physicalTarget);
  symlinkSync(physicalTarget, aliasedTarget, 'dir');
  const physicalDatabase = join(physicalTarget, 'dev.sqlite3');
  writeFileSync(physicalDatabase, '');
  assert.equal(
    validateDevTarget({ database: { path: physicalDatabase } }, {
      readyFile: join(root, 'canonical.ready.json'),
      database: join(aliasedTarget, 'dev.sqlite3'),
    }).database.path,
    physicalDatabase,
  );

  const commandLog = join(root, 'runtime-commands.log');
  const recordingRuntime = join(root, 'recording-snapback');
  writeFileSync(recordingRuntime, `#!/bin/sh
printf '%s\\n' "$*" >> '${commandLog}'
if [ "$1" = "load" ]; then
  printf '%s\\n' '{"resultKind":"hostOpsResult","operation":"schema.load","ok":true}'
  printf '%s\\n' '{"resultKind":"hostOpsResult","operation":"functions.load","ok":true}'
fi
exit 0
`);
  chmodSync(recordingRuntime, 0o755);
  const backend = join(root, 'seed-once', 'snapback');
  mkdirSync(join(backend, 'generated'), { recursive: true });
  writeFileSync(
    join(backend, 'generated', 'schema.manifest.json'),
    '{"appId":"seed-once","auth":{"mode":"dev"}}\n',
  );
  writeFileSync(
    join(backend, 'generated', 'functions.manifest.json'),
    '{"appId":"seed-once"}\n',
  );
  writeFileSync(
    join(backend, 'generated', 'artifacts.json'),
    '{"artifactKind":"artifactIndex","artifacts":["functions.manifest.json","schema.manifest.json"]}\n',
  );
  writeFileSync(join(backend, 'seed.json'), '{"tables":{}}\n');
  await __test.loadGenerated(
    recordingRuntime,
    join(root, 'seed-once'),
    backend,
    join(root, 'seed-once', '.snapback', 'dev.ready.json'),
    null,
    { seed: true },
  );
  await __test.loadGenerated(
    recordingRuntime,
    join(root, 'seed-once'),
    backend,
    join(root, 'seed-once', '.snapback', 'dev.ready.json'),
    null,
  );
  const commands = readFileSync(commandLog, 'utf8').trim().split('\n');
  assert.equal(commands.filter((line) => line.startsWith('load ')).length, 2);
  assert.equal(commands.filter((line) => line.startsWith('reset ')).length, 1);

  // The interactive dev control channel: a TTY stdin gets single-key verbs
  // (s/r/R/f/q) instead of the JSON command channel, over the same verb slice.
  {
    const invoked = [];
    const verbs = {
      status: async (context) => invoked.push(['status', context]),
      reload: async (context) => invoked.push(['reload', context]),
      restart: async (context) => invoked.push(['restart', context]),
      'dev-fresh': async (context) => invoked.push(['dev-fresh', context]),
    };
    let stopped = 0;
    let rawMode = null;
    const tty = new PassThrough();
    tty.isTTY = true;
    tty.setRawMode = (value) => { rawMode = value; };
    const detach = attachDevControlChannel({
      verbs,
      stop: () => { stopped += 1; },
      onEvent: () => {},
      stdin: tty,
    });
    assert.equal(rawMode, true);
    tty.emit('data', 's');
    tty.emit('data', 'r');
    tty.emit('data', 'R');
    tty.emit('data', 'f');
    tty.emit('data', 'x');
    tty.emit('data', 'q');
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.deepEqual(
      invoked.map(([verb]) => verb),
      ['status', 'reload', 'restart', 'dev-fresh'],
    );
    assert.equal(stopped, 1);
    detach();
    assert.equal(rawMode, false);
  }

  // The machine-readable channel over the same verbs: JSON commands in,
  // structured command-error events (never a crash) for malformed input.
  {
    const invoked = [];
    const events = [];
    const verbs = {
      status: async (context) => invoked.push(['status', context]),
      reload: async (context) => invoked.push(['reload', context]),
      restart: async (context) => invoked.push(['restart', context]),
      'dev-fresh': async (context) => invoked.push(['dev-fresh', context]),
    };
    let stopped = 0;
    const stdin = new PassThrough();
    attachDevControlChannel({
      verbs,
      stop: () => { stopped += 1; },
      onEvent: (event) => events.push(event),
      stdin,
    });
    assert.equal(events[0].state, 'control-ready');
    assert.equal(events[0].channel, 'json');
    assert.deepEqual(events[0].verbs, ['status', 'reload', 'restart', 'dev-fresh']);
    stdin.write('not json\n');
    stdin.write(`${JSON.stringify({ schemaVersion: 'snapback.dev-command.v1', verb: 'status', requestId: 'u-1' })}\n`);
    stdin.write(`${JSON.stringify({ schemaVersion: 'wrong.schema', verb: 'status' })}\n`);
    stdin.write(`${JSON.stringify({ schemaVersion: 'snapback.dev-command.v1', verb: 'dance' })}\n`);
    stdin.end();
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.deepEqual(invoked, [['status', { requestId: 'u-1' }]]);
    const errorCodes = events
      .filter((event) => event.state === 'command-error')
      .map((event) => event.diagnostics[0].code);
    assert.deepEqual(errorCodes, [
      'SNAPBACK_DEV_COMMAND_INVALID',
      'SNAPBACK_DEV_COMMAND_INVALID',
      'SNAPBACK_DEV_COMMAND_UNKNOWN_VERB',
    ]);
    assert.equal(stopped, 0, 'stdin EOF must only close the optional command channel');
  }

  console.log('package.test.mjs: doctor, scaffold, pre-provision remote-drill planning, positive qualification/prepared-release production, deploy lifecycle, interruption resume, standalone backup, mandatory audit, code-only rollback, destructive restore/activation, bounded logs, authenticated inspection, backup verification, target fencing, attach fencing, seed-once reload, and dev control channels pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}
