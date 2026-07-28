#!/usr/bin/env node
// @ref LLP 0105#durable-spend-cleanup-and-credential-custody — installation
// effects are planned, digest-confirmed, sentinel-bound, and credentials are
// placed in provider/OS secret stores rather than receipts or argv output.
// @ref LLP 0105#one-fail-closed-hosted-authority-and-recoverable-supervisor —
// product journeys consume a pre-provisioned shared installation receipt.

import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  AttachUserPolicyCommand,
  CreateAccessKeyCommand,
  CreatePolicyCommand,
  IAMClient,
  ListPoliciesCommand,
} from '@aws-sdk/client-iam';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { canonicalJson, HostedSupervisor, sha256 } from './index.mjs';
import { readExternalAuthority } from './external-store.mjs';

export const BOOTSTRAP_VERSION = 'snapback.hosted-supervisor-bootstrap.v1';
export const TIGRIS_CLI = '@tigrisdata/cli@3.6.0';
export const DEFAULTS = Object.freeze({
  organization: 'personal',
  region: 'sjc',
  app: 'snapback-hosted-supervisor-sjc',
  bucket: 'snapback-hosted-supervisor-state',
  volumeName: 'supervisor_control',
  volumeSizeGb: 1,
  machineMemoryMb: 256,
  baseImage: 'node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d',
  keychainService: 'snapback-hosted-supervisor',
  bootstrapCredentialRef: 'keychain://snapback-fly-drill/drill',
});

export const SUPERVISOR_RUNTIME_CLOSURE = Object.freeze([
  'Dockerfile',
  'fly.supervisor.toml',
  'package.json',
  'index.mjs',
  'external-store.mjs',
  'hosted-edge-admission.mjs',
  'operator-authority.mjs',
  'operator-authority-transaction.mjs',
  'operator-service.mjs',
  'provider-credentials.mjs',
  'provider-executor.mjs',
  'supervisor-response.mjs',
  'service.mjs',
]);

export const TIGRIS_ROLES = Object.freeze({
  anchor: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
  'control-state': ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
  journal: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
  logs: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
  artifacts: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
  backups: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
  cleanup: ['s3:GetObject', 's3:DeleteObject'],
});

function digestHex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function ownershipSentinel(config = DEFAULTS) {
  return `snapback:hosted-supervisor:v1:${digestHex(canonicalJson({
    organization: config.organization,
    region: config.region,
    app: config.app,
    bucket: config.bucket,
  })).slice(0, 24)}`;
}

export function buildBootstrapPlan(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const sentinel = ownershipSentinel(config);
  const effects = [
    ['fly.app', config.app, 'create-if-absent'],
    ['fly.registry-image', config.app, 'build-and-push-content-addressed'],
    ['fly.volume', `${config.app}/${config.volumeName}`, 'create-encrypted-if-absent'],
    ['fly.machine', `${config.app}/shared-supervisor`, 'create-stopped-then-start-exact-one'],
    ['tigris.bucket', config.bucket, 'create-private-if-absent'],
    ['tigris.prefixes', Object.keys(TIGRIS_ROLES).sort().join(','), 'create-sentinel-objects'],
    ['fly.credentials', 'read,control,registry', 'mint-distinct-and-keychain-store'],
    ['tigris.credentials', Object.keys(TIGRIS_ROLES).sort().join(','), 'mint-prefix-policies-and-keychain-store'],
    ['mtls.credentials', 'installation-server,operator-client', 'mint-and-separate-custody'],
    ['supervisor.installation', config.app, 'launch-and-prove-health'],
  ].map(([kind, logicalName, desiredState], index) => ({
    semanticEffectId: sha256(Buffer.from(canonicalJson({
      version: BOOTSTRAP_VERSION,
      index,
      kind,
      logicalName,
      desiredState,
      sentinel,
    }))),
    kind,
    logicalName,
    desiredState,
  }));
  const tariffs = {
    currency: 'USD',
    observedAt: '2026-07-27',
    sources: [
      'https://fly.io/docs/about/pricing/',
      'https://www.tigrisdata.com/pricing/',
    ],
    components: [
      {
        name: 'compute',
        quantity: '1 shared-cpu-1x 256MB Machine, at most 730 hours/month',
        tariff: '0.0031 USD/hour conservative SJC published example ceiling',
        maximumMonthlyMicros: 2_263_000,
      },
      {
        name: 'persistentVolume',
        quantity: '1 encrypted GB',
        tariff: '0.15 USD/GB-month',
        maximumMonthlyMicros: 150_000,
      },
      {
        name: 'volumeSnapshots',
        quantity: 'at most 1 GB charged snapshot bytes',
        tariff: '0.08 USD/GB-month (first 10 GB currently free; allowance not assumed)',
        maximumMonthlyMicros: 80_000,
      },
      {
        name: 'objectStorage',
        quantity: 'at most 1 GB standard, 10,000 Class A and 100,000 Class B requests',
        tariff: '0.02 USD/GB-month + 0.005/1000 Class A + 0.0005/1000 Class B',
        maximumMonthlyMicros: 120_000,
      },
      {
        name: 'network',
        quantity: 'at most 1 GB public/cross-provider egress',
        tariff: '0.02 USD/GB North America',
        maximumMonthlyMicros: 20_000,
      },
      {
        name: 'tls',
        quantity: 'no public hostname/certificate; private mTLS only',
        tariff: '0',
        maximumMonthlyMicros: 0,
      },
    ],
    maximumMonthlyMicros: 2_633_000,
    refusalBoundaryMicros: 3_000_000,
    providerEnforcedCap: false,
  };
  const plan = {
    schemaVersion: BOOTSTRAP_VERSION,
    mode: 'shared-preprovisioned-installation',
    config: {
      organization: config.organization,
      region: config.region,
      app: config.app,
      bucket: config.bucket,
      volumeName: config.volumeName,
      volumeSizeGb: config.volumeSizeGb,
      machineMemoryMb: config.machineMemoryMb,
      baseImage: config.baseImage,
      keychainService: config.keychainService,
      bootstrapCredentialRef: config.bootstrapCredentialRef,
    },
    ownershipSentinel: sentinel,
    effects,
    credentials: {
      fly: {
        read: 'org-readonly-provider-enforced',
        control: 'app-deploy-provider-enforced',
        registry: 'app-deploy-custody-separated',
      },
      tigris: Object.fromEntries(
        Object.keys(TIGRIS_ROLES).sort().map((role) => [
          role,
          `provider-enforced:${config.bucket}/snapback-supervisor/${role}/*`,
        ]),
      ),
      bootstrap: 'standing root only for installation/recovery; never target/application custody',
    },
    tariffs,
    nonclaims: [
      'Fly has no provider-enforced billing ceiling or alert for this installation',
      'registry and Fly control tokens share provider scope but have distinct custody and fingerprints',
      'the installation is single-instance and is not an HA control plane',
      'operator response-purpose custody, public listener proof, and all lifecycle operations remain disabled until a packed live closure receipt exists',
    ],
  };
  return {
    ...plan,
    planSha256: sha256(Buffer.from(canonicalJson(plan))),
  };
}

