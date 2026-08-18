use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::error::Error;
use std::fmt::{Display, Formatter};

pub const CAPABILITY_UNSUPPORTED_GUIDE_URL: &str = "https://github.com/expo/snapback/blob/main/guide/operating/diagnostics.md#diagnose-snapbackcapabilityunsupported";

// Lowercase on the wire (LLP 0032 P8): the LLP 0012 diagnostic family has
// always been lowercase on the JS side ('error'); the Rust serialization
// drifted PascalCase. Aliases keep old spellings parsing.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    #[serde(alias = "Info")]
    Info,
    #[serde(alias = "Warning")]
    Warning,
    #[serde(alias = "Error")]
    Error,
    #[serde(alias = "Fatal")]
    Fatal,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct Diagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub subsystem: String,
    pub message: String,
    pub details: Value,
}

/// Public diagnostic identity. Messages and structured details can contain
/// source paths, handler text, arguments, or other operator-only context, so
/// unauthenticated inspection exposes only the stable classification fields.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PublicDiagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub subsystem: String,
}

impl From<Diagnostic> for PublicDiagnostic {
    fn from(diagnostic: Diagnostic) -> Self {
        let Diagnostic {
            code,
            severity,
            subsystem,
            message: _,
            details: _,
        } = diagnostic;
        Self {
            code,
            severity,
            subsystem,
        }
    }
}

impl Diagnostic {
    pub fn info(
        code: impl Into<String>,
        subsystem: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self::new(
            code,
            DiagnosticSeverity::Info,
            subsystem,
            message,
            Value::Object(Default::default()),
        )
    }

    pub fn warning(
        code: impl Into<String>,
        subsystem: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self::new(
            code,
            DiagnosticSeverity::Warning,
            subsystem,
            message,
            Value::Object(Default::default()),
        )
    }

    pub fn error(
        code: impl Into<String>,
        subsystem: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self::new(
            code,
            DiagnosticSeverity::Error,
            subsystem,
            message,
            Value::Object(Default::default()),
        )
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = details;
        self
    }

    /// Attach LLP 0146's nested remediation carrier while preserving this
    /// Diagnostic and every outer wire envelope byte-for-byte otherwise.
    ///
    /// @ref LLP 0146#oq6-author-ruling--2026-08-10 — construction is shared
    ///   at the Diagnostic boundary, not reimplemented by each projection.
    pub fn with_remediation_set(
        mut self,
        remediation_set: crate::remediation::RemediationSetV1,
    ) -> Self {
        crate::remediation::attach_remediation_set(&mut self.details, remediation_set);
        self
    }

