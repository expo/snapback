//! Diagnostics: one envelope, located, with a rewrite when a safe repair is known
//! and the keyword card to read (LLP 2000.000 §5.1).

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Site {
    pub file: String,
    pub line: u32,
    pub col: u32,
}

impl Site {
    pub fn new(file: &str, line: u32, col: u32) -> Self {
        Self { file: file.to_owned(), line, col }
    }
}

impl fmt::Display for Site {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}:{}", self.file, self.line, self.col)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub site: Site,
    pub code: String,
    pub message: String,
    pub rewrite: String,
    pub guide: String,
    /// A spelling-only repair; never permission to apply a design suggestion.
    #[serde(default)]
    pub mechanical: bool,
    /// Parser-proven consequence of an earlier error in this operation,
    /// with no independent information. Kept for verbose and JSON reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cascade_of: Option<Site>,
}

impl Diagnostic {
    pub fn new(site: &Site, code: &str, message: impl Into<String>, rewrite: impl Into<String>) -> Self {
        let code = code.to_owned();
        let guide = guide_for(&code).to_owned();
        Self { site: site.clone(), code, message: message.into(), rewrite: rewrite.into(), guide, mechanical: false, cascade_of: None }
    }

    // @ref LLP 3000.007#8 — only explicitly mechanical rewrites may change source
    pub fn mechanical(mut self) -> Self {
        self.mechanical = true;
        self
    }

    pub fn guide(mut self, guide: &str) -> Self {
        self.guide = guide.to_owned();
        self
    }

    /// A repeated diagnostic gets inline help only if its card discusses it.
    pub fn explanation_section(&self) -> Option<String> {
        let keyword = if self.guide.is_empty() { guide_for(&self.code) } else { &self.guide };
        crate::guide::explanation_section(&self.code, keyword)
    }

    /// A contextual diagnostic owns its card; a code alone uses the default.
    pub fn explanation(&self) -> Option<String> {
        let keyword = if self.guide.is_empty() { guide_for(&self.code) } else { &self.guide };
        crate::guide::explain_code_with_guide(&self.code, keyword)
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let discovery = if self.mechanical { " — check --fix applies it" } else { "" };
        write!(f, "{} — {}: {}", self.site, self.code, self.message)?;
        if !self.rewrite.is_empty() { write!(f, "\n  rewrite: {}{discovery}", self.rewrite)?; }
        write!(f, "\n  guide: {}", self.guide)
    }
}

pub type Fallible<T> = Result<T, Diagnostic>;

pub fn syntax(site: &Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_SYNTAX", message, "fix this Quarry line and rerun snapback4 check")
}

pub fn syntax_with(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_SYNTAX", message, rewrite)
}

pub fn unsupported(site: &Site, construct: &str, alternative: impl Into<String>) -> Diagnostic {
    let mut diagnostic = Diagnostic::new(site, "E_QUARRY_UNSUPPORTED", format!("{construct} is not part of Snapback 4"), alternative);
    diagnostic.mechanical = matches!(construct, "elif" | "? :" | "?." | "len" | "//" | "#" | "proc");
    diagnostic
}

pub fn unknown(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    let diagnostic = Diagnostic::new(site, "E_QUARRY_UNKNOWN", message, rewrite);
    if diagnostic.message.contains(" has no index ") && diagnostic.rewrite.starts_with("by ") && !diagnostic.rewrite.contains('<') {
        diagnostic.mechanical()
    } else {
        diagnostic
    }
}

pub fn ambiguous(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_AMBIGUOUS", message, rewrite).mechanical()
}

pub fn type_error(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_TYPE", message, rewrite)
}

pub fn placement(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_PLACEMENT", message, rewrite)
}

pub fn unbound_loop(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_UNBOUND_LOOP", message, rewrite)
}

pub fn unbound_scan(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_UNBOUND_SCAN", message, rewrite)
}

pub fn sync_error(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_SYNC", message, rewrite)
}

