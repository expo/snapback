// Live-wire schema gate, kit half (LLP 0051 D4 / ENG-23891).
//
// The Rust types in src/live_wire.rs are the single source of truth for the
// client-visible live wire; `snapback-schemagen` commits their JSON Schemas
// under schemas/ and tests/artifact_schemas_v0.rs drift-gates that half. This
// test pins the JS kit to the SAME schemas: the envelope kinds client.mjs
// declares (and dispatches on) must exactly equal the kinds the committed
// schemas define, so a server-side kind addition/rename fails here instead of
// becoming a frame the kit silently never matches (the string-dispatch drift
// D4 retires).
//
// Dependency-free by design (like the other kit tests): it walks the schema
// JSON for the tag constants instead of pulling a validator.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIVE_DURABLE_KINDS, LIVE_SOCKET_KINDS } from '../client.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function schemaKinds(file, tag) {
  const schema = JSON.parse(readFileSync(path.join(root, 'schemas', file), 'utf8'));
  const variants = schema.oneOf ?? schema.anyOf;
  assert.ok(Array.isArray(variants), `${file}: expected a tagged-union schema (oneOf/anyOf)`);
  const kinds = new Set();
  for (const variant of variants) {
    const tagSchema = variant.properties?.[tag];
    assert.ok(tagSchema, `${file}: variant is missing the '${tag}' tag property`);
    const values = tagSchema.const !== undefined ? [tagSchema.const] : tagSchema.enum;
    assert.ok(
      Array.isArray(values) && values.length > 0,
      `${file}: '${tag}' tag carries neither const nor enum`,
    );
    for (const value of values) kinds.add(value);
  }
  return kinds;
}

// Durable lane: the kit must handle exactly what the schema defines.
const durableSchema = schemaKinds('live.envelope.schema.json', 'kind');
const durableHandled = new Set(Object.values(LIVE_DURABLE_KINDS));
assert.deepEqual(
  [...durableSchema].sort(),
  [...durableHandled].sort(),
  'durable-lane kinds drifted between schemas/live.envelope.schema.json and client.mjs LIVE_DURABLE_KINDS',
);

// Socket control lane: every schema kind is dispatched (DURABLE_BYTES
// recovers via a synthesized connection-wide clear-retained resync —
// dispatchDurableBytesFrame in the kit; regression-durable-bytes-resync.mjs
// covers the transition — so the set comparison still pins it).
const socketSchema = schemaKinds('live.socket-server.schema.json', 'kind');
const socketHandled = new Set(Object.values(LIVE_SOCKET_KINDS));
assert.deepEqual(
  [...socketSchema].sort(),
  [...socketHandled].sort(),
  'socket-lane kinds drifted between schemas/live.socket-server.schema.json and client.mjs LIVE_SOCKET_KINDS',
);

// The two lanes share one `kind` namespace on the wire (both frame families
// arrive on the same WebSocket), so a collision would make dispatch ambiguous.
for (const kind of durableSchema) {
  assert.ok(!socketSchema.has(kind), `kind '${kind}' is defined by BOTH live-wire schemas`);
}

// Structural spot-checks: the fields the kit actually reads exist in the
// schema variant for that kind (field-level drift, not just kind-level).
function variantFor(file, tag, kind) {
  const schema = JSON.parse(readFileSync(path.join(root, 'schemas', file), 'utf8'));
  const variants = schema.oneOf ?? schema.anyOf;
  const found = variants.find((variant) => {
    const tagSchema = variant.properties?.[tag];
    const values = tagSchema?.const !== undefined ? [tagSchema.const] : (tagSchema?.enum ?? []);
    return values.includes(kind);
  });
  assert.ok(found, `${file}: no variant for kind '${kind}'`);
  return found;
}

const replace = variantFor('live.envelope.schema.json', 'kind', 'live_replace');
for (const field of ['subscription_id', 'function', 'version', 'rows']) {
  assert.ok(replace.properties[field], `live_replace schema lost field '${field}' the kit reads`);
}
const delta = variantFor('live.envelope.schema.json', 'kind', 'live_delta');
for (const field of ['subscription_id', 'version', 'ops']) {
  assert.ok(delta.properties[field], `live_delta schema lost field '${field}' the kit reads`);
}
const resync = variantFor('live.envelope.schema.json', 'kind', 'resync_required');
for (const field of ['reason', 'subscription_id']) {
  assert.ok(resync.properties[field], `resync_required schema lost field '${field}' the kit reads`);
}
const pong = variantFor('live.socket-server.schema.json', 'kind', 'pong');
assert.ok(pong.properties.requestId, 'pong schema lost requestId (camelCase socket lane)');
const ephemeral = variantFor('live.socket-server.schema.json', 'kind', 'ephemeral');
assert.ok(ephemeral.properties.message, "ephemeral frame schema lost 'message'");

console.log('live-wire-schema: kit dispatch kinds match the committed schemas');
