//! Explicit family dispatch preserves every adapter override, including optional optimizations.
// @ref LLP 3000.009.001.000#3.4 — the enum forwards access; shared policy stays above it.
use super::handles::{SqliteStore, SqliteTx};
#[cfg(feature = "postgres")]
use super::handles::{PostgresStore, PostgresTx};
use crate::{RuntimeError, Value, store as sqlite};
use crate::{schema::{Index, Table}, assets::Asset, store::LogEvent, engine::actions::ActionRequest, metadata::RestoredPopulation, store::DormantItem};
use crate::store_port::{AnyStore, AnyTx, ReadSnapshot, AnyPreparation};
use std::collections::{BTreeMap};
#[cfg(feature = "postgres")]
use crate::engine::postgres::{store as pg, activation as pg_activation};

mod rows {
    use super::*;
    use crate::rows::*;
    impl Rows for AnyTx<'_> {
        fn change_footprint(&self) -> crate::revocation::Footprint { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::change_footprint(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::change_footprint(inner) } }
        fn widen_change_evidence(&self) { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::widen_change_evidence(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::widen_change_evidence(inner) } }
        fn provisional_sequence_floor(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::provisional_sequence_floor(inner, _parent, _id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn sequence_value(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::sequence_value(inner, _parent, _id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::sequence_value(inner, _parent, _id) } }
        fn set_sequence(&self, _parent: &str, _id: &str, _value: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::set_sequence(inner, _parent, _id, _value), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::set_sequence(inner, _parent, _id, _value) } }
        fn sequence_ids(&self, _parent: &str) -> Result<Vec<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::sequence_ids(inner, _parent), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::sequence_ids(inner, _parent) } }
        fn rewrite_sequence_ids( &self, _ids: &std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>, ) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::rewrite_sequence_ids(inner, _ids), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::rewrite_sequence_ids(inner, _ids) } }
        fn effect_once(&self, _effect: &str, _key: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::effect_once(inner, _effect, _key), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::effect_once(inner, _effect, _key) } }
        fn provisional_id_after(&self, _table: &str, _after: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::provisional_id_after(inner, _table, _after), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn has_provisional(&self, _table: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::has_provisional(inner, _table), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn provisional_groups(&self, table: &str, _fields: &[String]) -> Result<Option<Vec<Vec<Value>>>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::provisional_groups(inner, table, _fields), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn provisional_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::provisional_row(inner, _table, _row), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn recording_covered(&self, _table: &str, _row: &Value, _viewer: &str, _now: i64, _scope: &crate::engine::Authorization, _meter: &mut crate::engine::InternalMeter<'_>) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::recording_covered(inner, _table, _row, _viewer, _now, _scope, _meter), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn current_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::current_row(inner, _table, _row), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn current_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::current_group(inner, _table, _index, _prefix), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn acquired_boundary(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<Option<AcquiredBoundary>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::acquired_boundary(inner, _table, _index, _prefix), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn search_retained_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::search_retained_row(inner, _table, _row), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn retained_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::retained_row(inner, _table, _row), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn retained_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::retained_group(inner, _table, _index, _prefix), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn prefetch(&self, _requests: &[PrefetchRequest]) { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::prefetch(inner, _requests), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::prefetch(inner, _requests) } }
        fn prefetch_enabled(&self) -> bool { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::prefetch_enabled(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::prefetch_enabled(inner) } }
        #[cfg(feature="sqlite")]
        fn walk_adoption(&self, table: &str, decode: u64, scratch: u64, work: [u64;3], visit: &mut dyn FnMut(Value) -> Result<(),RuntimeError>) -> Result<(),RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::walk_adoption(inner, table, decode, scratch, work, visit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::walk_adoption(inner, table, decode, scratch, work, visit) } }
        fn has_restored_live_authority(&self,_table:&str)->Result<bool,RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::has_restored_live_authority(inner, _table), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn restored_live_authority(&self,_table:&str,_id:&str)->Result<bool,RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::restored_live_authority(inner, _table, _id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn restored_authority_mode(&self,_table:&str,_id:&str)->Result<Option<u8>,RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::restored_authority_mode(inner, _table, _id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn restored_narrowed(&self,_table:&str,_id:&str)->Result<bool,RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::restored_narrowed(inner, _table, _id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) } }
        fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::get(inner, table, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::get(inner, table, id) } }
        fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::lookup(inner, table, index_name, index, key), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::lookup(inner, table, index_name, index, key) } }
        fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::scan(inner, table, index_name, prefix, bounds, dir, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::scan(inner, table, index_name, prefix, bounds, dir, limit) } }
        #[cfg(feature = "server-search")]
        fn scan_selected(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, fields: &[String]) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::scan_selected(inner, table, index, prefix, bounds, dir, fields), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::scan_selected(inner, table, index, prefix, bounds, dir, fields) } }
        fn index_head(&self, _table: &str, _index: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::index_head(inner, _table, _index, _prefix, _bounds, _dir), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::index_head(inner, _table, _index, _prefix, _bounds, _dir) } }
        fn scan_metered(&self, _table: &str, _index_name: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir, _limit: usize, _scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::scan_metered(inner, _table, _index_name, _prefix, _bounds, _dir, _limit, _scope, meter), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::scan_metered(inner, _table, _index_name, _prefix, _bounds, _dir, _limit, _scope, meter) } }
        fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::count_prefix(inner, table, index_name, prefix, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::count_prefix(inner, table, index_name, prefix, limit) } }
        fn cap_count(&self, _table: &str, _by: &[String], _group: &[Value]) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::cap_count(inner, _table, _by, _group), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::cap_count(inner, _table, _by, _group) } }
        fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::put(inner, table_name, table, row, old), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::put(inner, table_name, table, row, old) } }
        fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::delete(inner, table_name, table, old), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as Rows>::delete(inner, table_name, table, old) } }
        fn track_time_audience( &self, _table_name: &str, _table: &Table, _id: &str, _row: Option<&Value>, _now: i64, _published: bool, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::track_time_audience(inner, _table_name, _table, _id, _row, _now, _published), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
        fn time_audience_pending(&self, _table_name: &str, _id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::time_audience_pending(inner, _table_name, _id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
        fn time_audience_published(&self, _table_name: &str, _id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::time_audience_published(inner, _table_name, _id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "time-publication" }) } }
        fn holds_assets(&self) -> Result<bool, crate::RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::holds_assets(inner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "assets" }) } }
        fn asset(&self, _id: &str) -> Result<Option<Asset>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::asset(inner, _id), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "assets" }) } }
        fn claim_asset(&self, id: &str, _by: &str, _table: &str, _row_id: &str, _column: &str) -> Result<Asset, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::claim_asset(inner, id, _by, _table, _row_id, _column), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "assets" }) } }
        fn release_asset(&self, _id: &str, #[cfg(feature = "sqlite")] _table: &str, #[cfg(feature = "sqlite")] _row_id: &str, #[cfg(feature = "sqlite")] _column: &str, _now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as Rows>::release_asset(inner, _id, _table, _row_id, _column, _now), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "assets" }) } }
    }
    impl Rows for ReadSnapshot<'_> {
        fn change_footprint(&self) -> crate::revocation::Footprint { <AnyTx<'_> as Rows>::change_footprint(&self.tx) }
        fn widen_change_evidence(&self) { <AnyTx<'_> as Rows>::widen_change_evidence(&self.tx) }
        fn provisional_sequence_floor(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> { <AnyTx<'_> as Rows>::provisional_sequence_floor(&self.tx, _parent, _id) }
        fn sequence_value(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> { <AnyTx<'_> as Rows>::sequence_value(&self.tx, _parent, _id) }
        fn set_sequence(&self, _parent: &str, _id: &str, _value: i64) -> Result<(), RuntimeError> { <AnyTx<'_> as Rows>::set_sequence(&self.tx, _parent, _id, _value) }
        fn sequence_ids(&self, _parent: &str) -> Result<Vec<String>, RuntimeError> { <AnyTx<'_> as Rows>::sequence_ids(&self.tx, _parent) }
        fn rewrite_sequence_ids( &self, _ids: &std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>, ) -> Result<u64, RuntimeError> { <AnyTx<'_> as Rows>::rewrite_sequence_ids(&self.tx, _ids) }
        fn effect_once(&self, _effect: &str, _key: &str) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::effect_once(&self.tx, _effect, _key) }
        fn provisional_id_after(&self, _table: &str, _after: &str) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as Rows>::provisional_id_after(&self.tx, _table, _after) }
        fn has_provisional(&self, _table: &str) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::has_provisional(&self.tx, _table) }
        fn provisional_groups(&self, table: &str, _fields: &[String]) -> Result<Option<Vec<Vec<Value>>>, RuntimeError> { <AnyTx<'_> as Rows>::provisional_groups(&self.tx, table, _fields) }
        fn provisional_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::provisional_row(&self.tx, _table, _row) }
        fn recording_covered(&self, _table: &str, _row: &Value, _viewer: &str, _now: i64, _scope: &crate::engine::Authorization, _meter: &mut crate::engine::InternalMeter<'_>) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::recording_covered(&self.tx, _table, _row, _viewer, _now, _scope, _meter) }
        fn current_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::current_row(&self.tx, _table, _row) }
        fn current_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::current_group(&self.tx, _table, _index, _prefix) }
        fn acquired_boundary(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<Option<AcquiredBoundary>, RuntimeError> { <AnyTx<'_> as Rows>::acquired_boundary(&self.tx, _table, _index, _prefix) }
        fn search_retained_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::search_retained_row(&self.tx, _table, _row) }
        fn retained_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::retained_row(&self.tx, _table, _row) }
        fn retained_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::retained_group(&self.tx, _table, _index, _prefix) }
        fn prefetch(&self, _requests: &[PrefetchRequest]) { <AnyTx<'_> as Rows>::prefetch(&self.tx, _requests) }
        fn prefetch_enabled(&self) -> bool { <AnyTx<'_> as Rows>::prefetch_enabled(&self.tx) }
        #[cfg(feature="sqlite")]
        fn walk_adoption(&self, table: &str, decode: u64, scratch: u64, work: [u64;3], visit: &mut dyn FnMut(Value) -> Result<(),RuntimeError>) -> Result<(),RuntimeError> { <AnyTx<'_> as Rows>::walk_adoption(&self.tx, table, decode, scratch, work, visit) }
        fn has_restored_live_authority(&self,_table:&str)->Result<bool,RuntimeError> { <AnyTx<'_> as Rows>::has_restored_live_authority(&self.tx, _table) }
        fn restored_live_authority(&self,_table:&str,_id:&str)->Result<bool,RuntimeError> { <AnyTx<'_> as Rows>::restored_live_authority(&self.tx, _table, _id) }
        fn restored_authority_mode(&self,_table:&str,_id:&str)->Result<Option<u8>,RuntimeError> { <AnyTx<'_> as Rows>::restored_authority_mode(&self.tx, _table, _id) }
        fn restored_narrowed(&self,_table:&str,_id:&str)->Result<bool,RuntimeError> { <AnyTx<'_> as Rows>::restored_narrowed(&self.tx, _table, _id) }
        fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { <AnyTx<'_> as Rows>::get(&self.tx, table, id) }
        fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { <AnyTx<'_> as Rows>::lookup(&self.tx, table, index_name, index, key) }
        fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { <AnyTx<'_> as Rows>::scan(&self.tx, table, index_name, prefix, bounds, dir, limit) }
        #[cfg(feature = "server-search")]
        fn scan_selected(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, fields: &[String]) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { <AnyTx<'_> as Rows>::scan_selected(&self.tx, table, index, prefix, bounds, dir, fields) }
        fn index_head(&self, _table: &str, _index: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> { <AnyTx<'_> as Rows>::index_head(&self.tx, _table, _index, _prefix, _bounds, _dir) }
        fn scan_metered(&self, _table: &str, _index_name: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir, _limit: usize, _scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { <AnyTx<'_> as Rows>::scan_metered(&self.tx, _table, _index_name, _prefix, _bounds, _dir, _limit, _scope, meter) }
        fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { <AnyTx<'_> as Rows>::count_prefix(&self.tx, table, index_name, prefix, limit) }
        fn cap_count(&self, _table: &str, _by: &[String], _group: &[Value]) -> Result<u64, RuntimeError> { <AnyTx<'_> as Rows>::cap_count(&self.tx, _table, _by, _group) }
        fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { <AnyTx<'_> as Rows>::put(&self.tx, table_name, table, row, old) }
        fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { <AnyTx<'_> as Rows>::delete(&self.tx, table_name, table, old) }
        fn track_time_audience( &self, _table_name: &str, _table: &Table, _id: &str, _row: Option<&Value>, _now: i64, _published: bool, ) -> Result<(), RuntimeError> { <AnyTx<'_> as Rows>::track_time_audience(&self.tx, _table_name, _table, _id, _row, _now, _published) }
        fn time_audience_pending(&self, _table_name: &str, _id: &str) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::time_audience_pending(&self.tx, _table_name, _id) }
        fn time_audience_published(&self, _table_name: &str, _id: &str) -> Result<bool, RuntimeError> { <AnyTx<'_> as Rows>::time_audience_published(&self.tx, _table_name, _id) }
        fn holds_assets(&self) -> Result<bool, crate::RuntimeError> { <AnyTx<'_> as Rows>::holds_assets(&self.tx) }
        fn asset(&self, _id: &str) -> Result<Option<Asset>, RuntimeError> { <AnyTx<'_> as Rows>::asset(&self.tx, _id) }
        fn claim_asset(&self, id: &str, _by: &str, _table: &str, _row_id: &str, _column: &str) -> Result<Asset, RuntimeError> { <AnyTx<'_> as Rows>::claim_asset(&self.tx, id, _by, _table, _row_id, _column) }
        fn release_asset(&self, _id: &str, #[cfg(feature = "sqlite")] _table: &str, #[cfg(feature = "sqlite")] _row_id: &str, #[cfg(feature = "sqlite")] _column: &str, _now: i64) -> Result<(), RuntimeError> { <AnyTx<'_> as Rows>::release_asset(&self.tx, _id, _table, _row_id, _column, _now) }
    }
}

mod partition {
    use super::*;
    use crate::partition::*;
    impl PartitionRows for AnyTx<'_> {
        fn next_seq(&self) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::next_seq(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::next_seq(inner) } }
        fn append_log( &self, partition: &str, seq: u64, ord: u32, table: &str, kind: &str, id: &str, data: Option<&str>, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::append_log(inner, partition, seq, ord, table, kind, id, data), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::append_log(inner, partition, seq, ord, table, kind, id, data) } }
        fn membership_transitions(&self, partition: &str, after: u64) -> Result<Vec<LogEvent>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::membership_transitions(inner, partition, after), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::membership_transitions(inner, partition, after) } }
        fn memberships_before(&self, partition: &str, watermark: u64) -> Result<Vec<LogEvent>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::memberships_before(inner, partition, watermark), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::memberships_before(inner, partition, watermark) } }
        fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::commit_times(inner, sequences), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::commit_times(inner, sequences) } }
        fn read_log_spans(&self, spans: &[LogSpan], after: u64, only_seq: Option<u64>, limit: usize) -> Result<Vec<LogEvent>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::read_log_spans(inner, spans, after, only_seq, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::read_log_spans(inner, spans, after, only_seq, limit) } }
        fn audience_epoch(&self, _table: &str) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::audience_epoch(inner, _table), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::audience_epoch(inner, _table) } }
        fn audience_epoch_time(&self, _table: &str) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as PartitionRows>::audience_epoch_time(inner, _table), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as PartitionRows>::audience_epoch_time(inner, _table) } }
    }
    impl PartitionRows for ReadSnapshot<'_> {
        fn next_seq(&self) -> Result<u64, RuntimeError> { <AnyTx<'_> as PartitionRows>::next_seq(&self.tx) }
        fn append_log( &self, partition: &str, seq: u64, ord: u32, table: &str, kind: &str, id: &str, data: Option<&str>, ) -> Result<(), RuntimeError> { <AnyTx<'_> as PartitionRows>::append_log(&self.tx, partition, seq, ord, table, kind, id, data) }
        fn membership_transitions(&self, partition: &str, after: u64) -> Result<Vec<LogEvent>, RuntimeError> { <AnyTx<'_> as PartitionRows>::membership_transitions(&self.tx, partition, after) }
        fn memberships_before(&self, partition: &str, watermark: u64) -> Result<Vec<LogEvent>, RuntimeError> { <AnyTx<'_> as PartitionRows>::memberships_before(&self.tx, partition, watermark) }
        fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> { <AnyTx<'_> as PartitionRows>::commit_times(&self.tx, sequences) }
        fn read_log_spans(&self, spans: &[LogSpan], after: u64, only_seq: Option<u64>, limit: usize) -> Result<Vec<LogEvent>, RuntimeError> { <AnyTx<'_> as PartitionRows>::read_log_spans(&self.tx, spans, after, only_seq, limit) }
        fn audience_epoch(&self, _table: &str) -> Result<u64, RuntimeError> { <AnyTx<'_> as PartitionRows>::audience_epoch(&self.tx, _table) }
        fn audience_epoch_time(&self, _table: &str) -> Result<Option<i64>, RuntimeError> { <AnyTx<'_> as PartitionRows>::audience_epoch_time(&self.tx, _table) }
    }
}

mod authority {
    use super::*;
    use crate::authority::*;
    impl AuthorityTransaction for AnyTx<'_> {
        fn principal_generation(&self, principal: &str) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AuthorityTransaction>::principal_generation(inner, principal), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AuthorityTransaction>::principal_generation(inner, principal) } }
        fn session_by_digest(&self, digest: &str) -> Result<Option<SessionRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AuthorityTransaction>::session_by_digest(inner, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AuthorityTransaction>::session_by_digest(inner, digest) } }
        fn latest_live_family_member( &self, principal: &str, family: &str, now: i64, ) -> Result<Option<SessionRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AuthorityTransaction>::latest_live_family_member(inner, principal, family, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AuthorityTransaction>::latest_live_family_member(inner, principal, family, now) } }
        fn work_by_id(&self, id: &str) -> Result<Option<WorkRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AuthorityTransaction>::work_by_id(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AuthorityTransaction>::work_by_id(inner, id) } }
        fn work_by_claimed_session_digest( &self, digest: &str, ) -> Result<Option<WorkRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AuthorityTransaction>::work_by_claimed_session_digest(inner, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AuthorityTransaction>::work_by_claimed_session_digest(inner, digest) } }
        fn invalidate_session(&self, digest: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AuthorityTransaction>::invalidate_session(inner, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AuthorityTransaction>::invalidate_session(inner, digest) } }
        fn invalidate_family(&self, principal: &str, family: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AuthorityTransaction>::invalidate_family(inner, principal, family), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AuthorityTransaction>::invalidate_family(inner, principal, family) } }
    }
}

mod identity_transaction {
    use super::*;
    use crate::identity::*;
    impl IdentityTransaction for AnyTx<'_> {
        fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as IdentityTransaction>::insert_identity_session(inner, session, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as IdentityTransaction>::insert_identity_session(inner, session, now) } }
        fn insert_read_session( &self, session: &Session, now: i64, family: Option<(&str, i64)>, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as IdentityTransaction>::insert_read_session(inner, session, now, family), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as IdentityTransaction>::insert_read_session(inner, session, now, family) } }
        fn initialize_mint_binding_scope(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as IdentityTransaction>::initialize_mint_binding_scope(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as IdentityTransaction>::initialize_mint_binding_scope(inner) } }
        fn mint_binding_record( &self, invocation: &str, intent: &str, ) -> Result<Option<SessionMintRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as IdentityTransaction>::mint_binding_record(inner, invocation, intent), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as IdentityTransaction>::mint_binding_record(inner, invocation, intent) } }
        fn record_session_mint( &self, invocation: &str, intent: &str, record: &SessionMintRecord, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as IdentityTransaction>::record_session_mint(inner, invocation, intent, record), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as IdentityTransaction>::record_session_mint(inner, invocation, intent, record) } }
        fn set_identity_session_family(&self, digest: &str, family: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as IdentityTransaction>::set_identity_session_family(inner, digest, family), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as IdentityTransaction>::set_identity_session_family(inner, digest, family) } }
    }
}

mod identity_store {
    use super::*;
    use crate::identity::*;
    impl IdentityStore for AnyStore {
        fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::insert_identity_session(inner, session, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::insert_identity_session(&view, session, now)) } }
        fn insert_identity_session_atomic( &self, session: &Session, now: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::insert_identity_session_atomic(inner, session, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::insert_identity_session_atomic(&view, session, now)) } }
        fn close_identity_session(&self, digest: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::close_identity_session(inner, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::close_identity_session(&view, digest)) } }
        fn full_rotation_record( &self, digest: &str, now: i64, ) -> Result<Option<FullRotationRecord>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::full_rotation_record(inner, digest, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::full_rotation_record(&view, digest, now)) } }
        fn delete_expired_identity_session(&self, digest: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::delete_expired_identity_session(inner, digest, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::delete_expired_identity_session(&view, digest, now)) } }
        fn replace_full_session( &self, old_digest: &str, session: &Session, family: &str, now: i64, ) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::replace_full_session(inner, old_digest, session, family, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::replace_full_session(&view, old_digest, session, family, now)) } }
        fn signup_identity( &self, prepared: &PreparedSignup, session: &Session, now: i64, validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::signup_identity(inner, prepared, session, now, validate), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::signup_identity(&view, prepared, session, now, validate)) } }
        fn identity_credential(&self, email: &str) -> Result<Option<Credential>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::identity_credential(inner, email), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::identity_credential(&view, email)) } }
        fn login_identity( &self, principal: &str, session: &Session, now: i64, validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::login_identity(inner, principal, session, now, validate), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::login_identity(&view, principal, session, now, validate)) } }
        fn rotate_read_session( &self, digest: &str, now: i64, mint: impl FnOnce(&ReadRotationRecord) -> Result<Option<Session>, RuntimeError>, ) -> Result<Option<Session>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::rotate_read_session(inner, digest, now, mint), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::rotate_read_session(&view, digest, now, mint)) } }
        fn revoke_identity_principal(&self, principal: &str) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::revoke_identity_principal(inner, principal), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::revoke_identity_principal(&view, principal)) } }
        fn identity_session_expiry(&self, digest: &str) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::identity_session_expiry(inner, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::identity_session_expiry(&view, digest)) } }
        fn is_supervised_family(&self, digest: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::is_supervised_family(inner, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::is_supervised_family(&view, digest)) } }
        fn clear_worker_families(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::clear_worker_families(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::clear_worker_families(&view)) } }
        fn revoke_worker_family(&self, family: Option<&str>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::revoke_worker_family(inner, family), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::revoke_worker_family(&view, family)) } }
        fn mint_supervised_child( &self, named: bool, now: i64, revision: usize, mint: impl FnOnce() -> Result<Session, RuntimeError>, ) -> Result<Session, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as IdentityStore>::mint_supervised_child(inner, named, now, revision, mint), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as IdentityStore>::mint_supervised_child(&view, named, now, revision, mint)) } }
    }
}

