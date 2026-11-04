import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = process.env.ROOT;
assert.ok(root && process.env.SNAPBACK4_WAVE21_ROOT);
assert.equal(process.env.SNAPBACK4_BIN, undefined);
const {proveDX5Upgrades} = await import(pathToFileURL(join(root, 'scripts/publication-dx5-upgrade.mjs')));
const [client, platform, output] = process.argv.slice(2);
const results = await proveDX5Upgrades(client, platform, {evidenceOnly: true});
assert.equal(results.length, 2);
assert.equal(results.find(row => row.lane === 'wave21-025').checks, 80);
assert.equal(results.find(row => row.lane === 'wave21-002').users, 8);
assert.ok(results.every(row => row.status === 'passed'));
writeFileSync(output, JSON.stringify({purpose: 'environment recovery diagnostic only', publicationQualified: false, results}, null, 2) + '\n', {flag: 'wx'});
console.log('WAVE21 ENVIRONMENT CHECK PASS: unchanged historical acceptance 80/80 and foreground prod:serve 8 users; not publication qualification');
