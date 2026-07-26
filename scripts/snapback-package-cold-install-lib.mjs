import { spawn } from 'node:child_process';

// @ref LLP 0041#acceptance — the external package proof exposes a closed
// bootstrap surface and fails before it can silently run a different proof.
export const usage = `Usage:
  node scripts/snapback-package-cold-install.mjs [options]

Prove the packaged Snapback closure through a disposable staged registry and
fresh external application directory.

Options:
  --ledger <path>   Publication ledger to prove
                    (default: dist-publish/publish-ledger.json)
  --receipt <path>  Write the retained proof receipt to this path
  --keep            Keep the temporary external application directory
  -h, --help        Print this help without staging or installing packages
`;

export function parseArguments(args) {
  if (!Array.isArray(args)) throw new TypeError('arguments must be an array');
  const parsed = {
    help: false,
    ledger: null,
    receipt: null,
    keep: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      if (seen.has('help')) throw new TypeError('duplicate argument: --help');
      seen.add('help');
      parsed.help = true;
      continue;
    }
    if (argument === '--keep') {
      if (seen.has(argument)) throw new TypeError('duplicate argument: --keep');
      seen.add(argument);
      parsed.keep = true;
      continue;
    }
    if (argument === '--ledger' || argument === '--receipt') {
      if (seen.has(argument)) throw new TypeError(`duplicate argument: ${argument}`);
      seen.add(argument);
      const value = args[index + 1];
      if (value == null || value.startsWith('-')) {
        throw new TypeError(`${argument} requires a path`);
      }
      parsed[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new TypeError(`unrecognized argument: ${argument}`);
  }
  return parsed;
}

export function runAsync(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let settled = false;
    let timeout;
    let stdout = '';
    let stderr = '';
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    let child;
    try {
      child = spawn(command, commandArgs, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      settle(
        rejectRun,
        new Error(`${command} ${commandArgs.join(' ')} failed to spawn: ${error.message}`, { cause: error }),
      );
      return;
    }

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      settle(
        rejectRun,
        new Error(`${command} ${commandArgs.join(' ')} failed to spawn: ${error.message}`, { cause: error }),
      );
    });
    child.once('close', (status, signal) => {
      if (status !== 0) {
        settle(
          rejectRun,
          new Error(`${command} ${commandArgs.join(' ')} failed (${status ?? signal}):\n${stderr || stdout}`),
        );
        return;
      }
      settle(resolveRun, stdout);
    });
    timeout = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? 360_000);
  });
}
