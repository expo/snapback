//! Evaluation layout: the same canonical row images and ordered binary keys
//! as SQLite. This deliberately measures the existing Rows boundary, not a
//! relational schema/compiler or a production Postgres control plane.
use crate::{
    error::RuntimeError,
    key,
    rows::{Bounds, Dir, Rows, stored_index_keys},
    schema::{Index, Table},
    value::{Value, canonical_json},
};
use postgres::{Client, IsolationLevel, Row, Statement, Transaction, types::ToSql};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
};

// Shared with the adapter-contract unit test: exercise the actual preflight factor.
pub(super) fn payload_heap(bytes: u64, limit: usize, scope: &crate::engine::Authorization) -> crate::value::InternalPrice {
    crate::value::InternalPrice::from_storage(bytes.saturating_mul(256) + crate::rows::word_heap::vec_growth::<(Value, Vec<u8>)>(limit),scope)
}

// @ref LLP 3000.033#1.3 — additive on create and reopen; old full authority stays readable.
pub(super) const READ_SESSIONS_DDL: &str = "
CREATE TABLE IF NOT EXISTS _read_sessions (token_digest TEXT COLLATE \"C\" PRIMARY KEY, principal TEXT COLLATE \"C\" NOT NULL, kind TEXT NOT NULL, family TEXT COLLATE \"C\" NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, cap_expires_at BIGINT NOT NULL, principal_generation BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS _read_sessions_family ON _read_sessions(principal, family, expires_at);
";

pub(super) const VERSION: &str = "snapback4-postgres-evaluation-3";
pub(super) const DDL: &str = "
CREATE TABLE _backend (singleton BOOLEAN PRIMARY KEY CHECK(singleton), version TEXT NOT NULL, schema TEXT NOT NULL, programs TEXT NOT NULL);
CREATE TABLE _head (singleton BOOLEAN PRIMARY KEY CHECK(singleton), seq BIGINT NOT NULL CHECK(seq >= 0));
INSERT INTO _head VALUES (true, 0);
CREATE TABLE r (t TEXT COLLATE \"C\" NOT NULL, id TEXT COLLATE \"C\" NOT NULL, data TEXT NOT NULL, PRIMARY KEY(t,id));
CREATE TABLE i (t TEXT COLLATE \"C\" NOT NULL, ix TEXT COLLATE \"C\" NOT NULL, k BYTEA NOT NULL, id TEXT COLLATE \"C\" NOT NULL, PRIMARY KEY(t,ix,k));
CREATE TABLE _commits (seq BIGINT PRIMARY KEY, at BIGINT NOT NULL, program TEXT NOT NULL, principal TEXT NOT NULL, kind TEXT NOT NULL, touched TEXT NOT NULL, writes BIGINT NOT NULL);
CREATE TABLE _log (partition TEXT COLLATE \"C\" NOT NULL, seq BIGINT NOT NULL REFERENCES _commits(seq), ord BIGINT NOT NULL, t TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY(partition,seq,ord));
CREATE TABLE _ops (principal TEXT COLLATE \"C\" NOT NULL, id TEXT COLLATE \"C\" NOT NULL, seq BIGINT NOT NULL, outcome TEXT NOT NULL, name TEXT NOT NULL, args_digest TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY(principal,id));
CREATE TABLE _sequences (parent TEXT NOT NULL, id TEXT NOT NULL, value BIGINT NOT NULL, PRIMARY KEY(parent, id));
CREATE TABLE _effect_keys (effect TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(effect, key));
CREATE TABLE _outbox (id TEXT PRIMARY KEY, seq BIGINT NOT NULL REFERENCES _commits(seq), effect TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts BIGINT NOT NULL, at BIGINT NOT NULL);
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

pub(super) struct Store {
    pub generation: u64,
    pub client: Client,
    cache: BTreeMap<&'static str, Statement>,
    pub calls: Cell<u64>,
    pub prefetch: bool,
    pub marked_reads: Cell<u64>,
    pub page_reads: Cell<u64>,
    pub prefetch_rows: Cell<u64>,
    pub prefetch_bytes: Cell<u64>,
}

impl Store {
    pub fn new(client: Client) -> Self {
        Self { generation:1, client, cache: BTreeMap::new(), calls: Cell::new(0), prefetch: true, marked_reads: Cell::new(0), page_reads: Cell::new(0), prefetch_rows: Cell::new(0), prefetch_bytes: Cell::new(0) }
    }

    pub fn transaction(&mut self, mode: Option<WriteMode>) -> Result<Tx<'_>, RuntimeError> {
        self.calls.set(self.calls.get() + 1);
        self.page_reads.set(0);
        let isolation = match mode {
            None => IsolationLevel::RepeatableRead,
            Some(WriteMode::Serialized) => IsolationLevel::ReadCommitted,
            Some(WriteMode::Serializable) => IsolationLevel::Serializable,
        };
        let inner = self.client.build_transaction().isolation_level(isolation).read_only(mode.is_none()).start()?;
        let tx = Tx { inner: RefCell::new(inner), cache: RefCell::new(&mut self.cache), calls: &self.calls, marked_reads: &self.marked_reads, page_reads: &self.page_reads, prefetch_rows: &self.prefetch_rows, prefetch_bytes: &self.prefetch_bytes,
            rows_cache: RefCell::new(super::prefetch::Cache::default()), prefetch_enabled: self.prefetch, head: Cell::new(None), tail: RefCell::new(super::tail::Tail::default()) };
        if mode == Some(WriteMode::Serialized) {
            // @ref LLP 3000#7-decisions-during-execution — a watermark covers commit order, not sequence allocation
            let head = tx.query("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?[0].get::<_, i64>(0) as u64;
            tx.head.set(Some(head));
        }
        // A reader pins generation and watermark in the same snapshot and
        // reuses this head for next_seq. A serialized writer checks generation
        // after its head lock, so an adoption it waited for cannot be missed.
        let generation = if mode.is_none() {
            let row=tx.query("SELECT generation, (SELECT seq FROM _head WHERE singleton) FROM _backend WHERE singleton",&[])?.remove(0);
            tx.head.set(Some(row.get::<_,i64>(1) as u64));row.get::<_,i64>(0) as u64
        } else { tx.query("SELECT generation FROM _backend WHERE singleton",&[])?[0].get::<_,i64>(0) as u64 };
        if generation != self.generation {
            return Err(RuntimeError::Generation("another engine activated this store; reopen before reading or writing".into()));
        }
        Ok(tx)
    }
}

pub(super) struct Tx<'a> {
    inner: RefCell<Transaction<'a>>,
    cache: RefCell<&'a mut BTreeMap<&'static str, Statement>>,
    pub(super) calls: &'a Cell<u64>,
    pub(super) marked_reads: &'a Cell<u64>,
    pub(super) page_reads: &'a Cell<u64>,
    pub(super) prefetch_rows: &'a Cell<u64>,
    pub(super) prefetch_bytes: &'a Cell<u64>,
    pub(super) rows_cache: RefCell<super::prefetch::Cache>,
    pub(super) prefetch_enabled: bool,
    pub(super) head: Cell<Option<u64>>,
    pub(super) tail: RefCell<super::tail::Tail>,
}

pub(super) fn signed(n: u64) -> Result<i64, RuntimeError> {
    i64::try_from(n).map_err(|_| RuntimeError::Store("Postgres evaluation integer exceeds BIGINT".into()))
}
pub(super) fn decode<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, RuntimeError> {
    serde_json::from_str(text).map_err(|e| RuntimeError::Store(e.to_string()))
}
pub(super) fn namespace(name: &str) -> Result<String, RuntimeError> {
    if !name.starts_with("sb4_eval_") || name.len() > 63 || !name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(RuntimeError::Input(
            "evaluation schema must start with sb4_eval_ and contain only lowercase ASCII letters, digits, underscores (at most 63 bytes)"
                .into(),
        ));
    }
    Ok(format!("\"{name}\""))
}

impl Tx<'_> {
    fn prepared(&self, sql: &'static str) -> Result<Statement, RuntimeError> {
        if let Some(statement) = self.cache.borrow().get(sql) {
            return Ok(statement.clone());
        }
        self.calls.set(self.calls.get() + 1);
        let statement = self.inner.borrow_mut().prepare(sql)?;
        self.cache.borrow_mut().insert(sql, statement.clone());
        Ok(statement)
    }

    pub fn query(&self, sql: &'static str, params: &[&(dyn ToSql + Sync)]) -> Result<Vec<Row>, RuntimeError> {
        let statement = self.prepared(sql)?;
        self.calls.set(self.calls.get() + 1);
        Ok(self.inner.borrow_mut().query(&statement, params)?)
    }

    pub fn execute(&self, sql: &'static str, params: &[&(dyn ToSql + Sync)]) -> Result<u64, RuntimeError> {
        self.flush_tail()?;
        let statement = self.prepared(sql)?;
        self.calls.set(self.calls.get() + 1);
        Ok(self.inner.borrow_mut().execute(&statement, params)?)
    }

    pub fn batch(&self, sql: &'static str) -> Result<(), RuntimeError> {
        if sql.to_ascii_uppercase().contains("ROLLBACK") {
            return Err(RuntimeError::Store("use the explicit transaction/savepoint rollback method".into()));
        }
        self.calls.set(self.calls.get() + 1);
        self.inner.borrow_mut().batch_execute(sql)?;
        Ok(())
    }

    pub fn rollback_program(&self) -> Result<(), RuntimeError> {
        self.rows_cache.borrow_mut().clear();
        self.calls.set(self.calls.get() + 1);
        self.inner.borrow_mut().batch_execute("ROLLBACK TO SAVEPOINT program; RELEASE SAVEPOINT program")?;
        Ok(())
    }

    pub(super) fn rollback_prefetch(&self) -> Result<(), RuntimeError> {
        self.calls.set(self.calls.get() + 1);
        self.inner.borrow_mut().batch_execute("ROLLBACK TO SAVEPOINT prefetch; RELEASE SAVEPOINT prefetch")?;
        Ok(())
    }

    pub fn commit(self) -> Result<(), RuntimeError> {
        self.flush_tail()?;
        self.calls.set(self.calls.get() + 1);
        self.inner.into_inner().commit()?;
        Ok(())
    }

    pub fn rollback(self) -> Result<(), RuntimeError> {
        self.calls.set(self.calls.get() + 1);
        self.inner.into_inner().rollback()?;
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
        self.tail.borrow_mut().commit = Some(super::tail::Commit {
            seq, at, program: program.into(), principal: principal.into(), kind: kind.into(),
            touched: canonical_json(&touched), writes,
        });
        Ok(())
    }

    pub fn applied(&self, principal: &str, id: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.query("SELECT outcome FROM _ops WHERE principal = $1 AND id = $2", &[&principal, &id])?.first().map(|r| r.get(0)))
    }

    pub fn applied_bound(&self, principal: &str, id: &str, name: &str, args_digest: &str) -> Result<Option<String>, RuntimeError> {
        let Some(row) = self.query("SELECT outcome,name,args_digest FROM _ops WHERE principal = $1 AND id = $2", &[&principal, &id])?.into_iter().next() else { return Ok(None); };
        if row.get::<_, &str>(1) != name || row.get::<_, &str>(2) != args_digest {
            return Err(crate::store::id_reused());
        }
        Ok(Some(row.get(0)))
    }

    pub fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str, name: &str, args_digest: &str, at: i64) -> Result<(), RuntimeError> {
        self.execute("INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            &[&principal, &id, &signed(seq)?, &outcome, &name, &args_digest, &at])?;
        Ok(())
    }

    // @ref LLP 3000.007#19.1 — this evaluation adapter records the emission at
    // now, not its grace deadline; it supplies neither presence deferral nor
    // the reconnect cancellation semantics of the SQLite path.
    pub fn record_effects(&self, outbox: &[crate::engine::presence::Emission], seq: u64, now: i64) -> Result<(), RuntimeError> {
        let mut tail = self.tail.borrow_mut();
        debug_assert!(tail.commit.as_ref().is_some_and(|commit| commit.seq == seq && commit.at == now), "effects require their matching commit tail");
        tail.effects.extend(outbox.iter().map(|(id, effect, payload, _presence)| (id.clone(), effect.clone(), payload.clone())));
        Ok(())
    }
}

impl Rows for Tx<'_> {
    fn sequence_value(&self, parent: &str, id: &str) -> Result<i64, RuntimeError> {
        Ok(self.query("SELECT value FROM _sequences WHERE parent = $1 AND id = $2", &[&parent, &id])?.first().map_or(0, |r| r.get(0)))
    }
    fn set_sequence(&self, parent: &str, id: &str, value: i64) -> Result<(), RuntimeError> {
        self.execute("INSERT INTO _sequences VALUES ($1, $2, $3) ON CONFLICT(parent, id) DO UPDATE SET value = EXCLUDED.value", &[&parent, &id, &value])?;
        Ok(())
    }

    fn effect_once(&self, effect: &str, key: &str) -> Result<bool, RuntimeError> {
        Ok(!self.query("INSERT INTO _effect_keys(effect, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING effect", &[&effect, &key])?.is_empty())
    }

    fn prefetch(&self, requests: &[crate::rows::PrefetchRequest]) { self.fill_prefetch(requests); }
    fn prefetch_enabled(&self) -> bool { self.prefetch_enabled }

    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        if let Some(answer) = self.rows_cache.borrow().get(table, id) { return Ok(answer); }
        self.query("SELECT data FROM r WHERE t = $1 AND id = $2", &[&table, &id])?.first().map(|r| decode(r.get::<_, &str>(0))).transpose()
    }

    fn lookup(&self, table: &str, name: &str, index: &Index, values: &[Value]) -> Result<Option<Value>, RuntimeError> {
        if values.len() != index.components.len() {
            return Err(RuntimeError::Schema(format!(
                "point read {table}.{name} supplied {} of {} key columns",
                values.len(),
                index.components.len()
            )));
        }
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

    fn index_head(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
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
        // Queries use repeatable-read; serialized writes hold the head lock.
        // The same bounded range cannot grow between this scalar size preflight
        // and its fetch. Reserve network/decoder scratch before the driver owns it.
        heap::range(prefix, bounds, scope).charge(meter,scope)?;
        heap::range(prefix, bounds, scope).charge(meter,scope)?;
        meter.heap(4096)?;
        let Some((lo, hi)) = crate::rows::scan_range(prefix, bounds, dir) else { return Ok(Vec::new()) };
        let sql = match dir {
            Dir::Asc => "SELECT COALESCE(SUM(octet_length(data) + octet_length(k)), 0)::bigint FROM (SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5) AS picked",
            Dir::Desc => "SELECT COALESCE(SUM(octet_length(data) + octet_length(k)), 0)::bigint FROM (SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k DESC LIMIT $5) AS picked",
        };
        let bytes = self.query(sql, &[&table, &name, &lo, &hi, &(limit.min(i64::MAX as usize) as i64)])?[0].get::<_, i64>(0) as u64;
        payload_heap(bytes, limit, scope).charge(meter,scope)?;
        self.scan(table, name, prefix, bounds, dir, limit)
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
        let id = row.field("id")?.as_str()?;
        let keys = crate::rows::index_write(table_name, table, row, old, id)?;
        let data = canonical_json(row);
        let sql = if old.is_some() { "UPDATE r SET data = $3 WHERE t = $1 AND id = $2" } else { "INSERT INTO r VALUES ($1,$2,$3)" };
        self.execute(sql, &[&table_name, &id, &data])?;
        let mut entries = 0;
        for crate::rows::IndexWrite { name, before, after } in keys {
            for key in before.iter().filter(|k| !after.contains(k)) {
                self.execute("DELETE FROM i WHERE t = $1 AND ix = $2 AND k = $3", &[&table_name, &name, key])?;
                entries += 1;
            }
            for key in after.iter().filter(|k| !before.contains(k)) {
                self.execute("INSERT INTO i VALUES ($1,$2,$3,$4)", &[&table_name, &name, key, &id])?;
                entries += 1;
            }
        }
        entries += self.update_cap_counts(table_name, table, old, Some(row))?;
        Ok(entries)
    }

    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        self.rows_cache.borrow_mut().invalidate(table_name);
        let id = old.field("id")?.as_str()?;
        self.execute("DELETE FROM r WHERE t = $1 AND id = $2", &[&table_name, &id])?;
        let mut entries = 0;
        for (name, index) in &table.indexes {
            for key in stored_index_keys(table, index, old, id) {
                self.execute("DELETE FROM i WHERE t = $1 AND ix = $2 AND k = $3", &[&table_name, name, &key])?;
                entries += 1;
            }
        }
        entries += self.update_cap_counts(table_name, table, Some(old), None)?;
        Ok(entries)
    }
}
