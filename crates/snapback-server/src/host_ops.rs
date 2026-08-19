//! Rank-7 compatibility façade for engine-owned host operations.

pub use snapback_engine::host_ops::*;

/// Execute one in-process host operation against the same live route registry
/// used by the HTTP adapter.
pub fn execute_host_op(
    snapback: &mut crate::local::LocalSnapback,
    request: HostOpsRequest,
    server_url: Option<String>,
) -> HostOpsResult {
    execute_host_op_with_profile(
        snapback,
        request,
        server_url,
        crate::contract_types::ServerProfile::Dev,
    )
}

/// Preserve the pre-carve façade while supplying the higher-layer route fact
/// through the engine composition boundary.
pub fn execute_host_op_with_profile(
    snapback: &mut crate::local::LocalSnapback,
    request: HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
) -> HostOpsResult {
    snapback_engine::host_ops::execute_host_op_with_profile(
        snapback,
        request,
        server_url,
        profile,
        crate::server::served_route_paths(),
    )
}
