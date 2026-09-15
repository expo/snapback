//! Apply only compiler-marked spelling repairs, preserving surrounding source.

use crate::project::Project;
use snapback4_lang::{Bound, Diagnostic, lexer::{self, Kind, Token}};

/// The check command's source-I/O refusal, also exercised by the interleaved-editor subprocess tests.
pub(super) fn checked(result: std::io::Result<Bound>) -> Result<Bound, i32> {
    result.map_err(|error| { eprintln!("cannot read snapback/: {error}"); 2 })
}

// @ref LLP 3000.007#8 — apply mechanical fixes and recompile; leave design choices to the author
pub fn compile(project: &Project) -> std::io::Result<Bound> {
    compile_observed(project, |_| {})
}

// The observer lets the integration suite interleave an editor save at each I/O boundary.
pub(super) fn compile_observed(project: &Project, mut observe: impl FnMut(&str)) -> std::io::Result<Bound> {
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
        observe("compiled");
        let Some((target, start, end, replacement, diagnostic)) = repair else { return project.compile(); };
        let (name, source) = &sources[target];
        let path = project.schema_dir().join(name);
        // @ref LLP 3000.007#18.5 — a cross-file repair depends on every compiled source, including the query's file.
        verify_sources(project, &sources)?;
        let mut changed = source.clone();
        changed.replace_range(start..end, &replacement);
        if changed == *source { return project.compile(); }
        observe("write");
        // Best effort: an editor can still save between these reads and the write.
        verify_sources(project, &sources)?;
        std::fs::write(&path, &changed)?;
        eprintln!("fix: {} — {}: {}", diagnostic.site, diagnostic.code, diagnostic.rewrite.replace('\n', " "));
        sources[target].1 = changed;
    }
    project.compile()
}

fn verify_sources(project: &Project, sources: &[(String, String)]) -> std::io::Result<()> {
    let current = project.sources()?;
    if let Some(name) = sources.iter().find(|(name, text)| !current.iter().any(|(n, t)| n == name && t == text)).map(|(name, _)| name)
        .or_else(|| current.iter().find(|(name, _)| !sources.iter().any(|(n, _)| n == name)).map(|(name, _)| name)) {
        return Err(changed_source(&project.schema_dir().join(name)));
    }
    Ok(())
}

fn changed_source(path: &std::path::Path) -> std::io::Error {
    std::io::Error::other(format!("{} changed while check --fix was running; rerun", path.display()))
}

