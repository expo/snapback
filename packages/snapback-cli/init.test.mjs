import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { initApp, PACKAGED_CLI_COMMANDS } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const cli = join(packageRoot, 'cli.mjs');
const cliVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createExpoFixture(options = {}) {
  const root = temporaryRoot('snapback-init-expo-');
  const manifest = {
    name: 'existing-expo-app',
    private: true,
    main: 'index.ts',
    scripts: {
      start: 'expo start',
      typecheck: 'tsc --noEmit',
      custom: 'node custom.mjs',
    },
    dependencies: {
      expo: '~57.0.7',
      'expo-status-bar': '~57.0.1',
      react: '19.2.3',
      'react-native': '0.86.2',
      'unrelated-package': '^4.5.6',
    },
    devDependencies: {
      '@types/react': '~19.2.0',
      typescript: '~6.0.3',
    },
    unrelatedConfig: { retain: true },
  };
  writeJson(join(root, 'package.json'), manifest);
  writeFileSync(join(root, options.lockfile ?? 'package-lock.json'), '{}\n');
  writeJson(join(root, 'app.json'), {
    expo: {
      name: 'Existing Expo App',
      slug: 'existing-expo-app',
      plugins: ['expo-font'],
      extra: { retain: true },
    },
  });
  writeJson(join(root, 'tsconfig.json'), {
    extends: 'expo/tsconfig.base',
    compilerOptions: { strict: true, noUncheckedIndexedAccess: true },
    include: options.include ?? ['**/*.ts', '**/*.tsx', '.expo/types/**/*.ts', 'expo-env.d.ts'],
  });
  writeFileSync(join(root, 'App.tsx'), options.appSource ?? `
import { Text } from 'react-native';
export default function App() { return <Text>Existing app</Text>; }
`);
  writeFileSync(join(root, 'index.ts'), options.indexSource ?? `
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
`);
  return { root, manifest };
}

function createReactFixture(options = {}) {
  const root = options.root ?? temporaryRoot('snapback-init-react-');
  mkdirSync(join(root, 'src'));
  const manifest = {
    name: 'existing-react-app',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite --host 127.0.0.1',
      build: 'tsc && vite build',
      custom: 'node custom.mjs',
    },
    dependencies: {
      '@vitejs/plugin-react': '^5.0.0',
      react: '19.2.3',
      'react-dom': '19.2.3',
      vite: '^8.0.0',
      'unrelated-package': '^7.8.9',
    },
    devDependencies: {
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      typescript: '^5.9.0',
    },
    unrelatedConfig: { retain: true },
  };
  writeJson(join(root, 'package.json'), manifest);
  if (options.lockfile !== null) {
    writeFileSync(join(root, options.lockfile ?? 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  }
  writeJson(join(root, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      allowJs: true,
      jsx: 'react-jsx',
      strict: true,
      resolveJsonModule: true,
      noEmit: true,
    },
    include: options.include ?? ['src', 'snapback/generated/**/*.ts', 'vite.config.ts'],
  });
  writeFileSync(join(root, 'index.html'), '<div id="root"></div>\n');
  writeFileSync(join(root, 'src', 'App.tsx'), 'export function App() { return <main>Existing app</main>; }\n');
  writeFileSync(join(root, 'src', 'main.tsx'), `
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
`);
  writeFileSync(join(root, 'vite.config.ts'), `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
`);
  return { root, manifest };
}

function createExpoRouterFixture(options = {}) {
  const root = temporaryRoot('snapback-init-expo-router-');
  mkdirSync(join(root, 'app'));
  writeJson(join(root, 'package.json'), {
    name: 'existing-expo-router-app',
    private: true,
    main: 'expo-router/entry',
    dependencies: {
      expo: '~57.0.7',
      'expo-router': '~57.0.9',
      react: '19.2.3',
      'react-native': '0.86.2',
    },
  });
  writeFileSync(join(root, 'package-lock.json'), '{}\n');
  writeJson(join(root, 'app.json'), {
    expo: { name: 'Router App', slug: 'router-app' },
  });
  writeJson(join(root, 'tsconfig.json'), {
    extends: 'expo/tsconfig.base',
    compilerOptions: { strict: true },
    include: ['**/*.ts', '**/*.tsx', '.expo/types/**/*.ts', 'expo-env.d.ts'],
  });
  writeFileSync(join(root, 'app', '_layout.tsx'), options.layoutSource ?? `import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
`);
  writeFileSync(join(root, 'app', 'index.tsx'), 'export default function Home() { return null; }\n');
  return { root };
}

function addClassicExpoShape(root) {
  writeFileSync(join(root, 'App.tsx'), 'export default function App() { return null; }\n');
  writeFileSync(join(root, 'index.ts'), `
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
`);
}

function directoryDigest(root) {
  const hash = createHash('sha256');
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      hash.update(relative);
      if (entry.isDirectory()) visit(path, relative);
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest('hex');
}

