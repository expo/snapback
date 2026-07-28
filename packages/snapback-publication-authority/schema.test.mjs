import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PublicationLeaseAuthority } from './authority.mjs';
import {
  AUTHORITY_HEAD_KEYS,
  AUTHORITY_RECEIPT_KEYS,
  AUTHORITY_TRANSITION_KEYS,
  ISSUE_REQUEST_KEYS,
  LEASE_KEYS,
  PROMOTION_PACKAGE_NAMES,
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
  assert.deepEqual(
    leaseSchema.properties.packages.prefixItems.map(
      (item) => item.allOf[1].properties.name.const,
    ),
    PROMOTION_PACKAGE_NAMES,
  );
  const requestSchema = schema('publication-lease-issue-request.schema.json');
  assert.deepEqual(
    requestSchema.properties.packages.prefixItems.map((item) => (
      requestSchema.$defs[item.$ref.split('/').at(-1)]
        .allOf[1].properties.name.const
    )),
    PROMOTION_PACKAGE_NAMES,
  );

  const { privateKey } = generateKeyPairSync('ed25519');
  const authority = new PublicationLeaseAuthority({
    store: new InMemoryPublicationAuthorityStore(),
    privateKey,
    now: () => Date.parse('2026-07-28T20:00:00.000Z'),
  });
  const request = {
    schemaVersion: 'snapback.publication-lease-issue-request.v1',
    operationId: 'release-schema-authority-test',
    publisherInstanceId: 'publisher-schema-test',
    expectedPublicationEpoch: 0,
    expectedHeadSha256: null,
    candidateLedgerSha256: 'a'.repeat(64),
    candidateTag: 'bakeoff-0-1-1-deadbeefcafe',
    defaultTag: 'latest',
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
  assert.equal(validatePublicationAuthorityHead(head), head);
  assert.throws(
    () => validatePublicationAuthorityHead({ ...head, extra: true }),
    /unknown or missing members/u,
  );

  const transition = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: vectorFromLease(lease, 'prior'),
  });
  assert.equal(validatePublicationAuthorityTransition(transition), transition);
  const receipt = authority.acquire(transition);
  assert.equal(
    validatePublicationAuthorityReceipt({ receipt, transition }),
    receipt,
  );
});