mod requests_transaction {
    use super::*;
    use crate::engine::actions::requests::*;
    impl RequestsTransaction for AnyTx<'_> {
        fn request(&self, id: &str) -> Result<Option<ActionRequest>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::request(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::request(inner, id) } }
        fn request_release(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::request_release(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::request_release(inner) } }
        fn insert_request(&self, request: &NewRequest<'_>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::insert_request(inner, request), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::insert_request(inner, request) } }
        fn expired_requests(&self, now: i64, limit: u64) -> Result<Vec<ActionRequest>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::expired_requests(inner, now, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::expired_requests(inner, now, limit) } }
        fn finish_request( &self, id: &str, state: &str, code: &str, error: &str, now: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::finish_request(inner, id, state, code, error, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::finish_request(inner, id, state, code, error, now) } }
        fn requeue_request(&self, id: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::requeue_request(inner, id, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::requeue_request(inner, id, now) } }
        fn due_requests( &self, now: i64, action: Option<&str>, names: Option<&[String]>, limit: u64, ) -> Result<Vec<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::due_requests(inner, now, action, names, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::due_requests(inner, now, action, names, limit) } }
        fn fail_request_authority(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::fail_request_authority(inner, id, error, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::fail_request_authority(inner, id, error, now) } }
        fn claim_request( &self, id: &str, worker: &str, session_digest: &str, lease_until: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::claim_request(inner, id, worker, session_digest, lease_until), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::claim_request(inner, id, worker, session_digest, lease_until) } }
        fn settle_request(&self, id: &str, settled: &RequestSettlement<'_>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::settle_request(inner, id, settled), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::settle_request(inner, id, settled) } }
        fn cancel_request(&self, id: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as RequestsTransaction>::cancel_request(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as RequestsTransaction>::cancel_request(inner, id) } }
    }
}

