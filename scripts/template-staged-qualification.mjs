#!/usr/bin/env node

// @ref LLP 0196#program — T5's release blocker dynamically scaffolds every
// registered template from the exact candidate tarball closure.
// @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — this runs
// before registry mutation, beside the existing packaged-store qualification.

import { resolve } from 'node:path';

import {
  qualifyTemplatePortfolio,
  selfCheckTemplatePortfolio,
} from './template-portfolio-qualification-lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function usage() {
  return `Usage: node scripts/template-staged-qualification.mjs --staged-dir <dir> --receipt <path> [--keep]
       node scripts/template-staged-qualification.mjs --self-check
`;
}

function parseArguments(argv) {
  const parsed = {
    stagedDir: null,
    receipt: null,
    keep: false,
    selfCheck: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      parsed.help = true;
      continue;
    }
    if (argument === '--keep' || argument === '--self-check') {
      parsed[argument === '--keep' ? 'keep' : 'selfCheck'] = true;
      continue;
    }
    if (argument === '--staged-dir' || argument === '--receipt') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new TypeError(`${argument} requires a path`);
      parsed[argument === '--staged-dir' ? 'stagedDir' : 'receipt'] = value;
      continue;
    }
    throw new TypeError(`unrecognized argument ${argument}`);
  }
  if (!parsed.help && !parsed.selfCheck && (!parsed.stagedDir || !parsed.receipt)) {
    throw new TypeError('--staged-dir and --receipt are required');
  }
  return parsed;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
  } else if (args.selfCheck) {
    console.log(JSON.stringify(selfCheckTemplatePortfolio(joinRoot('packages/snapback-cli'))));
  } else {
    const receipt = await qualifyTemplatePortfolio({
      mode: 'staged',
      stagedDir: args.stagedDir,
      receiptPath: args.receipt,
      keep: args.keep,
    });
    console.log(JSON.stringify(receipt));
    if (receipt.status !== 'passed') process.exitCode = 1;
  }
} catch (error) {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
}

function joinRoot(path) {
  return resolve(ROOT, path);
}
