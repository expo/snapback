#!/usr/bin/env node
// @ref LLP 0105#one-fail-closed-hosted-authority-and-recoverable-supervisor —
// the installed service has a volume-backed canonical database, an external
// incarnation anchor, and a mutually authenticated control endpoint.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { S3Client } from '@aws-sdk/client-s3';
import {
  canonicalJson,
  HostedSupervisor,
  machineIsProductionRouted,
  SupervisorRefusal,
  sha256,
  verifyBoundFlyMachineRoster,
} from './index.mjs';
import {
  coreStateFromExternal,
  publishExternalAuthority,
  readExternalAuthority,
} from './external-store.mjs';
import {
  certificateSha256,
  mintOnlineHostedAdmission,
  validateHostedTargetEnrollment,
} from './hosted-edge-admission.mjs';

const dataDir = process.env.SNAPBACK_SUPERVISOR_DATA_DIR ?? '/data/control';
const installationPath = process.env.SNAPBACK_SUPERVISOR_INSTALLATION_RECEIPT
  ?? join(dataDir, 'installation-receipt.json');
const databasePath = process.env.SNAPBACK_SUPERVISOR_DATABASE
  ?? join(dataDir, 'supervisor.sqlite3');
const tls = {
  key: process.env.SNAPBACK_SUPERVISOR_TLS_KEY ?? '/run/secrets/server-key.pem',
  cert: process.env.SNAPBACK_SUPERVISOR_TLS_CERT ?? '/run/secrets/server-cert.pem',
  ca: process.env.SNAPBACK_SUPERVISOR_CLIENT_CA ?? '/run/secrets/client-ca.pem',
};

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_INSTALLATION_INVALID',
      `${label} could not be read: ${String(error?.message ?? error)}`,
    );
  }
}

function readSecret(path, label) {
  try {
    const value = readFileSync(path, 'utf8').trim();
    if (!value) throw new Error('empty secret');
    return value;
  } catch (error) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_CREDENTIAL_INVALID',
      `${label} could not be read: ${String(error?.message ?? error)}`,
    );
  }
}

function storageClient(role) {
  const stem = role === 'anchor' ? 'anchor' : 'journal';
  return new S3Client({
    endpoint: 'https://t3.storage.dev',
    region: 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: readSecret(`/run/secrets/tigris-${stem}-id`, `${role} access key`),
      secretAccessKey: readSecret(`/run/secrets/tigris-${stem}-secret`, `${role} secret key`),
    },
  });
}

