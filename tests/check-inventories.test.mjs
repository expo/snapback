import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generatedPublicationPathsOnDisk } from '../scripts/check-agent-safe-publication.mjs';
import { auditDemoCatalog } from '../scripts/demo-catalog.mjs';
import {
  printInventoryCheckResult,
  runInventoryChecks,
} from '../scripts/check-inventories.mjs';
import { auditScriptsTestInventory } from '../scripts/check-scripts-test-inventory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

test('check-inventories prints due GAP review warnings and remains green', () => {
  // Pin the calendar boundary so this remains a stable integration fixture
  // while still running the repository's real check-inventories audit path.
  const result = runInventoryChecks({
    root,
    guideOptions: { gapReviewOptions: { today: '2026-08-25' } },
  });
  const stdout = [];
  const stderr = [];
  const status = printInventoryCheckResult(result, {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
  });
  const output = `${stdout.join('')}${stderr.join('')}`;

  assert.equal(status, 0, output);
  assert.match(
    output,
    /\[check-inventories\] GAP REVIEW WARNING: row 'backend\.structured-stored-fields' expires within 7 days on 2026-08-25; owner: LLP 0115 CV-4b; pointer: issues\/20260727-backend-bakeoff-improvement-program\.md/u,
  );
  assert.match(output, /\[check-inventories\] PASS:/u);
});

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

test('scripts test inventory rejects an unclassified local-proof gate', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-gate-classification-drift-'));
  try {
    write(join(scratch, 'scripts/registered.test.mjs'), '');
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [{
        file: 'scripts/registered.test.mjs',
        disposition: 'run',
        runner: { mechanism: 'verify-local-proof', gateId: 'registered-fixtures' },
      }],
      proofSource: 'run registered-fixtures -- node --test scripts/registered.test.mjs\n',
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { alwaysGates: [], groups: {}, driftProneGates: {} },
    });
    assert.match(audit.errors.join('\n'), /gate registered-fixtures is not classified/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('scripts test inventory rejects a pathname argument to a non-Node command', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-no-op-bypass-'));
  try {
    write(join(scratch, 'scripts/symbol-lifecycle.test.mjs'), '');
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [{
        file: 'scripts/symbol-lifecycle.test.mjs',
        disposition: 'run',
        runner: { mechanism: 'verify-local-proof', gateId: 'no-op-fixtures' },
      }],
      proofSource: 'run no-op-fixtures -- true scripts/symbol-lifecycle.test.mjs\n',
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(audit.errors.join('\n'), /gate no-op-fixtures does not run this file/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

function assertRejectedScriptsTestCommand(command) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-command-grammar-'));
  try {
    write(join(scratch, 'scripts/foo.test.mjs'), '');
    write(join(scratch, 'scripts/wrapper.mjs'), '');
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [{
        file: 'scripts/foo.test.mjs',
        disposition: 'run',
        runner: { mechanism: 'verify-local-proof', gateId: 'grammar-fixtures' },
      }],
      proofSource: `run grammar-fixtures -- ${command}\n`,
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(audit.errors.join('\n'), /gate grammar-fixtures does not run this file/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('scripts test inventory rejects node --eval with a test pathname argument', () => {
  assertRejectedScriptsTestCommand("node --eval '0' scripts/foo.test.mjs");
});

test('scripts test inventory rejects node --test options that can suppress every test', () => {
  assertRejectedScriptsTestCommand(
    'node --test --test-name-pattern=^$ scripts/foo.test.mjs',
  );
});

test('scripts test inventory rejects a Node wrapper with a test pathname argument', () => {
  assertRejectedScriptsTestCommand('node scripts/wrapper.mjs scripts/foo.test.mjs');
});

test('scripts test inventory rejects a comment suffix after a test command', () => {
  assertRejectedScriptsTestCommand('node --test scripts/foo.test.mjs # ignored');
});

test('scripts test inventory rejects a symlinked root test', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-symlink-bypass-'));
  try {
    write(join(scratch, 'fixture-target.mjs'), '');
    mkdirSync(join(scratch, 'scripts'));
    symlinkSync('../fixture-target.mjs', join(scratch, 'scripts/zzz-probe.test.mjs'));
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [],
      proofSource: '',
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(
      audit.errors.join('\n'),
      /scripts\/zzz-probe\.test\.mjs: scripts test inventory refuses symlinks/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('scripts test inventory rejects a symlinked directory without following it', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-directory-symlink-bypass-'));
  try {
    write(join(scratch, 'outside/hidden.test.mjs'), '');
    mkdirSync(join(scratch, 'scripts'));
    symlinkSync('../outside', join(scratch, 'scripts/hidden-dir'));
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [],
      proofSource: '',
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(
      audit.errors.join('\n'),
      /scripts\/hidden-dir: scripts test inventory refuses symlinks/u,
    );
    assert.deepEqual(audit.files, []);
    assert.equal(audit.errors.length, 1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('scripts test inventory rejects shell-unsafe test filenames and command targets', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-shell-unsafe-bypass-'));
  try {
    const file = 'scripts/${X:-safe}.test.mjs';
    write(join(scratch, file), '');
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [{
        file,
        disposition: 'run',
        runner: { mechanism: 'verify-local-proof', gateId: 'unsafe-fixtures' },
      }],
      proofSource: `run unsafe-fixtures -- node --test ${file}\n`,
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(
      audit.errors.join('\n'),
      /scripts test inventory filenames must use only shell-safe/u,
    );
    assert.match(
      audit.errors.join('\n'),
      /inventory path must be a root scripts\/\*\.test\.mjs file/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('scripts test inventory rejects shell-unsafe extra command targets', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-shell-unsafe-target-'));
  try {
    write(join(scratch, 'scripts/foo.test.mjs'), '');
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [{
        file: 'scripts/foo.test.mjs',
        disposition: 'run',
        runner: { mechanism: 'verify-local-proof', gateId: 'unsafe-target-fixtures' },
      }],
      proofSource: 'run unsafe-target-fixtures -- node --test scripts/foo.test.mjs scripts/${X:-safe}.test.mjs\n',
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(
      audit.errors.join('\n'),
      /gate unsafe-target-fixtures does not run this file/u,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('scripts test inventory rejects a nested test outside its root-only scope', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-scripts-nested-bypass-'));
  try {
    write(join(scratch, 'scripts/zzz-nested-probe/zzz-probe.test.mjs'), '');
    const audit = auditScriptsTestInventory({
      root: scratch,
      inventory: [],
      proofSource: '',
      packageInventories: [],
      cloudflareSuites: [],
      selectionPolicy: { driftProneGates: {} },
    });
    assert.match(
      audit.errors.join('\n'),
      /scripts\/zzz-nested-probe\/zzz-probe\.test\.mjs: nested scripts test files are outside the root scripts\/\*\.test\.mjs inventory scope/u,
    );
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
