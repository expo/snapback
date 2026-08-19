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

mod hidden_struct {
    pub struct ReexportedStructLeak {
        pub conn: rusqlite::Connection,
    }
}

pub use hidden_struct::ReexportedStructLeak;

mod hidden_glob {
    pub fn glob_leak() -> rusqlite::Connection {
        panic!("scanner corpus is not executed")
    }
}

pub use hidden_glob::*;

mod hidden_crate_path {
    pub fn crate_path_fn_leak() -> rusqlite::Connection {
        panic!("scanner corpus is not executed")
    }
}

pub use crate::hidden_crate_path::crate_path_fn_leak;

mod hidden_super_path {
    pub fn super_path_fn_leak() -> rusqlite::Connection {
        panic!("scanner corpus is not executed")
    }

    pub mod child {
        pub use super::super_path_fn_leak;
    }
}

pub use hidden_super_path::child::super_path_fn_leak;

#[cfg(not(unix))]
pub fn non_unix_leak() -> rusqlite::Connection {
    panic!("scanner corpus is not executed")
}

pub struct AsRefWrapper;

impl AsRef<rusqlite::Connection> for AsRefWrapper {
    fn as_ref(&self) -> &rusqlite::Connection {
        panic!("scanner corpus is not executed")
    }
}

pub struct FromWrapper;

impl From<FromWrapper> for rusqlite::Connection {
    fn from(_value: FromWrapper) -> Self {
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

fn commit_membership_plan() {}

fn is_privileged_noninvocation() {}

fn membership_write_provenance() {}

fn write_membership_creation_provenance() {}

pub enum ChangeOp {
    Insert,
    Update,
    Delete,
}

fn record_membership_transition(_op: ChangeOp, _writer: &MembershipWriter) {}

fn provenance() {}

pub fn plan_privileged_membership_insert(writer: &MembershipWriter) {
    if !kernel_verified_membership_writer(writer) {
        sanctioned(writer);
    }
}

pub fn plan_membership_insert(_writer: &MembershipWriter) {}

pub fn plan_membership_set_role(_writer: &MembershipWriter) {}

pub fn plan_membership_remove(_writer: &MembershipWriter) {}

pub fn plan_membership_remove_principal(_writer: &MembershipWriter) {}

pub fn plan_membership_transfer_owner(_writer: &MembershipWriter) {}

pub fn plan_membership_patch(_writer: &MembershipWriter) {}

pub fn plan_membership_bootstrap(_writer: &MembershipWriter) {}

pub fn plan_membership_teardown(_writer: &MembershipWriter) {}

pub fn plan_membership_sweep_expired(_writer: &MembershipWriter) {}

pub struct AuthorizedMembershipPlan;

impl AuthorizedMembershipPlan {
    pub fn user_transition(_writer: MembershipWriter) -> Self {
        Self
    }
}

pub struct KernelCommitAuthority {
    _private: (),
}

pub struct Db;

impl Db {
    pub fn authority(&self) -> KernelCommitAuthority {
        panic!("scanner corpus is not executed")
    }
}

pub struct ServiceAuthorityTerminalFactory {
    _private: (),
}

pub struct PreparedServiceAuthorityTerminal {
    _private: (),
}

impl KernelCommitAuthority {
    pub fn service_authority_terminal_factory(&self) -> ServiceAuthorityTerminalFactory {
        panic!("scanner corpus is not executed")
    }
}

impl ServiceAuthorityTerminalFactory {
    pub fn prepared(&self) -> PreparedServiceAuthorityTerminal {
        panic!("scanner corpus is not executed")
    }
}

pub struct AuthorizationCommitCarrierFactory {
    _private: (),
}

impl KernelCommitAuthority {
    pub fn authorization_commit_carriers(&self) -> AuthorizationCommitCarrierFactory {
        panic!("scanner corpus is not executed")
    }
}

impl AuthorizationCommitCarrierFactory {
    pub fn reservation(&self) -> AuthorizationCommitReservation {
        panic!("scanner corpus is not executed")
    }
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