mod requests_store {
    use super::*;
    use crate::engine::actions::requests::*;
    impl RequestsStore for AnyStore {
        fn request_counts(&mut self) -> Result<BTreeMap<String, u64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as RequestsStore>::request_counts(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as RequestsStore>::request_counts(&mut *inner.borrow()?) } }
    }
}

mod job_transaction {
    use super::*;
    use crate::engine::job::*;
    impl JobTransaction for AnyTx<'_> {
        fn insert_job( &self, id: &str, name: &str, args: &BTreeMap<String, Value>, program_hash: &str, now: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::insert_job(inner, id, name, args, program_hash, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::insert_job(inner, id, name, args, program_hash, now) } }
        fn insert_job_record( &self, id: &str, name: &str, args: &BTreeMap<String, Value>, program_hash: &str, now: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::insert_job_record(inner, id, name, args, program_hash, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::insert_job_record(inner, id, name, args, program_hash, now) } }
        fn head_job(&self) -> Result<Option<Head>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::head_job(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::head_job(inner) } }
        fn park_job(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::park_job(inner, id, error, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::park_job(inner, id, error, now) } }
        fn park_job_record(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::park_job_record(inner, id, error, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::park_job_record(inner, id, error, now) } }
        fn finish_job_sweeps(&self, id: &str, sweeps: usize, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::finish_job_sweeps(inner, id, sweeps, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::finish_job_sweeps(inner, id, sweeps, now) } }
        fn job_counters(&self, id: &str) -> Result<Option<(i64, i64)>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::job_counters(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::job_counters(inner, id) } }
        fn record_job_chunk(&self, chunk: JobChunkUpdate<'_>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::record_job_chunk(inner, chunk), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::record_job_chunk(inner, chunk) } }
        fn write_job_chunk( &self, chunk: JobChunkUpdate<'_>, chunks: i64, rows: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::write_job_chunk(inner, chunk, chunks, rows), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::write_job_chunk(inner, chunk, chunks, rows) } }
        fn park_job_chunk( &self, id: &str, error: &str, now: i64, size: u32, retries: u64, heap_peak: u64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::park_job_chunk(inner, id, error, now, size, retries, heap_peak), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::park_job_chunk(inner, id, error, now, size, retries, heap_peak) } }
        fn park_job_chunk_record( &self, id: &str, error: &str, now: i64, size: u32, retries: u64, heap_peak: u64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::park_job_chunk_record(inner, id, error, now, size, retries, heap_peak), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::park_job_chunk_record(inner, id, error, now, size, retries, heap_peak) } }
        #[cfg(feature = "native")]
        fn record_native_job_chunk( &self, id: &str, state: JobState, cursor: Option<&[u8]>, rows_written: u64, now: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::record_native_job_chunk(inner, id, state, cursor, rows_written, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::record_native_job_chunk(inner, id, state, cursor, rows_written, now) } }
        #[cfg(feature = "native")]
        fn write_native_job_chunk( &self, id: &str, state: JobState, cursor: Option<&[u8]>, chunks: i64, rows: i64, now: i64, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::write_native_job_chunk(inner, id, state, cursor, chunks, rows, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::write_native_job_chunk(inner, id, state, cursor, chunks, rows, now) } }
        fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::schedule_shape(inner, name), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::schedule_shape(inner, name) } }
        fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::schedule_boundary(inner, name), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::schedule_boundary(inner, name) } }
        fn schedule_exists(&self, name: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::schedule_exists(inner, name), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::schedule_exists(inner, name) } }
        fn set_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::set_schedule_shape(inner, name, shape), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::set_schedule_shape(inner, name, shape) } }
        fn set_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::set_schedule_boundary(inner, name, boundary), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::set_schedule_boundary(inner, name, boundary) } }
        fn write_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::write_schedule_shape(inner, name, shape), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::write_schedule_shape(inner, name, shape) } }
        fn write_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as JobTransaction>::write_schedule_boundary(inner, name, boundary), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as JobTransaction>::write_schedule_boundary(inner, name, boundary) } }
    }
}

