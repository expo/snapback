pub fn leak() -> rusqlite::Connection {
    panic!("scanner corpus is not executed")
}

pub type Handle = rusqlite::Connection;

pub fn leak_alias() -> Handle {
    panic!("scanner corpus is not executed")
}

pub struct Wrap {
    pub conn: rusqlite::Connection,
}

pub trait LeakingTrait {
    fn conn(&self) -> rusqlite::Connection;
}

pub struct Associated;

impl Associated {
    pub const LEAK: Option<fn() -> rusqlite::Connection> = None;
}

use rusqlite::Connection as ImportedHandle;

pub fn leak_renamed_import() -> ImportedHandle {
    panic!("scanner corpus is not executed")
}

mod hidden {
    pub fn leak() -> rusqlite::Connection {
        panic!("scanner corpus is not executed")
    }
}

pub use hidden::leak as hidden_leak;
pub use hidden_leak as leak_private_reexport;

pub struct AsRefWrapper;

impl AsRef<rusqlite::Connection> for AsRefWrapper {
    fn as_ref(&self) -> &rusqlite::Connection {
        panic!("scanner corpus is not executed")
    }
}

#[cfg(all(feature = "remainder-tests", not(feature = "services-owner")))]
pub use rusqlite as no_default_rusqlite;

pub enum MembershipWriter {
    User(String),
    Admin,
}

fn kernel_verified_membership_writer(_writer: &MembershipWriter) -> bool {
    false
}

fn sanctioned(_writer: &MembershipWriter) {}

pub fn plan_privileged_membership_insert(writer: &MembershipWriter) {
    if !kernel_verified_membership_writer(writer) {
        sanctioned(writer);
    }
}

pub struct KernelCommitAuthority {
    _private: (),
}

macro_rules! generated_privilege_api {
    () => {
        pub fn macro_generated_leak() -> KernelCommitAuthority {
            panic!("scanner corpus is not executed")
        }
    };
}

generated_privilege_api!();

include!(concat!(env!("OUT_DIR"), "/generated_privilege_api.rs"));

pub struct AuthorizationCommitReservation {
    _private: (),
}

pub struct LockedScope {
    active: bool,
}

impl LockedScope {
    pub fn take(self) -> AuthorizationCommitReservation {
        panic!("scanner corpus is not executed")
    }
}

pub struct ObtainableScope;

impl ObtainableScope {
    pub fn new() -> Self {
        Self
    }

    pub fn take(self) -> AuthorizationCommitReservation {
        panic!("scanner corpus is not executed")
    }
}
