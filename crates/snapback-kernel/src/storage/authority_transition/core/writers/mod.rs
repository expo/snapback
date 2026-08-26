//! Reserved custody boundary for Landing C's composite protected writers.
//!
//! Landing A intentionally moves no existing SQL here. These exact
//! discriminant witnesses keep the one-purpose/one-mutation/writer registry
//! closed without creating a callable writer.

use super::AuthorityMutation;

mod administrator;
mod bearer;
mod delivery;
mod internal_work;
mod password;
mod recovery;
mod step_up;

pub(super) fn contains(mutation: &AuthorityMutation) -> bool {
    bearer::matches(mutation)
        || password::matches(mutation)
        || recovery::matches(mutation)
        || delivery::matches(mutation)
        || step_up::matches(mutation)
        || administrator::matches(mutation)
        || internal_work::matches(mutation)
}
