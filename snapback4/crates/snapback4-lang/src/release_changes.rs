//! One release history for the packaged card and upgrade/check interval.
// @ref LLP 3000.011.003.000#11-wave-11-runtime-upgrade-history — no compiler snapshot is required for runtime history.
pub const CHANGELOG: &str = include_str!("../../../packages/snapback4/CHANGELOG.md");

pub fn version(text: &str) -> Option<(u32, u32, u32)> {
    let (core, prerelease) = text.split_once('-').map_or((text, None), |(core, pre)| (core, Some(pre)));
    if prerelease.is_some_and(|pre| pre.split('.').any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'))) { return None; }
    if core.split('.').any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit())) { return None; }
    let mut parts = core.split('.');
    let result = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    parts.next().is_none().then_some(result)
}
fn compare(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    use std::cmp::Ordering;
    let core = version(a)?.cmp(&version(b)?);
    if core != Ordering::Equal { return Some(core); }
    let pre = |v: &str| v.split_once('-').map(|(_, pre)| pre.to_owned());
    let (a, b) = (pre(a), pre(b));
    let (a, b) = match (a, b) {
        (Some(a), Some(b)) => (a, b),
        (None, None) => return Some(Ordering::Equal),
        (None, Some(_)) => return Some(Ordering::Greater),
        (Some(_), None) => return Some(Ordering::Less),
    };
    let (a, b): (Vec<_>, Vec<_>) = (a.split('.').collect(), b.split('.').collect());
    for i in 0..a.len().max(b.len()) {
        let (Some(a), Some(b)) = (a.get(i), b.get(i)) else { return Some(a.len().cmp(&b.len())); };
        let numeric = |v: &str| v.bytes().all(|c| c.is_ascii_digit());
        let order = match (numeric(a), numeric(b)) {
            (true, true) => {
                let (a, b) = (a.trim_start_matches('0'), b.trim_start_matches('0'));
                a.len().cmp(&b.len()).then_with(|| a.cmp(b))
            },
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => a.cmp(b),
        };
        if order != Ordering::Equal { return Some(order); }
    }
    Some(Ordering::Equal)
}
pub fn between(history: &str, previous: Option<&str>, installed: &str) -> String {
    if version(installed).is_none() { return String::new(); }
    let previous = previous.filter(|v| version(v).is_some());
    let mut selected = false;
    let mut out = String::new();
    for line in history.lines() {
        if let Some(release) = line.strip_prefix("## ") {
            selected = compare(release, installed).is_some_and(|order| order != std::cmp::Ordering::Greater)
                && previous.is_none_or(|old| compare(release, old) == Some(std::cmp::Ordering::Greater));
        }
        if selected && line.starts_with("## ") { if !out.is_empty() { out.push('\n'); } out.push_str(line); out.push_str("\n\n"); }
        else if selected && line.starts_with("- ") { out.push_str(line); out.push('\n'); }
    }
    out
}
pub fn interval(previous: &str, installed: &str) -> String {
    if compare(previous, installed) != Some(std::cmp::Ordering::Less) { return String::new(); }
    let entries = between(CHANGELOG, Some(previous), installed);
    if entries.is_empty() { return String::new(); }
    format!("runtime changes: {previous} → {installed}\n{entries}History begins at 0.4.26; earlier changes are not recorded.\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prerelease_intervals_include_the_later_stable_entry() {
        for previous in ["0.4.28-rc", "0.4.28-rc.1", "0.4.28-rc.9007199254740993"] {
            assert!(interval(previous, "0.4.28").contains("## 0.4.28"));
        }
        let history = "## 0.4.28\n- stable\n## 0.4.28-rc.10\n- later prerelease\n## 0.4.28-rc.2\n- earlier prerelease\n";
        assert_eq!(between(history, Some("0.4.28-rc.2"), "0.4.28-rc.10"), "## 0.4.28-rc.10\n\n- later prerelease\n");
        assert!(interval("0.4.28", "0.4.28-rc.1").is_empty());
        for bad in ["0.4.28.1", "0.4.+28", "0.4.28-rc..1", "0.4.28-"] { assert!(version(bad).is_none()); }
    }
}
