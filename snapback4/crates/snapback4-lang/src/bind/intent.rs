//! Intent planning precedes schema binding. Every inferred index is an ordinary
//! index; the runtime, adoption and residency never distinguish its provenance.
use super::catalog::{Catalog, TableInfo};
use super::intent_walk as walk;
use crate::ast::*;
use crate::diag::{Diagnostic, Site};
use std::collections::BTreeMap;

#[derive(Clone, Default)]
pub(super) struct Requests {
    indexes: BTreeMap<(String, String), IndexDecl>,
    errors: Vec<Diagnostic>,
    contexts: super::intent_aggregates::Contexts,
}

// @ref LLP 3000.013#2.1 — intrinsic id resolves every table-local tie.
// Normalize authored table reads before view expansion: a view's shared order
// must retain later keys because different branches can carry the same id.
pub(super) fn table_order(catalog: &mut Catalog) {
    let mut normalize = |value: &mut Expr| {
        if let Expr::Read(read) | Expr::Exists { read, .. } = value
            && catalog.tables.contains_key(&read.table)
            && let Some(id) = read.order_keys.iter().position(|column| column == "id")
            && id + 1 < read.order_keys.len() {
            catalog.read_origins.entry(read.site.to_string()).or_insert_with(|| catalog.source.expression(&Expr::Read(read.clone())));
            catalog.canonical_read_origins.entry(read.site.to_string()).or_insert_with(|| if read.index.is_none() { crate::print::read_expr(read) } else { catalog.source.expression(&Expr::Read(read.clone())) });
            read.order_keys.truncate(id + 1);
        }
    };
    for doc in &mut catalog.documents {
        walk::document(doc, &mut normalize);
        for view in &mut doc.views {
            for branch in &mut view.branches {
                if let Some(predicate) = &mut branch.predicate { walk::expression(predicate, &mut normalize); }
                walk::shape(&mut branch.fields, &mut normalize);
            }
        }
    }
}

impl Requests {
    fn index(&mut self, table: &TableInfo, columns: Vec<String>, words: Option<(usize, Vec<String>)>, site: &Site, exact: bool) -> String {
        self.index_computed(table, columns, words, BTreeMap::new(), site, exact)
    }

    fn index_computed(&mut self, table: &TableInfo, columns: Vec<String>, words: Option<(usize, Vec<String>)>, computed: BTreeMap<String, Expr>, site: &Site, exact: bool) -> String {
        let computed_key = computed_descriptor(table, &computed);
        let mut matching = table.indexes.iter().filter(|index| computed_descriptor(table, &index.computed) == computed_key && index.words == words
            && if exact { index.columns == columns } else { index.columns.starts_with(&columns) }).collect::<Vec<_>>();
        matching.sort_by_key(|index| &index.name);
        if exact && matching.len() > 1 {
            self.errors.push(crate::diag::ambiguous(site, format!("{} has several declared indexes for the same planned read: {}", table.decl.name, matching.iter().map(|index| index.name.as_str()).collect::<Vec<_>>().join(", ")),
                format!("choose `by {}` explicitly or keep one definition", matching[0].name)));
        }
        if let Some(index) = matching.first() { return index.name.clone(); }
        // A structural request token is replaced only after all requests have
        // been sorted. Collisions therefore cannot depend on program order.
        let token = format!("$intent:{}", snapback4_core::value::digest(&(&columns, &words, &computed_key, false)));
        self.indexes.entry((table.decl.name.clone(), token.clone())).or_insert_with(|| IndexDecl {
            name: token.clone(), columns, words, computed, unique: false, refusal: None, site: site.clone(),
        });
        token
    }

