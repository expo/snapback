//! Canonical row images and ordered binary keys shared by the common engine
//! and its retained evaluation oracle. Common-engine durable transactions
//! take the store owner fence before the head; serving policy lives above it.
use crate::{
    error::RuntimeError,
    key,
    rows::{Bounds, Dir, Rows, stored_index_keys},
    schema::{Index, Table},
    value::{Value, canonical_json},
};
use postgres::{Client, Statement, types::{ToSql, FromSql, Format, IsNull, Kind}};
pub(crate) use super::flight::Row;
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
};

/// One Postgres scan's physical memory guard (word_heap::StoreGuard): sixteen
/// times the default 16 MiB heap ceiling, the same as SQLite's.
pub const SCAN_MEMORY_GUARD: u64 = 256 << 20;
/// Network and decoder buffers the driver holds for one statement.
const DRIVER_SCRATCH: u64 = 4096;
/// Each fetched row's driver image beyond its payload: the Row, its column
/// ranges and the result-vector slot.
const ROW_SCRATCH: u64 = 256;

// @ref LLP 3000.033#1.3 — additive on create and reopen; old full authority stays readable.
pub(super) const READ_SESSIONS_DDL: &str = "
CREATE TABLE IF NOT EXISTS _read_sessions (token_digest TEXT COLLATE \"C\" PRIMARY KEY, principal TEXT COLLATE \"C\" NOT NULL, kind TEXT NOT NULL, family TEXT COLLATE \"C\" NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, cap_expires_at BIGINT NOT NULL, principal_generation BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS _read_sessions_family ON _read_sessions(principal, family, expires_at);
";

pub(super) const VERSION: &str = "snapback4-postgres-evaluation-3";
pub(super) const DDL: &str = "
CREATE TABLE _backend (singleton BOOLEAN PRIMARY KEY CHECK(singleton), version TEXT NOT NULL, schema TEXT NOT NULL, programs TEXT NOT NULL);
CREATE TABLE _head (singleton BOOLEAN PRIMARY KEY CHECK(singleton), seq BIGINT NOT NULL CHECK(seq >= 0), revision BIGINT NOT NULL DEFAULT 0 CHECK(revision >= 0), attempt TEXT COLLATE \"C\" NOT NULL DEFAULT '0:0');
INSERT INTO _head VALUES (true, 0);
CREATE TABLE r (t TEXT COLLATE \"C\" NOT NULL, id TEXT COLLATE \"C\" NOT NULL, data TEXT NOT NULL, PRIMARY KEY(t,id));
CREATE TABLE i (t TEXT COLLATE \"C\" NOT NULL, ix TEXT COLLATE \"C\" NOT NULL, k BYTEA NOT NULL, id TEXT COLLATE \"C\" NOT NULL, PRIMARY KEY(t,ix,k));
CREATE TABLE _commits (seq BIGINT PRIMARY KEY, at BIGINT NOT NULL, program TEXT NOT NULL, principal TEXT NOT NULL, kind TEXT NOT NULL, touched TEXT NOT NULL, writes BIGINT NOT NULL);
CREATE TABLE _log (partition TEXT COLLATE \"C\" NOT NULL, seq BIGINT NOT NULL, ord BIGINT NOT NULL, t TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY(partition,seq,ord));
CREATE TABLE _ops (principal TEXT COLLATE \"C\" NOT NULL, id TEXT COLLATE \"C\" NOT NULL, seq BIGINT NOT NULL, outcome TEXT NOT NULL, name TEXT, args_digest TEXT, at BIGINT NOT NULL, PRIMARY KEY(principal,id));
CREATE TABLE _sequences (parent TEXT NOT NULL, id TEXT NOT NULL, value BIGINT NOT NULL, PRIMARY KEY(parent, id));
CREATE TABLE _effect_keys (effect TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(effect, key));
CREATE TABLE _principal_generations (principal TEXT COLLATE \"C\" PRIMARY KEY, generation BIGINT NOT NULL);
CREATE TABLE _sessions (token_digest TEXT COLLATE \"C\" PRIMARY KEY, principal TEXT COLLATE \"C\" NOT NULL, kind TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, family TEXT COLLATE \"C\");
CREATE INDEX _sessions_expiry ON _sessions(expires_at);
CREATE INDEX _sessions_family ON _sessions(principal, family, expires_at);
CREATE TABLE _requests (
    id TEXT COLLATE \"C\" PRIMARY KEY, name TEXT COLLATE \"C\" NOT NULL, args TEXT NOT NULL,
    principal TEXT COLLATE \"C\" NOT NULL, at BIGINT NOT NULL, state TEXT NOT NULL,
    attempts BIGINT NOT NULL DEFAULT 0, next_at BIGINT, lease_until BIGINT,
    claimed_by TEXT COLLATE \"C\", session_digest TEXT COLLATE \"C\", result TEXT, error TEXT,
    family TEXT COLLATE \"C\", principal_generation BIGINT, admitted_expires_at BIGINT,
    args_digest TEXT, error_code TEXT, settled_at BIGINT, spec TEXT, contract TEXT,
    deadline BIGINT, release TEXT, service_generation BIGINT,
    cancelled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX _requests_due ON _requests(state, name, at, id);
CREATE INDEX _requests_session ON _requests(session_digest);
";

/// Evaluation modes, not a claim of horizontally scalable commit ordering.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WriteMode {
    /// Reserve the head before executing, matching SQLite's single writer.
    #[default]
    Serialized,
    /// Run concurrently, retrying the entire transaction on serialization
    /// failure. A single global sync head is still a contention point.
    Serializable,
}

#[cfg(not(any(test, feature = "test-support")))]
pub(super) type CallCounter = Cell<u64>;
#[cfg(any(test, feature = "test-support"))]
pub(super) use crate::round_trips::CallCounter;


pub struct Store {
    pub(super) read_sessions: Cell<bool>,
    pub(super) unified: bool,
    pub(super) fence: Option<super::ownership::Fence>,
    pub(crate) read_grant: Option<std::sync::Arc<super::read_grant::Grant>>,
    pub(super) commit_warning: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub generation: u64,
    pub(crate) read_only: bool,
    pub(crate) client: super::pipeline::Connection,
    qualified: bool,
    pub(super) batch_ordinal: std::sync::Arc<std::sync::atomic::AtomicU64>,
    reader_binding: bool,
    pub(crate) next_program_deadline: Option<std::time::Instant>,
    literal_cache: BTreeMap<String, super::literal::Prepared>,
    cache: BTreeMap<String, Statement>,
    pub calls: CallCounter,
    pub prefetch: bool,
    pub marked_reads: Cell<u64>,
    pub page_reads: Cell<u64>,
    pub prefetch_rows: Cell<u64>,
    pub prefetch_bytes: Cell<u64>,
}

impl Store {
    pub fn new(client: Client) -> Self { Self::with_connection(super::pipeline::Connection::Sync(client)) }
    pub(super) fn with_connection(client: super::pipeline::Connection) -> Self {
        Self { read_sessions: Cell::new(false), unified: false, fence: None, read_grant: None, commit_warning: Default::default(), generation:1, read_only: false, client, qualified: false, batch_ordinal: Default::default(), reader_binding: false, next_program_deadline: None, literal_cache: BTreeMap::new(), cache: BTreeMap::new(), calls: CallCounter::new(0), prefetch: true, marked_reads: Cell::new(0), page_reads: Cell::new(0), prefetch_rows: Cell::new(0), prefetch_bytes: Cell::new(0) }
    }

    // @ref LLP 3000.009.001.000#8 — only future requests reconnect, with fresh binding checks.
    // A future request may replace a driver already known closed. Cached
    // statements belong to the old socket; no result or authority is reused.
    fn refresh_reader_connection(&mut self) -> Result<(),RuntimeError> {
        if self.client.refresh_closed()? {
            if let Some(grant)=&self.read_grant {grant.revoke();}
            self.literal_cache.clear(); self.cache.clear();
            self.reader_binding = self.unified;
        }
        if self.reader_binding {
            self.calls.set(self.calls.get()+2);
            let row = self.client.query_one("SELECT (SELECT value FROM _meta WHERE key='store_id'),generation FROM _backend WHERE singleton", &[])?;
            if row.try_get::<_,Option<&str>>(0)? != self.fence.as_ref().map(|f|f.store_id.as_str()) || self.fence.is_none() {
                return Err(RuntimeError::Generation("reader store identity changed while reconnecting; reopen the engine".into()));
            }
            if u64::try_from(row.try_get::<_,i64>(1)?).ok() != Some(self.generation) {
                return Err(RuntimeError::Generation("reader generation changed while reconnecting; reopen the engine".into()));
            }
            self.calls.set(self.calls.get()+2);
            if let Some(row) = self.client.query(super::managed_relations::SQL, &[&crate::managed_relations::TABLES])?.first() {
                return Err(crate::managed_relations::refusal(row.get(0), row.get(1)));
            }
            // Keep the validation pending after any mismatch or failed query.
            self.reader_binding = false;
        }
        Ok(())
    }

    pub(crate) fn cached_read(&mut self)->Result<Tx<'_>,RuntimeError> {self.begin_inner(None,false,true)}
    pub(super) fn begin(&mut self, mode: Option<WriteMode>, opening: bool) -> Result<Tx<'_>, RuntimeError> {self.begin_inner(mode,opening,false)}
    fn begin_inner(&mut self, mode: Option<WriteMode>, opening: bool, cpu_only:bool) -> Result<Tx<'_>, RuntimeError> {
        self.begin_resuming(mode, opening, cpu_only, false)
    }
    fn begin_resuming(&mut self, mode: Option<WriteMode>, opening: bool, cpu_only: bool, resuming: bool) -> Result<Tx<'_>, RuntimeError> {
        if !resuming && mode.is_some() && self.read_grant.as_ref().is_some_and(|g|g.uncertain.load(std::sync::atomic::Ordering::Acquire)) {return Err(RuntimeError::StoreOwnership("unknown COMMIT pauses writer admission until fenced reconciliation".into()));}
        let deadline = self.next_program_deadline.take();
        if self.read_only && mode.is_some() { return Err(RuntimeError::Store("Postgres reader is read-only".into())); }
        if !cpu_only { self.refresh_reader_connection()?; }
        if !self.qualified && !cpu_only {
            if !self.client.is_reader() {
                self.client.configure()?;
                self.calls.set(self.calls.get() + 3);
            }
            self.qualified = true;
        }
        if !cpu_only { self.client.begin(); }
        self.page_reads.set(0);
        let begin = match mode {
            None => "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
            Some(WriteMode::Serialized) => "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE;",
            Some(WriteMode::Serializable) => "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;",
        };
        let inner = super::flight::Session { client: &mut self.client, pending: if cpu_only {String::new()} else {begin.into()}, started: false, done: cpu_only, settings_refused: false, checks: Vec::new(), owner: None, owner_budget: None };
        let tx = Tx { activation_relations: Default::default(), batch_store_id: self.fence.as_ref().map(|f| f.store_id.clone()), attempt: RefCell::new(if mode.is_some() { super::group_commit::fresh_attempt(self.fence.as_ref().map_or(0, |f| f.token))? } else { String::new() }), batch_ticket: None, predecessor_ticket: None, pipeline: false, batch_base: RefCell::new(None), generation_expected: self.generation, publication: RefCell::new(None), read_grant:self.read_grant.clone(), durable_write: mode.is_some(), revisions: Cell::new(0), lifecycle: opening, read_sessions: &self.read_sessions, read_sessions_installed: Cell::new(false), unified: self.unified, commit_warning: &self.commit_warning, inner: RefCell::new(inner),
            bind_refused: Cell::new(false), program_deadline: Cell::new(deadline), read_cache: RefCell::new(super::read_plan::Answers::default()), pending_read: RefCell::new(None), receipt_cache: RefCell::new(None), placement_cache: RefCell::new(None), authority_cache: RefCell::new(None), commit_settings: Cell::new(false), literal_cache: RefCell::new(&mut self.literal_cache), cache: RefCell::new(&mut self.cache), calls: &self.calls, marked_reads: &self.marked_reads, page_reads: &self.page_reads, prefetch_rows: &self.prefetch_rows, prefetch_bytes: &self.prefetch_bytes,
            rows_cache: RefCell::new(super::prefetch::Cache::default()), prefetch_enabled: self.prefetch, head: Cell::new(None), serialized_head: Cell::new(false), tail: RefCell::new(super::tail::Tail::default()), group_head: Cell::new(None), group_tails: RefCell::new(Vec::new()), group_images: Default::default(), changes: Default::default(), savepoints: RefCell::new(Vec::new()) };
        if opening { super::managed_relations::verify(&tx)?; super::managed_relations::capture(&tx)?; }
        if !resuming && self.unified && mode.is_some() {
            // Bootstrap is the sole exception: an absent owner relation is
            // installed in the successful opening transaction, never by readers.
            let mut exists = !opening || tx.query("SELECT to_regclass('_owner') IS NOT NULL", &[])?[0].get::<_, bool>(0);
            if !exists {
                if self.fence.as_ref().is_some_and(|fence| fence.token != 0) {
                    return Err(RuntimeError::StoreOwnership("acquired owner record disappeared; refuse to bootstrap over lost ownership".into()));
                }
                // @ref LLP 3000.009.001.000#3.4 — legacy owner installation is atomic with attach and excludes a live evaluator.
                // Guard legacy namespaces even when no logical id exists yet.
                // Fresh creation has no backend relation and takes no lock.
                tx.query("SELECT pg_advisory_xact_lock(hashtextextended('sb4-owner-bootstrap:' || current_schema(),0)) WHERE to_regclass('_backend') IS NOT NULL", &[])?;
                #[cfg(test)]
                super::ownership::test_hooks::run(super::ownership::test_hooks::Point::AfterBootstrapLock);
                if let Some(fence) = &self.fence {
                    super::ownership::install(&tx, &fence.store_id)?;
                    exists = true;
                }
            }
            if exists && !opening && mode == Some(WriteMode::Serialized) {
                // BEGIN, raising owner fence, then the first facts commands
                // travel together. No CTE pulls facts into the lock snapshot.
                tx.inner.borrow_mut().owner = Some(super::ownership::Fence::raising_command(self.fence.as_ref())?);
            } else if exists {
                // @ref LLP 3000.009.001.000#5.1 — first row lock, before head, generation or any family write.
                let rows = tx.query("SELECT store_id,token FROM _owner WHERE singleton FOR KEY SHARE", &[]).map_err(|error| {
                    if matches!(&error, RuntimeError::Postgres(e) if e.code() == Some(&postgres::error::SqlState::T_R_SERIALIZATION_FAILURE)) {
                        RuntimeError::StoreOwnership("owner changed in this transaction snapshot".into())
                    } else { error }
                })?;
                let expected = self.fence.as_ref().map_or(0, |f| f.token);
                if rows.len() != 1 || rows[0].get::<_, i64>(1) != expected
                    || self.fence.as_ref().is_some_and(|f| rows[0].get::<_, &str>(0) != f.store_id) {
                    return Err(RuntimeError::StoreOwnership("stale owner token or logical store identity".into()));
                }
            }
        }
        Ok(tx)
    }

    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — one ordinary ingress SELECT is its own read snapshot, with no writer lock.
    pub(crate) fn ingress_session_authority_facts(&mut self, digest: &str) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(Default::default()); }
        self.refresh_reader_connection()?;
        let sql = super::authority::session_facts_sql(self.read_sessions.get());
        if self.client.is_reader() && self.read_sessions.get() {
            self.calls.set(self.calls.get() + 1);
            let facts = super::authority::session_facts_rows(self.client.independent(sql, &[(&digest, postgres::types::Type::TEXT)])?);
            if facts.backend_generation.map(|g|g as u64) != Some(self.generation) { return Err(RuntimeError::Generation("another engine activated this store; reopen".into())); }
            return Ok(facts);
        }
        let statement = if let Some(statement) = self.cache.get(sql) { statement.clone() } else {
            self.calls.set(self.calls.get() + 1);
            let statement = self.client.prepare(sql)?;
            self.cache.insert(sql.into(), statement.clone()); statement
        };
        guard_text_params(&statement, &[&digest])?;
        self.calls.set(self.calls.get() + 1);
        let facts = super::authority::session_facts_rows(self.client.query(&statement, &[&digest])?.into_iter().map(Row::Bind).collect());
        // The autocommit probe is discarded on a miss with unknown storage.
        // All discovery and any read-arm retry then share a dedicated snapshot.
        if !self.read_sessions.get() && facts.sessions.is_empty() {
            let (tx, facts) = self.session_authority_transaction(digest)?;
            tx.rollback()?;
            return Ok(facts);
        }
        if facts.backend_generation.map(|generation| generation as u64) != Some(self.generation) {
            return Err(RuntimeError::Generation("another engine activated this store; reopen before reading or writing".into()));
        }
        Ok(facts)
    }

    // A dedicated authority boundary keeps its existing generation comparison,
    // using the one fact statement. Program/writer openers keep their own command.
    pub(crate) fn session_authority_transaction(&mut self, digest: &str) -> Result<(Tx<'_>, crate::identity::facts::SessionFacts), RuntimeError> {
        self.planned_authority_transaction(digest, None)
    }
    pub(crate) fn planned_authority_transaction(&mut self, digest: &str, plan: Option<super::read_plan::Plan>) -> Result<(Tx<'_>, crate::identity::facts::SessionFacts), RuntimeError> {
        let expected = self.generation;
        let tx = self.begin(None, false)?;
        let facts = match plan { Some(plan) => plan.execute(&tx,digest)?, None => tx.session_authority_facts(digest)? };
        // A dedicated authority snapshot cannot have installed uncommitted DDL.
        if tx.read_sessions_installed.get() { tx.read_sessions.set(true); }
        if facts.backend_generation.map(|generation| generation as u64) != Some(expected) {
            return Err(RuntimeError::Generation("another engine activated this store; reopen before reading or writing".into()));
        }
        Ok((tx, facts))
    }

    pub(crate) fn preflight_transaction(&mut self, digest: &str, receipt: Option<(&str,&str)>) -> Result<(Tx<'_>,crate::identity::facts::SessionFacts),RuntimeError> {
        // Match ReceiptReader before encoding: an impossible text key is absent,
        // so it cannot preempt the callback's store-binding or replay policy.
        let receipt = receipt.filter(|(principal,id)| !absent_text_key(&[principal,id]));
        let expected = self.generation;
        let tx = self.begin(None,false)?;
        let auth = super::authority::session_facts_sql(tx.read_sessions.get());
        let auth_params: &[&(dyn ToSql+Sync)] = &[&digest];
        let receipt_values = receipt.map(|(principal,id)|(principal.to_owned(),id.to_owned()));
        let receipt_params: Vec<&(dyn ToSql+Sync)> = receipt_values.as_ref().map(|(p,id)|vec![p as _,id as _]).unwrap_or_default();
        let mut commands = vec![(auth,auth_params)];
        if receipt_values.is_some() { commands.push((super::receipts::LOOKUP,&receipt_params)); }
        let mut results = tx.flight(&commands,"ROLLBACK")?;
        tx.finish_read_flight();
        let mut facts = super::authority::session_facts_rows(results.remove(0).rows);
        if tx.needs_complete_facts(&facts) { facts = tx.complete_request_facts(digest)?; }
        else if let Some(key) = receipt_values { *tx.receipt_cache.borrow_mut() = Some((key,super::receipts::record(&results.remove(0).rows))); }
        if facts.backend_generation.map(|g|g as u64) != Some(expected) { return Err(RuntimeError::Generation("another engine activated this store; reopen before reading or writing".into())); }
        Ok((tx,facts))
    }

    // Opening validates its backend and installs every physical upgrade before
    // this transaction can commit. It cannot assume generation columns exist.
    pub(super) fn opening_transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        self.begin(Some(WriteMode::Serialized), true)
    }

    // Recovery checks the physical bootstrap before assuming any columns exist.
    // PostgreSQL enforces read-only access for this entire repeatable snapshot.
    pub(super) fn bootstrap_read_transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        let tx = self.begin(None, false)?;
        super::managed_relations::verify(&tx)?;
        Ok(tx)
    }

    // Parse/SQL PREPARE can retain relation locks until transaction end. Warm
    // the folded setup outside BEGIN so those locks cannot precede the head
    // and deadlock an adoption doing physical upgrades while holding it.
    pub(super) fn prewarm_flight(&mut self, sql: &'static str) -> Result<(),RuntimeError> {
        let bind = if let Some(bind) = self.cache.get(sql) {bind.clone()} else {
            self.calls.set(self.calls.get()+1);
            let bind = self.client.prepare(sql)?;
            self.cache.insert(sql.into(),bind.clone()); bind
        };
        if !self.literal_cache.contains_key(sql) {
            self.calls.set(self.calls.get()+1);
            let prepared = super::literal::Prepared::from_bind(&mut self.client,&super::literal::serving_name(),sql,bind)?;
            self.literal_cache.insert(sql.into(),prepared);
        }
        Ok(())
    }

    // @ref LLP 3000.009.001.000.001#35-each-command-keeps-its-own-place — head, generation, authority and receipt remain distinct commands after the owner flight.
    pub(crate) fn request_transaction(&mut self, digest: &str, principal: &str, id: Option<&str>) -> Result<Tx<'_>,RuntimeError> {
        let deadline=self.next_program_deadline.take();
        if self.read_only { return Err(RuntimeError::Store("Postgres reader is read-only".into())); }
        let id = id.filter(|id| !absent_text_key(&[principal,id]));
        let auth = super::authority::session_facts_sql(self.read_sessions.get());
        for sql in ["SELECT seq FROM _head WHERE singleton FOR UPDATE", "SELECT generation FROM _backend WHERE singleton", auth] { self.prewarm_flight(sql)?; }
        if id.is_some() { self.prewarm_flight(super::receipts::LOOKUP)?; self.prewarm_flight(super::assets::PLACEMENT)?; }
        let expected = self.generation;
        self.next_program_deadline=deadline;
        let tx = self.begin(Some(WriteMode::Serialized),false)?;
        let auth = super::authority::session_facts_sql(tx.read_sessions.get());
        let auth_params: &[&(dyn ToSql+Sync)] = &[&digest];
        let id_value = id.unwrap_or_default();
        let receipt_params: &[&(dyn ToSql+Sync)] = &[&principal,&id_value];
        let mut commands: Vec<(&'static str,&[&(dyn ToSql+Sync)])> = vec![
            ("SELECT seq FROM _head WHERE singleton FOR UPDATE",&[]),
            ("SELECT generation FROM _backend WHERE singleton",&[]),
            (auth,auth_params),
        ];
        if id.is_some() { commands.push((super::receipts::LOOKUP,receipt_params)); commands.push((super::assets::PLACEMENT,receipt_params)); }
        let mut results = tx.flight(&commands,"")?;
        let head = results.remove(0).rows[0].get::<_,i64>(0) as u64;
        tx.head.set(Some(head)); tx.serialized_head.set(true);
        let generation = results.remove(0).rows[0].get::<_,i64>(0) as u64;
        if generation != expected { return Err(RuntimeError::Generation("another engine activated this store; reopen before reading or writing".into())); }
        let facts = super::authority::session_facts_rows(results.remove(0).rows);
        *tx.authority_cache.borrow_mut() = Some((digest.into(),facts));
        if let Some(id) = id {
            *tx.receipt_cache.borrow_mut() = Some(((principal.into(),id.into()),super::receipts::record(&results.remove(0).rows)));
            *tx.placement_cache.borrow_mut() = Some(((principal.into(),id.into()),super::assets::placement(&results.remove(0).rows)?));
        }
        Ok(tx)
    }

    pub fn transaction(&mut self, mode: Option<WriteMode>) -> Result<Tx<'_>, RuntimeError> {
        self.transaction_with_begin_hook(mode, || {
            #[cfg(test)]
            crate::store::test_race::after_adapter_begin();
        })
    }

    // Tests rendezvous after BEGIN and before the ordinary head fence. Both
    // transactions must exist before either may select or mutate request facts.
    pub(super) fn transaction_with_begin_hook(&mut self, mode: Option<WriteMode>, after_begin: impl FnOnce()) -> Result<Tx<'_>, RuntimeError> {
        self.checked_transaction(mode, false, after_begin)
    }

    pub(crate) fn attach_transaction(&mut self, mode: Option<WriteMode>) -> Result<Tx<'_>, RuntimeError> {
        self.checked_transaction(mode, true, || {})
    }

    fn checked_transaction(&mut self, mode: Option<WriteMode>, opening: bool, after_begin: impl FnOnce()) -> Result<Tx<'_>, RuntimeError> {
        let generation_expected = self.generation;
        let tx = self.begin(mode, opening)?;
        after_begin();
        #[cfg(test)]
        crate::store::test_race::activation_after_begin();
        if mode == Some(WriteMode::Serialized) {
            // @ref LLP 3000#7-decisions-during-execution — a watermark covers commit order, not sequence allocation
            let head = tx.query("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?[0].get::<_, i64>(0) as u64;
            tx.head.set(Some(head));
            tx.serialized_head.set(true);
        }
        #[cfg(test)]
        crate::store::test_race::activation_after_fence()?;
        // A reader pins generation and watermark in the same snapshot and
        // reuses this head for next_seq. A serialized writer checks generation
        // after its head lock, so an adoption it waited for cannot be missed.
        let generation = if mode.is_none() {
            let row=tx.query("SELECT generation, (SELECT seq FROM _head WHERE singleton) FROM _backend WHERE singleton",&[])?.remove(0);
            tx.head.set(Some(row.get::<_,i64>(1) as u64));row.get::<_,i64>(0) as u64
        } else { tx.query("SELECT generation FROM _backend WHERE singleton",&[])?[0].get::<_,i64>(0) as u64 };
        if generation != generation_expected {
            return Err(RuntimeError::Generation("another engine activated this store; reopen before reading or writing".into()));
        }
        Ok(tx)
    }
}

