//! Printed static facts and cold-partition measurements use the same compiler
//! and snapshot path as the backend; there is no residency estimate.
use snapback4_core::{Engine, wire};
use snapback4_core::schema::Execution;
use snapback4_lang::{Bound, bind::residency};
use std::collections::BTreeMap;

pub fn facts(bound: &Bound) -> String {
    let mut lines = vec!["residency (facts)".to_owned()];
    for (name, table) in bound.schema.visible_tables() {
        let caps = table.constraints.iter().filter_map(|constraint| match constraint {
            snapback4_core::schema::Constraint::Cap { by, max } => Some(format!("; cap {max} by {}", by.join(", "))), _ => None,
        }).collect::<String>();
        lines.push(format!("  {name}: {}{caps}", residency::table_line(&bound.schema, name)));
        lines.extend(crate::column_cost::description(&bound.schema,name));
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

pub fn personas(bound: &Bound, options: &super::Options) -> Vec<String> {
    match options.flags.get("as") {
        Some(persona) => vec![persona.clone()],
        None if bound.personas.is_empty() => vec!["alice".into()],
        None => bound.personas.clone(),
    }
}

// @ref LLP 3000.007#6.8 — cost-order the real cold snapshot, not stored table sizes or estimates.
fn report(tx: &snapback4_core::store::Tx<'_>, schema: &snapback4_core::Schema, personas: &[String], verbose: bool) -> Result<String, snapback4_core::error::RuntimeError> {
    let mut counts = Vec::new();
    let mut totals = BTreeMap::new();
    let mut columns = BTreeMap::<(String,String), (u64,u64,u64)>::new();
    let now = snapback4_core::now_ms();
    for persona in personas {
        let principal = if persona.contains(':') { persona.clone() } else { crate::project::persona_principal(persona) };
        let mut tables: BTreeMap<String, (u64, u64)> = schema.synced().map(|(name, _, _)| (name.to_owned(), (0, 0))).collect();
        let mut cursor = None;
        loop {
            let page = snapback4_core::partition::snapshot_page(tx, schema, &principal, cursor, 2000, now)?;
            for event in page.events {
                if event.kind != snapback4_core::partition::EventKind::Put { continue; }
                if let Some(row) = &event.data && let Some(count) = tables.get_mut(&event.table) {
                    count.0 += 1;
                    count.1 += serde_json::to_vec(&wire::to_json(row)).expect("row JSON").len() as u64;
                    let maintained = &schema.tables[&event.table].maintained;
                    if !maintained.is_empty() {
                        // Snapshot images materialize implicit zeros; only the stored
                        // image distinguishes those from acquired persisted values.
                        let stored = tx.get(&event.table, &event.id)?.ok_or_else(||
                            snapback4_core::RuntimeError::Store("residency snapshot parent is missing in the same transaction".into()))?;
                        for column in maintained.keys() {
                            let n=columns.entry((persona.clone(),format!("{}.{column}",event.table))).or_default();
                            if let Ok(value) = stored.field(column) {
                                n.0 += 1;
                                n.1 += serde_json::to_vec(&wire::to_json(value)).expect("value JSON").len() as u64;
                            } else { n.2 += 1; }
                        }
                    }
                }
            }
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        let subtotal = tables.values().fold((0, 0), |(rows, bytes), (r, b)| (rows + r, bytes + b));
        totals.insert(persona.clone(), subtotal);
        counts.extend(tables.into_iter().map(|(table, (rows, bytes))| (persona.clone(), table, rows, bytes)));
    }
    counts.sort_by(|a, b| b.3.cmp(&a.3).then(b.2.cmp(&a.2)).then(a.1.cmp(&b.1)).then(a.0.cmp(&b.0)));
    let mut lines = vec!["residency (measurements): cold rows; bytes = compact JSON row payloads, excluding transport framing".to_owned(),
        format!("  largest acquired tables by bytes ({} persona{}; top 8, --verbose for all)", personas.len(), if personas.len() == 1 { "" } else { "s" })];
    let shown = if verbose { counts.len() } else { counts.len().min(8) };
    for (persona, table, rows, bytes) in &counts[..shown] { lines.push(format!("  {persona} {table}: {rows} rows, {bytes} bytes")); }
    if counts.len() > shown {
        let (rows, bytes) = counts[shown..].iter().fold((0, 0), |(rows, bytes), (_, _, r, b)| (rows + r, bytes + b));
        lines.push(format!("  other {} table/persona pairs: {rows} rows, {bytes} bytes", counts.len() - shown));
    }
    if verbose || personas.len() == 1 {
        for (persona, (rows, bytes)) in &totals { lines.push(format!("  {persona} total: {rows} rows, {bytes} bytes")); }
    }
    let (rows, bytes) = totals.values().fold((0, 0), |(rows, bytes), (r, b)| (rows + r, bytes + b));
    for ((persona,column),(rows,bytes,implicit_zeros)) in columns {
        lines.push(format!("  maintained column {persona} {column}: {rows} stored values in acquired parents, {bytes} stored-value bytes (included in parent payloads; no separate device rows); {implicit_zeros} implicit zeros (field absent from stored parent images)"));
    }
    for (name,_) in schema.visible_tables() { lines.extend(crate::column_cost::description(schema,name)); }
    lines.push(format!("  total across personas: {rows} rows, {bytes} bytes"));
    Ok(lines.join("\n"))
}

pub fn measure(engine: &mut Engine, bound: &Bound, personas: &[String], verbose: bool) -> Result<(), snapback4_core::error::RuntimeError> {
    if verbose { println!("{}", facts(bound)); }
    let tx = engine.store_mut().read_transaction()?;
    println!("{}", report(&tx, &bound.schema, personas, verbose)?);
    tx.rollback()?;
    if verbose {
        for note in &bound.notes { println!("note (fact): {note}"); }
        for maintain in bound.schema.maintains.iter().filter(|m| bound.schema.visible(&m.target)) {
            if maintain.residency.inherited_from.is_some() {
                let rows = engine.store().rows(&maintain.target)?.len();
                let note = if bound.notes.iter().any(|note| residency::maintain_note_names(note, &maintain.target)) { " — N_MAINTAIN_SYNCED" } else { "" };
                println!("  maintain {} (measurement): {rows} value rows in the fixture/store{note}", maintain.target);
            }
        }
    }
    Ok(())
}

pub fn at_check(project: &crate::project::Project, bound: &Bound, options: &super::Options) -> Result<Option<String>, String> {
    let personas = personas(bound, options);
    let verbose = options.flags.contains_key("verbose");
    if options.flags.contains_key("fixture") {
        let mut engine = super::test_fixture::engine(project, bound, options)?;
        let tx = engine.store_mut().read_transaction().map_err(|e| e.to_string())?;
        return report(&tx, &bound.schema, &personas, verbose).map(Some).map_err(|e| e.to_string());
    }
    let path = options.flags.get("store").map(std::path::PathBuf::from).unwrap_or_else(|| project.store_path());
    if !path.exists() {
        return Ok(None);
    }
    // Inspect the persisted generation, never adopt current source or label a new maintain's absent rows as zero acquisition.
    let mut store = snapback4_core::Store::open_read_only(&path).map_err(|e| e.to_string())?;
    let tx = store.read_transaction().map_err(|e| e.to_string())?;
    let encoded: String = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    let schema = serde_json::from_str(&encoded).map_err(|e| e.to_string())?;
    let measured = report(&tx, &schema, &personas, verbose).map_err(|e| e.to_string())?;
    Ok(Some(format!("{measured}\n  measured the active dev-store schema; current-source facts: check --residency --verbose")))
}

#[cfg(test)]
mod tests {
    #[test]
    fn maintained_values_distinguish_payload_bytes_from_implicit_zeros() {
        use snapback4_core::{Engine, Value, value::object};
        let before = "table posts:\n  at: time\n  public\n  sync public\ntable likes:\n  postId: posts\n  public\n  online only\n";
        let old = snapback4_lang::compile(&[("schema.q".into(), before.into())]);
        let mut engine = Engine::memory(old.schema, []).unwrap();
        engine.seed([
            ("posts".into(), object([("id", Value::Id("p".into())), ("at", Value::Int(1))])),
            ("posts".into(), object([("id", Value::Id("zero".into())), ("at", Value::Int(2))])),
            ("likes".into(), object([("id", Value::Id("l".into())), ("postId", Value::Id("p".into()))])),
        ]).unwrap();
        let next = snapback4_lang::compile(&[("schema.q".into(), before.replace("  at: time", "  at: time\n  likeCount: count likes by postId"))]);
        assert!(next.diagnostics.is_empty(), "{:?}", next.diagnostics);
        engine.adopt(next.schema.clone(), []).unwrap();
        let tx = engine.store_mut().read_transaction().unwrap();
        let report = super::report(&tx, &next.schema, &["alice".into()], false).unwrap();
        assert!(report.contains("posts.likeCount: 1 stored values in acquired parents, 1 stored-value bytes"), "{report}");
        assert!(report.contains("1 implicit zeros (field absent from stored parent images)"), "{report}");
    }
}
