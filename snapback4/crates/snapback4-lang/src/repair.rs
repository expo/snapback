//! Verify executable repairs in the affected declaration's context.
//! Retain caller operands; never recursively verify a candidate's diagnostics.
use crate::{ast::*, bind, parser, Bound, Diagnostic, Site};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ReadChange { Index(String), Point }

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ReadRepair {
    pub site: Site,
    pub changes: Vec<ReadChange>,
}

// @ref LLP 3000.013#2.2 — index advice is source only after the patched
// declaration passes the real parser, planner and admission in its own scope.
pub(crate) fn verify_bound(documents: &[Document], diagnostics: &mut [Diagnostic]) {
    for diagnostic in diagnostics {
        let Some(repair) = diagnostic.read_repair.take() else { continue; };
        diagnostic.rewrite = repair.changes.iter().find_map(|change| {
            let candidate = read_candidate(documents, &repair.site, change)?;
            (check_context(documents, &candidate, true) == Check::Accepted).then_some(candidate.rewrite)
        }).unwrap_or_default();
        if diagnostic.rewrite.is_empty() { diagnostic.mechanical = false; }
    }
}

fn read_candidate(documents: &[Document], site: &Site, change: &ReadChange) -> Option<Candidate> {
    let doc = documents.iter().find(|doc| doc.file == site.file)?;
    let (read, text, grouped, start) = doc.source.read(site)?;
    let mut fixed = read.clone();
    match change {
        ReadChange::Index(index) => { fixed.index = Some(index.clone()); }
        ReadChange::Point => {
            // A point cannot silently discard a population predicate or cursor.
            if read.filter.is_some() || read.matching.is_some() || !read.seeks.is_empty()
                || !read.order_keys.is_empty() || read.range.as_ref()?.cursor.is_some() { return None; }
            fixed.range = None;
        }
    }
    // Retain the caller's operands, including grouping, literals and comments.
    // Never invent expressions from the selected index's column names.
    let fixed = Expr::Read(fixed);
    let rewrite = crate::print::with_source_at(&fixed, if grouped { 8 } else { 0 }, &|expr| doc.source.get(expr));
    let (declaration_site, source, replacement) = doc.source.declarations.iter().find_map(|(key, source)| {
        let (key, col) = key.rsplit_once(':')?;
        let (file, line) = key.rsplit_once(':')?;
        let declaration_site = Site::new(file, line.parse().ok()?, col.parse().ok()?);
        if file != site.file { return None; }
        let line = start.line.checked_sub(declaration_site.line)? as usize;
        let lines = source.split('\n').collect::<Vec<_>>();
        let column = start.col.checked_sub(1)? as usize;
        let byte = lines.get(line)?.char_indices().map(|(i, _)| i).chain([lines[line].len()]).nth(column)?;
        let offset = lines[..line].iter().map(|s| s.len() + 1).sum::<usize>() + byte;
        let span = offset..offset.checked_add(text.len())?;
        (source.get(span.clone())? == text).then_some((declaration_site, source.clone(), span))
    })?;
    Some(Candidate { site: site.clone(), declaration_site, source, replacement, rewrite, intended: None, message: None })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub site: Site,
    pub declaration_site: Site,
    pub source: String,
    pub replacement: Range<usize>,
    pub rewrite: String,
    pub intended: Option<ReadExpr>,
    pub message: Option<String>,
}

