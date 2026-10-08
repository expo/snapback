import { runOwnedCommand } from '../../../../scripts/test-owned-command.mjs';
import { fixtureWorkMs } from '../../../../scripts/test-work-bounds.mjs';
import { spawnSync } from 'node:child_process';

export function checkedSpawnSync(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) throw Error(`TEST_FIXTURE_COMMAND_${result.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'FAILED'}: ${command} ${args.join(' ')}; ${result.error.message}`, { cause: result.error });
  return result;
}

// Await completion without blocking the test's event loop. A stuck command
// still fails, and private group custody reaps ordinary descendants first.
export async function fixtureCommand(command, args, { label = command, timeout = fixtureWorkMs, ...options } = {}) {
  const result = await runOwnedCommand(command, args, { ...options, timeout });
  const stdout = result.stdout?.toString() ?? '', stderr = result.stderr?.toString() ?? '';
  if (result.error) {
    const kind = result.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'FAILED';
    throw Object.assign(Error(`TEST_FIXTURE_COMMAND_${kind}: ${label}; work bound ${timeout} ms; ${result.error.message}\n${stdout}\n${stderr}`, { cause: result.error }), { result });
  }
  return { ...result, stdout, stderr };
}
