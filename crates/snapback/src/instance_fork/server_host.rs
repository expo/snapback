//! In-crate adapter for host-owned admin, resume, and configuration sidecars.
//!
//! This is deliberately not child-process supervision; that production loop
//! already belongs to the CLI adapter in `cli/fork.rs`.

use super::contract::{DerivedForkLineageV1, DerivedForkRuntime, ForkAppRowCoverageReceiptV1};
use super::fork_host::ForkHost;
use super::service::{
    self, ExpectedForkAppV1, ForkDiffReceiptV3, ForkMintReceiptV1, ForkNetDiffReceiptV3,
    ForkRegistryEntryV1, ForkRenewReceiptV1, ManagedForkTargetV1, PublicationCut, RenewCut,
};
use crate::diagnostic::SnapbackResult;
use std::path::{Path, PathBuf};

pub(super) struct ServerForkHost;

impl ForkHost for ServerForkHost {
    type ResumeKeyringGuard = crate::rqs::ResumeKeyring;

    fn admin_token_sibling(&self, database_path: &Path) -> PathBuf {
        crate::admin::admin_token_sibling(database_path)
    }

    fn mint_admin_token(&self) -> String {
        crate::admin::mint_admin_token()
    }

    fn mint_resume_keyring(&self, path: PathBuf, now_ms: u64) -> Self::ResumeKeyringGuard {
        crate::rqs::ResumeKeyring::load_or_create(path, now_ms)
    }

    fn resume_keyring_has_active_key(&self, path: &Path) -> bool {
        crate::rqs::ResumeKeyring::persisted_file_has_active_key(path)
    }

    fn config_sidecar(&self, database_path: &Path) -> PathBuf {
        crate::config::ConfigStore::path_for_database(database_path)
    }
}

pub fn scrub_and_mint(
    database_path: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
) -> SnapbackResult<ForkMintReceiptV1> {
    service::scrub_and_mint_with_host(
        &ServerForkHost,
        database_path,
        app_id,
        parent_instance_id,
        now_ms,
    )
}

pub fn inspect_boot(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    service::inspect_boot_with_host(&ServerForkHost, database_path)
}

pub fn inspect_boot_at(
    database_path: &Path,
    now_ms: u64,
) -> SnapbackResult<Option<DerivedForkRuntime>> {
    service::inspect_boot_at_with_host(&ServerForkHost, database_path, now_ms)
}

pub fn publish(
    source_database: &Path,
    destination: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
    cut_at: Option<PublicationCut>,
) -> SnapbackResult<ForkMintReceiptV1> {
    service::publish_with_host(
        &ServerForkHost,
        source_database,
        destination,
        app_id,
        parent_instance_id,
        now_ms,
        cut_at,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn publish_managed(
    source_database: &Path,
    destination: &Path,
    expected: &ExpectedForkAppV1,
    parent_instance_id: &str,
    now_ms: u64,
    expires_at_ms: u64,
    with_secrets: bool,
) -> SnapbackResult<ForkMintReceiptV1> {
    service::publish_managed_with_host(
        &ServerForkHost,
        source_database,
        destination,
        expected,
        parent_instance_id,
        now_ms,
        expires_at_ms,
        with_secrets,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn publish_managed_with_base(
    source_database: &Path,
    destination: &Path,
    expected: &ExpectedForkAppV1,
    parent_instance_id: &str,
    now_ms: u64,
    expires_at_ms: u64,
    with_secrets: bool,
    retain_base: bool,
) -> SnapbackResult<ForkMintReceiptV1> {
    service::publish_managed_with_base_and_host(
        &ServerForkHost,
        source_database,
        destination,
        expected,
        parent_instance_id,
        now_ms,
        expires_at_ms,
        with_secrets,
        retain_base,
    )
}

pub fn record_managed_runtime(
    fork_root: &Path,
    fork_id: &str,
    ready_file: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    service::record_managed_runtime_with_host(
        &ServerForkHost,
        fork_root,
        fork_id,
        ready_file,
        expected,
    )
}

pub fn list_managed(
    fork_root: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<Vec<ForkRegistryEntryV1>> {
    service::list_managed_with_host(&ServerForkHost, fork_root, expected)
}

pub fn managed_entry(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    service::managed_entry_with_host(&ServerForkHost, fork_root, fork_id, expected)
}

pub fn managed_target(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ManagedForkTargetV1> {
    service::managed_target_with_host(&ServerForkHost, fork_root, fork_id, expected)
}

pub fn drop_managed(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    service::drop_managed_with_host(&ServerForkHost, fork_root, fork_id, expected)
}

pub fn drop_managed_locked(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    service::drop_managed_locked_with_host(&ServerForkHost, fork_root, fork_id, expected)
}

pub fn renew_managed(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
    now_ms: u64,
    ttl_ms: u64,
) -> SnapbackResult<ForkRenewReceiptV1> {
    service::renew_managed_with_host(
        &ServerForkHost,
        fork_root,
        fork_id,
        expected,
        now_ms,
        ttl_ms,
    )
}

#[doc(hidden)]
pub fn renew_managed_with_crash_cut_for_test(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
    now_ms: u64,
    ttl_ms: u64,
    cut: RenewCut,
) -> SnapbackResult<ForkRenewReceiptV1> {
    service::renew_managed_with_crash_cut_for_test_and_host(
        &ServerForkHost,
        fork_root,
        fork_id,
        expected,
        now_ms,
        ttl_ms,
        cut,
    )
}

pub fn refreshed_lineage(database_path: &Path) -> SnapbackResult<Option<DerivedForkLineageV1>> {
    service::refreshed_lineage_with_host(&ServerForkHost, database_path)
}

pub fn expired_managed(
    fork_root: &Path,
    expected: &ExpectedForkAppV1,
    now_ms: u64,
) -> SnapbackResult<Vec<ForkRegistryEntryV1>> {
    service::expired_managed_with_host(&ServerForkHost, fork_root, expected, now_ms)
}

pub fn diff_receipt(database_path: &Path) -> SnapbackResult<ForkDiffReceiptV3> {
    service::diff_receipt_with_host(&ServerForkHost, database_path)
}

pub fn diff_receipt_bounded(
    database_path: &Path,
    max_rows: u64,
) -> SnapbackResult<ForkDiffReceiptV3> {
    service::diff_receipt_bounded_with_host(&ServerForkHost, database_path, max_rows)
}

pub fn verified_derived_fork_app_row_coverage(
    database_path: &Path,
) -> SnapbackResult<Option<ForkAppRowCoverageReceiptV1>> {
    service::verified_derived_fork_app_row_coverage_with_host(&ServerForkHost, database_path)
}

pub fn net_diff_receipt(
    database_path: &Path,
    max_rows: u64,
) -> SnapbackResult<ForkNetDiffReceiptV3> {
    service::net_diff_receipt_with_host(&ServerForkHost, database_path, max_rows)
}

pub fn recover_bound(
    parent: &Path,
    destination: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<()> {
    service::recover_bound_with_host(&ServerForkHost, parent, destination, expected)
}

#[doc(hidden)]
pub fn recover(parent: &Path, destination: &Path) -> SnapbackResult<()> {
    service::recover_with_host(&ServerForkHost, parent, destination)
}
