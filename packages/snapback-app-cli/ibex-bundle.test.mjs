import assert from 'node:assert/strict';

import { normalizeIbexParentBundle } from './ibex-bundle.mjs';

const normalized = normalizeIbexParentBundle(`#!/usr/bin/env node
import { mkdir as a, readFile as b } from "node:fs/promises";
const first = () => a("one");
import { mkdir as c } from "node:fs/promises";
import { resolve as d } from "node:path";
const second = () => [b("two"), c("three"), d("four")];
`);
assert.equal((normalized.match(/from "node:fs\/promises"/gu) ?? []).length, 1);
assert.equal((normalized.match(/from "node:path"/gu) ?? []).length, 1);
assert.ok(normalized.startsWith('#!/usr/bin/env node\n'));
assert.match(normalized, /import __ibexBuiltin0 from "node:fs\/promises";/u);
assert.match(normalized, /const a = __ibexBuiltin0\["mkdir"\];/u);
assert.match(normalized, /const c = __ibexBuiltin0\["mkdir"\];/u);
assert.match(normalized, /import __ibexBuiltin1 from "node:path";/u);
assert.match(normalized, /const d = __ibexBuiltin1\["resolve"\];/u);

assert.throws(
  () => normalizeIbexParentBundle('import value from "node:fs";'),
  /unsupported static builtin import remains/u,
);

console.log('Ibex parent bundle normalization tests passed');
