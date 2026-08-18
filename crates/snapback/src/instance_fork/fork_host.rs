//! Host facilities required while preparing and validating a durable fork.

use std::path::{Path, PathBuf};

// @ref LLP 0225#2-dependency-direction — the lower fork service declares
// the host facilities it needs; the server-side composition implements them.
pub trait ForkHost {
    type ResumeKeyringGuard;

    fn admin_token_sibling(&self, database_path: &Path) -> PathBuf;
    fn mint_admin_token(&self) -> String;
    fn mint_resume_keyring(&self, path: PathBuf, now_ms: u64) -> Self::ResumeKeyringGuard;
    fn resume_keyring_has_active_key(&self, path: &Path) -> bool;
    fn config_sidecar(&self, database_path: &Path) -> PathBuf;
}
