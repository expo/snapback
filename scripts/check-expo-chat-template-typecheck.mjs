#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { generateApp, scaffoldApp } from '../packages/snapback-cli/index.mjs';

const root = resolve(import.meta.dirname, '..');
const harnessRoot = join(root, 'tests', 'expo-chat-template-typecheck');
const templateRoot = join(root, 'packages', 'snapback-cli', 'templates', 'expo-chat');
const templateManifest = JSON.parse(readFileSync(join(templateRoot, 'package.json'), 'utf8'));
const expoManifest = JSON.parse(readFileSync(join(templateRoot, 'app.json'), 'utf8'));
const harnessManifest = JSON.parse(readFileSync(join(harnessRoot, 'package.json'), 'utf8'));

assert.deepEqual(expoManifest.expo.platforms, ['ios', 'android', 'web']);
assert.equal(templateManifest.scripts.web, 'expo start --web');
assert.match(
  templateManifest.scripts.prove,
  /^snapback verify snapback --config \.\/snapback\.verify\.config\.mjs /u,
);
for (const dependency of ['@expo/metro-runtime', 'react-dom', 'react-native-web']) {
  assert.equal(
    typeof templateManifest.dependencies?.[dependency],
    'string',
    `expo-chat must include ${dependency} for a zero-edit web start`,
  );
}

function nonSnapbackDependencies(manifest, section) {
  return Object.fromEntries(Object.entries(manifest[section] ?? {}).filter(
    ([name]) => !name.startsWith('@expo/snapback-'),
  ));
}

function materializeConsumerNodeModules(destination) {
  const source = join(harnessRoot, 'node_modules');
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    const sourceEntry = join(source, entry);
    const destinationEntry = join(destination, entry);
    if (!entry.startsWith('@')) {
      symlinkSync(sourceEntry, destinationEntry, 'dir');
      continue;
    }
    mkdirSync(destinationEntry, { recursive: true });
    for (const scopedEntry of readdirSync(sourceEntry)) {
      const packageName = `${entry}/${scopedEntry}`;
      const sourcePackage = join(sourceEntry, scopedEntry);
      const destinationPackage = join(destinationEntry, scopedEntry);
      if (packageName.startsWith('@expo/snapback-')) {
        // Bun represents local file dependencies as directories of per-file
        // symlinks back to this monorepo. Materialize only the package's
        // publish allowlist so Metro sees the same package-local peer topology
        // as a registry install instead of following those links to source.
        const packageManifest = JSON.parse(
          readFileSync(join(sourcePackage, 'package.json'), 'utf8'),
        );
        mkdirSync(destinationPackage, { recursive: true });
        for (const publishedFile of ['package.json', ...(packageManifest.files ?? [])]) {
          const sourceFile = join(sourcePackage, publishedFile);
          if (!existsSync(sourceFile)) continue;
          const destinationFile = join(destinationPackage, publishedFile);
          mkdirSync(resolve(destinationFile, '..'), { recursive: true });
          cpSync(realpathSync(sourceFile), destinationFile, { recursive: true });
        }
      } else {
        symlinkSync(sourcePackage, destinationPackage, 'dir');
      }
    }
  }
}

function freeLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function stopProcessGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  if (await Promise.race([exited.then(() => true), delay(5_000, false)])) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await Promise.race([exited, delay(2_000)]);
}

async function waitForExpoWeb(child, port, readLogs) {
  // Cold Metro rebuilds of the completed chat template exceed the original
  // 60s probe budget on a busy host; the bundle itself is already proven by
  // the static export above, so the serve probe can afford a longer wait.
  const deadline = Date.now()
    + (Number(process.env.SNAPBACK_EXPO_WEB_READY_TIMEOUT_MS) || 240_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Expo web exited before readiness\n${readLogs()}`);
    }
    try {
      // `expo start --localhost` binds ::1 (not 127.0.0.1) on IPv6-first
      // macOS hosts; probe the same name Expo binds so both families work.
      const response = await fetch(`http://localhost:${port}/`);
      if (response.ok && (await response.text()).includes('id="root"')) return;
    } catch {
      // Metro is still starting.
    }
    await delay(250);
  }
  throw new Error(`Expo web did not become ready\n${readLogs()}`);
}

