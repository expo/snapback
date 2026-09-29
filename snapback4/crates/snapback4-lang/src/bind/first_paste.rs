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

// @ref LLP 3000.007#23 — advice must preserve the result, rows and downstream effects.
// Insert returns its supplied image; upsert reads back the stored row. Only
// complete plain images on always-readable, non-expiring targets are proved.
// Extra read work still needs held coverage and the ordinary runtime meter.
pub(super) fn upsert(catalog: &Catalog, site: &Site) -> Result<String, &'static str> {
    let original = catalog.source.syntax_at(site).ok_or("the original source expression is unavailable")?;
    let Expr::Write { op: WriteOp::Upsert, table, keys, fields, condition: None, if_absent: false, site } = original else { return Err("the upsert form has no proven branch equivalent"); };
    fn stable(expr: &Expr, catalog: &Catalog) -> bool {
        match expr {
            Expr::Name { name, .. } => name != "new" && !catalog.tables.contains_key(name) && !catalog.view_reads.contains_key(name),
            Expr::Literal { .. } => true,
            Expr::Member { base, .. } => stable(base, catalog),
            _ => false,
        }
    }
    if !keys.iter().all(|key| stable(&key.value, catalog)) { return Err("keys are not stable values"); }
    let info = catalog.tables.get(table).ok_or("the target schema is unavailable")?;
    // A positional prefix names its own unique key, not the index matching
    // the total arity. Do not guess its insert image from the source syntax.
    if keys.iter().any(|key| key.column.is_some()) && keys.iter().any(|key| key.column.is_none()) { return Err("mixed positional and named keys have no proven insert image"); }
    let columns = if keys.iter().all(|key| key.column.is_some()) {
        keys.iter().map(|key| key.column.clone().unwrap()).collect::<Vec<_>>()
    } else {
        let indexes = info.indexes.iter().filter(|index| info.total_unique(index) && index.columns.len() == keys.len()).collect::<Vec<_>>();
        let [index] = indexes.as_slice() else { return Err("the positional key does not identify one unique index"); };
        index.columns.clone()
    };
    // A patch that changes a key is not equivalent to a separate insert image.
    for field in fields {
        let value = field.value.clone().unwrap_or_else(|| Expr::Name { name: field.name.clone(), site: field.site.clone() });
        if field.spread || !stable(&value, catalog) { return Err("patch values are not stable values"); }
        if info.indexes.iter().any(|index| index.unique && index.columns.contains(&field.name))
            && !columns.contains(&field.name) {
            return Err("the patch can change an unaddressed unique key");
        }
        if let Some(i) = columns.iter().position(|name| *name == field.name) {
            let value = field.value.as_ref().map_or_else(|| field.name.clone(), |expr| catalog.source.expression(expr));
            if value != catalog.source.expression(&keys[i].value) { return Err("the patch can change an addressed key"); }
        }
    }
    if info.decl.expire.is_some() || info.decl.ephemeral.is_some()
        || info.through.as_ref().is_some_and(|through| through.expiring) {
        return Err("an expiring target can read back as null after insertion");
    }
    if info.decl.columns.iter().any(|column| column.type_.optional) {
        return Err("optional result fields can differ between the insert image and upsert read-back");
    }
    if info.decl.columns.iter().any(|column| !matches!(column.type_.kind,
        TypeKind::Text { .. } | TypeKind::Id | TypeKind::Principal | TypeKind::Int
        | TypeKind::Time | TypeKind::Bool | TypeKind::Enum { .. } | TypeKind::Ref { .. })) {
        return Err("the result contains values outside the proven plain scalar image");
    }
    if !info.recorded.is_empty() || info.decl.columns.iter().any(|column|
        column.default.is_some() || column.sequence.is_some() || column.maintained.is_some() || column.written_by.is_some()) {
        return Err("defaulted, engine-owned or private fields have no proven identical insert result");
    }
    if info.decl.columns.iter().any(|column| !columns.contains(&column.name)
        && !fields.iter().any(|field| field.name == column.name)) {
        return Err("the insert result image is incomplete");
    }
    // A hidden existing row may still be writable. An existence test would
    // select insert, so conditional read authority cannot justify this advice.
    // Restrict to a direct, unconditional parent rather than proving rule implication.
    let parent = info.through.as_ref().and_then(|through| catalog.tables.get(&through.parent))
        .ok_or("the target has no proven unconditional read authority")?;
    let public = parent.decl.public.is_some() || parent.decl.rules.iter().any(|rule|
        rule.effect == Effect::Read && matches!(&rule.value, Expr::Name { name, .. } if name == "allow"));
    if !public || parent.through.is_some() {
        return Err("conditional read authority can hide a writable existing row");
    }
    let key = keys.iter().zip(&columns).map(|(key, column)| format!("{column} = {}", catalog.source.expression(&key.value))).collect::<Vec<_>>().join(", ");
    let mut insert_fields = fields.clone();
    for (key, column) in keys.iter().zip(&columns) {
        if !insert_fields.iter().any(|field| field.name == *column) {
            insert_fields.push(ObjectField { name: column.clone(), spread: false, value: Some(key.value.clone()), site: site.clone() });
        }
    }
    let update = Expr::Write { op: WriteOp::Update, table: table.clone(), keys: keys.clone(), fields: fields.clone(), condition: None, if_absent: false, site: site.clone() };
    let insert = Expr::Write { op: WriteOp::Insert, table: table.clone(), keys: vec![], fields: insert_fields, condition: None, if_absent: false, site: site.clone() };
    Ok(format!("({}) if exists {table}[{key}] else ({})", catalog.source.expression(&update), catalog.source.expression(&insert)))
}

// @ref LLP 3000.007#23 — a held alternative preserves the predicate, result shape and duplicate-name behavior.
pub(super) fn held_query(catalog: &Catalog, site: &Site) -> Option<String> {
    let declaration = catalog.source.declarations.get(&site.to_string())?;
    let (header, body) = declaration.split_once('\n')?;
    let header = header.strip_suffix(':')?;
    if !header.starts_with("query ") || header.ends_with(" held") { return None; }
    Some(format!("{header} held:\n{body}"))
}