function openCanonicalDatabase() {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS supervisor_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      generation INTEGER NOT NULL,
      incarnation TEXT NOT NULL,
      state_json TEXT NOT NULL,
      state_sha256 TEXT NOT NULL
    ) STRICT;
  `);
  return database;
}

function loadState(database, installationReceipt) {
  const row = database.prepare(
    'SELECT generation, incarnation, state_json, state_sha256 FROM supervisor_state WHERE singleton = 1',
  ).get();
  if (!row) {
    const incarnation = installationReceipt.incarnation;
    const supervisor = new HostedSupervisor({ installationReceipt, incarnation });
    const state = {
      installationReceipt,
      incarnation,
      database: supervisor.database,
      mirror: supervisor.mirror,
      anchor: supervisor.anchor,
    };
    persistState(database, state);
    return state;
  }
  if (sha256(Buffer.from(row.state_json)) !== row.state_sha256) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_DATABASE_DIGEST_MISMATCH',
      'canonical supervisor state digest does not match',
    );
  }
  const state = JSON.parse(row.state_json);
  if (
    state.incarnation !== row.incarnation
    || state.database?.generation !== row.generation
    || state.installationReceipt?.installationId !== installationReceipt.installationId
  ) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_DATABASE_IDENTITY_MISMATCH',
      'canonical supervisor state identity drifted',
    );
  }
  return state;
}

function persistState(database, state) {
  const stateJson = JSON.stringify(state);
  const stateSha256 = sha256(Buffer.from(stateJson));
  database.prepare(`
    INSERT INTO supervisor_state(singleton, generation, incarnation, state_json, state_sha256)
    VALUES(1, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      generation = excluded.generation,
      incarnation = excluded.incarnation,
      state_json = excluded.state_json,
      state_sha256 = excluded.state_sha256
  `).run(state.database.generation, state.incarnation, stateJson, stateSha256);
  return stateSha256;
}

function responseBody(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function send(response, statusCode, value) {
  const body = responseBody(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readRequest(request, limit = 64 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > limit) {
      throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_REQUEST_TOO_LARGE', 'request exceeds 64 KiB');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const installationReceipt = readJson(installationPath, 'installation receipt');
const anchorClient = storageClient('anchor');
const journalClient = storageClient('journal');
let externalAuthority = await readExternalAuthority({
  installationReceipt,
  anchorClient,
  journalClient,
});
const canonicalDatabase = openCanonicalDatabase();
let retainedState = loadState(canonicalDatabase, installationReceipt);
if (retainedState.database.generation < externalAuthority.anchor.generation) {
  retainedState = coreStateFromExternal(installationReceipt, externalAuthority);
  persistState(canonicalDatabase, retainedState);
} else if (retainedState.database.generation === externalAuthority.anchor.generation) {
  if (canonicalJson(retainedState.database) !== canonicalJson(externalAuthority.mirror.database)) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_DATABASE_EXTERNAL_MISMATCH',
      'canonical SQLite and externally anchored mirror disagree at one generation',
    );
  }
  // The volume may predate a repaired/re-installed incarnation receipt even
  // when its empty generation-0 database happens to have the same bytes.
  // Canonicalize every custody member from the externally rooted identity.
  retainedState = coreStateFromExternal(installationReceipt, externalAuthority);
  persistState(canonicalDatabase, retainedState);
} else if (retainedState.database.generation === externalAuthority.anchor.generation + 1) {
  // Recovery for an interruption after the FULL-sync SQLite commit. The
  // immutable write helpers and pointer CAS make this exact replay safe.
  externalAuthority = await publishExternalAuthority({
    installationReceipt,
    anchorClient,
    journalClient,
    previous: externalAuthority,
    database: retainedState.database,
  });
} else {
  throw new SupervisorRefusal(
    'SNAPBACK_SUPERVISOR_RECONSTRUCTION_REQUIRED',
    'canonical SQLite is more than one generation ahead of external authority',
  );
}

let serviceWedge = null;
let commandInFlight = false;

function externalAuthorityProjection() {
  return {
    generation: externalAuthority.anchor.generation,
    anchorSha256: externalAuthority.anchorSha256,
    mirrorSha256: externalAuthority.mirrorSha256,
    rootAnchorSha256: installationReceipt.externalAnchorSha256,
    chainVerified: true,
  };
}

async function readFlyMachines(appId, token) {
  const response = await fetch(
    `https://api.machines.dev/v1/apps/${encodeURIComponent(appId)}/machines`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    },
  );
  const body = await response.text();
  if (response.status !== 200) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_FLY_ROSTER_READ_FAILED',
      `Fly roster read failed (http ${response.status})`,
    );
  }
  return body;
}

async function verifyFlyRoster(targetId) {
  const head = retainedState.database.heads[targetId];
  const binding = head?.binding;
  if (!binding || binding.schemaVersion !== 'snapback.fly-target-binding.v2') {
    throw new SupervisorRefusal(
      'SNAPBACK_FLY_TARGET_BINDING_MISSING',
      'exact Fly target binding is not registered',
    );
  }
  const now = Date.now();
  if (binding.expiresAtMs <= now) {
    throw new SupervisorRefusal(
      'SNAPBACK_FLY_TARGET_BINDING_EXPIRED',
      'Fly target binding requires a fresh generation',
    );
  }
  const token = readSecret('/run/secrets/fly-read-token', 'Fly read token');
  const first = await readFlyMachines(binding.appId, token);
  const second = await readFlyMachines(binding.appId, token);
  if (sha256(Buffer.from(first)) !== sha256(Buffer.from(second))) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_FLY_ROSTER_UNSTABLE',
      'two independent Fly roster reads did not agree',
    );
  }
  const machines = JSON.parse(first);
  const active = verifyBoundFlyMachineRoster(binding, machines);
  const admission = new HostedSupervisor(retainedState).admitRoster({
    targetId,
    expectedMachineId: binding.activeMachineId,
    machines: machines.map((machine) => ({
      id: String(machine.id),
      productionRouted: machineIsProductionRouted(machine, binding.serviceProcessGroups),
    })),
    autoscaleEnabled: binding.autoscaleEnabled,
    observedAtMs: now,
    expiresAtMs: now + 60_000,
  });
  return {
    schemaVersion: 'snapback.fly-roster-verification.v1',
    targetId,
    bindingSha256: head.bindingSha256,
    providerFactsSha256: sha256(Buffer.from(first)),
    providerReadBackVerified: true,
    providerMachineVersion: String(active.instance_id ?? active.version ?? ''),
    ...admission,
  };
}

