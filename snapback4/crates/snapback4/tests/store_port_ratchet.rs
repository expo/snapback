//! @ref LLP 3000.009.001.000#32-the-rule — no database connection above the port.
//!
//! Counts matching *source lines* once per file and category, not substrings or
//! individual calls. A small lexer removes comments and literal contents (including
//! raw strings), retains line numbers, and matches whole Rust tokens across lines.
//! Patterns: rusqlite::, postgres::, .conn(), .query_row(, .query_map(,
//! .prepare(, .prepare_cached(, .execute(, .execute_batch(,
//! unchecked_transaction, Transaction::new_unchecked, Connection::open.
//! Transaction and Connection require exact type identifiers, excluding
//! AuthorityTransaction and StepTransaction. Connection::open also includes
//! open_* constructors (e.g. open_with_flags); literals exclude HTTP headers. The four generic
//! prepare/execute methods require an argument: database APIs need one, whereas
//! Records::prepare / records.prepare() and witness Run::execute() do not.
//!
//! This is a lexical ratchet, not type checking: aliases, macro-generated calls,
//! and database APIs outside these spellings can escape it; a non-database method
//! with the same name and arguments can count. cfg(test) *inline modules* are
//! separated by token brace depth (braces in comments/literals do not interfere).
//! Other cfg expressions/functions and external module declarations are not
//! interpreted. Rust files under tests/ or with "tests" in their filename are
//! wholly test code. Only the two src trees are scanned; adapter exclusions apply
//! to both categories. A mixed file can appear in both allowlists.
//!
//! From snapback4/: SNAPBACK4_RATCHET_UPDATE=1 cargo test -p snapback4
//! --test store_port_ratchet. Updates only lower/delete counts by default;
//! SNAPBACK4_RATCHET_ALLOW_RAISE=1 is additionally required for any increase or
//! new entry (including initial generation). Review the resulting data diff.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

type Counts = BTreeMap<String, usize>;
const RULE: &str = "LLP 3000.009.001.000 §3.2";

#[derive(Debug)]
struct Token<'a> {
    text: &'a str,
    line: usize,
}

fn ident(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte >= 128
}

// A deliberately small Rust lexer: punctuation stays separate; string/character
// literals become one opaque token. Lifetimes remain punctuation + identifier.
fn tokens(source: &str) -> Vec<Token<'_>> {
    let bytes = source.as_bytes();
    let mut result = Vec::new();
    let (mut i, mut line) = (0, 1);
    while i < bytes.len() {
        let start = i;
        let start_line = line;
        if bytes[i].is_ascii_whitespace() {
            line += usize::from(bytes[i] == b'\n');
            i += 1;
            continue;
        }
        if bytes[i..].starts_with(b"//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if bytes[i..].starts_with(b"/*") {
            let mut depth = 1;
            i += 2;
            while i < bytes.len() && depth > 0 {
                if bytes[i..].starts_with(b"/*") {
                    depth += 1;
                    i += 2;
                } else if bytes[i..].starts_with(b"*/") {
                    depth -= 1;
                    i += 2;
                } else {
                    line += usize::from(bytes[i] == b'\n');
                    i += 1;
                }
            }
            continue;
        }
        let mut quote = i;
        if matches!(bytes[i], b'b' | b'c') {
            quote += 1;
        }
        let raw = bytes.get(quote) == Some(&b'r');
        if raw {
            quote += 1;
            while bytes.get(quote) == Some(&b'#') {
                quote += 1;
            }
        }
        let string = bytes.get(quote) == Some(&b'"');
        let character = !raw && bytes.get(quote) == Some(&b'\'') && {
            let tail = &source[quote + 1..];
            // A character is one Unicode scalar or an escape, followed by '.
            tail.starts_with('\\')
                || tail
                    .chars()
                    .next()
                    .is_some_and(|c| tail[c.len_utf8()..].starts_with('\''))
        };
        if string || character {
            let delimiter = bytes[quote];
            let hashes = if raw {
                quote - start - 1 - usize::from(bytes[start] != b'r')
            } else {
                0
            };
            i = quote + 1;
            while i < bytes.len() {
                line += usize::from(bytes[i] == b'\n');
                if !raw && bytes[i] == b'\\' {
                    i += 1;
                    if i < bytes.len() {
                        line += usize::from(bytes[i] == b'\n');
                        i += 1;
                    }
                } else if bytes[i] == delimiter
                    && (!raw
                        || bytes
                            .get(i + 1..i + 1 + hashes)
                            .is_some_and(|s| s.iter().all(|b| *b == b'#')))
                {
                    i += 1 + hashes;
                    break;
                } else {
                    i += 1;
                }
            }
            result.push(Token {
                text: "<literal>",
                line: start_line,
            });
        } else {
            i += 1;
            if ident(bytes[start]) {
                while i < bytes.len() && ident(bytes[i]) {
                    i += 1;
                }
            }
            result.push(Token {
                text: &source[start..i],
                line: start_line,
            });
        }
    }
    result
}