impl Tx<'_> {
    pub(crate) fn bound_program_attempt(&self, deadline: std::time::Instant) -> Result<(), RuntimeError> {
        // Each serial member replaces its predecessor's statement budget. The
        // driver separately bounds the shared tail by the earliest survivor.
        self.program_deadline.set(Some(deadline));
        self.refresh_program_budget()
    }
    fn refresh_program_budget(&self) -> Result<(),RuntimeError> {
        if let Some(deadline)=self.program_deadline.get() {
            let remaining=deadline.checked_duration_since(std::time::Instant::now()).filter(|r|!r.is_zero())
                .ok_or_else(||RuntimeError::Store("program invocation's remaining deadline elapsed".into()))?;
            let ms=remaining.as_millis().clamp(1,i32::MAX as u128);
            self.ensure_active()?;
            let mut inner = self.inner.borrow_mut();
            if inner.owner.is_some() {
                // The raising fence is the first lock in the message, but
                // must still obey the original remaining invocation budget.
                inner.owner_budget = Some(ms as u32);
            } else {
                drop(inner);
                self.defer_control(&format!("SET LOCAL statement_timeout={ms}; SET LOCAL lock_timeout={ms}"))?;
            }
            // @ref LLP 3000.009.001.000.002#3.1 — COMMIT remains uncancellable after every retry budget.
            // A solo member release may already have disabled timeouts. This
            // later budget supersedes that preparation even with an empty tail.
            self.commit_settings.set(false);
        }
        Ok(())
    }
}

