//! Source-preserving repairs for the cold Clique builders' first attempts.
use super::catalog::{Catalog, TableInfo};
use crate::{ast::*, diag::{Diagnostic, Site}};

// @ref LLP 3000.007#23 — remove an explicit parent traversal only after proving it repeats the inherited rule.
pub(super) fn inherited_rule(catalog: &Catalog, info: &TableInfo, rule: &RuleDecl) -> Option<Diagnostic> {
    let maintain = info.maintained.as_ref()?;
    let source = catalog.tables.get(&maintain.source)?;
    let through = source.through.as_ref()?;
    if !maintain.by.contains(&through.reference) { return None; }
    let parent = catalog.tables.get(&through.parent)?;
    let parent_rule = parent.decl.rules.iter().find(|r| r.effect == Effect::Read)?;
    let mut lifted = rule.clone();
    let mut own_field = false;
    let mut roots = 0;
    super::intent_walk::expression(&mut lifted.value, &mut |expr| {
        if let Expr::Member { base, name, .. } = expr
            && matches!(base.as_ref(), Expr::Focal { .. }) {
                roots += 1;
                own_field |= *name != through.reference;
            }
    });
    if own_field { return None; }
    let mut traversed = 0;
    super::intent_walk::expression(&mut lifted.value, &mut |expr| {
        if let Expr::Member { base, .. } = expr
            && let Expr::Member { base: focal, name, site } = base.as_ref()
            && matches!(focal.as_ref(), Expr::Focal { .. }) && *name == through.reference {
                *base = Box::new(Expr::Focal { site: site.clone() });
                traversed += 1;
            }
    });
    // Every focal access must be the base of a parent hop. A standalone
    // .message is the group reference, not a same-named parent column.
    if traversed == 0 || traversed != roots || super::schema::bind_rule(catalog, parent, &lifted).ok()?
        != super::schema::bind_rule(catalog, parent, parent_rule).ok()? { return None; }
    let mut diagnostic = Diagnostic::new(&rule.site, "E_REDUNDANT_RULE",
        format!("aggregate read rule repeats its parent's rule through .{}; omit the entire read line to inherit {} authorization", through.reference, through.parent),
        format!("-- {} inherits read through {}.{}", maintain.name, maintain.source, through.reference)).guide("maintains");
    diagnostic.mechanical = !catalog.source.expression(&rule.value).contains('\n');
    Some(diagnostic)
}

// @ref LLP 3000.007#23 — a held alternative preserves the predicate, result shape and duplicate-name behavior.
pub(super) fn held_query(catalog: &Catalog, site: &Site) -> Option<String> {
    let declaration = catalog.source.declarations.get(&site.to_string())?;
    let (header, body) = declaration.split_once('\n')?;
    let header = header.strip_suffix(':')?;
    if !header.starts_with("query ") || header.ends_with(" held") { return None; }
    Some(format!("{header} held:\n{body}"))
}