function invokeCommand(supervisor, input) {
  if (
    input?.schemaVersion !== 'snapback.hosted-supervisor-command.v1'
    || typeof input.command !== 'string'
    || !input.arguments
    || Array.isArray(input.arguments)
    || typeof input.arguments !== 'object'
  ) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_COMMAND_INVALID',
      'control command is not the closed version-1 shape',
    );
  }
  const args = input.arguments;
  switch (input.command) {
    case 'admitRoster':
      return supervisor.admitRoster(args);
    case 'createSpendLedger':
      return supervisor.createSpendLedger(args);
    case 'reserveSpend':
      return supervisor.reserveSpend(args);
    case 'appendIntent':
      return supervisor.appendIntent(args.intent, {
        journeyId: args.journeyId,
        grantId: args.grantId,
      });
    case 'markEffecting':
      return supervisor.markEffecting(args.semanticEffectId, args.observation);
    case 'appendTerminal':
      return supervisor.appendTerminal(args.semanticEffectId, args.terminal, {
        journeyId: args.journeyId,
        grantId: args.grantId,
      });
    case 'reconcileEffect':
      return supervisor.reconcileEffect(args.semanticEffectId, args.reconciliation);
    case 'promotePlannedBinding':
      return supervisor.promotePlannedBinding(args);
    case 'registerTargetBinding':
      return supervisor.registerTargetBinding(args);
    case 'registerHostedTargetEnrollment': {
      const signingSeed = readSecret(
        args.signingSeedCredentialRef,
        'target admission signing seed',
      );
      return supervisor.registerHostedTargetEnrollment(
        validateHostedTargetEnrollment(args, signingSeed),
      );
    }
    case 'planCleanup':
      return supervisor.planCleanup(args);
    case 'confirmCleanup':
      return supervisor.confirmCleanup(args.cleanupPlanId, args.confirmation);
    case 'applyCleanup':
      return supervisor.applyCleanup(args.cleanupPlanId, args.absenceObservations);
    default:
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_COMMAND_UNSUPPORTED',
        `control command ${input.command.slice(0, 64)} is unsupported`,
      );
  }
}

async function commitSupervisorState(supervisor) {
  const nextState = {
    installationReceipt,
    incarnation: supervisor.incarnation,
    database: supervisor.database,
    mirror: supervisor.mirror,
    anchor: supervisor.anchor,
  };
  // @ref LLP 0105#one-fail-closed-hosted-authority-and-recoverable-supervisor
  // — SQLite FULL-sync precedes immutable mirror and conditional anchor.
  persistState(canonicalDatabase, nextState);
  try {
    externalAuthority = await publishExternalAuthority({
      installationReceipt,
      anchorClient,
      journalClient,
      previous: externalAuthority,
      database: nextState.database,
    });
  } catch (error) {
    serviceWedge = error instanceof SupervisorRefusal
      ? error
      : new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_EXTERNAL_COMMIT_FAILED',
        `external commit failed: ${String(error?.message ?? error).slice(0, 256)}`,
      );
    throw serviceWedge;
  }
  retainedState = nextState;
}

