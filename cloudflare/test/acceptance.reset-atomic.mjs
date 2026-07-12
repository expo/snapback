// ENG-24367: every destructive SQL boundary rolls back completely, while a
// post-commit alarm-cleanup failure reports a committed reset (not a false
// "previous state preserved" 500).
import { startProof } from './harness.mjs';

const faultSteps = ['after-journal', 'after-runtime-state', 'after-app-rows', 'after-seed'];
for (const step of faultSteps) {
  const proof = await startProof({ app: 'notes', bindings: { SNAPBACK_TEST_RESET_FAIL_AFTER: step } });
  try {
    const inserted = await proof.mutation('addNote', { boardId: 'reset', text: step });
    const before = await proof.query('listNotes', { boardId: 'reset' });
    const reset = await proof.reset();
    const after = await proof.query('listNotes', { boardId: 'reset' });
    if (reset.code !== 'SNAPBACK_RESET_INJECTED_FAILURE') {
      throw new Error(`${step}: reset did not return the injected transaction diagnostic: ${JSON.stringify(reset)}`);
    }
    if (after.version !== inserted.version || JSON.stringify(after.rows) !== JSON.stringify(before.rows)) {
      throw new Error(`${step}: failed reset did not preserve rows/version atomically`);
    }
  } finally {
    await proof.dispose();
  }
}

const postCommit = await startProof({
  app: 'notes',
  bindings: { SNAPBACK_TEST_RESET_POST_COMMIT_ALARM_FAILURE: '1' },
});
try {
  await postCommit.mutation('addNote', { boardId: 'reset', text: 'must be cleared' });
  const reset = await postCommit.reset();
  const after = await postCommit.query('listNotes', { boardId: 'reset' });
  if (reset.reset !== true || reset.cleanup !== 'deferred' || reset.warnings?.[0]?.code !== 'SNAPBACK_RESET_ALARM_CLEANUP_FAILED') {
    throw new Error(`committed reset was not reported honestly: ${JSON.stringify(reset)}`);
  }
  if (after.version !== 0 || after.rows.length !== 0) {
    throw new Error(`post-commit cleanup fault rolled back or obscured reset state: ${JSON.stringify(after)}`);
  }
} finally {
  await postCommit.dispose();
}

console.log('cloudflare reset-atomic acceptance: SQL faults roll back and post-commit cleanup is reported honestly');
