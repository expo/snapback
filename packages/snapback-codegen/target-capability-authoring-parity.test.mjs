import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { targetCapabilityAuthoringVocabularyCanonicalJson } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
// @ref LLP 0134#9-acceptance — capability_v0.rs binds this committed
// canonical projection to TargetCapabilityId::ALL; this test binds the next
// edge, from the Rust-owned projection to codegen's authoring vocabulary.
const registered = JSON.parse(readFileSync(
  join(packageDir, '..', '..', 'tests', 'acceptance', 'capability-registry.ids.json'),
  'utf8',
));
const vocabulary = JSON.parse(targetCapabilityAuthoringVocabularyCanonicalJson());

const expectedIntentionallyNonAuthorable = [
  {
    id: 'asset_image_finalization_v1',
    reason: 'image finalization is derived from typed asset intent policy so its target preflight cannot be bypassed by a free-form schema requirement',
    bindingOffers: 'feature-derived-only',
    clientAdmission: 'feature-derived-only',
  },
  {
    id: 'asset_image_pipeline_v1',
    reason: 'the image pipeline is derived from typed asset declarations so its media-policy preflight remains authoritative',
    bindingOffers: 'feature-derived-only',
    clientAdmission: 'feature-derived-only',
  },
  {
    id: 'asset_lifecycle_v1',
    reason: 'asset lifecycle requirements are derived from typed asset intents rather than free-form schema requirements',
    bindingOffers: 'feature-derived-only',
    clientAdmission: 'feature-derived-only',
  },
  {
    id: 'asset_reference_gc_v1',
    reason: 'reference GC is admitted only through schema assets.referenceGc and its target-bound grace-policy checks',
    bindingOffers: 'feature-derived-only',
    clientAdmission: 'feature-derived-only',
  },
  {
    id: 'asset_video_finalization_v1',
    reason: 'video finalization is derived from typed asset intent policy so its target preflight cannot be bypassed by a free-form schema requirement',
    bindingOffers: 'feature-derived-only',
    clientAdmission: 'feature-derived-only',
  },
  {
    id: 'offline_mutation_replay',
    reason: 'authorability is withheld until settlement-ledger binding offers and queue-aware client admission land as one owned unit',
    bindingOffers: 'not-offered',
    clientAdmission: 'not-admitted',
  },
];

assert.deepEqual(
  vocabulary.intentionallyNonAuthorable,
  expectedIntentionallyNonAuthorable,
  'the intentionally non-authorable registry allowlist or its reasons changed',
);
const authorable = new Set(vocabulary.authorable);
const intentionallyNonAuthorable = new Set(
  vocabulary.intentionallyNonAuthorable.map(({ id }) => id),
);
assert.equal(
  [...authorable].some((id) => intentionallyNonAuthorable.has(id)),
  false,
  'a target capability cannot be both authorable and intentionally non-authorable',
);
assert.deepEqual(
  [...new Set([...authorable, ...intentionallyNonAuthorable])].sort(),
  [...registered].sort(),
  'every Rust target capability id must be schema-authorable or explicitly reasoned as non-authorable',
);

console.log('target-capability-authoring-parity.test.mjs: 45 registry ids = 39 authorable + 6 intentionally non-authorable');
