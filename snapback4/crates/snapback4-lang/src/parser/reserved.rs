//! Reserved words: Quarry keywords cannot name a column or a binding. The
//! refusal names the word at its declaration, before a later use fails.

use crate::diag::{Diagnostic, Site};

/// Words that begin a table line (`by`, `read <-`, `after insert`, …).
pub(crate) const TABLE_WORDS: &[&str] = &[
    "after", "by", "cap", "delete", "deliver", "ephemeral", "expire", "immutable", "insert", "online",
    "public", "read", "retain", "search", "sync", "unique", "update",
];

/// Words a statement or expression reads as syntax, so a parameter, local or
/// loop variable of that name cannot be used (or silently means the keyword).
// @ref LLP 3000.036.002#9 — commit/new/now/viewer are contextual builtins, so declarations cannot shadow them.
pub(crate) const BINDING_WORDS: &[&str] = &[
    "and", "as", "break", "commit", "continue", "created", "delete", "device", "elif", "else", "emit",
    "exists", "false", "for", "if", "insert", "merge", "new", "not", "now", "null", "oblivious", "or",
    "require", "return", "true", "update", "upsert", "viewer", "walk", "while",
];

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
        "E_QUARRY_SYNTAX",
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