async function executeCommand(input) {
  if (serviceWedge) throw serviceWedge;
  if (commandInFlight) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_SINGLE_WRITER_BUSY',
      'another canonical control transaction is in progress',
    );
  }
  commandInFlight = true;
  try {
    if (
      input?.schemaVersion === 'snapback.hosted-supervisor-command.v1'
      && input.command === 'verifyFlyRoster'
    ) {
      if (
        !input.arguments
        || Object.keys(input.arguments).length !== 1
        || typeof input.arguments.targetId !== 'string'
      ) {
        throw new SupervisorRefusal(
          'SNAPBACK_SUPERVISOR_COMMAND_INVALID',
          'verifyFlyRoster accepts only targetId',
        );
      }
      return await verifyFlyRoster(input.arguments.targetId);
    }
    const supervisor = new HostedSupervisor(retainedState);
    const previousGeneration = supervisor.database.generation;
    const result = invokeCommand(supervisor, input);
    if (supervisor.database.generation === previousGeneration) return result;
    await commitSupervisorState(supervisor);
    return result;
  } finally {
    commandInFlight = false;
  }
}

async function executeOnlineAdmission(input, peerCertificateRaw) {
  if (serviceWedge) throw serviceWedge;
  if (commandInFlight) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_SINGLE_WRITER_BUSY',
      'another canonical control transaction is in progress',
    );
  }
  if (
    !input
    || Object.keys(input).length !== 4
    || input.schemaVersion !== 'snapback.hosted-target-admission-request.v1'
    || typeof input.targetId !== 'string'
    || typeof input.machineId !== 'string'
    || typeof input.processBootId !== 'string'
  ) {
    throw new SupervisorRefusal(
      'SNAPBACK_HOSTED_ADMISSION_INVALID',
      'target admission request is not the closed version-1 shape',
    );
  }
  commandInFlight = true;
  try {
    const enrollment = retainedState.database.targetEnrollments?.[input.targetId];
    const targetHead = retainedState.database.heads?.[input.targetId];
    if (
      !enrollment
      || certificateSha256(peerCertificateRaw) !== enrollment.clientCertificateSha256
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_HOSTED_TARGET_CLIENT_CERTIFICATE_INVALID',
        'target client certificate is not bound to this target',
      );
    }
    const roster = await verifyFlyRoster(input.targetId);
    if (roster.machineId !== input.machineId) {
      throw new SupervisorRefusal(
        'SNAPBACK_EPHEMERAL_ROUTING_UNSAFE',
        'requesting process is not the exact active routed Machine',
      );
    }
    const signingSeed = readSecret(
      enrollment.signingSeedCredentialRef,
      'target admission signing seed',
    );
    validateHostedTargetEnrollment(enrollment, signingSeed);
    const issuedAtMs = Date.now();
    const supervisor = new HostedSupervisor(retainedState);
    const reservation = supervisor.reserveOnlineAdmission({
      targetId: input.targetId,
      machineId: input.machineId,
      processBootId: input.processBootId,
      providerFactsSha256: roster.providerFactsSha256,
      issuedAtMs,
    });
    await commitSupervisorState(supervisor);
    const expiresAtMs = Math.min(issuedAtMs + 60_000, roster.expiresAtMs);
    return mintOnlineHostedAdmission({
      enrollment,
      signingSeed,
      targetAuthority: {
        bindingGeneration: targetHead.binding.bindingGeneration,
        targetBindingSha256: targetHead.bindingSha256,
        controlHeadSha256: retainedState.anchor.controlHeadDigest,
        supervisorIncarnation: retainedState.incarnation,
        exactRosterSha256: roster.providerFactsSha256,
        routedMachineId: roster.machineId,
        routedMachineExpiresAtMs: roster.expiresAtMs,
      },
      admissionEpoch: reservation.admissionEpoch,
      senderReplayEpochFloor: reservation.senderReplayEpochFloor,
      issuedAtMs,
      expiresAtMs,
    });
  } finally {
    commandInFlight = false;
  }
}