function run(command, args, {
  env = {},
  input = undefined,
  allowStatus = [0],
  redact = false,
} = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowStatus.includes(result.status)) {
    const rawDetail = `${result.stderr || (redact ? '' : result.stdout) || `status ${result.status}`}`
      .trim()
      .slice(0, 1200);
    const detail = redact
      ? rawDetail
        .replaceAll(/(?:fm2|fo1|FlyV1|tid|tsec)_[A-Za-z0-9._-]+/g, '[redacted-credential]')
        .replaceAll(/(AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY):\s*)\S+/g, '$1[redacted]')
      : rawDetail;
    throw new Error(`${command} failed: ${detail}`);
  }
  return result;
}

function keychainGet(service, account, required = false) {
  const result = run(
    'security',
    ['find-generic-password', '-s', service, '-a', account, '-w'],
    { allowStatus: [0, 44], redact: true },
  );
  const value = result.status === 0 ? result.stdout.trim() : null;
  if (required && !value) throw new Error(`missing Keychain handle ${service}/${account}`);
  return value;
}

function keychainPut(service, account, value) {
  run(
    'security',
    ['add-generic-password', '-U', '-s', service, '-a', account, '-w', value],
    { redact: true },
  );
}

function bootstrapFlyToken(config) {
  const reference = new URL(config.bootstrapCredentialRef);
  if (reference.protocol !== 'keychain:') throw new Error('bootstrap credential must be a keychain handle');
  return keychainGet(reference.hostname, reference.pathname.slice(1), true);
}

function flyTokenMintAuthority() {
  // Fly org/deploy tokens can manage resources but the provider refuses
  // CreateLimitedAccessToken for them. Use the already-authenticated operator
  // session only to mint narrower standing roles; the returned root bearer is
  // neither stored by this bootstrap nor admitted to the supervisor Machine.
  const result = run('fly', ['auth', 'token'], { redact: true });
  const token = result.stdout.trim();
  if (!token) throw new Error('Fly operator session did not return token-mint authority');
  return token;
}

