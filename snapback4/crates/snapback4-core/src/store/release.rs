//! Release checks at the activation transaction's snapshot.
// @ref LLP 3000.000.000#5-hot-activation-and-ownership — retain the selected-release check before the revision check.
use crate::{
    RuntimeError,
    engine::release::{ReleaseActivation, ReleaseTransaction},
};
use rusqlite::{Connection, OptionalExtension};

/// Borrowed before activation constructs its row-access transaction.
pub(crate) struct ReleaseCheck<'a>(pub(super) &'a Connection);

impl ReleaseCheck<'_> {
    pub(crate) fn check_release_activation(
        &self,
        options: &ReleaseActivation,
    ) -> Result<(), RuntimeError> {
        options.check(self)
    }
}

impl ReleaseTransaction for ReleaseCheck<'_> {
    fn selected_release(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .0
            .query_row("SELECT value FROM _meta WHERE key='release'", [], |r| {
                r.get(0)
            })
            .optional()?)
    }
    fn release_revision(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .0
            .query_row(
                "SELECT value FROM _meta WHERE key='release_revision'",
                [],
                |r| r.get(0),
            )
            .optional()?)
    }
}

impl ReleaseTransaction for super::Tx<'_> {
    fn selected_release(&self) -> Result<Option<String>, RuntimeError> { self.meta("release") }
    fn release_revision(&self) -> Result<Option<String>, RuntimeError> { self.meta("release_revision") }
}
