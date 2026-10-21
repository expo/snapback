//! @ref LLP 3000.009.001.000#32-the-rule — no database connection above the port.
//!
//! Counts matching *source lines* once per file and category, not substrings or
//! individual calls. A small lexer removes comments and literal contents (including
//! raw strings), retains line numbers, and matches whole Rust tokens across lines.
//! Patterns: rusqlite::, postgres::, .conn(), .query_row(, .query_map(,
//! .prepare(, .prepare_cached(, .execute(, .execute_batch(,
//! unchecked_transaction, Transaction::new_unchecked, Connection::open.
//! Raw Store/Tx device, installation and fixture methods count too, including
//! UFCS calls and method references. Device calls belong only to snapback4-device
//! and the adapters; renaming generic metadata access does not evade the port.
//! Explicit device methods count as production even inside consumer test modules;
//! those modules use the debug-only fixture hooks when raw access is needed.
//! The DeviceStore/DeviceTx trait spellings (meta, set_meta, etc.) count as well.
//! Transaction and Connection require exact type identifiers, excluding
//! AuthorityTransaction and StepTransaction. Connection::open also includes
//! open_* constructors (e.g. open_with_flags); literals exclude HTTP headers. The four generic
//! prepare/execute methods require an argument: database APIs need one, whereas
//! Records::prepare / records.prepare() and witness Run::execute() do not.
//!
//! This is a lexical ratchet, not type checking: macro-generated calls,
//! and database APIs outside these spellings can escape it; a non-database method
//! with the same name and arguments can count. cfg(test) *inline modules* are
//! separated by token brace depth (braces in comments/literals do not interfere).
//! Other cfg expressions/functions and external module declarations are not
//! interpreted. Rust files under tests/, with "tests" in their filename, or
//! named test_cases.rs are wholly test code. Driver patterns scan the core and host src trees; raw
//! Store/Tx methods scan every workspace crate's src tree except snapback4-device.
//! Adapter exclusions apply to both categories. A mixed file can appear in both allowlists.
//! Crate renames through use/extern crate are followed within each source file.
//! Cross-file alias re-exports and arbitrary type/macro resolution remain limits.
//!
//! From snapback4/: SNAPBACK4_RATCHET_UPDATE=1 cargo test -p snapback4
//! --test store_port_ratchet. A count below its listed number only prints a note
//! (never fails), so removing access stays green. Updates only lower/delete counts by default;
//! SNAPBACK4_RATCHET_ALLOW_RAISE=1 is additionally required for any increase or
//! new entry (including initial generation). Review the resulting data diff.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

type Counts = BTreeMap<String, usize>;
const RULE: &str = "LLP 3000.009.001.000 §3.2";

#[path = "support/rust_tokens.rs"]
mod rust_tokens;
use rust_tokens::{Token, starts, tokens};

const RAW_STORE_METHODS: &[&str] = &[
    "device_meta", "set_device_meta", "device_meta_prefix", "delete_device_meta",
    "device_clear_rows", "device_replace_rows", "device_residency",
    "initialize_device_storage", "device_outbox_insert", "device_outbox_upsert",
    "device_outbox_delete", "device_outbox_get", "device_outbox_entries",
    "device_outbox_max_seq", "device_base_remember", "device_base_entries",
    "device_base_has_table", "device_base_id_after", "device_base_clear",
    "device_staged_put", "device_staged_delete", "device_staged_after",
    "device_staged_table_after", "device_staged_clear", "install_device",
    "install_device_checked", "install_device_checked_with", "install_device_checked_with_finish",
    "put_loading_indexes", "test_support_conn", "test_support_meta", "test_support_set_meta",
    "meta", "set_meta", "meta_prefix", "delete_meta", "clear_rows", "replace_rows",
    "install_checked", "install_open",
];

