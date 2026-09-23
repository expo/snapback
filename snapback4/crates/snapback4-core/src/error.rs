//! Refusals: every failure the engine reports is one envelope
//! `{code, family, site, message, rewrite, guide}` (LLP 2000.000 §5.1), and
//! the same envelope is what a device shows and what `why` explains.

use crate::schema::Effect;
use crate::value::ValueError;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The refusal envelope. `code` and `family` are stable identifiers; `rewrite`
/// is text the author can paste; `guide` is the keyword card to read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Refusal {
    pub code: String,
    pub family: String,
    pub message: String,
    /// Original constraint text for live development refusals; durable receipts and replays omit this row-derived detail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rewrite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guide: Option<String>,
    /// The author's own code, for `require` and named unique refusals.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub retryable: bool,
}

impl Refusal {
    pub fn new(code: impl Into<String>, family: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), family: family.into(), message: message.into(), detail: None, site: None, rewrite: None, guide: None, rule: None, retryable: false }
    }
    pub fn site(mut self, site: impl Into<String>) -> Self {
        self.site = Some(site.into());
        self
    }
    pub fn rewrite(mut self, rewrite: impl Into<String>) -> Self {
        self.rewrite = Some(rewrite.into());
        self
    }
    pub fn guide(mut self, guide: impl Into<String>) -> Self {
        self.guide = Some(guide.into());
        self
    }
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)?;
        if let Some(site) = &self.site {
            write!(f, " (at {site})")?;
        }
        if let Some(rewrite) = &self.rewrite {
            write!(f, "\n  rewrite: {rewrite}")?;
        }
        Ok(())
    }
}

/// Which meter cut a program (LLP 2000.000 §6).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeterKind {
    Examined,
    IndexEntries,
    RuleProbes,
    Steps,
    HeapBytes,
    OutputBytes,
    RowsWritten,
}

