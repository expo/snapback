//! Verify executable parser repairs in the affected declaration's context.
//! Never recursively compile diagnostics, or print syntax to create source edits.
use crate::{ast::*, bind, parser, Bound, Diagnostic, Site};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub site: Site,
    pub declaration_site: Site,
    pub source: String,
    pub replacement: Range<usize>,
    pub rewrite: String,
    pub intended: Option<ReadExpr>,
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
        if candidate.is_none_or(|candidate| !accepted(documents, candidate)) { diagnostic.rewrite.clear(); }
    }
}

fn accepted(documents: &[Document], candidate: &Candidate) -> bool {
    let Some(patched) = parser::repairs::splice(&candidate.source,
        vec![(candidate.replacement.clone(), candidate.rewrite.clone())]) else { return false; };
    // Retain original source sites without reparsing any other declaration.
    let source = format!("{}{patched}", "\n".repeat(candidate.declaration_site.line.saturating_sub(1) as usize));
    let tables = documents.iter().flat_map(|doc| doc.tables.iter().cloned()).collect();
    let (replacement, diagnostics) = parser::parse_with_types(&candidate.site.file, &source, tables, Default::default());
    if !diagnostics.is_empty() { return false; }
    // A standalone shape has no focal type until instantiated. A helper
    // signature edit would require checking callers outside this declaration.
    // Neither has a complete local proof: keep the refusal without a repair.
    if !replacement.shapes.is_empty() { return false; }
    for function in &replacement.functions {
        if documents.iter().flat_map(|doc| &doc.functions).any(|old|
            affected(candidate, &old.site) && old.args.len() != function.args.len()) { return false; }
    }
    let mut context = context(documents, candidate, replacement);
    // Helpers are normally checked at their call sites. Check this helper with
    // its own typed arguments; do not bind unrelated operations to exercise it.
    for doc in &mut context {
        if let Some(function) = doc.functions.iter().find(|decl| affected(candidate, &decl.site)) {
            let args = function.args.iter().map(|arg| format!("{}: {}", arg.name, crate::print::scalar_type(&arg.type_))).collect::<Vec<_>>().join(", ");
            let values = function.args.iter().map(|arg| arg.name.as_str()).collect::<Vec<_>>().join(", ");
            let probe = format!("query repairProbe({args}):\n  return {}({values})\n", function.name);
            let (mut parsed, errors) = parser::parse_document(&doc.file, &probe);
            if !errors.is_empty() { return false; }
            doc.programs.append(&mut parsed.programs);
        }
    }
    let actual = bind(context.clone());
    if !actual.diagnostics.is_empty() { return false; }
    let Some(intended) = &candidate.intended else { return true; };
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
    if replaced != 1 { return false; }
    let expected = bind(context);
    let class = |bound: &Bound| bound.programs.iter().flat_map(|program| {
        let scans = snapback4_core::ir::scans(&program.program);
        program.sources.iter().filter(|(key, (site, _))| *site == intended.site && program.selections.contains_key(*key))
            .map(|(key, _)| scans.iter().any(|scan| &scan.site == key)).collect::<Vec<_>>()
    }).collect::<std::collections::BTreeSet<_>>();
    let actual_class = class(&actual);
    expected.diagnostics.is_empty() && !actual_class.is_empty() && actual_class == class(&expected)
}

fn affected(candidate: &Candidate, site: &Site) -> bool {
    let last = candidate.declaration_site.line + candidate.source.lines().count() as u32;
    site.file == candidate.site.file && (candidate.declaration_site.line..last).contains(&site.line)
}

fn context(documents: &[Document], candidate: &Candidate, replacement: Document) -> Vec<Document> {
    let mut context = documents.to_vec();
    for doc in &mut context {
        // Retain declaration dependencies, but never bind another operation.
        doc.programs.clear(); doc.actions.clear(); doc.routes.clear(); doc.schedules.clear();
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
}
