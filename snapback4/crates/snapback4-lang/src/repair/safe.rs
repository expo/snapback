//! Conservative, context-compiled fix-its. No invented defaults, bounds or rules.
use super::*;
use crate::ast::Expr as A;

// @ref LLP 3000.007#8 — a fix must be a verified source edit, never prose advice.
pub(super) fn verify(documents: &[Document], diagnostics: &mut [Diagnostic]) {
    for d in diagnostics {
        if !matches!(d.code.as_str(), "E_QUARRY_TYPE" | "E_QUARRY_UNKNOWN" | "E_QUARRY_BOUND") { continue; }
        let Some(doc) = documents.iter().find(|doc| doc.file == d.site.file) else { continue; };
        let Some((expr, text, _, start)) = doc.source.expressions.get(&d.site.to_string()).or_else(||
            doc.source.expressions.values().filter(|(expr, ..)| expr_at(expr, &d.site).is_some()).min_by_key(|(_,text,..)| text.len())) else { continue; };
        let Some(offending) = expr_at(expr, &d.site) else { continue; };
        // Never edit table/column rules, invariants, or other security declarations.
        let Some(program) = doc.programs.iter().filter(|p| p.site.line <= start.line)
            .max_by_key(|p| p.site.line) else { continue; };
        let Some(source) = doc.source.declarations.get(&program.site.to_string()) else { continue; };
        let mut edit_start = start.clone();
        let mut original = text.clone();
        let rewrite = if d.message.contains("needs a bool condition, got bool ?") {
            Some(format!("({text}) = true"))
        } else if d.message.contains("needs present numbers; got ") || d.message.contains("needs present operands; got ") {
            if let Some((condition, guards)) = guarded_condition(&program.body, offending, &d.message, doc) {
                if let Some((_, value, _, at)) = doc.source.expressions.get(&condition.site().to_string()) {
                    original = value.clone(); edit_start = at.clone();
                    Some(format!("{} and ({value})", guards.join(" and ")))
                } else { None }
            } else if expr.site() == &d.site { nullable_arithmetic(expr, text, &d.message, doc) } else { None }
        } else if d.message.starts_with("insert into ") && d.message.contains("omits required column") {
            insert(expr, text, program, &d.message)
        } else if d.code == "E_QUARRY_UNKNOWN" && d.message.starts_with("unknown name ") {
            // Only a unique case-insensitive parameter spelling: never guess a
            // similar role, table, helper, enum or authorization expression.
            if let A::Name { name, .. } = expr {
                let names: Vec<_> = program.args.iter().filter(|a| a.name != *name && a.name.eq_ignore_ascii_case(name)).collect();
                if let [arg] = names.as_slice() { Some(arg.name.clone()) } else { None }
            } else { None }
        } else if d.code == "E_QUARRY_BOUND" && total_unique(expr, documents) {
            // A unique, fully pinned non-null key preserves every row with first 1.
            d.rewrite.split_once("makes this at most one row: `").and_then(|(_, s)| s.split_once('`')).map(|(s, _)| s.to_owned())
        } else { None };
        let Some(rewrite) = rewrite else { continue; };
        let Some(from) = offset(source, edit_start.line - program.site.line + 1, edit_start.col) else { continue; };
        let span = from..from + original.len();
        if source.get(span.clone()) != Some(original.as_str()) { continue; }
        let candidate = Candidate { site: d.site.clone(), declaration_site: program.site.clone(), source: source.clone(), replacement: span,
            rewrite, intended: None, message: None };
        if check_context(documents, &candidate, false) != Check::Accepted { continue; }
        d.rewrite = candidate.rewrite;
        d.mechanical = true;
        d.verified_edit = Some((edit_start.clone(), original.clone()));
        // The diagnostic shows the exact edited source line, including its
        // surrounding return/require/write, while rewrite stays the span edit.
        if !original.contains('\n') && !d.rewrite.contains('\n') {
            let line = source.lines().nth((edit_start.line - program.site.line) as usize).unwrap_or("");
            if let Some(col) = offset(line, 1, edit_start.col) {
                let mut edited = line.to_owned();
                if edited.get(col..col + original.len()) == Some(original.as_str()) {
                    edited.replace_range(col..col + original.len(), &d.rewrite);
                    d.details = Some(format!("edited line: {edited}"));
                }
            }
        }
    }
}