    pub(super) fn read(&mut self, tables: &BTreeMap<String, TableInfo>, read: &mut ReadExpr, rule: bool) {
        if super::validate_key_names(read).is_err() { return; }
        let Some(table) = tables.get(&read.table) else { return; };
        // @ref LLP 3000.007#23 — resolve count-row order aliases before choosing an index;
        // an authored group column named count always keeps precedence.
        if !table.columns.contains_key("count")
            && table.maintained.as_ref().is_some_and(|m| m.aggregate == "count") {
            for column in &mut read.order_keys {
                if column == "count" { *column = "value".into(); }
            }
        }
        if read.index.is_some() {
            if !rule { self.selected_prefix(table, read); }
            return;
        }
        let named = !read.keys.is_empty() && read.keys.iter().all(|key| key.column.is_some());
        let covered = named && table.indexes.iter().any(|index| table.total_unique(index)
            && index.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column))));
        if rule {
            if named && !covered {
                read.index = Some(self.index(table, read.keys.iter().filter_map(|key| key.column.clone()).collect(), None, &read.site, true));
            }
            return;
        }
        if (covered || table.maintained.is_some() && named && table.indexes.iter().any(|index| index.unique && index.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column))))) && read.range.is_none() && read.filter.is_none() && read.matching.is_none() && read.order_keys.is_empty() { return; }
        // Positional keys retain the binder's point/refusal path. They are never
        // silently turned into a predicate on an inferred parent column.
        if !read.keys.is_empty() && !named { return; }
        let mut pins: BTreeMap<String, KeyPart> = read.keys.iter().filter_map(|key| key.column.clone().map(|name| (name, key.clone()))).collect();
        let mut residual = Vec::new();
        if let Some(predicate) = read.filter.take() {
            let mut conjuncts = Vec::new();
            split(*predicate, &mut conjuncts);
            for predicate in conjuncts {
                if let Some((column, value)) = equality(&predicate, table) {
                    // Keep the full ordered suffix in every projected branch,
                    // even when the predicate fixes one of its order fields.
                    if read.order_keys.contains(&column) || column == "id" {
                        if read.order_keys.first().map(String::as_str).unwrap_or("id") == column
                            && !table.columns.get(&column).is_some_and(|ty| ty.optional)
                            && self.contexts.safe(read, &value) {
                            for op in [">=", "<="] {
                                residual.push(Expr::Binary { op: op.into(), left: Box::new(Expr::Member { base: Box::new(Expr::Focal { site: predicate.site().clone() }), name: column.clone(), site: predicate.site().clone() }), right: Box::new(value.clone()), site: predicate.site().clone() });
                            }
                        } else { residual.push(predicate); }
                        continue;
                    }
                    if !pins.contains_key(&column) {
                        pins.insert(column.clone(), KeyPart { column: Some(column), value, site: predicate.site().clone() });
                        continue;
                    }
                }
                residual.push(predicate);
            }
        }
        let mut columns: Vec<_> = pins.keys().filter(|column| !read.computed.contains_key(*column)).cloned().collect();
        columns.extend(pins.keys().filter(|column| read.computed.contains_key(*column)).cloned());
        let mut order = read.order_keys.clone();
        if order.is_empty() { order.push("id".into()); }
        // A projected field may alias id before another order key. Moving it
        // changes the lane's order relative to the view's shared cursor.
        let mut seen = std::collections::BTreeSet::new();
        order.retain(|column| !pins.contains_key(column) && seen.insert(column.clone()));
        if !order.iter().any(|column| column == "id") { order.push("id".into()); }
        let words = if read.matching.is_some() {
            let fields = if !table.decl.search.is_empty() { table.decl.search.clone() }
                else {
                    let definitions: std::collections::BTreeSet<_> = table.indexes.iter().filter_map(|index| index.words.as_ref().map(|(_, fields)| fields.clone())).collect();
                    if definitions.len() > 1 {
                        self.errors.push(crate::diag::ambiguous(&read.site, format!("{} has multiple words definitions", read.table),
                            format!("declare `search {}` on {} or choose an authored words index explicitly", definitions.first().unwrap().join(", "), read.table)).guide("search"));
                    }
                    definitions.into_iter().next().unwrap_or_default()
                };
            if fields.is_empty() { read.filter = conjunction(residual); return; }
            Some((columns.len(), fields))
        } else { None };
        // Seek extraction leaves duplicate bounds as residuals; the strongest
        // range is still exact after filtering and no conjunct disappears.
        let mut kept = Vec::new();
        for predicate in residual {
            if words.is_none() && let Some((column, op, value)) = comparison(&predicate)
                && order.first() == Some(&column) && self.contexts.safe(read, &value)
                && !read.seeks.iter().any(|bound| (bound.op.starts_with('<')) == op.starts_with('<')) {
                read.seeks.push(SeekBound { column, op, value, site: predicate.site().clone() });
            } else {
                kept.push(predicate);
            }
        }
        // An extremum has no observable tie order. Reuse an endpoint index
        // even when its equality prefix permutes the canonical pin order or
        // its suffix carries additional tie columns. Ordinary pages keep the
        // exact-order planner below.
        let extremum_index = self.contexts.extrema.get(&read.site.to_string())
            .filter(|field| words.is_none() && order.first() == Some(field))
            .and_then(|field| table.indexes.iter().filter(|index| index.is_plain()
                && index.columns.get(columns.len()) == Some(field)
                && index.columns[..columns.len()].iter().all(|column| columns.contains(column)))
                .min_by_key(|index| &index.name));
        if let Some(index) = extremum_index { columns = index.columns[..columns.len()].to_vec(); }
        read.keys = columns.iter().filter_map(|column| pins.remove(column)).collect();
        read.filter = conjunction(kept);
        read.order_keys = order.clone();
        columns.extend(order);
        columns.dedup();
        // The physical id suffix can be omitted from a scan cursor only when
        // the declared components already totally order its rows. Reads with
        // no cursor retain their existing physical-prefix index reuse.
        let cursor = read.range.as_ref().is_some_and(|range| range.cursor.is_some());
        let computed = computed_descriptor(table, &read.computed);
        let candidates: Vec<_> = table.indexes.iter().filter(|index| {
            let mut ordered = index.columns.clone();
            if ordered.last().map(String::as_str) != Some("id") { ordered.push("id".into()); }
            (!cursor || table.total_cursor(index)) && ordered == columns && index.words == words && computed_descriptor(table, &index.computed) == computed
        }).collect();
        if candidates.len() > 1 {
            self.errors.push(crate::diag::ambiguous(&read.site, format!("{} has several declared indexes covering this predicate read", read.table),
                format!("choose `by {}` explicitly or keep one definition", candidates[0].name)));
        }
        read.index = Some(if let Some(index) = extremum_index.or_else(|| candidates.first().copied()) { index.name.clone() }
            else { self.index_computed(table, columns, words, read.computed.clone(), &read.site, true) });
    }
    // @ref LLP 3000.028#3.2 — an explicit index has the same coverage as
    // its bracket prefix, but only for present, infallible binding values.
    fn selected_prefix(&self, table: &TableInfo, read: &mut ReadExpr) {
        let Some(index) = table.indexes.iter().find(|index| Some(&index.name) == read.index.as_ref()) else { return; };
        if !index.is_plain() || read.keys.len() > index.columns.len() || read.range.is_none()
            || read.matching.is_some() || !read.order_keys.is_empty() || !read.seeks.is_empty() { return; }
        // Preserve positional keys and reject gaps/mismatches through the
        // ordinary binder. Never repair an invalid authored constraint here.
        if read.keys.iter().enumerate().any(|(n, key)| key.column.as_ref().is_some_and(|column| column != &index.columns[n])) { return; }
        let Some(predicate) = read.filter.as_ref() else { return; };
        let original_prefix = read.keys.len();
        let mut conjuncts = Vec::new();
        split(*predicate.clone(), &mut conjuncts);
        for column in &index.columns[read.keys.len()..] {
            // A range needs an unpinned component. Existing seeks take the
            // unchanged binder path above, including originally invalid seeks.
            if read.keys.len() + 1 == index.columns.len() { break; }
            if !table.columns.get(column).is_some_and(|ty| !ty.optional) { break; }
            let candidates: Vec<_> = conjuncts.iter().enumerate().filter_map(|(n, predicate)| {
                if !matches!(predicate, Expr::Binary { op, .. } if op == "=") { return None; }
                equality(predicate, table).filter(|(name, _)| name == column).map(|(_, value)| (n, value))
            }).collect();
            // Multiple equalities may conflict. Leave all of them residual;
            // no arbitrary choice may acquire a different coverage domain.
            let [(n, value)] = candidates.as_slice() else { break; };
            // Only the leading conjunct may move: skipping an earlier row
            // predicate could suppress its explicit refusal or arithmetic error.
            if *n != 0 || !self.contexts.safe(read, value) { break; }
            let predicate = conjuncts.remove(*n);
            // Existing positional prefixes must stay positional, too.
            let named = read.keys.first().is_none_or(|key| key.column.is_some());
            read.keys.push(KeyPart { column: named.then(|| column.clone()), value: value.clone(), site: predicate.site().clone() });
        }
        // An unchanged predicate keeps its original source span, which is
        // also the input to source-preserving diagnostic repairs.
        if read.keys.len() != original_prefix {
            if read.range.as_ref().is_some_and(|range| range.cursor.is_some()) {
                read.cursor_prefix.get_or_insert(original_prefix);
            }
            read.filter = conjunction(conjuncts);
        }
    }
}

