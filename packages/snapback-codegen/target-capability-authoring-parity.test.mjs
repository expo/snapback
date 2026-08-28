import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  codegenRequiredTargetCapabilityIdsCanonicalJson,
  experimentalTargetCapabilityIdsCanonicalJson,
  targetCapabilityAuthoringVocabularyCanonicalJson,
} from './index.mjs';

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
    id: 'auth.guest-sessions',
    reason: 'guest entry is derived from the normalized auth program and generated bootstrap policy rather than a free-form schema requirement',
    bindingOffers: 'target-evidence-intersection',
    clientAdmission: 'auth-bootstrap-policy-derived',
  },
  {
    id: 'auth.passwords',
    reason: 'password entry is derived from the normalized auth program and generated bootstrap policy rather than a free-form schema requirement',
    bindingOffers: 'target-evidence-intersection',
    clientAdmission: 'auth-bootstrap-policy-derived',
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

const localTarget = JSON.parse(readFileSync(
  join(packageDir, '..', '..', 'schemas', 'capability.manifest.local-dev-sqlite-ibex.json'),
  'utf8',
));
const publicationRequired = JSON.parse(
  codegenRequiredTargetCapabilityIdsCanonicalJson(),
);
assert.deepEqual(
  publicationRequired,
  [...localTarget.supportedCapabilities].sort(),
  'publication requirements are the exact Rust-derived local target set codegen can admit',
);
assert.equal(
  publicationRequired.includes('assets.media-collection.v1'),
  true,
  'experimental media collections remain publication requirements',
);
assert.equal(
  JSON.parse(experimentalTargetCapabilityIdsCanonicalJson())
    .includes('assets.media-collection.v1'),
  true,
  'the media-collection publication requirement exercises the experimental policy',
);
assert.equal(
  publicationRequired.includes('agent_safe_storage_v1'),
  false,
  'a target gap is refused before codegen output rather than becoming a publication requirement',
);

console.log(`target-capability-authoring-parity.test.mjs: 47 registry ids = 40 authorable + 7 intentionally non-authorable; ${publicationRequired.length} publication requirements`);
