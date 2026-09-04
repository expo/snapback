//! Narrow offline APIs over the runtime's private engine and store.
// @ref LLP 1012#7-writes-offline — allocator custody and replay execution stay
// behind the certified Runtime rather than exposing mutable storage.

use crate::engine::{Context, Execution, RuntimeError};
use crate::offline::{ReplayCommit, ReplayGrant};
use crate::registry::Runtime;

impl Runtime {
    /// Mint one principal-bound replay grant at server time `now`.
    pub fn mint_replay_grant(
        &mut self,
        principal: &str,
        now: i64,
    ) -> Result<ReplayGrant, RuntimeError> {
        self.engine.store_mut().mint_replay_grant(principal, now)
    }

    /// Age out grants past their expiry and intents older than the grant
    /// lifetime, in one statement batch.
    pub fn sweep_offline(&self, now: i64) -> Result<(), RuntimeError> {
        self.engine.store().sweep_offline(now)
    }

    /// Programs executed by this runtime since it opened: every query,
    /// mutation, and replay, counted once. Resume's cost is measured in these
    /// (LLP 1012 §14), never in held pages.
    pub fn executions(&self) -> u64 {
        self.executions
    }

    /// Execute a mutation under a replay envelope: pinned ids in `context`,
    /// trace validation and the intent ledger inside the mutation's transaction.
    pub fn execute_replay(
        &mut self,
        op: &str,
        context: Context,
        replay: &ReplayCommit,
    ) -> Result<Execution, RuntimeError> {
        self.executions = self.executions.saturating_add(1);
        let (program, certificate) = self
            .generation
            .programs
            .get(op)
            .cloned()
            .ok_or_else(|| RuntimeError::OpUnknown(op.to_owned()))?;
        self.engine
            .execute_replay(&program, &certificate, context, replay)
    }
}
