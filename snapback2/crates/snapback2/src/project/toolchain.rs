//! The npm launcher pins the Node executable that launched it. Never search PATH.
// @ref LLP 1002#runtime-hardening-2026-09-12 — direct binary use must explicitly pin trusted Node.
use crate::protocol::Refusal;
use std::{ffi::OsString, path::PathBuf};

pub(crate) const ORIGINAL_INVOCATION_ENV: &str = "SNAPBACK2_INTERNAL_ORIGINAL_INVOCATION";

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
    fn wrapper_rewrite_preserves_check_and_explicit_foreground_invocations() {
        let invocation = wrapper_invocation(
            ["check", "--project", "/tmp/quoted project's app", "--json"].map(str::to_owned),
        );
        assert_eq!(
            invocation,
            r#"npx snapback2 check --project '/tmp/quoted project'\''s app' --json"#
        );
        assert_eq!(
            wrapper_invocation(
                [
                    "dev",
                    "--foreground",
                    "--project",
                    "/tmp/app",
                    "--port",
                    "4321"
                ]
                .map(str::to_owned),
            ),
            "npx snapback2 dev --foreground --project /tmp/app --port 4321"
        );
    }

    #[test]
    fn detached_rewrite_uses_exact_parent_invocation() {
        let child = [
            "dev",
            "--project",
            "/tmp/a b",
            "--foreground",
            "--owner-child",
            "--json",
            "--apply-migration",
            "/tmp/synthetic",
            "--port",
            "4321",
            "--serve",
        ]
        .map(str::to_owned);
        let parent = serde_json::to_string(&[
            "dev",
            "--project",
            "/tmp/a b",
            "--port",
            "4321",
            "--apply-migration",
            "/tmp/plan's migration.json",
            "--serve",
        ])
        .unwrap();
        assert_eq!(
            wrapper_invocation(recovery_args(child, Some(parent.into()))),
            "npx snapback2 dev --project '/tmp/a b' --port 4321 --apply-migration '/tmp/plan'\\''s migration.json' --serve"
        );
    }

    #[test]
    fn internal_test_owner_rewrite_removes_only_internal_flags() {
        let args = recovery_args(
            [
                "dev",
                "--project",
                "/tmp/test owner",
                "--foreground",
                "--owner-child",
                "--test-owner",
                "--json",
                "--port",
                "9876",
            ]
            .map(str::to_owned),
            None,
        );
        assert_eq!(
            wrapper_invocation(args),
            "npx snapback2 dev --project '/tmp/test owner' --foreground --json --port 9876"
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
    let current = std::env::args().skip(1).collect::<Vec<_>>();
    let preserved = std::env::var_os(ORIGINAL_INVOCATION_ENV);
    format!(
        "run {}; or {fallback}",
        wrapper_invocation(recovery_args(current, preserved))
    )
}

fn recovery_args(
    current: impl IntoIterator<Item = String>,
    preserved: Option<OsString>,
) -> Vec<String> {
    let current = current.into_iter().collect::<Vec<_>>();
    if current.iter().any(|arg| arg == "--owner-child")
        && let Some(args) = preserved
            .and_then(|value| value.into_string().ok())
            .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        && !args.is_empty()
    {
        return args;
    }
    current
        .into_iter()
        .filter(|arg| !matches!(arg.as_str(), "--owner-child" | "--test-owner"))
        .collect()
}

fn wrapper_invocation(args: impl IntoIterator<Item = String>) -> String {
    let args = args
        .into_iter()
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
