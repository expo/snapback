import assert from 'node:assert/strict';

import { createPollingDeliveryTracker } from '../../shared/poll-recovery.mjs';

const tracker = createPollingDeliveryTracker();
assert.equal(tracker.accept([{ id: 'same' }]), true, 'first successful poll publishes');
assert.equal(tracker.accept([{ id: 'same' }]), false, 'unchanged healthy poll stays quiet');
tracker.fail();
assert.equal(
  tracker.accept([{ id: 'same' }]),
  true,
  'first success after failure publishes even when the rows are unchanged',
);
assert.equal(tracker.accept([{ id: 'same' }]), false, 'recovered unchanged poll becomes quiet again');

console.log('poll-recovery.test.mjs: transient failure recovery publishes authoritatively');
