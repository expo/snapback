import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { PublicationLeaseAuthority } from './authority.mjs';
import {
  AUTHORITY_HEAD_KEYS,
  AUTHORITY_RECEIPT_KEYS,
  AUTHORITY_TRANSITION_KEYS,
  ISSUE_REQUEST_KEYS,
  LEASE_KEYS,
  PROMOTION_PACKAGE_NAMES,
  publicationAuthoritySigningKeyId,
  publicationAuthorityTransition,
  validatePublicationAuthorityHead,
  validatePublicationAuthorityReceipt,
  validatePublicationAuthorityTransition,
  validatePublicationLeaseIssueRequest,
  vectorFromLease,
} from './protocol.mjs';
import { InMemoryPublicationAuthorityStore } from './store.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
function schema(name) {
  return JSON.parse(readFileSync(join(ROOT, 'schemas', name), 'utf8'));
}

function assertClosedSchema(name, keys) {
  const value = schema(name);
  assert.equal(value.type, 'object');
  assert.equal(value.additionalProperties, false);
  assert.deepEqual([...value.required].sort(), [...keys].sort());
  assert.deepEqual(Object.keys(value.properties).sort(), [...keys].sort());
}

test('closed JSON Schemas and runtime validators share every endpoint key set', () => {
  assertClosedSchema('publication-lease-issue-request.schema.json', ISSUE_REQUEST_KEYS);
  assertClosedSchema('authorized-publication-lease.schema.json', LEASE_KEYS);
  assertClosedSchema('publication-authority-head.schema.json', AUTHORITY_HEAD_KEYS);
  assertClosedSchema(
    'publication-authority-transition.schema.json',
    AUTHORITY_TRANSITION_KEYS,
  );
  assertClosedSchema(
    'publication-authority-transition-receipt.schema.json',
    AUTHORITY_RECEIPT_KEYS,
  );
  assertClosedSchema('publication-authority-error.schema.json', [
    'code',
    'message',
    'schemaVersion',
  ]);
  assertClosedSchema('publication-authority-health.schema.json', [
    'ready',
    'schemaVersion',
  ]);
  const leaseSchema = schema('authorized-publication-lease.schema.json');
  assert.equal(
    leaseSchema.properties.packages.minItems,
    PROMOTION_PACKAGE_NAMES.length,
  );
  assert.equal(
    leaseSchema.properties.packages.maxItems,
    PROMOTION_PACKAGE_NAMES.length,
  );
  assert.deepEqual(
    leaseSchema.properties.packages.prefixItems.map(
      (item) => item.allOf[1].properties.name.const,
    ),
    PROMOTION_PACKAGE_NAMES,
  );
  const requestSchema = schema('publication-lease-issue-request.schema.json');
  assert.equal(
    requestSchema.properties.packages.minItems,
    PROMOTION_PACKAGE_NAMES.length,
  );
  assert.equal(
    requestSchema.properties.packages.maxItems,
    PROMOTION_PACKAGE_NAMES.length,
  );
  assert.deepEqual(
    requestSchema.properties.packages.prefixItems.map((item) => (
      requestSchema.$defs[item.$ref.split('/').at(-1)]
        .allOf[1].properties.name.const
    )),
    PROMOTION_PACKAGE_NAMES,
  );
  for (const packageSchema of [leaseSchema.$defs.package, requestSchema.$defs.package]) {
    const terminalName = new RegExp(packageSchema.properties.name.pattern, 'u');
    assert.equal(terminalName.test('@expo/snapback'), true);
    assert.equal(terminalName.test('@expo/snapback-client'), true);
    assert.equal(terminalName.test('create-snapback-app'), true);
    assert.equal(terminalName.test('@expo/snapback/extra'), false);
    assert.equal(terminalName.test('@expo/snapbackish'), false);
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const authorityInstallationId = 'snapback-publication-schema';
  const authorityOrigin = 'https://publication-authority.example';
  const authority = new PublicationLeaseAuthority({
    store: new InMemoryPublicationAuthorityStore({
      authorityInstallationId,
      authorityOrigin,
      publicKey,
    }),
    privateKey,
    authorityInstallationId,
    authorityOrigin,
    now: () => Date.parse('2026-07-28T20:00:00.000Z'),
  });
  const request = {
    schemaVersion: 'snapback.publication-lease-issue-request.v4',
    authorityInstallationId,
    authorityOrigin,
    signingKeyId: publicationAuthoritySigningKeyId(publicKey),
    operationId: 'release-schema-authority-test',
    publisherInstanceId: 'publisher-schema-test',
    expectedPublicationEpoch: 0,
    expectedHeadSha256: null,
    candidateLedgerSha256: 'a'.repeat(64),
    candidateTag: 'bakeoff-0-1-1-deadbeefcafe',
    defaultTag: 'latest',
    priorDefaultClosureReceiptSha256: 'b'.repeat(64),
    lifetimeSeconds: 600,
    packages: PROMOTION_PACKAGE_NAMES.map((name) => ({
      name,
      expectedPriorVersion: '0.1.0',
      newVersion: '0.1.1',
    })),
  };
  assert.equal(validatePublicationLeaseIssueRequest(request), request);
  assert.throws(
    () => validatePublicationLeaseIssueRequest({ ...request, extra: true }),
    /unknown or missing members/u,
  );
  const lease = authority.issue(request);

  const head = authority.head();
  assert.equal(validatePublicationAuthorityHead({
    head,
    publicKey,
    authorityInstallationId,
    authorityOrigin,
  }), head);
  assert.throws(
    () => validatePublicationAuthorityHead({
      head: { ...head, extra: true },
      publicKey,
      authorityInstallationId,
      authorityOrigin,
    }),
    /unknown or missing members/u,
  );
  assert.throws(
    () => validatePublicationAuthorityHead({
      head: { ...head, authorityGeneration: head.authorityGeneration + 1 },
      publicKey,
      authorityInstallationId,
      authorityOrigin,
    }),
    /digest mismatch|signature is invalid/u,
  );

  const transition = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: vectorFromLease(lease, 'prior'),
  });
  assert.equal(validatePublicationAuthorityTransition(transition), transition);
  const receipt = authority.acquire(transition);
  assert.equal(
    validatePublicationAuthorityReceipt({
      receipt,
      transition,
      publicKey,
      authorityInstallationId,
      authorityOrigin,
    }),
    receipt,
  );

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const [schemaName, value] of [
    ['publication-lease-issue-request.schema.json', request],
    ['authorized-publication-lease.schema.json', lease],
    ['publication-authority-head.schema.json', head],
    ['publication-authority-transition.schema.json', transition],
    ['publication-authority-transition-receipt.schema.json', receipt],
  ]) {
    const validate = ajv.compile(schema(schemaName));
    assert.equal(
      validate(value),
      true,
      `${schemaName}: ${ajv.errorsText(validate.errors)}`,
    );
    assert.equal(validate({ ...value, unknown: true }), false);
  }
});