/// The guide card a diagnostic points at; `language` is the language card.
pub fn guide_for(code: &str) -> &'static str {
    match code {
        code if code.starts_with("E_TIMELINE_") || code == "N_TIMELINE_PROFILE_CAP" || code == "N_TIMELINE_COMPAT" => "feeds",
        "N_PUBLIC_AGGREGATE_COPY" => "feeds",
        "E_QUARRY_SYNTAX" => "language",
        "E_QUARRY_UNSUPPORTED" => "language",
        "E_QUARRY_TYPE" => "types",
        "E_QUARRY_SELF_EQUALITY" | "E_QUARRY_SPREAD" | "E_QUARRY_DUPLICATE_FIELD" | "E_QUARRY_SHAPE_JOIN" => "shapes",
        "E_QUARRY_WRITE_TESTS" => "writes",
        "E_QUARRY_RULE_SPELLING" => "rules",
        "E_QUARRY_JOB_SCHEDULE" => "jobs",
        "E_QUARRY_AMBIGUOUS" | "E_CURSOR_INDEX" | "E_CONSTRAINT" => "indexes",
        "E_QUARRY_PLACEMENT" | "E_INTERNAL" => "programs",
        "E_UNBOUND_LOOP" | "E_UNBOUND_SCAN" | "E_QUARRY_BOUND" => "bounds",
        "E_SYNC" | "E_SYNC_GENERATION" => "sync",
        "E_SCHEMA_CONSTRAINT" | "E_INDEX_KEY_BYTES" => "indexes",
        "E_EMIT_IN_QUERY" => "programs",
        "E_QUARRY_MODIFIER_SCOPE" | "N_NO_CURSOR" | "N_SEEK" | "N_NEVER_COMPLETE" | "E_SHAPE_EXCEEDS_METER" | "N_OPTIONAL_FILTER_LIMIT" => "reads",
        "N_WIDE_MERGE" | "E_HOST_UNICODE" => "search",
        "E_QUARRY_POSITIONAL_SCAN" | "E_QUARRY_KEY_ORDER" => "reads",
        "E_VIEW_FEED_SHAPE" => "feeds",
        "N_SPARSE_FILTER" | "E_RECIPE_RETIRED" | "FEED_APP_NOT_FOUND" | "FEED_APP_OWNER" | "FEED_APP_EVENT" | "FEED_PULL_CAP" | "FEED_PROMOTION_PULL_CAP" | "FEED_PULL_COUNT_MISSING" | "FEED_EVENT_REMOVED" | "FEED_ORIGINAL_REQUIRED" | "FEED_NOT_AUTHOR" | "FEED_CANNOT_FOLLOW_SELF" | "FEED_AUTHOR_NOT_FOUND" | "FEED_POST_NOT_FOUND" => "feeds",
        "N_NO_HORIZON" | "E_STORE_REPLACED" | "E_STORE_RESTORE" | "E_QUARRY_RETAIN" => "sync",
        "N_MAINTAIN_SYNCED" | "N_NOW_SERVER" | "N_NOT_PREDICTABLE" => "residency",
        "N_MAINTAIN_DELTA" | "E_RULE" => "rules",
        "E_NOT_PREDICTABLE" | "N_HORIZON_GUARD" | "E_PREDICT" => "prediction",
        "N_MAINTAINED_COLUMN_STREAM" | "N_MAINTAINED_COLUMN_DISCLOSURE" | "E_MAINTAINED_COLUMN" | "E_MAINTAINED_COLUMN_REFERENCE" | "E_MAINTAIN_READ_RULE" | "E_MAINTAINED_COLUMN_PRIVATE" | "E_MAINTAINED_COLUMN_RESULT" | "E_POSTGRES_MAINTAINED_COLUMN" | "E_RECORDED_FIELD" | "E_QUARRY_MAINTAIN" => "maintains",
        "E_SCHEMA_CAPABILITY" => "sync",
        "E_QUARRY_MAINTAIN_EXPIRE" | "E_QUARRY_LIVE_MAINTAIN_PROBE" => "expire",
        "E_ADOPT" => "types",
        "E_TYPE" | "E_DIV_ZERO" | "E_OVERFLOW" | "E_FIELD" => "types",
        "E_ADMISSION" | "E_INPUT" | "E_WRITE_ID" | "E_WRITE_ID_REUSE" | "E_WRITE_RECEIPT_EXPIRED" | "E_CONFLICT" | "NOT_FOUND" => "writes",
        "E_STRUCTURAL_FANOUT" | "E_OP" | "E_OP_RESERVED" => "programs",
        "E_BOUND" | "E_FANOUT" => "bounds",
        "E_QUERY_HELD" => "search",
        "DIGEST_CHAT_BOUND" | "E_CLOCK_DEV_ONLY" | "E_CLOCK_INPUT" | "E_SCHEDULE" | "E_JOB_CURSOR_INDEX" | "E_JOB_GENERATION" | "E_JOB_SWEEP" => "jobs",
        "E_REPLAY_DEV_ONLY" | "E_SQL_READ_ONLY" | "E_SQL_INTERNAL" | "E_RATE_LIMIT" => "personas",
        "E_AUTH" => "services",
        "E_SERVER_REQUIRED" => "actions",
        "E_OFFLINE" => "residency",
        "E_RUN_BUSY" | "E_RUN_SOURCE_CHANGED" | "E_SCHEMA" | "E_STORE" | "E_GENERATION" | "E_CLIENT" | "E_CLOSED" | "E_DEVICE_VERSION" => "refusals",
        code if code.strip_prefix("E_").is_some_and(|name| name.starts_with("ASSET_")) => "assets",
        code if code.starts_with("E_NATIVE") => "native",
        code if code.strip_prefix("E_").is_some_and(|name| name.starts_with("WITNESS_")) => "witness",
        code if code.starts_with("SNAPBACK4_") => "refusals",
        code if code.starts_with(concat!("E_", "EFFECT_")) => "effects",
        code if code.starts_with(concat!("E_", "ROUTE_")) => "routes",
        code if matches!(code, "E_OIDC_BINDING" | "E_OIDC_CALLBACK" | "E_OIDC_CONFIG" | "E_OIDC_EXCHANGE" | "E_OIDC_HANDOFF" | "E_OIDC_MINT" | "E_OIDC_PROVIDER" | "E_OIDC_RECIPE" | "E_OIDC_REPLAY" | "E_OIDC_TRANSACTION") => "services",
        code if code.starts_with(concat!("E_", "ACTION_")) || code.starts_with(concat!("E_", "STEP_")) || code.starts_with(concat!("E_", "SERVER_")) || matches!(code, "E_SECRET_MISSING" | "E_WRITE_LABEL") => "actions",
        _ => "language",
    }
}

