//! Raw fixture and corruption access, compiled only with the dev-dependency `test-support` feature.
use super::{Store, Tx};
use crate::RuntimeError;
use rusqlite::Connection;

macro_rules! fixture_access {
    ($handle:ty) => {
        impl $handle {
            pub fn test_support_conn(&self) -> &Connection { self.conn() }
            pub fn test_support_meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { self.meta(key) }
            pub fn test_support_set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> { self.set_meta(key, value) }
        }
    };
}
fixture_access!(Store);
fixture_access!(Tx<'_>);
