#!/usr/bin/env node

import { loadAppArtifacts } from './index.mjs';
import { classifyDiagnosticExit, diagnosticRecord } from './result-core.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
};

try {
  const command = args.find((arg) => !arg.startsWith('-') && arg !== valueAfter('--artifacts')) ?? 'help';
  if (command === 'help' || args.includes('--help')) {
    process.stdout.write('snapback-app --artifacts <generated-dir> introspect\n');
    process.exitCode = 0;
  } else if (command === 'introspect') {
    const artifacts = await loadAppArtifacts(valueAfter('--artifacts'));
    process.stdout.write(`${JSON.stringify(artifacts, null, 2)}\n`);
  } else {
    throw Object.assign(new Error(`unknown command '${command}'`), { code: 'SNAPBACK_APP_CLI_COMMAND_UNKNOWN' });
  }
} catch (error) {
  const diagnostic = error.diagnostic ?? { code: error.code ?? 'SNAPBACK_APP_CLI_FAILED', message: error.message };
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  // The frozen taxonomy classifies every exit — the projection consumes the
  // shared core rules and never re-derives its own mapping (LLP 0062 §2).
  process.exitCode = classifyDiagnosticExit(diagnosticRecord({
    code: diagnostic.code,
    locus: 'engine',
    ...(typeof error.status === 'number' ? { locus: 'request', httpStatus: error.status } : {}),
  }));
}
