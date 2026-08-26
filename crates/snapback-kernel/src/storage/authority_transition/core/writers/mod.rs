//! Exact fixed protected writers.
#![allow(unexpected_cfgs)]

mod password_session;

#[cfg(test)]
mod attacks;

pub(super) use password_session::{PASSWORD_SESSION_INSERT_SQL, insert_password_session};

#[cfg(test)]
pub(super) use attacks::{
    execute_cached_session_insert, prime_cached_session_insert, stale_generation_session_insert,
    transaction_control_sql, unscoped_session_insert,
};

#[allow(unexpected_cfgs)]
#[cfg(all(
    snapback_authority_compile_fail,
    not(snapback_authority_mutation_expose_initialized_limbs)
))]
mod compile_fail {
    use super::super::ScopePhase;
    use super::super::evidence::ProtectedTx;

    include!("../compile_fail/writer_replace_authorizer.rs");
    include!("../compile_fail/writer_mutate_authorizer_state.rs");
}
