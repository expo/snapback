//! Ordering advice and source-table repairs; no runtime or wire changes.
use super::*;
use crate::{ast, print};
use snapback4_core::schema::{Index, IndexComponent};

// @ref LLP 3000.019#3.1 — mirror by_boundary's index identity and descending direction; advice changes no execution facts.
pub(in crate::bind) fn sync_order_notes(schema: &Schema, programs: &[crate::bind::BoundProgram]) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for bound in programs.iter().filter(|bound| bound.program.kind == ProgramKind::Query) {
        let Some(fact) = schema.operations.get(&bound.program.name).filter(|fact| fact.runs.as_deref() == Some("device")) else { continue; };
        for scan in ir::scans(&bound.program).into_iter().filter(|scan| !scan.existence) {
            let Some(table) = schema.tables.get(&scan.table) else { continue; };
            // Word search and whole-domain aggregates have separate coverage
            // requirements: changing their page order cannot establish them.
            let Some(query_index) = table.index(&scan.index).filter(|index| index.word_component().is_none()) else { continue; };
            // An aggregate domain can also have a literal bound from a cap;
            // its source metadata distinguishes it from an authored page.
            if matches!(scan.take, ir::Bound::Meter) || bound.constraint_domains.contains(&scan.site) { continue; }
            let Some(sync) = &table.sync else { continue; };
            let Some(window) = &sync.horizon else { continue; };
            if scan.index == window.by && scan.order == ir::Order::Desc { continue; }
            let Some(index) = table.index(&window.by).filter(|index| index.is_plain()) else { continue; };
            let prefix = match &sync.audience { Audience::Public => 0, Audience::Column(_) => 1, Audience::Target { prefix, .. } => prefix.len() };
            let columns = ordered_columns(index, prefix);
            let window_order = columns.join(", ");
            let query_order = ordered_columns(query_index, scan.prefix.len()).join(", ");
            let direction = if scan.order == ir::Order::Desc { "newest first" } else { "oldest first" };
            let location = bound.sources.get(&scan.site).map_or(&bound.site, |(location, _)| location);
            let spelling = bound.sources.get(&scan.site).map(|(_, spelling)| format!(" `{spelling}`")).unwrap_or_default();
            let outcome = if fact.held { "this held query stays on the device with unknown coverage" }
                else { "the client needs the server for this read; offline coverage is unknown" };
            let describe = |name: &str, index: &snapback4_core::schema::Index| {
                let name = if name.starts_with("$intent:") { String::new() } else { format!("{name} ") };
                format!(" (index {name}[{}])", index.components.iter().filter_map(order_component).collect::<Vec<_>>().join(", ").replace('.', ""))
            };
            // A named index rewrite preserves its physical identity, even if
            // another declared index happens to have identical columns.
            let by = if window.by.starts_with("$intent:") { window_order.clone() } else { window.by.clone() };
            let mut rewrite = format!("order this page by the window's columns, newest first: `last {} by {by}`; keep its audience predicate and cursor", scan.take.maximum());
            let window_columns = index.columns();
            let query_columns = query_index.columns();
            let view_page = scan.merge_site.is_some() || bound.sources.get(&scan.site)
                .is_some_and(|(_, source)| source.split(|c: char| !c.is_alphanumeric() && c != '_').next() != Some(scan.table.as_str()));
            let incompatible_range = scan.range.is_some()
                && query_index.components.get(scan.prefix.len()) != index.components.get(prefix);
            if view_page || incompatible_range || scan.prefix.len() != prefix || query_columns.get(..prefix) != window_columns.get(..prefix)
                || (scan.index != window.by && ordered_columns(query_index, 0) == ordered_columns(index, 0))
                || window_columns.iter().position(|column| column == "id").is_some_and(|at| at + 1 < window_columns.len()) {
                // Extra equality pins, a legacy implicit-id index, or order
                // keys after intrinsic id can select another index again.
                // Give an explicit physical-index rewrite for those cases.
                let mut name = window.by.clone();
                let mut declaration = String::new();
                if name.starts_with("$intent:") {
                    name = "bySyncWindow".into();
                    while table.index(&name).is_some() { name.push('_'); }
                    declaration = format!("declare `by {name}: {}` on {}; set its sync horizon to `last {} by {name}`; ", window_columns.join(", "), scan.table, window.last);
                }
                if let Some(source) = bound.page_sources.get(&scan.site) {
                    let page = source_page(source, &name, index, prefix);
                    rewrite = if view_page {
                        format!("{declaration}page the source table {} with `{page}`, newest first; keep this branch's projection and the other source branches when composing the result; a view cannot select a physical index. Restart pagination after changing the order", scan.table)
                    } else {
                        format!("{declaration}use `{page}`, newest first; keep only audience pins in the key and incompatible range predicates in the residual filter. Restart pagination after changing the order")
                    };
                }
            }
            notes.push(Diagnostic::new(location, "N_SYNC_ORDER",
                format!("query {}{spelling} reads {} by {query_order}, {direction}{}; its sync window is last {} by {window_order}, newest first{}; {outcome}",
                    bound.program.name, scan.table, describe(&scan.index, query_index), window.last, describe(&window.by, index)), rewrite)
                .guide("sync"));
        }
    }
    notes.sort_by(|a, b| (&a.site.file, a.site.line, a.site.col, &a.message).cmp(&(&b.site.file, b.site.line, b.site.col, &b.message)));
    notes.dedup();
    notes
}

