//! The npm launcher pins the Node executable that launched it. Never search PATH.
// @ref LLP 1002#runtime-hardening-2026-09-12 — direct binary use must explicitly pin trusted Node.
use crate::protocol::Refusal;
use std::{ffi::OsString, path::PathBuf};

pub fn node_path() -> Result<PathBuf, Refusal> {
    pinned_node(std::env::var_os("SNAPBACK2_NODE"))
}

fn pinned_node(value: Option<OsString>) -> Result<PathBuf, Refusal> {
    let refused = || {
        Refusal::owner(
            "E_OWNER_NO_COMPILER",
            "no absolute Node executable was pinned by the launcher",
            "run the npm snapback2 launcher, or set SNAPBACK2_NODE to your trusted absolute Node executable",
        )
    };
    let path = value.map(PathBuf::from).ok_or_else(refused)?;
    if !path.is_absolute() {
        return Err(refused());
    }
    let path = path.canonicalize().map_err(|_| refused())?;
    let metadata = path.metadata().map_err(|_| refused())?;
    if !metadata.is_file() {
        return Err(refused());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(refused());
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_and_relative_nodes_refuse_without_searching_path() {
        assert!(pinned_node(None).is_err());
        assert!(pinned_node(Some("node".into())).is_err());
        assert!(pinned_node(Some("./node".into())).is_err());
        assert!(pinned_node(Some(std::env::temp_dir().into_os_string())).is_err());
        let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
        assert_eq!(
            pinned_node(Some(executable.clone().into_os_string())).unwrap(),
            executable
        );
    }
}
