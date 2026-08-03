import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  digestSourceInputs,
  validateSourceInputs,
} from './telemetry-phase1-evidence.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('transitive idle-launch harness bytes are in the evidence freshness closure', () => {
  const sourceInputs = digestSourceInputs();
  const transitiveHarnessFiles = [
    'demos/_kit/provenance.mjs',
    'packages/snapback-cli/runtime-readiness.mjs',
    'packages/snapback-cli/runtime-recovery.mjs',
    'scripts/lib/process-tree.mjs',
    'scripts/runtime-link-smoke.mjs',
  ];
  for (const file of transitiveHarnessFiles) {
    assert(sourceInputs.files.includes(file), `${file} must invalidate retained evidence`);
  }

  assert.throws(
    () => validateSourceInputs(sourceInputs, (file) => {
      const original = readFileSync(join(repoRoot, file));
      return file === 'scripts/lib/process-tree.mjs'
        ? Buffer.concat([original, Buffer.from('\n// simulated transitive harness mutation\n')])
        : original;
    }),
    /proof-source digest freshness/,
    'the validator must stale the receipt after a transitive harness mutation',
  );
});
