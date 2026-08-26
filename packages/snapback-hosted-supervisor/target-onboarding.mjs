#!/usr/bin/env node
// One-time credential enrollment for the fresh snapback-drill target identity.
// This command stages custody in the already-installed supervisor and product
// app, but deliberately does not update the legacy product Machine, create a
// volume, or alter a route.
//
// @ref LLP 0111#durable-spend-cleanup-and-credential-custody — target control,
// registry, admission signing, and outbound-channel identities are distinct
// provider/cryptographic credentials with secret-free retained fingerprints.
// @ref LLP 0111#same-origin-tls-transition — enrollment prepares a fresh,
// never-reused target identity without treating the cert-only predecessor as
// an in-place V2 target.

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  AttachUserPolicyCommand,
  CreateAccessKeyCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
  DetachUserPolicyCommand,
  IAMClient,
  ListPoliciesCommand,
} from '@aws-sdk/client-iam';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  canonicalJson,
  sha256,
} from './index.mjs';
import {
  certificateSha256,
  publicKeyForSeed,
} from './hosted-edge-admission.mjs';

export const TARGET_ONBOARDING_VERSION = 'snapback.hosted-target-onboarding.v1';
export const TARGET_DEFAULTS = Object.freeze({
  organization: 'personal',
  region: 'sjc',
  targetApp: 'snapback-drill',
  supervisorApp: 'snapback-hosted-supervisor-sjc',
  targetId: 'snapback-drill-hosted-v2-20260728',
  deploymentId: 'snapback-drill-hosted-v2-1',
  publicOrigin: 'https://snapback-drill.fly.dev',
  keychainService: 'snapback-hosted-supervisor',
  tigrisBucket: 'snapback-drill-backups',
  tigrisPrefix: 'snapback-hosted-v2',
  refusalBoundaryMicros: 3_000_000,
});

export const TARGET_TIGRIS_ROLES = Object.freeze({
  artifact: ['s3:GetObject'],
  backup: ['s3:GetObject', 's3:PutObject'],
  'control-state': ['s3:GetObject', 's3:PutObject'],
  audit: ['s3:GetObject', 's3:PutObject'],
  logs: ['s3:GetObject', 's3:PutObject'],
  cleanup: ['s3:DeleteObject', 's3:ListBucket'],
});

export const TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES = Object.freeze({
  // diagnostics-registry: reference-only
  artifact: 'SNAPBACK_HOSTED_TARGET_TIGRIS_ARTIFACT_PARTIAL',
  // diagnostics-registry: reference-only
  backup: 'SNAPBACK_HOSTED_TARGET_TIGRIS_BACKUP_PARTIAL',
  // diagnostics-registry: reference-only
  'control-state': 'SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL',
  // diagnostics-registry: reference-only
  audit: 'SNAPBACK_HOSTED_TARGET_TIGRIS_AUDIT_PARTIAL',
  // diagnostics-registry: reference-only
  logs: 'SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL',
  // diagnostics-registry: reference-only
  cleanup: 'SNAPBACK_HOSTED_TARGET_TIGRIS_CLEANUP_PARTIAL',
});

export function assertTargetTigrisCredentialPair(role, {
  accessKeyId = null,
  secretAccessKey = null,
} = {}) {
  if (!Object.hasOwn(TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES, role)) {
    throw new Error('SNAPBACK_HOSTED_TARGET_TIGRIS_BOOTSTRAP_INVALID');
  }
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_ARTIFACT_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_AUDIT_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_BACKUP_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_CLEANUP_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL
    throw new Error(TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES[role]);
  }
}

