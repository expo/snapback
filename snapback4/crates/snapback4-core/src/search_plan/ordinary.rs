//! A server-only alternative for one bare word page. Neither the serialized
//! program nor the device evaluator acquires a current-membership predicate.
use crate::{ir::*, schema::{Audience, IndexComponent, RuleExpr, RuleTerm, Schema}};

pub struct Plan {
    pub program: Program,
    pub audience: String,
    pub cursor_indexes: (String, String),
}

// @ref LLP 3000.028#3.3 — infer only the exact invertible membership class;
// lift proved point projections; retain explicit guards, other joins and native evaluators.
pub fn plan(schema: &Schema, program: &Program) -> Option<Plan> {
    if let Ok(parts) = crate::search_decoration::admit(schema, program) {
        return plan(schema, &parts.bare(program));
    }
    if program.kind != ProgramKind::Query || program.native || !program.returned_shapes.is_empty()
        || schema.operations.get(&program.name).is_some_and(|f| f.held) { return None; }
    let [Stmt::Return(value)] = program.body.as_slice() else { return None };
    let scan = page(value)?;
    if scan.existence || scan.before.is_some() || scan.range.is_some() || scan.merge_site.is_some()
        || scan.filter.as_deref().is_some_and(|v| !scalar(v)) { return None; }
    if !matches!(scan.prefix.last(), Some(IndexKeyExpr::WordPrefix(Expr::Variable(_) | Expr::Literal(_))))
        || !scan.prefix[..scan.prefix.len()-1].iter().all(|p| matches!(p, IndexKeyExpr::Scalar(Expr::Literal(_) | Expr::Variable(_) | Expr::Input(Input::Viewer)))) { return None; }
    let table = schema.table(&scan.table)?;
    if table.through.is_some() || schema.maintain_for(&scan.table).is_some() { return None; }
    // No service disjunction stripping: inferring viewer memberships would
    // narrow a service's independently granted domain.
    let RuleExpr::Exists { table: members, index: membership, key, equalities, .. } = &table.rules.read else { return None };
    let [RuleTerm::Field(scope), RuleTerm::Viewer] = key.as_slice() else { return None };
    if !equalities.is_empty() { return None; }
    let Audience::Target { table: audience, prefix, principal } = &table.sync.as_ref()?.audience else { return None };
    if audience != members || prefix != &[scope.clone()] { return None; }
    let member = schema.table(members)?;
    if member.is_expiring() || member.through.is_some() || schema.maintain_for(members).is_some() { return None; }
    let member_key = member.index(membership)?;
    if !member_key.unique || !member_key.is_plain()
        || !member_key.components.iter().all(|part| part.key_type(member).is_some_and(|kind| !kind.is_optional())) { return None; }
    let member_columns = member_key.columns();
    let [member_scope, member_principal] = member_columns.as_slice() else { return None };
    if member_principal != principal { return None; }
    let (source_index, _) = member.indexes.iter().find(|(_, i)| i.is_plain()
        && i.columns().starts_with(&[principal.clone(), member_scope.clone()]))?;
    let original = table.index(&scan.index)?;
    // Already pinned chat reads keep their ordinary horizon/Left proof.
    if original.components.iter().take(scan.prefix.len()).any(|c| c.column() == Some(scope)) { return None; }
    let mut components = vec![IndexComponent::Column(scope.clone())];
    components.extend(original.components.iter().cloned());
    let (index, _) = table.indexes.iter().find(|(_, i)| i.components == components)?;
    let binding = "$ordinaryAudience".to_owned();
    let distinct = Expr::Field { base: Box::new(Expr::Variable(binding.clone())), name: member_scope.clone() };
    let mut scoped = scan.clone();
    scoped.index = index.clone();
    scoped.prefix.insert(0, IndexKeyExpr::Scalar(distinct.clone()));
    scoped.merge_site = Some(scan.site.clone());
    let source = Scan { site: format!("{}.audience", scan.site), table: members.clone(), index: source_index.clone(),
        prefix: vec![IndexKeyExpr::Scalar(Expr::Input(Input::Viewer))], order: Order::Asc, take: Bound::Meter,
        existence: false, after: None, before: None, range: None, filter: None, opaque_cursor: false,
        merge_site: None, cursor_pins: 0, provenance: scan.provenance, variant: None };
    // A uniform but denied membership table is not a discovery proof. Rule
    // existence may grant message access even when program reads of that
    // witness are forbidden; inference must never narrow that original domain.
    if !crate::engine::rules::scan_visibility(schema, &source).decided_true { return None; }
    let merge = Merge { position: None, view: None, order_keys: Vec::new(), site: scan.site.clone(), variant: scan.variant,
        lanes: vec![MergeLane { guard: None, distinct: Some(distinct), branch: None, project: None, setup: Vec::new(),
            scan: scoped, source: Some(LaneSource::Scan(source)), binding }] };
    if !super::eligible(schema, &merge) { return None; }
    let mut lowered = program.clone();
    let Stmt::Return(value) = &mut lowered.body[0] else { unreachable!() };
    match value {
        Expr::Scan(_) => *value = Expr::Merge(merge),
        Expr::Block { body, .. } => {
            let Stmt::If { then_body, .. } = &mut body[2] else { unreachable!() };
            let Stmt::Assign { value, .. } = &mut then_body[0] else { unreachable!() };
            *value = Expr::Merge(merge);
        }
        _ => unreachable!(),
    }
    Some(Plan { program: lowered, audience: format!("{members}[{principal} = viewer] by .{member_scope}"),
        cursor_indexes: (index.clone(), scan.index.clone()) })
}

