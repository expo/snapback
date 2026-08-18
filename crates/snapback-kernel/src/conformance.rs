//! Declaration/observation conformance (LLP 0146 D1).
//!
//! Snapback computes a handler's *declared* read/write table sets (the
//! manifest's dependency summaries, or the generated plan) and its *captured*
//! dependency sets (what the invocation observably touched) side by side.
//! This module joins the two and makes divergence a named, addressable fact.
//!
//! The report deliberately preserves the read/write class: four independent
//! deltas plus a per-class evidence-provenance state. Collapsing the four
//! collections into one untagged union would let a read/write swap cancel out
//! (declare read A + write B, observably read B + write A — identical unions,
//! two violations).
//!
//! @ref LLP 0146#d1-declarationobservation-conformance — the evidence shape:
//!   class-tagged deltas, per-class provenance, unconditional emission.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::manifest::{SchemaManifest, SourceSpan};
use crate::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, CapturedWriteDependency,
};

/// The declaration facts strict mode enforces against, carried immutably on
/// the prepared invocation so handler code cannot swap them at the runtime
/// seam. Populated only for opaque (Ibex-module) handlers: HostPlan functions
/// derive their declared sets from the generated plan, so hand-authored drift
/// cannot occur there (LLP 0146 §What is common to every target).
#[derive(Clone, Debug)]
pub struct StrictDeclarationFacts {
    pub declared_reads: Vec<String>,
    pub declared_writes: Vec<String>,
    pub source_span: Option<SourceSpan>,
}

/// How authoritative one dependency class's captured evidence is for this
/// invocation.
///
/// `Complete` — the runtime captured this class on a supported path; the
/// matching delta fields are authoritative. `Incomplete` — the invocation
/// failed, was refused before handler completion, or ran on a seam that
/// discards the capture; deltas are data, not verdicts. `Unsupported` — the
/// path constructs no capture by design (actions), so no conformant verdict
/// can exist.
// @ref LLP 0146#d1-declarationobservation-conformance — a conformance surface
//   that reported `conformant` from an empty capture would manufacture
//   exactly the false confidence it exists to remove. Keep this reference out
//   of the generated JSON Schema description.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DependencyProvenance {
    Complete,
    Incomplete,
    Unsupported,
}

/// The per-invocation D1 conformance report: four class-tagged deltas plus
/// per-class provenance. Emission is unconditional — an invocation with no
/// capture is exactly the case the provenance vocabulary exists to report.
///
/// Tables are application tables only (present in the active schema manifest);
/// auth/permission dependencies and reserved `_snapback_*` projections are out
/// of scope by construction.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeclarationConformance {
    /// Captured reads absent from the declaration — authoritative when
    /// `readProvenance` is `complete`.
    pub missing_reads: Vec<String>,
    /// Captured writes absent from the declaration — authoritative when
    /// `writeProvenance` is `complete`.
    pub missing_writes: Vec<String>,
    /// Declared reads unwitnessed by this invocation. Data, not a verdict:
    /// a conditionally-read table is unwitnessed on every invocation that
    /// skips its branch, so over-declaration is only judgeable in aggregate
    /// (D2 coverage).
    pub extra_reads: Vec<String>,
    /// Declared writes unwitnessed by this invocation. Data, not a verdict.
    pub extra_writes: Vec<String>,
    pub read_provenance: DependencyProvenance,
    pub write_provenance: DependencyProvenance,
}

impl DeclarationConformance {
    /// The no-evidence report: empty deltas under the given provenance. Used
    /// on paths where the invocation never produced a capture (early refusal,
    /// unknown function, capture-discarding seams).
    pub fn without_capture(provenance: DependencyProvenance) -> Self {
        Self {
            missing_reads: Vec::new(),
            missing_writes: Vec::new(),
            extra_reads: Vec::new(),
            extra_writes: Vec::new(),
            read_provenance: provenance,
            write_provenance: provenance,
        }
    }
}

/// The application-table names a captured read names — `Row`/`MissingRow`/
/// `Query` facts carrying a table that exists in the active schema. `Auth`
/// and `Permission` dependencies carry no application table and are never
/// conformance evidence; reserved projections (job status, push ledger) are
/// not schema tables and are excluded the same way.
fn captured_read_tables(
    captured_reads: &[CapturedReadDependency],
    schema: &SchemaManifest,
) -> BTreeSet<String> {
    captured_reads
        .iter()
        .filter(|dependency| {
            matches!(
                dependency.kind,
                CapturedReadKind::Row | CapturedReadKind::MissingRow | CapturedReadKind::Query
            )
        })
        .filter_map(|dependency| dependency.table.clone())
        .filter(|table| schema.table(table).is_some())
        .collect()
}

fn captured_write_tables(
    captured_writes: &[CapturedWriteDependency],
    schema: &SchemaManifest,
) -> BTreeSet<String> {
    captured_writes
        .iter()
        .map(|dependency| dependency.table.clone())
        .filter(|table| schema.table(table).is_some())
        .collect()
}

