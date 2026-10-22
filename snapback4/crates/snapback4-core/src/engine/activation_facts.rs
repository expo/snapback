//! Candidate metadata is executable: never erase it merely to admit evolution.
// @ref LLP 3000.009.001.000#9 — column evolution changes derived prices, not arbitrary execution declarations.
use crate::{Program, RuntimeError, Schema, ir::ProgramKind, schema::{Execution, ResidencySite, SiteClass}};
use std::collections::BTreeMap;

pub(super) fn ordinary(schema: &Schema) -> Schema {
    let mut ordinary = schema.clone();
    ordinary.tables.retain(|name, _| schema.private_owner(name).is_none());
    ordinary.maintains.retain(|m| m.private.is_none());
    for table in ordinary.tables.values_mut() {
        table.columns.retain(|field, _| !table.maintained.contains_key(field));
        table.indexes.retain(|_, index| !index.columns().iter().any(|field| table.maintained.contains_key(field)));
        table.maintained.clear();
    }
    // Execution is compared separately against unchanged programs below. Prices
    // and the receipt graph must be recalculated on this reduced declaration.
    ordinary.operations.clear();
    ordinary.source_reservations.clear();
    ordinary.receipt_dependencies.clear();
    ordinary.prepare_contribution_indexes();
    ordinary.prepare_receipt_dependencies();
    ordinary
}

pub(super) fn prepare(schema: &mut Schema) -> Result<(), RuntimeError> {
    let mut derived = schema.clone();
    // The fixed-point helper also serves projected device schemas, where it
    // deliberately preserves seeds. A full server schema derives from nothing.
    derived.receipt_dependencies.clear();
    derived.prepare_receipt_dependencies();
    if !schema.receipt_dependencies.is_empty() && schema.receipt_dependencies != derived.receipt_dependencies {
        return Err(RuntimeError::Schema("receipt dependencies differ from the schema derivation".into()));
    }
    if !schema.source_reservations.is_empty() && schema.source_reservations != derived.source_reservations {
        return Err(RuntimeError::Schema("source reservations differ from the schema derivation".into()));
    }
    schema.receipt_dependencies = derived.receipt_dependencies;
    schema.source_reservations = derived.source_reservations;
    Ok(())
}

// `held` is an author declaration absent from IR, not a derivable runtime hint.
// Preserve all execution declarations for unchanged programs. Only diagnostic
// locations may move when a maintained declaration adds/removes source lines.
pub(super) fn check_operations(previous: &Schema, next: &Schema,
    before: &BTreeMap<String, Program>, after: &BTreeMap<String, Program>,
) -> Result<(), RuntimeError> {
    // Reopening a stored backend may only refresh derived
    // layout/reservations. Preserve its historical execution declarations;
    // it is not a request to replace them with this compiler's newer facts.
    // One-way equality includes every operation fact, so a caller cannot use
    // this path to change held, prediction, capability flags or declarations.
    let mut prepared_previous = previous.clone();
    prepared_previous.prepare_contribution_indexes();
    prepared_previous.prepare_delivery_lookup();
    if before == after && prepared_previous == *next { return Ok(()); }
    // General SQLite evolution may deliberately change residency through rules,
    // sync, etc. This check governs only the otherwise-unchanged declarations
    // admitted by the Postgres column slice, including metadata-only forgeries.
    if ordinary(previous) != ordinary(next) { return Ok(()); }
    for name in previous.operations.keys().chain(next.operations.keys()).filter(|name| !before.contains_key(*name) && !after.contains_key(*name)) {
        if previous.operations.get(name) != next.operations.get(name) {
            return Err(RuntimeError::Schema(format!("{name}: execution facts changed without a program change")));
        }
    }
    fn unlocated(mut value: serde_json::Value) -> serde_json::Value {
        fn walk(value: &mut serde_json::Value) {
            match value {
                serde_json::Value::Object(fields) => {
                    if fields.contains_key("Literal") { return; }
                    fields.remove("site");
                    for value in fields.values_mut() { walk(value); }
                    if let Some(serde_json::Value::Array(sites)) = fields.get_mut("sites") { sites.sort_by_key(serde_json::Value::to_string); }
                }
                serde_json::Value::Array(values) => for value in values { walk(value); },
                _ => {}
            }
        }
        walk(&mut value); value
    }
    for (name, program) in after {
        let Some(old) = before.get(name) else { continue; };
        if unlocated(serde_json::to_value(old).expect("program serialization"))
            != unlocated(serde_json::to_value(program).expect("program serialization")) { continue; }
        let expected = previous.operations.get(name).map(|fact| rederive(next, program, fact.clone()));
        let old = unlocated(serde_json::to_value(expected).expect("execution serialization"));
        let new = unlocated(serde_json::to_value(next.operations.get(name)).expect("execution serialization"));
        if old != new {
            return Err(RuntimeError::Schema(format!("{name}: execution facts changed without a program change")));
        }
    }
    Ok(())
}