const health = createHttpServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/health') {
    send(response, 404, { ok: false });
    return;
  }
  send(response, serviceWedge ? 503 : 200, {
    schemaVersion: 'snapback.hosted-supervisor-health.v1',
    ok: serviceWedge === null,
    installationId: installationReceipt.installationId,
    machineId: process.env.FLY_MACHINE_ID ?? null,
    installationReceiptSha256: sha256(Buffer.from(JSON.stringify(installationReceipt))),
    generation: retainedState.database.generation,
    incarnation: retainedState.incarnation,
    custody: {
      canonicalDatabase: 'sqlite-full-sync-volume',
      externalAnchor: installationReceipt.externalAnchor,
      mirror: installationReceipt.journalMirror,
      externalAuthority: externalAuthorityProjection(),
      controlTransport: 'mutual-tls',
    },
    diagnostic: serviceWedge ? {
      code: serviceWedge.code,
      message: serviceWedge.message,
    } : null,
  });
});

const control = createHttpsServer({
  key: readFileSync(tls.key),
  cert: readFileSync(tls.cert),
  ca: readFileSync(tls.ca),
  requestCert: true,
  rejectUnauthorized: true,
  minVersion: 'TLSv1.3',
}, async (request, response) => {
  try {
    if (!request.socket.authorized) {
      throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_MTLS_REQUIRED', 'client certificate refused');
    }
    if (request.method === 'GET' && request.url === '/v1/state') {
      send(response, 200, {
        schemaVersion: 'snapback.hosted-supervisor-state.v1',
        installationId: installationReceipt.installationId,
        generation: retainedState.database.generation,
        incarnation: retainedState.incarnation,
        stateSha256: sha256(Buffer.from(JSON.stringify(retainedState.database))),
        externalAuthority: externalAuthorityProjection(),
      });
      return;
    }
    if (
      request.method !== 'POST'
      || !['/v1/admit-roster', '/v1/command'].includes(request.url)
    ) {
      send(response, 404, { ok: false });
      return;
    }
    let input = await readRequest(request);
    if (request.url === '/v1/admit-roster') {
      input = {
        schemaVersion: 'snapback.hosted-supervisor-command.v1',
        command: 'admitRoster',
        arguments: input,
      };
    }
    const result = await executeCommand(input);
    send(response, 200, {
      schemaVersion: 'snapback.hosted-supervisor-response.v1',
      ok: true,
      generation: retainedState.database.generation,
      externalAuthority: externalAuthorityProjection(),
      result,
    });
  } catch (error) {
    send(response, error instanceof SyntaxError ? 400 : 403, {
      schemaVersion: 'snapback.hosted-supervisor-response.v1',
      ok: false,
      diagnostic: {
        code: error instanceof SupervisorRefusal ? error.code : 'SNAPBACK_SUPERVISOR_INTERNAL',
        message: String(error?.message ?? error).slice(0, 512),
      },
    });
  }
});

health.listen(Number(process.env.SNAPBACK_SUPERVISOR_HEALTH_PORT ?? 8081), '::');
control.listen(Number(process.env.SNAPBACK_SUPERVISOR_CONTROL_PORT ?? 8443), '::');

const targetClientCa = process.env.SNAPBACK_SUPERVISOR_TARGET_CLIENT_CA
  ?? '/run/secrets/target-client-ca.pem';
if (existsSync(targetClientCa)) {
  const targetControl = createHttpsServer({
    key: readFileSync(tls.key),
    cert: readFileSync(tls.cert),
    ca: readFileSync(targetClientCa),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
  }, async (request, response) => {
    try {
      if (
        !request.socket.authorized
        || request.method !== 'POST'
        || request.url !== '/v1/target/admission'
      ) {
        send(response, 404, { ok: false });
        return;
      }
      const peer = request.socket.getPeerCertificate();
      const envelope = await executeOnlineAdmission(
        await readRequest(request, 4 * 1024),
        peer.raw,
      );
      send(response, 200, envelope);
    } catch (error) {
      send(response, error instanceof SyntaxError ? 400 : 403, {
        schemaVersion: 'snapback.hosted-target-admission-response.v1',
        ok: false,
        diagnostic: {
          code: error instanceof SupervisorRefusal ? error.code : 'SNAPBACK_SUPERVISOR_INTERNAL',
          message: String(error?.message ?? error).slice(0, 512),
        },
      });
    }
  });
  targetControl.listen(
    Number(process.env.SNAPBACK_SUPERVISOR_TARGET_CONTROL_PORT ?? 8444),
    '::',
  );
}
