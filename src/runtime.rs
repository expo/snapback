use crate::diagnostic::{Diagnostic, SnapbackError};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RuntimeCapabilities {
    pub canonical_engine: String,
    pub ibex_submodule: IbexSubmoduleCapability,
    pub ibex_cli: IbexCliCapability,
    pub host_plan_runtime: bool,
    pub async_handler_completion: CapabilityState,
    pub sqlite_lock_held_across_async: CapabilityState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct IbexSubmoduleCapability {
    pub present: bool,
    pub path: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct IbexCliCapability {
    pub available: bool,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CapabilityState {
    Available,
    Unavailable,
    NotYetWired,
}

#[derive(Clone, Debug)]
pub struct RuntimeManager {
    capabilities: RuntimeCapabilities,
}

impl RuntimeManager {
    pub fn detect() -> Self {
        // @ref LLP 0002#decision — local dev reports Ibex as the canonical engine.
        // @ref LLP 0009#runtime-boundary — Ibex availability is a runtime capability, not an implicit fallback.
        Self {
            capabilities: RuntimeCapabilities {
                canonical_engine: "ibex".to_owned(),
                ibex_submodule: detect_ibex_submodule(),
                ibex_cli: detect_ibex_cli(),
                host_plan_runtime: true,
                async_handler_completion: CapabilityState::NotYetWired,
                sqlite_lock_held_across_async: CapabilityState::Unavailable,
            },
        }
    }

    pub fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }

    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();
        if !self.capabilities.ibex_cli.available {
            diagnostics.push(
                Diagnostic::warning(
                    "SNAPBACK_IBEX_CLI_UNAVAILABLE",
                    "runtime",
                    "ibex binary was not found; Ibex-backed handlers cannot run yet",
                )
                .with_details(json!({
                    "canonical_engine": self.capabilities.canonical_engine,
                    "ibex_submodule": self.capabilities.ibex_submodule,
                    "host_plan_runtime": self.capabilities.host_plan_runtime
                })),
            );
        }
        diagnostics
    }

    pub fn ibex_not_wired_error(&self) -> SnapbackError {
        let mut error = SnapbackError::error(
            "SNAPBACK_IBEX_HOST_BRIDGE_NOT_WIRED",
            "runtime",
            "Ibex-backed handler invocation is not wired to ctx.db in this first local slice",
        );
        error.diagnostic.details = json!({
            "ibex_cli_available": self.capabilities.ibex_cli.available,
            "ibex_path": self.capabilities.ibex_cli.path,
            "ibex_submodule": self.capabilities.ibex_submodule,
            "supported_runtime": "HostPlan"
        });
        error
    }
}

fn detect_ibex_cli() -> IbexCliCapability {
    let path = env::var_os("SNAPBACK_IBEX")
        .map(PathBuf::from)
        .or_else(find_vendored_ibex_cli)
        .or_else(|| find_on_path("ibex"));
    let Some(path) = path else {
        return IbexCliCapability {
            available: false,
            path: None,
            version: None,
        };
    };

    let version = Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty());

    IbexCliCapability {
        available: true,
        path: Some(path),
        version,
    }
}

fn detect_ibex_submodule() -> IbexSubmoduleCapability {
    let path = snapback_root().join("vendor").join("ibex");
    let present = path.join("Cargo.toml").is_file();
    IbexSubmoduleCapability {
        present,
        path: present.then_some(path),
    }
}

fn find_vendored_ibex_cli() -> Option<PathBuf> {
    let root = snapback_root();
    let binary = if cfg!(windows) { "ibex.exe" } else { "ibex" };
    [
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("debug")
            .join(binary),
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("release")
            .join(binary),
    ]
    .into_iter()
    .find(|path| is_executable(path))
}

fn snapback_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn find_on_path(binary: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    env::split_paths(&paths)
        .map(|path| path.join(binary))
        .find(|path| is_executable(path))
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}
