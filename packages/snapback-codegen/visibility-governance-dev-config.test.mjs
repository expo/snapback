import assert from 'node:assert/strict';
import {
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { CODEGEN_JOBS } from '../../scripts/generated-artifact-policy.mjs';
import { generate } from './index.mjs';
import {
  VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE,
  loadVisibilityGovernanceDevRegistry,
  mintVisibilityGovernanceDevConfig,
  resolveVisibilityGovernanceServerProfile,
  visibilityGovernanceDevEnvironment,
} from './visibility-governance-dev-config.mjs';
import {
  canonicalGovernanceJson,
  deepMatchGovernedVerdict,
  deploymentIdentityFromGenerated,
  governanceDigest,
} from './visibility-governance.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '..', '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function verifyMintedSignature(config) {
  const raw = Buffer.from(config.observerPublicKeyBase64, 'base64');
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      raw,
    ]),
    format: 'der',
    type: 'spki',
  });
  const unsigned = structuredClone(config.verdict);
  const signature = Buffer.from(unsigned.signature, 'base64');
  delete unsigned.signature;
  return {
    ok: verifySignature(
      null,
      Buffer.from(canonicalGovernanceJson(unsigned), 'utf8'),
      publicKey,
      signature,
    ),
    publicKey,
  };
}

test('dev-app registry exactly covers every local generated-artifact job', () => {
  const registry = loadVisibilityGovernanceDevRegistry(repositoryRoot);
  const expected = CODEGEN_JOBS
    .filter(({ targetProfile }) => targetProfile === undefined)
    .map(({ backend }) => backend)
    .sort();
  assert.deepEqual(registry.apps.map(({ backend }) => backend), expected);
  assert.equal(
    registry.apps.every(({ fixtureProfiles }) => Array.isArray(fixtureProfiles)),
    true,
    'every committed app registration must pin an exact fixture-profile set',
  );
});

