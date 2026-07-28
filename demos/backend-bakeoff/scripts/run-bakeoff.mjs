#!/usr/bin/env node

import { resolve } from 'node:path';

import {
  defaultRepoRoot,
  runBakeoff,
  verifyReceipt,
} from './bakeoff-runner-lib.mjs';

function usage() {
  return [
    'Usage:',
    '  bun run bakeoff:run',
    '  bun run bakeoff:verify -- <acceptance/results/backend-bakeoff-run.*.v2.json>',
  ].join('\n');
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--verify') {
    if (args.length !== 2) throw new Error(usage());
    const path = resolve(process.cwd(), args[1]);
    const receipt = verifyReceipt(path, { repoRoot: defaultRepoRoot });
    process.stdout.write(
      `verified ${receipt.content.summary.status} backend bakeoff receipt ${receipt.contentSha256}\n`,
    );
    if (receipt.content.summary.status !== 'passed') process.exitCode = 1;
  } else {
    if (args.length !== 0) throw new Error(usage());
    const result = await runBakeoff();
    process.stdout.write(
      `${result.envelope.content.summary.status} backend bakeoff receipt: ${result.path}\n`,
    );
    if (result.envelope.content.summary.status !== 'passed') process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 2;
}
