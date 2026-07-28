#!/usr/bin/env node
// @ref LLP 0105#one-fail-closed-hosted-authority-and-recoverable-supervisor —
// the installed service has a volume-backed canonical database, an external
// incarnation anchor, and a mutually authenticated control endpoint.

import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HostedSupervisor, SupervisorRefusal, sha256 } from './index.mjs';

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

function openCanonicalDatabase() {
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
const canonicalDatabase = openCanonicalDatabase();
let retainedState = loadState(canonicalDatabase, installationReceipt);

const health = createHttpServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/health') {
    send(response, 404, { ok: false });
    return;
  }
  send(response, 200, {
    schemaVersion: 'snapback.hosted-supervisor-health.v1',
    ok: true,
    installationId: installationReceipt.installationId,
    installationReceiptSha256: sha256(Buffer.from(JSON.stringify(installationReceipt))),
    generation: retainedState.database.generation,
    incarnation: retainedState.incarnation,
    custody: {
      canonicalDatabase: 'sqlite-full-sync-volume',
      externalAnchor: installationReceipt.externalAnchor,
      mirror: installationReceipt.journalMirror,
      controlTransport: 'mutual-tls',
    },
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
      });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/admit-roster') {
      send(response, 404, { ok: false });
      return;
    }
    const input = await readRequest(request);
    const supervisor = new HostedSupervisor(retainedState);
    const result = supervisor.admitRoster(input);
    retainedState = {
      installationReceipt,
      incarnation: supervisor.incarnation,
      database: supervisor.database,
      mirror: supervisor.mirror,
      anchor: supervisor.anchor,
    };
    persistState(canonicalDatabase, retainedState);
    send(response, 200, {
      schemaVersion: 'snapback.hosted-supervisor-response.v1',
      ok: true,
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

health.listen(Number(process.env.SNAPBACK_SUPERVISOR_HEALTH_PORT ?? 8081), '0.0.0.0');
control.listen(Number(process.env.SNAPBACK_SUPERVISOR_CONTROL_PORT ?? 8443), '0.0.0.0');
