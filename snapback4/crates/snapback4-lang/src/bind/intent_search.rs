//! Capture bare searches, then admit optional indexes against their bound plans.
//! The authored device program never acquires a membership predicate.
use super::catalog::Catalog;
use crate::ast::*;

// @ref LLP 3000.028#3.3 — only a single bare ordinary search is inferred.
pub(super) fn capture(catalog: &mut Catalog) {
    for doc in &catalog.documents {
        for program in &doc.programs {
            if program.kind != ProgramKind::Query || program.held || !program.prelude.is_empty() { continue; }
            let [Stmt::Return { value, .. }] = program.body.as_slice() else { continue };
            let value = match value { Expr::Shape { base, .. } | Expr::ShapeUse { base, .. } => base.as_ref(), value => value };
            let Expr::Read(read) = value else { continue };
            if read.matching.is_none() || read.index.is_some() || !read.keys.is_empty()
                || read.range.is_none() || read.order_keys.is_empty()
                || read.filter.as_deref().is_some_and(|value| !scalar(value)) { continue; }
            let Some(table) = catalog.tables.get(&read.table) else { continue };
            if table.maintained.is_some() || table.decl.sync.is_none() { continue; }
            let Some(rule) = table.decl.rules.iter().find(|r| r.effect == Effect::Read) else { continue };
            let Expr::Exists { read: probe, .. } = &rule.value else { continue };
            let Some(members) = catalog.tables.get(&probe.table) else { continue };
            if members.decl.expire.is_some() || members.maintained.is_some() { continue; }
            let module = std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy();
            catalog.ordinary_searches.push(super::operation_name(&module, &program.name));
        }
    }
}

// @ref LLP 3000.028#3.3 — optional indexes must neither reject a baseline
// program nor change its IR. Admit only after the bound audience and portable
// key/label checks succeed; a declined candidate leaves no schema cost.
pub(super) fn provision(catalog: &mut Catalog, schema: &mut snapback4_core::schema::Schema, programs: &[super::BoundProgram]) {
    use snapback4_core::{ir, schema::{IndexComponent, RuleExpr, RuleTerm}, search_plan::ordinary};
    for bound in programs {
        if !catalog.ordinary_searches.contains(&bound.program.name) { continue; }
        let Some(scan) = ir::scans(&bound.program).into_iter().find(|scan|
            matches!(scan.prefix.last(), Some(ir::IndexKeyExpr::WordPrefix(_)))) else { continue };
        let table = &schema.tables[&scan.table];
        let RuleExpr::Exists { key, .. } = &table.rules.read else { continue };
        let [RuleTerm::Field(scope), RuleTerm::Viewer] = key.as_slice() else { continue };
        let mut index = table.indexes[&scan.index].clone();
        // Prefix exactly the bound ordinary index. Its equality pins, word
        // position and full cursor ordering suffix must survive unchanged.
        index.components.insert(0, IndexComponent::Column(scope.clone()));
        if table.indexes.values().any(|old| old.components == index.components) { continue; }
        let info = &catalog.tables[&scan.table];
        let Some(mut declaration) = info.indexes.iter().find(|i| i.name == scan.index).cloned() else { continue };
        declaration.columns.insert(0, scope.clone());
        let Some((position, _)) = &mut declaration.words else { continue };
        *position += 1;
        declaration.site = bound.site.clone();
        declaration.name = super::intent::index_name(info, &declaration);
        let mut candidate = schema.clone();
        candidate.tables.get_mut(&scan.table).unwrap().indexes.insert(declaration.name.clone(), index.clone());
        if ordinary::plan(&candidate, &bound.program).is_none() { continue; }
        let mut errors = Vec::new();
        super::key_bound::check(catalog, &candidate, &mut errors);
        if !errors.is_empty() || !snapback4_core::schema::validate(&candidate).is_empty() { continue; }
        schema.tables.get_mut(&scan.table).unwrap().indexes.insert(declaration.name.clone(), index);
        catalog.synthesized.insert((scan.table.clone(), declaration.name.clone()));
        catalog.tables.get_mut(&scan.table).unwrap().indexes.push(declaration);
    }
}

fn scalar(value: &Expr) -> bool {
    match value {
        Expr::Literal { .. } | Expr::Name { .. } => true,
        Expr::Member { base, .. } => matches!(base.as_ref(), Expr::Focal { .. }),
        Expr::Unary { value, .. } => scalar(value),
        Expr::Binary { left, right, .. } => scalar(left) && scalar(right),
        _ => false,
    }
}