pub struct Tx<'a> {
    pub(super) activation_relations: RefCell<BTreeMap<(u32, String), u32>>,
    pub(super) batch_store_id: Option<String>,
    pub(super) attempt: RefCell<String>,
    pub(super) batch_ticket: Option<i64>,
    pub(super) predecessor_ticket: Option<i64>,
    pipeline: bool,
    pub(super) batch_base: RefCell<Option<super::group_commit::Head>>,
    pub(super) generation_expected: u64,
    pub(super) publication: RefCell<Option<super::read_grant::Published>>,
    read_grant: Option<std::sync::Arc<super::read_grant::Grant>>,
    durable_write: bool,
    pub(super) revisions: Cell<u64>,
    // @ref LLP 3000.009.001.000.002#6 — restored images can precede their index/cap population rebuild.
    pub(super) lifecycle: bool,
    program_deadline: Cell<Option<std::time::Instant>>,
    pub(super) read_sessions: &'a Cell<bool>,
    pub(super) read_sessions_installed: Cell<bool>,
    unified: bool,
    commit_warning: &'a std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub(super) inner: RefCell<super::flight::Session<'a>>,
    literal_cache: RefCell<&'a mut BTreeMap<String, super::literal::Prepared>>,
    bind_refused: Cell<bool>,
    pub(super) pending_read: RefCell<Option<super::read_plan::Plan>>,
    pub(super) read_cache: RefCell<super::read_plan::Answers>,
    pub(super) authority_cache: RefCell<Option<(String,crate::identity::facts::SessionFacts)>>,
    pub(super) commit_settings: Cell<bool>,
    pub(super) placement_cache: RefCell<Option<((String,String),Option<crate::assets::IntentRecord>)>>,
    pub(super) receipt_cache: RefCell<Option<((String,String),Option<crate::receipts::ReceiptRecord>)>>,
    pub(super) cache: RefCell<&'a mut BTreeMap<String, Statement>>,
    pub(super) calls: &'a CallCounter,
    pub(super) marked_reads: &'a Cell<u64>,
    pub(super) page_reads: &'a Cell<u64>,
    pub(super) prefetch_rows: &'a Cell<u64>,
    pub(super) prefetch_bytes: &'a Cell<u64>,
    pub(super) rows_cache: RefCell<super::prefetch::Cache>,
    pub(super) prefetch_enabled: bool,
    pub(super) head: Cell<Option<u64>>,
    // A read snapshot also captures a head, without owning the writer fence.
    pub(super) serialized_head: Cell<bool>,
    pub(super) tail: RefCell<super::tail::Tail>,
    pub(super) group_head: Cell<Option<u64>>,
    pub(crate) group_images: RefCell<Vec<crate::engine::committer::overlay::Image>>,
    pub(super) group_tails: RefCell<Vec<super::tail::Tail>>,
    pub(super) savepoints: RefCell<Vec<(String, super::semantic::Checkpoint)>>,
    pub(super) changes: RefCell<crate::revocation::Recorder>,
}