function assertInitCollision(action, seam) {
  assert.throws(action, (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_COLLISION');
    assert.equal(error.diagnostic.details.seam, seam);
    assert.equal(error.diagnostic.details.siblingScaffoldWorkaround, undefined);
    assert.doesNotMatch(error.message, /sibling-scaffold workaround|supported fallback/u);
    return true;
  });
}

test('init refuses an unrecognized root with the closed detection matrix and workaround', () => {
  const root = temporaryRoot('snapback-init-unknown-');
  writeJson(join(root, 'package.json'), {
    name: 'vite-but-not-the-packaged-react-shape',
    dependencies: { react: '19.2.3' },
  });
  assert.throws(() => initApp(root), (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_ROOT_UNRECOGNIZED');
    assert.deepEqual(error.diagnostic.details.lookedFor, [
      'create-expo-app',
      'packaged-react-scaffold',
    ]);
    assert.match(error.message, /create-expo-app/u);
    assert.match(error.message, /snapback-backend-scaffold/u);
    assert.match(error.message, /npx --yes @expo\/snapback-cli@/u);
    assert.match(error.message, /cp -R/u);
    assert.match(error.diagnostic.details.siblingScaffoldWorkaround, / && /u);
    const syntax = spawnSync('bash', ['-n'], {
      input: error.diagnostic.details.siblingScaffoldWorkaround,
      encoding: 'utf8',
    });
    assert.equal(syntax.status, 0, syntax.stderr);
    return true;
  });
  assert.equal(existsSync(join(root, 'snapback')), false);
});

test('init adopts a create-expo-app root and preserves unrelated manifest/config state', () => {
  const { root, manifest: before } = createExpoFixture();
  const result = initApp(root);
  assert.equal(result.schemaVersion, 'snapback.init.v1');
  assert.equal(result.ok, true);
  assert.equal(result.state, 'initialized');
  assert.equal(result.appKind, 'create-expo-app');
  assert.equal(result.packageManager, 'npm');
  assert.deepEqual(result.lockfiles, ['package-lock.json']);
  assert.deepEqual(result.install.command.slice(0, 3), ['npx', 'expo', 'install']);
  for (const dependency of [
    '@expo/snapback-cli',
    '@expo/snapback-client',
    '@expo/snapback-codegen',
    '@expo/snapback-expo',
    '@expo/snapback-react',
  ]) {
    assert.ok(result.install.command.includes(`${dependency}@${cliVersion}`));
  }
  for (const dependency of ['expo-file-system', 'expo-crypto', 'expo-image-picker']) {
    assert.ok(result.install.command.includes(dependency));
  }
  assert.equal(result.install.requested, false);
  assert.equal(result.install.ran, false);
  assert.equal(existsSync(join(root, 'snapback', 'schema.mjs')), true);
  assert.equal(
    readFileSync(join(root, 'snapback', 'schema.mjs'), 'utf8'),
    readFileSync(join(packageRoot, 'templates', 'react', 'snapback', 'schema.mjs'), 'utf8'),
    'init must reuse the packaged React template backend source',
  );

  const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(after.scripts, before.scripts);
  assert.deepEqual(after.devDependencies, before.devDependencies);
  assert.deepEqual(after.unrelatedConfig, before.unrelatedConfig);
  assert.equal(after.dependencies['unrelated-package'], before.dependencies['unrelated-package']);
  for (const dependency of result.dependenciesAdded) {
    assert.equal(after.dependencies[dependency], cliVersion);
  }
  assert.equal(after.dependencies['expo-file-system'], undefined, 'Expo chooses native module versions only when install is explicitly run');

  const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
  assert.deepEqual(tsconfig.compilerOptions, { strict: true, noUncheckedIndexedAccess: true });
  assert.deepEqual(tsconfig.include, [
    'App.tsx',
    'index.ts',
    'snapback/generated/*.d.ts',
    '.expo/types/**/*.ts',
    'expo-env.d.ts',
  ]);
  const appConfig = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  assert.deepEqual(appConfig.expo.extra, { retain: true });
  assert.deepEqual(appConfig.expo.plugins, ['expo-font', '@expo/snapback-expo']);
  const entry = readFileSync(join(root, 'index.ts'), 'utf8');
  assert.match(entry, /SnapbackExpoProvider/u);
  assert.match(entry, /registerExpoFileSystemRqsFiles/u);
  assert.match(entry, /\.\/snapback\/generated\/app\.mjs/u);
  assert.match(entry, /registerRootComponent\(SnapbackInitRoot\)/u);
});

