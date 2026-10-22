//! Admission for the transitional unified HTTP profile, before any writes.
// @ref LLP 3000.009.001.000#3.4 — adapters do not themselves admit background producers.
use crate::{Program, RuntimeError, Schema, ir::{ArgType, ProgramKind}};
use std::collections::BTreeMap;
pub(crate) fn admit(schema: &Schema, programs: &BTreeMap<String, Program>) -> Result<(), RuntimeError> {
    fn refuse(family: &'static str) -> Result<(), RuntimeError> { Err(RuntimeError::StoreUnsupported { family }) }
    if schema.tables.values().any(|t| t.sync.as_ref().is_some_and(crate::schema::Sync::is_union)) { return refuse("union-sync"); }
    if schema.tables.values().any(|t| t.not_before.is_some()) { return refuse("time-publication"); }
    fn asset(arg: &ArgType) -> bool {
        match arg {
            ArgType::Image { .. } | ArgType::Video { .. } | ArgType::File { .. } => true,
            ArgType::Optional(inner) | ArgType::List { of: Some(inner), .. } | ArgType::ListRange { of: Some(inner), .. } => asset(inner),
            _ => false,
        }
    }
    if schema.tables.values().any(|t| t.columns.values().any(|c| c.contains_asset())) || programs.values().any(|p| p.args.values().any(asset)) { return refuse("assets"); }
    if !schema.routes.is_empty() { return refuse("routes"); }
    if !schema.schedules.is_empty() { return refuse("schedules"); }
    if programs.values().any(|p| p.native) { return refuse("native"); }
    if programs.values().any(|p| p.kind == ProgramKind::Job) { return refuse("jobs"); }
    if programs.values().any(|p| p.kind == ProgramKind::Action) { return refuse("actions"); }
    if schema.maintains.iter().any(|m| m.row_key.is_some()) { return refuse("view-recount"); }
    if super::refuse_maintained_columns(schema).is_err() { return refuse("maintained-columns"); }
    // Ephemeral hubs use process-local state and are deliberately admitted.
    schema.validate_column_owners()?;
    if let Some(issue) = crate::schema::validate(schema).first() {
        return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
    }
    Ok(())
}