fn offset(source: &str, line: u32, col: u32) -> Option<usize> {
    let mut at = 0;
    for (i, text) in source.split_inclusive('\n').enumerate() {
        if i + 1 == line as usize { return text.char_indices().map(|(n, _)| n).chain([text.len()]).nth(col.checked_sub(1)? as usize).map(|n| at + n); }
        at += text.len();
    }
    None
}
fn stable(expr: &A) -> bool { matches!(expr, A::Name { .. } | A::Literal { .. }) || matches!(expr, A::Member {base, ..} if matches!(base.as_ref(), A::Name {..})) }
fn nullable_arithmetic(expr: &A, text: &str, message: &str, doc: &Document) -> Option<String> {
    let A::Binary { op, left, right, .. } = expr else { return None; };
    if !matches!(op.as_str(), "+" | "-" | "*") || !stable(left) || !stable(right) { return None; }
    let (a, b) = message.split_once("got ")?.1.split_once(" and ")?;
    let mut guards = Vec::new();
    for (operand, ty) in [(left, a), (right, b)] {
        if ty.ends_with(" ?") { guards.push(format!("{} != null", doc.source.expression(operand))); }
    }
    if guards.is_empty() { return None; }
    // Null propagation retains absence. Choosing zero/now could admit a write
    // that should refuse, so a required destination receives advice only.
    Some(format!("({text} if {} else null)", guards.join(" and ")))
}
fn insert(expr: &A, text: &str, program: &ProgramDecl, message: &str) -> Option<String> {
    let A::Write { op: WriteOp::Insert, condition: None, .. } = expr else { return None; };
    let missing = message.split_once("omits required column")?.1.trim_start_matches('s').trim();
    let names: Vec<_> = missing.split(", ").collect();
    if names.iter().any(|name| !program.args.iter().any(|arg| arg.name == *name)) { return None; }
    // Last brace is the insert payload (condition is excluded above). Preserve
    // expressions, strings and comments verbatim; refuse commented tails.
    let end = text.rfind('}')?;
    let before = text[..end].trim_end();
    if before.lines().last()?.contains("--") { return None; }
    let comma = if before.ends_with(['{', ',']) { "" } else { "," };
    Some(format!("{before}{comma} {} {}", names.join(", "), &text[end..]))
}

// Only a positive comparison/arithmetic condition. Do not move null guards
// across not/or, calls, references, or unrelated branches.
fn positive_contains(condition: &A, site: &Site) -> bool {
    if condition.site() == site { return true; }
    match condition {
        A::Binary {op, left, right, ..} if matches!(op.as_str(), "+"|"-"|"*"|"<"|"<="|">"|">="|"="|"!="|"and") => positive_contains(left, site) || positive_contains(right, site),
        _ => false,
    }
}
fn guarded_condition<'a>(body: &'a [Stmt], expr: &A, message: &str, doc: &Document) -> Option<(&'a A, Vec<String>)> {
    let A::Binary {left, right, ..} = expr else { return None; };
    let (a,b) = message.split_once("got ")?.1.split_once(" and ")?;
    let mut guards = Vec::new();
    for (value, ty) in [(left, a), (right,b)] {
        if ty.ends_with(" ?") { if !stable(value) { return None; } guards.push(format!("{} != null", doc.source.expression(value))); }
    }
    if guards.is_empty() { return None; }
    for statement in body {
        match statement {
            Stmt::Require {condition,..} | Stmt::If {condition,..} if positive_contains(condition, expr.site()) => return Some((condition,guards)),
            Stmt::If {then_body,else_body,..} => if let Some(found) = guarded_condition(then_body,expr,message,doc).or_else(||guarded_condition(else_body,expr,message,doc)) {return Some(found);},
            _ => {},
        }
    }
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn nullable_unique_population_is_never_repaired_with_first_one() {
        let source = "table tags:\n  slug: text <=40 ?\n  unique bySlug: slug\n  public\nquery q():\n  return tags[slug = null] by .slug\n";
        let bound = crate::compile(&[("schema.q".into(),source.into())]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"), "{:?}", bound.diagnostics);
        assert!(bound.diagnostics.iter().all(|d| !d.mechanical), "{:?}", bound.diagnostics);
    }
    #[test]
    fn nullable_guard_has_an_exact_source_span() {
        let source = "query q(at: time ?):\n  require at + 1 > now else LATE\n  return 1\n";
        let (doc, _) = crate::parse_document("schema.q", source);
        let bound = crate::compile(&[("schema.q".into(),source.into())]);
        assert!(bound.diagnostics.iter().all(|d| d.mechanical), "{:?}\n{:?}", bound.diagnostics, doc.source);
    }
}

fn expr_at<'a>(expr: &'a A, site: &Site) -> Option<&'a A> {
    if expr.site() == site { return Some(expr); }
    match expr {
        A::Binary {left,right,..} => expr_at(left,site).or_else(||expr_at(right,site)),
        A::Unary {value,..} => expr_at(value,site),
        A::Member {base,..} => expr_at(base,site),
        _ => None,
    }
}

fn total_unique(expr: &A, documents: &[Document]) -> bool {
    let A::Read(read) = expr else { return false; };
    let Some(table) = documents.iter().flat_map(|doc| &doc.tables).find(|table| table.name == read.table) else { return false; };
    let named = |column: &str| read.keys.iter().any(|key| key.column.as_deref() == Some(column));
    if named("id") { return true; }
    table.indexes.iter().any(|index| index.unique && index.is_plain() && index.columns.len() == read.keys.len()
        && index.columns.iter().all(|column| (column == "id" || table.columns.iter().any(|c| c.name == *column && !c.type_.optional))
            && (named(column) || read.index.as_ref() == Some(&index.name) && read.keys.iter().all(|key| key.column.is_none()))))
}
