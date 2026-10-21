//! AnyStore-only member surface. No method returns a AnyTx or accepts a raw-AnyTx callback.
use super::MemberTx;
use crate::{RuntimeError, Value, store_port::AnyTx, rows::{Rows, Bounds, Dir}, schema::{Index, Table, Schema}};
use crate::engine::job::{JobTransaction, Head, JobChunkUpdate};
#[cfg(feature = "native")]
use crate::engine::job::JobState;
use crate::assets::AssetTransaction;
use std::collections::BTreeMap;

impl Rows for MemberTx<'_, '_> {
    fn walk_adoption(&self, table:&str, _decode:u64, scratch:u64, work:[u64;3], visit:&mut dyn FnMut(Value)->Result<(),RuntimeError>) -> Result<(),RuntimeError> {
        <AnyTx<'_> as Rows>::walk_adoption(self.tx, table, _decode, scratch, work, visit)
    }
    fn change_footprint(&self) -> crate::revocation::Footprint {
        <AnyTx<'_> as Rows>::change_footprint(self.tx)
    }
    fn widen_change_evidence(&self) {
        <AnyTx<'_> as Rows>::widen_change_evidence(self.tx)
    }
    fn sequence_value(&self, parent: &str, id: &str) -> Result<i64, RuntimeError> {
        <AnyTx<'_> as Rows>::sequence_value(self.tx, parent, id)
    }
    fn set_sequence(&self, parent: &str, id: &str, value: i64) -> Result<(), RuntimeError> {
        <AnyTx<'_> as Rows>::set_sequence(self.tx, parent, id, value)
    }
    fn sequence_ids(&self, parent: &str) -> Result<Vec<String>, RuntimeError> {
        <AnyTx<'_> as Rows>::sequence_ids(self.tx, parent)
    }
    fn rewrite_sequence_ids(&self, ids: &BTreeMap<String, BTreeMap<String, String>>) -> Result<u64, RuntimeError> {
        <AnyTx<'_> as Rows>::rewrite_sequence_ids(self.tx, ids)
    }
    fn effect_once(&self, effect: &str, key: &str) -> Result<bool, RuntimeError> {
        <AnyTx<'_> as Rows>::effect_once(self.tx, effect, key)
    }
    fn has_restored_live_authority(&self,table:&str)->Result<bool,RuntimeError> {
        <AnyTx<'_> as Rows>::has_restored_live_authority(self.tx, table)
    }
    fn restored_live_authority(&self,table:&str,id:&str)->Result<bool,RuntimeError> {
        <AnyTx<'_> as Rows>::restored_live_authority(self.tx, table, id)
    }
    fn restored_authority_mode(&self,table:&str,id:&str)->Result<Option<u8>,RuntimeError> {
        <AnyTx<'_> as Rows>::restored_authority_mode(self.tx, table, id)
    }
    fn restored_narrowed(&self,table:&str,id:&str)->Result<bool,RuntimeError> {
        <AnyTx<'_> as Rows>::restored_narrowed(self.tx, table, id)
    }
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        <AnyTx<'_> as Rows>::get(self.tx, table, id)
    }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        <AnyTx<'_> as Rows>::lookup(self.tx, table, index_name, index, key)
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        <AnyTx<'_> as Rows>::scan(self.tx, table, index_name, prefix, bounds, dir, limit)
    }
    fn index_head(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        <AnyTx<'_> as Rows>::index_head(self.tx, table, index, prefix, bounds, dir)
    }
    #[cfg(feature = "server-search")]
    fn scan_selected(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, fields: &[String]) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        <AnyTx<'_> as Rows>::scan_selected(self.tx, table, index, prefix, bounds, dir, fields)
    }
    fn scan_metered(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        <AnyTx<'_> as Rows>::scan_metered(self.tx, table, index_name, prefix, bounds, dir, limit, scope, meter)
    }
    fn cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        <AnyTx<'_> as Rows>::cap_count(self.tx, table, by, group)
    }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        <AnyTx<'_> as Rows>::count_prefix(self.tx, table, index_name, prefix, limit)
    }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        <AnyTx<'_> as Rows>::put(self.tx, table_name, table, row, old)
    }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        <AnyTx<'_> as Rows>::delete(self.tx, table_name, table, old)
    }
    fn track_time_audience(
        &self,
        table_name: &str,
        table: &Table,
        id: &str,
        row: Option<&Value>,
        now: i64,
        published: bool,
    ) -> Result<(), RuntimeError> {
        <AnyTx<'_> as Rows>::track_time_audience(self.tx, table_name, table, id, row, now, published)
    }
    fn time_audience_pending(&self, table_name: &str, id: &str) -> Result<bool, RuntimeError> {
        <AnyTx<'_> as Rows>::time_audience_pending(self.tx, table_name, id)
    }
    fn time_audience_published(&self, table_name: &str, id: &str) -> Result<bool, RuntimeError> {
        <AnyTx<'_> as Rows>::time_audience_published(self.tx, table_name, id)
    }
    fn holds_assets(&self) -> bool {
        <AnyTx<'_> as Rows>::holds_assets(self.tx)
    }
    fn asset(&self, id: &str) -> Result<Option<crate::assets::Asset>, RuntimeError> {
        <AnyTx<'_> as Rows>::asset(self.tx, id)
    }
    fn claim_asset(&self, id: &str, by: &str, table: &str, row_id: &str, column: &str) -> Result<crate::assets::Asset, RuntimeError> {
        <AnyTx<'_> as Rows>::claim_asset(self.tx, id, by, table, row_id, column)
    }
    fn release_asset(&self, id: &str, table: &str, row_id: &str, column: &str, now: i64) -> Result<(), RuntimeError> {
        <AnyTx<'_> as Rows>::release_asset(self.tx, id, table, row_id, column, now)
    }
}

