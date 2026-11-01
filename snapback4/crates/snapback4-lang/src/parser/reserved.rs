//! Reserved words: Quarry keywords cannot name a column or a binding. The
//! refusal names the word at its declaration, before a later use fails.

use crate::diag::{Diagnostic, Site};

/// Words that begin a table line (`by`, `read <-`, `after insert`, …).
// @ref LLP 3000.041#2.1 — name existing syntax for editors without widening name reservation.
pub const TABLE_WORDS: &[&str] = &[
    "after", "by", "cap", "delete", "deliver", "ephemeral", "expire", "immutable", "insert", "online",
    "public", "read", "retain", "search", "sync", "unique", "update",
];

/// Words a statement or expression reads as syntax, so a parameter, local or
/// loop variable of that name cannot be used (or silently means the keyword).
// @ref LLP 3000.036.002#9 — commit/new/now/viewer are contextual builtins, so declarations cannot shadow them.
pub const BINDING_WORDS: &[&str] = &[
    "and", "as", "break", "commit", "continue", "created", "delete", "device", "elif", "else", "emit",
    "exists", "false", "for", "if", "insert", "merge", "new", "not", "now", "null", "oblivious", "or",
    "require", "return", "true", "update", "upsert", "viewer", "walk", "while",
];

/// Accepted declaration heads, not recovery-only/unsupported TOP_LEVEL entries.
pub const DECLARATION_WORDS: &[&str] = &[
    "action", "alias", "backfill", "down", "effect", "extract", "fn", "invariant", "job",
    "maintain", "mutation", "query", "rollback", "route", "schedule", "shape", "table", "use", "view",
];
pub const TYPE_WORDS: &[&str] = &[
    "bool", "bytes", "cursor", "decimal", "enum", "file", "id", "image", "int", "json", "money",
    "principal", "sequence", "text", "time", "video",
];
/// These remain in BINDING_WORDS: removing them would change name admission.
pub const BUILTIN_WORDS: &[&str] = &["commit", "device", "new", "now", "viewer"];
/// Months and years are accepted by schedules, not general duration expressions.
pub const DURATION_UNITS: &[&str] = &["d", "h", "m", "month", "months", "ms", "s", "year", "years"];

/// Contextual syntax is highlightable but is NOT a name-reservation list.
/// In particular, adding these to BINDING_WORDS would reject existing programs.
pub const CONTEXTUAL_WORDS: &[&str] = &[
    "GB", "KB", "MB", "absent", "allow", "always", "at", "audience", "authors", "backoff",
    "because", "before", "bucket", "cancellation", "cascade", "chunk", "count", "counter",
    "day", "deadline", "default", "delivery", "deny", "deprecated", "depth", "desc",
    "disclosure", "each", "edges", "email", "events", "every", "first", "floor", "format",
    "from", "guests", "handle", "held", "hides", "hour", "identity", "in", "keep", "keys",
    "last", "live", "matching", "member", "native", "of", "on", "once", "only", "operations",
    "own", "password", "personas", "post", "predicts", "readable", "receipts", "removed",
    "renamed", "reports", "reposts", "restrict", "result", "retry", "returns", "reviewed",
    "runs", "secrets", "server", "service", "set", "size", "sum", "through", "timeline", "to",
    "up", "url", "via", "wait", "watermarks", "when", "where", "with", "words", "write", "written",
];

/// Disjoint editor classes. The two reservation sets intentionally overlap on
/// writes; builtins get value scopes, and table-line words win over control words.
/// Keep the parser's reservation sets intact; project them only for highlighting.
pub fn editor_binding_words() -> Vec<&'static str> {
    BINDING_WORDS.iter().chain(CONTEXTUAL_WORDS).copied()
        .filter(|word| !TABLE_WORDS.contains(word) && !BUILTIN_WORDS.contains(word)).collect()
}

fn rename(word: &str) -> String {
    match word {
        "read" => "isRead".into(),
        "by" => "author".into(),
        "after" => "afterAt".into(),
        "update" => "change".into(),
        "delete" => "removal".into(),
        "insert" => "addition".into(),
        "public" => "isPublic".into(),
        "unique" => "isUnique".into(),
        "sync" => "synced".into(),
        "cap" => "capacity".into(),
        "expire" => "expiresAt".into(),
        "not" => "startsAt".into(),
        "online" => "isOnline".into(),
        "search" => "searchText".into(),
        "retain" => "retained".into(),
        "immutable" => "locked".into(),
        "ephemeral" => "transient".into(),
        "deliver" => "delivery".into(),
        "walk" => "outing".into(),
        "viewer" => "who".into(),
        "now" => "at".into(),
        "commit" => "committedAt".into(),
        "new" => "newId".into(),
        other => format!("{other}Value"),
    }
}