// @ref LLP 3000.013#2.1 — canonical pins and stable, shared schema indexes.
pub(super) fn plan(catalog: &mut Catalog, diagnostics: &mut Vec<Diagnostic>) {
    let contexts = super::intent_aggregates::order(catalog);
    let tables = catalog.tables.clone();
    let mut requests = Requests { contexts, ..Default::default() };
    for table in catalog.tables.values_mut() {
        let original = &tables[&table.decl.name];
        for cap in &table.decl.caps {
            if cap.by.iter().all(|column| original.columns.contains_key(column)) {
                requests.index(original, cap.by.clone(), None, &cap.site, false);
            }
        }
        if let Some((column, site)) = &table.decl.expire {
            requests.index(original, vec![column.clone()], None, site, false);
        }
        for rule in &mut table.decl.rules {
            walk::expression(&mut rule.value, &mut |value| {
                if let Expr::Exists { read, .. } | Expr::Created { read, .. } = value { requests.read(&tables, read, true); }
            });
        }
        for (value, _) in &mut table.decl.final_exists {
            walk::expression(value, &mut |value| {
                // @ref LLP 3000.013#2.3 — FinalExistsOnInsert has no residual-equality carrier: every
                // named condition must be part of the exact key, in written order.
                if let Expr::Exists { read, .. } = value
                    && read.index.is_none() && !read.keys.is_empty()
                    && read.keys.iter().all(|key| key.column.is_some())
                    && let Some(target) = tables.get(&read.table)
                    && super::validate_key_names(read).is_ok() {
                    read.index = Some(requests.index(target, read.keys.iter().filter_map(|key| key.column.clone()).collect(), None, &read.site, true));
                }
            });
        }
        // An audience's content prefix must be enumerable too. The target's
        // unique key already supplies the corresponding recipient enumeration.
        if let Some(sync) = &mut table.decl.sync {
            let need = super::intent_sync::need(original, &tables);
            if let Some((target, columns)) = need.inverse {
                // Discovery uses principal then the exact probe's group order.
                // No pageable id suffix is needed for this bounded enumeration.
                requests.index(&tables[&target], columns, None, &sync.site, false);
            }
            let prefix = need.prefix;
            if !prefix.is_empty() { requests.index(original, prefix.clone(), None, &sync.site, false); }
            if let Some((last, by @ SyncOrder::Columns(_))) = &mut sync.horizon {
                let SyncOrder::Columns(order) = by else { unreachable!() };
                // @ref LLP 3000.019#3.1 — audience pins lead, then authored order, then the id tiebreaker once.
                let repeated: Vec<_> = order.iter().filter(|column| prefix.contains(column)).cloned().collect();
                if !repeated.is_empty() {
                    let mut repaired: Vec<_> = order.iter().filter(|column| !prefix.contains(column)).cloned().collect();
                    if repaired.is_empty() && !prefix.iter().any(|column| column == "id") { repaired.push("id".into()); }
                    let rewrite = if repaired.is_empty() { "remove the last ... by clause; the audience already pins the row id".into() }
                        else { format!("last {last} by {}", SyncOrder::Columns(repaired)) };
                    requests.errors.push(crate::diag::syntax_with(&sync.site,
                        format!("window order repeats audience columns {}; the audience already pins them", SyncOrder::Columns(repeated)), rewrite).guide("sync"));
                }
                let mut columns = prefix;
                for column in order { if !columns.contains(column) { columns.push(column.clone()); } }
                if !columns.iter().any(|column| column == "id") { columns.push("id".into()); }
                *by = SyncOrder::Index(requests.index(original, columns, None, &sync.site, true));
            }
        }
    }
    for doc in &mut catalog.documents {
        let mut visit = |value: &mut Expr, lanes: bool| {
            if let Expr::Read(read) = value && let Some(note) = super::intent_windows::missing_upper(&tables, read) { catalog.planner_notes.push(note); }
            if lanes && let Expr::Read(read) = value
                && !requests.contexts.domains.contains(&read.site.to_string())
                && let Some(mut merge) = super::intent_windows::expand(&tables, read).or_else(|| super::intent_lanes::expand(&tables, read)) {
                let mut candidate = requests.clone();
                for lane in &mut merge.lanes {
                    if let Some(read) = &mut lane.planned { candidate.read(&tables, read, false); }
                    if let Some((column, read)) = &mut lane.nulls {
                        // Choose an ordinary index before adding the null
                        // predicate: null membership must never become a pin.
                        candidate.read(&tables, read, false);
                        let mut residual = read.filter.take().map(|value| vec![*value]).unwrap_or_default();
                        residual.push(Expr::Binary { op: "=".into(),
                            left: Box::new(Expr::Member { base: Box::new(Expr::Focal { site: read.site.clone() }), name: column.clone(), site: read.site.clone() }),
                            right: Box::new(Expr::Literal { value: Literal::Null, site: read.site.clone() }), site: read.site.clone() });
                        read.filter = conjunction(residual);
                    }
                    if let Some((_, source)) = &mut lane.loop_ { walk::expression(source, &mut |value| {
                        if let Expr::Read(read) = value { candidate.read(&tables, read, false); }
                    }); }
                }
                if super::intent_lanes::prefixes_decide_rules(&tables, &merge) {
                    requests = candidate;
                    *value = Expr::Merge(merge);
                } else { requests.read(&tables, read, false); }
            } else if let Expr::Read(read) | Expr::Exists { read, .. } = value { requests.read(&tables, read, false); }
        };
        // Shared helpers/shapes and non-query programs keep ordinary scans:
        // their caller's existing mutation/job admission cannot accept a merge.
        let mut programs = std::mem::take(&mut doc.programs);
        walk::document(doc, &mut |value| visit(value, false));
        for program in &mut programs {
            let lanes = program.kind == ProgramKind::Query;
            walk::statements(&mut program.prelude, &mut |value| visit(value, lanes));
            walk::statements(&mut program.body, &mut |value| visit(value, lanes));
        }
        doc.programs = programs;
    }
    let mut needed = std::collections::BTreeSet::new();
    for doc in &mut catalog.documents {
        walk::document(doc, &mut |value| {
            if let Expr::Call { name, args, .. } = value
                && matches!(name.as_str(), "min" | "max")
                && let Some(source) = args.first() && !matches!(source, Expr::Read(_)) {
                needed.insert(source.site().to_string());
            }
        });
    }
    catalog.extremum_domains.retain(|site, _| needed.contains(site));
    for read in catalog.extremum_domains.values_mut() {
        // Plan the original guarded predicate without page/lane expansion.
        let mut value = Expr::Read(read.clone());
        walk::expression(&mut value, &mut |value| {
            if let Expr::Read(read) | Expr::Exists { read, .. } = value { requests.read(&tables, read, false); }
        });
        let Expr::Read(planned) = value else { unreachable!("domain read") };
        *read = planned;
    }
    diagnostics.append(&mut requests.errors);
    let mut names = BTreeMap::new();
    for ((table_name, token), mut index) in requests.indexes {
        let table = catalog.tables.get_mut(&table_name).expect("requested table");
        let name = index_name(table, &index);
        index.name = name.clone();
        catalog.synthesized.insert((table_name.clone(), name.clone()));
        names.insert((table_name, token), name);
        table.indexes.push(index);
    }
    let mut resolve = |value: &mut Expr| {
        if let Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } = value
            && let Some(name) = read.index.as_ref().and_then(|index| names.get(&(read.table.clone(), index.clone()))) { read.index = Some(name.clone()); }
    };
    for table in catalog.tables.values_mut() {
        for rule in &mut table.decl.rules { walk::expression(&mut rule.value, &mut resolve); }
        for (value, _) in &mut table.decl.final_exists { walk::expression(value, &mut resolve); }
        if let Some((_, SyncOrder::Index(by))) = table.decl.sync.as_mut().and_then(|sync| sync.horizon.as_mut())
            && let Some(name) = names.get(&(table.decl.name.clone(), by.clone())) { *by = name.clone(); }
    }
    for doc in &mut catalog.documents { walk::document(doc, &mut resolve); }
    for read in catalog.extremum_domains.values_mut() {
        let mut value = Expr::Read(read.clone());
        walk::expression(&mut value, &mut resolve);
        let Expr::Read(planned) = value else { unreachable!("domain read") };
        *read = planned;
    }
    for doc in &catalog.documents {
        for program in &doc.programs {
            if let Some(name) = program.name.strip_prefix("$view:")
                && let Some(Stmt::Return { value: Expr::Merge(merge), .. }) = program.body.first() {
                let mut domain = merge.clone();
                domain.take = 8192;
                for lane in &mut domain.lanes { if let Some(read) = &mut lane.planned { read.range = None; } }
                catalog.view_reads.insert(name.into(), domain);
            }
        }
    }
    catalog.shapes = catalog.documents.iter().flat_map(|doc| doc.shapes.iter().cloned().map(|shape| (shape.name.clone(), shape))).collect();
    catalog.functions = catalog.documents.iter().flat_map(|doc| doc.functions.iter().cloned().map(|function| (function.name.clone(), function))).collect();
}

