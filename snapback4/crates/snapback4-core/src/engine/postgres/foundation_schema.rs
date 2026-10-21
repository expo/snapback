//! Foundation families use the shared exact shape verifier.
// @ref LLP 3000.009.001.000#9.1 — one relation and key policy across foundation and release ledgers.
use super::{shape, store::Tx};
use crate::RuntimeError;

pub(super) fn verify(
    tx: &Tx<'_>,
    table: &str,
    columns: &[shape::Column],
    primary: &[&str],
) -> Result<(), RuntimeError> {
    shape::verify(tx, table, columns, primary, "SNAPBACK_FOUNDATION_SCHEMA")
}
