// Channel B relaunch/resume acceptance — React Native/Expo file arm. This is
// the same store-parameterized suite as the web and native/Node-file arms,
// driven through the app-injected Expo File/Directory projection.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFakeExpoFileSystem } from './fake-expo-file-system.mjs';
import { createExpoRqsResumeStore } from './rqs-store-expo.mjs';
import { defineChannelBResumeSuite } from './rqs-resume-suite.mjs';

defineChannelBResumeSuite({
  arm: 'native/expo-file-system',
  createContext: async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapback-rqs-expo-resume-'));
    const { module: fileSystem } = createFakeExpoFileSystem(root);
    const directory = new fileSystem.Directory(fileSystem.Paths.document, 'resume-suite').uri;
    return {
      async makeStore({ relaunchOutboxEmpty = null } = {}) {
        const store = createExpoRqsResumeStore({
          fileSystem,
          directory,
          relaunchOutboxEmpty,
        });
        await store.whenLockSettled();
        return store;
      },
      async settleOwnership(store) {
        await store.whenLockSettled();
      },
      async dispose() {
        await rm(root, { recursive: true, force: true });
      },
    };
  },
});