const BASE_SUPERVISOR_SECRET_FILES = Object.freeze([
  ['/run/secrets/fly-read-token', 'SUPERVISOR_FLY_READ_TOKEN'],
  ['/run/secrets/fly-control-token', 'SUPERVISOR_FLY_CONTROL_TOKEN'],
  ['/run/secrets/fly-registry-token', 'SUPERVISOR_FLY_REGISTRY_TOKEN'],
  ['/run/secrets/server-key.pem', 'SUPERVISOR_SERVER_KEY'],
  ['/run/secrets/server-cert.pem', 'SUPERVISOR_SERVER_CERT'],
  ['/run/secrets/client-ca.pem', 'SUPERVISOR_CLIENT_CA'],
  ['/run/secrets/tigris-anchor-id', 'SUPERVISOR_TIGRIS_ANCHOR_ID'],
  ['/run/secrets/tigris-anchor-secret', 'SUPERVISOR_TIGRIS_ANCHOR_SECRET'],
  ['/run/secrets/tigris-control-id', 'SUPERVISOR_TIGRIS_CONTROL_ID'],
  ['/run/secrets/tigris-control-secret', 'SUPERVISOR_TIGRIS_CONTROL_SECRET'],
  ['/run/secrets/tigris-journal-id', 'SUPERVISOR_TIGRIS_JOURNAL_ID'],
  ['/run/secrets/tigris-journal-secret', 'SUPERVISOR_TIGRIS_JOURNAL_SECRET'],
]);

export const TARGET_SUPERVISOR_SECRET_FILES = Object.freeze([
  ['/run/secrets/target-snapback-drill-fly-control-token', 'TARGET_SNAPBACK_DRILL_FLY_CONTROL_TOKEN'],
  ['/run/secrets/target-snapback-drill-fly-registry-token', 'TARGET_SNAPBACK_DRILL_FLY_REGISTRY_TOKEN'],
  ['/run/secrets/target-snapback-drill-admission-seed', 'TARGET_SNAPBACK_DRILL_ADMISSION_SEED'],
  ['/run/secrets/target-client-ca.pem', 'TARGET_SNAPBACK_DRILL_CLIENT_CA'],
  ...Object.keys(TARGET_TIGRIS_ROLES).flatMap((role) => {
    const stem = role.replaceAll('-', '_').toUpperCase();
    const fileStem = role.replaceAll('_', '-');
    return [
      [
        `/run/secrets/target-snapback-drill-tigris-${fileStem}-id`,
        `TARGET_SNAPBACK_DRILL_TIGRIS_${stem}_ID`,
      ],
      [
        `/run/secrets/target-snapback-drill-tigris-${fileStem}-secret`,
        `TARGET_SNAPBACK_DRILL_TIGRIS_${stem}_SECRET`,
      ],
    ];
  }),
]);

function digestHex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, {
  env = {},
  input = undefined,
  timeout = 120_000,
  redact = false,
} = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? 'C.UTF-8',
      ...env,
    },
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = redact
      ? `exit ${result.status}`
      : String(result.stderr || result.stdout).slice(0, 1_000);
    throw new Error(`${command} failed: ${detail}`);
  }
  return result;
}