test('init adopts the packaged React scaffold shape with its Vite/provider seams', () => {
  const { root, manifest: before } = createReactFixture();
  const result = initApp(root);
  assert.equal(result.state, 'initialized');
  assert.equal(result.appKind, 'packaged-react-scaffold');
  assert.equal(result.packageManager, 'pnpm');
  assert.deepEqual(result.install.command, ['pnpm', 'install']);
  assert.equal(existsSync(join(root, 'snapback', 'functions.mjs')), true);
  assert.equal(existsSync(join(root, 'src', 'snapback-init-provider.tsx')), true);
  assert.equal(existsSync(join(root, 'src', 'snapback-dev.d.ts')), true);
  assert.match(readFileSync(join(root, 'src', 'main.tsx'), 'utf8'), /<SnapbackInitProvider><App \/><\/SnapbackInitProvider>/u);
  assert.match(readFileSync(join(root, 'src', 'snapback-init-provider.tsx'), 'utf8'), /createSnapbackReactProvider/u);
  assert.match(readFileSync(join(root, 'vite.config.ts'), 'utf8'), /snapbackDev\(\{/u);
  const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
  assert.deepEqual(tsconfig.include, ['src', 'snapback/generated/*.d.ts', 'vite.config.ts']);
  const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(after.scripts, before.scripts);
  assert.equal(after.dependencies['unrelated-package'], before.dependencies['unrelated-package']);
  assert.deepEqual(after.unrelatedConfig, before.unrelatedConfig);
  for (const dependency of result.dependenciesAdded) {
    assert.equal(after.dependencies[dependency], cliVersion);
  }
});

test('init refuses backend, provider, and conflicting typecheck collisions without writing', async (t) => {
  await t.test('empty snapback child', () => {
    const { root } = createExpoFixture();
    mkdirSync(join(root, 'snapback'));
    assertInitCollision(() => initApp(root), 'backend child');
    assert.deepEqual(readdirSync(join(root, 'snapback')), []);
  });

  await t.test('existing snapback child', () => {
    const { root } = createExpoFixture();
    mkdirSync(join(root, 'snapback'));
    writeFileSync(join(root, 'snapback', 'keep.txt'), 'user-owned\n');
    assertInitCollision(() => initApp(root), 'backend child');
    assert.equal(readFileSync(join(root, 'snapback', 'keep.txt'), 'utf8'), 'user-owned\n');
  });

  await t.test('provider already wired', () => {
    const { root } = createExpoFixture({
      appSource: `
import { SnapbackExpoProvider } from '@expo/snapback-expo';
import { app } from './snapback/generated/app.mjs';
import { Text } from 'react-native';
export default function App() {
  return <SnapbackExpoProvider app={app}><Text>Existing app</Text></SnapbackExpoProvider>;
}
`,
      indexSource: `
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
`,
    });
    assertInitCollision(() => initApp(root), 'provider');
    assert.equal(existsSync(join(root, 'snapback')), false);
  });

  await t.test('conflicting typecheck boundary', () => {
    const { root } = createExpoFixture({ include: ['custom/**/*.ts'] });
    assertInitCollision(() => initApp(root), 'typecheck-boundary');
    assert.equal(existsSync(join(root, 'snapback')), false);
  });
});

test('post-generate init reruns ignore codegen-owned bytes and still run an explicit install', () => {
  const { root } = createExpoFixture();
  initApp(root);
  const artifactsPath = join(root, 'snapback', 'generated', 'artifacts.json');
  writeFileSync(artifactsPath, '{"simulated":"regenerated"}\n');
  writeFileSync(
    join(root, 'snapback', 'generated', 'app.binding.ffffffffffffffff.mjs'),
    '// simulated content-addressed codegen output\n',
  );
  const before = directoryDigest(root);
  const noInstallRerun = initApp(root);
  assert.equal(noInstallRerun.state, 'already-initialized');
  assert.deepEqual(noInstallRerun.filesCreated, []);
  assert.deepEqual(noInstallRerun.filesUpdated, []);
  assert.equal(directoryDigest(root), before);
  let installCalls = 0;
  const rerun = initApp(root, {
    install: true,
    installRunner() {
      installCalls += 1;
      return { status: 0, stderr: '' };
    },
  });
  assert.equal(rerun.state, 'already-initialized');
  assert.deepEqual(rerun.filesCreated, []);
  assert.deepEqual(rerun.filesUpdated, []);
  assert.equal(rerun.install.requested, true);
  assert.equal(rerun.install.ran, true);
  assert.equal(rerun.install.lockfileEffects, 'package-manager-controlled');
  assert.equal(installCalls, 1);
  assert.equal(directoryDigest(root), before);
});

test('init runs the detected package-manager command only under --install', () => {
  const { root } = createReactFixture({ lockfile: 'bun.lock' });
  const calls = [];
  const result = initApp(root, {
    install: true,
    env: { SNAPBACK_INIT_TEST: '1' },
    installRunner(executable, args, options) {
      calls.push({ executable, args: [...args], options });
      return { status: 0, stderr: '' };
    },
  });
  assert.equal(result.install.requested, true);
  assert.equal(result.install.ran, true);
  assert.equal(result.packageManager, 'bun');
  assert.deepEqual(result.install.command, ['bun', 'install']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'bun');
  assert.deepEqual(calls[0].args, ['install']);
  assert.equal(calls[0].options.cwd, realpathSync(root));
});

test('init reports an explicit install failure without hiding the completed adoption', () => {
  const { root } = createReactFixture();
  assert.throws(() => initApp(root, {
    install: true,
    installRunner() {
      return { status: 23, stderr: 'offline fixture install refused' };
    },
  }), (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_INSTALL_FAILED');
    assert.equal(error.diagnostic.details.exitCode, 23);
    assert.deepEqual(error.diagnostic.details.command, ['pnpm', 'install']);
    assert.match(error.message, /file adoption is complete/u);
    assert.equal(error.diagnostic.details.lockfileEffects, 'package-manager-controlled');
    return true;
  });
  assert.equal(existsSync(join(root, 'snapback', 'schema.mjs')), true);
  assert.match(readFileSync(join(root, 'src', 'main.tsx'), 'utf8'), /SnapbackInitProvider/u);
});

test('snapback init --json emits the stable machine result shape offline', () => {
  const { root } = createExpoFixture();
  const result = spawnSync(process.execPath, [cli, 'init', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schemaVersion, 'snapback.init.v1');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state, 'initialized');
  assert.equal(parsed.appKind, 'create-expo-app');
  assert.equal(parsed.install.requested, false);
  assert.equal(parsed.install.ran, false);
  assert.deepEqual(parsed.next, [
    'snapback generate snapback --json',
    'snapback dev snapback --expo',
  ]);

  const human = spawnSync(process.execPath, [cli, 'init'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(human.status, 0, human.stderr || human.stdout);
  assert.match(human.stdout, /^snapback\.init\.v1: already-initialized$/mu);
  assert.match(human.stdout, /^Install command: npx expo install /mu);
  assert.match(human.stdout, /^Next: snapback generate snapback --json$/mu);
});

test('init refuses ambiguous lockfile ownership with a typed package-manager diagnostic', () => {
  const { root } = createExpoFixture();
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  assert.throws(() => initApp(root), (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_PACKAGE_MANAGER_CONFLICT');
    assert.deepEqual(error.diagnostic.details.packageManagers, ['pnpm', 'npm']);
    return true;
  });
  assert.equal(existsSync(join(root, 'snapback')), false);
});

test('init transaction rolls back only its creations, reports exact progress, and retries successfully', () => {
  const { root } = createReactFixture();
  const packageBefore = readFileSync(join(root, 'package.json'), 'utf8');
  let creations = 0;
  assert.throws(() => initApp(root, {
    transactionHook({ event }) {
      if (event === 'after-new' && ++creations === 5) throw new Error('injected mid-adoption failure');
    },
  }), (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_TRANSACTION_FAILED');
    const transaction = error.diagnostic.details.transaction;
    assert.equal(transaction.created.length, 5);
    assert.deepEqual(new Set(transaction.rolledBack), new Set(transaction.created));
    assert.deepEqual(transaction.updated, []);
    assert.deepEqual(transaction.rollbackFailed, []);
    return true;
  });
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), packageBefore);
  assert.equal(existsSync(join(root, 'snapback')), false);
  assert.equal(existsSync(join(root, 'src', 'snapback-init-provider.tsx')), false);

  const retry = initApp(root);
  assert.equal(retry.state, 'initialized');
  assert.equal(existsSync(join(root, 'snapback', 'schema.mjs')), true);
});

test('init transaction atomically restores completed updates after a later failure', () => {
  const { root } = createReactFixture();
  const before = directoryDigest(root);
  assert.throws(() => initApp(root, {
    transactionHook({ event, path }) {
      if (event === 'after-update' && path === 'tsconfig.json') {
        throw new Error('injected after two completed updates');
      }
    },
  }), (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_TRANSACTION_FAILED');
    const transaction = error.diagnostic.details.transaction;
    assert.deepEqual(transaction.updated, ['package.json', 'tsconfig.json']);
    assert.deepEqual(transaction.updatedRestored, ['tsconfig.json', 'package.json']);
    assert.deepEqual(transaction.updateRestoreFailed, []);
    assert.deepEqual(new Set(transaction.rolledBack), new Set(transaction.created));
    assert.deepEqual(transaction.rollbackFailed, []);
    return true;
  });
  assert.equal(directoryDigest(root), before);
  assert.equal(readdirSync(root).some((name) => name.includes('.snapback-init-')), false);
});

test('existing-file replacement writes a sibling temp and never exposes truncation', () => {
  const { root } = createExpoFixture();
  const packagePath = join(root, 'package.json');
  const packageBefore = readFileSync(packagePath, 'utf8');
  assert.throws(() => initApp(root, {
    transactionHook({ event, path }) {
      if (event === 'after-temp-write' && path === 'package.json') {
        assert.equal(readFileSync(packagePath, 'utf8'), packageBefore);
        throw new Error('injected before atomic rename');
      }
    },
  }), (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_TRANSACTION_FAILED');
    assert.deepEqual(error.diagnostic.details.transaction.updated, []);
    return true;
  });
  assert.equal(readFileSync(packagePath, 'utf8'), packageBefore);
  assert.equal(readdirSync(root).some((name) => name.includes('.snapback-init-')), false);
  assert.equal(existsSync(join(root, 'snapback')), false);
});

test('a concurrent post-preflight creation becomes a typed collision and is never removed', () => {
  const { root } = createReactFixture();
  const concurrentPath = join(root, 'src', 'snapback-init-provider.tsx');
  assert.throws(() => initApp(root, {
    transactionHook({ event, path }) {
      if (event === 'before-new' && path === 'src/snapback-init-provider.tsx') {
        writeFileSync(concurrentPath, '// concurrently created user file\n');
      }
    },
  }), (error) => {
    assert.equal(error.code, 'SNAPBACK_INIT_COLLISION');
    assert.equal(error.diagnostic.details.seam, 'transaction');
    assert.deepEqual(error.diagnostic.details.transaction.created, []);
    assert.deepEqual(error.diagnostic.details.transaction.rolledBack, []);
    return true;
  });
  assert.equal(readFileSync(concurrentPath, 'utf8'), '// concurrently created user file\n');
  assert.equal(existsSync(join(root, 'snapback')), false);
});

test('partial init-owned state resumes only missing seams and mismatches refuse precisely', () => {
  const { root } = createReactFixture();
  initApp(root);
  rmSync(join(root, 'src', 'snapback-dev.d.ts'));
  rmSync(join(root, 'snapback', 'schema.mjs'));

  const resumed = initApp(root);
  assert.equal(resumed.state, 'initialized');
  assert.deepEqual(new Set(resumed.filesCreated), new Set([
    'src/snapback-dev.d.ts',
    'snapback/schema.mjs',
  ]));
  assert.deepEqual(resumed.filesUpdated, []);

  writeFileSync(join(root, 'src', 'snapback-init-provider.tsx'), '// user-owned mismatch\n');
  assertInitCollision(() => initApp(root), 'provider');
});

test('default expo-router create-expo-app is adopted while custom layout ownership refuses', async (t) => {
  await t.test('pristine router layout', () => {
    const { root } = createExpoRouterFixture();
    const result = initApp(root);
    assert.equal(result.appKind, 'create-expo-app');
    assert.match(readFileSync(join(root, 'app', '_layout.tsx'), 'utf8'), /SnapbackInitRouterContent/u);
    assert.match(readFileSync(join(root, 'app', '_layout.tsx'), 'utf8'), /SnapbackExpoProvider/u);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')).include, [
      'app',
      'snapback/generated/*.d.ts',
      '.expo/types/**/*.ts',
      'expo-env.d.ts',
    ]);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.plugins, [
      '@expo/snapback-expo',
    ]);
  });

  await t.test('custom router layout', () => {
    const { root } = createExpoRouterFixture({
      layoutSource: `
import { Stack } from 'expo-router';
export default function RootLayout({ customOwner }) {
  return customOwner ? <Stack /> : null;
}
`,
    });
    assertInitCollision(() => initApp(root), 'provider');
    assert.equal(existsSync(join(root, 'snapback')), false);
  });
});