pub(crate) fn column(site: &Site, word: &str) -> Diagnostic {
    let name = rename(word);
    Diagnostic::new(site, "E_QUARRY_RESERVED",
        format!("`{word}` is a reserved word: it begins a table line (`{}`), so it cannot name a column", usage(word)),
        format!("rename the column, for example `{name}:`, and use `.{name}` in rules and queries (reserved words: snapback4 why E_QUARRY_RESERVED)"))
}

pub(crate) fn binding(site: &Site, word: &str) -> Diagnostic {
    let name = rename(word);
    Diagnostic::new(site, "E_QUARRY_RESERVED",
        format!("`{word}` is a reserved word, so it cannot name a parameter, local or loop variable"),
        format!("rename it, for example `{name}`, at this declaration and at each use (reserved words: snapback4 why E_QUARRY_RESERVED)"))
}

pub(crate) fn repeated_identity(
    site: &Site,
    first: (bool, bool),
    first_site: &Site,
    repeated: (bool, bool),
) -> Diagnostic {
    // @ref LLP 3000.036.002#9 — identity is project-wide and repeated declarations must name both method sets.
    let methods = |(password, guests)| match (password, guests) {
        (true, true) => "password and guests",
        (true, false) => "password",
        (false, true) => "guests",
        (false, false) => "no methods",
    };
    Diagnostic::new(
        site,
        "E_QUARRY_IDENTITY_DUPLICATE",
        format!("`use identity` is project-wide: {} already declared at {first_site}; this repeated declaration names {}", methods(first), methods(repeated)),
        "keep one declaration: `use identity` (password and guests), `use identity password`, or `use identity guests`",
    )
    .guide("production")
}

fn usage(word: &str) -> &'static str {
    match word {
        "read" | "insert" | "update" | "delete" => "read <- rule, insert <- rule, update <- rule, delete <- rule",
        "by" | "unique" => "by name: columns, unique columns",
        "after" => "after insert <- exists …",
        "public" => "public 'why'",
        "sync" | "online" => "sync … / online only",
        "cap" => "cap N by column",
        "expire" => "expire at .column",
        "not" => "not before .column",
        "immutable" => "immutable columns",
        "retain" => "retain until-revoked",
        "ephemeral" => "ephemeral 5s",
        "search" => "search column",
        _ => "a table line",
    }
}

