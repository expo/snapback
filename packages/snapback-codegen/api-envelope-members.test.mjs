// The third leg of the envelope's cross-language anchor (LLP 0062 §5).
//
// The server (src/api_envelope.rs) and the engine
// (packages/snapback-app-cli/envelope.test.mjs) already pin each other on one
// canonical envelope. Codegen produces the *members* that composition
// consumes, and the server recomputes their digest map before activating —
// so codegen's canonicalization and digest domains must agree with the other
// two byte-for-byte or every real provisioning refuses. These cases pin the
// member digests taken verbatim from that shared anchor.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DECLARATION_MEMBER_KEY,
  buildApiEnvelopeMembers,
  jcsCanonical,
  memberDigest,
  operationMemberKey,
  renderAppBindings,
} from './api-envelope-members.mjs';

// Verbatim from the anchor envelope asserted in both other suites.
const ANCHOR_DECLARATION = 'export const bindings = {};\n';
const ANCHOR_DECLARATION_DIGEST = 'e8e2d8ff0088c9ee62db4171f268cac2931f51c5724cb6a2fbd3b9b52968bd59';
const ANCHOR_ADD_NOTE_SCHEMA = { properties: { title: { type: 'string' } }, type: 'object' };
const ANCHOR_ADD_NOTE_DIGEST = 'c5159bb036b76512dcd0d9d97bd51cd7041c9367af483ea2e355e9885d30dbf2';
const ANCHOR_LIST_NOTES_SCHEMA = { properties: {}, type: 'object' };
const ANCHOR_LIST_NOTES_DIGEST = 'cb851c1685cc73404ff7c5c0bf704d8399afa8cbd05a18fd835e2069c2f76641';

test('codegen digests the anchor members exactly as the server and engine do', () => {
  assert.equal(memberDigest(ANCHOR_DECLARATION), ANCHOR_DECLARATION_DIGEST);
  assert.equal(memberDigest(jcsCanonical(ANCHOR_ADD_NOTE_SCHEMA)), ANCHOR_ADD_NOTE_DIGEST);
  assert.equal(memberDigest(jcsCanonical(ANCHOR_LIST_NOTES_SCHEMA)), ANCHOR_LIST_NOTES_DIGEST);
});

test('the declaration digest covers raw bytes, not a JSON-quoted string', () => {
  // The server digests `members.declarations.app_bindings` directly. Digesting
  // the JSON encoding instead would pass a codegen-only round trip and refuse
  // at every real activation.
  assert.notEqual(memberDigest(JSON.stringify(ANCHOR_DECLARATION)), ANCHOR_DECLARATION_DIGEST);
});

test('members are keyed by stable id and carry a digest for every member', () => {
  const functionManifest = {
    appId: 'anchor-app',
    functions: [
      { id: 'anchor-app:addNote', name: 'addNote', kind: 'Mutation' },
      { id: 'anchor-app:listNotes', name: 'listNotes', kind: 'Query' },
    ],
  };
  const operationSchemas = [
    { file: 'addNote.args.schema.json', value: ANCHOR_ADD_NOTE_SCHEMA },
    { file: 'listNotes.args.schema.json', value: ANCHOR_LIST_NOTES_SCHEMA },
  ];
  const members = buildApiEnvelopeMembers(functionManifest, operationSchemas);

  assert.deepEqual(Object.keys(members.operations), ['anchor-app:addNote', 'anchor-app:listNotes']);
  assert.equal(members.operations['anchor-app:addNote'].name, 'addNote');
  assert.equal(
    members.memberDigests[operationMemberKey('anchor-app:addNote')],
    ANCHOR_ADD_NOTE_DIGEST,
  );
  assert.equal(
    members.memberDigests[operationMemberKey('anchor-app:listNotes')],
    ANCHOR_LIST_NOTES_DIGEST,
  );
  // Exactly the members, and nothing beyond them: the server compares the
  // whole map for equality, so a stray key refuses activation.
  assert.equal(Object.keys(members.memberDigests).length, 3);
  assert.ok(members.memberDigests[DECLARATION_MEMBER_KEY]);
});

test('a function with no rendered argument schema refuses rather than emitting a hole', () => {
  assert.throws(
    () => buildApiEnvelopeMembers(
      { functions: [{ id: 'a:one', name: 'one', kind: 'Query' }] },
      [],
    ),
    /no argument schema rendered/,
  );
});

test('bindings declare kind-specific signatures and are order-stable', () => {
  const bindings = renderAppBindings([
    { name: 'zeta', kind: 'LiveQuery' },
    { name: 'alpha', kind: 'Mutation' },
  ]);
  assert.match(bindings, /"alpha": \(args\?: Record<string, unknown>\) => Promise<unknown>;/);
  assert.match(bindings, /"zeta": \(args\?: Record<string, unknown>\) => AsyncIterable<unknown>;/);
  assert.ok(bindings.indexOf('"alpha"') < bindings.indexOf('"zeta"'), 'declaration order is stable');
  assert.equal(
    bindings,
    renderAppBindings([{ name: 'alpha', kind: 'Mutation' }, { name: 'zeta', kind: 'LiveQuery' }]),
    'declaration order does not depend on manifest order',
  );
});
