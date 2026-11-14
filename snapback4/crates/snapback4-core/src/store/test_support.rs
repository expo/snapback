//! Raw fixture and corruption access, compiled only with the dev-dependency `test-support` feature.
use super::{Store, Tx};
use crate::RuntimeError;
use rusqlite::Connection;

impl Store {
    /// Cargo can unify evaluator features into consumer test builds.
    /// Report the core's compiled policy rather than the caller's features.
    pub const TEST_SUPPORT_EVALUATION_ENABLED: bool = cfg!(feature = "evaluation-support");
}

macro_rules! fixture_access {
    ($handle:ty) => {
        impl $handle {
            /// Intended caller: consumer debug test fixtures.
            ///
            /// Do not set the lock wait through this connection: `busy_timeout()`
            /// or `PRAGMA busy_timeout = N` replaces the store's busy handler, so
            /// program deadlines and `set_busy_timeout` silently stop applying.
            /// Use `set_busy_timeout`. `PRAGMA busy_timeout` reads 0 here; read
            /// the policy with `test_support_busy_timeout`.
            pub fn test_support_conn(&self) -> &Connection {
                self.conn()
            }
            /// Intended caller: consumer debug test fixtures.
            pub fn test_support_meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
                self.meta(key)
            }
            /// Intended caller: consumer debug test fixtures.
            pub fn test_support_set_meta(
                &self,
                key: &str,
                value: &str,
            ) -> Result<(), RuntimeError> {
                self.set_meta(key, value)
            }
        }
    };
}
fixture_access!(Store);
fixture_access!(Tx<'_>);
impl Store {
    /// Intended caller: consumer debug test fixtures that install SQLite callbacks.
    ///
    /// A fixture's own busy handler (or `busy_timeout`) replaces the store's
    /// for this connection: program deadlines and `set_busy_timeout` stop
    /// applying until the store is reopened. A replaced or removed progress
    /// handler is tolerated: lending the connection marks it unknown, and the
    /// next deadline-bound transaction installs the store's handler again,
    /// replacing the fixture's.
    pub fn test_support_conn_mut(&mut self) -> &mut Connection {
        self.handlers.forget_progress();
        &mut self.conn
    }
    /// The connection's ordinary lock wait. `PRAGMA busy_timeout` reads 0
    /// while the store's own busy handler is installed.
    pub fn test_support_busy_timeout(&self) -> std::time::Duration {
        self.handlers.timeout()
    }
    /// Count physical writes, including WITHOUT ROWID tables and REPLACE.
    /// Unlike foreign triggers, this observer adds no managed-schema object.
    /// Errors reading hook values count as writes, so assertions fail closed.
    pub fn test_support_write_count(
        &mut self, table: &str, columns: Vec<(i32, rusqlite::types::Value)>, actions: &[&str],
    ) -> std::sync::Arc<std::sync::atomic::AtomicUsize> {
        use rusqlite::hooks::PreUpdateCase;
        use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
        let count = Arc::new(AtomicUsize::new(0));
        let seen = count.clone();
        let table = table.to_owned();
        let actions: Vec<String> = actions.iter().map(|s| s.to_string()).collect();
        self.conn.preupdate_hook(Some(move |_, _: &str, relation: &str, change: &PreUpdateCase| {
            if relation != table { return; }
            let (action, matched) = match change {
                PreUpdateCase::Insert(new) => ("insert", columns.iter().all(|(i,v)| new.get_new_column_value(*i).map_or(true, |value| value == rusqlite::types::ValueRef::from(v)))),
                PreUpdateCase::Delete(old) => ("delete", columns.iter().all(|(i,v)| old.get_old_column_value(*i).map_or(true, |value| value == rusqlite::types::ValueRef::from(v)))),
                PreUpdateCase::Update { old_value_accessor: old, new_value_accessor: new } => ("update",
                    columns.iter().all(|(i,v)| old.get_old_column_value(*i).map_or(true, |value| value == rusqlite::types::ValueRef::from(v))) ||
                    columns.iter().all(|(i,v)| new.get_new_column_value(*i).map_or(true, |value| value == rusqlite::types::ValueRef::from(v)))),
                _ => ("unknown", true),
            };
            if matched && (action == "unknown" || actions.iter().any(|a| a == action)) { seen.fetch_add(1, Ordering::SeqCst); }
        })).expect("install test-only preupdate observer");
        count
    }
}

#[cfg(test)]
mod observer_tests {
    use super::*;
    #[test]
    fn records_noop_updates_and_replacements_on_without_rowid_tables() {
        let mut store = Store::memory().unwrap();
        store.test_support_conn().execute_batch("CREATE TABLE watched(id TEXT PRIMARY KEY, n INT) WITHOUT ROWID; INSERT INTO watched VALUES('a',1);").unwrap();
        let writes = store.test_support_write_count("watched", vec![(0, "a".to_string().into())], &["insert", "update", "delete"]);
        store.test_support_conn().execute_batch("UPDATE watched SET n=n WHERE id='a'; INSERT OR REPLACE INTO watched VALUES('a',1); INSERT INTO watched VALUES('b',2);").unwrap();
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 3, "no-op update plus replacement delete/insert; other key excluded");
    }
}