test('todo and rbac prime to schema-valid exact-identity signed dev configs', async (t) => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: false,
  });
  const verdictSchema = readJson(join(packageRoot, 'visibility-governance-update-verdict.schema.json'));
  const targetSchema = readJson(join(packageRoot, 'visibility-governance-target-config.schema.json'));
  ajv.addSchema(verdictSchema);
  const validateTarget = ajv.compile(targetSchema);

  for (const backendPath of ['demos/todo/snapback', 'demos/rbac/snapback']) {
    await t.test(backendPath, async () => {
      const backendRoot = join(repositoryRoot, backendPath);
      const generated = await generate(backendRoot);
      assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
      const scratch = mkdtempSync(join(tmpdir(), 'snapback-governance-dev-mint-'));
      try {
        const outputPath = join(scratch, 'target-config.json');
        const minted = mintVisibilityGovernanceDevConfig({ backendRoot, outputPath });
        assert(minted);
        const config = readJson(outputPath);
        assert.equal(validateTarget(config), true, JSON.stringify(validateTarget.errors));
        assert.equal(config.targetClass, 'repository-local');
        assert.equal(
          config.verdict.providerProfile,
          VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE,
        );
        assert.equal(config.verdict.disposition, 'green');
        assert.equal(config.verdict.afterOid, config.sourceOid);
        assert.equal(statSync(outputPath).mode & 0o077, 0, 'config must be owner-only');

        const { ok, publicKey } = verifyMintedSignature(config);
        assert.equal(ok, true);
        assert.equal(
          config.observerKeyDigest,
          governanceDigest(
            'snapback:visibility-observer-key:v1',
            publicKey.export({ type: 'spki', format: 'pem' }),
          ),
        );

        const schemaManifest = readJson(join(backendRoot, 'generated', 'schema.manifest.json'));
        const functionManifest = readJson(join(backendRoot, 'generated', 'functions.manifest.json'));
        const governance = schemaManifest.visibilityGovernance;
        const expected = {
          backend: backendPath,
          appId: schemaManifest.appId,
          ...deploymentIdentityFromGenerated({
            schemaManifest,
            functionManifest,
            governance,
          }),
        };
        assert.equal(deepMatchGovernedVerdict(config.verdict, expected, {
          sourceOid: config.sourceOid,
          quarantineHeadDigest: governance.quarantineHeadDigest,
        }), true);

        const tampered = structuredClone(config);
        tampered.verdict.deploymentIdentities[0].schemaHash = 'sha256:tampered';
        assert.equal(verifyMintedSignature(tampered).ok, false);
        assert.throws(
          () => deepMatchGovernedVerdict(tampered.verdict, expected, {
            sourceOid: config.sourceOid,
            quarantineHeadDigest: governance.quarantineHeadDigest,
          }),
          ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH',
        );
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }
});

test('dev mint refuses production and hosted target classes', () => {
  const backendRoot = join(repositoryRoot, 'demos', 'todo', 'snapback');
  for (const targetClass of ['production', 'hosted', 'hosted-production']) {
    assert.throws(
      () => mintVisibilityGovernanceDevConfig({ backendRoot, targetClass }),
      ({ code, message }) => (
        code === 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED'
        && /refuses production, hosted/u.test(message)
      ),
    );
  }
});

test('dev-loop helper uses the closed native profile/exposure classification', () => {
  const backendRoot = join(repositoryRoot, 'demos', 'todo', 'snapback');
  for (const profile of ['prod', 'production', 'hosted', 'hosted-production', 'staging']) {
    const prepared = visibilityGovernanceDevEnvironment({
      backendRoot,
      environment: { SNAPBACK_PROFILE: profile },
    });
    assert.equal(prepared.minted, false);
    assert.equal(prepared.path, null);
    assert.equal(prepared.environment.SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG, undefined);
  }
  assert.equal(
    resolveVisibilityGovernanceServerProfile({ SNAPBACK_EXPOSURE: 'fronted' }),
    'prod',
  );
  assert.equal(
    resolveVisibilityGovernanceServerProfile({}, { loopback: false }),
    'prod',
  );
  assert.equal(
    resolveVisibilityGovernanceServerProfile({ SNAPBACK_EXPOSURE: 'unexpected' }),
    'prod',
  );
  assert.equal(
    resolveVisibilityGovernanceServerProfile({
      SNAPBACK_PROFILE: 'dev',
      SNAPBACK_EXPOSURE: 'fronted',
    }),
    'dev',
    'an explicit closed non-production profile wins exactly as native resolve_profile does',
  );
});

test('inherited target-config paths are not caller custody and dev mints never forward to prod', () => {
  const backendRoot = join(repositoryRoot, 'demos', 'todo', 'snapback');
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-governance-env-custody-'));
  try {
    const inheritedPath = join(scratch, 'inherited-dev.json');
    writeFileSync(inheritedPath, `${JSON.stringify({
      verdict: { providerProfile: VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE },
    })}\n`);
    const outputPath = join(scratch, 'fresh-dev.json');
    const dev = visibilityGovernanceDevEnvironment({
      backendRoot,
      outputPath,
      environment: {
        SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG: inheritedPath,
      },
      callerEnvironment: {},
    });
    assert.equal(dev.minted, true);
    assert.equal(dev.path, outputPath);

    for (const callerEnvironment of [
      {},
      { SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG: inheritedPath },
    ]) {
      const prod = visibilityGovernanceDevEnvironment({
        backendRoot,
        outputPath,
        environment: {
          SNAPBACK_PROFILE: 'prod',
          SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG: inheritedPath,
        },
        callerEnvironment,
      });
      assert.equal(prod.minted, false);
      assert.equal(prod.path, null);
      assert.equal(
        prod.environment.SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG,
        undefined,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('dev mint refuses any generated production override lifecycle', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-governance-production-refusal-'));
  try {
    const backendRoot = join(scratch, 'snapback');
    cpSync(join(repositoryRoot, 'demos', 'todo', 'snapback', 'generated'),
      join(backendRoot, 'generated'), { recursive: true });
    const schemaPath = join(backendRoot, 'generated', 'schema.manifest.json');
    const schema = readJson(schemaPath);
    schema.visibilityGovernance.required = true;
    schema.visibilityGovernance.productionWindows.push({
      overrideId: 'production-override-v1',
      issuedOn: '2026-08-16T00:00:00Z',
      expiresOn: '2026-09-01',
    });
    writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);
    assert.throws(
      () => mintVisibilityGovernanceDevConfig({ backendRoot }),
      ({ code, message }) => (
        code === 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED'
        && /production override authority/u.test(message)
      ),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('two registered apps mint independently across divergent fixture profiles and checkpoints', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-governance-two-app-'));
  try {
    const apps = [
      {
        backend: 'apps/alpha/snapback',
        source: 'demos/todo/snapback',
        appId: 'todo',
        profile: {
          id: 'alpha-repository-local-fixture-v1',
          digest: `sha256:${'1'.repeat(64)}`,
          targetClassCeiling: 'repository-local',
          principalClass: 'synthetic',
          dataClassification: 'fixture-owned',
        },
        quarantineHeadDigest: `sha256:${'a'.repeat(64)}`,
        overrideIds: ['alpha-fixture-a', 'alpha-fixture-b'],
      },
      {
        backend: 'apps/beta/snapback',
        source: 'demos/rbac/snapback',
        appId: 'rbac',
        profile: {
          id: 'beta-repository-local-fixture-v1',
          digest: `sha256:${'2'.repeat(64)}`,
          targetClassCeiling: 'repository-local',
          principalClass: 'synthetic',
          dataClassification: 'fixture-owned',
        },
        quarantineHeadDigest: `sha256:${'b'.repeat(64)}`,
        overrideIds: ['beta-fixture'],
      },
    ];
    for (const app of apps) {
      const backendRoot = join(scratch, app.backend);
      cpSync(
        join(repositoryRoot, app.source, 'generated'),
        join(backendRoot, 'generated'),
        { recursive: true },
      );
      const schemaPath = join(backendRoot, 'generated', 'schema.manifest.json');
      const schema = readJson(schemaPath);
      schema.visibilityGovernance.required = true;
      schema.visibilityGovernance.quarantineHeadDigest = app.quarantineHeadDigest;
      schema.visibilityGovernance.fixtureProfiles = app.overrideIds.map((overrideId) => ({
        overrideId,
        ...app.profile,
      }));
      writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);
    }
    mkdirSync(join(scratch, 'scripts'), { recursive: true });
    writeFileSync(
      join(scratch, 'scripts', 'visibility-governance-dev-apps.v1.json'),
      `${JSON.stringify({
        schemaVersion: 'snapback.visibility-governance-dev-app-registry.v1',
        targetClass: 'repository-local',
        principalClass: 'synthetic',
        dataClassification: 'fixture-owned',
        apps: apps.map(({ backend, appId, profile }) => ({
          backend,
          appId,
          fixtureProfiles: [profile],
        })),
      })}\n`,
    );

    for (const app of apps) {
      const minted = mintVisibilityGovernanceDevConfig({
        backendRoot: join(scratch, app.backend),
        repositoryRoot: scratch,
        outputPath: join(scratch, `${app.appId}-target-config.json`),
      });
      assert.equal(minted.config.quarantineCheckpoint, app.quarantineHeadDigest);
      assert.equal(minted.config.fixtureProfile.id, app.profile.id);
      assert.deepEqual(
        minted.config.verdict.deploymentIdentities.map(({ appId }) => appId),
        [app.appId],
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('dev mint attests the complete registered synthetic fixture profile tuple', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-governance-fixture-profile-'));
  try {
    const backendRoot = join(scratch, 'snapback');
    cpSync(join(repositoryRoot, 'demos', 'todo', 'snapback', 'generated'),
      join(backendRoot, 'generated'), { recursive: true });
    const registeredProfile = {
      id: 'todo-repository-local-fixture-v1',
      digest: `sha256:${'1'.repeat(64)}`,
      targetClassCeiling: 'repository-local',
      principalClass: 'synthetic',
      dataClassification: 'fixture-owned',
    };
    const registrationPath = join(backendRoot, 'visibility-governance-dev.json');
    writeFileSync(registrationPath, `${JSON.stringify({
      schemaVersion: 'snapback.visibility-governance-dev-registration.v1',
      appId: 'todo',
      targetClass: 'repository-local',
      principalClass: 'synthetic',
      dataClassification: 'fixture-owned',
      fixtureProfiles: [registeredProfile],
    })}\n`);
    const schemaPath = join(backendRoot, 'generated', 'schema.manifest.json');
    const schema = readJson(schemaPath);
    const profile = {
      overrideId: 'todo-fixture-v1',
      ...registeredProfile,
    };
    schema.visibilityGovernance.required = true;
    schema.visibilityGovernance.fixtureProfiles = [profile];
    writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);

    const minted = mintVisibilityGovernanceDevConfig({
      backendRoot,
      outputPath: join(scratch, 'target-config.json'),
    });
    assert.deepEqual(minted.config.fixtureProfile, {
      id: profile.id,
      digest: profile.digest,
      targetClass: 'repository-local',
      principalClass: 'synthetic',
      dataClassification: 'fixture-owned',
    });

    const mismatched = structuredClone(schema);
    mismatched.visibilityGovernance.fixtureProfiles[0].digest = `sha256:${'2'.repeat(64)}`;
    writeFileSync(schemaPath, `${JSON.stringify(mismatched)}\n`);
    assert.throws(
      () => mintVisibilityGovernanceDevConfig({ backendRoot }),
      ({ code, message }) => (
        code === 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED'
        && /does not exactly match/u.test(message)
      ),
    );

    writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);
    rmSync(registrationPath);
    assert.throws(
      () => mintVisibilityGovernanceDevConfig({ backendRoot }),
      ({ code, message }) => (
        code === 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED'
        && /requires a committed dev-app registration/u.test(message)
      ),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
