import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = new URL('../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('client card retains its 114-line and 1200-word budgets with default and prediction guidance', () => {
  const card = read('crates/snapback4-lang/src/guide/client.md');
  assert.ok(card.trimEnd().split('\n').length <= 114);
  assert.ok(card.trim().split(/\s+/).length <= 1200);
  assert.match(card, /defaults to progressive startup/);
  assert.match(card, /startup: "awaited"/);
  assert.match(card, /Journal-owned documents predict no ordinary writes until the next open/);
  const lead = card.split('\n\n')[1];
  assert.ok(lead.trim().split(/\s+/).length <= 45);
  assert.ok((lead.match(/\./g) ?? []).length <= 2);
  assert.doesNotMatch(card, /\bLLP\s+\d/);
});

test('prediction and reference distinguish first-visit journal writes from next-open outbox prediction', () => {
  const reference = read('packages/snapback4/reference/CLIENT-AND-OPERATIONS.md');
  assert.match(reference, /Writes in a journal-owned document, until the next open, have no local prediction/);
  assert.match(reference, /four-second default wait/);
  assert.match(reference, /Persona web apps require IndexedDB-backed journal\nauthority in both startup modes/);
  const prediction = read('crates/snapback4-lang/src/guide/prediction.rs');
  assert.match(prediction, /A first-visit web document journals writes without prediction until the next open/);
  assert.match(prediction, /a returning one with an empty journal and a compatible device predicts from held facts or queues/);
});

test('default-flip changelog entry has the next patch semver heading', () => {
  const changelog = read('packages/snapback4/reference/CHANGELOG.md');
  const [next, previous] = [...changelog.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  const parts = previous.split('.').map(Number);
  assert.equal(next, `${parts[0]}.${parts[1]}.${parts[2] + 1}`);
  assert.match(changelog.split('\n## ')[1], /progressive startup/);
});

test('opening journal admission-barrier omission and its custody rationale are disclosed', () => {
  const reference = read('packages/snapback4/reference/CLIENT-AND-OPERATIONS.md');
  assert.match(reference, /Opening pending ids skip a separate admission change barrier: intersecting reads\nalready wait on journal custody, and settlement installs the receipt cut/);
  assert.doesNotMatch(reference.replace(/<!--[\s\S]*?-->/g, ''), /\bLLP\s+\d/);
});

// Published starter identities immediately before Lane D (634fb6c821^).
// adapt.rs normalizes ports/whitespace, but does not discard comments. Any
// intentional future template change must retain recognized previous bytes.
const published = {
  "crates/snapback4/src/verbs/init/expo-client.ts": "8d878fd9359c3faaeab74484d36c4f39d256b6bf0f36885a23205c3b6240ffbd",
  "crates/snapback4/src/verbs/init/web-client.ts": "af8af0321a663c093ea7cdf8ede4fab5b90a0901340773eb8e02312b21c082f6",
  "crates/snapback4/src/verbs/init/social/client.ts": "07acead74c2a8ecf6b291dadb618bda01314951be4287ecfc1a3971c73542a88",
  "crates/snapback4/src/verbs/init/starter/web/client.ts": "a7a08c15fb6d0b3673de6f126e5575c6c58017a92dbcbd3192f88c25c790d509",
  "crates/snapback4/src/verbs/init/starter/expo/client.ts": "1d34ab21952628262e9b596a5dbeba05a68d56508d549fec2b3ffa7b33cda6a9",
  "crates/snapback4/src/verbs/init/starter/personas/expo-client.ts": "87fc188ac510dbde80de82542689e62429446c666c0b9e1db9516ee6bafe66dd",
  "crates/snapback4/src/verbs/init/starter/personas/web-client.ts": "0bc5e1e06af8ea76d5261c466b8c6f1ab5dbffc55f62922502c41ca2c7c6e007",
  "crates/snapback4/src/verbs/init/starter/production/expo-client.ts": "cb1044e54839e42343c75afec987046da26c2812155b0366620108a2303fffd4",
  "crates/snapback4/src/verbs/init/starter/production/web-client.ts": "b5bd6555f023ba542484629ff4aeb8c3ccc7e28b7039bb1dc17885d736ac073d"
};
for (const [path, digest] of Object.entries(published)) test(`published starter remains byte-compatible for init --adapt: ${path}`, () => {
  assert.equal(createHash('sha256').update(read(path)).digest('hex'), digest);
});
