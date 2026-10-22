//! Store ownership stays behind the enum boundary.
// @ref LLP 3000.009.001.000#3.4 — the host binds an acquired token before listening.
pub use crate::engine::postgres::ownership::{LeaseAcquisition, LeasePolicy, StoreLease};
use crate::{RuntimeError, store_port::AnyStore};
impl AnyStore {
    pub fn open_postgres_owned(
        connection: &str,
        namespace: &str,
        lease: &StoreLease,
    ) -> Result<Self, RuntimeError> {
        crate::engine::postgres::Handle::open_owned(connection, namespace, lease)
            .map(Self::from_postgres)
    }
}