pub(crate) fn verify(documents: &[Document], diagnostics: &mut [Diagnostic]) {
    for diagnostic in diagnostics {
        // Other diagnostics include design advice rather than executable edits.
        // These are the concrete repairs introduced by the familiarity lane.
        if diagnostic.code != "E_QUARRY_SELF_EQUALITY"
            && !(diagnostic.code == "E_QUARRY_UNSUPPORTED" && diagnostic.message.starts_with("count(*)")) { continue; }
        if diagnostic.rewrite.is_empty() { continue; }
        let candidate = documents.iter().flat_map(|doc| &doc.source.repairs).rev()
            .find(|candidate| candidate.site == diagnostic.site && candidate.rewrite == diagnostic.rewrite);
        let verified = candidate.and_then(|candidate| {
            // A where population cannot become a nullable unique point, even
            // when the bare point compiles (for example, a required outer key).
            if nullable_key(documents, candidate) && let Some(page) = key_page(documents, candidate) {
                return (check(documents, &page) == Check::Accepted).then_some(page);
            }
            match check(documents, candidate) {
                Check::Accepted => Some(candidate.clone()),
                Check::Unbound => {
                    let page = key_page(documents, candidate)?;
                    (check(documents, &page) == Check::Accepted).then_some(page)
                }
                Check::Rejected => None,
            }
        });
        if let Some(candidate) = verified {
            diagnostic.rewrite = candidate.rewrite;
            if let Some(message) = candidate.message { diagnostic.message = message; }
        } else { diagnostic.rewrite.clear(); }
    }
}

#[derive(PartialEq, Eq)]
enum Check { Accepted, Unbound, Rejected }

fn nullable_key(documents: &[Document], candidate: &Candidate) -> bool {
    let Some(read) = &candidate.intended else { return false; };
    let Some(table) = documents.iter().flat_map(|doc| &doc.tables).find(|table| table.name == read.table) else { return false; };
    table.indexes.iter().any(|index| index.unique && index.is_plain()
        && index.columns.len() == read.keys.len()
        && index.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column)))
        && index.columns.iter().any(|column| table.columns.iter().any(|c| &c.name == column && c.type_.optional)))
}

// A nullable key must retain a population. Other page fallbacks retry only
// after a binding failure, never to bypass a compiling wrong plan.
fn key_page(documents: &[Document], candidate: &Candidate) -> Option<Candidate> {
    let mut page = candidate.clone();
    let read = page.intended.as_mut()?;
    if read.range.is_some() || read.filter.is_some() || read.matching.is_some()
        || !read.seeks.is_empty() || !read.order_keys.is_empty() { return None; }
    let table = documents.iter().flat_map(|doc| &doc.tables).find(|table| table.name == read.table)?;
    let pinned = |column: &str| read.keys.iter().any(|key| key.column.as_deref() == Some(column));
    // first 1 must preserve the entire population. Nullable unique indexes
    // can contain tied nulls and do not establish a one-row bound.
    let total = pinned("id") || table.indexes.iter().any(|index| index.unique && index.is_plain()
        && index.columns.iter().all(|column| pinned(column) && (column == "id"
            || table.columns.iter().any(|c| &c.name == column && !c.type_.optional))));
    if nullable_key(documents, candidate) {
        // @ref LLP 3000.013#2.2 — preserve every nullable unique tie with
        // an explicit population order; verification still checks its bound.
        read.order_keys.push("id".into());
        page.rewrite.push_str(" by .id");
        if let Some(message) = &mut page.message { message.push_str(" with `by .id` to keep every null match"); }
    } else if total {
        read.range = Some(RangeSpec { order: Order::Asc, take: 1, cursor: None, site: read.site.clone() });
        page.rewrite.push_str(" first 1");
        if let Some(message) = &mut page.message { message.push_str(" with `first 1` to keep a page"); }
    } else { return None; }
    Some(page)
}

fn check(documents: &[Document], candidate: &Candidate) -> Check {
    check_context(documents, candidate, false)
}

