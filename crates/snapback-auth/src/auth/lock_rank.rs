//! Shared authentication lock-rank enforcement.

use std::ops::{Deref, DerefMut};
use std::sync::{Mutex, MutexGuard};

std::thread_local! {
    static HELD_AUTH_LOCK_RANKS: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

pub const AUTH_LOCK_RANK_TOPOLOGY: u8 = 10;
pub const AUTH_LOCK_RANK_STREAM: u8 = 20;
pub const AUTH_LOCK_RANK_SESSION: u8 = 30;
// @ref LLP 0059#locking-and-linearization — the independent mode cut is the
// final lock in a composed publication; registry and mode ranks make that
// cross-module order executable in every debug/test build.
pub use crate::exec_guard::AUTH_LOCK_RANK_CONNECTION_REGISTRY;
pub const AUTH_LOCK_RANK_MODE_ADMISSION: u8 = 50;

pub struct AuthLockRankGuard(u8);

impl AuthLockRankGuard {
    pub fn enter(rank: u8) -> Self {
        crate::exec_guard::debug_assert_auth_lock_outside_local_snapback(rank);
        HELD_AUTH_LOCK_RANKS.with(|held| {
            let mut held = held.borrow_mut();
            if cfg!(debug_assertions) {
                assert!(
                    held.last().is_none_or(|current| *current <= rank),
                    "auth lock-rank inversion: attempted rank {rank} while holding {:?}",
                    held.last(),
                );
            }
            held.push(rank);
        });
        Self(rank)
    }
}

impl Drop for AuthLockRankGuard {
    fn drop(&mut self) {
        HELD_AUTH_LOCK_RANKS.with(|held| {
            let popped = held.borrow_mut().pop();
            debug_assert_eq!(
                popped,
                Some(self.0),
                "auth lock-rank guards dropped out of order"
            );
        });
    }
}

pub struct RankedMutexGuard<'a, T> {
    guard: MutexGuard<'a, T>,
    _rank: AuthLockRankGuard,
}

impl<T> Deref for RankedMutexGuard<'_, T> {
    type Target = T;
    fn deref(&self) -> &Self::Target {
        &self.guard
    }
}

impl<T> DerefMut for RankedMutexGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.guard
    }
}

pub fn ranked_mutex_lock<'a, T>(
    mutex: &'a Mutex<T>,
    rank: u8,
) -> Result<RankedMutexGuard<'a, T>, std::sync::PoisonError<MutexGuard<'a, T>>> {
    let rank_guard = AuthLockRankGuard::enter(rank);
    let guard = mutex.lock()?;
    Ok(RankedMutexGuard {
        guard,
        _rank: rank_guard,
    })
}

pub fn ranked_mutex_lock_unpoisoned<T>(mutex: &Mutex<T>, rank: u8) -> RankedMutexGuard<'_, T> {
    let rank_guard = AuthLockRankGuard::enter(rank);
    let guard = mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    RankedMutexGuard {
        guard,
        _rank: rank_guard,
    }
}
