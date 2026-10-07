// Test-only publication barriers. PID files carry identity, never permission
// to send a numeric signal. Only the C fixture can act on its private request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { inspectSignalTarget, checkSignalRecord, signalTargetAlive } from '../../../../scripts/test-signals.mjs';

export function publisherPid(text) {
  if (!/^[1-9][0-9]*\n?$/.test(text)) return undefined;
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid <= 0x7fffffff ? pid : undefined;
}
export async function waitForPublisher(file, argv, timeout = 30000) {
  const end = performance.now() + timeout;
  for (;;) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const pid = publisherPid(text ?? '');
    if (pid !== undefined) return inspectSignalTarget(pid, argv);
    assert.ok(performance.now() < end, 'complete positive publisher PID record required');
    await pause(20);
  }
}
export async function killPausedPublisher(file, record, argv) {
  checkSignalRecord(record, argv);
  releasePublisherBarrier(file);
}
export function releasePublisherBarrier(file) {
  // Also usable by finally before readiness, or after a corrupt/stale record:
  // only the injected publisher at this private path reads this request. It
  // raises SIGKILL on itself; neither PID 0 nor an unrelated PID is signalled.
  fs.writeFileSync(file + '.kill', '');
}
export async function waitForPublisherExit(record, timeout = 30000) {
  const end = performance.now() + timeout;
  for (;;) {
    if (!signalTargetAlive(record)) return;
    assert.ok(performance.now() < end, 'owned publisher exited after its lease was released');
    await pause(20);
  }
}