pub(super) fn index_name(table: &TableInfo, index: &IndexDecl) -> String {
    let mut components = index.columns.clone();
    if components.last().map(String::as_str) == Some("id") && components.len() > 1 { components.pop(); }
    if let Some((position, fields)) = &index.words { components.insert(*position, format!("words{}", fields.iter().map(|field| title(field)).collect::<String>())); }
    let base = format!("by{}", components.iter().map(|column| {
        if let Some(Expr::Call { name, args, .. }) = index.computed.get(column) {
            format!("{}{}", title(name), args.first().map(crate::print::expression).map(|column| title(&column)).unwrap_or_default())
        } else { title(column) }
    }).collect::<String>());
    let descriptor = (&index.columns, &index.words, computed_descriptor(table, &index.computed), index.unique);
    let hash = snapback4_core::value::digest(&descriptor);
    let mut name = format!("$intent:{base}:{}", &hash[..16]);
    if table.indexes.iter().any(|index| index.name == name) { name = format!("$intent:{base}:{hash}"); }
    name
}

fn title(value: &str) -> String { let mut chars = value.chars(); chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default() }

pub(super) fn split(value: Expr, out: &mut Vec<Expr>) {
    if let Expr::Binary { op, left, right, .. } = &value && op == "and" { split(*left.clone(), out); split(*right.clone(), out); }
    else { out.push(value); }
}
pub(super) fn conjunction(values: Vec<Expr>) -> Option<Box<Expr>> {
    values.into_iter().reduce(|left, right| Expr::Binary { site: left.site().clone(), op: "and".into(), left: Box::new(left), right: Box::new(right) }).map(Box::new)
}
pub(super) fn column(value: &Expr) -> Option<&str> {
    if let Expr::Member { base, name, .. } = value && matches!(base.as_ref(), Expr::Focal { .. }) { Some(name) } else { None }
}
pub(super) fn independent(value: &Expr) -> bool {
    match value {
        Expr::Literal { .. } | Expr::Name { .. } => true,
        Expr::Member { base, .. } | Expr::Unary { value: base, .. } => independent(base),
        Expr::Binary { left, right, .. } => independent(left) && independent(right),
        Expr::Call { args, .. } | Expr::Array { items: args, .. } => args.iter().all(independent),
        _ => false,
    }
}
pub(super) fn equality(value: &Expr, table: &TableInfo) -> Option<(String, Expr)> {
    if let Expr::Binary { op, left, right, .. } = value && op == "=" {
        if let Some(column) = column(left) && independent(right) { return Some((column.into(), *right.clone())); }
        if let Some(column) = column(right) && independent(left) { return Some((column.into(), *left.clone())); }
    }
    let (value, boolean) = if let Expr::Unary { op, value, .. } = value && op == "not" { (value.as_ref(), false) } else { (value, true) };
    let column = column(value)?;
    (table.columns.get(column)?.kind == TypeKind::Bool).then(|| (column.into(), Expr::Literal { value: Literal::Bool(boolean), site: value.site().clone() }))
}
pub(super) fn comparison(value: &Expr) -> Option<(String, String, Expr)> {
    let Expr::Binary { op, left, right, .. } = value else { return None; };
    if !matches!(op.as_str(), "<" | "<=" | ">" | ">=") { return None; }
    if let Some(column) = column(left) && independent(right) { return Some((column.into(), op.clone(), *right.clone())); }
    if let Some(column) = column(right) && independent(left) {
        return Some((column.into(), match op.as_str() { "<" => ">", "<=" => ">=", ">" => "<", _ => "<=" }.into(), *left.clone()));
    }
    None
}

pub(super) fn computed_descriptor(table: &TableInfo, computed: &BTreeMap<String, Expr>) -> Vec<snapback4_core::maintain::CalendarKey> {
    computed.iter().filter_map(|(name, value)| super::time_indexes::key(&table.decl.name, &table.columns, name, value).ok()).collect()
}