impl MeterKind {
    pub fn word(self) -> &'static str {
        match self {
            Self::Examined => "examined rows",
            Self::IndexEntries => "index entries",
            Self::RuleProbes => "rule probes",
            Self::Steps => "steps",
            Self::HeapBytes => "heap bytes",
            Self::OutputBytes => "output bytes",
            Self::RowsWritten => "rows written",
        }
    }
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("{code}: {message}")]
    Structural { code: &'static str, message: String },
    #[error("E_INPUT: {0}")]
    Input(String),
    #[error("E_SCHEMA: {0}")]
    Schema(String),
    #[error(transparent)]
    Value(#[from] ValueError),
    #[error("E_RULE: {effect} on {table} is not permitted for this viewer")]
    Rule { table: String, effect: Effect },
    #[error("{code}: the program refused")]
    Require { code: String, site: Option<String> },
    #[error("E_CONFLICT: the row no longer matches the update condition")]
    Conflict { current: crate::ir::Read },
    #[error("E_CONSTRAINT: {0}")]
    Constraint(String),
    #[error("{code}: {message} ({detail})")]
    NamedConstraint { code: String, message: String, detail: String },
    #[error("E_OVERFLOW: maintain {maintain}.{column} overflowed")]
    AggregateOverflow { maintain: String, column: String },
    #[error("E_FANOUT: a bounded loop received more items than its bound")]
    Fanout,
    #[error("E_BOUND: {kind:?} reached {actual} against the ceiling {ceiling} at {site}")]
    Bound { kind: MeterKind, actual: u64, ceiling: u64, site: String },
    #[error("E_OP: unknown operation {0}")]
    UnknownOp(String),
    #[error("E_AUTH: {0}")]
    Auth(String),
    #[error("{code}: {message}")]
    Asset { code: &'static str, message: String },
    #[error("E_PREDICT: {0}")]
    Prediction(String),
    #[error("E_GENERATION: {0}")]
    Generation(String),
    /// A native job's own refusal, or its trap (LLP 3000.005): the code is
    /// the module's word or `E_NATIVE_TRAP`.
    #[error("{code}: {message}")]
    Native { code: String, message: String },
    #[cfg(feature = "sqlite")]
    #[error("E_STORE: {0}")]
    Sql(#[from] rusqlite::Error),
    #[cfg(feature = "postgres")]
    #[error("E_STORE: {0}")]
    Postgres(#[from] postgres::Error),
    #[error("E_STORE: {0}")]
    Store(String),
}

impl RuntimeError {
    pub fn code(&self) -> String {
        match self {
            Self::Structural { code, .. } => (*code).into(),
            Self::Input(_) => "E_INPUT".into(),
            Self::Schema(_) => "E_SCHEMA".into(),
            Self::Value(ValueError::Overflow(_)) | Self::AggregateOverflow { .. } => "E_OVERFLOW".into(),
            Self::Value(ValueError::DivideByZero) => "E_DIV_ZERO".into(),
            Self::Value(ValueError::Type { .. }) => "E_TYPE".into(),
            Self::Value(ValueError::MissingField(_)) => "E_FIELD".into(),
            Self::Value(ValueError::Identity) => "E_INPUT".into(),
            Self::Rule { .. } => "E_RULE".into(),
            Self::Require { code, .. } | Self::NamedConstraint { code, .. } => code.clone(),
            Self::Conflict { .. } => "E_CONFLICT".into(),
            Self::Constraint(_) => "E_CONSTRAINT".into(),
            Self::Fanout => "E_FANOUT".into(),
            Self::Bound { .. } => "E_BOUND".into(),
            Self::UnknownOp(_) => "E_OP".into(),
            Self::Auth(_) => "E_AUTH".into(),
            Self::Asset { code, .. } => (*code).into(),
            Self::Prediction(_) => "E_PREDICT".into(),
            Self::Generation(_) => "E_GENERATION".into(),
            Self::Native { code, .. } => code.clone(),
            #[cfg(feature = "sqlite")]
            Self::Sql(_) => "E_STORE".into(),
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => "E_STORE".into(),
            Self::Store(_) => "E_STORE".into(),
        }
    }

    /// Every family `family()` answers, for the guide's refusals card.
    pub const FAMILIES: &'static [&'static str] = &["input", "schema", "auth", "rule", "constraint", "bound", "op", "asset", "action", "route", "prediction", "generation", "store"];

    pub fn family(&self) -> &'static str {
        match self {
            Self::Input(_) | Self::Value(_) | Self::AggregateOverflow { .. } => "input",
            Self::Structural { code: "E_WRITE_ID_REUSE" | "E_ID_REUSED", .. } => "input",
            Self::Structural { code, .. } if matches!(*code, "E_ACTION_UNKNOWN" | "E_ACTION_LEASE" | "E_ACTION_AUTHORITY") => "action",
            Self::Structural { code, .. } if code.starts_with(concat!("E_", "ROUTE_")) => "route",
            Self::Structural { code: "E_STORE_RESTORE", .. } => "store",
            Self::Schema(_) | Self::Structural { .. } => "schema",
            Self::Rule { .. } | Self::Auth(_) => "auth",
            Self::Require { .. } => "rule",
            Self::Conflict { .. } | Self::Constraint(_) | Self::NamedConstraint { .. } => "constraint",
            Self::Fanout | Self::Bound { .. } => "bound",
            Self::UnknownOp(_) => "op",
            Self::Asset { .. } => "asset",
            Self::Prediction(_) => "prediction",
            Self::Generation(_) => "generation",
            Self::Native { .. } => "native",
            #[cfg(feature = "sqlite")]
            Self::Sql(_) => "store",
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => "store",
            Self::Store(_) => "store",
        }
    }

    /// Whether a program's refusal is the caller's to repair (as opposed to
    /// a store failure the caller should retry later).
    fn is_store_failure(&self) -> bool {
        #[cfg(feature = "postgres")]
        if matches!(self, Self::Postgres(_)) {
            return true;
        }
        #[cfg(feature = "sqlite")]
        if matches!(self, Self::Sql(_)) {
            return true;
        }
        matches!(self, Self::Store(_))
    }

    pub fn is_refusal(&self) -> bool {
        !self.is_store_failure()
    }

    pub fn refusal(&self) -> Refusal {
        let mut refusal = Refusal::new(self.code(), self.family(), self.to_string());
        match self {
            Self::NamedConstraint { code, message, detail } => {
                refusal.rule = Some(code.clone());
                refusal.message = message.clone();
                refusal.detail = Some(detail.clone());
                refusal.guide = Some("indexes".into());
            }
            Self::Require { code, site } => {
                refusal.rule = Some(code.clone());
                refusal.site = site.clone();
                refusal.message = format!("the program refused with {code}");
                refusal.guide = Some("programs".into());
            }
            Self::Structural { code: "E_STRUCTURAL_FANOUT", message } => {
                refusal.message = message.clone();
                refusal.rewrite = Some("iterate the original capped group, read the page in a query, or use a job chunk; `snapback4 check` locates the source and names the bound".into());
                refusal.guide = Some("programs".into());
            }
            Self::Structural { code, .. } if matches!(*code, "E_ACTION_UNKNOWN" | "E_ACTION_LEASE" | "E_ACTION_AUTHORITY") => refusal.guide = Some("actions".into()),
            Self::Structural { code, .. } if code.starts_with(concat!("E_", "ROUTE_")) => refusal.guide = Some("routes".into()),
            Self::Structural { code: "E_STORE_RESTORE", .. } => refusal.guide = Some("sync".into()),
            Self::Structural { code, message } if code.starts_with("E_TIMELINE_") => {
                refusal.guide = Some("feeds".into());
                refusal.rewrite = Some(message.clone());
            }
            Self::Structural { code: "E_RECORDED_FIELD", .. } => {
                refusal.guide = Some("maintains".into());
                refusal.rewrite = Some("omit engine-recorded fields from the payload; write only application columns".into());
            }
            Self::Structural { code: "E_SHAPE_EXCEEDS_METER", .. } => refusal.guide = Some("reads".into()),
            Self::Structural { code: "E_WRITE_ID_REUSE" | "E_ID_REUSED", message } => {
                refusal.message = message.clone();
                refusal.guide = Some("writes".into());
            }
            Self::Bound { kind, ceiling, site, .. } => {
                // The ceiling, never the count: the count would measure rows
                // the viewer may not read.
                refusal.site = Some(site.clone());
                refusal.message = format!("{} reached the ceiling {ceiling}", kind.word());
                refusal.rewrite = Some(match kind {
                    MeterKind::Examined | MeterKind::IndexEntries | MeterKind::RuleProbes => "read a smaller page, or add an index whose prefix pins the rows this site needs".into(),
                    MeterKind::Steps | MeterKind::HeapBytes => "move the loop into a job with `chunk`, or read a maintained aggregate instead of counting rows".into(),
                    MeterKind::OutputBytes => "return fewer fields with a shape `{ a, b }`, or a smaller page".into(),
                    MeterKind::RowsWritten => "write fewer rows per mutation, or move the sweep into a job with `chunk`".into(),
                });
                refusal.guide = Some("bounds".into());
            }
            Self::Rule { table, effect } => {
                // @ref LLP 3000.007#8 — explain the hidden-collision idiom without disclosing a row
                refusal.message = format!("{table}'s {effect} rule does not admit this viewer, or a unique key collided with a row you cannot read; to write into another principal's row use `upsert` under an `update` rule, or let a `maintain` keep the count");
                refusal.guide = Some("rules".into());
            }
            Self::Constraint(message) => {
                refusal.message = message.clone();
                refusal.guide = Some("indexes".into());
            }
            Self::Conflict { current } => {
                refusal.site = Some(current.site.clone());
                refusal.retryable = true;
                refusal.guide = Some("writes".into());
            }
            #[cfg(feature = "sqlite")]
            Self::Sql(_) => refusal.retryable = true,
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => refusal.retryable = true,
            Self::Store(_) => refusal.retryable = true,
            Self::Asset { message, .. } => {
                refusal.message = message.clone();
                refusal.guide = Some("assets".into());
            }
            Self::Native { message, .. } => {
                refusal.message = message.clone();
                refusal.guide = Some("native".into());
            }
            _ => {}
        }
        refusal
    }
}

impl From<RuntimeError> for Refusal {
    fn from(error: RuntimeError) -> Self {
        error.refusal()
    }
}
