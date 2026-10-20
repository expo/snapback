//! Snapshot populations and conservative operation dependencies, grouped by table.
// @ref LLP 3000.000.000#14-wave-14-rollback-narration — rollback names changed populations and quotas before schema mechanics.
use snapback4_core::{Schema, Store, Value, ir, schema::ColumnType, store::DormantItem};
use std::collections::{BTreeMap, BTreeSet};

fn tables(value: &serde_json::Value, out: &mut BTreeSet<String>) {
    match value {
        serde_json::Value::Object(fields) => for (key, value) in fields {
            if key == "table" { if let Some(table) = value.as_str() { out.insert(table.into()); } }
            else { tables(value, out); }
        },
        serde_json::Value::Array(items) => for item in items { tables(item, out); },
        _ => (),
    }
}
fn reads(schema: &Schema, program: &ir::Program) -> BTreeSet<String> {
    let mut reads: BTreeSet<_> = ir::read_sites(program).into_iter().map(|site| site.table).collect();
    for (name, effect) in ir::write_tables(program) {
        if let Some(table) = schema.table(&name) {
            use snapback4_core::schema::Effect;
            let effects = match effect { "insert" => vec![Effect::Insert], "update" => vec![Effect::Update], "delete" => vec![Effect::Delete], _ => vec![Effect::Insert,Effect::Update] };
            for effect in effects { tables(&serde_json::to_value(table.rules.for_effect(effect)).unwrap(), &mut reads); }
        }
    }
    let mut visited = BTreeSet::new();
    while let Some(name) = reads.iter().find(|name| !visited.contains(*name)).cloned() {
        visited.insert(name.clone());
        for maintain in schema.maintains.iter().filter(|m| m.target == name || m.private.as_ref().is_some_and(|owner|owner.table==name)) { reads.insert(maintain.source.clone()); }
        if let Some(table) = schema.table(&name) {
            tables(&serde_json::to_value(&table.rules.read).unwrap(), &mut reads);
            if let Some(parent) = &table.through { reads.insert(parent.parent.clone()); }
        }
    }
    reads
}

pub(super) fn capture(store: &Store) -> Result<(), String> {
    store.capture_preview_active()
}
fn refs(kind: &ColumnType, value: &Value, out: &mut Vec<(String,String)>) {
    match (kind,value) {
        (ColumnType::Optional(inner),v) => refs(inner,v,out),
        (ColumnType::List {of,..} | ColumnType::ListRange {of,..},Value::Array(values)) => for v in values {refs(of,v,out);},
        (ColumnType::Ref {table},Value::Id(id)) => out.push((table.clone(),id.clone())),
        _ => (),
    }
}

pub(super) fn warnings(store: &Store, current: Option<&Schema>, schema: &Schema, programs: &BTreeMap<String, ir::Program>, items: &[DormantItem], release: u64, rollback: bool) -> Result<Vec<String>,String> {
    let mut query_readers = BTreeMap::<String,BTreeSet<String>>::new();
    let mut gates = BTreeMap::<String,BTreeSet<String>>::new();
    for (name, program) in programs {
        let by_table = if program.kind == ir::ProgramKind::Query { &mut query_readers } else { &mut gates };
        for table in reads(schema,program) { by_table.entry(table).or_default().insert(name.clone()); }
    }
    let mut warnings=Vec::new();
    let mut rollback_summaries=Vec::new();
    // Table populations are facts; arbitrary args/viewers/predicates are not.
    for (table, operations) in &query_readers {
        let (before,after,lost):(i64,i64,i64)=store.preview_populations(table)?;
        if lost>0 {
            warnings.push(format!("queries/counts {} read {table}: active table population {before} → {after}, {lost} active {} {}; verify filtered results and progress denominators before selecting release {release} (dependency, not a query-result count)",operations.iter().cloned().collect::<Vec<_>>().join(", "),if lost==1 {"row"} else {"rows"},if lost==1 {"leaves"} else {"leave"}));
        }
        if rollback && before!=after {rollback_summaries.push(format!("rollback users get release {release}'s {table} population: {before} → {after} active rows for queries/counts {}; verify results, denominators and quota use, or preserve the current value domain and dependents in a bridge release before activation",operations.iter().cloned().collect::<Vec<_>>().join(", ")));}
    }
    if rollback {if let Some(current)=current {
        fn caps(schema: &Schema,table: &str) -> Vec<String> {
            schema.table(table).into_iter().flat_map(|table|&table.constraints).filter_map(|constraint|match constraint {
                snapback4_core::schema::Constraint::Cap {by,max}=>Some(format!("cap {max} by {}",by.join(", "))),_=>None,
            }).collect()
        }
        for table in current.tables.keys().filter(|table|schema.table(table).is_some()) {
            let (before,after)=(caps(current,table),caps(schema,table));
            if before!=after {rollback_summaries.push(format!("rollback users get release {release}'s quotas on {table}: current [{}] → target [{}]; verify the active population fits the intended limits, or preserve current quotas in a bridge release before activation",before.join("; "),after.join("; ")));}
        }
    }}
    // Only actual before-active rows retained dormant can be dependent losses.
    let mut dependents=BTreeMap::<String,(u64,BTreeSet<String>)>::new();
    store.visit_preview_lost(|name,_,data| {
        let Some(table)=schema.table(&name) else {return Ok(());};
        let mut row:Value=serde_json::from_str(&data).map_err(|e|e.to_string())?;
        snapback4_core::schema::materialize_optional_fields(&mut row,table);
        let mut edges=Vec::new();
        for (column,kind) in &table.columns {if let Ok(value)=row.field(column) {refs(kind,value,&mut edges);}}
        let mut parents=BTreeSet::new();
        for (parent,id) in edges {
            let dormant:bool=store.preview_parent_dormant(&parent,&id)?;
            if dormant {parents.insert(parent);}
        }
        if !parents.is_empty() {let group=dependents.entry(name).or_default();group.0+=1;group.1.extend(parents);}
        Ok(())
    })?;
    for (table,(count,parents)) in dependents {
        warnings.push(format!("dependent {table}: {count} active {} {} dormant with parent tables {}; preserve these linked records in a bridge or accept their absence in release {release}",if count==1 {"row"} else {"rows"},if count==1 {"goes"} else {"go"},parents.into_iter().collect::<Vec<_>>().join(", ")));
    }
    let mut inventory=BTreeMap::<String,(u64,BTreeSet<String>)>::new();
    for item in items.iter().filter(|i|i.rows>0 && matches!(i.kind.as_str(),"rows"|"table")) {
        let group=inventory.entry(item.path.clone()).or_default(); group.0+=item.rows;group.1.extend(item.sample_ids.iter().cloned());
    }
    for (table,(count,samples)) in inventory {
        if let Some(operations)=gates.get(&table) {
            warnings.push(format!("release {release}'s safety dependencies on {table}: {} cannot see {count} dormant {table} {} (sample ids [{}]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)", operations.iter().map(|s|format!("`{s}`")).collect::<Vec<_>>().join(", "),if count==1 {"row"} else {"rows"},samples.into_iter().take(5).collect::<Vec<_>>().join(", ")));
        }
    }
    warnings.extend(rollback_summaries);
    Ok(warnings)
}
