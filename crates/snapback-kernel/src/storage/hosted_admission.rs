//! Storage-owned installation of a verified hosted admission.
//!
//! @ref LLP 0098#43-ordering — the durable half of admission verification. The
//! SQLite connection stays inside the storage authority; the adapter hands over
//! a pre-bind-verified envelope and receives a serving authority or a coded
//! refusal.

use super::LocalDatabase;
use crate::auth::hosted_edge::{HostedAdmissionCommit, install_hosted_admission_commit};
use crate::diagnostic::SnapbackResult;

impl LocalDatabase {
    /// Apply the durable monotonicity clause and produce the serving authority.
    ///
    /// This is the only place a replayed older snapshot can be refused, because
    /// the high-water mark it is compared against is durable.
    pub fn install_hosted_admission(
        &mut self,
        commit: HostedAdmissionCommit,
    ) -> SnapbackResult<()> {
        install_hosted_admission_commit(&mut self.conn, commit)
    }
}
