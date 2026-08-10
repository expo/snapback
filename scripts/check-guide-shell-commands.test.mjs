import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditFiles } from './check-guide-shell-commands.mjs';

const commandSurface = {
  topLevel: new Set(['backup']),
  pathChildren: new Map([
    ['backup', new Set(['create'])],
    ['backup create', new Set(['plan'])],
  ]),
  flags: new Set(['--known', '--json']),
};
const sourceFacts = {
  newestPublished: '1.2.3',
  packageManager: 'bun',
  packageManagerVersion: '1.3.12',
};

async function audit(markdown) {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-guide-shell-'));
  const file = join(directory, 'fixture.md');
  await writeFile(file, markdown);
  try {
    return auditFiles({ commandSurface, sourceFacts, files: [file] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('rejects nonexistent flags and depth-three subcommands', async () => {
  const result = await audit(`\`\`\`sh
snapback backup create nope --not-real
\`\`\`
`);
  assert.deepEqual(
    new Set(result.findings.map((finding) => finding.class)),
    new Set(['unknown-subcommand', 'unknown-flag']),
  );
});

test('binds shell package versions and package manager to authoritative facts', async () => {
  const result = await audit(`\`\`\`sh
npx --yes @expo/snapback-cli@1.2.2 new example
npm install
\`\`\`
`);
  assert.deepEqual(
    new Set(result.findings.map((finding) => finding.class)),
    new Set(['stale-closure-version', 'package-manager-mismatch']),
  );
});

test('accepts source-bound commands without executing placeholder-bearing operations', async () => {
  const result = await audit(`\`\`\`sh
snapback backup create plan --known <target>
npx --yes @expo/snapback-cli@1.2.3 new example
bun install
\`\`\`
`);
  assert.equal(result.findings.length, 0);
  assert.equal(result.invocationCount, 1);
});

test('requires machine-readable class and reason for shell-check exceptions', async () => {
  const invalid = await audit(`\`\`\`sh shell-check=skip class="credentialed"
snapback imaginary --not-real
\`\`\`
`);
  assert(invalid.findings.some((finding) => finding.class === 'invalid-exception'));

  const valid = await audit(`\`\`\`sh shell-check=skip class="credentialed" reason="requires operator secrets"
snapback imaginary --not-real
\`\`\`
`);
  assert.equal(valid.findings.length, 0);
});
