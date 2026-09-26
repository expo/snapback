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
            let audience_columns = match &sync.audience { Audience::Public => Vec::new(), Audience::Column(column) => vec![column.clone()], Audience::Target { prefix, .. } => prefix.clone() };
            let prefix = audience_columns.len();
            // Schema validation has already refused an invalid horizon. This
            // advisory pass still runs, so do not index or advise from it.
            let index_columns = index.columns();
            let Some(index_prefix) = index_columns.get(..prefix) else { continue; };
            if index_prefix != audience_columns.as_slice() || window.last == 0 { continue; }
            let columns = ordered_columns(index, prefix);
            let window_order = columns.join(", ");
            let query_order = ordered_columns(query_index, scan.prefix.len()).join(", ");
            let direction = if scan.order == ir::Order::Desc { "newest first" } else { "oldest first" };
            let location = bound.sources.get(&scan.site).map_or(&bound.site, |(location, _)| location);
            let spelling = bound.sources.get(&scan.site).filter(|(_, spelling)| !spelling.contains('$')).map(|(_, spelling)| format!(" `{spelling}`")).unwrap_or_default();
            let outcome = if fact.held { "this held query stays on the device with unknown coverage" }
                else { "the client needs the server for this read; offline coverage is unknown" };
            let describe = |name: &str, index: &snapback4_core::schema::Index| {
                let name = if name.starts_with("$intent:") { String::new() } else { format!("{name} ") };
                format!(" (index {name}[{}])", index.components.iter().filter_map(order_component).collect::<Vec<_>>().join(", ").replace('.', ""))
            };
            // A lane has only part of a merge's predicate/cursor/projection.
            // Never present that fragment as a replacement for the authored read.
            let mut rewrite = format!("The window uses {window_order}, newest first{}; preserve all predicates, audience keys and the cursor. No paste-ready replacement is available for this read; retain its enclosing row or merge context", describe(&window.by, index));
            let rule_pins = snapback4_core::engine::rules::deciding_fields(&scan.table, table, &table.rules.read);
            let cursor_index = index.uses_column("id") || index.unique
                && index.columns().iter().all(|column| table.columns.get(column).is_some_and(|ty| !ty.is_optional()));
            if scan.merge_site.is_none()
                // Presence branches share a site, so page_sources may hold
                // another branch's page without this variant's predicate.
                && scan.variant.is_none()
                // A page needs an unpinned component; a point replacement
                // would change the query's result type.
                && prefix < index_columns.len()
                && rule_pins.iter().all(|column| audience_columns.contains(column))
                && (scan.after.is_none() || cursor_index)
                && let Some(source) = bound.page_sources.get(&scan.site)
                && bound.sources.get(&scan.site).is_none_or(|(_, spelling)|
                    spelling.split(|c: char| !c.is_alphanumeric() && c != '_').next() == Some(scan.table.as_str())) {
                let mut name = window.by.clone();
                let mut declaration = String::new();
                if name.starts_with("$intent:") {
                    name = "bySyncWindow".into();
                    while table.index(&name).is_some() { name.push('_'); }
                    declaration = format!("declare `by {name}: {}` on {}; set its sync horizon to `last {} by {name}`; ", index.columns().join(", "), scan.table, window.last);
                }
                // A cap on removed equality keys no longer proves that this
                // page needs no cursor. Do not add N_NO_CURSOR as a repair.
                let cap_covers = schema.group_bound(&scan.table, &audience_columns)
                    .is_some_and(|cap| u64::from(cap) <= scan.take.maximum());
                let old_columns = query_index.columns().into_iter().take(scan.prefix.len()).collect::<Vec<_>>();
                let relies_on_cap = scan.after.is_none() && schema.group_bound(&scan.table, &old_columns)
                    .is_some_and(|cap| u64::from(cap) <= scan.take.maximum());
                // @ref LLP 3000.019#3.1 — a cursorless partial page must keep its slice; only a cursor or a covering cap permits reordering.
                let preserves_rows = scan.after.is_some() || cap_covers
                    || scan.order == ir::Order::Desc && ordered_columns(query_index, scan.prefix.len()) == columns;
                if preserves_rows && (!relies_on_cap || cap_covers) && (source.range.is_some() || cap_covers)
                    && let Some(page) = source_page(source, &name, index, prefix, scan.take.maximum() as u32) {
                    rewrite = format!("{declaration}use `{page}`, newest first; audience equalities stay in bracket keys and all other predicates keep their meaning. Restart pagination after changing the order");
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

// @ref LLP 3000.019#3.1 — advice is a complete, exact page or words; never rebind an outer row as a candidate row.
fn source_page(source: &ast::ReadExpr, name: &str, index: &Index, prefix: usize, take: u32) -> Option<String> {
    use crate::bind::intent::{column, conjunction, independent, split};
    // Key and seek operands are evaluated in the enclosing scope. Moving a
    // focal operand into a where would silently change which row it reads.
    if source.keys.iter().any(|key| !independent(&key.value))
        || source.seeks.iter().any(|seek| !independent(&seek.value))
        || print::read_expr(source).contains('$') { return None; }
    let mut page = source.clone();
    let columns = index.columns();
    let mut filters = Vec::new();
    if let Some(filter) = page.filter.take() { split(*filter, &mut filters); }
    let comparison = |column: &str, op: &str, value: ast::Expr| ast::Expr::Binary {
        op: op.into(), left: Box::new(source.computed.get(column).cloned().unwrap_or_else(|| ast::Expr::Member {
            base: Box::new(ast::Expr::Focal { site: source.site.clone() }), name: column.into(), site: source.site.clone(),
        })), right: Box::new(value), site: source.site.clone(),
    };
    let mut keys = std::mem::take(&mut page.keys);
    // Named indexes do not infer audience keys from where. Lift each plain
    // equality explicitly; every audience column must be pinned exactly once.
    let equality = |expr: &ast::Expr| {
        if let ast::Expr::Binary { op, left, right, .. } = expr && op == "=" {
            if let Some(col) = column(left) && independent(right) { return Some((col.to_owned(), *right.clone())); }
            if let Some(col) = column(right) && independent(left) { return Some((col.to_owned(), *left.clone())); }
        }
        None
    };
    for col in columns.iter().take(prefix) {
        let matches: Vec<_> = filters.iter().enumerate().filter_map(|(at, expr)|
            equality(expr).filter(|(column, _)| column == col).map(|(_, value)| (at, value))).collect();
        if let Some(at) = keys.iter().position(|key| key.column.as_ref() == Some(col)) {
            if !matches.is_empty() { return None; }
            page.keys.push(keys.remove(at));
        } else {
            if matches.len() != 1 { return None; }
            let (at, value) = matches.into_iter().next()?;
            filters.remove(at);
            page.keys.push(ast::KeyPart { column: Some(col.clone()), value, site: source.site.clone() });
        }
    }
    for key in keys {
        filters.push(comparison(key.column.as_ref()?, "=", key.value));
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
    // An unscoped residual would add N_SPARSE_FILTER. A lone next-key
    // comparison can add N_SEEK (or need a nullable endpoint guard). Leave
    // these shapes to prose rather than emit a newly diagnostic program.
    if page.seeks.is_empty() && (!filters.is_empty() && prefix == 0
        || filters.len() == 1 && crate::bind::intent::comparison(&filters[0])
            .is_some_and(|(column, _, _)| next == Some(&column))) { return None; }
    page.filter = conjunction(filters);
    page.order_keys.clear();
    page.index = Some(name.into());
    let range = page.range.get_or_insert(ast::RangeSpec {
        order: ast::Order::Desc, take, cursor: None, site: source.site.clone(),
    });
    range.order = ast::Order::Desc;
    Some(print::read_expr(&page))
}