fn starts(tokens: &[Token<'_>], pattern: &[&str]) -> bool {
    tokens.len() >= pattern.len()
        && tokens
            .iter()
            .zip(pattern)
            .all(|(token, expected)| token.text == *expected)
}

fn database_site(tokens: &[Token<'_>]) -> bool {
    if starts(tokens, &["rusqlite", ":", ":"])
        || starts(tokens, &["postgres", ":", ":"])
        || starts(tokens, &["Transaction", ":", ":", "new_unchecked"])
        || (starts(tokens, &["Connection", ":", ":"])
            && tokens
                .get(3)
                .is_some_and(|token| token.text == "open" || token.text.starts_with("open_")))
        || starts(tokens, &["unchecked_transaction"])
    {
        return true;
    }
    if starts(tokens, &[".", "conn", "(", ")"])
        || starts(tokens, &[".", "query_row", "("])
        || starts(tokens, &[".", "query_map", "("])
    {
        return true;
    }
    ["prepare", "prepare_cached", "execute", "execute_batch"]
        .iter()
        .any(|method| {
            starts(tokens, &[".", method, "("])
                && tokens.get(3).is_some_and(|token| token.text != ")")
        })
}

fn test_file(path: &Path) -> bool {
    path.components().any(|part| part.as_os_str() == "tests")
        || path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains("tests")
}

fn excluded(path: &Path) -> bool {
    let core = Path::new("crates/snapback4-core/src");
    path == core.join("store.rs")
        || path.starts_with(core.join("store"))
        || path.starts_with(core.join("engine/postgres"))
}

fn count_source(source: &str, all_test: bool) -> (usize, usize) {
    let tokens = tokens(source);
    let mut lines = [BTreeSet::new(), BTreeSet::new()];
    let (mut depth, mut test_depth) = (0, None);
    let (mut cfg_test, mut module) = (false, false);
    for (i, token) in tokens.iter().enumerate() {
        if starts(&tokens[i..], &["#", "[", "cfg", "(", "test", ")", "]"]) {
            cfg_test = true;
        }
        if cfg_test && token.text == "mod" {
            module = true;
        }
        if token.text == "{" {
            depth += 1;
            if module && test_depth.is_none() {
                test_depth = Some(depth);
            }
            cfg_test = false;
            module = false;
        }
        if database_site(&tokens[i..]) {
            let category = usize::from(all_test || test_depth.is_some());
            lines[category].insert(token.line);
        }
        if token.text == "}" {
            if test_depth == Some(depth) {
                test_depth = None;
            }
            depth -= 1;
        }
        if matches!(token.text, ";" | "}") {
            cfg_test = false;
            module = false;
        }
    }
    (lines[0].len(), lines[1].len())
}

fn walk(root: &Path, dir: &Path, counts: &mut [Counts; 2]) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let relative = path.strip_prefix(root).unwrap();
        if excluded(relative) {
            continue;
        }
        if path.is_dir() {
            walk(root, &path, counts);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            let (production, test) =
                count_source(&fs::read_to_string(&path).unwrap(), test_file(relative));
            for (category, count) in [production, test].into_iter().enumerate() {
                if count > 0 {
                    counts[category].insert(relative.to_str().unwrap().replace('\\', "/"), count);
                }
            }
        }
    }
}

