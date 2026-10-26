//! The two-flight S boundary: every decision raises before the trailing COMMIT.
// @ref LLP 3000.009.001.000.000.002#3.2 — dispatch starts the wider unknown window; a later rollback cannot undo a committed final.
use super::store::{Store, Tx};
use crate::{RuntimeError, engine::committer::outcome::Failure};
use std::sync::atomic::Ordering;

pub(super) const IDENTITY: &str = "SELECT generation,store_id FROM pg_temp.sb4_identity($1,$2)";
const HELPERS: &str = r#"
CREATE OR REPLACE FUNCTION pg_temp.sb4_identity(expected_generation bigint,expected_store text)
RETURNS TABLE(generation bigint,store_id text) LANGUAGE plpgsql VOLATILE AS $sb4$
BEGIN
 SELECT b.generation,(SELECT value FROM _meta WHERE key='store_id') INTO generation,store_id FROM _backend b WHERE singleton;
 IF generation IS NULL OR generation OPERATOR(pg_catalog.<>) expected_generation THEN
  RAISE EXCEPTION 'ticket batch generation changed' USING ERRCODE='S4004';
 END IF;
 IF store_id IS NULL OR store_id OPERATOR(pg_catalog.<>) expected_store THEN
  RAISE EXCEPTION 'ticket batch store identity changed' USING ERRCODE='S4005';
 END IF;
 RETURN NEXT;
END $sb4$;
CREATE OR REPLACE FUNCTION pg_temp.sb4_assert_counts(actual bigint[],expected bigint[])
RETURNS bigint LANGUAGE plpgsql VOLATILE AS $sb4$
BEGIN
 IF actual IS NULL OR expected IS NULL OR actual OPERATOR(pg_catalog.<>) expected THEN
  RAISE EXCEPTION 'group tail count mismatch: actual %, expected %',actual,expected USING ERRCODE='S4003';
 END IF;
 RETURN 0;
END $sb4$;
"#;
impl Store {
    pub(super) fn prepare_group_final(&mut self) -> Result<(), RuntimeError> {
        // Code-only, per physical writer session; reconnect drops both caches.
        if !self.has_prepared_group_final() {
            self.calls.set(self.calls.get()+1);
            self.client.batch_execute(HELPERS)?;
        }
        self.prewarm_flight(IDENTITY)
    }
}
impl Tx<'_> {
    pub(crate) fn two_flight(&self) -> bool {
        self.batch_ticket.is_some() && self.early_release.is_none() && self.inner.borrow().checks.is_empty()
    }
    pub(crate) fn prepare_program_tail(&self) -> Result<(),RuntimeError> {
        if self.two_flight() { self.ensure_active() } else { self.flush_tail() }
    }
    pub(super) fn commit_group_final(&self) -> Result<(), Failure> {
        let gate = self.read_grant.as_ref().filter(|_| !self.pipeline && self.publication_enabled())
            .map(|g|g.begin_flight()).transpose().map_err(|error|Failure{error,aborted:false,member:None})?;
        let result = self.flush_group_tail_end(true);
        let sent = self.inner.borrow().done;
        let result = match result {
            Ok(()) => Ok(()),
            Err(error) => {
                let abort_reply = matches!(&error, RuntimeError::Postgres(e) if e.code().is_some_and(|c|
                    matches!(c.code(),"S4001"|"S4002"|"S4003"|"S4004"|"S4005"|"55P03"|"57014"|"40001"|"40P01") || c.code().starts_with("23")));
                // After dispatch, only an explicit abort reply AND the original
                // transaction's acknowledged end authorize a retry. Transport,
                // decoding and warning failures remain unknown, even after ROLLBACK.
                let aborted = (!sent || abort_reply) && {
                    self.calls.set(self.calls.get()+1);
                    self.inner.borrow_mut().client.batch_execute("ROLLBACK").is_ok()
                };
                self.inner.borrow_mut().done = true;
                let error = match error {
                    RuntimeError::Postgres(ref e) if aborted && e.code().is_some_and(|c|matches!(c.code(),"55P03"|"57014")) => RuntimeError::Store("pipeline ticket deadline elapsed".into()),
                    RuntimeError::Postgres(ref e) if aborted && e.code().is_some_and(|c|c.code()=="S4004") => RuntimeError::Generation("ticket batch generation changed".into()),
                    RuntimeError::Postgres(ref e) if aborted && e.code().is_some_and(|c|c.code()=="S4005") => RuntimeError::Structural{code:"E_STORE_REPLACED",message:"ticket batch store identity changed".into()},
                    error if aborted => error,
                    error => RuntimeError::CommitOutcomeUnknown(format!("two-flight final unconfirmed: {error}")),
                };
                Err(Failure {error,aborted,member:None})
            }
        };
        if let Some(gate)=gate {
            gate.resolve(result.as_ref().ok().and_then(|_|self.publication.borrow().clone()),result.as_ref().err().is_some_and(|f|!f.aborted));
        }
        result
    }
    pub(super) fn start_final_dispatch(&self) {
        self.program_deadline.set(None);
        self.commit_warning.store(false,Ordering::SeqCst);
        self.inner.borrow_mut().done=true;
    }
    pub(super) fn final_warning(&self) -> Result<(),RuntimeError> {
        if self.commit_warning.swap(false,Ordering::SeqCst) {
            Err(RuntimeError::CommitOutcomeUnknown("COMMIT returned a cancellation warning".into()))
        } else {Ok(())}
    }
}

#[cfg(test)]
#[path="group_final_tests.rs"]
mod tests;
