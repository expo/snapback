//! Ticket batches, with exact identities for chained successors.
// @ref LLP 3000.009.001.000.000.002#3.4 — store-keyed tickets and an exact head identity prevent ABA.
use super::store::{Store, Tx};
use crate::RuntimeError;
use std::sync::atomic::{AtomicU64, Ordering};

// Shared across handles, including reconnects and token-zero evaluation handles.
// Never restored from a transaction/savepoint checkpoint or re-seeded downward.
static ATTEMPT: AtomicU64 = AtomicU64::new(0);
pub(super) fn fresh_attempt(token: i64) -> Result<String, RuntimeError> {
    let counter = ATTEMPT
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
        .map_err(|_| RuntimeError::Store("attempt counter exhausted".into()))?
        + 1;
    Ok(format!("{token}:{counter}"))
}

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    let exists = tx.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='_head'::regclass AND attname='attempt' AND NOT attisdropped)", &[])?[0].get::<_, bool>(0);
    if !exists {
        tx.batch("ALTER TABLE _head ADD COLUMN attempt TEXT COLLATE \"C\" NOT NULL DEFAULT '0:0'")?;
    }
    let row = tx.query("SELECT atttypid='pg_catalog.text'::regtype,attnotnull,attgenerated::text,attidentity::text,attcollation='pg_catalog.\"C\"'::regcollation FROM pg_attribute WHERE attrelid='_head'::regclass AND attname='attempt' AND NOT attisdropped", &[])?.remove(0);
    if !row.get::<_, bool>(0)
        || !row.get::<_, bool>(1)
        || !row.get::<_, &str>(2).is_empty()
        || !row.get::<_, &str>(3).is_empty()
        || !row.get::<_, bool>(4)
    {
        return Err(RuntimeError::Store(
            "SNAPBACK_ACTIVATION_SCHEMA: incompatible head attempt".into(),
        ));
    }
    let attempt = tx
        .query("SELECT attempt FROM _head WHERE singleton", &[])?
        .remove(0)
        .get::<_, String>(0);
    let (token, counter) = attempt
        .split_once(':')
        .and_then(|(t, c)| Some((t.parse::<u64>().ok()?, c.parse::<u64>().ok()?)))
        .ok_or_else(|| {
            RuntimeError::Store("SNAPBACK_ACTIVATION_SCHEMA: invalid head attempt".into())
        })?;
    if token > i64::MAX as u64 || attempt != format!("{token}:{counter}") {
        return Err(RuntimeError::Store(
            "SNAPBACK_ACTIVATION_SCHEMA: invalid head attempt".into(),
        ));
    }
    ATTEMPT.fetch_max(counter, Ordering::Relaxed);
    let own_token = tx
        .attempt
        .borrow()
        .split_once(':')
        .unwrap()
        .0
        .parse()
        .unwrap();
    *tx.attempt.borrow_mut() = fresh_attempt(own_token)?;
    Ok(())
}

pub(super) fn ticket(store_id: &str, ordinal: u64) -> Result<i64, RuntimeError> {
    let prefix = store_id
        .get(..16)
        .and_then(|s| u64::from_str_radix(s, 16).ok())
        .ok_or_else(|| RuntimeError::StoreOwnership("ticket requires a store identity".into()))?;
    Ok(((prefix & !63) | (ordinal & 63)) as i64)
}
#[derive(Clone)]
pub(crate) struct Head {
    pub seq: i64,
    pub revision: i64,
    pub attempt: String,
    pub xid: String,
}
pub(super) const TICKET: &str = "SELECT pg_catalog.pg_advisory_xact_lock($1)";
pub(super) const HEAD: &str = "SELECT seq,revision,attempt,pg_catalog.pg_current_xact_id()::text,(SELECT generation FROM _backend WHERE singleton),(SELECT value FROM _meta WHERE key='store_id') FROM _head WHERE singleton";
pub(super) const IDENTITY: &str = "SELECT generation,(SELECT value FROM _meta WHERE key='store_id') FROM _backend WHERE singleton";

