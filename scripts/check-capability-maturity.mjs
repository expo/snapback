#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  validateMaturityRecordTree,
  validateTransitionRange,
} from './capability-maturity.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
let range = null;
if (args.length > 0) {
  if (args.length !== 2 || args[0] !== '--range') {
    process.stderr.write('usage: check-capability-maturity.mjs [--range <base>..<head>]\n');
    process.exit(2);
  }
  range = args[1];
}

const validation = validateMaturityRecordTree({ repoRoot });
if (!range) {
  const explicitBase = process.env.SNAPBACK_MATURITY_BASE_SHA
    ?? process.env.GITHUB_EVENT_BEFORE;
  if (explicitBase && !/^0+$/.test(explicitBase)) {
    range = `${explicitBase}..HEAD`;
  } else {
    let base = null;
    try {
      base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {}
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    range = base && base !== head ? `${base}..HEAD` : 'HEAD^..HEAD';
  }
}
const transitions = validateTransitionRange({ repoRoot, range, validation });
process.stdout.write(
  `[capability-maturity] PASS: ${validation.records.length} records; `
  + `${transitions.length} transition(s) in ${range}\n`,
);
