//! Supported Rust embedding API.
//!
//! Use [`production`] for a branded, self-hosted executable whose generated
//! Snapback artifacts are compiled into the binary with `include_bytes!`.
//! The builder delegates to the same composed startup path as the `snapback`
//! executable, including auth-mode activation, provider and worker readiness,
//! listener-derived transport posture, and graceful shutdown.
//!
//! The lower-level [`app`] path remains useful for tests and tooling that own
//! an [`AppState`] directly. Use [`AppState::try_new`] or its fallible composed
//! variants so caller state and entropy failures return typed diagnostics. The
//! compatibility constructors are deprecated because they panic on those
//! errors. This façade intentionally does not expose Snapback's inner Axum
//! router or any route/native-capability registration seam.

use std::path::PathBuf;

pub use crate::admin::{AppState, ServerContext};
pub use crate::diagnostic::{SnapbackError, SnapbackResult};
pub use crate::local::LocalSnapback;
pub use crate::server::{BoundSnapbackApp, SnapbackApp, app};

/// The only native-code trust posture supported by the embedding façade.
///
/// An embedding binary links trusted Rust into the Snapback process. It is
/// therefore a self-hosted, single-tenant artifact and cannot request or claim
/// Snapback's hosted/multi-tenant isolation posture.
///
/// @ref LLP 0141#d5-security-posture-gated-not-global — linked native code is
///   a self-hosted capability, never hosted-tenant application code.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeCodePosture {
    SelfHostedSingleTenant,
}

/// Start a composed self-hosted Snapback server with generated application
/// artifacts baked into the executable.
///
/// The bytes must be the closed startup carrier containing `formatVersion`,
/// `schema`, `functions`, and optional `seed`. Parsing happens before startup
/// can touch the database. The same carrier is supplied on every restart,
/// which is required by sessions-mode deployments. For ordinary generated
/// manifest files, use [`production_from_manifests`].
///
/// ```no_run
/// # async fn run() -> anyhow::Result<()> {
/// const SCHEMA: &[u8] = include_bytes!(concat!(
///     env!("CARGO_MANIFEST_DIR"),
///     "/demos/todo/snapback/generated/schema.manifest.json"
/// ));
/// const FUNCTIONS: &[u8] = include_bytes!(concat!(
///     env!("CARGO_MANIFEST_DIR"),
///     "/demos/todo/snapback/generated/functions.manifest.json"
/// ));
/// snapback::embed::production_from_manifests(SCHEMA, FUNCTIONS)?
///     .database(".snapback/todo.sqlite3")
///     .bind("127.0.0.1", 4287)
///     .serve()
///     .await?;
/// # Ok(())
/// # }
/// ```
///
/// @ref LLP 0141#d4-production-posture-construction — the public constructor
///   composes the CLI-owned lifecycle instead of exposing its internal pieces.
pub fn production(artifacts: &[u8]) -> SnapbackResult<ProductionBuilder> {
    let artifacts = crate::auth::mode::StartupArtifacts::parse(artifacts)?;
    Ok(ProductionBuilder {
        args: crate::cli::Args::default(),
        artifacts,
    })
}

/// Build the closed startup carrier from the two ordinary generated runtime
/// manifests.
///
/// A generated `artifacts.json` is an artifact *index*; the schema and function
/// manifests are the runtime inputs a branded executable should bake in.
pub fn production_from_manifests(
    schema: &[u8],
    functions: &[u8],
) -> SnapbackResult<ProductionBuilder> {
    let schema = serde_json::from_slice(schema).map_err(|_| embedded_manifest_invalid("schema"))?;
    let functions =
        serde_json::from_slice(functions).map_err(|_| embedded_manifest_invalid("functions"))?;
    Ok(ProductionBuilder {
        args: crate::cli::Args::default(),
        artifacts: crate::auth::mode::StartupArtifacts {
            format_version: crate::auth::mode::STARTUP_ARTIFACT_FORMAT_VERSION,
            schema,
            functions,
            seed: None,
        },
    })
}

fn embedded_manifest_invalid(kind: &'static str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
        "auth-mode",
        format!("the embedded {kind} manifest is not the closed generated shape"),
    )
}

/// Builder for the supported, composed embedding path.
///
/// Defaults match `snapback start`: loopback binding, the standard port scan,
/// and `.snapback/dev.sqlite3`. No method can select hosted deployment or add
/// native operations/routes; those are deliberately outside LLP 0141's landed
/// scope.
#[derive(Clone, Debug)]
#[must_use = "the embedded server does not start until serve() is awaited"]
pub struct ProductionBuilder {
    args: crate::cli::Args,
    artifacts: crate::auth::mode::StartupArtifacts,
}

impl ProductionBuilder {
    /// Set the durable SQLite database path.
    pub fn database(mut self, path: impl Into<PathBuf>) -> Self {
        self.args.db = path.into();
        self.args.memory = false;
        self
    }

