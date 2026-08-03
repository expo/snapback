// LLP 0166 S4 standing gate — run the shipped store-parameterized legacy
// resume suite unmodified against the volatile memory carrier. A shared
// process-local backing models independently constructed contexts without
// making any cold-boot durability claim.

import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';
import { defineChannelBResumeSuite } from './rqs-resume-suite.mjs';

defineChannelBResumeSuite({
  arm: 'memory',
  createContext: async () => {
    const backing = createMemoryRqsStoreBacking();
    return {
      async makeStore({ relaunchOutboxEmpty = null } = {}) {
        return createMemoryRqsResumeStore({ backing, relaunchOutboxEmpty });
      },
      async settleOwnership(store) {
        await store.whenLockSettled();
      },
    };
  },
});