pub(super) fn signed(n: u64) -> Result<i64, RuntimeError> {
    i64::try_from(n).map_err(|_| RuntimeError::Store("Postgres evaluation integer exceeds BIGINT".into()))
}
pub(super) fn decode<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, RuntimeError> {
    serde_json::from_str(text).map_err(|e| RuntimeError::Store(e.to_string()))
}
pub(super) fn namespace(name: &str) -> Result<String, RuntimeError> {
    if name.is_empty() || name.starts_with("pg_") || matches!(name, "public" | "information_schema") || !name.as_bytes()[0].is_ascii_lowercase() || name.len() > 63 || !name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(RuntimeError::Input(
            "store schema must start with a lowercase ASCII letter and contain only lowercase letters, digits, underscores (at most 63 bytes); public and system schemas refuse"
                .into(),
        ));
    }
    Ok(format!("\"{name}\""))
}

/// A NUL text key cannot exist in Postgres. Optional lookups return absent
/// without querying; SQLite continues to look up its legacy keys normally.
// @ref LLP 3000.009.001.000#9.1 — one absence rule for every Postgres family.
pub(super) fn absent_text_key(keys: &[&str]) -> bool {
    keys.iter().any(|key| key.contains('\0'))
}

/// Inspect the driver's typed encoding before Bind/Execute. Array headers
/// contain zero bytes, so inspect text elements rather than their framing.
// @ref LLP 3000.009.001.000#9.1 — residual NUL parameters are input refusals, never server errors.
fn guard_text_params(statement: &Statement, params: &[&(dyn ToSql + Sync)]) -> Result<(), RuntimeError> {
    for (param, ty) in params.iter().zip(statement.params()) {
        let text = <String as FromSql>::accepts(ty);
        let text_array = matches!(ty.kind(), Kind::Array(element) if <String as FromSql>::accepts(element));
        let text_format = matches!(param.encode_format(ty), Format::Text);
        if !text && !text_array && !text_format { continue; }
        let mut encoded = Default::default();
        let null = param.to_sql_checked(ty, &mut encoded)
            .map_err(|error| RuntimeError::Input(format!("invalid Postgres parameter: {error}")))?;
        if matches!(null, IsNull::Yes) { continue; }
        let bytes: &[u8] = encoded.as_ref();
        let contains_nul = if text || text_format {
            bytes.contains(&0)
        } else {
            Vec::<Option<&str>>::from_sql(ty, bytes)
                .map_err(|error| RuntimeError::Input(format!("invalid Postgres text array: {error}")))?
                .into_iter().flatten().any(|value| value.contains('\0'))
        };
        if contains_nul {
            return Err(RuntimeError::Input("Postgres text parameters cannot contain U+0000".into()));
        }
    }
    Ok(())
}

