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
            node_rewrite(),
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
        let missing = pinned_node(None).unwrap_err();
        assert!(missing.message.contains("no absolute Node executable"));
        assert!(
            missing
                .rewrite
                .as_deref()
                .unwrap()
                .contains("SNAPBACK2_NODE=")
        );
        assert!(
            !missing
                .rewrite
                .as_deref()
                .unwrap()
                .contains("SNAPBACK2_COMPILER=")
        );
        assert!(pinned_node(Some("node".into())).is_err());
        assert!(pinned_node(Some("./node".into())).is_err());
        assert!(pinned_node(Some(std::env::temp_dir().into_os_string())).is_err());
        let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
        assert_eq!(
            pinned_node(Some(executable.clone().into_os_string())).unwrap(),
            executable
        );
    }

    #[test]
    fn wrapper_rewrite_preserves_and_shell_quotes_the_invocation() {
        let invocation = wrapper_invocation(
            ["check", "--project", "/tmp/quoted project's app", "--json"]
                .map(str::to_owned)
                .into_iter(),
        );
        assert_eq!(
            invocation,
            r#"npx snapback2 check --project '/tmp/quoted project'\''s app' --json"#
        );
    }
}

pub(super) fn compiler_rewrite() -> String {
    invocation_rewrite(
        "set SNAPBACK2_COMPILER=/absolute/path/to/node_modules/snapback2/dist/compiler.mjs",
    )
}

pub(super) fn node_rewrite() -> String {
    invocation_rewrite("set SNAPBACK2_NODE=/absolute/path/to/trusted/node")
}

fn invocation_rewrite(fallback: &str) -> String {
    format!(
        "run {}; or {fallback}",
        wrapper_invocation(std::env::args().skip(1))
    )
}

fn wrapper_invocation(args: impl Iterator<Item = String>) -> String {
    let args = args
        .filter(|arg| !matches!(arg.as_str(), "--owner-child" | "--test-owner"))
        .map(shell_quote)
        .collect::<Vec<_>>()
        .join(" ");
    if args.is_empty() {
        "npx snapback2".to_owned()
    } else {
        format!("npx snapback2 {args}")
    }
}

fn shell_quote(arg: String) -> String {
    if !arg.is_empty()
        && arg
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_=./:@".contains(&byte))
    {
        arg
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}
