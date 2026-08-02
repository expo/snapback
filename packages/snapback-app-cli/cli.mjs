#!/usr/bin/env node

import { loadAppArtifacts, loadServedApp } from './index.mjs';
import { classifyDiagnosticExit, diagnosticRecord } from './result-core.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
};
const flagValues = new Set([valueAfter('--artifacts'), valueAfter('--server'), valueAfter('--app')]);

try {
  const command = args.find((arg) => !arg.startsWith('-') && !flagValues.has(arg)) ?? 'help';
  if (command === 'help' || args.includes('--help')) {
    process.stdout.write(
      'snapback-app --artifacts <generated-dir> introspect\n'
      + 'snapback-app --server <url> [--offline --app <appId>] introspect\n',
    );
    process.exitCode = 0;
  } else if (command === 'introspect') {
    const server = valueAfter('--server');
    if (server !== null) {
      // Served discovery: zero local artifact files. A dev target or an
      // older server degrades to the local-artifact path when one was also
      // given, and refuses with the server's own diagnostic otherwise.
      const served = await loadServedApp(server, {
        offline: args.includes('--offline'),
        appId: valueAfter('--app'),
      });
      if (served.status === 'unavailable') {
        const artifactsDir = valueAfter('--artifacts');
        if (artifactsDir !== null) {
          process.stdout.write(`${JSON.stringify(await loadAppArtifacts(artifactsDir), null, 2)}\n`);
        } else if (served.diagnostic !== null) {
          throw Object.assign(new Error(served.diagnostic.message), {
            code: served.diagnostic.code,
            diagnostic: served.diagnostic,
            status: 404,
          });
        } else {
          throw Object.assign(
            new Error('this server serves no /app-api surface; pass --artifacts for the local path'),
            { code: 'SNAPBACK_APP_CLI_ARTIFACTS_REQUIRED' },
          );
        }
      } else {
        process.stdout.write(`${JSON.stringify(served, null, 2)}\n`);
      }
    } else {
      const artifacts = await loadAppArtifacts(valueAfter('--artifacts'));
      process.stdout.write(`${JSON.stringify(artifacts, null, 2)}\n`);
    }
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
