//! A write whose value can only be the reserved system principal is refused
//! at `check`; the engine's runtime refusal stays the backstop for values
//! that flow through locals and arguments.
use super::*;
use crate::ast::{ScalarType, TypeKind};

// @ref LLP 3000.036#4 — refuse at bind what would always park the job (or fail the write) at runtime.
impl Binder<'_> {
    pub(super) fn system_principal_write(&self, info: &TableInfo, op: &WriteOp, fields: &[ObjectField], if_absent: bool, site: &Site) -> Fallible<()> {
        let job = self.caller_kind == ProgramKind::Job;
        // At a full sequence an if-absent duplicate is a no-op before validation.
        if if_absent && info.decl.columns.iter().any(|column| column.sequence.is_some()) { return Ok(()); }
        // A later spread can replace an explicit field; never guess its value.
        if fields.iter().any(|field| field.spread) { return Ok(()); }
        let table = &info.decl.name;
        let immutable = |name: &str| info.decl.immutable.iter().any(|(columns, _)| columns.iter().any(|column| column == name));
        for field in fields {
            let Some(column) = info.columns.get(&field.name) else { continue };
            if !carries_principal(column) { continue; }
            // A patch of an immutable column is dropped against a hidden row, so it can succeed.
            if *op != WriteOp::Insert && immutable(&field.name) { continue; }
            let Some(value) = field.value.as_ref() else { continue };
            if let Some(cause) = reserved(value, job) {
                return Err(refusal(&field.site, table, &field.name, column, cause, false, job));
            }
        }
        // An insert that omits the column stores its default. An upsert's insert
        // arm runs only when the row is absent, so its update arm can succeed.
        if *op == WriteOp::Insert {
            for column in &info.decl.columns {
                if fields.iter().any(|field| field.name == column.name) || !carries_principal(&column.type_) { continue; }
                let cause = match column.default.as_ref() {
                    Some(A::Name { name, .. }) if job && name == "viewer" => "this insert omits it and its `default viewer` is the system in a job",
                    Some(value) if reserved(value, false).is_some() => "this insert omits it and its default is the literal 'system'",
                    _ => continue,
                };
                return Err(refusal(site, table, &column.name, &column.type_, cause, true, job));
            }
        }
        Ok(())
    }
}

fn carries_principal(column: &ScalarType) -> bool {
    match &column.kind {
        TypeKind::Principal => true,
        TypeKind::List { item, .. } => carries_principal(item),
        _ => false,
    }
}

/// Only a value that is the system principal wherever it runs: the literal,
/// or a job's `viewer`, alone or as a list item. Conditionals stay runtime.
fn reserved(value: &A, job: bool) -> Option<&'static str> {
    match value {
        A::Literal { value: Literal::Str(text), .. } if text == snapback4_core::SYSTEM_PRINCIPAL => Some("this writes the literal 'system'"),
        A::Name { name, .. } if job && name == "viewer" => Some("this writes `viewer`, which in a job (outside `as`) is the system"),
        A::Array { items, .. } => items.iter().find_map(|item| reserved(item, job)),
        _ => None,
    }
}

fn refusal(site: &Site, table: &str, column: &str, kind: &ScalarType, cause: &str, default: bool, job: bool) -> Diagnostic {
    let rewrite = if matches!(kind.kind, TypeKind::List { .. }) {
        format!("leave the system out of {column}: a list holds only stored principals (`{column}: []` for none)")
    } else {
        format!("{}make the column optional and write null for system events (`{column}: principal ?`, then `{column}: null`), or name a service principal (`{column}: 'service:reminders'`)", if default { "drop the default and write the column: " } else { "" })
    };
    Diagnostic::new(site, "E_SYSTEM_PRINCIPAL_WRITE",
        format!("{table}.{column} cannot store the reserved system principal, and {cause}: the write can never succeed and {}", if job { "would park the job at runtime" } else { "would refuse with E_INPUT at runtime" }), rewrite)
        .guide("jobs")
}
