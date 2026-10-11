//! The complete form of an owner-or-X page, built from every disjunct of the
//! read rule: one `if` arm per readable grant (the page as written), one per
//! disjunct the page's pins decide (a parent probe such as `exists
//! sittings[sitting, keeper = viewer]`), then the page pinned to the remaining
//! party, or one query per party when several remain. The printed queries are
//! checked mechanically before they print: over every truth assignment of the
//! rule's disjuncts and the page's other conjuncts, the union of the printed
//! queries admits a row exactly when the original page does. A form that would
//! widen or narrow any reader is never printed; the note says so instead.
// @ref LLP 3000.036#16.1 — wave 6 R1: a printed rewrite that drops a party is worse than none.

use crate::ast::{Expr as A, Stmt as S};
use snapback4_core::ir::{Expr, Input, Program, Scan};
use snapback4_core::schema::{RuleExpr, RuleTerm, Schema, Table};
use std::collections::BTreeMap;

/// What `check` can print for a page's complete form.
pub(super) enum Outcome {
    /// Code that returns exactly the rule's rows, with its lead line (ending
    /// `:`) and a short phrase for the one-line message.
    Form(Form),
    /// The rule has more than one kind of reader but no printed form keeps
    /// them all: the reason, for the note.
    None(String),
    /// A single party (or nothing to branch on): the plain pin advice.
    NotApplicable,
}

pub(super) struct Form {
    pub lead: String,
    pub code: String,
    pub phrase: String,
    /// Arms on a pinned parent probe: they return their holders' rows, but
    /// the server decides a page complete only from a disjunct that reads no
    /// row column, so these pages stay `complete: false`.
    pub incomplete: Vec<String>,
}

enum Kind { Grant, Decided(String), Party(String) }