mod job_store {
    use super::*;
    use crate::engine::job::*;
    impl JobStore for AnyStore {
        fn job(&mut self, id: &str) -> Result<Option<JobRun>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as JobStore>::job(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as JobStore>::job(&mut *inner.borrow()?, id) } }
        fn jobs(&mut self, limit: usize) -> Result<Vec<JobRun>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as JobStore>::jobs(inner, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as JobStore>::jobs(&mut *inner.borrow()?, limit) } }
        fn schedule_shape(&mut self, name: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as JobStore>::schedule_shape(inner, name), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as JobStore>::schedule_shape(&mut *inner.borrow()?, name) } }
        fn schedule_boundary(&mut self, name: &str) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as JobStore>::schedule_boundary(inner, name), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as JobStore>::schedule_boundary(&mut *inner.borrow()?, name) } }
        fn latest_schedule_boundary(&mut self) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as JobStore>::latest_schedule_boundary(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as JobStore>::latest_schedule_boundary(&mut *inner.borrow()?) } }
        fn job_summaries(&mut self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as JobStore>::job_summaries(inner, error_bytes), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as JobStore>::job_summaries(&mut *inner.borrow()?, error_bytes) } }
        fn job_count(&mut self) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as JobStore>::job_count(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => <pg::Store as JobStore>::job_count(&mut *inner.borrow()?) } }
    }
}

