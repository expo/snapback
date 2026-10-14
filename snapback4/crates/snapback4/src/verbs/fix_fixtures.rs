//! A documented refusal rename is safe only when the same case produces it.
// @ref LLP 3000.000.000.000#6-upgrade-evidence — replay conditional refusal renames before changing fixture expectations.
use super::*;
use std::{fs, io};

pub(super) fn run(project: &Project, bound: &Bound, options: &Options) -> io::Result<()> {
    let directory = options.flags.get("fixture").map(std::path::PathBuf::from).unwrap_or_else(|| project.root.join("fixtures"));
    let path = directory.join(test_cases::FILE);
    let original = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !original.lines().any(|line| serde_json::from_str::<Json>(line).ok().is_some_and(|case| case["expect"] == "E_CONSTRAINT")) { return Ok(()); }
    let fixture_snapshot = fixture_sources(&directory)?;
    let sources = project.sources()?;
    let now = snapback4_core::now_ms();
    let fixture = directory.to_string_lossy().into_owned();
    let memory = Options { json: true, flags: [("fixture".into(), fixture.clone())].into(), positionals: vec![] };
    let mut engine = test_fixture::engine_at(project, bound, &memory, now).map_err(io::Error::other)?;
    let mut observed = BTreeMap::new();
    test_cases::run_observed(&mut engine, bound, &fixture, &sources, now, true,
        |at, code| { observed.insert(at.to_owned(), code.to_owned()); }).map_err(io::Error::other)?;
    let mut changed = String::with_capacity(original.len());
    let mut repaired = Vec::new();
    for (index, line) in original.split_inclusive('\n').enumerate() {
        let at = format!("{}:{}", test_cases::FILE, index + 1);
        // 0.4.28's documented rename affects readable unique conflicts only.
        // Hidden E_RULE and unrelated constraints keep their existing expectations.
        if observed.get(&at).map(String::as_str) == Some("E_UNIQUE")
            && let Some((start, end)) = expectation_span(line, "E_CONSTRAINT") {
            changed.push_str(&line[..start]); changed.push_str("\"E_UNIQUE\""); changed.push_str(&line[end..]);
            repaired.push(at);
        } else { changed.push_str(line); }
    }
    if repaired.is_empty() { return Ok(()); }
    if fs::read_to_string(&path)? != original || fixture_sources(&directory)? != fixture_snapshot || project.sources()? != sources { return Err(io::Error::other(format!("{} changed while check --fix was running; rerun", path.display()))); }
    fs::write(&path, changed)?;
    for at in repaired { eprintln!("fix: {at} — documented refusal rename E_CONSTRAINT → E_UNIQUE (replayed fixture case)"); }
    Ok(())
}

fn fixture_sources(directory: &std::path::Path) -> io::Result<BTreeMap<std::path::PathBuf, Vec<u8>>> {
    let mut sources = BTreeMap::new();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().is_some_and(|extension| extension == "jsonl") { sources.insert(path.clone(),fs::read(&path)?); }
    }
    Ok(sources)
}

/// Locate only a single top-level `expect` string; preserve every other byte,
/// including CRLF, indentation, escaped keys and strings containing that word.
fn expectation_span(line: &str, old: &str) -> Option<(usize, usize)> {
    let _: Json = serde_json::from_str(line).ok()?;
    let bytes = line.as_bytes();
    let mut depth = 0;
    let mut at = 0;
    let mut found = None;
    let mut count = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'{' | b'[' => { depth += 1; at += 1; }
            b'}' | b']' => { depth -= 1; at += 1; }
            b'"' => {
                let start = at; at += 1;
                while at < bytes.len() { if bytes[at] == b'\\' { at += 2; } else if bytes[at] == b'"' { at += 1; break; } else { at += 1; } }
                let text: String = serde_json::from_str(line.get(start..at)?).ok()?;
                let mut next = at; while bytes.get(next).is_some_and(u8::is_ascii_whitespace) { next += 1; }
                if depth == 1 && bytes.get(next) == Some(&b':') && text == "expect" {
                    count += 1; next += 1; while bytes.get(next).is_some_and(u8::is_ascii_whitespace) { next += 1; }
                    let mut end = next.checked_add(1)?;
                    if bytes.get(next) != Some(&b'"') { continue; }
                    while end < bytes.len() { if bytes[end] == b'\\' { end += 2; } else if bytes[end] == b'"' { end += 1; break; } else { end += 1; } }
                    if serde_json::from_str::<String>(line.get(next..end)?).ok()?.as_str() == old { found = Some((next,end)); }
                }
            }
            _ => at += 1,
        }
    }
    (count == 1).then_some(found).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refusal_repair_preserves_unrelated_json_and_refuses_duplicate_keys() {
        let text = " {\"args\":{\"expect\":\"E_CONSTRAINT\"},\"label\":\"expect E_CONSTRAINT\", \"expe\\u0063t\" : \"E_CONSTRAINT\"}\r\n";
        let (from,to) = expectation_span(text,"E_CONSTRAINT").unwrap();
        assert_eq!(&text[from..to], "\"E_CONSTRAINT\"");
        assert!(text[..from].ends_with(" : "));
        assert_eq!(&text[to..], "}\r\n");
        assert!(expectation_span(r#"{"expect":"E_CONSTRAINT","expect":"E_CONSTRAINT"}"#, "E_CONSTRAINT").is_none());
    }
}
