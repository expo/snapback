//! Printed static facts and cold-partition measurements use the same compiler
//! and snapshot path as the backend; there is no residency estimate.
use snapback4_core::{Engine, wire};
use snapback4_core::schema::Execution;
use snapback4_lang::{Bound, bind::residency};
use std::collections::BTreeMap;

pub fn facts(bound: &Bound) -> String {
    let mut lines = vec!["residency (facts)".to_owned()];
    for (name, table) in &bound.schema.tables {
        let caps = table.constraints.iter().filter_map(|constraint| match constraint {
            snapback4_core::schema::Constraint::Cap { by, max } => Some(format!("; cap {max} by {}", by.join(", "))), _ => None,
        }).collect::<String>();
        lines.push(format!("  {name}: {}{caps}", residency::table_line(&bound.schema, name)));
    }
    lines.push("operations (facts)".into());
    for (name, fact) in &bound.schema.operations { lines.push(residency::operation_lines(name, fact)); }
    lines.join("\n")
}

pub fn previous(project: &crate::project::Project) -> BTreeMap<String, Execution> {
    std::fs::read(project.generated_dir().join("residency.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}
pub fn remember(project: &crate::project::Project, bound: &Bound) -> std::io::Result<()> {
    std::fs::write(project.generated_dir().join("residency.json"), serde_json::to_vec_pretty(&bound.schema.operations)?)
}

// @ref LLP 3000.007#6.8 — measure the actual cold snapshot, including inherited aggregates and horizons.
pub fn measure(engine: &mut Engine, bound: &Bound, personas: &[String]) -> Result<(), snapback4_core::error::RuntimeError> {
    println!("{}", facts(bound));
    println!("residency (measurements): cold rows; bytes = compact JSON row payloads, excluding transport framing");
    let mut total = (0_u64, 0_u64);
    for persona in personas {
        let principal = if persona.contains(':') { persona.clone() } else { crate::project::persona_principal(persona) };
        let mut counts: BTreeMap<String, (u64, u64)> = bound.schema.synced().map(|(name, _, _)| (name.to_owned(), (0, 0))).collect();
        let mut cursor = None;
        loop {
            let (events, _, next) = engine.snapshot_page(&principal, cursor.as_deref(), 2000)?;
            for event in events {
                if event.kind != snapback4_core::partition::EventKind::Put { continue; }
                if let Some(row) = &event.data && let Some(count) = counts.get_mut(&event.table) {
                    count.0 += 1;
                    count.1 += serde_json::to_vec(&wire::to_json(row)).expect("row JSON").len() as u64;
                }
            }
            cursor = next;
            if cursor.is_none() { break; }
        }
        let mut subtotal = (0, 0);
        for (table, (rows, bytes)) in counts {
            println!("  {persona} {table}: {rows} rows, {bytes} bytes");
            subtotal.0 += rows; subtotal.1 += bytes;
        }
        println!("  {persona} total: {} rows, {} bytes", subtotal.0, subtotal.1);
        total.0 += subtotal.0; total.1 += subtotal.1;
    }
    println!("  total across personas: {} rows, {} bytes", total.0, total.1);
    for note in &bound.notes {
        println!("note (fact): {note}");
    }
    for maintain in &bound.schema.maintains {
        if maintain.residency.inherited_from.is_some() {
            let rows = engine.store().rows(&maintain.target)?.len();
            let note = if bound.notes.iter().any(|note| note.code == "N_MAINTAIN_SYNCED" && note.message.starts_with(&format!("maintain {}:", maintain.target))) { " — N_MAINTAIN_SYNCED" } else { "" };
            println!("  maintain {} (measurement): {rows} value rows in the fixture/store{note}", maintain.target);
        }
    }
    Ok(())
}

/// Store counts are observations of the current generation, not an estimate of
/// the proposed schema or of a particular viewer's acquired partition.
pub(super) fn maintain_measurements(project: &crate::project::Project, bound: &mut Bound, explicit: Option<&String>) -> Result<(), String> {
    if !bound.notes.iter().any(|note| note.code == "N_MAINTAIN_SYNCED") { return Ok(()); }
    let path = explicit.map(std::path::PathBuf::from).unwrap_or_else(|| project.store_path());
    if !path.exists() { return Ok(()); }
    let store = snapback4_core::Store::open_read_only(&path).map_err(|e| e.to_string())?;
    for maintain in &bound.schema.maintains {
        if let Some(note) = bound.notes.iter_mut().find(|note| note.code == "N_MAINTAIN_SYNCED" && note.message.starts_with(&format!("maintain {}:", maintain.target))) {
            let rows = store.count(&maintain.target).map_err(|e| e.to_string())?;
            note.message.push_str(&format!("; current store measurement: {rows} value rows (before adoption; cold rows per viewer: `snapback4 test --residency`)"));
        }
    }
    Ok(())
}