function keychainGet(service, account) {
  const result = spawnSync(
    'security',
    ['find-generic-password', '-s', service, '-a', account, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

function keychainPut(service, account, value) {
  run('security', [
    'add-generic-password',
    '-U',
    '-s', service,
    '-a', account,
    '-w',
  ], { input: `${value}\n${value}\n`, redact: true });
}

function flyTokenMintAuthority() {
  const token = run('fly', ['auth', 'token'], { redact: true }).stdout.trim();
  if (!token) throw new Error('Fly operator session did not return token-mint authority');
  return token;
}

function flyJson(token, args) {
  return JSON.parse(run('fly', [...args, '--json'], {
    env: { FLY_API_TOKEN: token, NO_COLOR: '1' },
    redact: true,
  }).stdout);
}

function mintTargetToken(authority, config, role) {
  const account = `fly-target-${config.targetApp}-${role}`;
  const existing = keychainGet(config.keychainService, account);
  if (existing) return { account, token: existing, created: false };
  const result = flyJson(authority, [
    'tokens', 'create', 'deploy',
    '--app', config.targetApp,
    '--name', `snapback hosted target ${config.targetApp} ${role}`,
    '--expiry', '8760h',
  ]);
  const token = result.token ?? result.Token;
  if (!token) throw new Error(`Fly did not return target ${role} token`);
  keychainPut(config.keychainService, account, token);
  return { account, token, created: true };
}

function ensureAdmissionSeed(config) {
  const account = `target-${config.targetApp}-admission-seed`;
  const existing = keychainGet(config.keychainService, account);
  if (existing) return { account, seed: existing, created: false };
  const seed = randomBytes(32).toString('base64url');
  keychainPut(config.keychainService, account, seed);
  return { account, seed, created: true };
}

function ensureTargetMtls(config) {
  const account = `target-${config.targetApp}-mtls-client`;
  const existing = keychainGet(config.keychainService, account);
  if (existing) return { ...JSON.parse(existing), account, created: false };
  const directory = mkdtempSync(join(tmpdir(), 'snapback-target-mtls.'));
  const key = join(directory, 'target-key.pem');
  const cert = join(directory, 'target-cert.pem');
  try {
    run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key], {
      redact: true,
    });
    chmodSync(key, 0o600);
    run('openssl', [
      'req', '-new', '-x509',
      '-key', key,
      '-out', cert,
      '-sha256',
      '-days', '90',
      '-subj', `/CN=${config.targetId}`,
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,digitalSignature,keyCertSign',
      '-addext', 'extendedKeyUsage=clientAuth',
    ], { redact: true });
    const value = {
      key: readFileSync(key, 'utf8'),
      cert: readFileSync(cert, 'utf8'),
    };
    keychainPut(config.keychainService, account, JSON.stringify(value));
    return { ...value, account, created: true };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function stageSecrets(token, app, values) {
  const input = Object.entries(values)
    .map(([name, value]) => `${name}=${Buffer.from(value).toString('base64')}`)
    .join('\n');
  run('fly', ['secrets', 'import', '--stage', '--app', app], {
    env: { FLY_API_TOKEN: token, NO_COLOR: '1' },
    input,
    redact: true,
  });
}

function supervisorCa(config) {
  const bundle = keychainGet(config.keychainService, 'mtls-client-bundle');
  if (!bundle) throw new Error('installed supervisor mTLS bundle is unavailable');
  const parsed = JSON.parse(bundle);
  if (typeof parsed.caCert !== 'string' || !parsed.caCert.includes('BEGIN CERTIFICATE')) {
    throw new Error('installed supervisor mTLS CA is invalid');
  }
  return parsed.caCert;
}

function legacyTigrisBootstrap(authority, config, machineId) {
  const idAccount = `target-${config.targetApp}-tigris-bootstrap-id`;
  const secretAccount = `target-${config.targetApp}-tigris-bootstrap-secret`;
  const existingId = keychainGet(config.keychainService, idAccount);
  const existingSecret = keychainGet(config.keychainService, secretAccount);
  if (existingId && existingSecret) {
    return {
      accessKeyId: existingId,
      secretAccessKey: existingSecret,
      extracted: false,
    };
  }
  if (existingId || existingSecret) {
    throw new Error('SNAPBACK_HOSTED_TARGET_TIGRIS_BOOTSTRAP_PARTIAL');
  }
  // The legacy target received the original bucket bootstrap credential as
  // Fly secrets. Capture it once into Keychain without printing it, then mint
  // narrow supervisor-held descendants. The successor never receives this
  // root credential.
  const result = run('fly', [
    'ssh', 'console',
    '--app', config.targetApp,
    '--machine', machineId,
    '--command', 'sh -lc \'printf "%s\\n%s\\n" "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY"\'',
  ], {
    env: { FLY_API_TOKEN: authority, NO_COLOR: '1' },
    redact: true,
  });
  const [accessKeyId, secretAccessKey, ...extra] = result.stdout.trim().split('\n');
  if (
    extra.length !== 0
    || !/^[A-Za-z0-9_-]{16,128}$/.test(accessKeyId ?? '')
    || typeof secretAccessKey !== 'string'
    || secretAccessKey.length < 24
    || secretAccessKey.length > 256
  ) {
    throw new Error('SNAPBACK_HOSTED_TARGET_TIGRIS_BOOTSTRAP_INVALID');
  }
  keychainPut(config.keychainService, idAccount, accessKeyId);
  keychainPut(config.keychainService, secretAccount, secretAccessKey);
  return { accessKeyId, secretAccessKey, extracted: true };
}

function tigrisIamClient(credentials) {
  return new IAMClient({
    endpoint: 'https://iam.storage.dev',
    region: 'auto',
    credentials,
  });
}

function tigrisS3Client(credentials) {
  return new S3Client({
    endpoint: 'https://t3.storage.dev',
    region: 'auto',
    forcePathStyle: true,
    credentials,
  });
}

export function targetRolePolicy(config, role, actions) {
  const prefix = `${config.tigrisPrefix}/${role}`;
  const objectPrefix = role === 'cleanup'
    ? `${config.tigrisPrefix}/*`
    : `${prefix}/*`;
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'ExactTargetPrefix',
        Effect: 'Allow',
        Action: actions.filter((action) => action !== 's3:ListBucket'),
        Resource: `arn:aws:s3:::${config.tigrisBucket}/${objectPrefix}`,
      },
      ...(actions.includes('s3:ListBucket') ? [{
        Sid: 'ExactTargetInventory',
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: `arn:aws:s3:::${config.tigrisBucket}`,
      }] : []),
    ].filter((statement) => statement.Action.length > 0),
  };
}