fn read_allowlist(path: &Path) -> Counts {
    let source = fs::read_to_string(path).unwrap_or_else(|error| {
        if error.kind() == std::io::ErrorKind::NotFound && enabled("SNAPBACK4_RATCHET_UPDATE") {
            String::new()
        } else {
            panic!("{}: {error}", path.display());
        }
    });
    let mut counts = Counts::new();
    for line in source
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
    {
        let fields: Vec<_> = line.split_whitespace().collect();
        assert_eq!(fields.len(), 2, "invalid allowlist line: {line}");
        let count: usize = fields[1]
            .parse()
            .expect("allowlist count must be an integer");
        assert!(count > 0, "remove zero entry: {line}");
        assert!(
            counts.insert(fields[0].into(), count).is_none(),
            "duplicate entry: {line}"
        );
    }
    counts
}

fn differences(actual: &Counts, allowed: &Counts, may_lower: bool, may_raise: bool) -> Vec<String> {
    let paths: BTreeSet<_> = actual.keys().chain(allowed.keys()).collect();
    paths.into_iter().filter_map(|path| {
        let count = actual.get(path).copied().unwrap_or(0);
        let limit = allowed.get(path).copied().unwrap_or(0);
        if count > limit && !may_raise {
            Some(format!("{RULE}: {path}: {count} sites exceeds listed {limit}; move database access behind the port (updates require SNAPBACK4_RATCHET_ALLOW_RAISE=1 to raise counts)"))
        } else if count < limit && !may_lower {
            Some(format!("{RULE}: {path}: {count} sites below listed {limit}; lower the number in the allowlist (or regenerate with SNAPBACK4_RATCHET_UPDATE=1)"))
        } else {
            None
        }
    }).collect()
}

fn enabled(name: &str) -> bool {
    std::env::var(name).as_deref() == Ok("1")
}

#[test]
fn store_port_ratchet() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().unwrap().parent().unwrap();
    let mut counts = [Counts::new(), Counts::new()];
    for dir in ["crates/snapback4-core/src", "crates/snapback4/src"] {
        walk(root, &root.join(dir), &mut counts);
    }
    let update = enabled("SNAPBACK4_RATCHET_UPDATE");
    let may_raise = update && enabled("SNAPBACK4_RATCHET_ALLOW_RAISE");
    let paths = [
        "store_port_ratchet.allow.txt",
        "store_port_ratchet.test-allow.txt",
    ]
    .map(|name| manifest.join("tests").join(name));
    let mut errors = Vec::new();
    for (actual, path) in counts.iter().zip(&paths) {
        errors.extend(
            differences(actual, &read_allowlist(path), update, may_raise)
                .into_iter()
                .map(|error| format!("{}: {error}", path.display())),
        );
    }
    // Validate both lists before writing either, so a refused raise changes neither.
    assert!(errors.is_empty(), "{}", errors.join("\n"));
    for ((actual, path), category) in counts.iter().zip(&paths).zip(["non-test", "test"]) {
        if update {
            let mut data = format!(
                "# {RULE}; {category} matching source lines; paths relative to snapback4/\n"
            );
            for (file, count) in actual {
                data.push_str(&format!("{file} {count}\n"));
            }
            fs::write(path, data).unwrap();
        }
        println!(
            "{category}: {} files / {} sites",
            actual.len(),
            actual.values().sum::<usize>()
        );
    }
}

