export async function proveDeadlineSequence({ run, waitPastDeadline, status, collect, mint, require }) {
  await waitPastDeadline();
  const receipt = await status();
  const invocation = receipt?.invocation;
  require(invocation && invocation.id === run.id && invocation.attempt === run.held.attempt
    && invocation.state === "failed" && invocation.errorCode === "E_ACTION_DEADLINE", "deadline-status-receipt");
  const outcome = await collect();
  require(outcome?.state === "failed" && outcome.why?.code === "E_ACTION_DEADLINE", "deadline-terminal-evidence");
  const mintReply = await mint();
  require(mintReply?.denied?.code === "E_ACTION_LEASE", "deadline-refusal");
}
