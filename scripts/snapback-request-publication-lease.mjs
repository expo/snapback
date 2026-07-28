#!/usr/bin/env node

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  canonicalJcs,
  validatePublicationAuthorityHead,
  validatePublicationLease,
} from '../packages/snapback-publication-authority/protocol.mjs';
import {
  createPublicationLeaseIssueRequest,
  fetchPublicationAuthorityJson,
  validateObservedPriorVector,
} from '../packages/snapback-publication-authority/request.mjs';
import { validateCandidateLedger } from './snapback-publish-core.mjs';

const usage = `usage: node scripts/snapback-request-publication-lease.mjs
  --ledger <candidate-ledger.json>
  --prior-vector <observed-prior-latest-vector.json>
  --authority-url <https-url>
  --publisher-instance <id>
  --operation-id <id>
  --public-key <ed25519-public-key.pem>
  --out <authorized-lease.json>
  [--lifetime-seconds <1..900>] [--allow-loopback-http]

SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE names the Bearer-token file. The token is
never accepted as an argument, environment value, or written to output.`;

function fail(message, code = 1) {
  process.stderr.write(`snapback-request-publication-lease: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { lifetimeSeconds: 900, allowLoopbackHttp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    }
    if (argument === '--allow-loopback-http') {
      options.allowLoopbackHttp = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`${argument} requires a value\n${usage}`, 2);
    if (argument === '--ledger') options.ledger = resolve(value);
    else if (argument === '--prior-vector') options.priorVector = resolve(value);
    else if (argument === '--authority-url') options.authorityUrl = value;
    else if (argument === '--publisher-instance') options.publisherInstanceId = value;
    else if (argument === '--operation-id') options.operationId = value;
    else if (argument === '--public-key') options.publicKey = resolve(value);
    else if (argument === '--out') options.out = resolve(value);
    else if (argument === '--lifetime-seconds') options.lifetimeSeconds = Number(value);
    else fail(`unknown argument ${argument}\n${usage}`, 2);
  }
  for (const field of [
    'ledger',
    'priorVector',
    'authorityUrl',
    'publisherInstanceId',
    'operationId',
    'publicKey',
    'out',
  ]) {
    if (!options[field]) fail(`missing required option ${field}\n${usage}`, 2);
  }
  if (
    !Number.isSafeInteger(options.lifetimeSeconds)
    || options.lifetimeSeconds < 1
    || options.lifetimeSeconds > 900
  ) {
    fail('--lifetime-seconds must be an integer in [1, 900]', 2);
  }
  let authority;
  try {
    authority = new URL(options.authorityUrl);
  } catch {
    fail('--authority-url must be an absolute URL', 2);
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(authority.hostname);
  if (
    authority.protocol !== 'https:'
    && !(options.allowLoopbackHttp && authority.protocol === 'http:' && loopback)
  ) {
    fail('--authority-url must use HTTPS (loopback HTTP requires explicit test opt-in)', 2);
  }
  if (
    authority.username
    || authority.password
    || authority.search
    || authority.hash
    || (authority.pathname !== '' && authority.pathname !== '/')
  ) {
    fail('--authority-url must be one origin without path or credentials', 2);
  }
  options.authorityUrl = authority.origin;
  return options;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} could not be read: ${error.message}`, 2);
  }
}

function headers(token) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
}

async function authorityJson(url, init = {}) {
  const response = await fetchPublicationAuthorityJson(url, init);
  const value = response.value;
  if (!response.ok) {
    throw new Error(`authority refused HTTP ${response.status}: ${value.code ?? 'unknown'}`);
  }
  return value;
}

function writePrivateAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

const options = parseArgs(process.argv.slice(2));
const tokenPath = process.env.SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE;
if (!tokenPath) {
  fail('SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE must name a Bearer-token file', 2);
}
let token;
try {
  token = readFileSync(tokenPath, 'utf8').trim();
} catch (error) {
  fail(`Bearer-token file could not be read: ${error.message}`, 2);
}
if (token.length < 16) {
  fail('SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE must contain at least 16 bytes', 2);
}
const publicKey = readFileSync(options.publicKey);
const ledger = readJson(options.ledger, 'candidate ledger');
try {
  validateCandidateLedger(ledger);
} catch (error) {
  fail(`candidate ledger refused: ${error.message}`, 2);
}
let priorVector;
try {
  priorVector = validateObservedPriorVector(
    readJson(options.priorVector, 'prior vector'),
  );
} catch (error) {
  fail(`prior vector refused: ${error.message}`, 2);
}
let lease;
try {
  const headChallenge = randomBytes(32).toString('hex');
  const head = validatePublicationAuthorityHead({
    head: await authorityJson(
      `${options.authorityUrl}/v1/head`,
      {
        headers: {
          ...headers(token),
          'x-snapback-publication-challenge': headChallenge,
        },
      },
    ),
    publicKey,
    authorityOrigin: options.authorityUrl,
    expectedChallenge: headChallenge,
  });
  const request = createPublicationLeaseIssueRequest({
    ledger,
    priorVector,
    head,
    publicKey,
    authorityOrigin: options.authorityUrl,
    operationId: options.operationId,
    publisherInstanceId: options.publisherInstanceId,
    lifetimeSeconds: options.lifetimeSeconds,
  });
  lease = await authorityJson(`${options.authorityUrl}/v1/leases/issue`, {
    method: 'POST',
    headers: { ...headers(token), 'content-type': 'application/json' },
    body: canonicalJcs(request),
  });
  validatePublicationLease({
    lease,
    publicKey,
    authorityInstallationId: head.authorityInstallationId,
    authorityOrigin: options.authorityUrl,
    candidateLedgerSha256: ledger.candidateLedgerSha256,
    candidateTag: ledger.tag,
    publisherInstanceId: options.publisherInstanceId,
  });
} catch (error) {
  fail(error.message);
}
writePrivateAtomic(options.out, lease);
process.stdout.write(JSON.stringify({
  schemaVersion: lease.schemaVersion,
  operationId: lease.operationId,
  publicationEpoch: lease.publicationEpoch,
  expiresAt: lease.expiresAt,
  leasePath: options.out,
}) + '\n');
