#!/usr/bin/env node
// Stage a nested Expo app OUTSIDE the checkout, then run `eas build` from the
// staged copy.
//
// `eas build` resolves its project root at the nearest Git root, so building
// from an app nested inside this monorepo (demos/<bakeoff>/<arm>, internal
// prototypes) archives and uploads the ENTIRE Snapback checkout — the Rust
// runtime, vendor/ibex, every other demo, and all workspace node_modules.
// `.easignore` and EAS's no-VCS mode did not change that root resolution in
// two independent bakeoffs (tandem-expo-bakeoff, relay-room-bakeoff); only
// building from a directory outside the checkout did. This helper is that
// workaround promoted to the paved path
// (issues/closed/20260805-eas-nested-app-git-root-monorepo-archive.md;
// LLP 0176 A3). The upstream prototype was
// demos/tandem-expo-bakeoff/scripts/build-ios-dev-client, which now delegates
// here.
//
// Usage:
//   node demos/_kit/eas-stage-build.mjs <app-dir> [options] [-- <extra eas args>]
//
// Options:
//   --platform <ios|android|all>   eas build platform (default ios)
//   --profile <name>               eas build profile (default development)
//   --stage-only                   stage + report only; never installs deps or
//                                  invokes eas. The staged directory is kept
//                                  and printed so its contents can be
//                                  inspected. Free — never touches the paid
//                                  EAS service.
//   --keep-stage                   keep the staged directory after the build
//   --exclude <name>               extra path segment to exclude (repeatable)

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findGitAncestor } from './repo-layout.mjs';

// Any path segment matching one of these is excluded at every depth: install
// output, bundler caches, and prior build artifacts are reproduced inside the
// stage (bun install) or by EAS itself, and a nested `.git` would recreate
// exactly the root-resolution problem the stage escapes.
export const DEFAULT_EXCLUDED_SEGMENTS = ['node_modules', '.expo', '.git', 'dist'];

// Copy the app tree into an out-of-checkout staging directory and prove the
// escape. Returns { stageDir, fileCount, totalBytes }.
export function stageAppForEas(appDir, {
  stageDir = null,
  excludedSegments = DEFAULT_EXCLUDED_SEGMENTS,
} = {}) {
  const source = resolve(appDir);
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`app directory does not exist: ${source}`);
  }
  if (!existsSync(join(source, 'app.json')) && !existsSync(join(source, 'package.json'))) {
    throw new Error(
      `${source} looks like no Expo app: expected app.json or package.json. ` +
        'Point the helper at the directory that owns the native/EAS config ' +
        '(for the bakeoffs, the arm\'s native-shell directory).',
    );
  }
  const created = !stageDir;
  const destination = stageDir
    ? resolve(stageDir)
    : mkdtempSync(join(tmpdir(), `snapback-eas-${basename(source)}-`));
  const escapeOwner = findGitAncestor(destination);
  if (escapeOwner !== null) {
    if (created) rmSync(destination, { recursive: true, force: true });
    throw new Error(
      `staging directory ${destination} is still inside a Git checkout ` +
        `(${escapeOwner}); eas build would resolve that root and archive the ` +
        'whole repository again. Stage outside every checkout (the default ' +
        'tmpdir stage does).',
    );
  }
  const excluded = new Set(excludedSegments);
  cpSync(source, destination, {
    recursive: true,
    filter: (from) => {
      const rel = relative(source, from);
      if (rel === '' || rel === '.') return true;
      return !rel.split(sep).some((segment) => excluded.has(segment));
    },
  });
  let fileCount = 0;
  let totalBytes = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        fileCount += 1;
        totalBytes += lstatSync(path).size;
      }
    }
  };
  walk(destination);
  return { stageDir: destination, fileCount, totalBytes };
}

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
  }
}

export function parseArgs(argv) {
  const options = {
    appDir: null,
    platform: 'ios',
    profile: 'development',
    stageOnly: false,
    keepStage: false,
    excludedSegments: [...DEFAULT_EXCLUDED_SEGMENTS],
    easArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.easArgs = argv.slice(index + 1);
      break;
    } else if (arg === '--stage-only') options.stageOnly = true;
    else if (arg === '--keep-stage') options.keepStage = true;
    else if (arg === '--platform') options.platform = argv[++index];
    else if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--exclude') options.excludedSegments.push(argv[++index]);
    else if (options.appDir === null && !arg.startsWith('--')) options.appDir = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.appDir) {
    throw new Error(
      'usage: eas-stage-build.mjs <app-dir> [--platform p] [--profile p] ' +
        '[--stage-only] [--keep-stage] [--exclude seg]... [-- extra eas args]',
    );
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const staged = stageAppForEas(options.appDir, {
    excludedSegments: options.excludedSegments,
  });
  const megabytes = (staged.totalBytes / (1024 * 1024)).toFixed(2);
  console.log(
    `staged ${resolve(options.appDir)} -> ${staged.stageDir} ` +
      `(${staged.fileCount} files, ${megabytes} MiB; excluded: ${options.excludedSegments.join(', ')})`,
  );
  if (options.stageOnly) {
    console.log('stage-only: skipping dependency install and eas build; staged directory kept for inspection');
    return 0;
  }
  try {
    runOrThrow('bun', ['install'], { cwd: staged.stageDir });
    // EAS_NO_VCS/EAS_PROJECT_ROOT are belt-and-suspenders on the staged copy:
    // neither fixed root resolution from inside the checkout on its own, but
    // on an out-of-checkout stage they keep eas from hunting for a VCS root.
    runOrThrow(
      'npx',
      [
        'eas-cli@latest', 'build',
        '--profile', options.profile,
        '--platform', options.platform,
        ...options.easArgs,
      ],
      {
        cwd: staged.stageDir,
        env: { ...process.env, EAS_NO_VCS: '1', EAS_PROJECT_ROOT: staged.stageDir },
      },
    );
    return 0;
  } finally {
    if (options.keepStage) console.log(`staged directory kept: ${staged.stageDir}`);
    else rmSync(staged.stageDir, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1]
  && isAbsolute(process.argv[1])
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
