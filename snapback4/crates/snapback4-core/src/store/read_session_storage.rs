//! Only storage availability is shared with readers, never authority facts.
// @ref LLP 3000.009.001.000.001#32-one-statement-fetches-a-guest-sessions-authority-facts — optional storage is attached once and lazy installation is published after commit.
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};
use crate::RuntimeError;

pub(super) struct ReadSessionStorage(RwLock<bool>);
impl ReadSessionStorage {
    pub fn new(present: bool) -> Self { Self(RwLock::new(present)) }
    pub fn snapshot(&self) -> Result<RwLockReadGuard<'_, bool>, RuntimeError> {
        self.0.read().map_err(|_| RuntimeError::Store("read-session storage lock poisoned".into()))
    }
    pub fn install(&self) -> Result<RwLockWriteGuard<'_, bool>, RuntimeError> {
        self.0.write().map_err(|_| RuntimeError::Store("read-session storage lock poisoned".into()))
    }
    pub fn present(&self) -> bool { *self.0.read().expect("read-session storage lock poisoned") }
    pub fn publish(&self, value: bool) { *self.0.write().expect("read-session storage lock poisoned") = value; }
}
