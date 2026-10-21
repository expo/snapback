//! Scoped step views dispatch on their borrowed owning handle.
use crate::{RuntimeError, store as sqlite};
use crate::store_port::{AnyTx, ActionStepTransaction, EffectStepTransaction};
use crate::engine::steps::*;
impl StepTransaction for ActionStepTransaction<'_, '_> {
    fn record(&self, owner: StepOwner<'_>, name: &str) -> Result<Option<StepRecord>, RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::record(& sqlite::steps::ActionStepTransaction { tx }, owner, name) } }
    fn insert(&mut self, owner: StepOwner<'_>, step: &PreparedBegin<'_>, at: i64) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::insert(&mut sqlite::steps::ActionStepTransaction { tx }, owner, step, at) } }
    fn take_over(&mut self, owner: StepOwner<'_>, name: &str, claim: &StepClaim) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::take_over(&mut sqlite::steps::ActionStepTransaction { tx }, owner, name, claim) } }
    fn complete(&mut self, owner: StepOwner<'_>, name: &str, result: &str, at: i64) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::complete(&mut sqlite::steps::ActionStepTransaction { tx }, owner, name, result, at) } }
    fn park(&mut self, owner: StepOwner<'_>, name: &str, error: &str) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::park(&mut sqlite::steps::ActionStepTransaction { tx }, owner, name, error) } }
    fn finish_parked(&mut self, owner: StepOwner<'_>, code: &str, error: &str, at: i64) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::finish_parked(&mut sqlite::steps::ActionStepTransaction { tx }, owner, code, error, at) } }
}
impl StepTransaction for EffectStepTransaction<'_, '_> {
    fn record(&self, owner: StepOwner<'_>, name: &str) -> Result<Option<StepRecord>, RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::record(& sqlite::steps::EffectStepTransaction { tx }, owner, name) } }
    fn insert(&mut self, owner: StepOwner<'_>, step: &PreparedBegin<'_>, at: i64) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::insert(&mut sqlite::steps::EffectStepTransaction { tx }, owner, step, at) } }
    fn take_over(&mut self, owner: StepOwner<'_>, name: &str, claim: &StepClaim) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::take_over(&mut sqlite::steps::EffectStepTransaction { tx }, owner, name, claim) } }
    fn complete(&mut self, owner: StepOwner<'_>, name: &str, result: &str, at: i64) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::complete(&mut sqlite::steps::EffectStepTransaction { tx }, owner, name, result, at) } }
    fn park(&mut self, owner: StepOwner<'_>, name: &str, error: &str) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::park(&mut sqlite::steps::EffectStepTransaction { tx }, owner, name, error) } }
    fn finish_parked(&mut self, owner: StepOwner<'_>, code: &str, error: &str, at: i64) -> Result<(), RuntimeError> { match self.tx { AnyTx::Sqlite(tx) => StepTransaction::finish_parked(&mut sqlite::steps::EffectStepTransaction { tx }, owner, code, error, at) } }
}
