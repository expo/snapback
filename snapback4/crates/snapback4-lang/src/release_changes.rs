//! One release history for the packaged card and upgrade/check interval.
// @ref LLP 3000.011.003.000#11-wave-11-runtime-upgrade-history — no compiler snapshot is required for runtime history.
pub const CHANGELOG: &str = include_str!("../../../packages/snapback4/CHANGELOG.md");

pub fn version(text: &str) -> Option<(u32, u32, u32)> {
    let mut parts = text.split('.');
    let result = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.split('-').next()?.parse().ok()?);
    parts.next().is_none().then_some(result)
}
pub fn between(history: &str, previous: Option<&str>, installed: &str) -> String {
    let Some(installed) = version(installed) else { return String::new(); };
    let previous = previous.and_then(version);
    let mut selected = false;
    let mut out = String::new();
    for line in history.lines() {
        if let Some(release) = line.strip_prefix("## ") {
            selected = version(release).is_some_and(|v| v <= installed && previous.is_none_or(|old| v > old));
        }
        if selected && line.starts_with("## ") { if !out.is_empty() { out.push('\n'); } out.push_str(line); out.push_str("\n\n"); }
        else if selected && line.starts_with("- ") { out.push_str(line); out.push('\n'); }
    }
    out
}
pub fn interval(previous: &str, installed: &str) -> String {
    if version(previous).zip(version(installed)).is_none_or(|(old, new)| old >= new) { return String::new(); }
    let entries = between(CHANGELOG, Some(previous), installed);
    if entries.is_empty() { return String::new(); }
    format!("runtime changes: {previous} → {installed}\n{entries}History begins at 0.4.26; earlier changes are not recorded.\n")
}