test('Expo main disambiguates classic and router roots while an undecided dual shape refuses', async (t) => {
  await t.test('expo-router main wins over leftover classic files', () => {
    const { root } = createExpoRouterFixture();
    addClassicExpoShape(root);
    const classicBefore = readFileSync(join(root, 'index.ts'), 'utf8');
    const result = initApp(root);
    assert.ok(result.filesUpdated.includes('app/_layout.tsx'));
    assert.equal(result.filesUpdated.includes('index.ts'), false);
    assert.equal(readFileSync(join(root, 'index.ts'), 'utf8'), classicBefore);
    assert.match(readFileSync(join(root, 'app', '_layout.tsx'), 'utf8'), /SnapbackInitRouterContent/u);
  });

  await t.test('classic main wins over leftover router files', () => {
    const { root } = createExpoRouterFixture();
    addClassicExpoShape(root);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.main = 'index.ts';
    writeJson(join(root, 'package.json'), manifest);
    const routerBefore = readFileSync(join(root, 'app', '_layout.tsx'), 'utf8');
    const result = initApp(root);
    assert.ok(result.filesUpdated.includes('index.ts'));
    assert.equal(result.filesUpdated.includes('app/_layout.tsx'), false);
    assert.equal(readFileSync(join(root, 'app', '_layout.tsx'), 'utf8'), routerBefore);
    assert.match(readFileSync(join(root, 'index.ts'), 'utf8'), /SnapbackInitRoot/u);
  });

  await t.test('both shapes without a disambiguating main refuse', () => {
    const { root } = createExpoRouterFixture();
    addClassicExpoShape(root);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    delete manifest.main;
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_COLLISION');
      assert.equal(error.diagnostic.details.seam, 'app-entry ambiguity');
      assert.match(error.message, /Both the classic .* and expo-router/u);
      assert.match(error.message, /package\.json main/u);
      return true;
    });
    assert.equal(existsSync(join(root, 'snapback')), false);
  });
});

