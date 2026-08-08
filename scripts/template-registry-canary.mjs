#!/usr/bin/env node

// @ref LLP 0196#program — T5's post-release half observes the published
// registry closure after staging can no longer see registry resolution drift.
// @ref LLP 0189#decision — this report-only canary joins the scheduled D2.3
// complete battery; it is not a landing or release blocker.

import { resolve } from 'node:path';

import { PUBLIC_NPM_REGISTRY } from './snapback-package-cold-install-lib.mjs';
import {
  qualifyTemplatePortfolio,
  selfCheckTemplatePortfolio,
} from './template-portfolio-qualification-lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function usage() {
  return `Usage: node scripts/template-registry-canary.mjs [--registry <url>] [--version <exact-or-tag>] [--receipt <path>] [--keep] [--strict]
       node scripts/template-registry-canary.mjs --self-check
`;
}

function parseArguments(argv) {
  const parsed = {
    registry: PUBLIC_NPM_REGISTRY,
    version: 'latest',
    receipt: resolve(ROOT, 'target/proof/template-registry-canary.json'),
    keep: false,
    strict: false,
    selfCheck: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      parsed.help = true;
      continue;
    }
    if (['--keep', '--strict', '--self-check'].includes(argument)) {
      parsed[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    if (['--registry', '--version', '--receipt'].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new TypeError(`${argument} requires a value`);
      parsed[argument.slice(2)] = value;
      continue;
    }
    throw new TypeError(`unrecognized argument ${argument}`);
  }
  return parsed;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
  } else if (args.selfCheck) {
    console.log(JSON.stringify(selfCheckTemplatePortfolio(resolve(ROOT, 'packages/snapback-cli'))));
  } else {
    const receipt = await qualifyTemplatePortfolio({
      mode: 'registry',
      registry: args.registry,
      version: args.version,
      receiptPath: args.receipt,
      keep: args.keep,
    });
    console.log(JSON.stringify(receipt));
    if (receipt.status !== 'passed') {
      const message = `published template canary failed; report: ${resolve(args.receipt)}`;
      if (process.env.GITHUB_ACTIONS === 'true') console.warn(`::warning title=Snapback template registry canary::${message}`);
      else console.warn(message);
      if (args.strict) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
}
