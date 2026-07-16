use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::error::Error;
use std::fmt::{Display, Formatter};

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

    pub fn new(
        code: impl Into<String>,
        severity: DiagnosticSeverity,
        subsystem: impl Into<String>,
        message: impl Into<String>,
        details: Value,
    ) -> Self {
        Self {
            code: code.into(),
            severity,
            subsystem: subsystem.into(),
            message: message.into(),
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
}

impl SnapbackError {
    pub fn new(diagnostic: Diagnostic) -> Self {
        Self {
            diagnostic,
            trusted_permission_denial: false,
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
    pub(crate) fn trusted_permission_denied(message: impl Into<String>) -> Self {
        Self {
            diagnostic: Diagnostic::error("SNAPBACK_AUTH_PERMISSION_DENIED", "auth", message),
            trusted_permission_denial: true,
        }
    }

    /// Mark a host-constructed denial as terminal without changing its public
    /// diagnostic identity. The bit is deliberately absent from serialization,
    /// so an application or remote caller cannot forge this disposition by
    /// replaying the same code and details.
    pub(crate) fn into_trusted_permission_denial(mut self) -> Self {
        self.trusted_permission_denial = true;
        self
    }

    pub(crate) fn is_trusted_permission_denial(&self) -> bool {
        self.trusted_permission_denial
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

#[cfg(test)]
mod tests {
    use super::SnapbackError;

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
}
