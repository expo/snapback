//! Local admin-capability minting and sibling-path convention.

use std::path::{Path, PathBuf};

/// Mint a local admin capability token: 122 bits of CSPRNG randomness.
pub fn mint_admin_token() -> String {
    format!("sbat_{}", uuid::Uuid::new_v4().simple())
}

/// The sibling file a minted admin token persists in, next to the artifact
/// that names the instance.
pub fn admin_token_sibling(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".admin-token");
    path.with_file_name(name)
}
