import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { importExactContractExport, resolveExactContractExport } from './exact-package.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-exact-package-alias-'));
const packageRoot = join(root, 'node_modules', '@exact', 'contract');

try {
  mkdirSync(join(packageRoot, 'src', 'compiler'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@ccheever/exact-contract',
      version: '0.1.2',
      exports: {
        './compiler': { import: './src/compiler/index.ts' },
        './runtime': { import: './src/runtime/index.mjs' },
      },
    }),
  );
  writeFileSync(join(packageRoot, 'src', 'compiler', 'index.ts'), 'export const compiler = true;\n');
  mkdirSync(join(packageRoot, 'src', 'runtime'), { recursive: true });

  const resolved = resolveExactContractExport('./compiler', { exactRoot: root });
  assert(resolved);
  assert.equal(resolved.packageRoot, packageRoot);
  assert.equal(resolved.path, join(packageRoot, 'src', 'compiler', 'index.ts'));
  assert.equal(resolved.specifier, '@exact/contract/compiler');

  // An explicit checkout is selected directly and imports its real export.
  writeFileSync(join(packageRoot, 'src', 'compiler', 'index.ts'), 'export const compiler = "explicit";\n');
  const imported = await importExactContractExport('./compiler', { exactRoot: root });
  assert.equal(imported.compiler, 'explicit');

  // Once the package specifier resolves, an initialization failure is the
  // selected package's failure. It must never be translated into a missing-
  // package diagnostic or hidden by a checkout fallback.
  const brokenPath = join(packageRoot, 'src', 'runtime', 'index.mjs');
  writeFileSync(brokenPath, 'throw Object.assign(new Error("installed package exploded"), { code: "EXACT_FIXTURE_BROKEN" });\n');
  await assert.rejects(
    importExactContractExport('./runtime', {
      resolveSpecifier: () => pathToFileURL(brokenPath).href,
    }),
    (error) => error.code === 'EXACT_FIXTURE_BROKEN',
  );

  // Resolution failures other than the optional package genuinely being
  // absent are selected-environment failures and must propagate unchanged.
  for (const resolutionError of [
    Object.assign(new Error('invalid package config'), { code: 'ERR_INVALID_PACKAGE_CONFIG' }),
    Object.assign(new Error("Cannot find package 'some-transitive-package'"), { code: 'ERR_MODULE_NOT_FOUND' }),
  ]) {
    await assert.rejects(
      importExactContractExport('./runtime', {
        resolveSpecifier: () => {
          throw resolutionError;
        },
      }),
      (error) => error === resolutionError,
    );
  }

  // Export targets must use the package-relative `./` form and remain inside
  // the package both lexically and after symlink resolution.
  const writeCompilerExport = (target) => {
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@ccheever/exact-contract',
        version: '0.1.2',
        exports: {
          './compiler': { import: target },
          './runtime': { import: './src/runtime/index.mjs' },
        },
      }),
    );
  };

  // Legacy `main` is package-relative without the modern export target's
  // required `./`; normalize it safely rather than regressing root packages.
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@ccheever/exact-contract',
      version: '0.1.2',
      main: 'src/compiler/index.ts',
    }),
  );
  assert.equal(
    resolveExactContractExport('./', { exactRoot: root })?.path,
    join(packageRoot, 'src', 'compiler', 'index.ts'),
  );

  // Node walks active conditional exports in object insertion order. `node`
  // and even an earlier `default` must win before a later `import` branch.
  const conditionsRoot = join(packageRoot, 'src', 'conditions');
  mkdirSync(conditionsRoot, { recursive: true });
  writeFileSync(join(conditionsRoot, 'node.mjs'), 'export const selected = "node";\n');
  writeFileSync(
    join(conditionsRoot, 'module-sync.mjs'),
    'export const selected = "module-sync";\n',
  );
  writeFileSync(join(conditionsRoot, 'default.mjs'), 'export const selected = "default";\n');
  const writeConditionalExport = (entry) => {
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@ccheever/exact-contract',
        version: '0.1.2',
        exports: { './compiler': entry },
      }),
    );
  };
  writeConditionalExport({
    node: './src/conditions/node.mjs',
    import: './src/compiler/index.ts',
    default: './src/conditions/default.mjs',
  });
  assert.equal(
    resolveExactContractExport('./compiler', { exactRoot: root })?.path,
    join(conditionsRoot, 'node.mjs'),
  );
  writeConditionalExport({
    'module-sync': './src/conditions/module-sync.mjs',
    import: './src/compiler/index.ts',
    default: './src/conditions/default.mjs',
  });
  assert.equal(
    resolveExactContractExport('./compiler', { exactRoot: root })?.path,
    join(conditionsRoot, 'module-sync.mjs'),
  );
  assert.equal(
    (await importExactContractExport('./compiler', { exactRoot: root })).selected,
    'module-sync',
  );
  writeConditionalExport({
    default: './src/conditions/default.mjs',
    import: './src/compiler/index.ts',
  });
  assert.equal(
    resolveExactContractExport('./compiler', { exactRoot: root })?.path,
    join(conditionsRoot, 'default.mjs'),
  );

  writeCompilerExport('src/compiler/index.ts');
  assert.equal(resolveExactContractExport('./compiler', { exactRoot: root }), null);

  const escapedPath = join(root, 'escape-compiler.mjs');
  writeFileSync(escapedPath, 'export const escaped = true;\n');
  writeCompilerExport('./../../../escape-compiler.mjs');
  assert.equal(resolveExactContractExport('./compiler', { exactRoot: root }), null);
  await assert.rejects(
    importExactContractExport('./compiler', { exactRoot: root }),
    (error) => error.code === 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING',
  );

  const externalCompiler = join(root, 'external-compiler');
  mkdirSync(externalCompiler, { recursive: true });
  const linkedOutsidePath = join(externalCompiler, 'index.mjs');
  writeFileSync(linkedOutsidePath, 'export const escaped = true;\n');
  const linkedRoot = join(packageRoot, 'src', 'linked-compiler');
  symlinkSync(
    externalCompiler,
    linkedRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const linkedPath = join(linkedRoot, 'index.mjs');
  writeCompilerExport('./src/linked-compiler/index.mjs');
  assert.equal(resolveExactContractExport('./compiler', { exactRoot: root }), null);
  await assert.rejects(
    importExactContractExport('./compiler', {
      resolveSpecifier: () => pathToFileURL(linkedPath).href,
    }),
    (error) => error.code === 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING',
  );

  writeCompilerExport('./src/compiler/index.ts');

  // Store symlinks are valid when their physical package remains beneath the
  // selected install's node_modules (the pnpm/Bun layout case).
  const storeInstall = join(root, 'store-install');
  const storePackageRoot = join(
    storeInstall,
    'node_modules',
    '.pnpm',
    '@exact+contract@0.1.2',
    'node_modules',
    '@exact',
    'contract',
  );
  const storeLogicalRoot = join(storeInstall, 'node_modules', '@exact', 'contract');
  mkdirSync(join(storePackageRoot, 'src', 'compiler'), { recursive: true });
  mkdirSync(join(storeLogicalRoot, '..'), { recursive: true });
  writeFileSync(
    join(storePackageRoot, 'package.json'),
    JSON.stringify({
      name: '@ccheever/exact-contract',
      version: '0.1.2-store',
      exports: { './compiler': './src/compiler/index.mjs' },
    }),
  );
  writeFileSync(
    join(storePackageRoot, 'src', 'compiler', 'index.mjs'),
    'export const compiler = "store";\n',
  );
  symlinkSync(
    storePackageRoot,
    storeLogicalRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const storeResolved = resolveExactContractExport('./compiler', { exactRoot: storeInstall });
  assert.equal(storeResolved?.packageRoot, storeLogicalRoot);
  assert.equal((await importExactContractExport('./compiler', { exactRoot: storeInstall })).compiler, 'store');

  // An installed package root must itself resolve inside the selected
  // install's node_modules tree. This rejects workspace/external package
  // symlinks while retaining in-tree package-store links.
  const linkedInstall = join(root, 'linked-install');
  const linkedPackageParent = join(linkedInstall, 'node_modules', '@exact');
  const linkedPackageRoot = join(linkedPackageParent, 'contract');
  mkdirSync(linkedPackageParent, { recursive: true });
  symlinkSync(
    packageRoot,
    linkedPackageRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal(resolveExactContractExport('./compiler', { exactRoot: linkedInstall }), null);
  await assert.rejects(
    importExactContractExport('./compiler', {
      resolveSpecifier: () => pathToFileURL(
        join(linkedPackageRoot, 'src', 'compiler', 'index.ts'),
      ).href,
    }),
    (error) => error.code === 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING',
  );

  // A manifest-file symlink is foreign package evidence even when it declares
  // an otherwise-contained target.
  if (process.platform !== 'win32') {
    const manifestPath = join(packageRoot, 'package.json');
    const foreignManifestPath = join(root, 'foreign-package.json');
    writeFileSync(
      foreignManifestPath,
      JSON.stringify({
        name: '@ccheever/exact-contract',
        version: '0.1.2-foreign-manifest',
        exports: { './compiler': './src/compiler/index.ts' },
      }),
    );
    rmSync(manifestPath);
    symlinkSync(foreignManifestPath, manifestPath, 'file');
    assert.equal(resolveExactContractExport('./compiler', { exactRoot: root }), null);
    await assert.rejects(
      importExactContractExport('./compiler', {
        resolveSpecifier: () => pathToFileURL(
          join(packageRoot, 'src', 'compiler', 'index.ts'),
        ).href,
      }),
      (error) => error.code === 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING',
    );
    rmSync(manifestPath);
    writeCompilerExport('./src/compiler/index.ts');
  }

  await assert.rejects(
    importExactContractExport('./missing', { exactRoot: root }),
    (error) => error.code === 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Exact published-alias package resolver test: ok');
