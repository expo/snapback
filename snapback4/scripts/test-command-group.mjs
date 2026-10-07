// Bootstrap inspection cannot import test-signals: that API is still compiling.
// This is read-only. No row or group number authorizes signal dispatch.
import { setTimeout as sleep } from 'node:timers/promises';

export async function waitForEmptyGroup(group, run) {
  if (!Number.isSafeInteger(group) || group <= 0) throw Error('TEST_COMMAND_INSPECTION: invalid group');
  const deadline = performance.now() + 60000;
  let empty = 0;
  for (;;) {
    // Use the system ps directly: no PATH shim or compiler dependency. Its
    // timeout discards partial output and kills only its owned leaf handle.
    const result = await run('/bin/ps', ['-axo', 'pid=,pgid=,stat='], {
      timeout: 10000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
    });
    if (result.error || result.status !== 0 || !result.stdout?.toString().trim())
      throw Error(`TEST_COMMAND_INSPECTION: ps failed: ${result.error?.message ?? result.status}`);
    const rows = result.stdout.toString().trim().split('\n').map(line => {
      const match = /^\s*(\d+)\s+(-?\d+)\s+([A-Za-z?][A-Za-z0-9+<>-]*)\s*$/.exec(line);
      if (!match || !match.slice(1, 3).every(n => Number.isSafeInteger(Number(n))))
        throw Error(`TEST_COMMAND_INSPECTION: malformed routing: ${line}`);
      return { pid: Number(match[1]), group: Number(match[2]), state: match[3] };
    });
    // Exit-time sentinel routing is not an empty group. Take a new complete
    // snapshot, within the same deadline; persistent damage refuses.
    const invalid = rows.find(row => row.pid > 0x7fffffff || row.group < 0 || row.group > 0x7fffffff);
    const living = rows.filter(row => row.group === group && row.state[0] !== 'Z'
      && !(process.platform === 'linux' && row.state[0] === 'X'));
    if (invalid || living.length) {
      empty = 0;
      if (performance.now() >= deadline)
        throw Error(`TEST_COMMAND_GROUP_NOT_EMPTY: ${JSON.stringify(invalid ?? living)}`);
    } else if (++empty === 2) return;
    await sleep(50);
  }
}
