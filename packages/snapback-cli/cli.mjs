#!/usr/bin/env node

import { runCli } from './index.mjs';

try {
  const code = await runCli(process.argv.slice(2));
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