async function ensureTargetTigrisRole(rootCredentials, config, role, actions) {
  const roleStem = role.replaceAll(/[^a-z0-9-]/g, '-');
  const accountStem = `target-${config.targetApp}-tigris-${roleStem}`;
  const idAccount = `${accountStem}-id`;
  const secretAccount = `${accountStem}-secret`;
  const policyAccount = `${accountStem}-policy-arn`;
  let accessKeyId = keychainGet(config.keychainService, idAccount);
  let secretAccessKey = keychainGet(config.keychainService, secretAccount);
  let policyArn = keychainGet(config.keychainService, policyAccount);
  const policyVersion = role === 'cleanup' ? 'v2' : 'v1';
  const policyName = `snapback-target-${config.targetApp}-${roleStem}-${policyVersion}`;
  const predecessorPolicyArn = policyArn && !policyArn.endsWith(`/${policyName}`)
    ? policyArn
    : null;
  if (predecessorPolicyArn) policyArn = null;
  assertTargetTigrisCredentialPair(role, { accessKeyId, secretAccessKey });
  let created = false;
  const iam = tigrisIamClient(rootCredentials);
  if (!accessKeyId) {
    const createdKey = await iam.send(new CreateAccessKeyCommand({}));
    accessKeyId = createdKey.AccessKey?.AccessKeyId;
    secretAccessKey = createdKey.AccessKey?.SecretAccessKey;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(`Tigris did not return target ${role} credentials`);
    }
    keychainPut(config.keychainService, idAccount, accessKeyId);
    keychainPut(config.keychainService, secretAccount, secretAccessKey);
    created = true;
  }
  if (!policyArn) {
    try {
      const createdPolicy = await iam.send(new CreatePolicyCommand({
        PolicyName: policyName,
        PolicyDocument: JSON.stringify(targetRolePolicy(config, role, actions)),
        Description: `Snapback ${config.targetApp} hosted target ${role} role`,
      }));
      policyArn = createdPolicy.Policy?.Arn;
    } catch (error) {
      if (
        error?.name !== 'EntityAlreadyExistsException'
        && error?.name !== 'EntityAlreadyExists'
      ) {
        throw error;
      }
      const listed = await iam.send(new ListPoliciesCommand({ Scope: 'Local' }));
      policyArn = listed.Policies
        ?.find((candidate) => candidate.PolicyName === policyName)?.Arn;
    }
    if (!policyArn) throw new Error(`Tigris did not return target ${role} policy`);
  }
  await iam.send(new AttachUserPolicyCommand({
    PolicyArn: policyArn,
    UserName: accessKeyId,
  }));
  if (predecessorPolicyArn) {
    await iam.send(new DetachUserPolicyCommand({
      PolicyArn: predecessorPolicyArn,
      UserName: accessKeyId,
    }));
    await iam.send(new DeletePolicyCommand({
      PolicyArn: predecessorPolicyArn,
    }));
  }
  keychainPut(config.keychainService, policyAccount, policyArn);
  iam.destroy();
  return {
    role,
    accessKeyId,
    secretAccessKey,
    created,
    policyRotated: predecessorPolicyArn !== null,
  };
}

