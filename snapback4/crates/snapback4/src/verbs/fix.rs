//! Apply only compiler-marked spelling repairs, preserving surrounding source.

use crate::project::Project;
use snapback4_lang::{Bound, Diagnostic, lexer::{self, Kind, Token}};

// @ref LLP 3000.007#8-9 — apply mechanical fixes and recompile; leave design choices to the author
pub fn compile(project: &Project) -> std::io::Result<Bound> {
    let mut sources = project.sources()?;
    // A spelling repair removes at least one original token's ambiguity.
    // This also bounds a faulty diagnostic that keeps suggesting insertions.
    let budget = sources.iter().map(|(_, text)| text.chars().count()).sum::<usize>();
    for _ in 0..budget {
        let bound = snapback4_lang::compile(&sources);
        let repair = bound.diagnostics.iter().filter(|d| d.mechanical).find_map(|diagnostic| {
            let index = sources.iter().position(|(name, _)| name == &diagnostic.site.file)?;
            edit(&sources, index, diagnostic).map(|(target, start, end, replacement)| (target, start, end, replacement, diagnostic))
        });
        let Some((target, start, end, replacement, diagnostic)) = repair else { return Ok(bound); };
        let (name, source) = &sources[target];
        let path = project.schema_dir().join(name);
        // Refuse an editor save observed since compilation.
        if std::fs::read_to_string(&path)? != *source { return Err(std::io::Error::other(format!("{} changed while check --fix was running; rerun", path.display()))); }
        let mut changed = source.clone();
        changed.replace_range(start..end, &replacement);
        if changed == *source { return Ok(bound); }
        std::fs::write(&path, &changed)?;
        eprintln!("fix: {} — {}: {}", diagnostic.site, diagnostic.code, diagnostic.rewrite.replace('\n', " "));
        sources[target].1 = changed;
    }
    Ok(snapback4_lang::compile(&sources))
}

pub(super) fn edit(sources: &[(String, String)], index: usize, diagnostic: &Diagnostic) -> Option<(usize, usize, usize, String)> {
    if !diagnostic.mechanical { return None; }
    let (_, source) = &sources[index];
    let start = offset(source, diagnostic.site.line, diagnostic.site.col)?;
    if diagnostic.code == "E_QUARRY_AMBIGUOUS" {
        let (old, by) = diagnostic.rewrite.rsplit_once(" by ")?;
        if by.is_empty() || !by.chars().all(|c| c.is_alphanumeric() || c == '_') { return None; }
        let end = matching_end(source, start, old)?;
        return Some((index, end, end, format!(" by {by}")));
    }
    if diagnostic.code == "E_QUARRY_UNKNOWN" && diagnostic.rewrite.starts_with("by ") && diagnostic.message.contains("cannot carry a cursor") {
        // This diagnostic is at the read site; the repair belongs to its
        // table's index declaration, potentially in a different source file.
        let qualified = diagnostic.message.strip_prefix("index ")?.split_whitespace().next()?;
        let (table, _) = qualified.split_once('.')?;
        let original = diagnostic.rewrite.strip_suffix(", id")?;
        for (target, (file, text)) in sources.iter().enumerate() {
            let (document, _) = snapback4_lang::parse_document(file, text);
            let Some(declaration) = document.tables.iter().find(|decl| decl.name == table) else { continue; };
            for index in &declaration.indexes {
                let at = offset(text, index.site.line, index.site.col)?;
                if let Some(end) = matching_end(text, at, original) {
                    return Some((target, end, end, ", id".into()));
                }
            }
        }
        return None;
    }
    if diagnostic.code != "E_QUARRY_UNSUPPORTED" { return None; }
    // These exact token substitutions also work when the compiler's rewrite
    // shows the whole corrected expression or comment.
    for (guess, canonical) in [("elif", "else if"), ("len", "count"), ("proc", "fn"), ("//", "--"), ("#", "--")] {
        if source[start..].starts_with(guess) && diagnostic.rewrite.starts_with(canonical) {
            let end = start + guess.len();
            if guess.chars().all(char::is_alphanumeric) && source[end..].chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_') { return None; }
            return Some((index, start, end, canonical.into()));
        }
    }
    expression_edit(source, start, &diagnostic.rewrite).map(|(start, end, text)| (index, start, end, text))
}

fn offset(source: &str, line: u32, col: u32) -> Option<usize> {
    let mut at = 0;
    for (i, text) in source.split_inclusive('\n').enumerate() {
        if i + 1 == line as usize {
            return text.char_indices().map(|(n, _)| n).chain([text.len()]).nth(col.checked_sub(1)? as usize).map(|col| at + col);
        }
        at += text.len();
    }
    None
}