mod outbox_transaction {
    use super::*;
    use crate::engine::effects::*;
    impl OutboxTransaction for AnyTx<'_> {
        fn replay_suppresses(&self) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::replay_suppresses(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::replay_suppresses(inner) } }
        fn suppress_effects(&self, count: usize) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::suppress_effects(inner, count), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::suppress_effects(inner, count) } }
        fn effect_release(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::effect_release(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::effect_release(inner) } }
        fn insert_effect(&self, effect: &NewEffect<'_>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::insert_effect(inner, effect), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::insert_effect(inner, effect) } }
        fn insert_effect_presence(&self, principal: &str, id: &str, deadline: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::insert_effect_presence(inner, principal, id, deadline), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::insert_effect_presence(inner, principal, id, deadline) } }
        fn park_effect_generation(&self, id: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::park_effect_generation(inner, id, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::park_effect_generation(inner, id, now) } }
        fn effect_run(&self, id: &str) -> Result<Option<EffectRun>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::effect_run(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::effect_run(inner, id) } }
        fn effect_lease_digest(&self, id: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::effect_lease_digest(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::effect_lease_digest(inner, id) } }
        fn effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::effect_candidates(inner, effect, now, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::effect_candidates(inner, effect, now, limit) } }
        fn strict_effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::strict_effect_candidates(inner, effect, now, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::strict_effect_candidates(inner, effect, now, limit) } }
        fn effect_presence_satisfied(&self, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::effect_presence_satisfied(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::effect_presence_satisfied(inner, id) } }
        fn clear_effect_presence(&self, id: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::clear_effect_presence(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::clear_effect_presence(inner, id) } }
        fn satisfy_effect(&self, id: &str, outcome: &Value) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::satisfy_effect(inner, id, outcome), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::satisfy_effect(inner, id, outcome) } }
        fn claim_effect(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::claim_effect(inner, id, worker, lease_until, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::claim_effect(inner, id, worker, lease_until, digest) } }
        fn claim_effect_strict(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::claim_effect_strict(inner, id, worker, lease_until, digest), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::claim_effect_strict(inner, id, worker, lease_until, digest) } }
        fn required_effect_run(&self, id: &str) -> Result<EffectRun, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::required_effect_run(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::required_effect_run(inner, id) } }
        fn effect_presence(&self, id: &str) -> Result<Vec<(String, bool)>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::effect_presence(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::effect_presence(inner, id) } }
        fn pending_effect_presence(&self, principal: &str, now: i64) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::pending_effect_presence(inner, principal, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::pending_effect_presence(inner, principal, now) } }
        fn reconnect_effect_presence(&self, principal: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::reconnect_effect_presence(inner, principal, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::reconnect_effect_presence(inner, principal, now) } }
        fn send_effect(&self, id: &str, result: Option<&Value>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::send_effect(inner, id, result), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::send_effect(inner, id, result) } }
        fn retry_effect(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::retry_effect(inner, id, error, next_at), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::retry_effect(inner, id, error, next_at) } }
        fn fail_effect(&self, id: &str, error: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::fail_effect(inner, id, error), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::fail_effect(inner, id, error) } }
        fn mark_effect_settled(&self, id: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::mark_effect_settled(inner, id, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::mark_effect_settled(inner, id, now) } }
        fn send_effect_strict(&self, id: &str, result: Option<&Value>, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::send_effect_strict(inner, id, result, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::send_effect_strict(inner, id, result, now) } }
        fn retry_effect_strict(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::retry_effect_strict(inner, id, error, next_at), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::retry_effect_strict(inner, id, error, next_at) } }
        fn fail_effect_strict(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::fail_effect_strict(inner, id, error, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::fail_effect_strict(inner, id, error, now) } }
        fn finalize_effect_cancellation(&self, id: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::finalize_effect_cancellation(inner, id, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::finalize_effect_cancellation(inner, id, now) } }
        fn cancel_effect(&self, id: &str, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::cancel_effect(inner, id, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::cancel_effect(inner, id, now) } }
        fn shift_worker_leases(&self, milliseconds: i64, before: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::shift_worker_leases(inner, milliseconds, before), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::shift_worker_leases(inner, milliseconds, before) } }
        fn expired_effects(&self, now: i64, limit: u64) -> Result<Vec<EffectRun>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::expired_effects(inner, now, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::expired_effects(inner, now, limit) } }
        fn expired_effects_strict(&self, now: i64) -> Result<Vec<EffectRun>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::expired_effects_strict(inner, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::expired_effects_strict(inner, now) } }
        fn expire_effect(&self, update: &ExpiredEffect<'_>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::expire_effect(inner, update), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::expire_effect(inner, update) } }
        fn replay_deployed(&self) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as OutboxTransaction>::replay_deployed(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as OutboxTransaction>::replay_deployed(inner) } }
    }
}

mod outbox_store {
    use super::*;
    use crate::engine::effects::*;
    impl OutboxStore for AnyStore {
        fn effects_due(&self, effect: Option<&str>, now: i64) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as OutboxStore>::effects_due(inner, effect, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as OutboxStore>::effects_due(&view, effect, now)) } }
        fn list_effects(&self, state: Option<&str>, limit: u64) -> Result<Vec<EffectRun>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as OutboxStore>::list_effects(inner, state, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as OutboxStore>::list_effects(&view, state, limit)) } }
        fn effect_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as OutboxStore>::effect_counts(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as OutboxStore>::effect_counts(&view)) } }
        fn effect_health(&self, now: i64) -> Result<EffectHealth, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as OutboxStore>::effect_health(inner, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as OutboxStore>::effect_health(&view, now)) } }
        fn set_effect_replay(&self, replay: bool, check: impl FnOnce(bool) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as OutboxStore>::set_effect_replay(inner, replay, check), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as OutboxStore>::set_effect_replay(&view, replay, check)) } }
    }
}

mod receipts {
    use crate::receipts::*;
    use super::*;
        impl ReceiptReader for AnyTx<'_> {
        fn receipt(&self, principal: &str, id: &str) -> Result<Option<ReceiptRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ReceiptReader>::receipt(inner, principal, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ReceiptReader>::receipt(inner, principal, id) } }
        fn receipt_exists(&self, principal: &str, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ReceiptReader>::receipt_exists(inner, principal, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ReceiptReader>::receipt_exists(inner, principal, id) } }
        fn sent_sequence( &self, principal: &str, id: &str, through: i64, ) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ReceiptReader>::sent_sequence(inner, principal, id, through), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ReceiptReader>::sent_sequence(inner, principal, id, through) } }
    }
    impl ReceiptReader for AnyStore {
        fn receipt(&self, principal: &str, id: &str) -> Result<Option<ReceiptRecord>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as ReceiptReader>::receipt(inner, principal, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as ReceiptReader>::receipt(&view, principal, id)) } }
        fn receipt_exists(&self, principal: &str, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as ReceiptReader>::receipt_exists(inner, principal, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as ReceiptReader>::receipt_exists(&view, principal, id)) } }
        fn sent_sequence( &self, principal: &str, id: &str, through: i64, ) -> Result<Option<i64>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as ReceiptReader>::sent_sequence(inner, principal, id, through), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as ReceiptReader>::sent_sequence(&view, principal, id, through)) } }
    }
}

mod asset_intents {
    use super::*;
    use crate::assets::*;
    impl AssetIntentReader for AnyTx<'_> {
        fn asset_intent_exists(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetIntentReader>::asset_intent_exists(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetIntentReader>::asset_intent_exists(inner, owner, id) } }
    }
    impl AssetIntentReader for AnyStore {
        fn asset_intent_exists(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as AssetIntentReader>::asset_intent_exists(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as AssetIntentReader>::asset_intent_exists(&view, owner, id)) } }
    }
}

