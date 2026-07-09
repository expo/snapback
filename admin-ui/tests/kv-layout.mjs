// Admin overview Kv layout regression (ENG-23838).
//
// Long unbroken Storage values (especially SQLite path) must ellipsize inside
// the card instead of painting into neighboring Overview cards. The Contract
// source is the authority here: the admin UI has no DOM visual-diff harness
// for this surface, so we lock the layout attributes that Exact lowers into
// overflow:hidden + text-overflow:ellipsis on web.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractSource = readFileSync(join(adminRoot, 'app.contract'), 'utf8');

const kvComponent = extractComponent(contractSource, 'Kv');
assert.ok(kvComponent, 'component Kv must exist in admin-ui/app.contract');

// Value text: shrink into the row and single-line ellipsize.
assert.match(
  kvComponent,
  /text\s+v\b[^\n]*\bflex\s*=\s*1\b[^\n]*\bminWidth\s*=\s*0\b/,
  'Kv value must flex-share the row (flex=1 minWidth=0)',
);
assert.match(
  kvComponent,
  /text\s+v\b[^\n]*\bnumberOfLines\s*=\s*1\b/,
  'Kv value must truncate with numberOfLines=1 so unbroken paths cannot overflow',
);
assert.match(
  kvComponent,
  /text\s+v\b[^\n]*\bellipsizeMode\s*=\s*"tail"/,
  'Kv value should use tail ellipsis for long paths and hashes',
);

// Full value remains inspectable via accessibilityLabel (and the untruncated
// text content still lives in the DOM under CSS ellipsis).
assert.match(
  kvComponent,
  /text\s+v\b[^\n]*\baccessibilityLabel\s*=\s*v\b/,
  'Kv value must expose the full string via accessibilityLabel',
);

const cardComponent = extractComponent(contractSource, 'Card');
assert.ok(cardComponent, 'component Card must exist in admin-ui/app.contract');
assert.match(
  cardComponent,
  /overflow\s*=\s*"hidden"/,
  'Card must clip overflow so any residual long paint cannot bleed into adjacent cards',
);

console.log('admin kv layout: ok');

function extractComponent(source, name) {
  const start = source.search(new RegExp(`^component\\s+${name}\\b`, 'm'));
  if (start < 0) return null;
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^component\s+\w+/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
