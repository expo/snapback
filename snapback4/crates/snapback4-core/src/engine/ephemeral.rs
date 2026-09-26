//! One process's short-lived rows and commit epoch, shared by every reader.
// @ref LLP 3000.017#4.3 — no SQLite writer, log, replay record or durable receipt.
mod layered;
#[cfg(test)]
mod wake_tests;
use super::*;
use crate::rows::{Bounds, Dir, MemoryRows, Rows};
pub use crate::schema::ephemeral::Version;
use crate::schema::{Schema, Table};
pub use layered::Layered;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
};

pub const RING_SIZE: usize = 256;
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Change {
    pub epoch: u64,
    pub incarnation: String,
    pub tables: Vec<String>,
}
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub identity: String,
    pub generation: u64,
    pub version: Version,
    pub ring: VecDeque<(u64, Vec<String>)>,
    pub tables: Vec<String>,
}
impl Snapshot {
    pub fn changed(
        &self,
        epoch: u64,
        incarnation: Option<&str>,
        interest: Option<&BTreeSet<String>>,
    ) -> Vec<String> {
        let allowed = |name: &String| interest.is_none_or(|set| set.contains(name));
        if incarnation.is_some_and(|id| id != self.version.incarnation)
            || epoch > self.version.epoch
            || self
                .ring
                .front()
                .is_some_and(|(first, _)| epoch.saturating_add(1) < *first)
        {
            return match interest {
                Some(tables) => tables.iter().cloned().collect(),
                None => self.tables.clone(),
            };
        }
        self.ring
            .iter()
            .filter(|(at, _)| *at > epoch)
            .flat_map(|(_, tables)| tables.iter())
            .filter(|t| allowed(t))
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub principal_rows: u64,
    pub principal_bytes: u64,
    pub rows: u64,
    pub bytes: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            principal_rows: 1000,
            principal_bytes: 4 * 1024 * 1024,
            rows: 100_000,
            bytes: 512 * 1024 * 1024,
        }
    }
}
#[derive(Clone, Copy, Debug, Default)]
struct Count {
    rows: u64,
    bytes: u64,
}
impl Count {
    fn add(&mut self, bytes: u64) {
        self.rows += 1;
        self.bytes = self.bytes.saturating_add(bytes);
    }
    fn remove(&mut self, bytes: u64) {
        self.rows -= 1;
        self.bytes -= bytes;
    }
}
#[derive(Debug, Default)]
struct Accounting {
    owners: BTreeMap<(String, String), (String, u64)>,
    principals: BTreeMap<String, Count>,
    total: Count,
}
struct Plan {
    changes: Vec<((String, String), Option<(String, u64)>)>,
    principals: BTreeMap<String, Count>,
    total: Count,
}
impl Accounting {
    fn remove(&mut self, key: &(String, String)) {
        if let Some((principal, bytes)) = self.owners.remove(key) {
            self.total.remove(bytes);
            let count = self.principals.get_mut(&principal).unwrap();
            count.remove(bytes);
            if count.rows == 0 {
                self.principals.remove(&principal);
            }
        }
    }
    fn plan(
        &self,
        layer: &Layered<'_>,
        schema: &Schema,
        viewer: &str,
        limits: Limits,
    ) -> Result<Plan, RuntimeError> {
        let mut plan = Plan {
            changes: Vec::new(),
            principals: BTreeMap::new(),
            total: self.total,
        };
        for key in layer.changed() {
            if let Some((owner, bytes)) = self.owners.get(&key) {
                plan.total.remove(*bytes);
                plan.principals
                    .entry(owner.clone())
                    .or_insert(self.principals[owner])
                    .remove(*bytes);
            }
            let owner = if layer.eph.get(&key.0, &key.1)?.is_some() {
                let size = declared_size(&schema.tables[&key.0]);
                plan.total.add(size);
                plan.principals
                    .entry(viewer.into())
                    .or_insert_with(|| self.principals.get(viewer).copied().unwrap_or_default())
                    .add(size);
                Some((viewer.into(), size))
            } else {
                None
            };
            plan.changes.push((key, owner));
        }
        if plan.total.rows > limits.rows
            || plan.total.bytes > limits.bytes
            || plan
                .principals
                .values()
                .any(|c| c.rows > limits.principal_rows || c.bytes > limits.principal_bytes)
        {
            return Err(full());
        }
        Ok(plan)
    }
    fn apply(&mut self, plan: Plan) {
        for (key, owner) in plan.changes {
            match owner {
                Some(owner) => {
                    self.owners.insert(key, owner);
                }
                None => {
                    self.owners.remove(&key);
                }
            }
        }
        for (owner, count) in plan.principals {
            if count.rows == 0 {
                self.principals.remove(&owner);
            } else {
                self.principals.insert(owner, count);
            }
        }
        self.total = plan.total;
    }
}
/// Prices the declared image plus every bounded index key; no payload is consulted.
pub fn declared_size(table: &Table) -> u64 {
    let image = super::write::target::row_copy_ceiling(table);
    table.indexes.values().fold(image, |total, index| {
        let key = index
            .columns()
            .iter()
            .filter_map(|c| table.columns.get(c))
            .fold(144u64, |n, t| {
                n.saturating_add(
                    16 + super::write::target::column_copy_ceiling(t).saturating_mul(2),
                )
            });
        total.saturating_add(64 + key.min(crate::rows::MAX_INDEX_KEY_BYTES as u64))
    })
}
fn full() -> RuntimeError {
    RuntimeError::Structural {
        code: "E_EPHEMERAL_FULL",
        message: "ephemeral capacity is full; wait for expiry or delete your rows and retry".into(),
    }
}
fn incarnation() -> String {
    crate::ids::mint(crate::now_ms(), &mut crate::ids::seed())
        .expect("current time is an id instant")
}

