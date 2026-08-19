import assert from 'node:assert/strict';
import {
  CLOUDFLARE_TARGET_PROFILE,
  STRICT_DECLARATIONS_TARGET_UNSUPPORTED_CODE,
  strictDeclarationsTargetRefusal,
} from '../src/target-admission.js';

const cloudflareStrictRefusal = strictDeclarationsTargetRefusal(
  { strictDeclarations: true },
  { targetProfile: CLOUDFLARE_TARGET_PROFILE, enforcesStrictDeclarations: false },
);
assert.equal(cloudflareStrictRefusal?.code, STRICT_DECLARATIONS_TARGET_UNSUPPORTED_CODE);
assert.equal(cloudflareStrictRefusal?.details.targetProfile, CLOUDFLARE_TARGET_PROFILE);
assert.match(cloudflareStrictRefusal?.message || '', /remove the flag or use a target profile/);

assert.equal(
  strictDeclarationsTargetRefusal(
    { strictDeclarations: true },
    { targetProfile: 'local-dev-sqlite-ibex', enforcesStrictDeclarations: true },
  ),
  null,
  'the enforcing local target must continue to admit strict declarations',
);

assert.equal(
  strictDeclarationsTargetRefusal(
    {},
    { targetProfile: CLOUDFLARE_TARGET_PROFILE, enforcesStrictDeclarations: false },
  ),
  null,
  'the default declaration-evidence posture remains admissible on Cloudflare',
);

console.log('cloudflare target-admission tests: 3/3 strict-refusal/default/local-admission scenarios passed');