mod assets {
    use super::*;
    use crate::assets::*;
    impl AssetTransaction for AnyTx<'_> {
        fn pinned_asset_bytes(&self, owner: &str) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::pinned_asset_bytes(inner, owner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::pinned_asset_bytes(inner, owner) } }
        fn record_uploaded_intent(&self, record: &UploadedIntent<'_>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::record_uploaded_intent(inner, record), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::record_uploaded_intent(inner, record) } }
        fn intent_declaration(&self, owner: &str, id: &str) -> Result<Option<IntentDeclaration>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::intent_declaration(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::intent_declaration(inner, owner, id) } }
        fn declare_intent(&self, owner: &str, id: &str, fingerprint: &str, placement: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::declare_intent(inner, owner, id, fingerprint, placement), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::declare_intent(inner, owner, id, fingerprint, placement) } }
        fn intent_placement(&self, owner: &str, id: &str) -> Result<Option<IntentPlacement>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::intent_placement(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::intent_placement(inner, owner, id) } }
        fn pending_intents(&self, owner: &str, after: &str) -> Result<Vec<PendingIntent>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::pending_intents(inner, owner, after), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::pending_intents(inner, owner, after) } }
        fn intent_cancelled(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::intent_cancelled(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::intent_cancelled(inner, owner, id) } }
        fn settle_intent(&self, owner: &str, id: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::settle_intent(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::settle_intent(inner, owner, id) } }
        fn cancel_intent(&self, owner: &str, id: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::cancel_intent(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::cancel_intent(inner, owner, id) } }
        fn asset_ids(&self) -> Result<Vec<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::asset_ids(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::asset_ids(inner) } }
        fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::asset(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::asset(inner, id) } }
        fn asset_reserved(&self, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::asset_reserved(inner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::asset_reserved(inner, id) } }
        fn place_asset(&self, id: &str, table: &str, row_id: &str, column: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::place_asset(inner, id, table, row_id, column), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::place_asset(inner, id, table, row_id, column) } }
        fn replay_record(&self, owner: &str, id: &str) -> Result<Option<IntentRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::replay_record(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::replay_record(inner, owner, id) } }
        fn mutation_executed(&self, owner: &str, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetTransaction>::mutation_executed(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetTransaction>::mutation_executed(inner, owner, id) } }
    }
}

mod metadata {
    use crate::metadata::*;
    use super::*;
        impl MetadataReader for AnyTx<'_> {
        fn store_identity(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::store_identity(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::store_identity(inner) } }
        fn generation_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::generation_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::generation_value(inner) } }
        fn release_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::release_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::release_value(inner) } }
        fn release_native_digest(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::release_native_digest(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::release_native_digest(inner) } }
        fn time_audience_clock_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::time_audience_clock_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::time_audience_clock_value(inner) } }
        fn worker_status(&self, worker: Option<&str>) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::worker_status(inner, worker), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::worker_status(inner, worker) } }
        fn release_revision_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::release_revision_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::release_revision_value(inner) } }
        fn schema_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::schema_marker(inner, marker), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::schema_marker(inner, marker) } }
        fn worker_session_family(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::worker_session_family(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::worker_session_family(inner) } }
        fn worker_session_revision(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::worker_session_revision(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::worker_session_revision(inner) } }
        fn worker_family_revision(&self, family: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::worker_family_revision(inner, family), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::worker_family_revision(inner, family) } }
        fn deployment_environment(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::deployment_environment(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::deployment_environment(inner) } }
        fn dev_value(&self, key: DevMetadata) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataReader>::dev_value(inner, key), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataReader>::dev_value(inner, key) } }
    }
    impl MetadataReader for AnyStore {
        fn store_identity(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::store_identity(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::store_identity(&view)) } }
        fn generation_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::generation_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::generation_value(&view)) } }
        fn release_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::release_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::release_value(&view)) } }
        fn release_native_digest(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::release_native_digest(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::release_native_digest(&view)) } }
        fn time_audience_clock_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::time_audience_clock_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::time_audience_clock_value(&view)) } }
        fn worker_status(&self, worker: Option<&str>) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::worker_status(inner, worker), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::worker_status(&view, worker)) } }
        fn release_revision_value(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::release_revision_value(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::release_revision_value(&view)) } }
        fn schema_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::schema_marker(inner, marker), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::schema_marker(&view, marker)) } }
        fn worker_session_family(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::worker_session_family(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::worker_session_family(&view)) } }
        fn worker_session_revision(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::worker_session_revision(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::worker_session_revision(&view)) } }
        fn worker_family_revision(&self, family: &str) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::worker_family_revision(inner, family), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::worker_family_revision(&view, family)) } }
        fn deployment_environment(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::deployment_environment(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::deployment_environment(&view)) } }
        fn dev_value(&self, key: DevMetadata) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataReader>::dev_value(inner, key), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataReader>::dev_value(&view, key)) } }
    }
    impl MetadataWriter for AnyTx<'_> {
        fn set_dev_value(&self, key: DevMetadata, value: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataWriter>::set_dev_value(inner, key, value), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataWriter>::set_dev_value(inner, key, value) } }
        fn set_deployment_environment(&self, value: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataWriter>::set_deployment_environment(inner, value), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataWriter>::set_deployment_environment(inner, value) } }
        fn set_worker_status(&self, worker: Option<&str>, value: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as MetadataWriter>::set_worker_status(inner, worker, value), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as MetadataWriter>::set_worker_status(inner, worker, value) } }
    }
    impl MetadataWriter for AnyStore {
        fn set_dev_value(&self, key: DevMetadata, value: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataWriter>::set_dev_value(inner, key, value), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataWriter>::set_dev_value(&view, key, value)) } }
        fn set_deployment_environment(&self, value: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataWriter>::set_deployment_environment(inner, value), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataWriter>::set_deployment_environment(&view, value)) } }
        fn set_worker_status(&self, worker: Option<&str>, value: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as MetadataWriter>::set_worker_status(inner, worker, value), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as MetadataWriter>::set_worker_status(&view, worker, value)) } }
    }
}

mod activation {
    use super::*;
    use crate::activation::*;
    impl ActivationReader for AnyTx<'_> {
        fn time_audience_clock(&self) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::time_audience_clock(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::time_audience_clock(inner) } }
        fn opening_marker(&self, marker: crate::metadata::SchemaMarker) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::opening_marker(inner, marker), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::opening_marker(inner, marker) } }
        fn opening_backend(&self) -> Result<Backend, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::opening_backend(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::opening_backend(inner) } }
        fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::check_selected_release(inner, expected), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::check_selected_release(inner, expected) } }
        fn previous_schema(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::previous_schema(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::previous_schema(inner) } }
        fn live_sum_marker(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::live_sum_marker(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::live_sum_marker(inner) } }
        fn activation_population(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::activation_population(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::activation_population(inner) } }
        fn narrowed_retained(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::narrowed_retained(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::narrowed_retained(inner) } }
        fn narrowed_restored(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::narrowed_restored(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::narrowed_restored(inner) } }
        fn restored_population( &self, kind: RestoredPopulation, path: &str, ) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::restored_population(inner, kind, path), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::restored_population(inner, kind, path) } }
        fn activation_inventory(&self) -> Result<Vec<DormantItem>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::activation_inventory(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::activation_inventory(inner) } }
        fn table_populated(&self, table: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::table_populated(inner, table), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::table_populated(inner, table) } }
        fn any_table_image( &self, table: &str, survives: impl FnMut(&Value) -> bool, ) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::any_table_image(inner, table, survives), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::any_table_image(inner, table, survives) } }
        fn timeline_rebuild_exists(&self, table: &str, id: &str) -> Result<bool, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationReader>::timeline_rebuild_exists(inner, table, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationReader>::timeline_rebuild_exists(inner, table, id) } }
    }
    impl ActivationTransaction for AnyTx<'_> {
        fn set_active_release(&self, release: u64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationTransaction>::set_active_release(inner, release), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationTransaction>::set_active_release(inner, release) } }
        fn mark_live_sum_candidates(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationTransaction>::mark_live_sum_candidates(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationTransaction>::mark_live_sum_candidates(inner) } }
        fn mark_maintained_ids(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationTransaction>::mark_maintained_ids(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationTransaction>::mark_maintained_ids(inner) } }
        fn set_audience_epoch(&self, table: &str, epoch: u64, now: i64) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationTransaction>::set_audience_epoch(inner, table, epoch, now), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationTransaction>::set_audience_epoch(inner, table, epoch, now) } }
        fn clear_activation_metadata(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationTransaction>::clear_activation_metadata(inner), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationTransaction>::clear_activation_metadata(inner) } }
        fn clear_retired_table(&self, table: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationTransaction>::clear_retired_table(inner, table), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationTransaction>::clear_retired_table(inner, table) } }
        fn clear_retired_index(&self, table: &str, index: &str) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ActivationTransaction>::clear_retired_index(inner, table, index), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ActivationTransaction>::clear_retired_index(inner, table, index) } }
    }
}