pub(super) fn edit(sources: &[(String, String)], index: usize, diagnostic: &Diagnostic) -> Option<(usize, usize, usize, String)> {
    if !diagnostic.mechanical { return None; }
    let (_, source) = &sources[index];
    let start = offset(source, diagnostic.site.line, diagnostic.site.col)?;
    // @ref LLP 3000.007#19.3 — replace only the exact two adjacent equality symbols, rechecked outside strings and comments.
    if diagnostic.code == "E_QUARRY_SYNTAX" && diagnostic.message == "equality is = in Quarry" && diagnostic.rewrite == "=" {
        let actual = tokens(source);
        let at = actual.iter().position(|t| offset(source, t.site.line, t.site.col) == Some(start))?;
        let pair = actual.get(at..at + 2)?;
        if pair.iter().any(|t| t.kind != Kind::Symbol || t.value != "=")
            || offset(source, pair[1].site.line, pair[1].site.col) != Some(start + 1)
            || !source[start..].starts_with("==") || source[start + 2..].starts_with('=')
            || source[..start].ends_with('=') { return None; }
        return Some((index, start, start + 2, "=".into()));
    }
    if diagnostic.code == "E_QUARRY_TYPE" && diagnostic.message.starts_with("shape ") && diagnostic.message.contains(" after where attaches to ") {
        let name = diagnostic.rewrite.strip_prefix("{ ...")?.strip_suffix(" }")?;
        let actual = tokens(source);
        let at = actual.iter().position(|t| offset(source, t.site.line, t.site.col) == Some(start))?;
        if actual[at].kind != Kind::Word || actual[at].value != name { return None; }
        let mut depth = 0usize;
        let mut wheres = Vec::new();
        for token in &actual[..at] {
            match (token.kind, token.value.as_str()) {
                (Kind::Symbol, "(" | "[" | "{") => depth += 1,
                (Kind::Symbol, ")" | "]" | "}") => { depth = depth.checked_sub(1)?; wheres.retain(|d| *d <= depth); }
                (Kind::Word, "where") => wheres.push(depth),
                _ => {}
            }
        }
        // A parenthesized predicate closes before the page shape. Parentheses
        // surrounding the whole read (e.g. count(page)) close after the shape.
        let closing = depth.checked_sub(*wheres.last()?)?;
        if actual.get(at + 1..at + 1 + closing)?.iter().any(|t| t.kind != Kind::Symbol || t.value != ")") { return None; }
        if closing == 0 { return Some((index, start, start + name.len(), diagnostic.rewrite.clone())); }
        let last = &actual[at + closing];
        let end = offset(source, last.site.line, last.site.col)? + 1;
        return Some((index, start, end, format!("{} {}", &source[start + name.len()..end], diagnostic.rewrite)));
    }
    // @ref LLP 3000.007#18.5 — exact repairs for missing indexes, argument once, wildcard repeats and empty operation parentheses
    if let Some(repair) = discovery_edit(sources, index, diagnostic, start) { return Some(repair); }
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
    if diagnostic.code == "E_QUARRY_UNKNOWN" && diagnostic.message.starts_with("schedule ") && diagnostic.message.contains(" names bare job ") {
        let (module, job) = diagnostic.rewrite.split_once('.')?;
        if [module, job].iter().any(|part| part.is_empty() || !part.chars().all(|c| c.is_alphanumeric() || c == '_')) { return None; }
        let line = source[start..].split(['\r', '\n']).next()?;
        let actual = tokens(line);
        let colon = actual.iter().rposition(|t| t.value == ":")?;
        let target = actual.get(colon + 1)?;
        if actual.first()?.value != "schedule" || colon + 2 != actual.len() || target.value != job { return None; }
        let at = start + offset(line, target.site.line, target.site.col)?;
        return Some((index, at, at + job.len(), diagnostic.rewrite.clone()));
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

/// Recheck the canonical tokens before applying a compiler-marked repair.
fn discovery_edit(sources: &[(String, String)], index: usize, d: &Diagnostic, start: usize) -> Option<(usize, usize, usize, String)> {
    let source = &sources[index].1;
    if d.code == "E_QUARRY_UNKNOWN" && d.message.contains(" has no index ") && d.rewrite.starts_with("by ") {
        let table = d.message.split_once(" has no index ")?.0;
        let (name, columns) = d.rewrite.strip_prefix("by ")?.split_once(": ")?;
        let ident = |s: &str| !s.is_empty() && s.chars().enumerate().all(|(i, c)| c == '_' || c.is_alphabetic() || (i > 0 && c.is_ascii_digit()));
        let columns: Vec<_> = columns.split(", ").collect();
        if !ident(name) || columns.is_empty() || columns.iter().any(|c| !ident(c)) || columns.iter().collect::<std::collections::BTreeSet<_>>().len() != columns.len() { return None; }
        for (target, (file, text)) in sources.iter().enumerate() {
            let (document, _) = snapback4_lang::parse_document(file, text);
            let Some(decl) = document.tables.iter().find(|decl| decl.name == table) else { continue; };
            if decl.indexes.iter().any(|i| i.name == name) || columns.iter().any(|c| *c != "id" && !decl.columns.iter().any(|col| col.name == *c)) { return None; }
            let site = decl.indexes.last().map(|i| &i.site).or_else(|| decl.columns.last().map(|c| &c.site))?;
            let line = offset(text, site.line, 1)?;
            let end = line + text[line..].find('\n').map(|n| n + 1).unwrap_or(text.len() - line);
            let indentation: String = text[line..].chars().take_while(|c| *c == ' ' || *c == '\t').collect();
            let newline = if text[line..end].ends_with("\r\n") { "\r\n" } else { "\n" };
            let prefix = if text[line..end].ends_with('\n') { "" } else { newline };
            return Some((target, end, end, format!("{prefix}{indentation}{}{newline}", d.rewrite)));
        }
        return None;
    }
    if d.code == "E_QUARRY_SYNTAX" && d.message == "once is a column modifier, not an argument constraint; declare it on the owning table column" {
        let actual = tokens(&source[start..]);
        let canonical = tokens(&d.rewrite);
        let once = actual.iter().position(|t| t.kind == Kind::Word && t.value == "once")?;
        let mut candidate = actual.get(..canonical.len() + 1)?.to_vec();
        if once >= candidate.len() { return None; }
        candidate.remove(once);
        if !same(&candidate, &canonical) { return None; }
        let token = &actual[once];
        let at = start + offset(&source[start..], token.site.line, token.site.col)?;
        let mut from = at;
        while from > start && matches!(source.as_bytes()[from - 1], b' ' | b'\t') { from -= 1; }
        return Some((index, from, at + 4, String::new()));
    }
    if d.code == "E_QUARRY_SYNTAX" && d.message == "an operation with no arguments still needs parentheses" {
        let old = d.rewrite.strip_suffix("():")?;
        let end = matching_end(source, start, old)?;
        let colon = tokens(&source[end..]).first()?.clone();
        if colon.value != ":" { return None; }
        return Some((index, end, end, "()".into()));
    }
    if d.code == "E_QUARRY_UNKNOWN" && d.message.starts_with("shape wildcard already includes field ") {
        let name = d.message.strip_prefix("shape wildcard already includes field ")?;
        let actual = tokens(source);
        let field = actual.iter().position(|t| offset(source, t.site.line, t.site.col) == Some(start))?;
        if actual[field].value != name || actual.get(field + 1).is_none_or(|t| ![",", "}"].contains(&t.value.as_str())) { return None; }
        // Verify the entire enclosing shape against the rewrite, so stale or
        // mismatched sites do not edit. A first field uses its following comma.
        let preceding = actual.get(field.checked_sub(1)?)?.value == ",";
        let comma = if preceding { field - 1 } else { field + 1 };
        if actual.get(comma)?.value != "," { return None; }
        let mut depth = 0;
        let open = (0..field).rev().find(|i| { if actual[*i].kind != Kind::Symbol { return false; } match actual[*i].value.as_str() { "}" => depth += 1, "{" if depth == 0 => return true, "{" => depth -= 1, _ => {} } false })?;
        depth = 0;
        let close = (open..actual.len()).find(|i| { if actual[*i].kind != Kind::Symbol { return false; } match actual[*i].value.as_str() { "{" => depth += 1, "}" => depth -= 1, _ => {} } depth == 0 })?;
        let mut candidate = actual[open..=close].to_vec();
        candidate.drain(field.min(comma) - open..=field.max(comma) - open);
        if !same(&candidate, &tokens(&d.rewrite)) { return None; }
        let comma_at = offset(source, actual[comma].site.line, actual[comma].site.col)?;
        let (from, end, gap) = if preceding { (comma_at, start + name.len(), &source[comma_at + 1..start]) }
            else { (start, comma_at + 1, &source[start + name.len()..comma_at]) };
        if gap.chars().any(|c| !c.is_whitespace()) { return None; }
        return Some((index, from, end, String::new()));
    }
    None
}
