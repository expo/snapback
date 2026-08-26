//! Exact fixed protected writers.

mod password_session;

#[cfg(test)]
mod attacks;

pub(super) use password_session::insert_password_session;

#[cfg(test)]
pub(super) use attacks::{
    execute_cached_session_insert, prime_cached_session_insert, stale_generation_session_insert,
    transaction_control_sql, unscoped_session_insert,
};
