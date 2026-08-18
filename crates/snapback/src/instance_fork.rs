//! Non-promotable, same-app derived deployment forks.
//!
//! The parent is a compatibility facade: owner-aligned submodules are
//! re-exported so existing `crate::instance_fork::*` callers remain unchanged.
//!
//! The measured carve map attributed child-process supervision to this file,
//! but the production `Command`/spawn/readiness/kill loop lives in
//! `cli/fork.rs`. The server-aware code found here was confined to the inline
//! test module; it remains a test sibling because it exercises private fork
//! hooks.

pub use snapback_services::instance_fork::{
    ADMISSION_TIMEOUT_CODE, APP_BINDING_INTENT_FILE, APP_BINDING_MISMATCH_CODE,
    APP_BINDING_RECEIPT_FILE, APP_BINDING_REQUIRED_CODE, APP_ROOT_IDENTITY_FILE,
    ASSET_CUT_INCOMPLETE_CODE, ASSET_CUT_UNSUPPORTED_CODE, BASE_RECEIPT_FILE,
    BASE_SNAPSHOT_FILE, DIFF_ORACLE_MISMATCH_CODE, ExpectedForkAppV1,
    FORK_CREATION_ADMISSION_TIMEOUT_MS, FORK_DIFF_MAX_BYTES, FORK_DIFF_MAX_ROWS,
    ForkAppBindingReceiptV1, ForkBaseReceiptV1, ForkCleanupLock, ForkCreationAdmission,
    ForkDiffCommitBoundaryV1, ForkDiffReceiptV3, ForkDiffRowV1, ForkNetDiffReceiptV3,
    ForkNetDiffRowV1, ForkNetDiffWriterCoverageV1, ForkReapReceiptV1, ForkRegistryEntryV1,
    ForkRenewReceiptV1, ForkResourceLimits, ForkResourceUsageV1, MANAGED_FORK_MAX_COUNT,
    MANAGED_FORK_MAX_FORK_BYTES, MANAGED_FORK_MAX_LIFETIME_MS, MANAGED_FORK_MAX_TOTAL_BYTES,
    ManagedForkTargetV1, NET_DIFF_UNAVAILABLE_CODE, PublicationCut, REGISTRY_DIRECTORY,
    RENEW_EXPIRED_CODE, RENEW_INTENT_FILE, RENEW_RECEIPT_FILE, RESOURCE_LIMIT_REFUSED_CODE,
    RenewCut, WRITER_COVERAGE_INVALID_CODE, admit_creation, arm_derived_fork_app_row_coverage,
    audit_connection, clear_stale_registry_entry, clear_stale_registry_entry_locked,
    diff_receipt, diff_receipt_bounded, drop_managed, drop_managed_locked, enforce_creation_limits,
    ensure_expected_app, expired_managed, list_managed, load_expected_app, lock_cleanup,
    managed_entry, managed_registry_ids, managed_target, net_diff_receipt, publish,
    publish_managed, publish_managed_with_base, recover, recover_bound, record_managed_runtime,
    refreshed_lineage, renew_managed, renew_managed_with_crash_cut_for_test,
    resource_limit_refusal, scrub_and_mint, verified_derived_fork_app_row_coverage,
};
pub use snapback_kernel::instance_fork::{
    CustodyDisposition, CustodyRule, DerivedForkRuntimeExt, ForkMintReceiptV1, MINT_RECEIPT_FILE,
    SERVER_EXPIRED_CODE, SIDECAR_CUSTODY, STAGING_SENTINEL, TABLE_CUSTODY, inspect_boot,
    inspect_boot_at, server_expired_error,
};
pub use snapback_types::instance_fork::contract;
pub use snapback_types::instance_fork::*;
pub(crate) use snapback_services::instance_fork::{
    arm_open_derived_fork_app_row_coverage, directory_tree_bytes,
};

// The fork suite reaches engine/server composition and therefore remains in
// the rank-7 remainder while the production service moves to rank 3.
#[cfg(test)]
#[path = "../../snapback-services/src/instance_fork/service.rs"]
mod remainder_service_tests;