for (const section of ['dependencies', 'devDependencies']) {
  assert.deepEqual(
    nonSnapbackDependencies(harnessManifest, section),
    nonSnapbackDependencies(templateManifest, section),
    `expo-chat ${section} drifted from the recurring typecheck harness`,
  );
}
for (const [name, version] of Object.entries(templateManifest.dependencies ?? {})) {
  if (!name.startsWith('@expo/snapback-')) continue;
  assert.equal(version, '__SNAPBACK_VERSION__', `${name} must remain a scaffold placeholder`);
  if (![
    '@expo/snapback-client',
    '@expo/snapback-codegen',
    '@expo/snapback-expo',
    '@expo/snapback-react',
  ].includes(name)) continue;
  assert.match(
    harnessManifest.dependencies?.[name] ?? '',
    /^file:\.\.\/\.\.\/packages\/snapback-/u,
    `${name} must resolve from a workspace package in the typecheck harness`,
  );
}

const scratchParent = process.env.SNAPBACK_EXPO_CHAT_TEMPLATE_SCRATCH_ROOT ?? tmpdir();
const scratchRoot = mkdtempSync(join(scratchParent, 'snapback-expo-chat-template-'));
const scaffoldRoot = join(scratchRoot, 'expo-chat');
try {
  // @ref LLP 0186#w2--context-injection-surface-owned-here — keep the
  // golden-path scaffold type-correct against its exact Expo peer set as the
  // template and first-party client declarations evolve.
  const scaffold = scaffoldApp(scaffoldRoot, { template: 'expo-chat' });
  assert.equal(scaffold.ok, true);
  // Materialize workspace packages through their publish allowlists. Metro
  // therefore consumes package bytes rather than following Bun's per-file
  // workspace links back to contributor source. A supervised lane can pin the
  // scratch parent inside its worktree without changing this package closure.
  materializeConsumerNodeModules(join(scaffoldRoot, 'node_modules'));
  const generated = await generateApp(join(scaffoldRoot, 'snapback'));
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(
    generated.summary.counts.degradedResults,
    0,
    JSON.stringify(generated.summary.degradedResults),
  );
  const staticAcceptance = spawnSync(
    process.execPath,
    ['acceptance.static.mjs'],
    { cwd: scaffoldRoot, encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(
    staticAcceptance.status,
    0,
    staticAcceptance.stderr || staticAcceptance.stdout,
  );
  const typecheck = spawnSync(
    join(harnessRoot, 'node_modules', '.bin', 'tsc'),
    ['--noEmit', '--project', join(scaffoldRoot, 'tsconfig.json')],
    { cwd: scaffoldRoot, encoding: 'utf8', timeout: 180_000 },
  );
  assert.equal(typecheck.status, 0, typecheck.stderr || typecheck.stdout);
  const webOutput = join(scratchRoot, 'web-dist');
  const webExport = spawnSync(
    join(harnessRoot, 'node_modules', '.bin', 'expo'),
    ['export', '--platform', 'web', '--output-dir', webOutput, '--clear'],
    {
      cwd: scaffoldRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        EXPO_NO_TELEMETRY: '1',
      },
      timeout: 300_000,
    },
  );
  assert.equal(webExport.status, 0, webExport.stderr || webExport.stdout);
  assert.equal(existsSync(join(webOutput, 'index.html')), true, 'Expo web export omitted index.html');
  const bundleSummary = `${webExport.stdout}\n${webExport.stderr}`
    .split('\n')
    .find((line) => /Web Bundled/u.test(line));
  if (bundleSummary) process.stdout.write(`${bundleSummary}\n`);
  let webPort;
  try {
    webPort = await freeLoopbackPort();
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    process.stdout.write('Expo web serve: SKIP (sandbox denied loopback listen)\n');
  }
  if (webPort !== undefined) {
    const webServer = spawn(
      join(harnessRoot, 'node_modules', '.bin', 'expo'),
      ['start', '--web', '--localhost', '--port', String(webPort), '--clear'],
      {
        cwd: scaffoldRoot,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          CI: '1',
          EXPO_NO_TELEMETRY: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let webLogs = '';
    const capture = (chunk) => {
      webLogs = `${webLogs}${chunk}`.slice(-20_000);
    };
    webServer.stdout.on('data', capture);
    webServer.stderr.on('data', capture);
    try {
      await waitForExpoWeb(webServer, webPort, () => webLogs);
    } finally {
      await stopProcessGroup(webServer);
    }
  }
  process.stdout.write(
    'expo-chat web/prove contract, dependency parity, codegen, strict typecheck, and web export: PASS\n',
  );
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}
