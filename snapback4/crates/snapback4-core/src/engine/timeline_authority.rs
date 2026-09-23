//! Scoped engine authority. Purge grants only bounded deletes, never inserts or updates.
use super::{runner::Runner, timeline::refusal};
use crate::{RuntimeError, schema::{Effect, Schema}};
use std::{collections::BTreeMap, ops::{Deref, DerefMut}};

pub(super) enum Authority {
    Transition(String),
    Purge(BTreeMap<String, u64>),
}

impl Authority {
    #[cfg(feature = "sqlite")]
    pub(super) fn purge(schema: &Schema, program: &str) -> Self {
        Self::Purge(schema.timelines.iter().filter(|t| t.purge == program)
            .flat_map(|t| [(t.table("Feed"), 1001), (t.table("RemovedEvents"), 1)]).collect())
    }
}

pub(super) struct Guard<'r, 'tx> {
    runner: &'r mut Runner<'tx>,
    previous: Option<Authority>,
}
impl<'tx> Deref for Guard<'_, 'tx> {
    type Target = Runner<'tx>;
    fn deref(&self) -> &Self::Target { self.runner }
}
impl DerefMut for Guard<'_, '_> {
    fn deref_mut(&mut self) -> &mut Self::Target { self.runner }
}
impl Drop for Guard<'_, '_> {
    fn drop(&mut self) { self.runner.timeline_authority = self.previous.take(); }
}

impl<'tx> Runner<'tx> {
    pub(super) fn timeline_scope(&mut self, authority: Authority) -> Guard<'_, 'tx> {
        let previous = self.timeline_authority.replace(authority);
        Guard { runner: self, previous }
    }

    pub(super) fn timeline_may_write(&self, table: &str, effect: Effect) -> bool {
        if effect == Effect::Read { return false; }
        match &self.timeline_authority {
            Some(Authority::Transition(name)) => self.schema.timelines.iter().any(|t| &t.name == name && t.owns(table)),
            Some(Authority::Purge(tables)) => effect == Effect::Delete && tables.get(table).is_some_and(|left| *left > 0),
            None => false,
        }
    }

    pub(super) fn refuse_timeline_purge_write(&self, table: &str, effect: Effect) -> Result<(), RuntimeError> {
        if matches!(&self.timeline_authority, Some(Authority::Purge(tables)) if !tables.is_empty())
            && !self.timeline_may_write(table, effect) {
            return Err(refusal("E_TIMELINE_OWNED", "a timeline purge may only delete its bounded inbox copies and tombstones"));
        }
        Ok(())
    }

    pub(super) fn timeline_purge_charge(&mut self, table: &str) -> Result<(), RuntimeError> {
        if let Some(Authority::Purge(tables)) = &mut self.timeline_authority {
            if let Some(left) = tables.get_mut(table) {
                *left = left.checked_sub(1).ok_or_else(|| refusal("E_TIMELINE_OWNED", "timeline purge chunk exceeds its delete bound"))?;
            }
        }
        Ok(())
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, Ceilings, meter::{Meter,Cut}};
    #[test]
    fn guard_restores_previous_authority_after_success_and_error() {
        let mut store=crate::Store::memory().unwrap();let tx=store.transaction().unwrap();let schema=Schema::default();
        let mut runner=Runner::new(&tx,&schema,Context::system(),Meter::new(Ceilings::default(),Cut::Abort),0);
        fn fail(runner:&mut Runner<'_>)->Result<(),RuntimeError> {
            let guard=runner.timeline_scope(Authority::Transition("inner".into()));
            assert!(matches!(&guard.timeline_authority,Some(Authority::Transition(name)) if name=="inner"));
            Err(refusal("E_TIMELINE_SHAPE","injected error"))
        }
        {
            let mut outer=runner.timeline_scope(Authority::Transition("outer".into()));
            assert!(fail(&mut outer).is_err());
            assert!(matches!(&outer.timeline_authority,Some(Authority::Transition(name)) if name=="outer"));
        }
        assert!(runner.timeline_authority.is_none());assert!(fail(&mut runner).is_err());assert!(runner.timeline_authority.is_none());
    }
}
