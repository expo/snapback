// Repo/app layout resolution + EAS staging unit suite (no Snapback server,
// no network, no EAS).
//
// Exercises demos/_kit/repo-layout.mjs — the marker walk that replaced the
// headless helper's fixed parent traversals
// (issues/closed/20260805-headless-app-nested-demo-root.md) — and the
// out-of-checkout staging performed by demos/_kit/eas-stage-build.mjs
// (issues/closed/20260805-eas-nested-app-git-root-monorepo-archive.md).
//
// Run: node demos/_kit/tests/repo-layout-unit.mjs

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_EXCLUDED_SEGMENTS, stageAppForEas } from '../eas-stage-build.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';
import {
  REPO_ROOT_MARKERS,
  findGitAncestor,
  findRepoRoot,
  resolveHeadlessAppLayout,
} from '../repo-layout.mjs';

const suite = createSuite('kit repo layout + EAS staging (LLP 0176 A3/A4)');

// realpath: on macOS tmpdir is /var -> /private/var, and the resolver walks
// real paths.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'repo-layout-unit-')));

// A fake Snapback-shaped repository: root markers plus a one-level demo and a
// nested bakeoff arm (the arm deliberately named `snapback` to prove the
// backend marker does not confuse an arm with its own backend directory).
const fakeRoot = join(scratch, 'repo');
const oneLevelAcceptance = join(fakeRoot, 'demos', 'todo', 'tests', 'acceptance');
const nestedArm = join(fakeRoot, 'demos', 'bakeoff', 'snapback');
const nestedAcceptance = join(nestedArm, 'tests', 'acceptance');
for (const marker of REPO_ROOT_MARKERS) {
  mkdirSync(fakeRoot, { recursive: true });
  writeFileSync(join(fakeRoot, marker), marker === '.git' ? 'gitdir: elsewhere\n' : '#!/bin/sh\n');
}
mkdirSync(oneLevelAcceptance, { recursive: true });
mkdirSync(join(fakeRoot, 'demos', 'todo', 'snapback'), { recursive: true });
writeFileSync(join(fakeRoot, 'demos', 'todo', 'snapback', 'schema.mjs'), 'export default {};\n');
mkdirSync(nestedAcceptance, { recursive: true });
mkdirSync(join(nestedArm, 'snapback'), { recursive: true });
writeFileSync(join(nestedArm, 'snapback', 'schema.mjs'), 'export default {};\n');

// A directory tree with NO repository markers anywhere beneath scratch. (The
// enclosing real filesystem has no marker pair either: /tmp carries no
// ref-check.)
const orphanDir = join(scratch, 'orphan', 'tests', 'acceptance');
mkdirSync(orphanDir, { recursive: true });

