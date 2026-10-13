//! Operator preflight runs the real activation on a private disk-backed snapshot.
// @ref LLP 3000.000.000#92-exact-preview-and-operator-vocabulary — no live pointer, generation or audit changes.
use super::*;
use std::path::{Path, PathBuf};
struct Snapshot(PathBuf);
impl Drop for Snapshot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn preview(
    store_path: &Path,
    root: PathBuf,
    release: u64,
    options: &Options,
) -> Result<(), String> {
    let bound = super::releases::bound_at(root.clone())?;
    let project = Project { root };
    let native = crate::native::prepare(&project, &bound).map_err(|e| e.to_string())?;
    crate::dev_worker::prepare_release(&project,&bound.schema)?;
    let id = snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::seed())
        .map_err(|e| e.to_string())?;
    let snapshot = Snapshot(std::env::temp_dir().join(format!("snapback4-release-preview-{id}")));
    snapback4_core::private_fs::directory(&snapshot.0).map_err(|e| e.to_string())?;
    let path = snapshot.0.join("store.sqlite");
    // SQLite VACUUM INTO takes a coherent read snapshot even with a live WAL writer.
    // Busy/disk errors refuse this preview; never fall back to copying database bytes.
    if store_path.exists() {
    let source = snapback4_core::Store::open_read_only(store_path).map_err(|e| e.to_string())?;
    source
        .conn()
        .execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .map_err(|e| {
            format!("snapshot preview failed (retry after store/disk becomes available): {e}")
        })?;
    drop(source);
    }
    let mut store = snapback4_core::Store::open(&path).map_err(|e| e.to_string())?;
    let held = store
        .release_status(0, None, None)
        .map_err(|e| e.to_string())?;
    let mut activation =
        snapback4_core::engine::release::ReleaseActivation::new(release, held["release"].as_u64());
    activation.expected_revision = held["revision"].as_u64();
    activation.native_digest = native.installed.map(|n| n.digest);
    activation.operation = "preview".into();
    activation.restore_dormant = !options.flags.contains_key("deploy-direction") || options.flags.contains_key("restore-dormant");
    let mut steps = Vec::new();
    let estimate = store
        .adoption_estimate(&bound.schema)
        .map_err(|e| e.to_string())?
        .map(|e| e.summary());
    let candidate_schema=bound.schema.clone();
    let candidate_programs:std::collections::BTreeMap<_,_>=bound.programs.iter().map(|p|(p.program.name.clone(),p.program.clone())).collect();
    let mut hazards=Vec::new();
    let prior:Option<(String,String)>=store.conn().query_row("SELECT schema,programs FROM _generations WHERE generation=(SELECT CAST(value AS INTEGER) FROM _meta WHERE key='generation')",[],|r|Ok((r.get(0)?,r.get(1)?))).ok();
    if let Some((schema,programs))=prior {
        let prior:snapback4_core::Schema=serde_json::from_str(&schema).map_err(|e|e.to_string())?;
        steps=snapback4_core::successor::classify(&prior,&candidate_schema);
        let programs:std::collections::BTreeMap<String,snapback4_core::ir::Program>=serde_json::from_str(&programs).map_err(|e|e.to_string())?;
        for schedule in &prior.schedules {
            if !candidate_schema.schedules.contains(schedule) || programs.get(&schedule.target)!=candidate_programs.get(&schedule.target) {
                hazards.push(format!("scheduled job {}: target lacks this schedule or its logic",schedule.target));
            }
        }
        for name in prior.tables.keys().filter(|name|!candidate_schema.tables.contains_key(*name) && prior.maintain_for(name).is_none() && prior.tables[*name].ephemeral.is_none()) {
            let count:u64=store.conn().query_row("SELECT COUNT(*) FROM r WHERE t=(SELECT num FROM _catalog WHERE name=?1)",[name],|r|r.get::<_,i64>(0).map(|n|n as u64)).map_err(|e|e.to_string())?;
            if count>0 {hazards.push(format!("table {name} (holds or other safeguards): {count} rows become dormant; target lacks their safeguards"));}
        }
    }
    let mut engine = snapback4_core::Engine::new_release_prepared(
        store,
        bound.schema,
        bound.programs.into_iter().map(|p| p.program),
        &activation,
        options.flags.contains_key("allow-feed-adoption"),
    )
    .map_err(|e| e.to_string())?;
    let mut planned = engine
        .store_mut()
        .release_status(0, None, None)
        .map_err(|e| e.to_string())?;
    planned["items"] = serde_json::to_value(
        engine
            .store_mut()
            .dormant_inventory(None, usize::MAX)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    steps.retain(|step|!step.message.contains("engine capture"));
    for step in &mut steps {
        if step.change==snapback4_core::successor::Change::Narrowing {
            step.change=snapback4_core::successor::Change::Additive;
            step.message=format!("{}; active rows satisfy the candidate after dormant projection",step.message.split(';').next().unwrap_or(&step.message));
        }
        if let Some(position)=step.path.strip_prefix("maintains[").and_then(|s|s.strip_suffix(']')).and_then(|s|s.parse::<usize>().ok()) {
            let label=candidate_schema.maintains[position].label();
            let visits=engine.store().adoption_report.views.iter().find(|view|view.name==label).map(|v|v.rows).unwrap_or(0);
            step.message=format!("maintain {label}: rebuilt from {visits} source rows");
            step.change=snapback4_core::successor::Change::Additive;
        }
        let path=step.path.strip_prefix("tables.").unwrap_or(&step.path).replace(".columns.",".");
        let count=planned["items"].as_array().into_iter().flatten().find(|i|i["path"].as_str()==Some(path.as_str())).and_then(|i|i["rows"].as_u64()).unwrap_or(0);
        step.message=step.message.replace("its rows are lost",&format!("its rows become dormant ({count} rows; restored on forward)")).replace("its values are lost",&format!("its values become dormant ({count} rows; restored on forward)"));
    }
    if options.json {
        println!("{}",serde_json::to_string_pretty(&serde_json::json!({"preview":true,"hazards":hazards,"current":held,"plan":planned,"steps":steps,"estimate":estimate,"phases":engine.store().adoption_report.summary()})).unwrap());
    } else {
        let rows: u64 = planned["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| i["kind"] == "rows")
            .filter_map(|i| i["rows"].as_u64())
            .sum();
        println!("preview: release {release} would be current as generation {}; {rows} dormant narrowed rows; live release unchanged",engine.generation());
        for step in steps {println!("  {}: {}",step.path,step.message);}
        for hazard in hazards {println!("  WARNING {hazard}");}
        for item in planned["items"].as_array().into_iter().flatten() {
            println!("  {}: {} rows dormant (restored on forward); sample ids {}", item["key"], item["rows"],item["sample_ids"]);
        }
        if options.flags.contains_key("verbose") {
            println!("{}", engine.store().adoption_report.summary());
            if let Some(estimate) = estimate {
                println!("{estimate}");
            }
        }
    }
    Ok(())
}