    pub fn new(
        code: impl Into<String>,
        severity: DiagnosticSeverity,
        subsystem: impl Into<String>,
        message: impl Into<String>,
        details: Value,
    ) -> Self {
        let code = code.into();
        let mut message = message.into();
        if code == "SNAPBACK_CAPABILITY_UNSUPPORTED"
            && !message.contains(CAPABILITY_UNSUPPORTED_GUIDE_URL)
        {
            message.push_str("; see ");
            message.push_str(CAPABILITY_UNSUPPORTED_GUIDE_URL);
        }
        Self {
            code,
            severity,
            subsystem: subsystem.into(),
            message,
            details,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SnapbackError {
    pub diagnostic: Diagnostic,
    /// Host-owned brand for the narrow terminal authorization-denial
    /// producer. It never crosses serialization boundaries, so an application
    /// string/object with the same diagnostic code cannot forge proof.
    #[serde(default, skip)]
    trusted_permission_denial: bool,
    /// Runtime-only E0 carrier. Message/stack text is raw-tier data and must
    /// not leak merely because the public Diagnostic is serialized.
    ///
    /// @ref LLP 0156#e02--the-failure-carrier — capture survives to the
    ///   existing observation seam without widening public diagnostics.
    #[serde(default, skip)]
    private_failure: Option<crate::error_tracking::PrivateFailureContextV1>,
    /// Host-private reads that produced a refusal before a mutation could
    /// enter the ordinary commit carrier. They never change public refusal
    /// bytes; retaining them keeps the authorization witness available to the
    /// transaction/runtime seam instead of discarding it on `Err`.
    ///
    /// @ref LLP 0056#invalidation-the-llp-0053-mapping — negative membership
    ///   observations remain captured witnesses on denial paths.
    #[serde(default, skip)]
    captured_read_dependencies: Vec<crate::storage::CapturedReadDependency>,
}

impl SnapbackError {
    pub fn from_parts(
        diagnostic: Diagnostic,
        trusted_permission_denial: bool,
        private_failure: Option<crate::error_tracking::PrivateFailureContextV1>,
        captured_read_dependencies: Vec<crate::storage::CapturedReadDependency>,
    ) -> Self {
        Self {
            diagnostic,
            trusted_permission_denial,
            private_failure,
            captured_read_dependencies,
        }
    }

    pub fn into_parts(
        self,
    ) -> (
        Diagnostic,
        bool,
        Option<crate::error_tracking::PrivateFailureContextV1>,
        Vec<crate::storage::CapturedReadDependency>,
    ) {
        (
            self.diagnostic,
            self.trusted_permission_denial,
            self.private_failure,
            self.captured_read_dependencies,
        )
    }

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

    // The shared invocation gate is the production caller once its branch is
    // composed with this protocol layer; tests exercise the boundary here.
    #[allow(dead_code)]
    pub fn trusted_permission_denied(message: impl Into<String>) -> Self {
        Self {
            diagnostic: Diagnostic::error("SNAPBACK_AUTH_PERMISSION_DENIED", "auth", message),
            trusted_permission_denial: true,
            private_failure: None,
            captured_read_dependencies: Vec::new(),
        }
    }

    /// Mark a host-constructed denial as terminal without changing its public
    /// diagnostic identity. The bit is deliberately absent from serialization,
    /// so an application or remote caller cannot forge this disposition by
    /// replaying the same code and details.
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

    #[cfg(test)]
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

    /// Finalize one invocation refusal at the runtime boundary. Intermediate
    /// layers must only `?`-propagate the host-private carrier: they must never
    /// drain dependencies into a local vector that is then dropped with the
    /// error. This chokepoint first merges the carrier into the live invocation
    /// read set, then reattaches that complete set so any outer boundary keeps
    /// the same witness by construction.
    ///
    /// @ref LLP 0056#invalidation-the-llp-0053-mapping — empty membership
    ///   observations are ordinary matcher dependencies on every outcome.
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

    pub fn sqlite(error: impl Display) -> Self {
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

pub type SnapbackResult<T> = Result<T, SnapbackError>;

#[cfg(test)]
mod tests {
    use super::{CAPABILITY_UNSUPPORTED_GUIDE_URL, Diagnostic, SnapbackError};
    use crate::error_tracking::{FailureCarrierV1, PrivateFailureContextV1};

    #[test]
    fn capability_refusal_message_names_its_public_guide() {
        let diagnostic = Diagnostic::error(
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
            "capability",
            "target does not support required capability single_table_v1",
        );
        assert!(
            diagnostic
                .message
                .contains(CAPABILITY_UNSUPPORTED_GUIDE_URL),
            "{}",
            diagnostic.message
        );
        assert!(
            !Diagnostic::error("SNAPBACK_TEST", "test", "plain")
                .message
                .contains("http")
        );
    }

    #[test]
    fn terminal_permission_denial_brand_cannot_cross_or_be_forged_by_json() {
        let branded = SnapbackError::trusted_permission_denied("policy denied the query");
        assert!(branded.is_trusted_permission_denial());
        assert!(branded.clone().is_trusted_permission_denial());

        let encoded = serde_json::to_string(&branded).expect("serialize denial diagnostic");
        assert!(!encoded.contains("trusted_permission_denial"));
        let decoded: SnapbackError =
            serde_json::from_str(&encoded).expect("deserialize denial diagnostic");
        assert!(!decoded.is_trusted_permission_denial());

        let forged = SnapbackError::error(
            "SNAPBACK_AUTH_PERMISSION_DENIED",
            "auth",
            "application supplied the public code",
        );
        assert!(!forged.is_trusted_permission_denial());

        let classified = SnapbackError::error(
            "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
            "auth",
            "host classified a durable scope tombstone",
        )
        .into_trusted_permission_denial();
        assert!(classified.is_trusted_permission_denial());
        assert_eq!(
            classified.diagnostic.code,
            "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
        );
        let decoded: SnapbackError = serde_json::from_str(
            &serde_json::to_string(&classified).expect("serialize classified denial"),
        )
        .expect("deserialize classified denial");
        assert!(!decoded.is_trusted_permission_denial());
    }

    #[test]
    fn private_failure_carrier_clones_but_never_changes_public_diagnostic_bytes() {
        let public = SnapbackError::error(
            "SNAPBACK_HANDLER_FAILED",
            "runtime",
            "JavaScript handler failed",
        );
        let carried = public
            .clone()
            .with_private_failure_context(PrivateFailureContextV1 {
                carriers: vec![FailureCarrierV1 {
                    error_class: "TypeError".to_owned(),
                    message: Some("raw private message".to_owned()),
                    stack: Some("raw private stack".to_owned()),
                    message_extraction_truncated: false,
                    stack_extraction_truncated: true,
                }],
                app_refusal_tracking: None,
            });

        assert_eq!(carried.diagnostic, public.diagnostic);
        assert_eq!(
            carried.clone().private_failure_context(),
            carried.private_failure_context()
        );
        let public_json = serde_json::to_value(&public).expect("serialize public error");
        let carried_json = serde_json::to_value(&carried).expect("serialize carried error");
        assert_eq!(carried_json, public_json);
        let encoded = serde_json::to_string(&carried).expect("serialize carried error bytes");
        assert!(!encoded.contains("raw private message"));
        assert!(!encoded.contains("raw private stack"));
        assert!(!encoded.contains("TypeError"));

        let decoded: SnapbackError =
            serde_json::from_str(&encoded).expect("deserialize public error bytes");
        assert!(decoded.private_failure_context().is_none());
        assert_eq!(decoded.diagnostic, public.diagnostic);
    }
}