impl Tx<'_> {
    // @ref LLP 3000.009.001.000#9.1 — a pre-bind refusal is terminal too; catching it cannot commit earlier writes without their tail.
    pub(super) fn ensure_active(&self) -> Result<(), RuntimeError> {
        self.inner.borrow().ensure_settings()?;
        if self.program_deadline.get().is_some_and(|deadline|std::time::Instant::now()>=deadline) {
            return Err(RuntimeError::Store("program invocation's remaining deadline elapsed".into()));
        }
        if self.bind_refused.get() {
            return Err(RuntimeError::Input("transaction aborted by a refused Postgres parameter; roll back".into()));
        }
        Ok(())
    }

    fn guard_params(&self, statement: &Statement, params: &[&(dyn ToSql + Sync)]) -> Result<(), RuntimeError> {
        guard_text_params(statement, params).inspect_err(|_| self.bind_refused.set(true))
    }

    pub(super) fn needs_complete_facts(&self, facts: &crate::identity::facts::SessionFacts) -> bool {
        !crate::identity::facts::ordinary(facts) || (!self.read_sessions.get() && facts.sessions.is_empty())
    }
    // A changed credential kind or newly installed optional session table can
    // invalidate the planning hint. Discard all speculative answers. An open
    // transaction keeps its repeatable-read snapshot; a closed cut reopens once.
    pub(super) fn complete_request_facts(&self, digest: &str) -> Result<crate::identity::facts::SessionFacts,RuntimeError> {
        let mut inner = self.inner.borrow_mut();
        if inner.done {
            inner.pending = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;".into();
            inner.done = false; inner.started = false; inner.client.begin();
        }
        drop(inner);
        *self.read_cache.borrow_mut() = Default::default();
        self.session_authority_facts(digest)
    }
    // @ref LLP 3000.009.001.000.001#13-g4a-read-refinement-2026-10-23 — failed speculation transfers no facts; ordinary execution gets a fresh snapshot.
    pub(super) fn restart_request_facts(&self, digest: &str) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        let mut inner = self.inner.borrow_mut();
        inner.ensure_settings()?;
        if !inner.done {
            self.calls.set(self.calls.get() + 1);
            inner.client.batch_execute("ROLLBACK")?;
        }
        inner.client.finish();
        inner.pending.clear();
        inner.checks.clear();
        inner.done = true;
        inner.started = false;
        drop(inner);
        self.bind_refused.set(false);
        self.head.set(None);
        self.authority_cache.borrow_mut().take();
        self.pending_read.borrow_mut().take();
        *self.rows_cache.borrow_mut() = Default::default();
        #[cfg(test)]
        super::read_closure::after_failed_statement();
        self.complete_request_facts(digest)
    }
    pub(crate) fn finish_planned_reads(&self) -> Result<(),RuntimeError> {
        let plan = self.pending_read.borrow_mut().take();
        if let Some(plan) = plan { plan.finish(self)?; }
        Ok(())
    }
    pub(super) fn finish_read_flight(&self) { let mut inner = self.inner.borrow_mut(); inner.done = true; inner.client.finish(); }

    fn prepared(&self, sql: &str) -> Result<Statement, RuntimeError> {
        self.ensure_active()?;
        if let Some(statement) = self.cache.borrow().get(sql) {
            return Ok(statement.clone());
        }
        self.calls.set(self.calls.get() + 1);
        let statement = self.inner.borrow_mut().client.prepare(sql)?;
        self.cache.borrow_mut().insert(sql.into(), statement.clone());
        Ok(statement)
    }

    pub(crate) fn query(&self, sql: &'static str, params: &[&(dyn ToSql + Sync)]) -> Result<Vec<Row>, RuntimeError> {
        if self.inner.borrow().done { return Err(RuntimeError::Store("read outside completed physical plan".into())); }
        let statement = self.prepared(sql)?;
        if statement.params().iter().all(|t| super::literal::name(t).is_ok())
            && statement.columns().iter().all(|c| super::flight::text_type(c.type_())) {
            return Ok(self.flight(&[(sql, params)], "")?.remove(0).rows);
        }
        self.guard_params(&statement, params)?;
        self.refresh_program_budget()?;
        let mut inner = self.inner.borrow_mut();
        inner.before_bind(self.calls)?;
        self.calls.set(self.calls.get() + 1);
        Ok(inner.client.query(&statement, params)?.into_iter().map(Row::Bind).collect())
    }

    /// Only adapter constants are SQL; every value uses RT5's single encoder.
    pub(super) fn flight(&self, commands: &[(&str, &[&(dyn ToSql + Sync)])], end: &str) -> Result<Vec<super::flight::ResultSet>, RuntimeError> {
        self.ensure_active()?;
        self.refresh_program_budget()?;
        let mut sql = String::new();
        let mut statements = Vec::new();
        for (source, params) in commands {
            let bind = self.prepared(source)?;
            let mut cache = self.literal_cache.borrow_mut();
            if !cache.contains_key(*source) {
                let name = super::literal::serving_name();
                self.calls.set(self.calls.get() + 1);
                let prepared = super::literal::Prepared::from_bind(self.inner.borrow_mut().client, &name, source, bind.clone())?;
                cache.insert((*source).into(), prepared);
            }
            let command = cache[*source].command(params).inspect_err(|_| self.bind_refused.set(true))?;
            if sql.len().saturating_add(command.len()).saturating_add(self.inner.borrow().pending.len()) > super::flight::ENCODED_LIMIT {
                self.bind_refused.set(true);
                return Err(RuntimeError::Store("Postgres flight scratch guard".into()));
            }
            sql.push_str(&command); sql.push(';');
            statements.push(bind);
        }
        sql.push_str(end);
        let mut inner = self.inner.borrow_mut();
        let controls = inner.pending.bytes().filter(|b| *b == b';').count();
        self.calls.set(self.calls.get() + 1);
        let messages = inner.simple_query(&sql)?;
        super::flight::results(&statements, controls, messages)
    }

    pub(super) fn defer_control(&self, sql: &str) -> Result<(),RuntimeError> {
        self.ensure_active()?;
        let mut inner = self.inner.borrow_mut();
        inner.pending.push_str(sql); inner.pending.push(';');
        Ok(())
    }
    pub(super) fn defer_one(&self, sql: &'static str, params: &[&(dyn ToSql+Sync)]) -> Result<(),RuntimeError> {
        self.publication.borrow_mut().take();
        self.ensure_active()?;
        let bind = self.prepared(sql)?;
        let mut cache = self.literal_cache.borrow_mut();
        if !cache.contains_key(sql) {
            let name = super::literal::serving_name();
            self.calls.set(self.calls.get()+1);
            let p = super::literal::Prepared::from_bind(self.inner.borrow_mut().client,&name,sql,bind)?;
            cache.insert(sql.into(),p);
        }
        let command = cache[sql].command(params).inspect_err(|_| self.bind_refused.set(true))?;
        let mut inner = self.inner.borrow_mut();
        let n = inner.pending.bytes().filter(|b| *b == b';').count();
        if inner.pending.len().saturating_add(command.len()) > super::flight::ENCODED_LIMIT { self.bind_refused.set(true); return Err(RuntimeError::Input("Postgres flight scratch guard".into())); }
        inner.checks.push((n,1));
        inner.pending.push_str(&command); inner.pending.push(';');
        Ok(())
    }

    // @ref LLP 3000.009.001.000.001#36-how-a-flight-is-sent-is-decided-by-measurement — same terminal refusal as Bind; RT5 qualification exercises the serving codec.
    #[cfg(any(test, feature = "test-support"))]
    #[allow(dead_code)]
    pub(super) fn literal_query(&self, prepared: &super::literal::Prepared, params: &[&(dyn ToSql + Sync)]) -> Result<Vec<Vec<super::literal::Datum>>, RuntimeError> {
        self.ensure_active()?;
        let command = prepared.command(params).inspect_err(|_| self.bind_refused.set(true))?;
        self.calls.set(self.calls.get() + 1);
        let messages = self.inner.borrow_mut().simple_query(&command)?;
        // A successful statement followed by a client decode failure leaves
        // the transaction usable, exactly like a failing Row::get after Bind.
        prepared.rows(&messages)
    }

    /// Fold a driver row stream without retaining an unbounded result vector.
    pub(super) fn query_fold<T>(&self, sql: &'static str, params: &[&(dyn ToSql + Sync)], total: T, fold: impl FnMut(T, Row) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {

        let statement = self.prepared(sql)?;
        self.guard_params(&statement,params)?;
        self.refresh_program_budget()?;
        self.calls.set(self.calls.get() + 1);
        let mut inner = self.inner.borrow_mut();
        inner.before_bind(self.calls)?;
        inner.client.fold(&statement, params, total, fold)
    }

    pub(crate) fn execute(&self, sql: &'static str, params: &[&(dyn ToSql + Sync)]) -> Result<u64, RuntimeError> {
        self.publication.borrow_mut().take();
        let statement = self.prepared(sql)?;
        if statement.params().iter().all(|t| super::literal::name(t).is_ok())
            && statement.columns().iter().all(|c| super::flight::text_type(c.type_())) {
            return Ok(self.flight(&[(sql, params)], "")?.remove(0).count);
        }
        self.guard_params(&statement, params)?;
        self.refresh_program_budget()?;
        let mut inner = self.inner.borrow_mut();
        inner.before_bind(self.calls)?;
        self.calls.set(self.calls.get() + 1);
        Ok(inner.client.execute(&statement, params)?)
    }

    // Unconditional inserts/upserts must not acknowledge a suppressed write.
    pub(super) fn execute_one(&self, sql: &'static str, params: &[&(dyn ToSql + Sync)]) -> Result<(), RuntimeError> {
        let rows = self.execute(sql, params)?;
        if rows != 1 {
            return Err(RuntimeError::Store(format!("expected one affected row, got {rows}")));
        }
        Ok(())
    }

    pub(crate) fn batch(&self, sql: &str) -> Result<(), RuntimeError> {
        self.publication.borrow_mut().take();
        self.ensure_active()?;
        self.refresh_program_budget()?;
        if sql.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|token| token.eq_ignore_ascii_case("ROLLBACK")) {
            return Err(RuntimeError::Store("use the explicit transaction/savepoint rollback method".into()));
        }
        self.calls.set(self.calls.get() + 1);
        self.inner.borrow_mut().simple_query(sql)?;
        Ok(())
    }

    pub(super) fn rollback_named(&self, name: &str) -> Result<(), RuntimeError> {
        self.publication.borrow_mut().take();
        self.ensure_active()?;
        self.rows_cache.borrow_mut().clear();
        self.calls.set(self.calls.get() + 1);
        self.inner.borrow_mut().simple_query(&format!("ROLLBACK TO SAVEPOINT {name}; RELEASE SAVEPOINT {name}"))?;
        if self.read_sessions_installed.get() {
            self.read_sessions_installed.set(super::identity::read_sessions_present(self)?);
        }
        Ok(())
    }

    pub fn rollback_program(&self) -> Result<(), RuntimeError> {
        if self.savepoints.borrow().iter().any(|(name, _)| name == "program") { self.rollback_to("program") }
        else { self.rollback_named("program") }
    }

    pub(super) fn rollback_prefetch(&self) -> Result<(), RuntimeError> {
        self.ensure_active()?;
        self.calls.set(self.calls.get() + 1);
        self.inner.borrow_mut().simple_query("ROLLBACK TO SAVEPOINT prefetch; RELEASE SAVEPOINT prefetch")?;
        Ok(())
    }

    pub(crate) fn commit_program(self) -> Result<(), crate::engine::committer::outcome::Failure> {
        self.commit().map_err(|error| {
            let aborted=matches!(&error,RuntimeError::Postgres(source) if source.code().is_some_and(|code|matches!(code.code(),"40001"|"40P01")||code.code().starts_with("23")));
            crate::engine::committer::outcome::Failure {error,aborted,member:None}
        })
    }

    pub(super) fn publication_enabled(&self) -> bool {
        self.read_grant.as_ref().is_some_and(|g| g.configured.load(std::sync::atomic::Ordering::Acquire))
    }

    pub fn commit(self) -> Result<(), RuntimeError> {
        // The driver already validated its tail within the remaining budget.
        // Once it selects COMMIT, no deadline may cancel that outcome.
        self.program_deadline.set(None);
        self.ensure_active()?;
        if self.inner.borrow().done { return Ok(()); }
        // @ref LLP 3000.009.001.000.002#4.1 — solo administrative and legacy family writers join the same revision domain.
        if self.unified && self.durable_write {
            self.require_tail_order("commit durable revision")?;
            if self.revisions.get() == 0 && self.group_head.get().is_none() {
                self.defer_revision(1)?;
            }
        }
        self.flush_tail()?;
        // Installer DDL (including event-trigger effects) and late activation
        // callbacks share this transaction. Re-admit after its last writes.
        if self.lifecycle { super::managed_relations::verify_activation(&self)?; }
        let grant=self.read_grant.as_ref().filter(|g|!self.pipeline && self.durable_write && g.configured.load(std::sync::atomic::Ordering::Acquire)).cloned();
        let published = if grant.is_some() {
            let from_tail = self.publication.borrow_mut().take().filter(|_| !self.lifecycle);
            Some(match from_tail {
                Some(published) => published,
                // Receipt-only/admin transactions and activation without a
                // final program tail retain the complete post-write witness.
                None => super::read_grant::Published::row(&self.query(super::read_grant::PUBLICATION, &[])?.remove(0))?,
            })
        } else { None };
        let mut inner = self.inner.into_inner();
        if !self.commit_settings.get() {
            inner.pending.push_str("SET LOCAL statement_timeout = 0; SET LOCAL lock_timeout = 0;");
        }
        inner.flush(self.calls)?;
        self.calls.set(self.calls.get()+1);
        // The last data flight verified the codec settings. Only client-side
        // validation intervenes; COMMIT stays alone and decodes no row payload.
        // Once COMMIT is sent, even transport loss must retain unknown-outcome classification.
        if let (Some(grant),Some(published))=(grant,published) {
            grant.commit(published,|| {inner.done=true;inner.client.commit_prepared(self.commit_warning)})?;
        } else {inner.done=true;inner.client.commit_prepared(self.commit_warning)?;}
        if self.read_sessions_installed.get() { self.read_sessions.set(true); }
        Ok(())
    }

    pub fn rollback(self) -> Result<(), RuntimeError> {
        if self.inner.borrow().done { return Ok(()); }
        self.calls.set(self.calls.get() + 1);
        let mut inner = self.inner.into_inner();
        // Pending writes/control need not execute to abort the original
        // transaction. In particular, expiry must not flush them first.
        inner.pending.clear(); inner.checks.clear();
        let aborted = inner.client.batch_execute("ROLLBACK");
        // @ref LLP 3000.009.001.000.000.002#3.6 — every durable preparation path, including depth-one barriers, closes G6 on an unacknowledged rollback.
        if aborted.is_err() && self.durable_write {
            if let Some(grant) = self.read_grant.as_ref().filter(|g|g.configured.load(std::sync::atomic::Ordering::Acquire)) {
                grant.close_uncertain();
            }
        }
        aborted?;
        inner.client.finish();
        inner.done = true;
        Ok(())
    }

    pub fn record_commit(
        &self,
        seq: u64,
        at: i64,
        program: &str,
        principal: &str,
        kind: &str,
        touched: &[String],
        writes: u64,
    ) -> Result<(), RuntimeError> {
        self.ensure_active()?;
        signed(seq)?; signed(writes)?;
        let mut tail = self.tail.borrow_mut();
        if tail.commit.is_some() { return Err(RuntimeError::Store("commit tail slot already occupied".into())); }
        // @ref LLP 3000.009.001.000#33-extraction-first-with-no-behavior-change — P1-CE uses SQLite's recorder and coverage fallback, in the existing tail flight.
        if !self.changes.borrow().covers(touched) { self.changes.borrow_mut().widen(); }
        tail.commit = Some(super::tail::Commit {
            seq, at, program: program.into(), principal: principal.into(), kind: kind.into(),
            touched: canonical_json(&touched), writes, footprint: canonical_json(&self.changes.borrow().footprint()),
        });
        Ok(())
    }

    pub fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str, name: &str, args_digest: &str, at: i64) -> Result<(), RuntimeError> {
        self.execute("INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            &[&principal, &id, &signed(seq)?, &outcome, &name, &args_digest, &at])?;
        Ok(())
    }

    // @ref LLP 3000.009.001.000#33-extraction-first-with-no-behavior-change — full admissions share policy and remain one tail flight.
    pub fn record_effects(&self, outbox: &[crate::engine::presence::Emission], seq: u64, now: i64, schema: &crate::schema::Schema) -> Result<(), RuntimeError> {
        self.ensure_active()?;
        crate::engine::effects::validate_emissions(outbox, seq)?;
        let mut prepared = Vec::with_capacity(outbox.len());
        for (id, effect, payload, presence) in outbox {
            let (work, deadline, contract) = crate::engine::effects::admission(schema, effect, payload, now)?;
            prepared.push(super::tail::Effect {
                id: id.clone(), effect: effect.clone(), payload: canonical_json(payload),
                next_at: presence.values().flatten().max().copied(), work: canonical_json(&work), deadline, contract,
                presence: presence.iter().filter_map(|(p,d)| d.map(|d| (p.clone(),d))).collect(), release: None,
            });
        }
        let mut tail = self.tail.borrow_mut();
        if !tail.commit.as_ref().is_some_and(|commit| commit.seq == seq && commit.at == now) {
            return Err(RuntimeError::Store("effects require their matching commit tail".into()));
        }
        tail.effects.extend(prepared);
        Ok(())
    }
}

