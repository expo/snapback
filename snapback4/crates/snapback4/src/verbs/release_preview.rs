//! Operator preflight runs the real activation on a private disk-backed snapshot.
// REL3 owns dormant-visibility counts here; SURF clause narration lives in release_narration.
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
    held_owner: Option<&crate::store_owner::Owner>,
) -> Result<(), String> {
    let bound = super::releases::bound_at(root.clone())?;
    let project = Project { root };
    let native = crate::native::prepare(&project, &bound).map_err(|e| e.to_string())?;
    crate::dev_worker::prepare_release(&project,&bound.schema)?;
    let id = snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::Mint::default())
        .map_err(|e| e.to_string())?;
    let snapshot = Snapshot(std::env::temp_dir().join(format!("snapback4-release-preview-{id}")));
    snapback4_core::private_fs::directory(&snapshot.0).map_err(|e| e.to_string())?;
    let path = snapshot.0.join("store.sqlite");
    // Probe the existing filesystem lock, independently of any HTTP address
    // hint. Keep a stopped store excluded through preview; never create a lock
    // sidecar or mutate its address record just to inspect ownership.
    let (live,_stopped_guard)=if held_owner.is_some() {(false,None)} else if store_path.exists() {
        let database=store_path.canonicalize().map_err(|e|e.to_string())?;
        match snapback4_core::private_fs::auxiliary_file(&database,&snapback4_core::private_fs::owner_path(&database),false,0) {
            Ok(owner)=>match owner.try_lock() {
                Ok(())=>(false,Some(owner)),
                Err(std::fs::TryLockError::WouldBlock)=>(true,None),
                Err(std::fs::TryLockError::Error(e))=>return Err(format!("preview owner probe failed: {e}")),
            },
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Err("preview cannot establish exclusive store ownership: missing owner sidecar; restart serve once, stop it, then retry".into()),
            Err(e)=>return Err(format!("preview owner probe failed: {e}")),
        }
    }else{(false,None)};
    // SQLite VACUUM INTO takes a coherent read snapshot even with a live WAL writer.
    // Busy/disk errors refuse this preview; never fall back to copying database bytes.
    if store_path.exists() {
    let source = snapback4_core::store_port::AnyStore::open_read_only(store_path).map_err(|e| e.to_string())?;
    source
        .snapshot_to(&path)
        .map_err(|e| {
            format!("snapshot preview failed (retry after store/disk becomes available): {e}")
        })?;
    drop(source);
    }
    let mut store = snapback4_core::store_port::AnyStore::open(&path).map_err(|e| e.to_string())?;
    let held = store
        .release_status(0, None, None)
        .map_err(|e| e.to_string())?;
    // @ref LLP 3000.000.000.002#4-staging-clock — preview uses the owning host's authoritative time, without minting or advancing anything.
    let activation_now=if live {
        let status=crate::release_control::request(store_path.parent().ok_or("preview store has no deployment directory")?,crate::release_control::Command::Status{after:0,items_after:None,event:None})?;
        if status["revision"]!=held["revision"] {return Err("preview raced release activation; retry against the current store".into());}
        status["clock"]["now"].as_i64().ok_or("serving owner does not expose its activation clock; restart it with this CLI before preview")?
    }else{snapback4_core::now_ms()};
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
    let mut client_compatibility=Vec::new();
    if let Some(current)=held["release"].as_u64() {
        let prior=super::releases::bound_at(store_path.parent().ok_or("no deployment directory")?.join("releases").join(current.to_string()))?;
        client_compatibility=snapback4_lang::client_contracts::compare(&prior,&bound,&format!("release {current}"));
    }
    let candidate_schema=bound.schema.clone();
    let candidate_programs:std::collections::BTreeMap<_,_>=bound.programs.iter().map(|p|(p.program.name.clone(),p.program.clone())).collect();
    let mut hazards=Vec::new();
    let mut notes=Vec::new();
    let prior:Option<(String,String)>=store.inspection_generation().ok();
    let prior_schema=prior.as_ref().map(|(schema,_)|serde_json::from_str::<snapback4_core::Schema>(schema).map_err(|e|e.to_string())).transpose()?;
    if let Some((schema,programs))=prior {
        let prior:snapback4_core::Schema=serde_json::from_str(&schema).map_err(|e|e.to_string())?;
        steps=snapback4_core::successor::classify(&prior,&candidate_schema);
        let programs:std::collections::BTreeMap<String,snapback4_core::ir::Program>=serde_json::from_str(&programs).map_err(|e|e.to_string())?;
        let target_label = format!("release {release}");
        let compatibility = super::release_narration::compatibility(&store, &prior, &candidate_schema, held["release"].as_u64().unwrap_or(0), &target_label, options.flags.contains_key("deploy-direction"))?;
        for line in compatibility {
            if let Some(warning) = line.strip_prefix("WARNING ") { hazards.push(warning.to_owned()); }
            else { notes.push(line.trim_start_matches("note: ").to_owned()); }
        }
        let rollback=!options.flags.contains_key("deploy-direction");
        let (behavior_warnings, behavior_notes) = super::release_narration::behavior(store_path, &store, &prior, &candidate_schema, &programs, &candidate_programs, &project, held["release"].as_u64(), &target_label, rollback)?;
        hazards.extend(behavior_warnings); notes.extend(behavior_notes);
        for name in prior.tables.keys().filter(|name|!candidate_schema.tables.contains_key(*name) && prior.maintain_for(name).is_none() && prior.tables[*name].ephemeral.is_none()) {
            let count:u64=store.inspection_table_population(name)?;
            if count>0 {hazards.push(format!("table {name}: {count} rows become dormant; {target_label} lacks this table's behavior; preserve it in a bridge or accept its absence"));}
        }
    }
    super::release_safeguards::capture(&store)?;
    let mut engine = snapback4_core::Engine::new_release_prepared_at(
        store,
        bound.schema,
        bound.programs.into_iter().map(|p| p.program),
        &activation,
        options.flags.contains_key("allow-feed-adoption"),
        activation_now,
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
    let items: Vec<snapback4_core::store_port::DormantItem> = serde_json::from_value(planned["items"].clone()).map_err(|e| e.to_string())?;
    let visibility = super::release_visibility::assess(engine.store(), prior_schema.as_ref(), &candidate_schema)?;
    let mut rollback_visibility = None;
    let mut effects = super::release_safeguards::warnings(engine.store(),prior_schema.as_ref(),&candidate_schema,&candidate_programs,&items,release,!options.flags.contains_key("deploy-direction"))?;
    effects.append(&mut hazards); hazards=effects;
    for fill in &engine.store().adoption_report.backfills { notes.push(format!("backfill: {fill}; confirm these historical values before selecting release {release}")); }
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
        let unit = if step.path.contains(".columns.") { "cells" } else if step.path.contains(".indexes.") { "entries" } else { "rows" };
        // @ref LLP 3000.000.000#11-wave-11-factual-release-narration — per-path prose uses the same disjoint counts as the inventory totals.
        let retained = if count == 0 && unit == "cells" {
            format!("no standalone {unit} become dormant (cells of any dormant rows are counted with those rows)")
        } else if count == 0 {
            format!("no {unit} become dormant")
        } else {
            format!("its {unit} become dormant ({count} {unit}; restored on forward)")
        };
        step.message=step.message.replace("its rows are lost", &retained).replace("its values are lost", &retained);
    }
    if options.flags.contains_key("deploy-direction") {
        if let Some(current) = held["release"].as_u64() {
            let old_root=store_path.parent().ok_or("no deployment directory")?.join("releases").join(current.to_string());
            let old=super::releases::bound_at(old_root.clone())?;
            hazards.extend(super::rollback_foresight::risks(&candidate_schema,&old.schema,current,store_path.parent().unwrap()));
            // Exact reverse adoption tests today's post-deploy image, separately from future-write risks.
            let reverse_path=snapshot.0.join("reverse.sqlite");
            engine.store().snapshot_to(&reverse_path).map_err(|e|e.to_string())?;
            let reverse_store=snapback4_core::store_port::AnyStore::open(&reverse_path).map_err(|e|e.to_string())?;
            super::release_safeguards::capture(&reverse_store)?;
            let native=crate::native::prepare(&Project {root:old_root},&old).map_err(|e|e.to_string())?;
            let mut reverse=snapback4_core::engine::release::ReleaseActivation::new(current,Some(release));
            reverse.restore_dormant=true;
            reverse.native_digest=native.installed.map(|m|m.digest);
            reverse.operation="preview".into();
            let old_schema=old.schema.clone();
            match snapback4_core::Engine::new_release_prepared_at(reverse_store,old.schema,old.programs.into_iter().map(|p|p.program),&reverse,options.flags.contains_key("allow-feed-adoption"),activation_now) {
                Ok(reverse_engine) => {
                    let effects=super::release_visibility::assess(reverse_engine.store(),Some(&candidate_schema),&old_schema)?;
                    if effects.hidden_rows>0 || effects.empty_cells>0 || effects.newer_only_rows>0 {
                        for line in effects.lines(release,current) { hazards.push(format!("rollback foresight: {}",line.trim())); }
                    }
                    rollback_visibility=Some(effects);
                },
                Err(error) => hazards.push(format!("rollback to release {current} refuses on the post-deploy snapshot: {error}; run `snapback4 rollback {} --to {current} --check --bridge <new-dir>` and preserve the required fields/domains in a bridge",store_path.parent().unwrap().display())),
            }
        }
    }
    hazards.extend(client_compatibility.iter().cloned());
    if options.flags.contains_key("validation-only") {
        if !options.flags.contains_key("deploy-direction") {
            for line in visibility.lines(held["release"].as_u64().unwrap_or(0),release) {eprintln!("{line}");}
        }
        for hazard in &hazards { eprintln!("WARNING {hazard}"); }
        return Ok(());
    }
    let checklist = super::release_bridge::checklist(held["release"].as_u64().unwrap_or(0),release,&hazards);
    if let Some(path) = options.flags.get("bridge") {
        let current = held["release"].as_u64().ok_or("a bridge needs a current deployed release")?;
        super::release_bridge::write(Path::new(path),store_path.parent().ok_or("no deployment directory")?,current,release,&checklist)?;
        eprintln!("bridge starter written to {path}; edit its current source and follow ROLLBACK-CHECKLIST.md before activation");
    }
    if options.json {
        println!("{}",serde_json::to_string_pretty(&serde_json::json!({"preview":true,"security":options.flags.get("security-summary"),"visibility":visibility,"rollbackVisibility":rollback_visibility,"clientCompatibility":client_compatibility,"checklist":checklist,"hazards":hazards,"notes":notes,"current":held,"plan":planned,"steps":steps,"estimate":estimate,"phases":engine.store().adoption_report.summary(),"backfills":engine.store().adoption_report.backfills})).unwrap());
    } else {
        if !options.flags.contains_key("deploy-direction") {
            for line in visibility.lines(held["release"].as_u64().unwrap_or(0),release) {println!("{line}");}
        }
        println!("preview: release {release} would be current as generation {}; live release unchanged", engine.generation());
        super::release_summary::print(prior_schema.as_ref(), &candidate_schema, &candidate_programs, &hazards, &notes, &steps, &items);
        if !options.flags.contains_key("deploy-direction") { println!("  checklist: prove the named refusal cases and affected lists/counts as real accounts before release {release}; `--bridge <new-dir>` saves current source plus this app's ROLLBACK-CHECKLIST.md"); }
        println!("  storage: {}",snapback4_core::store_port::report::AdoptionReport::dormant(&items));
        if options.flags.contains_key("verbose") {
            for hazard in hazards { println!("  detail: WARNING {hazard}"); }
            for note in notes { println!("  detail: note: {note}"); }
            for step in steps {println!("  {}: {}",step.path,step.message);}
            for item in &items { println!("  {}: {} {} dormant (restored on compatible forward); sample ids [{}]", item.key, item.rows, item.unit(), item.sample_ids.join(", ")); }
            println!("{}", engine.store().adoption_report.summary());
            if let Some(estimate) = estimate {
                println!("{estimate}");
            }
        }
    }
    Ok(())
}