#[test]
fn matcher_counts_lines_and_exact_database_tokens() {
    assert_eq!(
        count_source("db.conn().query_row(sql); db.execute(sql);", false),
        (1, 0)
    );
    for source in [
        "rusqlite::Connection",
        "postgres::Client",
        "db.conn()",
        "q.query_row(sql)",
        "q.query_map(params)",
        "db.prepare(sql)",
        "db.prepare_cached(sql)",
        "db.execute(sql)",
        "db.execute_batch(sql)",
        "db.unchecked_transaction()",
        "Transaction::new_unchecked(conn)",
        "Connection::open(path)",
        "Connection::open_with_flags(path, flags)",
        "Connection::open_in_memory()",
    ] {
        assert_eq!(count_source(source, false), (1, 0), "{source}");
    }
    assert_eq!(count_source("db\n . prepare\n (sql);", false), (1, 0));
    assert_eq!(
        count_source(
            "records.prepare(); self.prepare(); run.execute(); AuthorityTransaction::new_unchecked(); StepTransaction::new_unchecked();",
            false
        ),
        (0, 0)
    );
}

#[test]
fn comments_literals_and_cfg_test_modules_do_not_leak() {
    let source = r####"
// rusqlite::Connection::open("ignored")
/* postgres::Client /* nested */ .conn() */
const HEADER: &str = "Connection: close .execute(sql)";
const RAW: &str = br###" } .conn() "###;
fn prod<'a>() { let c = '}'; db.conn(); }
#[cfg(test)]
mod checks {
    fn nested() { db.execute("{ .conn() }"); }
    mod deeper { fn check() { db.query_row(sql); } }
}
fn after() { db.prepare(sql); }
"####;
    assert_eq!(count_source(source, false), (2, 2));
    assert_eq!(count_source(source, true), (0, 4));
    assert_eq!(
        count_source("#[cfg(test)] mod checks { db.conn(); } db.conn();", false),
        (1, 1)
    );
    assert_eq!(
        count_source("#[cfg(test)] mod external; fn prod() { db.conn(); }", false),
        (1, 0)
    );
}

#[test]
fn paths_separate_tests_and_exclude_only_adapters() {
    for path in [
        "crates/snapback4-core/src/engine/tests/a.rs",
        "crates/snapback4/src/serve_tests.rs",
    ] {
        assert!(test_file(Path::new(path)));
    }
    assert!(!test_file(Path::new(
        "crates/snapback4-core/src/engine/authority.rs"
    )));
    for path in [
        "crates/snapback4-core/src/store.rs",
        "crates/snapback4-core/src/store/a.rs",
        "crates/snapback4-core/src/engine/postgres/a.rs",
    ] {
        assert!(excluded(Path::new(path)));
    }
    for path in [
        "crates/snapback4/src/store_owner.rs",
        "crates/snapback4-core/src/engine/postgres.rs",
        "crates/snapback4-core/src/store_extra/a.rs",
    ] {
        assert!(!excluded(Path::new(path)));
    }
}

#[test]
fn exact_allowlists_and_update_raise_guard() {
    let counts = |count| BTreeMap::from([("file.rs".into(), count)]);
    assert!(differences(&counts(2), &counts(2), false, false).is_empty());
    assert!(differences(&counts(3), &counts(2), true, false)[0].contains(RULE));
    assert!(differences(&counts(1), &counts(2), false, false)[0].contains("lower the number"));
    assert!(differences(&counts(1), &counts(2), true, false).is_empty());
    assert!(!differences(&counts(1), &Counts::new(), true, false).is_empty());
    assert!(differences(&counts(3), &counts(2), true, true).is_empty());
    assert!(!differences(&Counts::new(), &counts(2), false, false).is_empty());
    assert!(differences(&Counts::new(), &counts(2), true, false).is_empty());
}