async function providerJson(path, token, { method = 'GET', body = undefined } = {}) {
  const response = await fetch(`https://api.machines.dev/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, ok: response.ok, json };
}

function flyJson(token, args) {
  const result = run('fly', [...args, '--json'], {
    env: { FLY_API_TOKEN: token, NO_COLOR: '1' },
    redact: true,
  });
  return JSON.parse(result.stdout);
}

function mintFlyToken(rootToken, config, role, args) {
  const account = `fly-${role}`;
  const existing = keychainGet(config.keychainService, account);
  if (existing) return { account, token: existing, created: false };
  const json = flyJson(rootToken, [
    'tokens', 'create', ...args,
    '--name', `snapback hosted supervisor ${role}`,
    '--expiry', '8760h',
  ]);
  const token = json.token ?? json.Token;
  if (!token) throw new Error(`Fly did not return a ${role} token`);
  keychainPut(config.keychainService, account, token);
  return { account, token, created: true };
}

function parseTigrisCreate(output) {
  const values = {};
  for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
    const match = output.match(new RegExp(`${name}:\\s*([^\\s]+)`));
    if (!match) throw new Error(`fly storage create omitted ${name}`);
    values[name] = match[1];
  }
  return values;
}

function tigrisIamClient(credentials) {
  return new IAMClient({
    endpoint: 'https://iam.storage.dev',
    region: 'auto',
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

function tigrisS3Client(credentials) {
  return new S3Client({
    endpoint: 'https://t3.storage.dev',
    region: 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

function ensureTigrisBucket(rootToken, config) {
  const rootIdAccount = 'tigris-bootstrap-access-key-id';
  const rootSecretAccount = 'tigris-bootstrap-secret-access-key';
  const existingId = keychainGet(config.keychainService, rootIdAccount);
  const existingSecret = keychainGet(config.keychainService, rootSecretAccount);
  if (existingId && existingSecret) {
    return { accessKeyId: existingId, secretAccessKey: existingSecret, created: false };
  }
  if (existingId || existingSecret) throw new Error('partial Tigris bootstrap credential in Keychain');
  const result = run('fly', [
    'storage', 'create',
    '--name', config.bucket,
    '--org', config.organization,
    '--yes',
  ], {
    env: { FLY_API_TOKEN: rootToken, NO_COLOR: '1' },
    redact: true,
  });
  const parsed = parseTigrisCreate(`${result.stdout}\n${result.stderr}`);
  keychainPut(config.keychainService, rootIdAccount, parsed.AWS_ACCESS_KEY_ID);
  keychainPut(config.keychainService, rootSecretAccount, parsed.AWS_SECRET_ACCESS_KEY);
  return {
    accessKeyId: parsed.AWS_ACCESS_KEY_ID,
    secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
    created: true,
  };
}

function makeRolePolicy(config, role, actions) {
  const prefix = `snapback-supervisor/${role}`;
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'ObjectPrefix',
        Effect: 'Allow',
        Action: actions,
        Resource: `arn:aws:s3:::${config.bucket}/${prefix}/*`,
      },
      {
        Sid: 'CleanupInventory',
        Effect: 'Allow',
        Action: role === 'cleanup' ? ['s3:ListBucket'] : [],
        Resource: `arn:aws:s3:::${config.bucket}`,
      },
    ].filter((statement) => statement.Action.length > 0),
  };
}

async function ensureTigrisRole(rootCredentials, config, role, actions) {
  const idAccount = `tigris-${role}-access-key-id`;
  const secretAccount = `tigris-${role}-secret-access-key`;
  const existingId = keychainGet(config.keychainService, idAccount);
  const existingSecret = keychainGet(config.keychainService, secretAccount);
  const configuredAccount = `tigris-${role}-configured-policy-arn`;
  const existingPolicyArn = keychainGet(config.keychainService, configuredAccount);
  if (existingId && existingSecret && existingPolicyArn) {
    return { role, accessKeyId: existingId, secretAccessKey: existingSecret, created: false };
  }
  if (Boolean(existingId) !== Boolean(existingSecret)) {
    throw new Error(`partial Tigris ${role} credential in Keychain`);
  }
  const roleSlug = role.replaceAll(/[^a-z0-9-]/g, '-');
  let accessKeyId = existingId;
  let secretAccessKey = existingSecret;
  let created = false;
  if (!accessKeyId && !secretAccessKey) {
    const keyResult = await tigrisIamClient(rootCredentials).send(
      new CreateAccessKeyCommand({}),
    );
    accessKeyId = keyResult.AccessKey?.AccessKeyId;
    secretAccessKey = keyResult.AccessKey?.SecretAccessKey;
    if (!accessKeyId || !secretAccessKey) throw new Error(`Tigris did not return ${role} access key bytes`);
    // Retain the one-time secret before any later provider effect so an
    // interrupted policy attachment resumes without leaking or orphaning it.
    keychainPut(config.keychainService, idAccount, accessKeyId);
    keychainPut(config.keychainService, secretAccount, secretAccessKey);
    created = true;
  }
  const policy = makeRolePolicy(config, role, actions);
  let policyArn = existingPolicyArn;
  if (!policyArn) {
    const policyName = `snapback-supervisor-${roleSlug}-v1`;
    try {
      const policyResult = await tigrisIamClient(rootCredentials).send(
        new CreatePolicyCommand({
          PolicyName: policyName,
          PolicyDocument: JSON.stringify(policy),
          Description: `Snapback hosted supervisor ${role} prefix role`,
        }),
      );
      policyArn = policyResult.Policy?.Arn;
    } catch (error) {
      if (error?.name !== 'EntityAlreadyExistsException' && error?.name !== 'EntityAlreadyExists') throw error;
      const listed = await tigrisIamClient(rootCredentials).send(new ListPoliciesCommand({
        Scope: 'Local',
      }));
      policyArn = listed.Policies?.find((candidate) => candidate.PolicyName === policyName)?.Arn;
    }
  }
  if (!policyArn) throw new Error(`Tigris did not return ${role} policy ARN`);
  await tigrisIamClient(rootCredentials).send(new AttachUserPolicyCommand({
    PolicyArn: policyArn,
    UserName: accessKeyId,
  }));
  keychainPut(config.keychainService, configuredAccount, policyArn);
  return { role, accessKeyId, secretAccessKey, created, policyArn };
}

async function proveTigrisRoleIsolation(config, credentialsByRole, sentinel) {
  const observations = [];
  for (const [role, credential] of Object.entries(credentialsByRole)) {
    if (role === 'cleanup') continue;
    const ownKey = `snapback-supervisor/${role}/bootstrap-${sentinel.slice(-12)}.json`;
    const wrongRole = role === 'anchor' ? 'journal' : 'anchor';
    const wrongKey = `snapback-supervisor/${wrongRole}/wrong-role-${sentinel.slice(-12)}.json`;
    const client = tigrisS3Client(credential);
    const body = JSON.stringify({ sentinel, role });
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: ownKey,
      Body: body,
      ContentType: 'application/json',
    }));
    const read = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: ownKey }));
    const roundTrip = await read.Body.transformToString();
    if (roundTrip !== body) throw new Error(`Tigris ${role} read-back drifted`);
    let wrongRoleDenied = false;
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: wrongKey,
        Body: body,
      }));
    } catch (error) {
      wrongRoleDenied = error?.$metadata?.httpStatusCode === 403 || error?.name === 'AccessDenied';
    }
    if (!wrongRoleDenied) throw new Error(`Tigris ${role} credential crossed into ${wrongRole} prefix`);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: ownKey }));
    observations.push({
      role,
      ownPrefixRoundTrip: true,
      wrongRole,
      wrongRoleDenied: true,
    });
  }
  return observations;
}

async function getObjectText(client, bucket, key) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return result.Body.transformToString();
}

async function putImmutableOrVerify({ client, bucket, key, body }) {
  try {
    const result = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
    return { created: true, etag: result.ETag ?? null };
  } catch (error) {
    const precondition = error?.$metadata?.httpStatusCode === 412 || error?.name === 'PreconditionFailed';
    if (!precondition) throw error;
    const retained = await getObjectText(client, bucket, key);
    if (retained !== body) throw new Error(`immutable Tigris object drifted: ${key}`);
    return { created: false, etag: error?.$metadata?.requestId ?? null };
  }
}

async function initializeExternalAuthority(config, roles, installationReceipt) {
  const supervisor = new HostedSupervisor({
    installationReceipt,
    incarnation: installationReceipt.incarnation,
  });
  const mirror = {
    schemaVersion: 'snapback.hosted-supervisor-mirror.v1',
    installationId: installationReceipt.installationId,
    incarnation: installationReceipt.incarnation,
    generation: 0,
    database: supervisor.database,
    journalDigest: supervisor.anchor.journalDigest,
    controlHeadDigest: supervisor.anchor.controlHeadDigest,
  };
  const mirrorBody = canonicalJson(mirror);
  const mirrorSha256 = sha256(Buffer.from(mirrorBody));
  const mirrorKey = `snapback-supervisor/journal/generation-000000000000-${mirrorSha256.slice(7)}.json`;
  const mirrorResult = await putImmutableOrVerify({
    client: tigrisS3Client(roles.journal),
    bucket: config.bucket,
    key: mirrorKey,
    body: mirrorBody,
  });
  const anchor = {
    schemaVersion: 'snapback.hosted-supervisor-incarnation-anchor.v1',
    installationId: installationReceipt.installationId,
    ownershipSentinel: installationReceipt.ownershipSentinel,
    incarnation: installationReceipt.incarnation,
    generation: 0,
    mirrorKey,
    mirrorSha256,
    journalDigest: supervisor.anchor.journalDigest,
    spendFloor: 0,
    cleanupFloor: 0,
    replayFloor: 0,
    controlHeadDigest: supervisor.anchor.controlHeadDigest,
  };
  const anchorBody = canonicalJson(anchor);
  const anchorClient = tigrisS3Client(roles.anchor);
  const journalClient = tigrisS3Client(roles.journal);
  let retainedAnchor = null;
  try {
    retainedAnchor = await getObjectText(
      anchorClient,
      config.bucket,
      'snapback-supervisor/anchor/incarnation.json',
    );
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NoSuchKey') throw error;
  }
  let anchorResult = { created: false };
  if (retainedAnchor === null) {
    anchorResult = await putImmutableOrVerify({
      client: anchorClient,
      bucket: config.bucket,
      key: 'snapback-supervisor/anchor/incarnation.json',
      body: anchorBody,
    });
    retainedAnchor = anchorBody;
  }
  if (retainedAnchor !== anchorBody) {
    const current = await readExternalAuthority({
      installationReceipt: {
        ...installationReceipt,
        externalAnchor: `s3://${config.bucket}/snapback-supervisor/anchor/incarnation.json`,
        externalAnchorSha256: sha256(Buffer.from(anchorBody)),
        journalMirror: `s3://${config.bucket}/${mirrorKey}`,
        journalMirrorSha256: mirrorSha256,
      },
      anchorClient,
      journalClient,
    });
    return {
      anchor: current.anchor,
      anchorSha256: current.anchorSha256,
      rootAnchorSha256: sha256(Buffer.from(anchorBody)),
      mirrorKey: current.anchor.mirrorKey,
      mirrorSha256: current.mirrorSha256,
      anchorCreated: false,
      mirrorCreated: mirrorResult.created,
      readBackVerified: true,
      chainVerified: true,
    };
  }
  const retainedMirror = await getObjectText(
    journalClient,
    config.bucket,
    mirrorKey,
  );
  if (retainedAnchor !== anchorBody || sha256(Buffer.from(retainedMirror)) !== mirrorSha256) {
    throw new Error('Tigris external authority read-back failed');
  }
  return {
    anchor,
    anchorSha256: sha256(Buffer.from(anchorBody)),
    rootAnchorSha256: sha256(Buffer.from(anchorBody)),
    mirrorKey,
    mirrorSha256,
    anchorCreated: anchorResult.created,
    mirrorCreated: mirrorResult.created,
    readBackVerified: true,
  };
}

function generateMtls(config, sentinel) {
  const existing = keychainGet(config.keychainService, 'mtls-client-bundle');
  if (existing) {
    const parsed = JSON.parse(existing);
    if (
      parsed.algorithm === 'P-256-SHA256'
      && parsed.serverKey
      && parsed.serverCert
      && parsed.caCert
      && parsed.clientKey
      && parsed.clientCert
    ) {
      return { ...parsed, created: false };
    }
  }
  const directory = mkdtempSync(join(tmpdir(), 'snapback-supervisor-mtls.'));
  const files = Object.fromEntries(
    ['caKey', 'caCert', 'serverKey', 'serverCsr', 'serverCert', 'clientKey', 'clientCsr', 'clientCert']
      .map((name) => [name, join(directory, `${name}.pem`)]),
  );
  try {
    run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', files.caKey], { redact: true });
    run('openssl', [
      'req', '-x509', '-new', '-key', files.caKey, '-out', files.caCert,
      '-sha256', '-days', '365', '-subj', `/CN=${config.app}-ca`,
    ], { redact: true });
    run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', files.serverKey], { redact: true });
    run('openssl', [
      'req', '-new', '-key', files.serverKey, '-out', files.serverCsr,
      '-subj', `/CN=${config.app}.internal`,
    ], { redact: true });
    run('openssl', [
      'x509', '-req', '-in', files.serverCsr, '-CA', files.caCert, '-CAkey', files.caKey,
      '-CAcreateserial', '-out', files.serverCert, '-sha256', '-days', '365',
    ], { redact: true });
    run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', files.clientKey], { redact: true });
    run('openssl', [
      'req', '-new', '-key', files.clientKey, '-out', files.clientCsr,
      '-subj', `/CN=snapback-operator-${sentinel.slice(-12)}`,
    ], { redact: true });
    run('openssl', [
      'x509', '-req', '-in', files.clientCsr, '-CA', files.caCert, '-CAkey', files.caKey,
      '-CAcreateserial', '-out', files.clientCert, '-sha256', '-days', '365',
    ], { redact: true });
    const bundle = {
      algorithm: 'P-256-SHA256',
      caCert: readFileSync(files.caCert, 'utf8'),
      serverKey: readFileSync(files.serverKey, 'utf8'),
      serverCert: readFileSync(files.serverCert, 'utf8'),
      clientKey: readFileSync(files.clientKey, 'utf8'),
      clientCert: readFileSync(files.clientCert, 'utf8'),
      fingerprints: {
        ca: sha256(readFileSync(files.caCert)),
        server: sha256(readFileSync(files.serverCert)),
        client: sha256(readFileSync(files.clientCert)),
      },
    };
    keychainPut(config.keychainService, 'mtls-client-bundle', JSON.stringify(bundle));
    return { ...bundle, created: true };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function stageSecrets(rootToken, config, values) {
  const input = Object.entries(values)
    .map(([name, value]) => `${name}=${Buffer.from(value).toString('base64')}`)
    .join('\n');
  run('fly', ['secrets', 'import', '--stage', '--app', config.app], {
    env: { FLY_API_TOKEN: rootToken, NO_COLOR: '1' },
    input,
    redact: true,
  });
}

async function ensureApp(rootToken, config, sentinel) {
  const app = await providerJson(`/apps/${config.app}`, rootToken);
  if (app.status === 404) {
    flyJson(rootToken, ['apps', 'create', config.app, '--org', config.organization]);
    keychainPut(config.keychainService, 'fly-app-ownership-sentinel', sentinel);
    return { created: true };
  }
  if (!app.ok) throw new Error(`Fly app read failed (${app.status})`);
  const machines = await providerJson(`/apps/${config.app}/machines`, rootToken);
  if (!machines.ok) throw new Error(`Fly Machine inventory failed (${machines.status})`);
  if (
    machines.json.length === 0
    && keychainGet(config.keychainService, 'fly-app-ownership-sentinel') !== sentinel
  ) {
    throw new Error(`existing empty app ${config.app} has no local ownership sentinel`);
  }
  for (const machine of machines.json) {
    if (machine.config?.metadata?.snapback_ownership_sentinel !== sentinel) {
      throw new Error(`existing app ${config.app} contains a foreign Machine`);
    }
  }
  return { created: false, machines: machines.json };
}

function buildImage(rootToken, config) {
  const packageDir = dirname(fileURLToPath(import.meta.url));
  const runtimeClosure = SUPERVISOR_RUNTIME_CLOSURE
    .map((name) => [name, readFileSync(join(packageDir, name), 'utf8')]);
  const label = `supervisor-${digestHex(canonicalJson(runtimeClosure)).slice(0, 16)}`;
  run('fly', [
    'deploy', packageDir,
    '--app', config.app,
    '--config', join(packageDir, 'fly.supervisor.toml'),
    '--dockerfile', join(packageDir, 'Dockerfile'),
    '--build-only', '--push', '--remote-only', '--depot=true',
    '--image-label', label,
    '--no-public-ips',
  ], {
    env: { FLY_API_TOKEN: rootToken, NO_COLOR: '1' },
    redact: true,
  });
  return `registry.fly.io/${config.app}:${label}`;
}

async function ensureVolume(rootToken, config) {
  const volumes = await providerJson(`/apps/${config.app}/volumes`, rootToken);
  if (!volumes.ok) throw new Error(`Fly volume inventory failed (${volumes.status})`);
  const matching = volumes.json.filter((volume) => volume.name === config.volumeName);
  if (matching.length > 1) throw new Error('duplicate supervisor volumes refuse');
  if (matching.length === 1) {
    const [volume] = matching;
    if (volume.region !== config.region || volume.size_gb !== config.volumeSizeGb || !volume.encrypted) {
      throw new Error('existing supervisor volume does not match the plan');
    }
    return { volume, created: false };
  }
  const created = await providerJson(`/apps/${config.app}/volumes`, rootToken, {
    method: 'POST',
    body: {
      name: config.volumeName,
      region: config.region,
      size_gb: config.volumeSizeGb,
      encrypted: true,
      snapshot_retention: 5,
      auto_backup_enabled: true,
    },
  });
  if (!created.ok) throw new Error(`Fly volume create failed (${created.status})`);
  return { volume: created.json, created: true };
}

async function ensureMachine(rootToken, config, sentinel, image, volume, installationReceipt) {
  const machines = await providerJson(`/apps/${config.app}/machines`, rootToken);
  if (!machines.ok) throw new Error(`Fly Machine inventory failed (${machines.status})`);
  if (machines.json.length > 1) throw new Error('shared supervisor requires exactly one Machine');
  if (machines.json.length === 1) {
    let [machine] = machines.json;
    if (machine.config?.metadata?.snapback_ownership_sentinel !== sentinel) {
      throw new Error('existing supervisor Machine has no exact ownership sentinel');
    }
    const requiredSecretFiles = [
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
    ];
    const existingGuestPaths = new Set((machine.config?.files ?? []).map((file) => file.guest_path));
    const secretProjectionDrift = requiredSecretFiles.some(([guestPath]) => !existingGuestPaths.has(guestPath));
    if (machine.config?.image !== image || secretProjectionDrift) {
      run('fly', [
        'machine', 'update', machine.id,
        '--app', config.app,
        '--image', image,
        ...requiredSecretFiles.flatMap(([guestPath, secretName]) => [
          '--file-secret', `${guestPath}=${secretName}`,
        ]),
        '--skip-start',
        '--yes',
      ], {
        env: { FLY_API_TOKEN: rootToken, NO_COLOR: '1' },
        redact: true,
      });
      const refreshed = await providerJson(`/apps/${config.app}/machines/${machine.id}`, rootToken);
      if (!refreshed.ok) throw new Error(`Fly Machine image read-back failed (${refreshed.status})`);
      machine = refreshed.json;
    }
    return { machine, created: false };
  }
  const receiptBase64 = Buffer.from(JSON.stringify(installationReceipt)).toString('base64');
  const created = await providerJson(`/apps/${config.app}/machines`, rootToken, {
    method: 'POST',
    body: {
      name: 'shared-supervisor',
      region: config.region,
      skip_launch: true,
      skip_service_registration: true,
      config: {
        image,
        guest: {
          cpu_kind: 'shared',
          cpus: 1,
          memory_mb: config.machineMemoryMb,
        },
        metadata: {
          snapback_ownership_sentinel: sentinel,
          snapback_installation_plan: installationReceipt.planSha256,
          snapback_role: 'shared-hosted-supervisor',
        },
        mounts: [{ volume: volume.id, path: '/data' }],
        restart: { policy: 'always' },
        env: {
          SNAPBACK_SUPERVISOR_INSTALLATION_RECEIPT: '/run/installation-receipt.json',
        },
        files: [
          { guest_path: '/run/installation-receipt.json', raw_value: receiptBase64 },
          { guest_path: '/run/secrets/fly-read-token', secret_name: 'SUPERVISOR_FLY_READ_TOKEN' },
          { guest_path: '/run/secrets/fly-control-token', secret_name: 'SUPERVISOR_FLY_CONTROL_TOKEN' },
          { guest_path: '/run/secrets/fly-registry-token', secret_name: 'SUPERVISOR_FLY_REGISTRY_TOKEN' },
          { guest_path: '/run/secrets/server-key.pem', secret_name: 'SUPERVISOR_SERVER_KEY' },
          { guest_path: '/run/secrets/server-cert.pem', secret_name: 'SUPERVISOR_SERVER_CERT' },
          { guest_path: '/run/secrets/client-ca.pem', secret_name: 'SUPERVISOR_CLIENT_CA' },
          { guest_path: '/run/secrets/tigris-anchor-id', secret_name: 'SUPERVISOR_TIGRIS_ANCHOR_ID' },
          { guest_path: '/run/secrets/tigris-anchor-secret', secret_name: 'SUPERVISOR_TIGRIS_ANCHOR_SECRET' },
          { guest_path: '/run/secrets/tigris-control-id', secret_name: 'SUPERVISOR_TIGRIS_CONTROL_ID' },
          { guest_path: '/run/secrets/tigris-control-secret', secret_name: 'SUPERVISOR_TIGRIS_CONTROL_SECRET' },
          { guest_path: '/run/secrets/tigris-journal-id', secret_name: 'SUPERVISOR_TIGRIS_JOURNAL_ID' },
          { guest_path: '/run/secrets/tigris-journal-secret', secret_name: 'SUPERVISOR_TIGRIS_JOURNAL_SECRET' },
        ],
      },
    },
  });
  if (!created.ok) throw new Error(`Fly Machine create failed (${created.status})`);
  return { machine: created.json, created: true };
}

async function startMachine(rootToken, config, machine) {
  if (machine.state === 'started') return machine;
  if (machine.state === 'created') {
    const prepared = await fetch(
      `https://api.machines.dev/v1/apps/${config.app}/machines/${machine.id}/wait?state=stopped&timeout=60`,
      {
        headers: { authorization: `Bearer ${rootToken}` },
        signal: AbortSignal.timeout(70_000),
      },
    );
    if (!prepared.ok) throw new Error(`Fly Machine did not become startable (${prepared.status})`);
  }
  run('fly', ['machine', 'start', machine.id, '--app', config.app], {
    env: { FLY_API_TOKEN: rootToken, NO_COLOR: '1' },
    redact: true,
  });
  const wait = await fetch(
    `https://api.machines.dev/v1/apps/${config.app}/machines/${machine.id}/wait?state=started&timeout=60`,
    {
      headers: { authorization: `Bearer ${rootToken}` },
      signal: AbortSignal.timeout(70_000),
    },
  );
  if (!wait.ok) throw new Error(`Fly Machine did not start (${wait.status})`);
  return (await providerJson(`/apps/${config.app}/machines/${machine.id}`, rootToken)).json;
}

function credentialFingerprint(value) {
  return `sha256:${digestHex(value)}`;
}

function stableInstallationIncarnation(config) {
  const account = 'installation-incarnation';
  const existing = keychainGet(config.keychainService, account);
  if (existing) return existing;
  const created = randomUUID();
  keychainPut(config.keychainService, account, created);
  return created;
}

export async function applyBootstrap(plan, { confirmationSha256 }) {
  if (confirmationSha256 !== plan.planSha256) {
    throw new Error('SNAPBACK_SUPERVISOR_BOOTSTRAP_CONFIRMATION_INVALID');
  }
  const config = { ...DEFAULTS, ...plan.config };
  if (plan.tariffs.refusalBoundaryMicros > 3_000_000) {
    throw new Error('SNAPBACK_SUPERVISOR_BOOTSTRAP_SPEND_REFUSED');
  }
  const rootToken = bootstrapFlyToken(config);
  const appResult = await ensureApp(rootToken, config, plan.ownershipSentinel);
  const mintAuthority = flyTokenMintAuthority();
  const flyRead = mintFlyToken(mintAuthority, config, 'read', [
    'readonly', '--org', config.organization, '--from-existing',
  ]);
  const flyControl = mintFlyToken(mintAuthority, config, 'control', [
    'deploy', '--app', config.app,
  ]);
  const flyRegistry = mintFlyToken(mintAuthority, config, 'registry', [
    'deploy', '--app', config.app,
  ]);
  const tigrisRoot = ensureTigrisBucket(rootToken, config);
  const tigrisRoles = {};
  for (const [role, actions] of Object.entries(TIGRIS_ROLES)) {
    tigrisRoles[role] = await ensureTigrisRole(tigrisRoot, config, role, actions);
  }
  const tigrisIsolation = await proveTigrisRoleIsolation(
    config,
    Object.fromEntries(
      Object.entries(tigrisRoles).map(([role, value]) => [role, {
        accessKeyId: value.accessKeyId,
        secretAccessKey: value.secretAccessKey,
      }]),
    ),
    plan.ownershipSentinel,
  );
  const mtls = generateMtls(config, plan.ownershipSentinel);
  stageSecrets(rootToken, config, {
    SUPERVISOR_FLY_READ_TOKEN: flyRead.token,
    SUPERVISOR_FLY_CONTROL_TOKEN: flyControl.token,
    SUPERVISOR_FLY_REGISTRY_TOKEN: flyRegistry.token,
    SUPERVISOR_SERVER_KEY: mtls.serverKey,
    SUPERVISOR_SERVER_CERT: mtls.serverCert,
    SUPERVISOR_CLIENT_CA: mtls.caCert,
    SUPERVISOR_TIGRIS_ANCHOR_ID: tigrisRoles.anchor.accessKeyId,
    SUPERVISOR_TIGRIS_ANCHOR_SECRET: tigrisRoles.anchor.secretAccessKey,
    SUPERVISOR_TIGRIS_CONTROL_ID: tigrisRoles['control-state'].accessKeyId,
    SUPERVISOR_TIGRIS_CONTROL_SECRET: tigrisRoles['control-state'].secretAccessKey,
    SUPERVISOR_TIGRIS_JOURNAL_ID: tigrisRoles.journal.accessKeyId,
    SUPERVISOR_TIGRIS_JOURNAL_SECRET: tigrisRoles.journal.secretAccessKey,
  });
  const image = buildImage(rootToken, config);
  const volumeResult = await ensureVolume(rootToken, config);
  const incarnation = stableInstallationIncarnation(config);
  const installationReceiptBase = {
    schemaVersion: 'snapback.hosted-supervisor-installation-receipt.v1',
    installationId: `shared:${config.organization}:${config.region}:${config.app}`,
    standingRootAuthorizationSha256: credentialFingerprint(rootToken),
    ownershipSentinel: plan.ownershipSentinel,
    planSha256: plan.planSha256,
    app: config.app,
    organization: config.organization,
    region: config.region,
    bucket: config.bucket,
    volumeId: volumeResult.volume.id,
    image,
    incarnation,
    externalAnchor: `s3://${config.bucket}/snapback-supervisor/anchor/incarnation.json`,
    journalMirror: `s3://${config.bucket}/snapback-supervisor/journal/`,
    controlStatePrefix: `s3://${config.bucket}/snapback-supervisor/control-state/`,
    tariffAllocation: 'measured-active-ms-and-stored-bytes',
    credentials: {
      flyRead: credentialFingerprint(flyRead.token),
      flyControl: credentialFingerprint(flyControl.token),
      flyRegistry: credentialFingerprint(flyRegistry.token),
      tigris: Object.fromEntries(
        Object.entries(tigrisRoles).map(([role, credential]) => [
          role,
          credentialFingerprint(`${credential.accessKeyId}\0${credential.secretAccessKey}`),
        ]),
      ),
      mtls: mtls.fingerprints,
    },
  };
  const externalAuthority = await initializeExternalAuthority(
    config,
    Object.fromEntries(
      Object.entries(tigrisRoles).map(([role, value]) => [role, {
        accessKeyId: value.accessKeyId,
        secretAccessKey: value.secretAccessKey,
      }]),
    ),
    installationReceiptBase,
  );
  installationReceiptBase.journalMirror = `s3://${config.bucket}/${externalAuthority.mirrorKey}`;
  installationReceiptBase.externalAnchorSha256 = externalAuthority.rootAnchorSha256;
  installationReceiptBase.journalMirrorSha256 = externalAuthority.mirrorSha256;
  const machineResult = await ensureMachine(
    rootToken,
    config,
    plan.ownershipSentinel,
    image,
    volumeResult.volume,
    installationReceiptBase,
  );
  const machine = await startMachine(rootToken, config, machineResult.machine);
  const receipt = {
    ...installationReceiptBase,
    machineId: machine.id,
    providerMachineVersion: machine.instance_id ?? machine.version ?? null,
    imageDigest: machine.image_ref?.digest ?? null,
    effects: {
      appCreated: appResult.created,
      bucketCreated: tigrisRoot.created,
      volumeCreated: volumeResult.created,
      machineCreated: machineResult.created,
      credentialsCreated: {
        flyRead: flyRead.created,
        flyControl: flyControl.created,
        flyRegistry: flyRegistry.created,
        tigris: Object.fromEntries(
          Object.entries(tigrisRoles).map(([role, credential]) => [role, credential.created]),
        ),
        mtls: mtls.created,
      },
      tigrisRoleIsolation: tigrisIsolation,
      externalAuthority,
    },
    tariffs: plan.tariffs,
    capabilityAdvertised: false,
    blockers: [
      'full packed Fly/Tigris hosted product journey has not yet produced a passing receipt',
    ],
  };
  return {
    ...receipt,
    receiptSha256: sha256(Buffer.from(canonicalJson(receipt))),
  };
}

async function main() {
  const [command = 'plan', ...args] = process.argv.slice(2);
  const plan = buildBootstrapPlan();
  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (command !== 'apply') throw new Error('usage: bootstrap.mjs [plan|apply --confirm <planSha256>]');
  const confirmationIndex = args.indexOf('--confirm');
  const confirmationSha256 = confirmationIndex >= 0 ? args[confirmationIndex + 1] : null;
  const receipt = await applyBootstrap(plan, { confirmationSha256 });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error).slice(0, 1200)}\n`);
    process.exitCode = 2;
  });
}
