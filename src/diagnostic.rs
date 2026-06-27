use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
    Fatal,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Diagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub subsystem: String,
    pub message: String,
    pub details: Value,
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
}

impl SnapbackError {
    pub fn new(diagnostic: Diagnostic) -> Self {
        Self { diagnostic }
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
