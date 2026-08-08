#!/usr/bin/env node
// @ref LLP 0186#w2--context-injection-surface-owned-here — thin ecosystem
// wrapper (`npm create snapback-app`): argument parsing and next-step output
// only; the scaffold mechanism and template registry stay in
// @expo/snapback-cli so there is exactly one scaffolder.

import { basename, relative, resolve } from 'node:path';

import { listTemplates, scaffoldApp } from '@expo/snapback-cli';

const DEFAULT_TEMPLATE = 'expo-chat';

function usage() {
  const templates = listTemplates();
  return [
    'usage: create-snapback-app <target-dir> [--template <name>] [--json]',
    '',
    `Scaffolds a Snapback application (default template: ${DEFAULT_TEMPLATE}).`,
    'Equivalent invocations: npm create snapback-app <target-dir>,',
    'npx create-snapback-app <target-dir>, bun create snapback-app <target-dir>,',
    'pnpm create snapback-app <target-dir>.',
    '',
    'Templates (from the @expo/snapback-cli template registry):',
    ...templates.map((name) => `  ${name}${name === DEFAULT_TEMPLATE ? ' (default)' : ''}`),
    '',
    'Delegates to `snapback new <target-dir> --template <name>`.',
  ].join('\n');
}

export function parseArguments(argv) {
  const args = [...argv];
  let target = null;
  let template = DEFAULT_TEMPLATE;
  let json = false;
  let help = false;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--json') json = true;
    else if (arg === '--template') {
      template = args.shift();
      if (template === undefined) {
        throw Object.assign(new Error('--template requires a value'), { code: 'SNAPBACK_NEW_TEMPLATE_UNKNOWN' });
      }
    } else if (arg.startsWith('-')) {
      throw Object.assign(new Error(`unknown flag ${arg}\n${usage()}`), { code: 'SNAPBACK_NEW_USAGE' });
    } else if (target === null) {
      target = arg;
    } else {
      throw Object.assign(new Error(`unexpected argument ${arg}\n${usage()}`), { code: 'SNAPBACK_NEW_USAGE' });
    }
  }
  return { target, template, json, help };
}

function nextSteps(result) {
  const path = relative(process.cwd(), resolve(result.target)) || '.';
  return [
    `Scaffolded ${basename(result.target)} from the ${result.template} template.`,
    '',
    'Next steps:',
    `  cd ${path}`,
    '  bun install',
    '  bun run dev',
    '',
    'Then read AGENTS.md and the served Guide before adding features;',
    '`bun run test:static` checks the acceptance suite without a live server.',
  ].join('\n');
}

export function runCreateSnapbackApp(argv) {
  const { target, template, json, help } = parseArguments(argv);
  if (help) {
    console.log(usage());
    return 0;
  }
  if (!target) {
    throw Object.assign(new Error(`target directory required\n${usage()}`), { code: 'SNAPBACK_NEW_NAME_REQUIRED' });
  }
  const result = scaffoldApp(target, { template });
  if (json) console.log(JSON.stringify(result));
  else console.log(nextSteps(result));
  return 0;
}

try {
  const code = runCreateSnapbackApp(process.argv.slice(2));
  if (Number.isInteger(code) && code !== 0) process.exitCode = code;
} catch (error) {
  const diagnostic = error?.diagnostic ?? {
    code: error?.code ?? 'SNAPBACK_CLI_FAILED',
    severity: 'error',
    subsystem: 'cli',
    message: error?.message ?? String(error),
  };
  console.error(JSON.stringify({ ok: false, diagnostics: [diagnostic] }));
  process.exitCode = 1;
}