function accessDenied(error) {
  return error?.$metadata?.httpStatusCode === 403 || error?.name === 'AccessDenied';
}

async function proveTargetTigrisRoleIsolation(
  rootCredentials,
  config,
  credentialsByRole,
  sentinel,
) {
  const clients = [
    tigrisS3Client(rootCredentials),
    tigrisS3Client(credentialsByRole.cleanup),
  ];
  const [root, cleanup] = clients;
  const suffix = digestHex(sentinel).slice(0, 16);
  const keys = Object.fromEntries(
    Object.keys(credentialsByRole).map((role) => [
      role,
      `${config.tigrisPrefix}/${role}/onboarding-${suffix}.json`,
    ]),
  );
  const bodyForRole = (role) => canonicalJson({
    schemaVersion: 'snapback.hosted-target-role-proof.v1',
    targetId: config.targetId,
    role,
    sentinel,
  });
  const observations = [];
  try {
    for (const [role, key] of Object.entries(keys)) {
      await root.send(new PutObjectCommand({
        Bucket: config.tigrisBucket,
        Key: key,
        Body: bodyForRole(role),
        ContentType: 'application/json',
      }));
    }
    for (const [role, credential] of Object.entries(credentialsByRole)) {
      const client = tigrisS3Client(credential);
      clients.push(client);
      let ownPrefixReadBack = null;
      if (TARGET_TIGRIS_ROLES[role].includes('s3:GetObject')) {
        const ownRead = await client.send(new GetObjectCommand({
          Bucket: config.tigrisBucket,
          Key: keys[role],
        }));
        if (await ownRead.Body.transformToString() !== bodyForRole(role)) {
          throw new Error(`Tigris target ${role} own-prefix read-back drifted`);
        }
        ownPrefixReadBack = true;
      }
      const wrongRole = role === 'artifact' ? 'backup' : 'artifact';
      let wrongRoleDenied = false;
      try {
        await client.send(new GetObjectCommand({
          Bucket: config.tigrisBucket,
          Key: keys[wrongRole],
        }));
      } catch (error) {
        wrongRoleDenied = accessDenied(error);
      }
      if (!wrongRoleDenied) {
        throw new Error(`Tigris target ${role} credential crossed into ${wrongRole}`);
      }
      let writeDenied = null;
      if (role === 'cleanup' || !TARGET_TIGRIS_ROLES[role].includes('s3:PutObject')) {
        writeDenied = false;
        try {
          await client.send(new PutObjectCommand({
            Bucket: config.tigrisBucket,
            Key: `${config.tigrisPrefix}/${role}/forbidden-write-${suffix}.json`,
            Body: bodyForRole(role),
          }));
        } catch (error) {
          writeDenied = accessDenied(error);
        }
        if (!writeDenied) {
          throw new Error(`Tigris target ${role} unexpectedly gained write authority`);
        }
      }
      observations.push({
        role,
        ownPrefixReadBack,
        wrongRole,
        wrongRoleDenied: true,
        writeDenied,
      });
    }
    // Cleanup is deliberately broader than the data roles, but still lacks
    // creation authority. Prove that it can remove a target-owned object from
    // another role without gaining that role's read/write verbs.
    await cleanup.send(new DeleteObjectCommand({
      Bucket: config.tigrisBucket,
      Key: keys.artifact,
    }));
    let deleted = false;
    try {
      await root.send(new HeadObjectCommand({
        Bucket: config.tigrisBucket,
        Key: keys.artifact,
      }));
    } catch (error) {
      deleted = error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound';
    }
    if (!deleted) throw new Error('Tigris target cleanup did not remove artifact proof');
    const cleanupObservation = observations.find((item) => item.role === 'cleanup');
    cleanupObservation.crossPrefixDelete = true;
    await cleanup.send(new ListObjectsV2Command({
      Bucket: config.tigrisBucket,
      Prefix: `${config.tigrisPrefix}/`,
      MaxKeys: 10,
    }));
    cleanupObservation.targetPrefixInventory = true;
    // Tigris IAM currently rejects S3 prefix conditions in policy documents.
    // The cleanup credential is supervisor-only and its object verbs remain
    // target-prefix-scoped, but ListBucket itself is a custody-separated,
    // provider-wide capability. Retain this fact rather than claiming false
    // provider enforcement.
    cleanupObservation.listBucketProviderScope = 'bucket';
    cleanupObservation.listBucketCustodySeparated = true;
    return observations;
  } finally {
    await Promise.allSettled(
      Object.values(keys).map((key) => root.send(new DeleteObjectCommand({
        Bucket: config.tigrisBucket,
        Key: key,
      }))),
    );
    await Promise.allSettled(
      Object.keys(credentialsByRole).map((role) => root.send(new DeleteObjectCommand({
        Bucket: config.tigrisBucket,
        Key: `${config.tigrisPrefix}/${role}/forbidden-write-${suffix}.json`,
      }))),
    );
    for (const client of clients) client.destroy();
  }
}