try {
  await suite.check('one-level demos/<app>/tests/acceptance resolves app, backend, and root', () => {
    const layout = resolveHeadlessAppLayout(pathToFileURL(join(oneLevelAcceptance, 'headless.mjs')).href);
    assertEqual(layout.repoRoot, fakeRoot, 'repo root');
    assertEqual(layout.appDir, join(fakeRoot, 'demos', 'todo'), 'app dir');
    assertEqual(layout.backendDir, join(fakeRoot, 'demos', 'todo', 'snapback'), 'backend dir');
    assertEqual(layout.generatedDir, join(fakeRoot, 'demos', 'todo', 'snapback', 'generated'), 'generated dir');
    return layout;
  });

  await suite.check('nested demos/<suite>/<arm>/tests/acceptance resolves the arm, not demos/', () => {
    const layout = resolveHeadlessAppLayout(pathToFileURL(join(nestedAcceptance, 'headless.mjs')).href);
    assertEqual(layout.repoRoot, fakeRoot, 'repo root is the marker root, not demos/');
    assertEqual(layout.appDir, nestedArm, 'app dir is the nested arm');
    assertEqual(layout.backendDir, join(nestedArm, 'snapback'), 'backend is <arm>/snapback');
    return layout;
  });

  await suite.check('outside any recognizable repository refuses with origin + markers', () => {
    let threw = null;
    try {
      resolveHeadlessAppLayout(orphanDir);
    } catch (error) {
      threw = error;
    }
    assert(threw !== null, 'expected a refusal');
    assertEqual(threw.code, 'SNAPBACK_KIT_REPO_ROOT_NOT_FOUND', 'stable code');
    assert(threw.message.includes(orphanDir), `message names the searched origin: ${threw.message}`);
    for (const marker of REPO_ROOT_MARKERS) {
      assert(threw.message.includes(marker), `message names expected marker ${marker}: ${threw.message}`);
    }
    return { message: threw.message };
  });

  await suite.check('a repo with no inferable backend refuses instead of guessing', () => {
    const bare = join(fakeRoot, 'demos', 'bare', 'tests', 'acceptance');
    mkdirSync(bare, { recursive: true });
    let threw = null;
    try {
      resolveHeadlessAppLayout(bare);
    } catch (error) {
      threw = error;
    }
    assert(threw !== null, 'expected a refusal');
    assertEqual(threw.code, 'SNAPBACK_KIT_APP_DIR_NOT_FOUND', 'stable code');
    assert(threw.message.includes('schema.mjs'), `message names the backend marker: ${threw.message}`);
    return { message: threw.message };
  });

  await suite.check('explicit appDir overrides inference and is validated', () => {
    const layout = resolveHeadlessAppLayout(pathToFileURL(join(nestedAcceptance, 'headless.mjs')).href, {
      appDir: join('demos', 'todo'),
    });
    assertEqual(layout.appDir, join(fakeRoot, 'demos', 'todo'), 'repo-root-relative appDir resolves');
    let threw = null;
    try {
      resolveHeadlessAppLayout(pathToFileURL(join(nestedAcceptance, 'headless.mjs')).href, {
        appDir: join('demos', 'bare'),
      });
    } catch (error) {
      threw = error;
    }
    assertEqual(threw?.code, 'SNAPBACK_KIT_BACKEND_NOT_FOUND', 'backendless explicit appDir refuses');
    return layout;
  });

  await suite.check('findRepoRoot discovers THIS checkout from the kit tests directory', () => {
    const root = findRepoRoot(import.meta.dirname);
    assertEqual(realpathSync(root), realpathSync(resolve(import.meta.dirname, '..', '..', '..')), 'walk finds the real root');
    for (const marker of REPO_ROOT_MARKERS) {
      assert(existsSync(join(root, marker)), `real root carries ${marker}`);
    }
    return { root };
  });

  await suite.check('staging copies the app tree without excluded segments', () => {
    const app = join(scratch, 'native-shell');
    mkdirSync(join(app, 'app'), { recursive: true });
    mkdirSync(join(app, 'node_modules', 'react'), { recursive: true });
    mkdirSync(join(app, '.expo'), { recursive: true });
    mkdirSync(join(app, '.snapback'), { recursive: true });
    mkdirSync(join(app, 'dist-ios'), { recursive: true });
    mkdirSync(join(app, 'app', 'node_modules'), { recursive: true });
    writeFileSync(join(app, 'app.json'), '{"expo":{}}\n');
    writeFileSync(join(app, 'package.json'), '{}\n');
    writeFileSync(join(app, 'app', 'index.tsx'), 'export default null;\n');
    writeFileSync(join(app, 'node_modules', 'react', 'package.json'), '{}\n');
    writeFileSync(join(app, '.expo', 'settings.json'), '{}\n');
    writeFileSync(join(app, '.snapback', 'local.sqlite3'), 'local state\n');
    writeFileSync(join(app, 'dist-ios', 'index.hbc'), 'release output\n');
    writeFileSync(
      join(app, '.snapback.snapback.restore.lock'),
      '{"targetInstance":"host-pinned"}\n',
    );
    writeFileSync(join(app, 'app', 'node_modules', 'stray.js'), ';\n');
    const staged = stageAppForEas(app);
    try {
      assert(existsSync(join(staged.stageDir, 'app.json')), 'app.json staged');
      assert(existsSync(join(staged.stageDir, 'app', 'index.tsx')), 'source staged');
      assert(!existsSync(join(staged.stageDir, 'node_modules')), 'node_modules excluded');
      assert(!existsSync(join(staged.stageDir, '.expo')), '.expo excluded');
      assert(!existsSync(join(staged.stageDir, '.snapback')), '.snapback excluded');
      assert(!existsSync(join(staged.stageDir, 'dist-ios')), 'dist-* output excluded');
      assert(
        !existsSync(join(staged.stageDir, '.snapback.snapback.restore.lock')),
        'host-pinned restore lock excluded',
      );
      assert(!existsSync(join(staged.stageDir, 'app', 'node_modules')), 'nested node_modules excluded');
      assertEqual(staged.fileCount, 3, 'exactly the app files were staged');
      assert(findGitAncestor(staged.stageDir) === null, 'stage escaped every git checkout');
      return staged;
    } finally {
      rmSync(staged.stageDir, { recursive: true, force: true });
    }
  });

  await suite.check('staging into a directory inside a git checkout refuses', () => {
    const app = join(scratch, 'native-shell'); // created above
    const insideRepo = join(fakeRoot, 'stage-attempt');
    let threw = null;
    try {
      stageAppForEas(app, { stageDir: insideRepo });
    } catch (error) {
      threw = error;
    }
    assert(threw !== null, 'expected a refusal');
    assert(/inside a Git checkout/.test(threw.message), `refusal names the problem: ${threw.message}`);
    assert(!existsSync(insideRepo), 'no partial stage left behind');
    return { message: threw.message };
  });

  await suite.check('default exclusions cover installs, caches, nested .git, and local state', () => {
    for (const segment of [
      'node_modules',
      '.expo',
      '.git',
      'dist',
      '.snapback',
      '.snapback.snapback.restore.lock',
    ]) {
      assert(DEFAULT_EXCLUDED_SEGMENTS.includes(segment), `${segment} excluded by default`);
    }
    return { DEFAULT_EXCLUDED_SEGMENTS };
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);
