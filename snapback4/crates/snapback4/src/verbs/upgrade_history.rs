//! Recover a version, not invented compiler facts, from an older app.
// @ref LLP 3000.000.000.000#6-upgrade-evidence — direct-install Exact rebuild guidance shares history acknowledgment.
use super::*;
use std::fs;
// @ref LLP 3000.011.003.000#11-wave-11-runtime-upgrade-history — history acknowledgment is independent of compiler qualification.

fn exact(text: &str) -> Option<String> {
    snapback4_lang::release_changes::version(text).map(|_| text.to_owned())
}
fn json_version(text: &str, key: &str) -> Option<String> {
    let value: Json = serde_json::from_str(text).ok()?;
    exact(value[key].as_str()?)
}
pub(super) fn locked_version(text: &str) -> Option<String> {
    if let Ok(lock) = serde_json::from_str::<Json>(text) {
        if let Some(version) = lock.pointer("/packages/node_modules~1snapback4/version").or_else(|| lock.pointer("/dependencies/snapback4/version")).and_then(Json::as_str).and_then(exact) { return Some(version); }
    }
    // Bun's JSONC package tuple; pnpm's importer resolution (not specifier).
    let mut versions = std::collections::BTreeSet::new();
    for (position, _) in text.match_indices("snapback4@") {
        let tail = &text[position + "snapback4@".len()..];
        let candidate = tail.split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))).next().unwrap_or("");
        if let Some(version) = exact(candidate) { versions.insert(version); }
    }
    let lines: Vec<_> = text.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        if line.trim().trim_matches('\'').trim_matches('"') == "snapback4:" {
            for line in lines.iter().skip(index + 1).take(4) {
                if let Some(value) = line.trim().strip_prefix("version:") {
                    let value = value.trim().trim_matches(['\'', '"']).split('(').next().unwrap_or("");
                    if let Some(version) = exact(value) { versions.insert(version); }
                }
            }
        }
    }
    (versions.len() == 1).then(|| versions.into_iter().next()).flatten()
}
pub(super) fn previous(project: &Project) -> Option<String> {
    let read_version = |path, key| fs::read_to_string(path).ok().and_then(|text| json_version(&text, key));
    if let Some(version) = read_version(project.data_dir().join("runtime-version.json"), "version") { return Some(version); }
    if let Some(version) = read_version(project.data_dir().join("check-surface.json"), "version") { return Some(version); }
    if let Some(version) = read_version(project.data_dir().join("upgrade-version.json"), "version") { return Some(version); }
    if let Some(version) = read_version(project.generated_dir().join("package.json"), "snapback4Version") { return Some(version); }
    if let Some(version) = read_version(project.generated_dir().join("package.json"), "version") { return Some(version); }
    for name in ["package-lock.json", "npm-shrinkwrap.json", "bun.lock", "pnpm-lock.yaml"] {
        if let Some(version) = fs::read_to_string(project.root.join(name)).ok().and_then(|text| locked_version(&text)) { return Some(version); }
    }
    None
}
pub(super) fn report(project: &Project, json: bool) {
    if std::env::var("SNAPBACK4_UPGRADE_BASELINE").as_deref() == Ok("1") { return; }
    if let Some(previous) = previous(project) {
        let text = snapback4_lang::release_changes::interval(&previous, env!("CARGO_PKG_VERSION"));
        if !text.is_empty() { if json { eprint!("{text}"); } else { print!("{text}"); } }
        // History acknowledgment covers direct package-manager installs too,
        // even if the device preflight or schema compilation will refuse.
        if previous != env!("CARGO_PKG_VERSION") && !crate::exact_device::inspect(&project.root, &snapback4_core::Schema::default()).is_empty() {
            let hint = "Exact device: bun exact.mjs snapback --rebuild";
            if json { eprintln!("{hint}"); } else { println!("{hint}"); }
        }
    }
    let save = || -> std::io::Result<()> {
        fs::create_dir_all(project.data_dir())?;
        let path = project.data_dir().join("runtime-version.json");
        let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&temporary, serde_json::to_vec(&json!({ "version": env!("CARGO_PKG_VERSION") }))?)?;
        fs::rename(temporary, path)
    };
    if let Err(error) = save() { eprintln!("check: runtime history acknowledgment not saved: {error}"); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lock_resolution_uses_versions_not_dependency_ranges() {
        for text in [r#"{"packages":{"node_modules/snapback4":{"version":"0.4.25"}}}"#, r#"{"dependencies":{"snapback4":{"version":"0.4.25"}}}"#, "{\n\"snapback4\": [\"snapback4@0.4.25\", \"\", {}, \"sha\"],\n}", "importers:\n  .:\n    dependencies:\n      snapback4:\n        specifier: ^0.4.24\n        version: 0.4.25", "packages:\n  snapback4@0.4.25:\n    resolution: {}"] {
            assert_eq!(locked_version(text).as_deref(), Some("0.4.25"), "{text}");
        }
        for text in ["snapback4@latest", "snapback4@0.4.24\nsnapback4@0.4.25", "snapback4:\n  specifier: ^0.4.25", "snapback4@0.4.25.1", "importers:\n  one:\n    snapback4:\n      version: 0.4.25\n  two:\n    snapback4:\n      version: 0.4.27"] { assert!(locked_version(text).is_none(), "{text}"); }
    }
}