/// "did you mean `x`?" for a misspelled name, from the declared names.
pub fn name_rewrite<'a>(name: &str, declared: impl IntoIterator<Item = &'a str>, repair: Option<&str>) -> String {
    let mut names: Vec<&str> = declared.into_iter().collect();
    names.sort_unstable();
    names.dedup();
    let lower = name.to_lowercase();
    let mut ranked: Vec<(&str, usize)> = names
        .iter()
        .filter(|candidate| candidate.len().abs_diff(name.len()) <= 2 || candidate.to_lowercase() == lower)
        .map(|candidate| (*candidate, distance(name, candidate)))
        .filter(|(candidate, distance)| *distance <= 2 || candidate.to_lowercase() == lower)
        .collect();
    ranked.sort_by(|a, b| (b.0.to_lowercase() == lower).cmp(&(a.0.to_lowercase() == lower)).then(a.1.cmp(&b.1)).then(a.0.cmp(b.0)));
    let suggestion = ranked.first().map(|(candidate, _)| *candidate);
    let names_text = match suggestion {
        Some(suggestion) => format!("did you mean `{suggestion}`?"),
        None => format!("declared names: {}", if names.is_empty() { "none".to_owned() } else { names.join(", ") }),
    };
    match repair {
        Some(repair) => format!("{names_text}; {repair}"),
        None => names_text,
    }
}

/// Damerau–Levenshtein distance with adjacent transpositions.
fn distance(left: &str, right: &str) -> usize {
    let a: Vec<char> = left.chars().collect();
    let b: Vec<char> = right.chars().collect();
    let max = a.len() + b.len();
    let mut d = vec![vec![0usize; b.len() + 2]; a.len() + 2];
    d[0][0] = max;
    for i in 0..=a.len() {
        d[i + 1][0] = max;
        d[i + 1][1] = i;
    }
    for j in 0..=b.len() {
        d[0][j + 1] = max;
        d[1][j + 1] = j;
    }
    let mut last: std::collections::HashMap<char, usize> = std::collections::HashMap::new();
    for i in 1..=a.len() {
        let mut matched = 0;
        for j in 1..=b.len() {
            let row = *last.get(&b[j - 1]).unwrap_or(&0);
            let col = matched;
            let cost = usize::from(a[i - 1] != b[j - 1]);
            if cost == 0 {
                matched = j;
            }
            d[i + 1][j + 1] = (d[i][j] + cost).min(d[i + 1][j] + 1).min(d[i][j + 1] + 1).min(d[row][col] + (i - row - 1) + 1 + (j - col - 1));
        }
        last.insert(a[i - 1], i);
    }
    d[a.len() + 1][b.len() + 1]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_the_nearest_name() {
        assert_eq!(name_rewrite("conversationid", ["conversationId", "creatorId"], None), "did you mean `conversationId`?");
        assert_eq!(name_rewrite("zzz", ["a"], Some("declare it")), "declared names: a; declare it");
    }
}