function targetCertificateDer(certificatePem) {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-target-cert.'));
  const pem = join(directory, 'target.pem');
  const der = join(directory, 'target.der');
  try {
    // openssl reads the PEM from stdin, avoiding a shell interpolation.
    run('openssl', ['x509', '-outform', 'DER', '-out', der], {
      input: certificatePem,
      redact: true,
    });
    return readFileSync(der);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function buildTargetOnboardingPlan(options = {}) {
  const config = { ...TARGET_DEFAULTS, ...options };
  if (config.refusalBoundaryMicros > 3_000_000) {
    throw new Error('SNAPBACK_HOSTED_TARGET_SPEND_REFUSED');
  }
  const ownershipSentinel = `snapback:hosted-target:v2:${digestHex(canonicalJson({
    organization: config.organization,
    app: config.targetApp,
    region: config.region,
    targetId: config.targetId,
  })).slice(0, 24)}`;
  const content = {
    schemaVersion: TARGET_ONBOARDING_VERSION,
    config,
    ownershipSentinel,
    effects: [
      'mint target-scoped Fly control credential',
      'mint custody-separated target-scoped Fly registry credential',
      'generate supervisor-held Ed25519 admission signing seed',
      'generate dedicated target outbound mTLS client identity',
      'extract legacy Tigris bootstrap credential into Keychain without output',
      'mint six target-prefix Tigris roles',
      'prove own-prefix reads, wrong-role denials, delete-only cleanup, and the provider-wide cleanup inventory limit',
      'stage supervisor target credential projections',
      'stage successor-only outbound mTLS projections in the target app',
      'restart and read-back the standing supervisor only',
    ],
    forbiddenEffects: [
      'update legacy product Machine',
      'create or attach product volume',
      'change product route or certificate',
      'advertise hosted capability',
    ],
    refusalBoundaryMicros: config.refusalBoundaryMicros,
    providerEnforcedCap: false,
  };
  return {
    ...content,
    planSha256: sha256(Buffer.from(canonicalJson(content))),
  };
}

export async function applyTargetOnboarding(plan, { confirmationSha256 }) {
  if (confirmationSha256 !== plan.planSha256) {
    throw new Error('SNAPBACK_HOSTED_TARGET_CONFIRMATION_INVALID');
  }
  const config = { ...TARGET_DEFAULTS, ...plan.config };
  if (config.refusalBoundaryMicros > 3_000_000) {
    throw new Error('SNAPBACK_HOSTED_TARGET_SPEND_REFUSED');
  }
  const authority = flyTokenMintAuthority();
  const flyControl = mintTargetToken(authority, config, 'control');
  const flyRegistry = mintTargetToken(authority, config, 'registry');
  if (flyControl.token === flyRegistry.token) {
    throw new Error('SNAPBACK_HOSTED_TARGET_CREDENTIAL_SEPARATION_FAILED');
  }
  const admission = ensureAdmissionSeed(config);
  const targetMtls = ensureTargetMtls(config);
  const installedSupervisorCa = supervisorCa(config);
  const targetMachinesBefore = flyJson(authority, [
    'machines', 'list', '--app', config.targetApp,
  ]);
  if (!Array.isArray(targetMachinesBefore) || targetMachinesBefore.length !== 1) {
    throw new Error('SNAPBACK_HOSTED_TARGET_LEGACY_ROSTER_DRIFTED');
  }
  const tigrisBootstrap = legacyTigrisBootstrap(
    authority,
    config,
    targetMachinesBefore[0].id,
  );
  const tigrisRoles = {};
  for (const [role, actions] of Object.entries(TARGET_TIGRIS_ROLES)) {
    tigrisRoles[role] = await ensureTargetTigrisRole(
      {
        accessKeyId: tigrisBootstrap.accessKeyId,
        secretAccessKey: tigrisBootstrap.secretAccessKey,
      },
      config,
      role,
      actions,
    );
  }
  const tigrisRoleIsolation = await proveTargetTigrisRoleIsolation(
    {
      accessKeyId: tigrisBootstrap.accessKeyId,
      secretAccessKey: tigrisBootstrap.secretAccessKey,
    },
    config,
    tigrisRoles,
    plan.ownershipSentinel,
  );
  stageSecrets(authority, config.supervisorApp, {
    TARGET_SNAPBACK_DRILL_FLY_CONTROL_TOKEN: flyControl.token,
    TARGET_SNAPBACK_DRILL_FLY_REGISTRY_TOKEN: flyRegistry.token,
    TARGET_SNAPBACK_DRILL_ADMISSION_SEED: admission.seed,
    TARGET_SNAPBACK_DRILL_CLIENT_CA: targetMtls.cert,
    ...Object.fromEntries(
      Object.entries(tigrisRoles).flatMap(([role, credential]) => {
        const stem = role.replaceAll('-', '_').toUpperCase();
        return [
          [`TARGET_SNAPBACK_DRILL_TIGRIS_${stem}_ID`, credential.accessKeyId],
          [`TARGET_SNAPBACK_DRILL_TIGRIS_${stem}_SECRET`, credential.secretAccessKey],
        ];
      }),
    ),
  });
  const supervisorMachines = flyJson(authority, [
    'machines', 'list', '--app', config.supervisorApp,
  ]);
  if (!Array.isArray(supervisorMachines) || supervisorMachines.length !== 1) {
    throw new Error('SNAPBACK_HOSTED_TARGET_SUPERVISOR_ROSTER_UNSAFE');
  }
  const [supervisorMachineBefore] = supervisorMachines;
  const projectedPaths = new Set(
    (supervisorMachineBefore.config?.files ?? []).map((file) => file.guest_path),
  );
  const projectionDrift = TARGET_SUPERVISOR_SECRET_FILES
    .some(([guestPath]) => !projectedPaths.has(guestPath));
  if (projectionDrift) {
    run('fly', [
      'machine', 'update', supervisorMachineBefore.id,
      '--app', config.supervisorApp,
      ...[...BASE_SUPERVISOR_SECRET_FILES, ...TARGET_SUPERVISOR_SECRET_FILES]
        .flatMap(([guestPath, secretName]) => [
          '--file-secret', `${guestPath}=${secretName}`,
        ]),
      '--yes',
    ], {
      env: { FLY_API_TOKEN: authority, NO_COLOR: '1' },
      timeout: 180_000,
      redact: true,
    });
  }
  const supervisorMachinesAfter = flyJson(authority, [
    'machines', 'list', '--app', config.supervisorApp,
  ]);
  if (
    !Array.isArray(supervisorMachinesAfter)
    || supervisorMachinesAfter.length !== 1
    || supervisorMachinesAfter[0].id !== supervisorMachineBefore.id
  ) {
    throw new Error('SNAPBACK_HOSTED_TARGET_SUPERVISOR_READBACK_DRIFTED');
  }
  const [supervisorMachine] = supervisorMachinesAfter;
  const projectedPathsAfter = new Set(
    (supervisorMachine.config?.files ?? []).map((file) => file.guest_path),
  );
  if (
    [...BASE_SUPERVISOR_SECRET_FILES, ...TARGET_SUPERVISOR_SECRET_FILES]
      .some(([guestPath]) => !projectedPathsAfter.has(guestPath))
  ) {
    throw new Error('SNAPBACK_HOSTED_TARGET_SUPERVISOR_PROJECTION_INCOMPLETE');
  }
  stageSecrets(authority, config.targetApp, {
    SNAPBACK_SUPERVISOR_TARGET_CLIENT_KEY: targetMtls.key,
    SNAPBACK_SUPERVISOR_TARGET_CLIENT_CERT: targetMtls.cert,
    SNAPBACK_SUPERVISOR_SERVER_CA: installedSupervisorCa,
  });
  const targetMachines = flyJson(authority, [
    'machines', 'list', '--app', config.targetApp,
  ]);
  if (!Array.isArray(targetMachines) || targetMachines.length !== 1) {
    throw new Error('SNAPBACK_HOSTED_TARGET_LEGACY_ROSTER_DRIFTED');
  }
  const targetClientCertificateSha256 = certificateSha256(
    targetCertificateDer(targetMtls.cert),
  );
  const receipt = {
    schemaVersion: 'snapback.hosted-target-onboarding-receipt.v1',
    status: 'staged',
    targetId: config.targetId,
    deploymentId: config.deploymentId,
    publicOrigin: config.publicOrigin,
    ownershipSentinel: plan.ownershipSentinel,
    planSha256: plan.planSha256,
    supervisorMachineId: String(supervisorMachine.id),
    supervisorMachineVersion: String(supervisorMachine.instance_id),
    supervisorRestarted: projectionDrift,
    legacyMachineObservedOnly: String(targetMachines[0].id),
    legacyMachineUpdated: false,
    admissionPublicKey: publicKeyForSeed(admission.seed),
    targetClientCertificateSha256,
    credentials: {
      flyControl: sha256(Buffer.from(flyControl.token)),
      flyRegistry: sha256(Buffer.from(flyRegistry.token)),
      admissionSigning: sha256(Buffer.from(admission.seed)),
      outboundMtls: targetClientCertificateSha256,
      tigris: Object.fromEntries(
        Object.entries(tigrisRoles).map(([role, credential]) => [
          role,
          sha256(Buffer.from(`${credential.accessKeyId}\0${credential.secretAccessKey}`)),
        ]),
      ),
    },
    tigrisRoleIsolation,
    providerLimitations: {
      tigrisCleanupListBucket: {
        requestedScope: `${config.tigrisPrefix}/*`,
        enforcedScope: config.tigrisBucket,
        reason: 'Tigris IAM rejects S3 prefix policy conditions',
        mitigation: 'supervisor-only custody; exact-prefix object verbs; wrong-role negative tests',
      },
    },
    created: {
      flyControl: flyControl.created,
      flyRegistry: flyRegistry.created,
      admissionSigning: admission.created,
      outboundMtls: targetMtls.created,
      tigrisBootstrapExtracted: tigrisBootstrap.extracted,
      tigris: Object.fromEntries(
        Object.entries(tigrisRoles).map(([role, credential]) => [role, credential.created]),
      ),
      tigrisPoliciesRotated: Object.fromEntries(
        Object.entries(tigrisRoles)
          .map(([role, credential]) => [role, credential.policyRotated]),
      ),
    },
    capabilityAdvertised: false,
    blockers: [
      'fresh successor Machine and encrypted volume are not provisioned',
      'target binding and hosted target enrollment are not registered',
      'same-origin certificate transfer and route handoff have not run',
    ],
  };
  return {
    ...receipt,
    receiptSha256: sha256(Buffer.from(canonicalJson(receipt))),
  };
}

async function main() {
  const [command = 'plan', ...args] = process.argv.slice(2);
  const plan = buildTargetOnboardingPlan();
  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (command !== 'apply') {
    throw new Error('usage: target-onboarding.mjs [plan|apply --confirm <planSha256>]');
  }
  const confirmationIndex = args.indexOf('--confirm');
  const confirmationSha256 = confirmationIndex >= 0 ? args[confirmationIndex + 1] : null;
  const receipt = await applyTargetOnboarding(plan, { confirmationSha256 });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`target-onboarding: ${String(error?.message ?? error).slice(0, 512)}\n`);
    process.exitCode = 2;
  });
}
