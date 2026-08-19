//! Snapback command-line adapters and process lifecycle ownership.
//!
//! This crate owns the Clap surface, guide command, MCP stdio transport,
//! lifecycle commands, and production child-process supervision.

#![allow(clippy::result_large_err)]

pub(crate) use snapback_kernel::{
    fork_promotion, instance_lock, migration, migration_presentation, operation_detail,
};
pub(crate) use snapback_server::{
    admin, admin_agent_destroy, admin_impersonation, admin_link, admin_secret_read, assets, auth,
    completeness, config, contract_types, control_catalog, data_patch, deploy, dev_identity,
    diagnostic, errors_query, exec_guard, guide, guide_reference, host_ops, identity, ids,
    instance_fork, live_coalesce, local, manifest, network_profile, operational_readiness,
    rqs_contract, runtime, secure_file, server, storage, telemetry, telemetry_query,
};
pub(crate) use snapback_services::replication;

#[doc(hidden)]
pub mod cli;
#[doc(hidden)]
pub mod embed;
#[doc(hidden)]
pub mod entrypoint;
pub(crate) mod guide_mcp;
#[doc(hidden)]
pub mod store_state;

#[cfg(test)]
pub(crate) mod remainder_adapter {
    pub(crate) trait RemainderLocalSnapbackExt {
        fn remainder_auth_database_mut(&mut self) -> &mut snapback_kernel::storage::LocalDatabase;
    }

    impl RemainderLocalSnapbackExt for snapback_engine::local::LocalSnapback {
        fn remainder_auth_database_mut(&mut self) -> &mut snapback_kernel::storage::LocalDatabase {
            snapback_engine::test_support::auth_database_mut(self)
        }
    }
}