fn tokens(text: &str) -> Vec<Token> {
    lexer::lex("", text).0.into_iter().filter(|t| matches!(t.kind, Kind::Word | Kind::Number | Kind::Str | Kind::Symbol)).collect()
}

/// Recover the guessed span from an exact canonical conditional rewrite.
/// The diagnostic may point at the operator or the expression's first token.
/// Matching both branches and the condition avoids guessing an expression end.
fn expression_edit(source: &str, site: usize, rewrite: &str) -> Option<(usize, usize, String)> {
    let canonical = tokens(rewrite);
    let mut parts = canonical.as_slice();
    while parts.first().is_some_and(|t| t.kind == Kind::Symbol && t.value == "(") && parts.last().is_some_and(|t| t.kind == Kind::Symbol && t.value == ")") {
        let mut depth = 0;
        let outer = parts[..parts.len() - 1].iter().all(|t| { if t.kind == Kind::Symbol { if t.value == "(" { depth += 1; } else if t.value == ")" { depth -= 1; } } depth > 0 });
        if !outer { break; }
        parts = &parts[1..parts.len() - 1];
    }
    let mut depth = 0;
    let mut conditional = None;
    let mut otherwise = None;
    for (i, token) in parts.iter().enumerate() {
        match (token.kind, token.value.as_str()) {
            (Kind::Symbol, "(" | "[" | "{") => depth += 1,
            (Kind::Symbol, ")" | "]" | "}") => depth -= 1,
            (Kind::Word, "if") if depth == 0 && conditional.is_none() => conditional = Some(i),
            (Kind::Word, "else") if depth == 0 && conditional.is_some() => { otherwise = Some(i); break; }
            _ => {}
        }
    }
    let (a, b) = (conditional?, otherwise?);
    let (yes, condition, no) = (&parts[..a], &parts[a + 1..b], &parts[b + 1..]);
    if yes.is_empty() || condition.is_empty() || no.is_empty() { return None; }
    let symbol = |s: &str| tokens(s).remove(0);
    let mut guesses = vec![[condition.to_vec(), vec![symbol("?")], yes.to_vec(), vec![symbol(":")], no.to_vec()].concat()];
    if condition.len() >= 3 && condition[condition.len() - 2].value == "!=" && condition.last()?.value == "null" && no.len() == 1 && no[0].value == "null" {
        let base = &condition[..condition.len() - 2];
        if yes.len() == base.len() + 2 && same(&yes[..base.len()], base) && yes[base.len()].value == "." {
            guesses.push([base.to_vec(), vec![symbol("?"), symbol(".")], vec![yes.last()?.clone()]].concat());
        }
    }
    let actual = tokens(source);
    for guess in guesses {
        for candidate in actual.windows(guess.len()) {
            if !same(candidate, &guess) { continue; }
            let start = offset(source, candidate[0].site.line, candidate[0].site.col)?;
            let last = candidate.last()?;
            let last_at = offset(source, last.site.line, last.site.col)?;
            let end = token_end(source, last_at, last)?;
            if start <= site && site < end { return Some((start, end, format!("({rewrite})"))); }
        }
    }
    None
}

fn same(a: &[Token], b: &[Token]) -> bool { a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.kind == b.kind && a.value == b.value) }

/// The printer normalizes whitespace and quoting, so compare lexer values;
/// use the original token's end to retain comments and the surrounding form.
fn matching_end(source: &str, start: usize, expected: &str) -> Option<usize> {
    let actual = tokens(&source[start..]);
    let expected = tokens(expected);
    if expected.is_empty() || actual.len() < expected.len() || !actual.iter().zip(&expected).all(|(a, b)| a.kind == b.kind && a.value == b.value) { return None; }
    let last = &actual[expected.len() - 1];
    let at = start + offset(&source[start..], last.site.line, last.site.col)?;
    token_end(source, at, last)
}

fn token_end(source: &str, at: usize, last: &Token) -> Option<usize> {
    if last.kind != Kind::Str { return Some(at + last.value.len()); }
    let quote = source[at..].chars().next()?;
    let mut escaped = false;
    for (i, c) in source[at + quote.len_utf8()..].char_indices() {
        if escaped { escaped = false; }
        else if c == '\\' { escaped = true; }
        else if c == quote { return Some(at + quote.len_utf8() + i + c.len_utf8()); }
    }
    None
}