test('JSONC is read tolerantly, but a required comment-destroying edit refuses honestly', async (t) => {
  await t.test('trailing commas do not alter string contents', () => {
    const { root } = createExpoFixture();
    writeFileSync(join(root, 'tsconfig.json'), `{
  "extends": "expo/tsconfig.base",
  "marker": ",}",
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts",],
}
`);
    initApp(root);
    assert.equal(JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')).marker, ',}');
  });

  await t.test('commented edit refusal', () => {
    const { root } = createExpoFixture();
    writeFileSync(join(root, 'tsconfig.json'), `{
  // create-expo-app owns this explanation
  "extends": "expo/tsconfig.base",
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts",],
}
`);
    assertInitCollision(() => initApp(root), 'comment-preserving configuration');
    assert.equal(existsSync(join(root, 'snapback')), false);
  });

  await t.test('commented already-narrowed config is a no-op', () => {
    const { root } = createExpoFixture();
    initApp(root);
    const tsconfigPath = join(root, 'tsconfig.json');
    const narrowed = readFileSync(tsconfigPath, 'utf8').replace('{\n', '{\n  // retained because no edit is needed\n');
    writeFileSync(tsconfigPath, narrowed);
    const rerun = initApp(root);
    assert.equal(rerun.state, 'already-initialized');
    assert.equal(readFileSync(tsconfigPath, 'utf8'), narrowed);
  });
});

