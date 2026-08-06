import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generatedPublicationPathsOnDisk } from '../scripts/check-agent-safe-publication.mjs';
import { runInventoryChecks } from '../scripts/check-inventories.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

test('fast inventory checker catches synthetic drift in every inventory class', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-inventory-drift-'));
  try {
    write(join(scratch, 'package.json'), JSON.stringify({
      scripts: {
        test: 'node tests/registered.test.mjs && node tests/synthetic.test.mjs',
      },
    }));
    write(join(scratch, 'tests/registered.test.mjs'), '');
    write(join(scratch, 'tests/synthetic.test.mjs'), '');
    for (const id of ['registered-demo', 'synthetic-demo']) {
      write(join(scratch, `demos/${id}/demo.snapback.json`), JSON.stringify({ id }));
    }

    const generated = generatedPublicationPathsOnDisk(root);
    generated.set('admin-ui/generated/synthetic-inventory-drift.ts', {
      mode: '100644',
      type: 'blob',
    });

    const result = runInventoryChecks({
      root,
      packageOptions: {
        root: scratch,
        inventories: [{
          id: 'synthetic-package',
          packageDir: '.',
          testDir: 'tests',
          suffix: '.test.mjs',
          expectedFiles: ['tests/registered.test.mjs'],
        }],
        expectedTotal: 2,
      },
      demoOptions: { root: scratch, expectedIds: ['registered-demo'] },
      publicationOptions: { generated },
      guideOptions: {
        readGeneratedFile: (path) => {
          const bytes = readFileSync(join(root, path), 'utf8');
          if (!path.endsWith('guide-manifest.generated.json')) return bytes;
          const manifest = JSON.parse(bytes);
          manifest.syntheticInventoryDrift = true;
          return JSON.stringify(manifest);
        },
      },
    });

    assert.deepEqual(
      result.failures.map(({ id }) => id),
      [
        'package-test',
        'demo-materialization',
        'agent-safe-publication-leaf-set',
        'guide-manifest',
      ],
    );
    assert.match(result.failures[0].lines.join('\n'), /synthetic\.test\.mjs/u);
    assert.match(result.failures[1].lines.join('\n'), /synthetic-demo/u);
    assert.match(result.failures[2].lines.join('\n'), /synthetic-inventory-drift\.ts/u);
    assert.match(result.failures[3].lines.join('\n'), /guide-manifest\.generated\.json/u);
    for (const failure of result.failures) assert.match(failure.registration, /\S/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
