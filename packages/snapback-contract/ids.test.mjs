// LLP 0148: the JavaScript id half, and the gate that keeps its duplicated
// prefix constants honest against the Rust-generated registry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BODY_LENGTH,
  ID_PREFIXES,
  MAX_PREFIX_LENGTH,
  encodeBody,
  isWellFormedId,
  mintId,
  splitId,
  tablePrefix,
} from './ids.mjs';
import { createClientMutationId } from './client-store.mjs';

const registry = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../schemas/id-registry.v1.json', import.meta.url)), 'utf8'),
);

// --- the drift gate -------------------------------------------------------
// `ids.mjs` inlines its prefixes because it ships in a published package and
// cannot read a repo-root build artifact at runtime. This is what keeps that
// copy from diverging from what the Rust runtime actually mints.
{
  assert.equal(BODY_LENGTH, registry.bodyLength);
  assert.equal(MAX_PREFIX_LENGTH, registry.maxPrefixLength);
  const byPrefix = new Map(registry.kinds.map((entry) => [entry.prefix, entry]));
  for (const [name, prefix] of Object.entries(ID_PREFIXES)) {
    assert.ok(
      byPrefix.has(prefix),
      `ids.mjs mints ${name} as ${prefix}_, which is not in schemas/id-registry.v1.json — `
        + 'regenerate with `cargo run -p snapback-tools --bin snapback-schemagen` or fix the constant',
    );
    assert.equal(
      byPrefix.get(prefix).body,
      'timeOrdered',
      `ids.mjs mints ${prefix}_ time-ordered; the registry says otherwise`,
    );
  }
}

// --- encoding matches the Rust half ---------------------------------------
{
  // Fixed vectors, so a change to either encoder is caught rather than both
  // drifting together.
  assert.equal(encodeBody(new Uint8Array(16)), '0'.repeat(26));
  assert.equal(encodeBody(new Uint8Array(16).fill(0xff)), '7' + 'z'.repeat(25));
  assert.equal(
    encodeBody(Uint8Array.from({ length: 16 }, (_, i) => i)),
    '00041061050r3gg28a1c60t3gf',
  );

  for (const body of [encodeBody(new Uint8Array(16)), encodeBody(new Uint8Array(16).fill(7))]) {
    assert.equal(body.length, BODY_LENGTH);
    for (const char of body) assert.ok(!'ilou'.includes(char), `ambiguous character ${char}`);
  }
}

// --- minting --------------------------------------------------------------
{
  const id = mintId(ID_PREFIXES.mutation);
  assert.ok(isWellFormedId(id), id);
  assert.deepEqual(splitId(id)?.prefix, 'mut');

  // Time-ordered bodies sort in mint order, which is the property the whole
  // ordering story rests on.
  const early = mintId('mut', 1_000);
  const late = mintId('mut', 2_000);
  assert.ok(early < late, `${early} !< ${late}`);

  assert.throws(() => mintId('Bad'), TypeError);
  assert.throws(() => mintId('has_underscore'), TypeError);
  assert.throws(() => encodeBody(new Uint8Array(8)), TypeError);
}

// --- pre-0148 ids are recognized as "not this format", not as errors ------
{
  assert.equal(splitId('550e8400-e29b-71d4-a716-446655440000'), null);
  assert.equal(splitId('cm_9f8e7d6c5b4a39281706'), null);
  assert.equal(splitId(''), null);
  assert.equal(splitId(null), null);
  // `x` is in the alphabet, so this one is genuinely well formed...
  assert.equal(isWellFormedId(`mut_${'x'.repeat(26)}`), true);
  // ...while the four excluded letters are exactly what a mistranscribed id
  // turns into, and they must not resolve.
  for (const excluded of ['i', 'l', 'o', 'u']) {
    assert.equal(isWellFormedId(`mut_${excluded.repeat(26)}`), false, excluded);
  }
}

// --- table prefixes mirror src/ids.rs -------------------------------------
{
  assert.equal(tablePrefix('posts'), 'posts');
  assert.equal(tablePrefix('blogPosts'), 'blogposts');
  assert.equal(tablePrefix('blog_posts'), 'blogposts');
  assert.equal(tablePrefix('blogPostsArchive'), 'blogpostsarc');
  assert.equal(tablePrefix('blogPostsArchive'), tablePrefix('blogPostsArchived'));
  assert.equal(tablePrefix('____'), ID_PREFIXES.opaque);
  assert.equal(tablePrefix('9lives'), ID_PREFIXES.opaque);
}

// --- the client mutation id rides the registry ----------------------------
{
  const id = createClientMutationId();
  assert.ok(isWellFormedId(id), id);
  assert.equal(splitId(id).prefix, ID_PREFIXES.mutation);
  assert.equal(splitId(createClientMutationId('lease')).prefix, ID_PREFIXES.lease);
}

console.log('ok - packages/snapback-contract/ids.test.mjs');