test('invalid package/app configuration shapes are typed and never mutate the root', async (t) => {
  await t.test('unparseable tsconfig does not advertise a sibling scaffold', () => {
    const { root } = createExpoFixture();
    writeFileSync(join(root, 'tsconfig.json'), '{ invalid jsonc\n');
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_CONFIG_INVALID');
      assert.equal(error.diagnostic.details.siblingScaffoldWorkaround, undefined);
      assert.doesNotMatch(error.message, /sibling|scaffold/u);
      return true;
    });
  });

  await t.test('null package.json', () => {
    const { root } = createExpoFixture();
    writeFileSync(join(root, 'package.json'), 'null\n');
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_ROOT_UNRECOGNIZED');
      return true;
    });
    assert.equal(existsSync(join(root, 'snapback')), false);
  });

  await t.test('invalid expo/plugins shape', () => {
    const { root } = createExpoFixture();
    writeJson(join(root, 'app.json'), { expo: [] });
    assertInitCollision(() => initApp(root), 'Expo config plugin');
    assert.equal(existsSync(join(root, 'snapback')), false);
  });

  await t.test('foreign Snapback plugin tuple is not claimed as init-owned', () => {
    const { root } = createExpoFixture();
    writeJson(join(root, 'app.json'), {
      expo: { plugins: [['@expo/snapback-expo', { custom: true }]] },
    });
    assertInitCollision(() => initApp(root), 'Expo config plugin');
    assert.equal(existsSync(join(root, 'snapback')), false);
  });
});

test('semantic no-op seams retain bytes, inode/mtime, indentation, and trailing-newline convention', () => {
  const { root } = createExpoFixture();
  const packagePath = join(root, 'package.json');
  const appPath = join(root, 'app.json');
  const tsconfigPath = join(root, 'tsconfig.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  for (const name of [
    '@expo/snapback-cli',
    '@expo/snapback-client',
    '@expo/snapback-codegen',
    '@expo/snapback-expo',
    '@expo/snapback-react',
  ]) manifest.dependencies[name] = cliVersion;
  writeFileSync(packagePath, JSON.stringify(manifest, null, 4));
  const appConfig = JSON.parse(readFileSync(appPath, 'utf8'));
  appConfig.expo.plugins.push('@expo/snapback-expo');
  writeFileSync(appPath, JSON.stringify(appConfig, null, 4));
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  tsconfig.include = [
    'App.tsx',
    'index.ts',
    'snapback/generated/*.d.ts',
    '.expo/types/**/*.ts',
    'expo-env.d.ts',
  ];
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 4));
  const paths = [packagePath, appPath, tsconfigPath];
  const before = paths.map((path) => ({ bytes: readFileSync(path), stat: statSync(path, { bigint: true }) }));

  const result = initApp(root);
  for (const path of ['package.json', 'app.json', 'tsconfig.json']) {
    assert.equal(result.filesUpdated.includes(path), false);
    assert.equal(result.filesUnchanged.includes(path), true);
  }
  paths.forEach((path, index) => {
    assert.deepEqual(readFileSync(path), before[index].bytes);
    const afterStat = statSync(path, { bigint: true });
    assert.equal(afterStat.ino, before[index].stat.ino);
    assert.equal(afterStat.mtimeNs, before[index].stat.mtimeNs);
    assert.equal(readFileSync(path, 'utf8').endsWith('\n'), false);
    assert.match(readFileSync(path, 'utf8'), /\n {4}"/u);
  });
});