fn raw_store_site(tokens: &[Token<'_>]) -> bool {
    // Store::install takes only a schema; the device trait's UFCS spelling also
    // accepts arbitrary metadata. Do not count ordinary schema installation.
    if starts(tokens, &["DeviceStore", ":", ":", "install"])
        || starts(tokens, &["DeviceStore", ">", ":", ":", "install"])
    {
        return true;
    }
    let method = if starts(tokens, &["."]) {
        tokens.get(1)
    } else if starts(tokens, &[":", ":"]) {
        tokens.get(2)
    } else {
        None
    };
    method.is_some_and(|method| RAW_STORE_METHODS.contains(&method.text))
}

fn restricted_device_site(tokens: &[Token<'_>]) -> bool {
    // Generic trait spellings can also name a test fixture (e.g. Fixture::set_meta).
    // They retain normal test classification; explicit device methods never do.
    raw_store_site(tokens) && ![
        "test_support_conn", "test_support_meta", "test_support_set_meta",
        "meta", "set_meta", "meta_prefix", "delete_meta", "clear_rows", "replace_rows",
    ].iter().any(|method| starts(tokens, &[".", method]) || starts(tokens, &[":", ":", method]))
}

fn database_site(tokens: &[Token<'_>]) -> bool {
    if raw_store_site(tokens) {
        return true;
    }
    // Error values/conversions alone do not access a database. Exclude only
    // the bare driver Error type; Error constructors and other paths still count.
    let error_type = ["rusqlite", "postgres"].iter().any(|driver| {
        starts(tokens, &[driver, ":", ":", "Error"])
            && tokens.get(4).is_none_or(|token| token.text != ":")
    });
    if error_type { return false; }
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
        || starts(tokens, &[".", "test_support_conn", "(", ")"])
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
        || path.file_name().unwrap() == "test_cases.rs"
}

fn excluded(path: &Path) -> bool {
    let core = Path::new("crates/snapback4-core/src");
    path.starts_with("crates/snapback4-device")
        || path == core.join("store.rs")
        || path.starts_with(core.join("store"))
        || path.starts_with(core.join("engine/postgres"))
}

fn count_source(source: &str, all_test: bool) -> (usize, usize) {
    count_driver_source(source, all_test)
}

fn count_driver_source(source: &str, all_test: bool) -> (usize, usize) {
    let tokens = tokens(source);
    let mut drivers: BTreeSet<&str> = ["rusqlite", "postgres"].into();
    // Conservative at file scope: a driver-bearing use tree marks its renamed
    // bindings too. Follow chained renames regardless of declaration order.
    loop {
        let before = drivers.len();
        for (i, token) in tokens.iter().enumerate() {
            if token.text != "use" && !starts(&tokens[i..], &["extern", "crate"]) { continue; }
            let end = tokens[i..].iter().position(|t| t.text == ";").map_or(tokens.len(), |j| i + j);
            let import = &tokens[i..end];
            if import.iter().any(|t| drivers.contains(t.text)) {
                for pair in import.windows(2).filter(|w| w[0].text == "as") {
                    drivers.insert(pair[1].text);
                }
            }
        }
        if before == drivers.len() { break; }
    }
    count_matching(source, all_test, |site| {
        database_site(site) || (site.first().is_some_and(|t| drivers.contains(t.text))
            && starts(&site[1..], &[":", ":"])
            && !(site.get(3).is_some_and(|t| t.text == "Error")
                && site.get(4).is_none_or(|t| t.text != ":")))
    })
}

fn count_matching(source: &str, all_test: bool, site: impl Fn(&[Token<'_>]) -> bool) -> (usize, usize) {
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
        if site(&tokens[i..]) {
            let category = usize::from((all_test || test_depth.is_some()) && !restricted_device_site(&tokens[i..]));
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

fn count_file(path: &Path, source: &str) -> (usize, usize) {
    if excluded(path) {
        return (0, 0);
    }
    let driver_scope = path.starts_with("crates/snapback4-core/src")
        || path.starts_with("crates/snapback4/src");
    if driver_scope { count_driver_source(source, test_file(path)) }
    else { count_matching(source, test_file(path), raw_store_site) }
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
            let (production, test) = count_file(relative, &fs::read_to_string(&path).unwrap());
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
    for entry in fs::read_dir(root.join("crates")).unwrap() {
        let dir = entry.unwrap().path().join("src");
        if dir.is_dir() {
            walk(root, &dir, &mut counts);
        }
    }
    assert!(counts[0].is_empty(), "{RULE}: production access must remain zero: {:?}", counts[0]);
    let update = enabled("SNAPBACK4_RATCHET_UPDATE");
    let may_raise = update && enabled("SNAPBACK4_RATCHET_ALLOW_RAISE");
    let paths = [
        "store_port_ratchet.allow.txt",
        "store_port_ratchet.test-allow.txt",
    ]
    .map(|name| manifest.join("tests").join(name));
    assert!(read_allowlist(&paths[0]).is_empty(), "{RULE}: production allowance must remain zero");
    let mut errors = Vec::new();
    for (actual, path) in counts.iter().zip(&paths) {
        let allowed = read_allowlist(path);
        // Decreases never fail: concurrent work that removes database access must
        // not go red. They are reported so the list can be lowered deliberately.
        for line in differences(actual, &allowed, false, true) {
            eprintln!("note: {}: {line}", path.display());
        }
        errors.extend(
            differences(actual, &allowed, true, may_raise)
                .into_iter()
                .map(|error| format!("{}: {error}", path.display())),
        );
    }
    // Validate both lists before writing either, so a refused raise changes neither.
    assert!(errors.is_empty(), "{}", errors.join("\n"));
    for ((actual, path), category) in counts.iter().zip(&paths).zip(["production", "test"]) {
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
        "db.test_support_conn()",
        "rusqlite::Error::InvalidQuery",
        "postgres::Error::from(error)",
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
    assert_eq!(count_source("Sql(#[from] rusqlite::Error), Postgres(#[from] postgres::Error)", false), (0, 0));
    assert_eq!(count_source("db\n . prepare\n (sql);", false), (1, 0));
    for import in [
        "use rusqlite as sql;", "extern crate rusqlite as sql;",
        "use {rusqlite as sql};", "use sql as driver; use rusqlite as sql;",
    ] {
        let source = format!("{import}\nsql::Connection::execute_batch(db, sql_text);\n");
        assert_eq!(count_source(&source, false), (1, 0), "{source}");
    }
    assert_eq!(count_source("use rusqlite as sql;\nuse sql as driver;\ndriver::Connection::execute_batch(db, text);", false), (1, 0));
    assert_eq!(count_source("use postgres as pg;\npg::Client::connect(url);", false), (1, 0));
    assert_eq!(
        count_source(
            "records.prepare(); self.prepare(); run.execute(); AuthorityTransaction::new_unchecked(); StepTransaction::new_unchecked();",
            false
        ),
        (0, 0)
    );
}

#[test]
fn raw_device_and_fixture_access_cannot_reopen_the_host_port() {
    for method in RAW_STORE_METHODS {
        for source in [
            format!("store.{method}(key, value);"),
            format!("Store::{method}(&store, key, value);"),
            format!("store.r#{method}(key, value);"),
            format!("r#Store::r#{method}(&store, key, value);"),
            format!("Tx :: {method} (tx, key);"),
            format!("let operation = Store::{method};"),
            format!("store\n . /* boundary */ {method}\n (key);"),
        ] {
            assert_eq!(count_source(&source, false), (1, 0), "{source}");
            let fixture_or_trait = ["test_support_conn", "test_support_meta", "test_support_set_meta",
                "meta", "set_meta", "meta_prefix", "delete_meta", "clear_rows", "replace_rows"].contains(method);
            assert_eq!(count_source(&source, true), if fixture_or_trait { (0, 1) } else { (1, 0) }, "{source}");
            for path in [
                "crates/snapback4/src/serve.rs",
                "crates/snapback4-core/src/engine/write.rs",
                "crates/snapback4-sim/src/world.rs",
            ] {
                assert_eq!(count_file(Path::new(path), &source), (1, 0), "{path}: {source}");
            }
            for path in [
                "crates/snapback4-device/src/sqlite.rs",
                "crates/snapback4-core/src/store/device.rs",
                "crates/snapback4-core/src/engine/postgres/identity.rs",
            ] {
                assert_eq!(count_file(Path::new(path), &source), (0, 0), "{path}: {source}");
            }
        }
    }
    let attack = "store.set_device_meta(\"release\", \"999\");";
    assert_eq!(count_source(attack, false), (1, 0));
    assert_eq!(count_source(&format!("#[cfg(test)] mod tests {{ {attack} }}"), false), (1, 0));
    assert!(!differences(&BTreeMap::from([("serve.rs".into(), 1)]), &Counts::new(), true, false).is_empty());
    assert_eq!(count_source("// store.device_meta(key)\nlet example = \"Store::set_device_meta\";", false), (0, 0));
    assert_eq!(count_source("store.device_metadata_for_test_only(key);", false), (0, 0));
    assert_eq!(count_source("runner.device_allowance = value; runner.device_work(work);", false), (0, 0));
    assert_eq!(count_source("store.named_meta(key); store.set_dev_value(key, value);", false), (0, 0));
    assert_eq!(count_source("DeviceStore::install(&mut store, schema, metadata, false);", false), (1, 0));
    assert_eq!(count_source("let install = DeviceStore :: install;", false), (1, 0));
    assert_eq!(count_source("<Store as DeviceStore>::install(&mut store, schema, metadata, false);", false), (1, 0));
    assert_eq!(count_source("store.install(schema); Store::install(&mut store, schema);", false), (0, 0));
}

#[test]
fn every_public_device_adapter_method_is_covered() {
    let core = Path::new(env!("CARGO_MANIFEST_DIR")).join("../snapback4-core/src/store");
    for file in ["device.rs", "test_support.rs", "activation.rs"] {
        let source = fs::read_to_string(core.join(file)).unwrap();
        let tokens = tokens(&source);
        for window in tokens.windows(3) {
            if starts(window, &["pub", "fn"])
                && (file != "activation.rs" || window[2].text.starts_with("install_device"))
            {
                assert!(RAW_STORE_METHODS.contains(&window[2].text), "{file}: {} is missing from the raw-access ratchet", window[2].text);
            }
        }
    }
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
        "crates/snapback4-core/src/engine/job/test_cases.rs",
    ] {
        assert!(test_file(Path::new(path)));
    }
    assert!(!test_file(Path::new(
        "crates/snapback4-core/src/engine/authority.rs"
    )));
    for path in [
        "crates/snapback4-device/src/sqlite.rs",
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
