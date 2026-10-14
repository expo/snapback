//! A compiler upgrade explains the delta against the previous successful check.
// @ref LLP 3000.011.003.000#9 — snapshots explain versions; failed compilation cannot replace the old API.
use super::*;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Serialize, Deserialize, Default)]
struct Surface {
    version: String,
    #[serde(default)] sources: Option<Vec<(String, String)>>,
    api: String,
    notes: BTreeMap<String, usize>,
    refusals: BTreeMap<String, usize>,
}
fn path(project: &Project) -> PathBuf { project.data_dir().join("check-surface.json") }
fn counts(notes: &[snapback4_lang::Diagnostic]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for note in notes { *counts.entry(note.code.clone()).or_default() += 1; }
    counts
}
fn current(project: &Project, bound: &Bound) -> Surface {
    Surface { version: env!("CARGO_PKG_VERSION").into(), sources: project.sources().ok(),
        api: if bound.diagnostics.is_empty() { snapback4_lang::emit::typescript(bound) } else { String::new() },
        notes: counts(&bound.notes), refusals: counts(&bound.diagnostics) }
}
/// The emitter's own fixed layout: row columns and complete operation signatures.
/// Inline object types stay on one line; comments and runtime api objects are excluded.
fn types(api: &str) -> BTreeMap<String, String> {
    let mut scope = Vec::new();
    let mut types = BTreeMap::new();
    for line in api.lines().map(str::trim) {
        if line.starts_with("export const ") || line.starts_with("const operations:") { break; }
        if let Some(name) = line.strip_prefix("export type ").and_then(|s| s.strip_suffix(" = {")) {
            scope.clear(); scope.push(name.to_owned()); continue;
        }
        if line == "};" { scope.pop(); continue; }
        if !matches!(scope.first().map(String::as_str), Some("Rows" | "Ops")) { continue; }
        if let Some(name) = line.strip_suffix(": {") { scope.push(name.trim_matches('"').into()); continue; }
        if line.starts_with('/') { continue; }
        if let Some((name, value)) = line.strip_suffix(';').and_then(|s| s.split_once(": ")) {
            let key = scope.iter().map(String::as_str).chain([name.trim_matches('"')]).collect::<Vec<_>>().join(".");
            if scope[0] == "Ops" {
                if let Some((args, result)) = operation_types(value) {
                    types.insert(format!("{key}.args"), args); types.insert(format!("{key}.result"), result); continue;
                }
            }
            types.insert(key, value.into());
        }
    }
    types
}
fn operation_types(value: &str) -> Option<(String, String)> {
    let body = value.split_once('<')?.1.strip_suffix('>')?;
    let mut depth = 0i32;
    for (index, ch) in body.char_indices() {
        match ch {
            '{' | '[' | '<' | '(' => depth += 1,
            '}' | ']' | '>' | ')' => depth -= 1,
            ',' if depth == 0 => return Some((body[..index].trim().into(), body[index + 1..].trim().into())),
            _ => {},
        }
    }
    None
}

pub(super) fn report(project: &Project, bound: &Bound, json: bool) {
    let old: Surface = match fs::read(path(project)).ok().and_then(|b| serde_json::from_slice(&b).ok()) { Some(old) => old, None => {
        return;
    } };
    let new = current(project, bound);
    if old.version == new.version { return; }
    let mut lines = vec![format!("upgrade delta: {} → {} for snapback/*.q{}", old.version, new.version,
        if old.sources.is_some() && old.sources != new.sources { " (schema also changed)" } else { "" })];
    for (label, before, after) in [("new notes", &old.notes, &new.notes), ("new refusals", &old.refusals, &new.refusals)] {
        let added = after.iter().filter_map(|(code, count)| {
            let delta = count.saturating_sub(*before.get(code).unwrap_or(&0));
            (delta > 0).then(|| format!("{code} +{delta}"))
        }).collect::<Vec<_>>();
        lines.push(format!("  {label}: {}", if added.is_empty() { "none".into() } else { added.join(", ") }));
    }
    if new.api.is_empty() { lines.push("  generated/api.ts: unavailable until the schema compiles; previous types kept".into()); }
    else {
        let before = types(&old.api); let after = types(&new.api);
        let keys: std::collections::BTreeSet<_> = before.keys().chain(after.keys()).collect();
        let mut changed = false;
        for key in keys {
            if before.get(key) == after.get(key) { continue; }
            changed = true;
            lines.push(format!("  generated/api.ts {key}: {} → {}", before.get(key).map(String::as_str).unwrap_or("(added)"), after.get(key).map(String::as_str).unwrap_or("(removed)")));
        }
        if !changed { lines.push("  generated/api.ts types: unchanged".into()); }
    }
    lines.push("  release card: snapback4 guide changes".into());
    for line in lines { if json { eprintln!("{line}"); } else { println!("{line}"); } }
}

pub(super) fn remember(project: &Project, bound: &Bound) {
    if !bound.diagnostics.is_empty() { return; }
    let save = || -> std::io::Result<()> {
        fs::create_dir_all(project.data_dir())?;
        let temporary = path(project).with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&temporary, serde_json::to_vec_pretty(&current(project, bound))?)?;
        fs::rename(temporary, path(project))?;
        let _ = fs::remove_file(project.data_dir().join("upgrade-version.json"));
        Ok(())
    };
    if let Err(error) = save() { eprintln!("check: upgrade comparison not saved: {error}"); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_surface_separates_modules_columns_and_nested_types() {
        let api = "export type Rows = {\n  things: {\n    id: string;\n    total: number | null;\n  };\n};\nexport type Ops = {\n  stats: {\n    count: Query<{ room: string; labels: Array<string> }, number | null>;\n  };\n};\nexport const api: Ops = {\n  fake: 42;\n};";
        let types = types(api);
        assert_eq!(types["Rows.things.total"], "number | null");
        assert_eq!(types["Ops.stats.count.result"], "number | null");
        assert_eq!(types.len(), 4);
    }
}