test('package-manager ownership honors declarations, workspaces, manager families, and versionless pnpm', async (t) => {
  await t.test('unsupported packageManager declaration', () => {
    const { root } = createExpoFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.packageManager = 'deno@2';
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_PACKAGE_MANAGER_CONFLICT');
      assert.equal(error.diagnostic.details.declaredPackageManager, 'deno@2');
      assert.deepEqual(error.diagnostic.details.supportedPackageManagers, [
        'bun',
        'npm',
        'pnpm',
        'yarn',
      ]);
      assert.match(error.message, /deno@2/u);
      assert.match(error.message, /supports bun, npm, pnpm, or yarn/u);
      return true;
    });
    assert.equal(existsSync(join(root, 'snapback')), false);
  });

  await t.test('packageManager conflicts with lockfile', () => {
    const { root } = createExpoFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.packageManager = 'pnpm@10.0.0';
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_PACKAGE_MANAGER_CONFLICT');
      assert.deepEqual(error.diagnostic.details.packageManagers, ['npm', 'pnpm']);
      return true;
    });
  });

  await t.test('nearest workspace root lockfile', () => {
    const workspace = temporaryRoot('snapback-init-workspace-');
    writeJson(join(workspace, 'package.json'), { private: true, workspaces: ['apps/*'] });
    writeFileSync(join(workspace, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    mkdirSync(join(workspace, 'apps'));
    const app = join(workspace, 'apps', 'web');
    mkdirSync(app);
    createReactFixture({ root: app, lockfile: null });
    const result = initApp(app);
    assert.equal(result.packageManager, 'pnpm');
    assert.equal(result.packageManagerSource, 'workspace');
    assert.deepEqual(result.lockfiles, ['../../pnpm-lock.yaml']);
  });

  await t.test('versionless pnpm declaration', () => {
    const { root } = createReactFixture({ lockfile: null });
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.packageManager = 'pnpm';
    writeJson(join(root, 'package.json'), manifest);
    assert.equal(initApp(root).packageManager, 'pnpm');
  });

  await t.test('package-lock and npm-shrinkwrap are one manager', () => {
    const { root } = createExpoFixture();
    writeFileSync(join(root, 'npm-shrinkwrap.json'), '{}\n');
    const result = initApp(root);
    assert.equal(result.packageManager, 'npm');
    assert.deepEqual(result.lockfiles, ['package-lock.json', 'npm-shrinkwrap.json']);
  });
});

test('closure dependencies are validated across every package dependency group', async (t) => {
  await t.test('conflicting Snapback duplicate names both entries', () => {
    const { root } = createReactFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.dependencies['@expo/snapback-client'] = cliVersion;
    manifest.peerDependencies = {
      '@expo/snapback-client': '^9.0.0 || >=10.0.0 <11.0.0',
    };
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_COLLISION');
      assert.equal(error.diagnostic.details.seam, 'dependency-manifest');
      assert.match(error.message, /dependencies\.@expo\/snapback-client/u);
      assert.match(error.message, /peerDependencies\.@expo\/snapback-client/u);
      assert.match(error.message, /\^9\.0\.0 \|\| >=10\.0\.0 <11\.0\.0/u);
      return true;
    });
  });

  await t.test('conflicting Expo native duplicate includes optionalDependencies', () => {
    const { root } = createExpoFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.dependencies['expo-file-system'] = '~57.0.0';
    manifest.optionalDependencies = { 'expo-file-system': '>=58.0.0 <59.0.0' };
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_COLLISION');
      assert.equal(error.diagnostic.details.seam, 'dependency-manifest');
      assert.match(error.message, /dependencies\.expo-file-system/u);
      assert.match(error.message, /optionalDependencies\.expo-file-system/u);
      return true;
    });
  });
});

test('canonical containment refuses outward symlinks while inward file symlinks remain detectable', async (t) => {
  await t.test('outward package.json symlink', () => {
    const { root } = createExpoFixture();
    const outside = temporaryRoot('snapback-init-outside-');
    writeFileSync(join(outside, 'package.json'), readFileSync(join(root, 'package.json')));
    rmSync(join(root, 'package.json'));
    symlinkSync(join(outside, 'package.json'), join(root, 'package.json'));
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_PATH_ESCAPE');
      assert.equal(error.diagnostic.details.label, 'package.json');
      return true;
    });
    assert.equal(existsSync(join(root, 'snapback')), false);
  });

  await t.test('inward index.ts symlink', () => {
    const { root } = createExpoFixture();
    mkdirSync(join(root, 'internal'));
    renameSync(join(root, 'index.ts'), join(root, 'internal', 'index.ts'));
    symlinkSync('internal/index.ts', join(root, 'index.ts'));
    const result = initApp(root);
    assert.equal(result.state, 'initialized');
    assert.equal(lstatSync(join(root, 'index.ts')).isSymbolicLink(), true);
    assert.match(readFileSync(join(root, 'internal', 'index.ts'), 'utf8'), /SnapbackExpoProvider/u);
  });
});

