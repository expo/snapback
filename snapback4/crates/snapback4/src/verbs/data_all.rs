//! Complete operator inspection over one read-only retained snapshot.
// @ref LLP 3000.037.000#9 — retained cells supplement active images once per id.
use super::Options;
use snapback4_core::store_port::AnyInspection;
use serde_json::json;
use std::path::Path;
pub(super) fn run(path: &Path, table: &str, options: &Options) -> i32 {
    let inspected=(|| {
        let conn=AnyInspection::open(path)?;
        conn.begin_snapshot()?;
        conn.merged_records(table)
    })();
    match inspected {
        Ok(rows) => {
            let rows:Vec<_>=rows.iter().map(snapback4_core::wire::to_json).collect();
            if options.json { println!("{}",json!({"rows":rows,"more":false,"limit":null,"inspection":"active and retained records, merged by id"})); }
            else { for row in rows {println!("{row}");} }
            0
        }
        Err((code,message)) => { eprintln!("{code}: {message}"); 1 }
    }
}
