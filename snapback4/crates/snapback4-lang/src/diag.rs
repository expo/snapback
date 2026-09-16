//! Diagnostics: one envelope, located, with a rewrite the author can paste
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
}

impl Diagnostic {
    pub fn new(site: &Site, code: &str, message: impl Into<String>, rewrite: impl Into<String>) -> Self {
        let code = code.to_owned();
        let guide = guide_for(&code).to_owned();
        Self { site: site.clone(), code, message: message.into(), rewrite: rewrite.into(), guide, mechanical: false }
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
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let discovery = if self.mechanical { " — check --fix applies it" } else { "" };
        write!(f, "{} — {}: {}\n  rewrite: {}{discovery}\n  guide: {}", self.site, self.code, self.message, self.rewrite, self.guide)
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
        "E_QUARRY_SYNTAX" => "language",
        "E_QUARRY_UNSUPPORTED" => "language",
        "E_QUARRY_TYPE" => "types",
        "E_QUARRY_AMBIGUOUS" | "E_CURSOR_INDEX" => "indexes",
        "E_QUARRY_PLACEMENT" => "programs",
        "E_UNBOUND_LOOP" | "E_UNBOUND_SCAN" => "bounds",
        "E_SYNC" => "sync",
        "E_SCHEMA_CONSTRAINT" | "E_INDEX_KEY_BYTES" => "indexes",
        "E_EMIT_IN_QUERY" => "programs",
        "E_EFFECT_UNKNOWN" | "E_EFFECT_LEASE" => "effects",
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