fn ordered_columns(index: &Index, prefix: usize) -> Vec<String> {
    let mut columns: Vec<_> = index.components.iter().skip(prefix).filter_map(order_component).collect();
    if !columns.iter().any(|column| column == ".id") { columns.push(".id".into()); }
    columns
}

fn order_component(component: &IndexComponent) -> Option<String> {
    match component {
        IndexComponent::Column(column) => Some(format!(".{column}")),
        IndexComponent::Calendar(key) => {
            let period = if key.function == "bucket" { format!(", {}ms", key.millis) } else { String::new() };
            let offset = if key.offset == 0 { String::new() } else { format!(", {}ms", key.offset) };
            Some(format!("{}(.{}{period}{offset})", key.function, key.column))
        }
        _ => None,
    }
}

// @ref LLP 3000.019#3.1 — replace the index without turning its old range key into an invalid key on the new index.
fn source_page(source: &ast::ReadExpr, name: &str, index: &Index, prefix: usize) -> String {
    let mut page = source.clone();
    let columns = index.columns();
    let mut filters = page.filter.take().map(|filter| vec![*filter]).unwrap_or_default();
    let comparison = |column: &str, op: &str, value: ast::Expr| ast::Expr::Binary {
        op: op.into(), left: Box::new(source.computed.get(column).cloned().unwrap_or_else(|| ast::Expr::Member {
            base: Box::new(ast::Expr::Focal { site: source.site.clone() }), name: column.into(), site: source.site.clone(),
        })), right: Box::new(value), site: source.site.clone(),
    };
    let mut keys = std::mem::take(&mut page.keys);
    for column in columns.iter().take(prefix) {
        let Some(at) = keys.iter().position(|key| key.column.as_ref() == Some(column)) else { break; };
        page.keys.push(keys.remove(at));
    }
    for key in keys {
        filters.push(comparison(key.column.as_ref().expect("resolved source key"), "=", key.value));
    }
    let next = columns.get(page.keys.len());
    page.seeks.retain(|seek| {
        if next == Some(&seek.column) && !source.computed.contains_key(&seek.column) { true }
        else {
            // Calendar bounds compare the computed key, not a field named day.
            filters.push(comparison(&seek.column, &seek.op, seek.value.clone()));
            false
        }
    });
    page.filter = crate::bind::intent::conjunction(filters);
    page.order_keys.clear();
    page.index = Some(name.into());
    if let Some(range) = &mut page.range { range.order = ast::Order::Desc; }
    print::read_expr(&page)
}
