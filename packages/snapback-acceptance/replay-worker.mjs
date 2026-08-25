import { readFileSync } from 'node:fs';

import {
  __replayWorker,
  defineReplay,
} from './replay.mjs';

const configFile = process.argv[2];
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());

let fence = null;
let prepared = null;
try {
  prepared = await new Promise((resolvePrepare) => process.once('message', resolvePrepare));
  if (
    prepared?.v !== 'snapback.replay-worker-prepare.v1'
    || typeof prepared.receiptsFile !== 'string'
    || typeof prepared.statusFile !== 'string'
  ) {
    throw new Error('invalid detached prepare envelope');
  }
  fence = __replayWorker.acquireFence(prepared.receiptsFile);
  process.send?.({ v: 'snapback.replay-worker-fenced.v1' });
  const start = await new Promise((resolveStart) => process.once('message', resolveStart));
  if (start?.v !== 'snapback.replay-worker-start.v1') {
    throw new Error('invalid detached start envelope');
  }
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  if (config?.v !== 'snapback.replay-detached-definition.v1') {
    throw new Error('unsupported detached config');
  }
  const definition = defineReplay(config.definition);
  if (
    definition.receiptsFile !== prepared.receiptsFile
    || definition.statusFile !== prepared.statusFile
  ) {
    throw new Error('detached config paths differ from fenced paths');
  }
  process.send?.({ v: 'snapback.replay-worker-started.v1' });
  const result = await __replayWorker.runAttached(definition, {
    resume: config.resume,
    signal: controller.signal,
    preacquiredFence: fence,
  });
  fence = null;
  process.exitCode = result.exitCode;
} catch (error) {
  const diagnostic = {
    code: fence === null && error?.code === 'SNAPBACK_REPLAY_RUNNER_ACTIVE'
      ? error.code
      : 'SNAPBACK_REPLAY_DETACH_CONFIG_INVALID',
    message: fence === null && error?.code === 'SNAPBACK_REPLAY_RUNNER_ACTIVE'
      ? error.message
      : 'detached replay configuration was invalid',
    details: fence === null && error?.code === 'SNAPBACK_REPLAY_RUNNER_ACTIVE'
      ? error.details ?? {}
      : { configFile },
  };
  if (fence !== null && prepared !== null) {
    try {
      __replayWorker.writeDetachedFailureStatus(
        prepared.statusFile,
        prepared.receiptsFile,
        diagnostic,
      );
    } finally {
      __replayWorker.releaseFence(fence);
      fence = null;
    }
  }
  process.send?.({ v: 'snapback.replay-worker-failed.v1', diagnostic });
  process.exitCode = 1;
}
