import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generatedPublicationPathsOnDisk } from '../scripts/check-agent-safe-publication.mjs';
import { auditDemoCatalog } from '../scripts/demo-catalog.mjs';
import { runInventoryChecks } from '../scripts/check-inventories.mjs';
import { auditScriptsTestInventory } from '../scripts/check-scripts-test-inventory.mjs';

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
    write(join(scratch, 'scripts/registered.test.mjs'), '');
    write(join(scratch, 'scripts/synthetic.test.mjs'), '');
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
      scriptsTestOptions: {
        root: scratch,
        inventory: [{
          file: 'scripts/registered.test.mjs',
          disposition: 'run',
          runner: { mechanism: 'verify-local-proof', gateId: 'synthetic-script-fixtures' },
        }],
        proofSource: 'run synthetic-script-fixtures -- node --test scripts/registered.test.mjs\n',
        packageInventories: [],
        cloudflareSuites: [],
        selectionPolicy: { driftProneGates: {} },
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
        'scripts-test',
        'demo-materialization',
        'agent-safe-publication-leaf-set',
        'guide-manifest',
      ],
    );
    assert.match(result.failures[0].lines.join('\n'), /synthetic\.test\.mjs/u);
    assert.match(result.failures[1].lines.join('\n'), /scripts\/synthetic\.test\.mjs/u);
    assert.match(result.failures[2].lines.join('\n'), /synthetic-demo/u);
    assert.match(result.failures[3].lines.join('\n'), /synthetic-inventory-drift\.ts/u);
    assert.match(result.failures[4].lines.join('\n'), /guide source error|guide-manifest\.generated\.json/u);
    for (const failure of result.failures) assert.match(failure.registration, /\S/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('scripts test inventory rejects a missing local-proof gate', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-gate-drift-'));
  try {
    write(join(scratch, 'scripts/registered.test.mjs'), '');
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [{
        file: 'scripts/registered.test.mjs',
        disposition: 'run',
        runner: { mechanism: 'verify-local-proof', gateId: 'missing-fixtures' },
      }],
      proofSource: 'run other-fixtures -- node --test scripts/registered.test.mjs\n',
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(audit.errors.join('\n'), /gate missing-fixtures does not exist/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('same-named package test cannot cover a root scripts test', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-package-name-collision-'));
  try {
    write(join(scratch, 'scripts/packaged-store-qualification.test.mjs'), '');
    write(join(scratch, 'packages/snapback-cli/packaged-store-qualification.test.mjs'), '');
    write(join(scratch, 'packages/snapback-cli/package.json'), JSON.stringify({
      scripts: { test: 'node packaged-store-qualification.test.mjs' },
    }));
    const packageInventory = {
      id: '@expo/snapback-cli',
      packageDir: 'packages/snapback-cli',
      testDir: '.',
      suffix: '.test.mjs',
      expectedFiles: ['packaged-store-qualification.test.mjs'],
    };
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [{
        file: 'scripts/packaged-store-qualification.test.mjs',
        disposition: 'run',
        runner: {
          mechanism: 'package-inventory',
          inventoryId: '@expo/snapback-cli',
          expectedFile: 'packaged-store-qualification.test.mjs',
        },
      }],
      proofSource: '',
      packageInventories: [packageInventory],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(audit.errors.join('\n'), /does not name this exact file/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

function demoEntry(id) {
  return {
    id,
    directory: `demos/${id}`,
    teaches: `${id} teaches one bounded behavior.`,
    clients: ['headless'],
    targets: ['local'],
    maturity: 'reference',
    run: `node demos/${id}/proof.mjs`,
    proof: `node demos/${id}/proof.mjs`,
    expectedEvidence: 'A passing bounded proof trace.',
    evidence: [`demos/${id}/proof.mjs`],
    documentation: { status: 'contract', path: `demos/${id}/README.md` },
  };
}

function writeDemo(rootPath, id, extra = {}) {
  write(join(rootPath, `demos/${id}/demo.snapback.json`), JSON.stringify({
    id,
    description: `${id} teaches one bounded behavior.`,
    notClaiming: ['hosted or production behavior'],
    ...extra,
  }));
  write(join(rootPath, `demos/${id}/proof.mjs`), '');
  write(
    join(rootPath, `demos/${id}/README.md`),
    `# ${id}\n\nRun and proof: \`node demos/${id}/proof.mjs\`.\n\nNot claiming hosted or production behavior.\n`,
  );
}

function writeHumanCatalog(rootPath, ids) {
  write(
    join(rootPath, 'demos/README.md'),
    `| Demo | What | Surfaces | README |\n| --- | --- | --- | --- |\n${ids.map((id) => `| \`${id}\` | bounded | headless | yes |`).join('\n')}\n`,
  );
}

test('demo catalog fixture rejects an undocumented metadata-declared demo', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-demo-catalog-undocumented-'));
  try {
    writeDemo(scratch, 'documented');
    writeDemo(scratch, 'undocumented');
    writeHumanCatalog(scratch, ['documented', 'undocumented']);
    const audit = auditDemoCatalog({
      root: scratch,
      catalog: { schemaVersion: 'snapback.demo-catalog.v1', entries: [demoEntry('documented')] },
      capabilities: new Map(),
    });
    assert(audit.errors.some((error) => /'undocumented' is undocumented/u.test(error)));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('demo catalog fixture rejects unqualified and contradicted current GAP claims', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-demo-catalog-gap-'));
  try {
    writeDemo(scratch, 'stale-gap', { capabilityGaps: ['clients.react'] });
    writeHumanCatalog(scratch, ['stale-gap']);
    const options = {
      root: scratch,
      catalog: { schemaVersion: 'snapback.demo-catalog.v1', entries: [demoEntry('stale-gap')] },
      capabilities: new Map([['clients.react', { page: 'clients/react.md' }]]),
    };
    const unqualified = auditDemoCatalog(options);
    assert(unqualified.errors.some((error) => /requires a dated capabilityGapsBoundary/u.test(error)));

    writeDemo(scratch, 'stale-gap', {
      capabilityGaps: ['clients.react'],
      capabilityGapsBoundary: {
        status: 'current-platform',
        asOf: '2026-08-10',
        authority: 'guide/capabilities.md',
        reason: 'Claimed as a current platform gap for this regression fixture.',
      },
    });
    const contradicted = auditDemoCatalog(options);
    assert(contradicted.errors.some((error) => /contradicts non-GAP capability row/u.test(error)));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