/// The complete form for `scan`'s page under `table`'s read rule, from the
/// query's declaration text.
pub(super) fn complete_form(schema: &Schema, program: &Program, scan: &Scan, table: &Table, declaration: Option<&str>) -> Outcome {
    let disjuncts = table.rules.read.disjuncts();
    if disjuncts.len() < 2 { return Outcome::NotApplicable; }
    let Some(index) = table.index(&scan.index) else { return Outcome::NotApplicable };
    // Each pinned column's value as source text: an argument, a literal or `viewer`.
    let mut values: BTreeMap<String, Option<String>> = BTreeMap::new();
    for (component, key) in index.components.iter().zip(&scan.prefix) {
        let (Some(column), Some(value)) = (component.column(), key.scalar()) else { continue };
        let text = match value {
            Expr::Variable(name) if !name.starts_with('$') && program.args.iter().any(|(arg, _)| arg == name) => Some(name.clone()),
            Expr::Literal(value) => Some(literal(value)),
            Expr::Input(Input::Viewer) => Some("viewer".into()),
            _ => None,
        };
        values.insert(column.clone(), text);
    }
    let readable_grants: Vec<RuleExpr> = snapback4_core::engine::rules::grant_decision(schema, scan)
        .map(|grant| grant.disjuncts().into_iter().cloned().collect()).unwrap_or_default();
    let mut kinds = Vec::new();
    for disjunct in &disjuncts {
        let mut fields = std::collections::BTreeSet::new();
        disjunct.fields(&mut fields);
        let kind = if fields.is_empty() {
            if !readable_grants.contains(disjunct) {
                return Outcome::None(format!("the grant `{}` reads a row its holders cannot read, so a branch on it would not admit them", disjunct.quarry()));
            }
            Kind::Grant
        } else if fields.iter().all(|field| values.contains_key(field)) {
            let rendered = (snapback4_core::engine::rules::pinned_probe_readable(schema, disjunct)).then(|| render(schema, disjunct, &values)).flatten();
            match rendered {
                Some(text) => Kind::Decided(text),
                None => return Outcome::None(format!("`{}` is decided by the page's pins, but no branch the query can write tests it the same way for every caller", disjunct.quarry())),
            }
        } else {
            match disjunct {
                RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Kind::Party(column.clone()),
                other => return Outcome::None(format!("`{}` reads a column the page does not pin and is not a `.column = viewer` party, so no pin selects its rows", other.quarry())),
            }
        };
        kinds.push(kind);
    }
    let grants: Vec<String> = disjuncts.iter().zip(&kinds).filter(|(_, k)| matches!(k, Kind::Grant)).map(|(d, _)| d.quarry()).collect();
    let decided: Vec<String> = kinds.iter().filter_map(|k| if let Kind::Decided(text) = k { Some(text.clone()) } else { None }).collect();
    let parties: Vec<String> = kinds.iter().filter_map(|k| if let Kind::Party(column) = k { Some(column.clone()) } else { None }).collect();
    let arms = !grants.is_empty() as usize + decided.len();
    if parties.is_empty() || arms == 0 && parties.len() < 2 { return Outcome::NotApplicable; }
    let Some((header, decl, value)) = declaration.and_then(|text| super::pin_rewrite::single_page(text, &scan.table)) else { return Outcome::NotApplicable };
    let print = |value: &A| crate::print::with_source(value, &|_| None);
    let mut prelude = String::new();
    if !grants.is_empty() { prelude.push_str(&format!("  if {}:\n    return {}\n", grants.join(" or "), print(&value))); }
    for test in &decided { prelude.push_str(&format!("  if {test}:\n    return {}\n", print(&value))); }
    let mut queries = Vec::new();
    for party in &parties {
        let Some(pinned) = super::pin_rewrite::pinned_to(&value, &parties, party) else { return Outcome::NotApplicable };
        let header = if parties.len() == 1 { header.clone() } else {
            let Some(at) = header.find(&format!(" {}(", decl.name)).map(|at| at + 1) else { return Outcome::NotApplicable };
            format!("{}{}As{}{}", &header[..at], decl.name, capitalized(party), &header[at + decl.name.len()..])
        };
        queries.push(format!("{header}\n{prelude}  return {}", print(&pinned)));
    }
    let code = queries.join("\n");
    // The mechanical check: never print a form that widens or narrows a reader.
    let atoms: Vec<Atom> = kinds.iter().zip(&disjuncts).map(|(kind, d)| match kind {
        Kind::Grant => Atom::Guard(normalize_condition(&d.quarry())),
        Kind::Decided(text) => Atom::Guard(normalize_condition(text)),
        Kind::Party(column) => Atom::Party(column.clone()),
    }).collect();
    if let Err(reason) = same_readers(&code, &value, &atoms) {
        return Outcome::None(format!("the branched form would {reason}"));
    }
    let incomplete = decided.clone();
    let what = match (grants.len(), decided.len()) {
        (0, _) => "the pinned parent probe".to_owned(),
        (1, 0) => "the grant".to_owned(),
        (_, 0) => "the grants".to_owned(),
        _ => "the grant and the pinned parent probe".to_owned(),
    };
    let completeness = if incomplete.is_empty() { "every page is complete".to_owned() } else {
        format!("the {} arm returns its holders' rows but stays `complete: false` (the server decides a page only from a disjunct that reads no row column), every other page is complete", incomplete.iter().map(|t| format!("`{t}`")).collect::<Vec<_>>().join(" and "))
    };
    let (lead, phrase) = if parties.len() == 1 {
        (format!("Branch on {what} and pin `.{}` for everyone else; together they return exactly the rows the read rule admits, and {completeness}:", parties[0]),
            format!("`if` on {what}, pinning `.{}` otherwise", parties[0]))
    } else if arms == 0 {
        ("Replace this query with one per party, each pinned and complete, and show both lists or merge them by their order in the client:".to_owned(), "one query per party".to_owned())
    } else {
        (format!("Replace this query with one per party, each branching on {what} first, and show both lists or merge them by their order in the client; together they return exactly the rows the read rule admits, and {completeness}:"),
            format!("one query per party, each branching on {what} first"))
    };
    Outcome::Form(Form { lead, code, phrase, incomplete })
}

fn capitalized(text: &str) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    if let Some(first) = chars.first_mut() { *first = first.to_ascii_uppercase(); }
    chars.into_iter().collect()
}