    /// Use an in-memory database. Intended for short-lived tooling and smoke
    /// tests; a deployable branded server should use [`Self::database`].
    pub fn in_memory(mut self) -> Self {
        self.args.memory = true;
        self.args.restored_from_backup = None;
        self
    }

    /// Select the listener host and exact port.
    ///
    /// The startup path resolves this host once and [`SnapbackApp::bind`]
    /// consumes the resulting listener, preserving LLP 0060's transport fence.
    pub fn bind(mut self, host: impl Into<String>, port: u16) -> Self {
        self.args.host = host.into();
        self.args.port = Some(port);
        self
    }

    /// Publish the standard owner-controlled readiness descriptor.
    pub fn ready_file(mut self, path: impl Into<PathBuf>) -> Self {
        self.args.ready_file = Some(path.into());
        self
    }

    /// Consume the declaration emitted by `snapback auth restore` before bind.
    pub fn restored_from_backup(mut self, declaration_id: impl Into<String>) -> Self {
        self.args.restored_from_backup = Some(declaration_id.into());
        self.args.memory = false;
        self
    }

    /// Report the fixed trust posture carried by this native embedding path.
    pub const fn native_code_posture(&self) -> NativeCodePosture {
        NativeCodePosture::SelfHostedSingleTenant
    }

    /// Run the complete server lifecycle until shutdown or a critical worker
    /// failure. Caller configuration, startup, and serving failures are
    /// returned through the result; this composed path has no caller-triggered
    /// panic contract.
    pub async fn serve(self) -> anyhow::Result<()> {
        // This assignment is intentionally local and non-configurable through
        // the façade. Native-linked binaries must not claim hosted isolation.
        debug_assert_eq!(
            self.args.auth_deployment,
            crate::auth::deployment::AuthDeploymentTarget::Local
        );
        crate::cli::run_embedded(self.args, self.artifacts).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::deployment::AuthDeploymentTarget;

    const TODO_SCHEMA: &[u8] =
        include_bytes!("../demos/todo/snapback/generated/schema.manifest.json");
    const TODO_FUNCTIONS: &[u8] =
        include_bytes!("../demos/todo/snapback/generated/functions.manifest.json");

    #[test]
    fn production_builder_bakes_artifacts_and_stays_self_hosted() {
        let builder = production_from_manifests(TODO_SCHEMA, TODO_FUNCTIONS)
            .expect("generated artifacts parse")
            .database("state/app.sqlite3")
            .bind("127.0.0.1", 4428)
            .ready_file("state/ready.json");

        assert_eq!(builder.artifacts.schema.app_id, "todo");
        assert_eq!(builder.artifacts.functions.app_id, "todo");
        assert!(builder.args.startup_artifacts.is_none());
        assert_eq!(builder.args.db, PathBuf::from("state/app.sqlite3"));
        assert_eq!(builder.args.host, "127.0.0.1");
        assert_eq!(builder.args.port, Some(4428));
        assert_eq!(builder.args.auth_deployment, AuthDeploymentTarget::Local);
        assert!(builder.args.hosted_edge.is_none());
        assert!(builder.args.hosted_admission.is_none());
        assert_eq!(
            builder.native_code_posture(),
            NativeCodePosture::SelfHostedSingleTenant
        );
    }

    #[test]
    fn production_rejects_invalid_embedded_artifacts_before_startup() {
        let error = production(b"{}").expect_err("closed carrier is required");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn baked_artifacts_reach_composed_readiness() {
        let directory = tempfile::tempdir().expect("temporary readiness directory");
        let ready = directory.path().join("embedded.ready.json");
        let mut builder = production_from_manifests(TODO_SCHEMA, TODO_FUNCTIONS)
            .expect("generated artifacts parse");
        // This readiness fixture has no remote-governance custodian. Keep the
        // generated owner policy, while omitting its optional deployment-only
        // governance carrier for the in-memory self-hosted boot.
        builder.artifacts.schema.visibility_governance = None;
        let server = tokio::spawn(
            builder
                .in_memory()
                .bind("127.0.0.1", 0)
                .ready_file(&ready)
                .serve(),
        );

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        while !ready.exists() {
            assert!(
                !server.is_finished(),
                "embedded startup exited before readiness"
            );
            assert!(
                tokio::time::Instant::now() < deadline,
                "embedded startup did not publish readiness"
            );
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let descriptor: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&ready).expect("read embedded readiness descriptor"),
        )
        .expect("decode embedded readiness descriptor");
        assert_eq!(descriptor["ready"], true);
        assert_eq!(descriptor["database"]["mode"], "memory");
        assert!(
            descriptor["serverUrl"]
                .as_str()
                .is_some_and(|url| url.starts_with("http://127.0.0.1:"))
        );

        server.abort();
        let _ = server.await;
    }
}
