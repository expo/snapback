//! Fixed password-session issuance SQL.
#![allow(unexpected_cfgs)]

use super::super::evidence::{DerivedPasswordSession, ProtectedTx};
use super::super::*;

#[allow(unexpected_cfgs)]
#[cfg(not(snapback_authority_mutation_schema_conflict_replace))]
pub(in super::super) const PASSWORD_SESSION_INSERT_SQL: &str =
    "INSERT OR ABORT INTO _auth_sessions(
         id, user_id, assurance_generation
     ) VALUES(?1, ?2, ?3)";

#[allow(unexpected_cfgs)]
#[cfg(snapback_authority_mutation_schema_conflict_replace)]
pub(in super::super) const PASSWORD_SESSION_INSERT_SQL: &str = "INSERT INTO _auth_sessions(
         id, user_id, assurance_generation
     ) VALUES(?1, ?2, ?3)";

pub(in super::super) fn insert_password_session(
    transaction: &mut ProtectedTx<'_>,
    derived: &DerivedPasswordSession,
) -> AuthorityTransitionResult<usize> {
    transaction.insert_password_session(derived)
}
