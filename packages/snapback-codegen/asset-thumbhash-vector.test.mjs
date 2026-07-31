// Cross-family check for the Rust ThumbHash encoder (LLP 0044 P-03): the
// committed vector below is produced by src/assets_image.rs (see the pinned
// `asset_image_derived_facts_pin_placeholder_and_dominant_color` test) from a
// solid #c82814 32x32 image, and must decode sensibly with the *reference*
// decoder so client-side thumbhash libraries render our placeholders.
//
// The decoder here is vendored verbatim-in-spirit from the published
// reference implementation (Evan Wallace, thumbhash, MIT license) — decode
// half only, average color + aspect ratio, which is what the check needs.

import assert from 'node:assert/strict';
import test from 'node:test';

const SOLID_RED_VECTOR = 'FTsDBwAwZIZ3d4eHiGd3l4h3CIpjoDgG';
const LANDSCAPE_VECTOR = 'SBcGFIZwh3d0iHeHeHePiwi4hw';

function thumbHashToAverageRGBA(hash) {
  const header = hash[0] | (hash[1] << 8) | (hash[2] << 16);
  const l = (header & 63) / 63;
  const p = ((header >> 6) & 63) / 31.5 - 1;
  const q = ((header >> 12) & 63) / 31.5 - 1;
  const hasAlpha = header >> 23;
  const a = hasAlpha ? (hash[5] & 15) / 15 : 1;
  const b = l - (2 / 3) * p;
  const r = (3 * l - b + q) / 2;
  const g = r - q;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  return { r: clamp(r), g: clamp(g), b: clamp(b), a };
}

function thumbHashToApproximateAspectRatio(hash) {
  const header = hash[3];
  const hasAlpha = hash[2] & 0x80;
  const isLandscape = hash[4] & 0x80;
  const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7;
  const ly = isLandscape ? header & 7 : hasAlpha ? 5 : 7;
  return lx / ly;
}

function fromBase64(value) {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

test('the solid-red vector decodes red-dominant and opaque', () => {
  const hash = fromBase64(SOLID_RED_VECTOR);
  const { r, g, b, a } = thumbHashToAverageRGBA(hash);
  assert.equal(a, 1, 'opaque input must decode opaque');
  assert.ok(r > g && r > b, `red must dominate (r=${r} g=${g} b=${b})`);
  assert.ok(r > 0.5, `red channel must be strong (r=${r})`);
});

test('the landscape vector reports a landscape aspect ratio', () => {
  const hash = fromBase64(LANDSCAPE_VECTOR);
  assert.ok(hash[4] & 0x80, 'the landscape bit must be set for a 64x32 input');
  assert.ok(
    thumbHashToApproximateAspectRatio(hash) > 1,
    'aspect ratio must exceed 1 for landscape',
  );
});