impl Rows for Tx<'_> {
    fn change_footprint(&self) -> crate::revocation::Footprint { self.changes.borrow().footprint() }
    fn widen_change_evidence(&self) { self.changes.borrow_mut().widen(); }
    fn sequence_value(&self, parent: &str, id: &str) -> Result<i64, RuntimeError> {
        Ok(self.query("SELECT value FROM _sequences WHERE parent = $1 AND id = $2", &[&parent, &id])?.first().map_or(0, |r| r.get(0)))
    }
    fn set_sequence(&self, parent: &str, id: &str, value: i64) -> Result<(), RuntimeError> {
        let affected = self.execute("INSERT INTO _sequences VALUES ($1, $2, $3) ON CONFLICT(parent, id) DO UPDATE SET value = EXCLUDED.value", &[&parent, &id, &value])?;
        crate::rows::require_one(affected, "sequence upsert", parent, None)?;
        Ok(())
    }
    fn sequence_ids(&self, parent: &str) -> Result<Vec<String>, RuntimeError> {
        Ok(self.query("SELECT id FROM _sequences WHERE parent=$1 ORDER BY id", &[&parent])?
            .into_iter().map(|row| row.get::<_, &str>(0).to_owned()).collect())
    }
    fn rewrite_sequence_ids(&self, ids: &BTreeMap<String, BTreeMap<String, String>>) -> Result<u64, RuntimeError> {
        let mut rewritten = 0u64;
        for (parent, parent_ids) in ids.iter().filter(|(_, ids)| !ids.is_empty()) {
            let rows = self.query("SELECT id,value FROM _sequences WHERE parent=$1 ORDER BY id", &[parent])?;
            let mut merged = BTreeMap::<String, i64>::new();
            let mut parent_rewritten = 0u64;
            for row in rows {
                let old = row.get::<_, &str>(0);
                let value = row.get::<_, i64>(1);
                let next = parent_ids.get(old).cloned().unwrap_or_else(|| old.to_owned());
                parent_rewritten = parent_rewritten.saturating_add(u64::from(next != old));
                merged.entry(next).and_modify(|current| *current = (*current).max(value)).or_insert(value);
            }
            if parent_rewritten == 0 || merged.is_empty() { continue; }
            self.execute("DELETE FROM _sequences WHERE parent=$1", &[parent])?;
            for (id, value) in merged {
                self.execute("INSERT INTO _sequences(parent,id,value) VALUES ($1,$2,$3)", &[parent, &id, &value])?;
            }
            rewritten = rewritten.saturating_add(parent_rewritten);
        }
        Ok(rewritten)
    }

    fn effect_once(&self, effect: &str, key: &str) -> Result<bool, RuntimeError> {
        Ok(!self.query("INSERT INTO _effect_keys(effect, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING effect", &[&effect, &key])?.is_empty())
    }

    fn prefetch(&self, requests: &[crate::rows::PrefetchRequest]) { self.fill_prefetch(requests); }
    fn prefetch_enabled(&self) -> bool { self.prefetch_enabled }

    // Rebuilds deliberately clear i first. Adoption walks durable r directly,
    // with one byte-admitted unit and callback scratch in the same job meter.
    fn walk_adoption(&self,table:&str,_declared:u64,scratch:u64,work:[u64;3],visit:&mut dyn FnMut(Value)->Result<(),RuntimeError>)->Result<(),RuntimeError> {
        use crate::{meter::{Meter,Ceilings,Cut},error::MeterKind,rows::{adoption,word_heap as heap}};
        let mut after:Option<String>=None;
        loop {
            let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
            meter.heap(DRIVER_SCRATCH+after.as_deref().map_or(0,heap::text))?;
            let lengths=self.query("SELECT octet_length(id),octet_length(data) FROM r WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1",&[&table,&after])?;
            let Some(length)=lengths.first() else {return Ok(())};
            let bytes=length.get::<_,i32>(0) as u64+length.get::<_,i32>(1) as u64;drop(lengths);
            meter.heap(bytes.saturating_mul(3).saturating_add(ROW_SCRATCH).saturating_add(scratch))?;
            meter.charge(MeterKind::Examined,work[0])?;meter.step(work[1])?;meter.charge(MeterKind::IndexEntries,work[2])?;
            let fetched=self.query("SELECT id,data FROM r WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1",&[&table,&after])?;
            let Some(item)=fetched.first() else {return Err(RuntimeError::Store("adoption row changed during its admitted read".into()))};
            let data=item.get::<_,&str>(1);adoption::charge(&mut meter,adoption::decode_bytes(data))?;
            let row:Value=decode(data)?;let id:String=item.get(0);
            visit(row)?;after=Some(id);
        }
    }

    /// A NUL table or id is absent without querying.
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        if absent_text_key(&[table, id]) { return Ok(None); }
        if let Some(answer) = self.read_cache.borrow().get(table, id) { return Ok(answer); }
        if let Some(answer) = self.rows_cache.borrow().get(table, id) { return Ok(answer); }
        self.query("SELECT data FROM r WHERE t = $1 AND id = $2", &[&table, &id])?.first().map(|r| decode(r.get::<_, &str>(0))).transpose()
    }

    /// A NUL table or index name is absent without querying.
    fn lookup(&self, table: &str, name: &str, index: &Index, values: &[Value]) -> Result<Option<Value>, RuntimeError> {
        if absent_text_key(&[table, name]) { return Ok(None); }
        if values.len() != index.components.len() {
            return Err(RuntimeError::Schema(format!(
                "point read {table}.{name} supplied {} of {} key columns",
                values.len(),
                index.components.len()
            )));
        }
        if let Some(answer) = self.read_cache.borrow().lookup(table, name, values) { return Ok(answer); }
        if let Some(answer) = self.rows_cache.borrow().lookup(table, name, values) { return Ok(answer); }
        Ok(self.scan(table, name, values, &Bounds::default(), Dir::Asc, 1)?.into_iter().next().map(|(row, _)| row))
    }

    fn scan(
        &self,
        table: &str,
        name: &str,
        prefix: &[Value],
        bounds: &Bounds,
        dir: Dir,
        limit: usize,
    ) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let Some((lo, hi)) = crate::rows::scan_range(prefix, bounds, dir) else {
            return Ok(Vec::new());
        };
        if let Some(answer) = self.read_cache.borrow().scan(table, name, &lo, &hi, dir, limit) { return Ok(answer); }
        let sql = match dir {
            Dir::Asc => {
                "SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5"
            }
            Dir::Desc => {
                "SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k DESC LIMIT $5"
            }
        };
        self.query(sql, &[&table, &name, &lo, &hi, &(limit.min(i64::MAX as usize) as i64)])?
            .into_iter()
            .map(|r| Ok((decode(r.get::<_, &str>(0))?, r.get(1))))
            .collect()
    }

    /// A NUL table or index name is absent without querying.
    fn index_head(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        if absent_text_key(&[table, index]) { return Ok(None); }
        let Some((lo, hi)) = crate::rows::scan_range(prefix, bounds, dir) else { return Ok(None); };
        let sql = if dir == Dir::Asc {
            "SELECT k FROM i WHERE t = $1 AND ix = $2 AND k >= $3 AND k < $4 ORDER BY k ASC LIMIT 1"
        } else {
            "SELECT k FROM i WHERE t = $1 AND ix = $2 AND k >= $3 AND k < $4 ORDER BY k DESC LIMIT 1"
        };
        Ok(self.query(sql, &[&table, &index, &lo, &hi])?.first().and_then(|r| crate::key::decode(r.get::<_, &[u8]>(0))))
    }

    fn scan_metered(&self, table: &str, name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        use crate::rows::word_heap as heap;
        // @ref LLP 3000.007#20.24.5 — the public charge is the shared logical one; the driver's batch is guarded.
        heap::scan_open(meter, table, name, prefix, bounds, scope)?;
        let mut guard = heap::StoreGuard::open(meter, SCAN_MEMORY_GUARD);
        // Queries use repeatable-read; serialized writes hold the head lock.
        // The same bounded range cannot grow between this size preflight and
        // its fetch. Reserve network/decoder scratch before the driver owns it.
        guard.range(meter, 2, prefix, bounds)?;
        guard.reserve(meter, DRIVER_SCRATCH)?;
        let Some((lo, hi)) = crate::rows::scan_range(prefix, bounds, dir) else { return Ok(Vec::new()) };
        let answers = self.read_cache.borrow();
        if let Some(cached) = answers.scan_priced(table,name,&lo,&hi,dir,limit) {
            let mut out=Vec::new();
            let mut preflight=heap::Preflight::new();
            for (_,key,image) in &cached {
                if !preflight.entry(meter,&mut guard,image.json_bytes,key.len() as u64,ROW_SCRATCH)? {break;}
            }
            for (row,key,image) in cached.into_iter().take(preflight.entries) {
                let additional=image.charge(meter,&mut guard,out.len(),out.capacity(),key)?;
                if additional!=0 {out.reserve_exact(additional);}
                out.push((row.clone(),key.to_vec()));
            }
            preflight.check()?;
            return Ok(out);
        }
        drop(answers);
        let sizes = match dir {
            Dir::Asc => "SELECT octet_length(r.data)::bigint, octet_length(i.k)::bigint FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5",
            Dir::Desc => "SELECT octet_length(r.data)::bigint, octet_length(i.k)::bigint FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k DESC LIMIT $5",
        };
        let mut preflight = heap::Preflight::new();
        for row in self.query(sizes, &[&table, &name, &lo, &hi, &(limit.min(i64::MAX as usize) as i64)])? {
            if !preflight.entry(meter, &mut guard, row.get::<_, i64>(0) as u64, row.get::<_, i64>(1) as u64, ROW_SCRATCH)? { break; }
        }
        if preflight.entries == 0 { return Ok(Vec::new()); }
        let sql = match dir {
            Dir::Asc => "SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5",
            Dir::Desc => "SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k DESC LIMIT $5",
        };
        let mut out = Vec::new();
        for row in self.query(sql, &[&table, &name, &lo, &hi, &(preflight.entries as i64)])? {
            let (data, key) = (row.get::<_, &str>(0), row.get::<_, &[u8]>(1));
            let additional = heap::scan_entry(meter, &mut guard, out.len(), out.capacity(), data, key)?;
            if additional != 0 { out.reserve_exact(additional); }
            out.push((decode(data)?, key.to_vec()));
        }
        preflight.check()?;
        Ok(out)
    }

    fn cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        Ok(self.query("SELECT n FROM _cap_counts WHERE t = $1 AND k = $2", &[&table, &crate::rows::caps::key(by, group)])?
            .first().map_or(0, |r| r.get::<_, i64>(0) as u64))
    }
    fn count_prefix(&self, table: &str, name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        let lo = key::encode(prefix);
        let hi = key::upper_bound(&lo);
        Ok(self.query(
            "SELECT COUNT(*) FROM (SELECT 1 FROM i WHERE t = $1 AND ix = $2 AND k >= $3 AND k < $4 LIMIT $5) AS limited",
            &[&table, &name, &lo, &hi, &(limit.min(i64::MAX as u64) as i64)],
        )?[0]
            .get::<_, i64>(0) as u64)
    }

    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        self.rows_cache.borrow_mut().invalidate(table_name);
        self.changes.borrow_mut().record(table_name, table, old, Some(row));
        let id = row.field("id")?.as_str()?;
        let keys = crate::rows::index_write(table_name, table, row, old, id)?;
        let data = canonical_json(row);
        let sql = if old.is_some() { "UPDATE r SET data = $3 WHERE t = $1 AND id = $2" } else { "INSERT INTO r VALUES ($1,$2,$3)" };
        // Keep reserved-id admission in the existing insertion round trip (RT0).
        let sql = if self.unified && old.is_none() { "INSERT INTO r(t,id,data) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=$1 AND id=$2)" } else { sql };
        let affected = self.execute(sql, &[&table_name, &id, &data])?;
        // @ref LLP 3000.009.001.000.002#3.3 — solo recovery must reject unapplied images just like bulk apply.
        if affected != 1 {
            if affected == 0 && old.is_none() {
                return Err(RuntimeError::Rule { table: table_name.into(), effect: crate::schema::Effect::Insert });
            }
            return Err(RuntimeError::Store(format!("row write count mismatch for {table_name}: expected 1, got {affected}")));
        }
        let mut entries = 0;
        for crate::rows::IndexWrite { name, before, after } in keys {
            for key in before.iter().filter(|k| !after.contains(k)) {
                let affected = self.execute("DELETE FROM i WHERE t = $1 AND ix = $2 AND k = $3", &[&table_name, &name, key])?;
                if !self.lifecycle { crate::rows::require_one(affected, "index delete", table_name, Some(name))?; }
                entries += 1;
            }
            for key in after.iter().filter(|k| !before.contains(k)) {
                let affected = self.execute("INSERT INTO i VALUES ($1,$2,$3,$4)", &[&table_name, &name, key, &id])?;
                crate::rows::require_one(affected, "index insert", table_name, Some(name))?;
                entries += 1;
            }
        }
        entries += self.update_cap_counts(table_name, table, old, Some(row))?;
        Ok(entries)
    }

    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        self.rows_cache.borrow_mut().invalidate(table_name);
        self.changes.borrow_mut().record(table_name, table, Some(old), None);
        let id = old.field("id")?.as_str()?;
        // @ref LLP 3000.009.001.000#3.5 — deletion evidence shares the existing row-delete round trip.
        let sql = if self.unified {
            "WITH refs AS (UPDATE _dormant_refs SET invalid=1 WHERE parent_t=$1 AND parent_id=$2 AND invalid=0 AND NOT(t=$1 AND id=$2)), cells AS (DELETE FROM _dormant_values WHERE t=$1 AND id=$2), images AS (DELETE FROM _dormant_rows WHERE t=$1 AND id=$2), narrowed AS (DELETE FROM _dormant_narrow_rows WHERE t=$1 AND id=$2), own_refs AS (DELETE FROM _dormant_refs WHERE t=$1 AND id=$2) DELETE FROM r WHERE t=$1 AND id=$2"
        } else { "DELETE FROM r WHERE t = $1 AND id = $2" };
        let affected = self.execute(sql, &[&table_name, &id])?;
        crate::rows::require_one(affected, "row delete", table_name, None)?;
        let mut entries = 0;
        for (name, index) in &table.indexes {
            for key in stored_index_keys(table, index, old, id) {
                let affected = self.execute("DELETE FROM i WHERE t = $1 AND ix = $2 AND k = $3", &[&table_name, name, &key])?;
                if !self.lifecycle { crate::rows::require_one(affected, "index delete", table_name, Some(name))?; }
                entries += 1;
            }
        }
        entries += self.update_cap_counts(table_name, table, Some(old), None)?;
        Ok(entries)
    }
}

