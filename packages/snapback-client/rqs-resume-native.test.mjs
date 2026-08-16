// Channel B relaunch/resume acceptance — native/DK-9 file arm (LLP 0090
// rollout step 5, ENG-25456): the SAME step-5 acceptance list as the web arm
// (rqs-resume-suite.mjs), driven against the durable file-backed store on a
// real filesystem. A fresh store over the same on-disk directory models an
// app relaunch on the native side of the Hermes/Ibex boundary; the Node
// files adapter stands in for the platform filesystem the embedding shell
// injects on-device.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { exerciseMediaRetainedSupersession } from './rqs-resume-media-test-support.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import { defineChannelBResumeSuite } from './rqs-resume-suite.mjs';

// One context = one device app container: stores share one durable store
// directory (and therefore one on-disk single-writer lock domain).
const createNativeContext = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-rqs-native-'));
  return {
    async makeStore({ relaunchOutboxEmpty = null } = {}) {
      const store = createFileRqsResumeStore({ directory, relaunchOutboxEmpty });
      await store.whenLockSettled();
      return store;
    },
    async settleOwnership(store) {
      // Unlike the queued Web Lock, the file lock is re-attempted: the
      // surviving context claims the released (or dead-holder) lock here.
      await store.whenLockSettled();
    },
    async dispose() {
      await rm(directory, { recursive: true, force: true });
    },
  };
};

defineChannelBResumeSuite({
  arm: 'native/file',
  createContext: createNativeContext,
});

test('media-bearing retained file rows are superseded by a fresh no-resume baseline', async (t) => {
  const ctx = await createNativeContext();
  t.after(() => ctx.dispose());
  await exerciseMediaRetainedSupersession(ctx);
});