impl Store {
    pub(crate) fn batch_transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        let store_id = self
            .fence
            .as_ref()
            .ok_or_else(|| RuntimeError::StoreOwnership("ticket requires owner fence".into()))?
            .store_id
            .clone();
        for sql in [
            TICKET,
            HEAD,
            IDENTITY,
            super::batch::AUTH,
            super::batch::AUTH_READ,
            super::batch::RECEIPTS,
            super::batch::LEVEL,
        ] {
            self.prewarm_flight(sql)?;
        }
        let ordinal = self.batch_ordinal.fetch_add(1, Ordering::Relaxed);
        if ordinal == u64::MAX { return Err(RuntimeError::Store("batch ordinal exhausted".into())); }
        let mut tx = self.begin(Some(super::store::WriteMode::Serialized), false)?;
        tx.batch_ticket = Some(ticket(&store_id, ordinal)?);
        Ok(tx)
    }
}
impl Tx<'_> {
    // Only buffered tail production and its commit may substitute a ticket
    // plus exact CAS for the head lock. Authority/family writers stay barriers.
    pub(super) fn require_tail_order(&self, operation: &str) -> Result<(), RuntimeError> {
        if self.batch_ticket.is_some()
            && self.batch_base.borrow().is_some()
            && self.group_head.get().is_some()
        {
            return Ok(());
        }
        self.require_serialized_head_fence(operation)
    }

    pub(super) fn accept_batch_head(&self, row: &super::flight::Row) -> Result<(), RuntimeError> {
        let generation = row.get::<_, i64>(4);
        let identity = row.get::<_, Option<&str>>(5);
        self.check_batch_identity(generation, identity)?;
        let seq = row.get::<_, i64>(0);
        *self.batch_base.borrow_mut() = Some(Head {
            seq,
            revision: row.get(1),
            attempt: row.get(2),
            xid: row.get(3),
        });
        self.head.set(Some(seq as u64));
        self.group_head.set(Some(seq as u64));
        Ok(())
    }
    pub(super) fn check_batch_identity(
        &self,
        generation: i64,
        identity: Option<&str>,
    ) -> Result<(), RuntimeError> {
        if generation as u64 != self.generation_expected {
            return Err(RuntimeError::Generation(
                "another engine activated this store during ticket batch".into(),
            ));
        }
        // The raising fence already checked _owner. Also bind _meta, whose
        // identity is part of the final publication witness.
        if identity != self.batch_store_id.as_deref() {
            // @ref LLP 3000.009.001.000.001#13-g4a-read-refinement-2026-10-23 — a fresh binding failure keeps the mutation refusal code, including before member authority in a chained batch.
            return Err(RuntimeError::Structural {
                code: "E_STORE_REPLACED",
                message: "ticket batch store identity changed".into(),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{Engine, store_port::AnyStore};
    use postgres::{Client, NoTls};
    fn fixture(_: bool) -> Engine {
        crate::engine::program_batch::tests::fixture(true)
    }
    fn observer(engine: &mut Engine) -> (Client, i32, String) {
        let row = engine
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .client
            .query_one("SELECT pg_backend_pid(),current_schema()", &[])
            .unwrap();
        let schema: String = row.get(1);
        let mut client =
            Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
        client
            .batch_execute(&format!("SET search_path=\"{schema}\",pg_catalog"))
            .unwrap();
        (client, row.get(0), schema)
    }
    fn head(client: &mut Client) -> (i64, i64, String) {
        let r = client
            .query_one(
                "SELECT seq,revision,attempt FROM _head WHERE singleton",
                &[],
            )
            .unwrap();
        (r.get(0), r.get(1), r.get(2))
    }
    fn counter(attempt: &str) -> u64 {
        attempt.split_once(':').unwrap().1.parse().unwrap()
    }
    #[test]
    #[ignore = "private Postgres"]
    fn g71_attempt_never_repeats_across_abort_rerun_and_attach() {
        use crate::engine::committer::overlay::Base;
        let mut engine = fixture(true);
        let (mut client, _, schema) = observer(&mut engine);
        let mut seen = std::collections::BTreeSet::new();
        let mut last = 0;
        for boundary in 0..4 {
            let store = engine
                .store_mut()
                .test_postgres_handle_mut()
                .store
                .get_mut();
            let tx = store.batch_transaction().unwrap();
            let attempt = tx.attempt.borrow().clone();
            assert!(counter(&attempt) > last);
            last = counter(&attempt);
            assert!(seen.insert(attempt));
            if boundary == 0 {
                tx.rollback().unwrap();
                continue;
            }
            tx.batch_facts(&[], &[], &mut Base::default()).unwrap();
            let xid = tx.batch_base.borrow().as_ref().unwrap().xid.clone();
            if boundary >= 2 {
                tx.group_tails.borrow_mut().push(Default::default());
                tx.flush_group_tail().unwrap();
            }
            if boundary == 3 {
                tx.commit().unwrap();
            } else {
                tx.rollback().unwrap();
            }
            let status: String = client
                .query_one("SELECT pg_xact_status($1::text::xid8)", &[&xid])
                .unwrap()
                .get(0);
            assert_eq!(
                status,
                if boundary == 3 {
                    "committed"
                } else {
                    "aborted"
                }
            );
        }
        let mut reattached =
            AnyStore::open_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &schema)
                .unwrap();
        let tx = reattached.opening_transaction().unwrap();
        AnyStore::finish_open(tx).unwrap();
        let attempt = head(&mut client).2;
        assert!(counter(&attempt) > last);
        assert!(seen.insert(attempt));
    }
}
