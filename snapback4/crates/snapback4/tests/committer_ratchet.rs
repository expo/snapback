//! Production durable transaction openers outside the committer/adapters.
//! Counts source lines, using the store-port ratchet's lexer. Read snapshots
//! are excluded; opening_transaction counts because it can open a writer.
//! This is lexical: aliases, macros and SQL assembled as strings can escape it.
//! Typed adapter operations that open transactions internally remain P1/K0b
//! work even though adapter implementation sites are outside this census.
//!
//! From snapback4/: SNAPBACK4_RATCHET_UPDATE=1 cargo test -p snapback4
//! --test committer_ratchet. Decreases stay green; updates only lower/delete
//! entries. There is deliberately no raise override. Review the data diff.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
#[path = "support/rust_tokens.rs"]
mod rust_tokens;
use rust_tokens::{Token, starts, tokens};

type Counts = BTreeMap<String, usize>;
const RULE: &str = "LLP 3000.009.001.000.000 §9 K0a";

fn write_opener(tokens: &[Token<'_>]) -> bool {
    if starts(tokens, &["Transaction", ":", ":"])
        && tokens
            .get(3)
            .is_some_and(|t| matches!(t.text, "new" | "new_unchecked"))
    {
        return true;
    }
    starts(tokens, &["."])
        && tokens.get(2).is_some_and(|t| t.text == "(")
        && tokens.get(1).is_some_and(|t| {
            matches!(
                t.text,
                "transaction"
                    | "request_write_transaction"
                    | "transaction_with_behavior"
                    | "unchecked_transaction"
                    | "authority_transaction"
                    | "with_authority_snapshot"
                    | "opening_transaction"
                    | "begin"
                    | "begin_transaction"
                    | "begin_immediate"
                    | "begin_deferred"
                    | "begin_write"
                    | "begin_write_transaction"
            )
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
        || path == core.join("engine/committer.rs")
}

fn production_sites(source: &str) -> BTreeSet<usize> {
    let tokens = tokens(source);
    let mut lines = BTreeSet::new();
    let (mut depth, mut test_depth) = (0, None);
    let (mut cfg_test, mut module) = (false, false);
    for (i, token) in tokens.iter().enumerate() {
        if starts(&tokens[i..], &["#", "[", "cfg", "(", "test", ")", "]"])
            || starts(
                &tokens[i..],
                &["#", "[", "cfg", "(", "all", "(", "test", ","],
            )
        {
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
        if test_depth.is_none() && write_opener(&tokens[i..]) {
            lines.insert(token.line);
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
    lines
}

fn walk(root: &Path, dir: &Path, counts: &mut Counts) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let relative = path.strip_prefix(root).unwrap();
        if excluded(relative) {
            continue;
        }
        if path.is_dir() {
            walk(root, &path, counts);
        } else if path.extension().is_some_and(|ext| ext == "rs") && !test_file(relative) {
            let lines = production_sites(&fs::read_to_string(&path).unwrap());
            if !lines.is_empty() {
                counts.insert(relative.to_str().unwrap().replace('\\', "/"), lines.len());
                if std::env::var("SNAPBACK4_COMMITTER_CENSUS").as_deref() == Ok("1") {
                    eprintln!("{}: {:?}", relative.display(), lines);
                }
            }
        }
    }
}

fn read_allowlist(path: &Path) -> Counts {
    let mut counts = Counts::new();
    for line in fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
    {
        let fields: Vec<_> = line.split_whitespace().collect();
        assert_eq!(fields.len(), 2, "invalid allowlist line: {line}");
        let count: usize = fields[1].parse().expect("integer count");
        assert!(count > 0, "remove zero entry: {line}");
        assert!(
            counts.insert(fields[0].into(), count).is_none(),
            "duplicate entry: {line}"
        );
    }
    counts
}

fn increases(actual: &Counts, allowed: &Counts) -> Vec<String> {
    actual.iter().filter_map(|(path, count)| {
        let limit = allowed.get(path).copied().unwrap_or(0);
        if *count > limit {
            Some(format!("{RULE}: {path}: {count} sites exceeds listed {limit}; route durable writes through the committer; this allowlist may only fall"))
        } else {
            None
        }
    }).collect()
}

#[test]
fn committer_ratchet() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().unwrap().parent().unwrap();
    let mut actual = Counts::new();
    for dir in ["crates/snapback4-core/src", "crates/snapback4/src"] {
        walk(root, &root.join(dir), &mut actual);
    }
    let path = manifest.join("tests/committer_ratchet.allow.txt");
    let allowed = read_allowlist(&path);
    let errors = increases(&actual, &allowed);
    assert!(errors.is_empty(), "{}", errors.join("\n"));
    for (file, limit) in &allowed {
        let count = actual.get(file).copied().unwrap_or(0);
        if count < *limit {
            eprintln!(
                "note: {file}: {count} sites below listed {limit}; regenerate with SNAPBACK4_RATCHET_UPDATE=1"
            );
        }
    }
    if std::env::var("SNAPBACK4_RATCHET_UPDATE").as_deref() == Ok("1") {
        let mut data =
            format!("# {RULE}; production matching source lines; paths relative to snapback4/\n");
        for (file, count) in &actual {
            data.push_str(&format!("{file} {count}\n"));
        }
        fs::write(path, data).unwrap();
    }
    println!(
        "production: {} files / {} sites",
        actual.len(),
        actual.values().sum::<usize>()
    );
}

#[test]
fn matcher_separates_writers_snapshots_literals_and_test_modules() {
    for call in [
        "transaction",
        "request_write_transaction",
        "transaction_with_behavior",
        "unchecked_transaction",
        "authority_transaction",
        "with_authority_snapshot",
        "opening_transaction",
        "begin",
        "begin_transaction",
        "begin_immediate",
        "begin_deferred",
        "begin_write",
        "begin_write_transaction",
    ] {
        assert_eq!(
            production_sites(&format!("store\n . {call}\n ();")),
            BTreeSet::from([2]),
            "{call}"
        );
    }
    assert_eq!(production_sites("db.transaction(); db.begin();").len(), 1);
    assert_eq!(production_sites("Transaction::new_unchecked(db);").len(), 1);
    let source = r####"
// db.transaction()
/* db.begin() /* nested */ */
const TEXT: &str = r###"db.transaction() }"###;
fn read() { db.read_transaction(); engine.begin_action_step(); }
#[cfg(test)] mod tests { fn a() { db.transaction(); } }
#[cfg(all(test, feature = "sqlite"))] mod checks { fn a() { db.begin(); } }
fn write() { db.transaction(); }
"####;
    assert_eq!(production_sites(source), BTreeSet::from([8]));
    assert_eq!(
        production_sites("#[cfg(test)] mod external; db.transaction();").len(),
        1
    );
}

#[test]
fn allowlist_can_only_fall_and_exclusions_are_narrow() {
    let counts = |count| BTreeMap::from([("file.rs".into(), count)]);
    assert!(increases(&counts(2), &counts(2)).is_empty());
    assert!(increases(&counts(1), &counts(2)).is_empty());
    assert!(increases(&Counts::new(), &counts(2)).is_empty());
    assert_eq!(increases(&counts(3), &counts(2)).len(), 1);
    assert_eq!(increases(&counts(1), &Counts::new()).len(), 1);
    for path in [
        "store.rs",
        "store/a.rs",
        "engine/postgres/a.rs",
        "engine/committer.rs",
    ] {
        assert!(excluded(&Path::new("crates/snapback4-core/src").join(path)));
    }
    for path in [
        "store_extra.rs",
        "engine/postgres.rs",
        "engine/committer_extra.rs",
    ] {
        assert!(!excluded(
            &Path::new("crates/snapback4-core/src").join(path)
        ));
    }
    assert!(test_file(Path::new("crates/snapback4/src/serve_tests.rs")));
}