#[cfg(test)]
mod editor_tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    const SOURCES: &[(&str, &str)] = &[
        ("parser.rs", include_str!("../parser.rs")),
        ("actions.rs", include_str!("actions.rs")),
        ("expected.rs", include_str!("expected.rs")),
        ("expr.rs", include_str!("expr.rs")),
        ("maintains.rs", include_str!("maintains.rs")),
        ("predicates.rs", include_str!("predicates.rs")),
        ("programs.rs", include_str!("programs.rs")),
        ("repairs.rs", include_str!("repairs.rs")),
        ("reserved.rs", include_str!("reserved.rs")),
        ("routes.rs", include_str!("routes.rs")),
        ("security.rs", include_str!("security.rs")),
        ("timeline.rs", include_str!("timeline.rs")),
        ("types.rs", include_str!("types.rs")),
        ("views.rs", include_str!("views.rs")),
    ];

    // @ref LLP 3000.041#10 — round 2 replaces comparison-idiom matching with
    // every production string literal. Rust tokenization handles raw strings,
    // escapes, comments and macro bodies without guessing expression shapes.
    fn candidate_words(source: &str) -> BTreeSet<String> {
        fn collect(tokens: proc_macro2::TokenStream, words: &mut BTreeSet<String>) {
            for token in tokens {
                match token {
                    proc_macro2::TokenTree::Group(group) => collect(group.stream(), words),
                    proc_macro2::TokenTree::Literal(literal) => {
                        if let syn::Lit::Str(literal) = syn::parse_str::<syn::Lit>(&literal.to_string()).expect("valid Rust literal") {
                            let word = literal.value();
                            let bytes = word.as_bytes();
                            let ordinary = bytes.first().is_some_and(|c| c.is_ascii_lowercase() || *c == b'_')
                                && bytes.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_');
                            if ordinary || crate::lexer::HYPHENATED_WORDS.contains(&word.as_str()) || ["KB", "MB", "GB"].contains(&word.as_str()) {
                                words.insert(word);
                            }
                        }
                    }
                    _ => {},
                }
            }
        }
        let production = source.split("#[cfg(test)]").next().unwrap();
        let mut words = BTreeSet::new();
        collect(production.parse().expect("valid production Rust tokens"), &mut words);
        words
    }

    #[test]
    fn literal_census_sees_inline_array_membership() {
        assert!(candidate_words(r#"if ["unclassified"].contains(&token.value.as_str()) {}"#).contains("unclassified"));
    }
    #[test]
    fn literal_census_sees_guard_strings() {
        assert_eq!(candidate_words(r#"matches!(token.value.as_str(), "read" if token.site.file.ends_with("quarry"))"#), BTreeSet::from(["quarry", "read"].map(str::to_owned)));
    }
    #[test]
    fn literal_census_keeps_all_word_shaped_literals() {
        assert_eq!(candidate_words(r###"let a = ["_private", r#"raw_word"#, "esc\x61ped", "ignored prose", "E_CODE", "KB", "invented-hyphen", "until-revoked"];"###), BTreeSet::from(["_private", "raw_word", "escaped", "KB", "until-revoked"].map(str::to_owned)));
    }
    #[test]
    fn every_parser_candidate_word_has_one_editor_class() {
        let files: BTreeSet<_> = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/src/parser")).unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap()).filter(|name| name.ends_with(".rs")).collect();
        assert_eq!(files, SOURCES.iter().filter(|(name, _)| *name != "parser.rs").map(|(name, _)| name.to_string()).collect(), "include every parser module in the literal census");
        let binding = editor_binding_words();
        let mut classes = BTreeMap::new();
        for (name, words) in [("table", TABLE_WORDS), ("binding", binding.as_slice()),
            ("declaration", DECLARATION_WORDS), ("type", TYPE_WORDS),
            ("builtin", BUILTIN_WORDS), ("duration", DURATION_UNITS),
            ("hyphenated", crate::lexer::HYPHENATED_WORDS.as_slice())] {
            for word in words { assert!(classes.insert(*word, name).is_none(), "duplicate class for {word}"); }
        }
        let allowlist = [
            // Refusal-only declaration/rule spellings, not accepted keywords.
            "aggregate", "channel", "proc", "index", "select", "create", "modify", "edit", "remove", "limit",
            // Unsupported duration aliases; month/year are already schedule units.
            "w", "wk", "wks", "week", "weeks", "y", "yr", "yrs", "mo", "min", "mins", "minute", "minutes",
            "sec", "secs", "second", "seconds", "hr", "hrs", "hours", "days", "msec", "millis",
            // A default file stem and the expressly forbidden system principal.
            "schema", "system",
            // Guide-card identifiers on diagnostics, not syntax at those sites.
            "actions", "assets", "feeds", "imports", "indexes", "jobs", "maintains", "production",
            "programs", "reads", "recipes", "routes", "rules", "shapes", "sharing", "totals", "types", "writes",
            // Placeholder column name in diagnostic rewrite suggestions.
            "column",
            // Suggested replacement names for reserved identifiers.
            "addition", "author", "capacity", "change", "locked", "outing", "removal", "retained", "synced", "transient", "who",
        ];
        // Refusal-only text-pattern spellings: recognized to explain unsupported
        // syntax, not accepted operators. Reuse the parser's single list.
        let allowlist: Vec<_> = allowlist.into_iter().chain(super::super::TEXT_PATTERN_WORDS.iter().copied()).collect();
        assert_eq!(allowlist.len(), allowlist.iter().copied().collect::<BTreeSet<_>>().len(), "duplicate literal census exceptions");
        let mut failures = Vec::new();
        let mut allowed_seen = BTreeSet::new();
        let candidates: BTreeSet<_> = SOURCES.iter().flat_map(|(_, source)| candidate_words(source)).collect();
        for word in &candidates {
            let word = word.as_str();
            if allowlist.contains(&word) { allowed_seen.insert(word); }
            if usize::from(classes.contains_key(word)) + usize::from(allowlist.contains(&word)) != 1 {
                failures.push(format!("parser sources: {word} needs exactly one editor class or a documented non-keyword exception"));
            }
        }
        println!("literal census: {} parser sources, {} candidate words, {} editor spellings, {} allowlist entries", SOURCES.len(), candidates.len(), classes.len(), allowlist.len());
        assert!(failures.is_empty(), "{}", failures.join("\n"));
        assert_eq!(allowed_seen, allowlist.into_iter().collect(), "remove stale literal census exceptions");
    }
}