impl Tx<'_> {
    // @ref LLP 3000.009.001.000.000.002#3.7 — the handoff owns only provisional tail state; the store keeps the socket and code caches.
    pub(crate) fn suspend_program(self, predecessor: Option<i64>, deadline: std::time::Instant) -> Result<super::writer_slot::Suspended, RuntimeError> {
        let head = self.batch_base.borrow().clone().ok_or_else(||RuntimeError::Store("missing pipeline base".into()))?;
        let ticket = self.batch_ticket.ok_or_else(||RuntimeError::Store("missing pipeline ticket".into()))?;
        let mut inner = self.inner.into_inner();
        inner.done = true; // custody transfers; dropping this borrowed view must not roll back
        Ok(super::writer_slot::Suspended {
            head, ticket, predecessor, attempt:self.attempt.into_inner(),
            tails:self.group_tails.into_inner(), images:self.group_images.into_inner(),
            pending:std::mem::take(&mut inner.pending), checks:std::mem::take(&mut inner.checks), deadline,
            #[cfg(test)] hook:None,#[cfg(test)] ordinal:0,
        })
    }
}
impl Store {
    pub(crate) fn resume_program(&mut self, frozen: super::writer_slot::Suspended) -> Result<Tx<'_>, RuntimeError> {
        // No BEGIN, fence or facts are repeated: this is the same open server transaction.
        let mut tx = self.begin_resuming(Some(WriteMode::Serialized), false, false, true)?;
        tx.pipeline = true;
        tx.batch_ticket = Some(frozen.ticket);
        tx.predecessor_ticket = frozen.predecessor;
        tx.head.set(Some(frozen.head.seq as u64));
        tx.group_head.set(Some(frozen.head.seq as u64));
        *tx.batch_base.borrow_mut() = Some(frozen.head);
        *tx.attempt.borrow_mut() = frozen.attempt;
        *tx.group_tails.borrow_mut() = frozen.tails;
        *tx.group_images.borrow_mut() = frozen.images;
        tx.program_deadline.set(Some(frozen.deadline));
        let inner = tx.inner.get_mut();
        inner.pending = frozen.pending;
        inner.checks = frozen.checks;
        inner.owner = None;
        inner.started = true;
        Ok(tx)
    }
}

impl Store {
    pub(super) fn recovery_transaction(&mut self) -> Result<Tx<'_>,RuntimeError> {
        let owner=super::ownership::Fence::raising_command(self.fence.as_ref())?;
        let mut tx=self.begin_resuming(Some(WriteMode::Serialized),false,false,true)?;
        tx.inner.get_mut().owner=Some(owner);
        Ok(tx)
    }
}