// Ordinary declarations and the program are unchanged. Retain their admitted
// execution declarations, and re-derive precisely the facts column maintenance
// can affect. In particular, an added receipt-dependent sum makes its source
// mutation never-predicting even though that mutation's IR did not change.
fn rederive(schema: &Schema, program: &Program, mut fact: Execution) -> Execution {
    let was_server = fact.sites.iter().any(|site| site.class == SiteClass::Server);
    fact.sites.retain(|site| site.kind != "source reservation" && site.kind != "deferred receipt maintenance"
        && !(site.kind == "receipt dependency" && site.reason.starts_with("write to ") && site.reason.contains(" evaluates receipt-derived maintenance ")));
    for (table, effect) in crate::ir::write_tables(program) {
        if let Some(reason) = schema.write_prediction_refusal(&table) {
            fact.sites.push(ResidencySite { site: String::new(), table: table.clone(), index: String::new(),
                kind: "source reservation".into(), class: SiteClass::Server, reason: reason.into(),
                rewrite: "queue this mutation for the server's complete maintenance".into() });
        }
        for maintain in schema.maintains.iter().filter(|maintain| maintain.private.is_none()
            && schema.receipt_dependencies.contains_key(&maintain.target)
            && (maintain.source == table || maintain.row_key.as_ref().is_some_and(|key| key.table == table))) {
            fact.sites.push(ResidencySite { site: String::new(), table: table.clone(), index: String::new(),
                kind: "deferred receipt maintenance".into(), class: SiteClass::Held,
                reason: format!("receipt-derived maintenance {} stays settled during prediction; affected groups report incomplete until settlement", maintain.target), rewrite: String::new() });
        }
        if program.kind == ProgramKind::Mutation && !fact.sites.iter().any(|site| site.kind == "receipt dependency") {
            if let Some(reason) = schema.receipt_maintenance_refusal(&table, effect) {
                fact.sites.insert(0, ResidencySite { site: String::new(), table, index: String::new(),
                    kind: "receipt dependency".into(), class: SiteClass::Server, reason,
                    rewrite: "queue this mutation for server settlement; predict using only non-clause fields and stable ids".into() });
            }
        }
    }
    let server = fact.sites.iter().any(|site| site.class == SiteClass::Server);
    if program.kind == ProgramKind::Mutation && fact.predicts.is_some() && server != was_server {
        fact.predicts = Some(if server { "never" } else { "eligible" }.into());
    }
    fact
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_layout_refresh_preserves_facts_and_rejects_fact_changes() {
        // Authentic predecessor bytes, not a current schema stripped of facts.
        let backend: serde_json::Value = serde_json::from_str(include_str!(
            "../../../snapback4-lang/tests/fixtures/rp-predecessor/backend.json")).unwrap();
        let before: Schema = crate::json_codec::from_text(&backend["schema"].to_string()).unwrap();
        let programs: Vec<Program> = crate::json_codec::from_text(&backend["programs"].to_string()).unwrap();
        let programs: BTreeMap<String, Program> = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let mut refreshed = before.clone();
        refreshed.prepare_contribution_indexes();
        refreshed.prepare_delivery_lookup();
        assert_eq!(refreshed.operations, before.operations);
        check_operations(&before, &refreshed, &programs, &programs).unwrap();
        let mut changed_programs = programs.clone();
        // An unrelated query edit must not authorize the legacy-only repair.
        changed_programs.get_mut("badge").unwrap().body = vec![crate::ir::Stmt::Return(
            crate::ir::Expr::Literal(crate::Value::Int(42)))];
        let error = check_operations(&before, &refreshed, &programs, &changed_programs).unwrap_err();
        assert!(error.to_string().contains("execution facts changed"), "{error}");
        for change in 0..4 {
            let mut forged = refreshed.clone();
            match change {
                0 => forged.operations.get_mut("badge").unwrap().held = true,
                1 => forged.operations.get_mut("badge").unwrap().branch_merge = true,
                2 => forged.operations.get_mut("send").unwrap().predicts = Some("eligible".into()),
                _ => { forged.operations.insert("ghost".into(), forged.operations["badge"].clone()); }
            }
            let error = check_operations(&before, &forged, &programs, &programs).unwrap_err();
            assert!(error.to_string().contains("execution facts changed"), "{change}: {error}");
        }
    }
}
