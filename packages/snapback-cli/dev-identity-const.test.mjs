import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEV_IDENTITY_ENFORCEMENT_FLIP } from './dev-identity.mjs';

const rustSource = readFileSync(
  new URL('../../crates/snapback-auth/src/dev_identity.rs', import.meta.url),
  'utf8',
);
const rustFlip = /pub const DEV_IDENTITY_ENFORCEMENT_FLIP: &str = "([^"]+)";/u
  .exec(rustSource)?.[1];

assert.ok(rustFlip, 'snapback-auth must declare DEV_IDENTITY_ENFORCEMENT_FLIP');
assert.equal(
  DEV_IDENTITY_ENFORCEMENT_FLIP,
  rustFlip,
  'the CLI enforcement-flip projection must match snapback-auth',
);

console.log('dev-identity-const.test.mjs: JS enforcement flip matches snapback-auth');