mod preparation {
    use super::*;
    use crate::activation::*;
    impl ActivationPreparation for AnyPreparation<'_, '_> {
        fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError> { match self { Self::Sqlite(inner) => <sqlite::release::ReleaseCheck<'_> as ActivationPreparation>::check_selected_release(inner, expected), #[cfg(feature = "postgres")] Self::Postgres(inner) => <pg_activation::Preparation<'_, '_> as ActivationPreparation>::check_selected_release(inner, expected), #[cfg(not(feature = "postgres"))] Self::Lifetime(never, _) => match *never {} } }
        fn check_backend(&self, backend: &Backend) -> Result<(), RuntimeError> { match self { Self::Sqlite(inner) => <sqlite::release::ReleaseCheck<'_> as ActivationPreparation>::check_backend(inner, backend), #[cfg(feature = "postgres")] Self::Postgres(inner) => <pg_activation::Preparation<'_, '_> as ActivationPreparation>::check_backend(inner, backend), #[cfg(not(feature = "postgres"))] Self::Lifetime(never, _) => match *never {} } }
        fn activation_inventory(&self) -> Result<Vec<DormantItem>, RuntimeError> { match self { Self::Sqlite(inner) => <sqlite::release::ReleaseCheck<'_> as ActivationPreparation>::activation_inventory(inner), #[cfg(feature = "postgres")] Self::Postgres(inner) => <pg_activation::Preparation<'_, '_> as ActivationPreparation>::activation_inventory(inner), #[cfg(not(feature = "postgres"))] Self::Lifetime(never, _) => match *never {} } }
        fn enable_dormant(&self) -> Result<(), RuntimeError> { match self { Self::Sqlite(inner) => <sqlite::release::ReleaseCheck<'_> as ActivationPreparation>::enable_dormant(inner), #[cfg(feature = "postgres")] Self::Postgres(inner) => <pg_activation::Preparation<'_, '_> as ActivationPreparation>::enable_dormant(inner), #[cfg(not(feature = "postgres"))] Self::Lifetime(never, _) => match *never {} } }
        fn prepare_release_metadata( &self, native_digest: &str, restore: bool, ) -> Result<(), RuntimeError> { match self { Self::Sqlite(inner) => <sqlite::release::ReleaseCheck<'_> as ActivationPreparation>::prepare_release_metadata(inner, native_digest, restore), #[cfg(feature = "postgres")] Self::Postgres(inner) => <pg_activation::Preparation<'_, '_> as ActivationPreparation>::prepare_release_metadata(inner, native_digest, restore), #[cfg(not(feature = "postgres"))] Self::Lifetime(never, _) => match *never {} } }
    }
}

mod release {
    use super::*;
    use crate::engine::release::*;
    impl ReleaseTransaction for AnyPreparation<'_, '_> {
        fn selected_release(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(inner) => <sqlite::release::ReleaseCheck<'_> as ReleaseTransaction>::selected_release(inner), #[cfg(feature = "postgres")] Self::Postgres(inner) => <pg_activation::Preparation<'_, '_> as ReleaseTransaction>::selected_release(inner), #[cfg(not(feature = "postgres"))] Self::Lifetime(never, _) => match *never {} } }
        fn release_revision(&self) -> Result<Option<String>, RuntimeError> { match self { Self::Sqlite(inner) => <sqlite::release::ReleaseCheck<'_> as ReleaseTransaction>::release_revision(inner), #[cfg(feature = "postgres")] Self::Postgres(inner) => <pg_activation::Preparation<'_, '_> as ReleaseTransaction>::release_revision(inner), #[cfg(not(feature = "postgres"))] Self::Lifetime(never, _) => match *never {} } }
    }
}

mod release_history {
    use super::*;
    use crate::release_history::{Event, ReleaseHistoryReader, ReleaseHistoryTransaction};
    impl ReleaseHistoryReader for AnyTx<'_> {
        fn release_events(&self, after: u64, limit: usize) -> Result<Vec<Event>, RuntimeError> {
            match self { Self::Sqlite(SqliteTx(inner)) => inner.release_events(after, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.release_events(after, limit) }
        }
        fn release_event_items(&self, event: u64, after: Option<&str>, limit: usize) -> Result<Vec<crate::release_history::DormantItem>, RuntimeError> {
            match self { Self::Sqlite(SqliteTx(inner)) => inner.release_event_items(event, after, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.release_event_items(event, after, limit) }
        }
        fn release_inventory(&self, after: Option<&str>, limit: usize) -> Result<Vec<crate::release_history::DormantItem>, RuntimeError> {
            match self { Self::Sqlite(SqliteTx(inner)) => inner.release_inventory(after, limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.release_inventory(after, limit) }
        }
        fn previous_active_release(&self) -> Result<Option<u64>, RuntimeError> {
            match self { Self::Sqlite(SqliteTx(inner)) => inner.previous_active_release(), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.previous_active_release() }
        }
        fn release_workers(&self, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> {
            match self { Self::Sqlite(SqliteTx(inner)) => inner.release_workers(limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.release_workers(limit) }
        }
    }
    impl ReleaseHistoryTransaction for AnyTx<'_> {
        fn finalize_restorations(&self) -> Result<(), RuntimeError> {
            match self { Self::Sqlite(SqliteTx(inner)) => inner.finalize_restorations(), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.finalize_restorations() }
        }
        fn insert_release_event(&self, event: &Event, items: &[crate::release_history::DormantItem]) -> Result<u64, RuntimeError> {
            match self { Self::Sqlite(SqliteTx(inner)) => inner.insert_release_event(event, items), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => inner.insert_release_event(event, items) }
        }
    }
}

mod timeline {
    use super::*;
    use crate::activation::*;
    impl TimelineWorkReader for AnyStore {
        fn timeline_work_count(&self, table: &str, state: &str) -> Result<u64, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as TimelineWorkReader>::timeline_work_count(inner, table, state), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as TimelineWorkReader>::timeline_work_count(&view, table, state)) } }
    }
}

mod evidence {
    use super::*;
    use crate::revocation::*;
    impl ChangeEvidence for AnyTx<'_> {
        fn change_evidence(&self, after: u64, through: u64, visit: impl FnMut(EvidenceRecord) -> Option<()>) -> Result<Option<()>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as ChangeEvidence>::change_evidence(inner, after, through, visit), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as ChangeEvidence>::change_evidence(inner, after, through, visit) } }
    }
    impl ChangeEvidence for ReadSnapshot<'_> {
        fn change_evidence(&self, after: u64, through: u64, visit: impl FnMut(EvidenceRecord) -> Option<()>) -> Result<Option<()>, RuntimeError> {
            self.tx.change_evidence(after, through, visit)
        }
    }
    impl ChangeEvidence for AnyStore {
        fn change_evidence(&self, after: u64, through: u64, visit: impl FnMut(EvidenceRecord) -> Option<()>) -> Result<Option<()>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as ChangeEvidence>::change_evidence(inner, after, through, visit), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(inner)) => inner.scoped(|view| <std::cell::RefCell<&mut pg::Store> as ChangeEvidence>::change_evidence(&view, after, through, visit)) } }
    }
}

mod inspection {
    use super::*;
    use crate::store_port::AnyInspection;
    use crate::inspection::*;
    impl InspectionCatalog for AnyStore {
        fn active_schema_record(&self) -> InspectionResult<(i64, String)> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as InspectionCatalog>::active_schema_record(inner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_row_count(&self, name: &str, limit: u64) -> InspectionResult<u64> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as InspectionCatalog>::inspection_row_count(inner, name, limit), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_provenance(&self) -> InspectionResult<Option<(i64, String)>> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as InspectionCatalog>::inspection_provenance(inner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_adopted(&self) -> InspectionResult<bool> { match self { Self::Sqlite(SqliteStore(inner)) => <sqlite::Store as InspectionCatalog>::inspection_adopted(inner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    }
    impl InspectionCatalog for AnyTx<'_> {
        fn active_schema_record(&self) -> InspectionResult<(i64, String)> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as InspectionCatalog>::active_schema_record(inner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_row_count(&self, name: &str, limit: u64) -> InspectionResult<u64> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as InspectionCatalog>::inspection_row_count(inner, name, limit), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_provenance(&self) -> InspectionResult<Option<(i64, String)>> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as InspectionCatalog>::inspection_provenance(inner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_adopted(&self) -> InspectionResult<bool> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as InspectionCatalog>::inspection_adopted(inner), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    }
    impl InspectionCatalog for AnyInspection {
        fn active_schema_record(&self) -> InspectionResult<(i64, String)> { match self { Self::Sqlite(inner) => <sqlite::inspect::Inspection as InspectionCatalog>::active_schema_record(inner), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_row_count(&self, name: &str, limit: u64) -> InspectionResult<u64> { match self { Self::Sqlite(inner) => <sqlite::inspect::Inspection as InspectionCatalog>::inspection_row_count(inner, name, limit), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_provenance(&self) -> InspectionResult<Option<(i64, String)>> { match self { Self::Sqlite(inner) => <sqlite::inspect::Inspection as InspectionCatalog>::inspection_provenance(inner), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
        fn inspection_adopted(&self) -> InspectionResult<bool> { match self { Self::Sqlite(inner) => <sqlite::inspect::Inspection as InspectionCatalog>::inspection_adopted(inner), #[cfg(feature = "postgres")] Self::Postgres => Err(("E_STORE_UNSUPPORTED", RuntimeError::StoreUnsupported { family: "inspection" }.to_string())) } }
    }
}

mod reset {
    use super::*;
    use crate::engine::{committer, dev_reset::{DevResetStore, ResetState}};
    impl DevResetStore for AnyStore {
        fn dev_reset( &mut self, pin_clock: impl FnOnce(&committer::MemberTx<'_, '_>) -> Result<i64, RuntimeError>, inventory_assets: impl FnOnce(&committer::MemberTx<'_, '_>) -> Result<Vec<String>, RuntimeError>, prime_schedules: impl FnOnce(&committer::MemberTx<'_, '_>, i64) -> Result<(), RuntimeError>, seed: impl FnOnce(&committer::MemberTx<'_, '_>, u64, i64) -> Result<u64, RuntimeError>, ) -> Result<committer::Resolution<ResetState>, RuntimeError> { match self { Self::Sqlite(SqliteStore(inner)) => DevResetStore::dev_reset(inner, pin_clock, inventory_assets, prime_schedules, seed), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "dev-reset" }) } }
    }
}

mod snapshot_metadatareader {
 use crate::metadata::*;
 use super::*;
      impl MetadataReader for ReadSnapshot<'_> {
        fn store_identity(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::store_identity(&self.tx) }
        fn generation_value(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::generation_value(&self.tx) }
        fn release_value(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::release_value(&self.tx) }
        fn release_native_digest(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::release_native_digest(&self.tx) }
        fn time_audience_clock_value(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::time_audience_clock_value(&self.tx) }
        fn worker_status(&self, worker: Option<&str>) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::worker_status(&self.tx, worker) }
        fn release_revision_value(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::release_revision_value(&self.tx) }
        fn schema_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::schema_marker(&self.tx, marker) }
        fn worker_session_family(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::worker_session_family(&self.tx) }
        fn worker_session_revision(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::worker_session_revision(&self.tx) }
        fn worker_family_revision(&self, family: &str) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::worker_family_revision(&self.tx, family) }
        fn deployment_environment(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::deployment_environment(&self.tx) }
        fn dev_value(&self, key: DevMetadata) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as MetadataReader>::dev_value(&self.tx, key) }
    }
}

mod snapshot_receiptreader {
 use crate::receipts::*;
 use super::*;
      impl ReceiptReader for ReadSnapshot<'_> {
        fn receipt(&self, principal: &str, id: &str) -> Result<Option<ReceiptRecord>, RuntimeError> { <AnyTx<'_> as ReceiptReader>::receipt(&self.tx, principal, id) }
        fn receipt_exists(&self, principal: &str, id: &str) -> Result<bool, RuntimeError> { <AnyTx<'_> as ReceiptReader>::receipt_exists(&self.tx, principal, id) }
        fn sent_sequence( &self, principal: &str, id: &str, through: i64, ) -> Result<Option<i64>, RuntimeError> { <AnyTx<'_> as ReceiptReader>::sent_sequence(&self.tx, principal, id, through) }
    }
}

mod snapshot_activation {
 use super::*;
 use crate::activation::*;
    impl ActivationReader for ReadSnapshot<'_> {
        fn time_audience_clock(&self) -> Result<i64, RuntimeError> { <AnyTx<'_> as ActivationReader>::time_audience_clock(&self.tx) }
        fn opening_marker(&self, marker: crate::metadata::SchemaMarker) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as ActivationReader>::opening_marker(&self.tx, marker) }
        fn opening_backend(&self) -> Result<Backend, RuntimeError> { <AnyTx<'_> as ActivationReader>::opening_backend(&self.tx) }
        fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError> { <AnyTx<'_> as ActivationReader>::check_selected_release(&self.tx, expected) }
        fn previous_schema(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as ActivationReader>::previous_schema(&self.tx) }
        fn live_sum_marker(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as ActivationReader>::live_sum_marker(&self.tx) }
        fn activation_population(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as ActivationReader>::activation_population(&self.tx) }
        fn narrowed_retained(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as ActivationReader>::narrowed_retained(&self.tx) }
        fn narrowed_restored(&self) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as ActivationReader>::narrowed_restored(&self.tx) }
        fn restored_population( &self, kind: RestoredPopulation, path: &str, ) -> Result<Option<String>, RuntimeError> { <AnyTx<'_> as ActivationReader>::restored_population(&self.tx, kind, path) }
        fn activation_inventory(&self) -> Result<Vec<DormantItem>, RuntimeError> { <AnyTx<'_> as ActivationReader>::activation_inventory(&self.tx) }
        fn table_populated(&self, table: &str) -> Result<bool, RuntimeError> { <AnyTx<'_> as ActivationReader>::table_populated(&self.tx, table) }
        fn any_table_image( &self, table: &str, survives: impl FnMut(&Value) -> bool, ) -> Result<bool, RuntimeError> { <AnyTx<'_> as ActivationReader>::any_table_image(&self.tx, table, survives) }
        fn timeline_rebuild_exists(&self, table: &str, id: &str) -> Result<bool, RuntimeError> { <AnyTx<'_> as ActivationReader>::timeline_rebuild_exists(&self.tx, table, id) }
    }
}

mod placement {
    use super::*;
    use crate::assets::{AssetPlacementReader, IntentRecord};
    impl AssetPlacementReader for AnyTx<'_> {
        fn placement_record(&self, owner: &str, id: &str) -> Result<Option<IntentRecord>, RuntimeError> { match self { Self::Sqlite(SqliteTx(inner)) => <sqlite::Tx<'_> as AssetPlacementReader>::placement_record(inner, owner, id), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(inner)) => <pg::Tx<'_> as AssetPlacementReader>::placement_record(inner, owner, id) } }
    }
}
