//! Storage-owned installation of a verified hosted admission.
//!
//! @ref LLP 0098#43-ordering — the durable half of admission verification. The
//! SQLite connection stays inside the storage authority; the adapter hands over
//! a pre-bind-verified envelope and receives a serving authority or a coded
//! refusal.

use super::LocalDatabase;
use crate::auth::deployment::HostedServingAuthority;
use crate::auth::hosted_edge::{
    AdmissionRenewalInputs, VerifiedHostedAdmission, install_verified_admission,
    verify_renewal_candidate,
};
use crate::diagnostic::SnapbackResult;

impl LocalDatabase {
    /// Apply the durable monotonicity clause and produce the serving authority.
    ///
    /// This is the only place a replayed older snapshot can be refused, because
    /// the high-water mark it is compared against is durable.
    pub(crate) fn install_hosted_admission(
        &mut self,
        verified: &VerifiedHostedAdmission,
        now_ms: u64,
    ) -> SnapbackResult<HostedServingAuthority> {
        install_verified_admission(verified, now_ms, &mut self.conn)
    }

    /// Verify and install the successor covering `now`, if the chain has one.
    ///
    /// Returns the installed authority, or `None` when the incumbent is still
    /// current. A chain that no longer covers the clock yields the ordinary
    /// coded refusal and the incumbent is left to expire — renewal can never
    /// extend a snapshot, only replace it with another verified one.
    pub(crate) fn renew_hosted_admission(
        &mut self,
        inputs: &AdmissionRenewalInputs,
        installed_issued_at_ms: u64,
        now_ms: u64,
    ) -> SnapbackResult<Option<(HostedServingAuthority, u64)>> {
        let Some(verified) = verify_renewal_candidate(inputs, installed_issued_at_ms, now_ms)?
        else {
            return Ok(None);
        };
        let issued_at_ms = verified.issued_at_ms();
        let authority = install_verified_admission(&verified, now_ms, &mut self.conn)?;
        Ok(Some((authority, issued_at_ms)))
    }
}
