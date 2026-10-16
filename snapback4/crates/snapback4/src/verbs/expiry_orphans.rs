//! Host-only recovery, deliberately absent from the application wire.
// @ref LLP 3000.039#13-wave-13-expiry-orphan-recovery — missing parents do not prove expiry; operator selection is mandatory.
use super::{Options, work_records};
use snapback4_core::Engine;

pub(super) fn findings(engine: &mut Engine, options: &Options) -> Result<Vec<serde_json::Value>, String> {
    let suffix = options.flags.get("release").map(|path| format!(" --release '{}'", path.replace('\'', "'\"'\"'"))).unwrap_or_default();
    engine.expiry_orphans(32).map_err(|e| e.to_string()).map(|identities| identities.into_iter().map(|(table, id)| {
        let target = format!("{table}:{id}").replace('\'', "'\"'\"'");
        let repair = format!("snapback4 doctor --repair-expiry-orphan '{target}'{suffix}");
        let message = format!("references name physically missing {table}:{id}; may be pre-0.4.29 expiry or deliberate dangling data. After backup and review, stop the host and run `{repair}` (current cascade/set-null actions; restrict may refuse; first 32 identities per inspection)");
        serde_json::json!({"code":"E_EXPIRY_ORPHAN", "table":table, "id":id, "message":message, "repair":repair})
    }).collect())
}

pub(super) fn repair(options: &Options) -> i32 {
    let result = (|| -> Result<u64, String> {
        if options.flags.keys().any(|flag| !matches!(flag.as_str(), "repair-expiry-orphan" | "release" | "json")) || !options.positionals.is_empty() {
            return Err("E_INPUT: doctor --repair-expiry-orphan table:id accepts only --release <directory> and --json; stop the host first".into());
        }
        let target = &options.flags["repair-expiry-orphan"];
        let (table, id) = target.split_once(':').filter(|(table, id)| !table.is_empty() && !id.is_empty()).ok_or("E_INPUT: --repair-expiry-orphan takes table:id")?;
        let path = work_records::store_path(options);
        if !path.is_file() { return Err(format!("E_INPUT: store {} does not exist", path.display())); }
        let owner = crate::store_owner::command(&path)?;
        let store = owner.open_store(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        let mut engine = Engine::open(store).map_err(|e| e.to_string())?;
        engine.repair_expiry_orphan(table, id, snapback4_core::now_ms()).map_err(|e| e.to_string())
    })();
    match result {
        Ok(written) => { if options.json { println!("{}", serde_json::json!({ "repaired": options.flags["repair-expiry-orphan"], "rowsWritten": written })); }
            else { println!("doctor: repaired {} using the active schema; {written} rows written (repeat is idempotent)", options.flags["repair-expiry-orphan"]); } 0 }
        Err(error) => { eprintln!("doctor: {error}"); 1 }
    }
}
