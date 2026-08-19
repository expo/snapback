//! Print the clean-tree implementation digest used by agent-safe qualification.

use std::path::PathBuf;

use anyhow::{Context, bail};
use snapback_tools::agent_safe_digest::implementation_tree_sha256;

fn main() -> anyhow::Result<()> {
    let repo_root = match std::env::args_os().nth(1) {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir().context("resolve the current checkout")?,
    };
    let Some(digest) = implementation_tree_sha256(&repo_root) else {
        bail!(
            "agent-safe implementation digest unavailable: the checkout and vendored Ibex must be clean and revision-aligned"
        );
    };
    println!("{digest}");
    Ok(())
}
