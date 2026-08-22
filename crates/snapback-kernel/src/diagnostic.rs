use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::error::Error;
use std::fmt::{Display, Formatter};

use snapback_types::diagnostic::SnapbackError as ContractError;
pub use snapback_types::diagnostic::{
    CAPABILITY_UNSUPPORTED_GUIDE_URL, Diagnostic, DiagnosticSeverity, PublicDiagnostic,
};

/// Remainder-owned integration adapter for confined infrastructure errors.
///
/// The language-neutral diagnostic carrier lives in `snapback-types`; the
/// monolithic remainder temporarily retains the identical carrier plus the
/// SQLite conversion until the kernel carve moves that integration seam.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SnapbackError {
    pub diagnostic: Diagnostic,
    #[serde(default, skip)]
    trusted_permission_denial: bool,
    #[serde(default, skip)]
    private_failure: Option<crate::error_tracking::PrivateFailureContextV1>,
    #[serde(default, skip)]
    captured_read_dependencies: Vec<crate::storage::CapturedReadDependency>,
}

impl SnapbackError {
    pub fn new(diagnostic: Diagnostic) -> Self {
        Self {
            diagnostic,
            trusted_permission_denial: false,
            private_failure: None,
            captured_read_dependencies: Vec::new(),
        }
    }

    pub fn error(
        code: impl Into<String>,
        subsystem: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self::new(Diagnostic::error(code, subsystem, message))
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.diagnostic.details = details;
        self
    }

    #[allow(dead_code)]
    pub fn trusted_permission_denied(message: impl Into<String>) -> Self {
        Self {
            diagnostic: Diagnostic::error("SNAPBACK_AUTH_PERMISSION_DENIED", "auth", message),
            trusted_permission_denial: true,
            private_failure: None,
            captured_read_dependencies: Vec::new(),
        }
    }

    pub fn into_trusted_permission_denial(mut self) -> Self {
        self.trusted_permission_denial = true;
        self
    }

    pub fn is_trusted_permission_denial(&self) -> bool {
        self.trusted_permission_denial
    }

    pub fn with_private_failure_context(
        mut self,
        context: crate::error_tracking::PrivateFailureContextV1,
    ) -> Self {
        self.private_failure = Some(context);
        self
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn private_failure_context(
        &self,
    ) -> Option<&crate::error_tracking::PrivateFailureContextV1> {
        self.private_failure.as_ref()
    }

    pub fn private_failure_context_mut(
        &mut self,
    ) -> Option<&mut crate::error_tracking::PrivateFailureContextV1> {
        self.private_failure.as_mut()
    }

    pub fn take_private_failure_context(
        &mut self,
    ) -> Option<crate::error_tracking::PrivateFailureContextV1> {
        self.private_failure.take()
    }

    pub fn with_captured_read_dependencies(
        mut self,
        dependencies: impl IntoIterator<Item = crate::storage::CapturedReadDependency>,
    ) -> Self {
        self.captured_read_dependencies.extend(dependencies);
        self
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn captured_read_dependencies(&self) -> &[crate::storage::CapturedReadDependency] {
        &self.captured_read_dependencies
    }

    pub fn finalize_invocation_refusal(
        mut self,
        invocation_reads: &mut Vec<crate::storage::CapturedReadDependency>,
    ) -> Self {
        for dependency in self.captured_read_dependencies.drain(..) {
            if !invocation_reads.contains(&dependency) {
                invocation_reads.push(dependency);
            }
        }
        self.captured_read_dependencies = invocation_reads.clone();
        self
    }

    pub fn sqlite(error: rusqlite::Error) -> Self {
        Self::new(
            Diagnostic::error(
                "SNAPBACK_SQLITE_ERROR",
                "storage",
                "SQLite operation failed",
            )
            .with_details(json!({ "error": error.to_string() })),
        )
    }
}

impl From<ContractError> for SnapbackError {
    fn from(value: ContractError) -> Self {
        let (diagnostic, trusted_permission_denial, private_failure, captured_read_dependencies) =
            value.into_parts();
        Self {
            diagnostic,
            trusted_permission_denial,
            private_failure,
            captured_read_dependencies,
        }
    }
}

impl From<SnapbackError> for ContractError {
    fn from(value: SnapbackError) -> Self {
        Self::from_parts(
            value.diagnostic,
            value.trusted_permission_denial,
            value.private_failure,
            value.captured_read_dependencies,
        )
    }
}

impl Display for SnapbackError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}: {}",
            self.diagnostic.code, self.diagnostic.message
        )
    }
}

impl Error for SnapbackError {}

impl From<rusqlite::Error> for SnapbackError {
    fn from(value: rusqlite::Error) -> Self {
        Self::sqlite(value)
    }
}

pub type SnapbackResult<T> = Result<T, SnapbackError>;
