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
    let mut diagnostic = Diagnostic::new(&rule.site, "E_QUARRY_UNKNOWN",
        format!("aggregate read rule repeats its parent's rule through .{}; omit the entire read line to inherit {} authorization", through.reference, through.parent),
        format!("-- {} inherits read through {}.{}", maintain.name, maintain.source, through.reference)).guide("maintains");
    diagnostic.mechanical = !catalog.source.expression(&rule.value).contains('\n');
    Some(diagnostic)
}

// A branch is advice, not an automatic repair: it adds a row-read requirement.
// Restrict repeated expressions to stable values, never duplicate a call or write.
pub(super) fn upsert(catalog: &Catalog, site: &Site) -> Option<String> {
    let original = catalog.source.syntax_at(site)?;
    let Expr::Write { op: WriteOp::Upsert, table, keys, fields, condition: None, if_absent: false, site } = original else { return None; };
    fn stable(expr: &Expr) -> bool {
        match expr {
            Expr::Name { name, .. } => name != "new",
            Expr::Literal { .. } => true,
            Expr::Member { base, .. } => stable(base),
            _ => false,
        }
    }
    if !keys.iter().all(|key| stable(&key.value)) { return None; }
    let info = catalog.tables.get(table)?;
    let columns = if keys.iter().all(|key| key.column.is_some()) {
        keys.iter().map(|key| key.column.clone().unwrap()).collect::<Vec<_>>()
    } else {
        let indexes = info.indexes.iter().filter(|index| index.unique && index.columns.len() == keys.len()).collect::<Vec<_>>();
        let [index] = indexes.as_slice() else { return None; };
        index.columns.clone()
    };
    // A patch that changes a key is not equivalent to a separate insert image.
    for field in fields {
        if field.spread { return None; }
        if let Some(i) = columns.iter().position(|name| *name == field.name) {
            let value = field.value.as_ref().map_or_else(|| field.name.clone(), |expr| catalog.source.expression(expr));
            if value != catalog.source.expression(&keys[i].value) { return None; }
        }
    }
    // Upsert may patch an existing row without supplying its insert image.
    // A direct insert would not compile in that case; do not print that repair.
    if info.decl.columns.iter().any(|column| !column.type_.optional && column.default.is_none()
        && column.sequence.is_none() && column.maintained.is_none()
        && !columns.contains(&column.name) && !fields.iter().any(|field| field.name == column.name)) { return None; }
    let key = keys.iter().zip(&columns).map(|(key, column)| format!("{column} = {}", catalog.source.expression(&key.value))).collect::<Vec<_>>().join(", ");
    let mut insert_fields = fields.clone();
    for (key, column) in keys.iter().zip(&columns) {
        if !insert_fields.iter().any(|field| field.name == *column) {
            insert_fields.push(ObjectField { name: column.clone(), spread: false, value: Some(key.value.clone()), site: site.clone() });
        }
    }
    let update = Expr::Write { op: WriteOp::Update, table: table.clone(), keys: keys.clone(), fields: fields.clone(), condition: None, if_absent: false, site: site.clone() };
    let insert = Expr::Write { op: WriteOp::Insert, table: table.clone(), keys: vec![], fields: insert_fields, condition: None, if_absent: false, site: site.clone() };
    Some(format!("({}) if exists {table}[{key}] else ({})", catalog.source.expression(&update), catalog.source.expression(&insert)))
}

// @ref LLP 3000.007#23 — a held alternative preserves the predicate, result shape and duplicate-name behavior.
pub(super) fn held_query(catalog: &Catalog, site: &Site) -> Option<String> {
    let declaration = catalog.source.declarations.get(&site.to_string())?;
    let (header, body) = declaration.split_once('\n')?;
    let header = header.strip_suffix(':')?;
    if !header.starts_with("query ") || header.ends_with(" held") { return None; }
    Some(format!("{header} held:\n{body}"))
}
