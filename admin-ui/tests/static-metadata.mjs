// Admin static metadata regression test.
//
// @ref LLP 0017#static-bundling-and-the-native-shell - Exact scans the static
// entry source for app metadata used by web HTML and native shell artifacts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const entrySource = readFileSync(join(adminRoot, 'src', 'main.ts'), 'utf8');
const appConfig = exactStyleCreateAppLiteral(entrySource);

assert.match(
  appConfig,
  /\btitle\s*:\s*'Snapback Admin Console'/,
  'Exact static entry must expose the Snapback admin title in the first createApp call',
);
assert.match(
  appConfig,
  /\bthemeColor\s*:\s*'#5e6ad2'/,
  'Exact static entry should expose Snapback theme color metadata',
);

const routeSource = readFileSync(
  join(adminRoot, 'src', 'app', 'routes.ts'),
  'utf8',
);
assert.match(
  routeSource,
  /screen:\s*\{\s*title:\s*'Snapback Admin Console'\s*\}/,
  'route screen title should match the admin document title',
);

const fallbackConsole = readFileSync(
  resolve(adminRoot, '..', 'src', 'admin', 'console.html'),
  'utf8',
);
assert.match(
  fallbackConsole,
  /<title>Snapback Admin Console<\/title>/,
  'embedded fallback console title should match the admin document title',
);

console.log('admin static metadata: ok');

function exactStyleCreateAppLiteral(source) {
  const callIndex = source.indexOf('createApp(');
  assert.notEqual(callIndex, -1, 'static entry must contain a literal createApp call');

  const openBraceIndex = source.indexOf('{', callIndex);
  assert.notEqual(openBraceIndex, -1, 'createApp call must pass an object literal');

  return readBalancedBlock(source, openBraceIndex, '{', '}');
}

function readBalancedBlock(source, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail('createApp object literal must be balanced');
}
