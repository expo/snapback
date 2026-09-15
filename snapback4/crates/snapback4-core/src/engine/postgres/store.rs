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

pub(super) const VERSION: &str = "snapback4-postgres-evaluation-1";
pub(super) const DDL: &str = "
CREATE TABLE _backend (singleton BOOLEAN PRIMARY KEY CHECK(singleton), version TEXT NOT NULL, schema TEXT NOT NULL, programs TEXT NOT NULL);
CREATE TABLE _head (singleton BOOLEAN PRIMARY KEY CHECK(singleton), seq BIGINT NOT NULL CHECK(seq >= 0));
INSERT INTO _head VALUES (true, 0);
CREATE TABLE r (t TEXT COLLATE \"C\" NOT NULL, id TEXT COLLATE \"C\" NOT NULL, data TEXT NOT NULL, PRIMARY KEY(t,id));
CREATE TABLE i (t TEXT COLLATE \"C\" NOT NULL, ix TEXT COLLATE \"C\" NOT NULL, k BYTEA NOT NULL, id TEXT COLLATE \"C\" NOT NULL, PRIMARY KEY(t,ix,k));
CREATE TABLE _commits (seq BIGINT PRIMARY KEY, at BIGINT NOT NULL, program TEXT NOT NULL, principal TEXT NOT NULL, kind TEXT NOT NULL, touched TEXT NOT NULL, writes BIGINT NOT NULL);
CREATE TABLE _log (partition TEXT COLLATE \"C\" NOT NULL, seq BIGINT NOT NULL REFERENCES _commits(seq), ord BIGINT NOT NULL, t TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY(partition,seq,ord));
CREATE TABLE _ops (principal TEXT COLLATE \"C\" NOT NULL, id TEXT COLLATE \"C\" NOT NULL, seq BIGINT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY(principal,id));
CREATE TABLE _outbox (id TEXT PRIMARY KEY, seq BIGINT NOT NULL REFERENCES _commits(seq), effect TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts BIGINT NOT NULL, at BIGINT NOT NULL);
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
    pub client: Client,
    cache: BTreeMap<&'static str, Statement>,
    pub calls: Cell<u64>,
}

impl Store {
    pub fn new(client: Client) -> Self {
        Self { client, cache: BTreeMap::new(), calls: Cell::new(0) }
    }

    pub fn transaction(&mut self, mode: Option<WriteMode>) -> Result<Tx<'_>, RuntimeError> {
        self.calls.set(self.calls.get() + 1);
        let isolation = match mode {
            None => IsolationLevel::RepeatableRead,
            Some(WriteMode::Serialized) => IsolationLevel::ReadCommitted,
            Some(WriteMode::Serializable) => IsolationLevel::Serializable,
        };
        let inner = self.client.build_transaction().isolation_level(isolation).read_only(mode.is_none()).start()?;
        let tx = Tx { inner: RefCell::new(inner), cache: RefCell::new(&mut self.cache), calls: &self.calls };
        if mode == Some(WriteMode::Serialized) {
            // @ref LLP 3000#7-decisions-during-execution — a watermark covers commit order, not sequence allocation
            tx.query("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?;
        }
        Ok(tx)
    }
}

pub(super) struct Tx<'a> {
    inner: RefCell<Transaction<'a>>,
    cache: RefCell<&'a mut BTreeMap<&'static str, Statement>>,
    calls: &'a Cell<u64>,
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
        let statement = self.prepared(sql)?;
        self.calls.set(self.calls.get() + 1);
        Ok(self.inner.borrow_mut().execute(&statement, params)?)
    }

    pub fn batch(&self, sql: &'static str) -> Result<(), RuntimeError> {
        self.calls.set(self.calls.get() + 1);
        self.inner.borrow_mut().batch_execute(sql)?;
        Ok(())
    }

    pub fn commit(self) -> Result<(), RuntimeError> {
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
        let seq = signed(seq)?;
        // This UPDATE orders successful transactions; nextval would allow a
        // later watermark to overtake an uncommitted earlier mutation.
        if self.execute("UPDATE _head SET seq = $1 WHERE singleton AND seq = $2", &[&seq, &(seq - 1)])? != 1 {
            return Err(RuntimeError::Store("Postgres commit head changed without a serialization failure".into()));
        }
        self.execute(
            "INSERT INTO _commits VALUES ($1,$2,$3,$4,$5,$6,$7)",
            &[&seq, &at, &program, &principal, &kind, &canonical_json(&touched), &signed(writes)?],
        )?;
        Ok(())
    }

    pub fn applied(&self, principal: &str, id: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.query("SELECT outcome FROM _ops WHERE principal = $1 AND id = $2", &[&principal, &id])?.first().map(|r| r.get(0)))
    }

    pub fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError> {
        self.execute("INSERT INTO _ops VALUES ($1,$2,$3,$4)", &[&principal, &id, &signed(seq)?, &outcome])?;
        Ok(())
    }

    pub fn record_effects(&self, outbox: &[(String, String, Value)], seq: u64, now: i64) -> Result<(), RuntimeError> {
        for (id, effect, payload) in outbox {
            self.execute(
                "INSERT INTO _outbox VALUES ($1,$2,$3,$4,'queued',0,$5)",
                &[id, &signed(seq)?, effect, &canonical_json(payload), &now],
            )?;
        }
        Ok(())
    }
}

impl Rows for Tx<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
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
        let id = row.field("id")?.as_str()?;
        let data = canonical_json(row);
        let sql = if old.is_some() { "UPDATE r SET data = $3 WHERE t = $1 AND id = $2" } else { "INSERT INTO r VALUES ($1,$2,$3)" };
        self.execute(sql, &[&table_name, &id, &data])?;
        let mut entries = 0;
        for (name, index) in &table.indexes {
            let before = old.map(|old| stored_index_keys(table, index, old, id)).unwrap_or_default();
            let after = stored_index_keys(table, index, row, id);
            for key in before.iter().filter(|k| !after.contains(k)) {
                self.execute("DELETE FROM i WHERE t = $1 AND ix = $2 AND k = $3", &[&table_name, name, key])?;
                entries += 1;
            }
            for key in after.iter().filter(|k| !before.contains(k)) {
                self.execute("INSERT INTO i VALUES ($1,$2,$3,$4)", &[&table_name, name, key, &id])?;
                entries += 1;
            }
        }
        Ok(entries)
    }

    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        let id = old.field("id")?.as_str()?;
        self.execute("DELETE FROM r WHERE t = $1 AND id = $2", &[&table_name, &id])?;
        let mut entries = 0;
        for (name, index) in &table.indexes {
            for key in stored_index_keys(table, index, old, id) {
                self.execute("DELETE FROM i WHERE t = $1 AND ix = $2 AND k = $3", &[&table_name, name, &key])?;
                entries += 1;
            }
        }
        Ok(entries)
    }
}