fn check_context(documents: &[Document], candidate: &Candidate, keep_operations: bool) -> Check {
    let Some(patched) = parser::repairs::splice(&candidate.source,
        vec![(candidate.replacement.clone(), candidate.rewrite.clone())]) else { return Check::Rejected; };
    // Retain original source sites without reparsing any other declaration.
    let source = format!("{}{patched}", "\n".repeat(candidate.declaration_site.line.saturating_sub(1) as usize));
    let tables = documents.iter().flat_map(|doc| doc.tables.iter().cloned()).collect();
    let (replacement, diagnostics) = parser::parse_with_types(&candidate.site.file, &source, tables, Default::default());
    if !diagnostics.is_empty() { return Check::Rejected; }
    // A standalone shape has no focal type until instantiated. A helper
    // signature edit would require checking callers outside this declaration.
    // Neither has a complete local proof: keep the refusal without a repair.
    if !replacement.shapes.is_empty() { return Check::Rejected; }
    for function in &replacement.functions {
        if documents.iter().flat_map(|doc| &doc.functions).any(|old|
            affected(candidate, &old.site) && old.args.len() != function.args.len()) { return Check::Rejected; }
    }
    let mut context = context(documents, candidate, replacement, keep_operations);
    // Helpers are normally checked at their call sites. Check this helper with
    // its own typed arguments; do not bind unrelated operations to exercise it.
    for doc in &mut context {
        if let Some(function) = doc.functions.iter().find(|decl| affected(candidate, &decl.site)) {
            let args = function.args.iter().map(|arg| format!("{}: {}", arg.name, crate::print::scalar_type(&arg.type_))).collect::<Vec<_>>().join(", ");
            let values = function.args.iter().map(|arg| arg.name.as_str()).collect::<Vec<_>>().join(", ");
            let probe = format!("query repairProbe({args}):\n  return {}({values})\n", function.name);
            let (mut parsed, errors) = parser::parse_document(&doc.file, &probe);
            if !errors.is_empty() { return Check::Rejected; }
            doc.programs.append(&mut parsed.programs);
        }
    }
    let actual = bind::bind_unverified(context.clone());
    if !actual.diagnostics.is_empty() { return Check::Unbound; }
    let Some(intended) = &candidate.intended else { return Check::Accepted; };
    // Compile the intended read as syntax in the *same* scope. This AST is
    // never printed. Both runs use the real planner and admission checks.
    let mut replaced = 0;
    for doc in &mut context {
        bind::intent_walk::document(doc, &mut |expr| {
            let read = match expr { Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => read, _ => return };
            if read.site == intended.site {
                *read = intended.clone();
                replaced += 1;
            }
        });
    }
    if replaced != 1 { return Check::Rejected; }
    let expected = bind::bind_unverified(context);
    let class = |bound: &Bound| bound.programs.iter().flat_map(|program| {
        let scans = snapback4_core::ir::scans(&program.program);
        program.sources.iter().filter(|(key, (site, _))| *site == intended.site && program.selections.contains_key(*key))
            .map(|(key, _)| scans.iter().any(|scan| &scan.site == key)).collect::<Vec<_>>()
    }).collect::<std::collections::BTreeSet<_>>();
    let actual_class = class(&actual);
    if expected.diagnostics.is_empty() && !actual_class.is_empty() && actual_class == class(&expected) { Check::Accepted } else { Check::Rejected }
}

fn affected(candidate: &Candidate, site: &Site) -> bool {
    let last = candidate.declaration_site.line + candidate.source.lines().count() as u32;
    site.file == candidate.site.file && (candidate.declaration_site.line..last).contains(&site.line)
}

fn context(documents: &[Document], candidate: &Candidate, replacement: Document, keep_operations: bool) -> Vec<Document> {
    let mut context = documents.to_vec();
    for doc in &mut context {
        // Parser repairs need a declaration-local proof. Index repairs retain
        // every caller as well: switching a range to a point can change a
        // helper's result type or violate a job's chunk/cursor contract.
        if !keep_operations { doc.programs.clear(); doc.actions.clear(); doc.routes.clear(); doc.schedules.clear(); }
        if doc.file != candidate.site.file { continue; }
        macro_rules! replace {
            ($($field:ident),*) => { $(
                doc.$field.retain(|decl| !affected(candidate, &decl.site));
                doc.$field.extend(replacement.$field.clone());
            )* };
        }
        replace!(tables, maintains, timelines, views, feed_views, effects, shapes, functions, programs, actions, routes, schedules);
        doc.source.extend(&replacement.source);
    }
    context
}

#[cfg(test)]
mod tests {
    use super::*;
    const MODEL: &str = "table members:\n  active: bool\n  cap 50\n  public\n";