use crate::search_decoration::{page, scalar};

/// Narrow SDK merge descriptor for the builder's time/id ordered page.
fn composition_shape(schema: &Schema, program: &Program) -> Option<crate::schema::SearchComposition> {
    plan(schema, program)?;
    let [Stmt::Return(value)] = program.body.as_slice() else { return None };
    let scan = page(value)?;
    let IndexKeyExpr::WordPrefix(Expr::Variable(needle)) = scan.prefix.last()? else { return None };
    let needle = if let Expr::Block { body, .. } = value {
        let Stmt::Let { value: Expr::Variable(input), .. } = &body[0] else { return None };
        input
    } else { needle };
    let Expr::Variable(cursor) = scan.after.as_deref()? else { return None };
    let Bound::Literal(limit) = scan.take else { return None };
    let table = schema.table(&scan.table)?;
    if table.leave != crate::schema::LeavePolicy::DeliveredHistory { return None; }
    let index = table.index(&scan.index)?;
    let column = match &index.components[scan.prefix.len()..] {
        [IndexComponent::Column(column)] => column,
        [IndexComponent::Column(column), IndexComponent::Column(id)] if id == "id" => column,
        _ => return None,
    };
    let kind = table.columns.get(column)?;
    if !matches!(kind, crate::schema::ColumnType::Time | crate::schema::ColumnType::Int | crate::schema::ColumnType::IntRange { .. }) { return None; }
    Some(crate::schema::SearchComposition { table: scan.table.clone(), index: scan.index.clone(),
        column: column.clone(), kind: kind.clone(), order: scan.order, limit: limit as u64,
        needle: needle.clone(), cursor: cursor.clone(), variant: scan.variant })
}

// @ref LLP 3000.028#3.3 — per-page authorized point overlap covers both
// mutable scope updates and deletion/reinsertion of an immutable scope's ID.
pub fn composition(schema: &Schema, program: &Program) -> Option<crate::schema::SearchComposition> {
    if let Ok(parts) = crate::search_decoration::admit(schema, program) {
        return composition_shape(schema, &parts.bare(program));
    }
    composition_shape(schema, program)
}
