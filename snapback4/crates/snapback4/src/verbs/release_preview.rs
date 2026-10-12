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
    let id = snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::seed())
        .map_err(|e| e.to_string())?;
    let snapshot = Snapshot(std::env::temp_dir().join(format!("snapback4-release-preview-{id}")));
    snapback4_core::private_fs::directory(&snapshot.0).map_err(|e| e.to_string())?;
    let path = snapshot.0.join("store.sqlite");
    // SQLite VACUUM INTO takes a coherent read snapshot even with a live WAL writer.
    // Busy/disk errors refuse this preview; never fall back to copying database bytes.
    let source = snapback4_core::Store::open_read_only(store_path).map_err(|e| e.to_string())?;
    source
        .conn()
        .execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .map_err(|e| {
            format!("snapshot preview failed (retry after store/disk becomes available): {e}")
        })?;
    drop(source);
    let mut store = snapback4_core::Store::open(&path).map_err(|e| e.to_string())?;
    let held = store
        .release_status(0, None, None)
        .map_err(|e| e.to_string())?;
    let mut activation =
        snapback4_core::engine::release::ReleaseActivation::new(release, held["release"].as_u64());
    activation.expected_revision = held["revision"].as_u64();
    activation.native_digest = native.installed.map(|n| n.digest);
    activation.operation = "preview".into();
    let steps = store.successor(&bound.schema).map_err(|e| e.to_string())?;
    let estimate = store
        .adoption_estimate(&bound.schema)
        .map_err(|e| e.to_string())?
        .map(|e| e.summary());
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
    if options.json {
        println!("{}",serde_json::to_string_pretty(&serde_json::json!({"preview":true,"current":held,"plan":planned,"steps":steps,"estimate":estimate,"phases":engine.store().adoption_report.summary()})).unwrap());
    } else {
        let rows: u64 = planned["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| i["kind"] == "rows")
            .filter_map(|i| i["rows"].as_u64())
            .sum();
        println!("preview: release {release} would be current as generation {}; {rows} dormant narrowed rows; live release unchanged",engine.generation());
        for step in steps {
            println!("  {}: {}", step.path, step.message);
        }
        for item in planned["items"].as_array().into_iter().flatten() {
            println!("  {}: {} rows dormant", item["key"], item["rows"]);
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