    fn accepted(documents: &[Document], candidate: &Candidate) -> bool { check(documents, candidate) == Check::Accepted }

    fn candidate(nested: &str) -> (Document, Diagnostic, Candidate) {
        let source = format!("{MODEL}query q(c: cursor ?):\n  return members first 20 after c {{ twin: {nested} }}\n");
        let (document, mut diagnostics) = parser::parse_document("schema.q", &source);
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let diagnostic = diagnostics.remove(0);
        let candidate = document.source.repairs.iter().find(|r| r.rewrite == diagnostic.rewrite).unwrap().clone();
        (document, diagnostic, candidate)
    }

    fn suppressed(mut document: Document, mut diagnostic: Diagnostic, mut candidate: Candidate, broken: &str) {
        candidate.rewrite = broken.into();
        diagnostic.rewrite = broken.into();
        document.source.repairs = vec![candidate];
        let message = diagnostic.message.clone();
        let mut diagnostics = vec![diagnostic];
        verify(&[document], &mut diagnostics);
        assert_eq!(diagnostics[0].rewrite, "", "unchecked repair escaped verification");
        assert_eq!(diagnostics[0].message, message);
        assert_eq!(diagnostics[0].code, "E_QUARRY_SELF_EQUALITY");
    }

    #[test]
    fn broken_syntax_names_and_types_are_suppressed_before_offering() {
        for broken in ["members[id = .id])", "members[id = missing]", "members[id = true]"] {
            let (document, diagnostic, candidate) = candidate("members where .id = .id");
            assert!(accepted(&[document.clone()], &candidate));
            suppressed(document, diagnostic, candidate, broken);
        }
    }

    #[test]
    fn compiling_repairs_that_change_point_or_page_class_are_suppressed() {
        for (nested, broken) in [
            ("members where .id = .id", "members[id = .id] where true"),
            ("members where .id = .id first 20", "members[id = .id]"),
        ] {
            let (document, diagnostic, candidate) = candidate(nested);
            let pasted = parser::repairs::splice(&candidate.source, vec![(candidate.replacement.clone(), broken.into())]).unwrap();
            let bound = crate::compile(&[("schema.q".into(), format!("{MODEL}{pasted}"))]);
            assert!(bound.diagnostics.is_empty(), "the bad plan must compile to exercise the class guard: {:?}", bound.diagnostics);
            assert!(accepted(&[document.clone()], &candidate));
            suppressed(document, diagnostic, candidate, broken);
        }
    }

    #[test]
    fn count_star_prose_is_not_a_verified_replacement() {
        let source = format!("{MODEL}query q():\n  return count(*)\n");
        let (mut document, mut diagnostics) = parser::parse_document("schema.q", &source);
        assert_eq!(diagnostics[0].rewrite, "count(members)");
        assert!(accepted(&[document.clone()], &document.source.repairs[0]));
        let prose = "count(rows) or count(members)";
        document.source.repairs[0].rewrite = prose.into();
        diagnostics[0].rewrite = prose.into();
        verify(&[document], &mut diagnostics);
        assert!(diagnostics[0].rewrite.is_empty());
    }

    #[test]
    fn key_page_fallback_preserves_total_and_nullable_populations() {
        for (optional, unique, suffix) in [("", "", None), (" ?", "  unique active\n", Some(" by .id")), ("", "  unique active\n", Some(" first 1"))] {
            let source = format!("table members:\n  active: bool{optional}\n{unique}  cap 50\n  public\nquery q(c: cursor ?):\n  return members first 20 after c {{ n: count(members where .active = .active) }}\n");
            let (document, diagnostics) = parser::parse_document("schema.q", &source);
            let candidate = document.source.repairs.iter().find(|r| r.rewrite == diagnostics[0].rewrite).unwrap();
            let page = key_page(&[document.clone()], candidate);
            assert_eq!(page.as_ref().map(|page| page.rewrite.strip_prefix(&candidate.rewrite).unwrap()), suffix);
        }
    }

}
