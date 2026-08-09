#!/usr/bin/env node

import { runCli } from './index.mjs';

try {
  const code = await runCli(process.argv.slice(2));
  if (Number.isInteger(code) && code !== 0) process.exitCode = code;
} catch (error) {
  const command = process.argv[2] ?? null;
  const stableCode = command === 'verify' ? 'SNAPBACK_VERIFY_CLI_FAILED' : 'SNAPBACK_CLI_FAILED';
  const causeCode = typeof error?.code === 'string' && !error.code.startsWith('SNAPBACK_')
    ? error.code
    : null;
  const diagnostic = error?.diagnostic ?? {
    code: typeof error?.code === 'string' && error.code.startsWith('SNAPBACK_') ? error.code : stableCode,
    severity: 'error',
    subsystem: 'cli',
    message: error?.message ?? String(error),
    ...(causeCode === null ? {} : { details: { causeCode } }),
  };
  console.error(JSON.stringify({ ok: false, diagnostics: [diagnostic] }));
  process.exitCode = 1;
}
