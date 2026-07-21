import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, '@snapback/runtime-darwin-arm64');
assert.deepEqual(manifest.os, ['darwin']);
assert.deepEqual(manifest.cpu, ['arm64']);
assert.deepEqual(manifest.files, ['bin', 'Frameworks']);
console.log('package.test.mjs: platform package identity and explicit closure pass');