pub struct Hub {
    pub(super) state: Mutex<HubState>,
    limits: Limits,
}
pub struct HubState {
    pub(super) rows: MemoryRows,
    identity: String,
    generation: u64,
    tables: BTreeMap<String, Table>,
    accounting: Accounting,
    version: Version,
    ring: VecDeque<(u64, Vec<String>)>,
    publisher: Option<Arc<dyn Fn(Snapshot) + Send + Sync>>,
}
impl HubState {
    fn new(identity: String, generation: u64, schema: &Schema) -> Self {
        Self {
            rows: MemoryRows::new(),
            identity,
            generation,
            tables: schema
                .tables
                .iter()
                .filter(|(_, t)| t.ephemeral.is_some())
                .map(|(n, t)| (n.clone(), t.clone()))
                .collect(),
            accounting: Accounting::default(),
            version: Version {
                epoch: 0,
                incarnation: incarnation(),
            },
            ring: VecDeque::new(),
            publisher: None,
        }
    }
    pub fn version(&self) -> Version {
        self.version.clone()
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            identity: self.identity.clone(),
            generation: self.generation,
            version: self.version.clone(),
            ring: self.ring.clone(),
            tables: self.tables.keys().cloned().collect(),
        }
    }
    fn publish(&self) {
        if let Some(publish) = &self.publisher { publish(self.snapshot()); }
    }
    fn rebind(&mut self, identity: String, generation: u64, schema: &Schema) {
        let publisher = self.publisher.take();
        *self = Self::new(identity, generation, schema);
        self.publisher = publisher;
        self.publish();
    }
    // Snapshot identity has already been established by the deferred transaction.
    pub fn bind(
        &mut self,
        identity: &str,
        generation: u64,
        schema: &Schema,
    ) -> Result<(), RuntimeError> {
        if identity != self.identity || generation < self.generation {
            return Err(RuntimeError::Generation(
                "ephemeral hub serves a newer store or generation; retry with a fresh reader"
                    .into(),
            ));
        }
        if generation > self.generation {
            self.rebind(identity.into(), generation, schema);
        }
        Ok(())
    }
    fn sweep(&mut self, now: i64) -> Result<usize, RuntimeError> {
        let mut removed = 0;
        for (name, table) in &self.tables {
            loop {
                let rows = self.rows.scan(
                    name,
                    "$expiry",
                    &[],
                    &Bounds {
                        lte: Some(Value::Int(now)),
                        ..Bounds::default()
                    },
                    Dir::Asc,
                    256,
                )?;
                if rows.is_empty() {
                    break;
                }
                for (row, _) in rows {
                    let id = row.field("id")?.as_str()?.to_owned();
                    self.rows.delete(name, table, &row)?;
                    self.accounting.remove(&(name.clone(), id));
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }
}
impl Hub {
    pub fn new(identity: String, generation: u64, schema: &Schema) -> Self {
        Self::with_limits(identity, generation, schema, Limits::default())
    }
    pub fn with_limits(identity: String, generation: u64, schema: &Schema, limits: Limits) -> Self {
        Self {
            state: Mutex::new(HubState::new(identity, generation, schema)),
            limits,
        }
    }
    pub fn lock(&self) -> Result<MutexGuard<'_, HubState>, RuntimeError> {
        self.state
            .lock()
            .map_err(|_| RuntimeError::Store("ephemeral hub lock poisoned".into()))
    }
    pub fn snapshot(&self) -> Result<Snapshot, RuntimeError> {
        Ok(self.lock()?.snapshot())
    }
    /// Install before serving. Called under the hub lock after each commit or
    /// rebind; the callback may take the wake mutex, never the hub or engine.
    // @ref LLP 3000.017#3.3 — publish before releasing the hub.
    pub fn set_publisher(&self, publisher: impl Fn(Snapshot) + Send + Sync + 'static) -> Result<(), RuntimeError> {
        let mut hub = self.lock()?;
        hub.publisher = Some(Arc::new(publisher));
        hub.publish();
        Ok(())
    }
    pub fn clear_and_rebind(
        &self,
        identity: String,
        generation: u64,
        schema: &Schema,
    ) -> Result<(), RuntimeError> {
        self.lock()?.rebind(identity, generation, schema);
        Ok(())
    }
    pub fn sweep(&self, now: i64) -> Result<usize, RuntimeError> {
        self.lock()?.sweep(now)
    }
}

pub struct Outcome {
    pub result: Value,
    pub ephemeral: Change,
    pub metered: Metered,
    pub seq: u64,
}
impl Engine {
    pub fn ephemeral_hub(&self) -> Arc<Hub> {
        self.ephemeral.clone()
    }
    /// Engine replacement calls this under its owner mutex, before it is published.
    pub fn share_ephemeral_hub(&mut self, hub: Arc<Hub>) -> Result<(), RuntimeError> {
        hub.clear_and_rebind(
            self.store.meta("store_id")?.unwrap_or_default(),
            self.generation,
            &self.schema,
        )?;
        self.ephemeral = hub;
        Ok(())
    }
    pub fn mutate_ephemeral(
        &mut self,
        name: &str,
        mut context: Context,
    ) -> Result<Outcome, RuntimeError> {
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| RuntimeError::UnknownOp(name.into()))?;
        if program.kind != ProgramKind::Mutation
            || !self
                .schema
                .operations
                .get(name)
                .is_some_and(|f| f.ephemeral)
        {
            return Err(RuntimeError::UnknownOp(format!(
                "{name} is not an ephemeral mutation"
            )));
        }
        context.generation = self.generation;
        context.new_ids.clear();
        context.minted_ids.clear();
        if context.now.is_none() {
            context.now = Some(crate::now_ms());
        }
        if context.presence.is_none() {
            context.presence = self.presence.clone();
        }
        let now = context.now.unwrap();
        let viewer = context.viewer.clone();
        validate::validate_inputs(&self.schema, program, &mut context.args)?;
        let tx = self.store.read_transaction()?;
        let identity = tx.meta("store_id")?.unwrap_or_default();
        let generation = tx
            .meta("generation")?
            .and_then(|n| n.parse().ok())
            .unwrap_or(0);
        let seq = tx.next_seq()? - 1;
        let mut hub = self.ephemeral.lock()?;
        hub.bind(&identity, generation, &self.schema)?;
        hub.sweep(now)?;
        let epoch = hub
            .version
            .epoch
            .checked_add(1)
            .ok_or_else(|| RuntimeError::Store("ephemeral epoch exhausted".into()))?;
        let HubState {
            rows, accounting, ..
        } = &mut *hub;
        let layer = Layered::new(&tx, rows, &self.schema, true);
        let mut runner = Runner::new(
            &layer,
            &self.schema,
            context,
            Meter::new(self.ceilings, Cut::Abort),
            seq,
        );
        let result = runner.run(program)?;
        runner.check_final_exists()?;
        runner.charge_output(&result)?;
        runner.retire_expired_births()?;
        let metered = runner.meter.used;
        let tables: Vec<_> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        let plan = accounting.plan(&layer, &self.schema, &viewer, self.ephemeral.limits)?;
        // End the durable read while the undo guard still exists. Dropping Tx
        // afterward is harmless: its SQLite transaction is already rolled back.
        tx.conn().execute_batch("ROLLBACK")?;
        layer.commit();
        drop(layer);
        accounting.apply(plan);
        hub.version.epoch = epoch;
        hub.ring.push_back((epoch, tables.clone()));
        if hub.ring.len() > RING_SIZE {
            hub.ring.pop_front();
        }
        let ephemeral = Change {
            epoch,
            incarnation: hub.version.incarnation.clone(),
            tables,
        };
        hub.publish();
        drop(hub);
        drop(tx);
        Ok(Outcome {
            result,
            ephemeral,
            metered,
            seq,
        })
    }
}