fn literal(value: &snapback4_core::Value) -> String {
    RuleExpr::Eq(RuleTerm::Literal(value.clone()), RuleTerm::Viewer).quarry().trim_end_matches(" = viewer").to_owned()
}

/// A pin-decided disjunct as a program condition: its row columns replaced
/// by the page's pinned values, probe keys spelled by name unless the probe
/// reads its target's `id`.
fn render(schema: &Schema, rule: &RuleExpr, values: &BTreeMap<String, Option<String>>) -> Option<String> {
    let term = |term: &RuleTerm| -> Option<String> {
        match term {
            RuleTerm::Field(field) => values.get(field).cloned().flatten(),
            RuleTerm::Viewer => Some("viewer".into()),
            RuleTerm::Literal(value) => Some(literal(value)),
            _ => None,
        }
    };
    match rule {
        RuleExpr::Eq(a, b) => Some(format!("{} = {}", term(a)?, term(b)?)),
        RuleExpr::Ne(a, b) => Some(format!("{} != {}", term(a)?, term(b)?)),
        RuleExpr::And(items) => items.iter().map(|item| render(schema, item, values)).collect::<Option<Vec<_>>>().map(|parts| parts.join(" and ")),
        RuleExpr::Exists { table, index, key, equalities, .. } => {
            let target = schema.table(table)?;
            let columns = target.index(index)?.columns();
            let mut parts = Vec::new();
            if columns.len() == 1 && columns[0] == "id" && key.len() == 1 {
                parts.push(term(&key[0])?);
            } else {
                for (column, value) in columns.iter().zip(key) { parts.push(format!("{column} = {}", term(value)?)); }
            }
            for (column, value) in equalities { parts.push(format!("{column} = {}", term(value)?)); }
            Some(format!("exists {table}[{}]", parts.join(", ")))
        }
        _ => None,
    }
}

enum Atom { Guard(Option<String>), Party(String) }

/// `text` as the parser reads it back and the printer spells it: the form a
/// branch condition is compared in.
fn normalize_condition(text: &str) -> Option<String> {
    let (document, errors) = crate::parser::parse_document("guard.q", &format!("query g():\n  if {text}:\n    return []\n  return []\n"));
    if !errors.is_empty() { return None; }
    match document.programs.first()?.body.first()? { S::If { condition, .. } => Some(crate::print::expression(condition)), _ => None }
}

fn conjuncts(expr: &A, out: &mut Vec<A>) {
    match expr { A::Binary { op, left, right, .. } if op == "and" => { conjuncts(left, out); conjuncts(right, out); }, other => out.push(other.clone()) }
}
fn alternatives(expr: &A, out: &mut Vec<A>) {
    match expr { A::Binary { op, left, right, .. } if op == "or" => { alternatives(left, out); alternatives(right, out); }, other => out.push(other.clone()) }
}

/// The read of a (maybe shaped) page, and the page with its filter removed,
/// printed: two returns read the same rows in the same order exactly when the
/// latter agree and their filters admit the same rows.
fn split_page(value: &A) -> Option<(Option<A>, String)> {
    let mut value = value.clone();
    let read = match &mut value {
        A::Read(read) => read,
        A::Shape { base, .. } | A::ShapeUse { base, .. } => match base.as_mut() { A::Read(read) => read, _ => return None },
        _ => return None,
    };
    let filter = read.filter.take().map(|filter| *filter);
    Some((filter, crate::print::with_source(&value, &|_| None)))
}

/// A filter conjunct, evaluated over the truth assignment: a party pin, a
/// disjunction of party pins, or another conjunct (its own variable).
enum Term { Parties(Vec<usize>), Opaque(usize) }

fn party_pin(expr: &A, atoms: &[Atom]) -> Option<usize> {
    let A::Binary { op, left, right, .. } = expr else { return None };
    if op != "=" { return None; }
    let (A::Member { base, name, .. }, A::Name { name: viewer, .. }) = (left.as_ref(), right.as_ref()) else { return None };
    if !matches!(base.as_ref(), A::Focal { .. }) || viewer != "viewer" { return None; }
    atoms.iter().position(|atom| matches!(atom, Atom::Party(column) if column == name))
}