// Explicit narrow delegation, independent of the owning transaction's surface.
macro_rules! methods {
    ($( $(#[$attr:meta])* fn $name:ident(&self $(, $arg:ident: $ty:ty)*) -> $out:ty; )*) => {
        $( $(#[$attr])* pub(crate) fn $name(&self $(, $arg: $ty)*) -> $out {
            self.tx.$name($($arg),*)
        })*
    };
}
impl MemberTx<'_, '_> {
    methods! {
        fn next_seq(&self) -> Result<u64, RuntimeError>;
        fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError>;
        fn bind_applied(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value, at: i64) -> Result<(), RuntimeError>;
        fn replay_bound(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<Option<String>, RuntimeError>;
        #[cfg(test)]
        fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError>;
        #[cfg(test)]
        fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError>;
        fn pin_time_audience_clock(&self, requested: i64) -> Result<i64, RuntimeError>;
        fn selected_time_audience(&self, table: &str, id: &str, now: i64) -> Result<Option<crate::store_port::TimeOpening>, RuntimeError>;
        fn due_time_audience(&self, now: i64) -> Result<Option<crate::store_port::TimeOpening>, RuntimeError>;
        fn remove_time_audience(&self, table: &str, id: &str) -> Result<(), RuntimeError>;
        fn set_time_audience_published(&self, table: &str, id: &str, published: bool) -> Result<(), RuntimeError>;
        fn head_job(&self) -> Result<Option<Head>, RuntimeError>;
        fn park_job(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError>;
        fn finish_job_sweeps(&self, id: &str, sweeps: usize, now: i64) -> Result<(), RuntimeError>;
        fn record_job_chunk(&self, chunk: JobChunkUpdate<'_>) -> Result<(), RuntimeError>;
        fn park_job_chunk(&self, id: &str, error: &str, now: i64, size: u32, retries: u64, heap_peak: u64) -> Result<(), RuntimeError>;
        #[cfg(feature = "native")]
        fn record_native_job_chunk(&self, id: &str, state: JobState, cursor: Option<&[u8]>, rows_written: u64, now: i64) -> Result<(), RuntimeError>;
        fn set_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError>;
        fn set_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError>;
        fn store_identity(&self) -> Result<Option<String>, RuntimeError>;
        fn asset_ids(&self) -> Result<Vec<String>, RuntimeError>;
        fn reset_clock(&self) -> Result<(), RuntimeError>;
        fn reset_tables(&self) -> Result<(), RuntimeError>;
        fn reset_identity(&self) -> Result<(), RuntimeError>;
    }
    /// Source is (program, principal, kind), matching the existing record.
    pub(crate) fn record_commit(&self, seq: u64, at: i64, source: (&str, &str, &str), touched: &[String], writes: u64) -> Result<(), RuntimeError> {
        self.tx.record_commit(seq, at, source.0, source.1, source.2, touched, writes)
    }
    pub(crate) fn pin_writer_time(&self, schema: &Schema, requested: i64) -> Result<i64, RuntimeError> {
        super::super::time_audience::pin_writer_time(schema, self.tx, requested)
    }
    pub(crate) fn append(&self, seq: u64, events: &[crate::partition::Event]) -> Result<(), RuntimeError> {
        crate::partition::append(self.tx, seq, events)
    }
    pub(crate) fn record_effects(&self, outbox: &[super::super::presence::Emission], seq: u64, now: i64, dev: bool, schema: &Schema) -> Result<(), RuntimeError> {
        super::super::effects::record(self.tx, outbox, seq, now, dev, schema)
    }
    pub(crate) fn require_placement(&self, owner: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<(), RuntimeError> {
        crate::assets::require_placement(self.tx, owner, id, name, args)
    }
    pub(crate) fn seed_rows(&self, schema: &Schema, rows: impl IntoIterator<Item = (String, Value)>, now: i64) -> Result<u64, RuntimeError> {
        super::super::seed_rows(schema, self.tx, rows, now)
    }
    pub(crate) fn prepare_seed_inputs(&self, schema: &Schema) -> Result<(), RuntimeError> {
        self.tx.prepare_seed_inputs(schema)?;
        Ok(())
    }
}