test('preflight refuses duplicate lexical bindings and conflicting Snapback overrides', async (t) => {
  await t.test('duplicate Platform binding', () => {
    const { root } = createExpoFixture({
      indexSource: `
import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './App.tsx';
registerRootComponent(App)
`,
    });
    assertInitCollision(() => initApp(root), 'lexical binding');
  });

  await t.test('an import module specifier is not mistaken for its binding', () => {
    const { root } = createReactFixture();
    const entryPath = join(root, 'src', 'main.tsx');
    writeFileSync(
      entryPath,
      `import helper from './SnapbackInitProvider';\n${readFileSync(entryPath, 'utf8')}`,
    );
    assert.equal(initApp(root).state, 'initialized');
  });

  await t.test('conflicting resolution', () => {
    const { root } = createReactFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.resolutions = { '**/@expo/snapback-client': '9.9.9' };
    manifest.overrides = { '@expo/snapback-codegen': '8.8.8' };
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_COLLISION');
      assert.equal(error.diagnostic.details.seam, 'dependency-manifest');
      assert.match(error.message, /resolutions\.\*\*\/@expo\/snapback-client=9\.9\.9/u);
      assert.match(error.message, /overrides\.@expo\/snapback-codegen=8\.8\.8/u);
      return true;
    });
  });
});

test('React seam matching ignores comment and string decoys instead of rewriting them', () => {
  const { root } = createReactFixture();
  const vitePath = join(root, 'vite.config.ts');
  const source = `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const decoy = "plugins: [react()]";
// plugins: [react()]
export default defineConfig({ plugins: [customPlugin()] });
`;
  writeFileSync(vitePath, source);
  assertInitCollision(() => initApp(root), 'Vite integration');
  assert.equal(readFileSync(vitePath, 'utf8'), source);
  assert.equal(existsSync(join(root, 'snapback')), false);
});

test('React source edits preserve CRLF fidelity and remain rerunnable', () => {
  const { root } = createReactFixture();
  for (const relativePath of ['src/main.tsx', 'vite.config.ts']) {
    const path = join(root, relativePath);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('\n', '\r\n'));
  }
  assert.equal(initApp(root).state, 'initialized');
  for (const relativePath of ['src/main.tsx', 'vite.config.ts']) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.match(source, /\r\n/u);
    assert.doesNotMatch(source, /(?<!\r)\n/u);
  }
  assert.equal(initApp(root).state, 'already-initialized');
});

test('supported Expo/Vite majors and complex tsconfig project boundaries fail closed', async (t) => {
  await t.test('unsupported Expo major', () => {
    const { root } = createExpoFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.dependencies.expo = '~56.0.0';
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_VERSION_UNSUPPORTED');
      assert.equal(error.diagnostic.details.supportedRange, '>=57.0.0 <58.0.0');
      return true;
    });
  });

  await t.test('unsupported Vite major', () => {
    const { root } = createReactFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.dependencies.vite = '^7.0.0';
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_VERSION_UNSUPPORTED');
      assert.equal(error.diagnostic.details.supportedRange, '^8.0.0');
      return true;
    });
  });

  await t.test('non-semver Expo source is not mistaken for its path digits', () => {
    const { root } = createExpoFixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.dependencies.expo = 'file:../expo-57';
    writeJson(join(root, 'package.json'), manifest);
    assert.throws(() => initApp(root), (error) => {
      assert.equal(error.code, 'SNAPBACK_INIT_VERSION_UNSUPPORTED');
      return true;
    });
  });

  for (const [name, field, value] of [
    ['files', 'files', ['index.ts']],
    ['references', 'references', [{ path: './tsconfig.app.json' }]],
    ['string include', 'include', 'src'],
  ]) {
    await t.test(name, () => {
      const { root } = createReactFixture();
      const config = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
      config[field] = value;
      writeJson(join(root, 'tsconfig.json'), config);
      assertInitCollision(() => initApp(root), 'typecheck-boundary');
      assert.equal(existsSync(join(root, 'snapback')), false);
    });
  }
});

test('pristine entry matching tolerates trivial semicolon, specifier, and JSX variance', async (t) => {
  await t.test('Expo App.tsx specifier without semicolons', () => {
    const { root } = createExpoFixture({
      indexSource: `
import { registerRootComponent } from 'expo'
import App from './App.tsx'
registerRootComponent(App)
`,
    });
    assert.equal(initApp(root).state, 'initialized');
  });
  await t.test('React paired App tag', () => {
    const { root } = createReactFixture();
    const path = join(root, 'src', 'main.tsx');
    writeFileSync(path, readFileSync(path, 'utf8').replace('<App />', '<App></App>'));
    assert.equal(initApp(root).state, 'initialized');
  });
});

test('invalid init arguments derive their usage from PACKAGED_CLI_COMMANDS', () => {
  const usage = PACKAGED_CLI_COMMANDS.find(({ name }) => name === 'init').usage;
  const result = spawnSync(process.execPath, [cli, 'init', '--not-a-real-flag'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  const diagnostic = JSON.parse(result.stderr).diagnostics[0];
  assert.equal(diagnostic.code, 'SNAPBACK_CLI_ARGUMENT_INVALID');
  assert.equal(diagnostic.message, `usage: ${usage}`);
});