fn terms(filter: Option<&A>, atoms: &[Atom], opaque: &mut Vec<String>, grow: bool) -> Option<Vec<Term>> {
    let mut parts = Vec::new();
    if let Some(filter) = filter { conjuncts(filter, &mut parts); }
    let mut out = Vec::new();
    for part in parts {
        let mut options = Vec::new();
        alternatives(&part, &mut options);
        let pins: Option<Vec<usize>> = options.iter().map(|option| party_pin(option, atoms)).collect();
        if let Some(pins) = pins { out.push(Term::Parties(pins)); continue; }
        let text = crate::print::expression(&part);
        let at = match opaque.iter().position(|seen| *seen == text) {
            Some(at) => at,
            None if grow => { opaque.push(text); opaque.len() - 1 },
            None => return None,
        };
        out.push(Term::Opaque(at));
    }
    Some(out)
}

/// Whether the printed queries (`code`) return, between them, exactly the
/// rows the original page (`original`) returns under the read rule whose
/// disjuncts are `atoms`. Checked over every assignment of the disjuncts and
/// the page's other conjuncts (at most 2^14): assignments the data cannot
/// produce only make the check stricter.
fn same_readers(code: &str, original: &A, atoms: &[Atom]) -> Result<(), String> {
    let (document, errors) = crate::parser::parse_document("form.q", code);
    if !errors.is_empty() || document.programs.is_empty() { return Err("not parse".into()); }
    let (filter, shape) = split_page(original).ok_or("not read a page")?;
    let mut opaque = Vec::new();
    let original_terms = terms(filter.as_ref(), atoms, &mut opaque, true).ok_or("not read the page")?;
    // Each query: its arms (alternatives as atom indexes, the arm's terms), then its final terms.
    type Arm = (Vec<usize>, Vec<Term>);
    let mut queries: Vec<(Vec<Arm>, Vec<Term>)> = Vec::new();
    for program in &document.programs {
        if !program.prelude.is_empty() { return Err("not be a branch of returns".into()); }
        let mut arms = Vec::new();
        let mut last = None;
        for (i, statement) in program.body.iter().enumerate() {
            match statement {
                S::If { condition, then_body, else_body, .. } if else_body.is_empty() && i + 1 < program.body.len() => {
                    let [S::Return { value, .. }] = then_body.as_slice() else { return Err("not be a branch of returns".into()) };
                    let mut options = Vec::new();
                    alternatives(condition, &mut options);
                    let indexes = options.iter().map(|option| {
                        let text = crate::print::expression(option);
                        atoms.iter().position(|atom| matches!(atom, Atom::Guard(Some(guard)) if *guard == text))
                    }).collect::<Option<Vec<_>>>().ok_or("branch on a test that is no disjunct of the read rule")?;
                    let (filter, arm_shape) = split_page(value).ok_or("not return a page")?;
                    if arm_shape != shape { return Err("change the page's order, bound or shape".into()); }
                    arms.push((indexes, terms(filter.as_ref(), atoms, &mut opaque, false).ok_or("filter the page by a test it did not have")?));
                }
                S::Return { value, .. } if i + 1 == program.body.len() => {
                    let (filter, final_shape) = split_page(value).ok_or("not return a page")?;
                    if final_shape != shape { return Err("change the page's order, bound or shape".into()); }
                    last = Some(terms(filter.as_ref(), atoms, &mut opaque, false).ok_or("filter the page by a test it did not have")?);
                }
                _ => return Err("not be a branch of returns".into()),
            }
        }
        queries.push((arms, last.ok_or("not return a page")?));
    }
    let variables = atoms.len() + opaque.len();
    if variables > 14 { return Err("need more cases than the check enumerates".into()); }
    let holds = |terms: &[Term], mask: u32| terms.iter().all(|term| match term {
        Term::Parties(pins) => pins.iter().any(|&i| mask & (1 << i) != 0),
        Term::Opaque(at) => mask & (1 << (atoms.len() + at)) != 0,
    });
    for mask in 0..(1u32 << variables) {
        let rule = (0..atoms.len()).any(|i| mask & (1 << i) != 0);
        let before = rule && holds(&original_terms, mask);
        let after = rule && queries.iter().any(|(arms, last)| {
            match arms.iter().find(|(guard, _)| guard.iter().any(|&i| mask & (1 << i) != 0)) {
                Some((_, terms)) => holds(terms, mask),
                None => holds(last, mask),
            }
        });
        if before != after { return Err(if before { "narrow the answer: some reader would lose rows".into() } else { "widen the answer".into() }); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(text: &str) -> A {
        let (document, errors) = crate::parser::parse_document("p.q", &format!("query p(cat: text, c: cursor ?):\n  return {text}\n"));
        assert!(errors.is_empty(), "{errors:?}");
        let [S::Return { value, .. }] = document.programs[0].body.as_slice() else { panic!() };
        value.clone()
    }

    fn atoms() -> Vec<Atom> {
        vec![Atom::Party("reporter".into()), Atom::Guard(normalize_condition("exists cats[cat, owner = viewer]")), Atom::Guard(normalize_condition("exists moderators[viewer]"))]
    }

    #[test]
    fn a_form_that_drops_a_party_narrows_and_one_that_keeps_every_disjunct_passes() {
        let original = page("sightings where .cat = cat last 50 by .seenAt after c");
        let header = "query p(cat: text, c: cursor ?):";
        // 0.4.21's rewrite: the keeper (cat owner) falls to the reporter pin.
        let dropped = format!("{header}\n  if exists moderators[viewer]:\n    return sightings where .cat = cat last 50 by .seenAt after c\n  return sightings where .reporter = viewer and .cat = cat last 50 by .seenAt after c\n");
        assert_eq!(same_readers(&dropped, &original, &atoms()), Err("narrow the answer: some reader would lose rows".into()));
        let kept = format!("{header}\n  if exists moderators[viewer]:\n    return sightings where .cat = cat last 50 by .seenAt after c\n  if exists cats[cat, owner = viewer]:\n    return sightings where .cat = cat last 50 by .seenAt after c\n  return sightings where .reporter = viewer and .cat = cat last 50 by .seenAt after c\n");
        assert_eq!(same_readers(&kept, &original, &atoms()), Ok(()));
        // Dropping the page's own pin widens it; a changed order is refused.
        let wide = format!("{header}\n  if exists moderators[viewer]:\n    return sightings last 50 by .seenAt after c\n  if exists cats[cat, owner = viewer]:\n    return sightings where .cat = cat last 50 by .seenAt after c\n  return sightings where .reporter = viewer and .cat = cat last 50 by .seenAt after c\n");
        assert_eq!(same_readers(&wide, &original, &atoms()), Err("widen the answer".into()));
        let reordered = kept.replace("if exists moderators[viewer]:\n    return sightings where .cat = cat last 50 by .seenAt", "if exists moderators[viewer]:\n    return sightings where .cat = cat first 50 by .seenAt");
        assert!(same_readers(&reordered, &original, &atoms()).is_err());
    }

    #[test]
    fn two_parties_and_a_grant_need_the_grant_in_each_query() {
        let atoms = vec![Atom::Party("owner".into()), Atom::Party("helper".into()), Atom::Guard(normalize_condition("exists staff[viewer]"))];
        let original = page("boards last 50 by .at after c");
        let header = |name: &str| format!("query {name}(cat: text, c: cursor ?):");
        let without = format!("{}\n  return boards where .owner = viewer last 50 by .at after c\n{}\n  return boards where .helper = viewer last 50 by .at after c\n", header("a"), header("b"));
        assert!(same_readers(&without, &original, &atoms).is_err(), "0.4.21's per-party split drops staff");
        let with = format!("{}\n  if exists staff[viewer]:\n    return boards last 50 by .at after c\n  return boards where .owner = viewer last 50 by .at after c\n{}\n  if exists staff[viewer]:\n    return boards last 50 by .at after c\n  return boards where .helper = viewer last 50 by .at after c\n", header("a"), header("b"));
        assert_eq!(same_readers(&with, &original, &atoms), Ok(()));
    }
}