/// Buffered-write table set for the pre-commit strict seam (the captured
/// write set before it becomes `CapturedWriteDependency` values).
fn buffered_write_tables(writes: &[BufferedWrite], schema: &SchemaManifest) -> BTreeSet<String> {
    writes
        .iter()
        .map(|write| write.table().to_owned())
        .filter(|table| schema.table(table).is_some())
        .collect()
}

fn class_deltas(declared: &[String], captured: &BTreeSet<String>) -> (Vec<String>, Vec<String>) {
    let declared: BTreeSet<&str> = declared.iter().map(String::as_str).collect();
    let missing = captured
        .iter()
        .filter(|table| !declared.contains(table.as_str()))
        .cloned()
        .collect();
    let extra = declared
        .iter()
        .filter(|table| !captured.contains(**table))
        .map(|table| (*table).to_owned())
        .collect();
    (missing, extra)
}

/// Compute the report from declared table sets and captured dependencies.
/// The caller supplies per-class provenance because only the invocation path
/// knows whether the capture is authoritative (success), partial (failure),
/// or absent by design (actions).
pub fn conformance_report(
    declared_reads: &[String],
    declared_writes: &[String],
    captured_reads: &[CapturedReadDependency],
    captured_writes: &[CapturedWriteDependency],
    read_provenance: DependencyProvenance,
    write_provenance: DependencyProvenance,
    schema: &SchemaManifest,
) -> DeclarationConformance {
    let captured_read_set = captured_read_tables(captured_reads, schema);
    let captured_write_set = captured_write_tables(captured_writes, schema);
    let (missing_reads, extra_reads) = class_deltas(declared_reads, &captured_read_set);
    let (missing_writes, extra_writes) = class_deltas(declared_writes, &captured_write_set);
    DeclarationConformance {
        missing_reads,
        missing_writes,
        extra_reads,
        extra_writes,
        read_provenance,
        write_provenance,
    }
}

fn undeclared_refusal(
    code: &'static str,
    class: &str,
    function_id: &str,
    table: &str,
    declared: &[String],
    source_span: Option<&SourceSpan>,
) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        code,
        "runtime",
        format!(
            "strict declarations: handler {function_id} {class} application table \
             {table} that its declaration does not name",
        ),
    )
    .with_details(serde_json::json!({
        "function": function_id,
        "table": table,
        "declared": declared,
        "sourceSpan": source_span
            .map(|span| serde_json::json!({
                "file": span.file,
                "line": span.line,
                "column": span.column,
            }))
            .unwrap_or(serde_json::Value::Null),
    }))
}

/// Strict-mode read enforcement (LLP 0146 D1 surface 3): under the per-app
/// opt-in, an opaque handler's application-table reads must be a subset of
/// its declared read set, refused at the runtime seam before any result
/// handoff.
///
/// @ref LLP 0146#d1-declarationobservation-conformance — strict mode is
///   opt-in and per-app (OQ1 ruling 2026-08-03: newly generated apps do not
///   opt in by default); LLP 0127 decision 6's declarations-as-evidence
///   posture stays the default.
pub fn enforce_strict_reads(
    schema: &SchemaManifest,
    function_id: &str,
    facts: Option<&StrictDeclarationFacts>,
    captured_reads: &[CapturedReadDependency],
) -> crate::diagnostic::SnapbackResult<()> {
    let Some(facts) = facts else {
        return Ok(());
    };
    if !schema.strict_declarations {
        return Ok(());
    }
    let declared_set: BTreeSet<&str> = facts.declared_reads.iter().map(String::as_str).collect();
    if let Some(table) = captured_read_tables(captured_reads, schema)
        .into_iter()
        .find(|table| !declared_set.contains(table.as_str()))
    {
        return Err(undeclared_refusal(
            "SNAPBACK_HANDLER_UNDECLARED_READ",
            "read",
            function_id,
            &table,
            &facts.declared_reads,
            facts.source_span.as_ref(),
        ));
    }
    Ok(())
}

/// Strict-mode write enforcement over the buffered (pre-commit) write set:
/// refusal happens before any durable effect.
pub fn enforce_strict_writes(
    schema: &SchemaManifest,
    function_id: &str,
    facts: Option<&StrictDeclarationFacts>,
    buffered_writes: &[BufferedWrite],
) -> crate::diagnostic::SnapbackResult<()> {
    let Some(facts) = facts else {
        return Ok(());
    };
    if !schema.strict_declarations {
        return Ok(());
    }
    let declared_set: BTreeSet<&str> = facts.declared_writes.iter().map(String::as_str).collect();
    if let Some(table) = buffered_write_tables(buffered_writes, schema)
        .into_iter()
        .find(|table| !declared_set.contains(table.as_str()))
    {
        return Err(undeclared_refusal(
            "SNAPBACK_HANDLER_UNDECLARED_WRITE",
            "wrote",
            function_id,
            &table,
            &facts.declared_writes,
            facts.source_span.as_ref(),
        ));
    }
    Ok(())
}
