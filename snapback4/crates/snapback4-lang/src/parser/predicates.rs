//! Refuse accidental self-comparisons without confusing a nested read's key
//! (the enclosing row) with its filter (the nested read's own row).
use super::*;

impl Parser {
    pub(super) fn with_focal<T>(&mut self, table: &str, parse: impl FnOnce(&mut Self) -> Fallible<T>) -> Fallible<T> {
        let enclosing = self.focal_table.replace(table.to_owned());
        let result = parse(self);
        self.focal_table = enclosing;
        result
    }

    pub(super) fn count_star_rewrite(&self) -> String {
        // The entire token stream includes tables declared after this operation.
        let tables: std::collections::BTreeSet<_> = self.tokens.windows(2)
            .filter(|pair| pair[0].value == "table" && pair[0].site.col == 1 && pair[1].kind == Kind::Word)
            .map(|pair| pair[1].value.as_str()).chain(self.known_tables.iter().map(|table| table.name.as_str())).collect();
        let table = self.focal_table.as_deref().filter(|name| tables.contains(name))
            .or_else(|| (tables.len() == 1).then(|| *tables.first().unwrap()));
        match table {
            Some(table) => format!("count({table})"),
            // No table is unambiguously in scope. Keep the refusal and let the
            // author choose the read; prose alternatives are not source edits.
            None => String::new(),
        }
    }

    pub(super) fn filtered_predicate(&mut self, table: &str, stops: &[&str], maintained: bool) -> Fallible<Expr> {
        let start = self.position;
        let predicate = self.with_focal(table, |parser| {
            if maintained { parser.maintain_predicate(0) } else { parser.expression(0, stops) }
        })?;
        let Some(comparison) = self_comparison(&predicate, &|column| self.column_type(table, column).is_some_and(|ty| ty.optional)) else { return Ok(predicate); };
        let Expr::Binary { left, op, .. } = comparison else { return Ok(predicate); };
        let Some(column) = focal_column(left) else { return Ok(predicate); };
        let (rewrite, advice) = if self.repair_args.is_some() && self.column_type(table, column).is_none() {
            (String::new(), "compare with an explicit argument once the column type is known".to_owned())
        } else if let Some((args_site, args)) = self.repair_args.clone().as_ref()
            && let Some(type_) = self.column_type(table, column) {
            let compatible: Vec<_> = args.iter().filter(|a| a.type_ == type_).collect();
            let argument = compatible.iter().find(|a| a.name == column).copied()
                .or_else(|| (compatible.len() == 1).then(|| compatible[0]));
            if let Some(argument) = argument {
                let rewrite = self.predicate_rewrite(start, self.position, comparison.site(), &format!(".{column} = {}", argument.name));
                (rewrite.map(|text| format!("where {text}")).unwrap_or_default(), "compare with the operation argument".into())
            } else {
                let rewrite = self.fresh_parameter(column, args).and_then(|name| {
                    self.declaration_rewrite(comparison.site(), &format!(".{column} = {name}"),
                        Some((args_site, format!("{name}: {}{}", print::scalar_type(&type_), if args.is_empty() { "" } else { ", " }))))
                });
                (rewrite.unwrap_or_default(), "add an explicit operation argument and compare with it".into())
            }
        } else {
            // Aggregate and timeline declarations have no argument scope. Make
            // the constant behavior explicit; do not invent an outer row or key.
            let constant = if matches!(op.as_str(), "=" | "<=" | ">=" | "in") { "true" } else { "false" };
            (self.declaration_rewrite(comparison.site(), constant, None).unwrap_or_default(),
                "use the explicit constant only if intended, or replace it with a column-to-value predicate; declarations have no operation arguments".into())
        };
        let message = format!("{} compares the filtered {table} row's .{column} with itself",
            self.comparison_source(comparison.site()).unwrap_or_else(|| format!(".{column} {op} .{column}")));
        self.repair_message(comparison.site(), &rewrite, format!("{message}; {advice}"));
        self.diagnostics.push(Diagnostic::new(comparison.site(), "E_QUARRY_SELF_EQUALITY", message, rewrite).guide("shapes"));
        // Keep parsing the declaration: the diagnostic blocks binding, while
        // later declarations remain available to complete typed repairs.
        Ok(predicate)
    }

    // The range and order may follow `where`. Wait for the complete read before
    // proposing a key, and only move a top-level conjunct across focal scopes.
    pub(super) fn finish_read_repair(&mut self, read: &ReadExpr, start: usize, predicates: &[(std::ops::Range<usize>, Expr)], enclosing: Option<&str>, diagnostic_start: usize, probe: bool) {
        let Some(enclosing) = enclosing else { return; };
        let Some(filter) = read.filter.as_deref() else { return; };
        let Some(comparison) = self_comparison(filter, &|c| self.column_type(&read.table, c).is_some_and(|t| t.optional)) else { return; };
        let Expr::Binary { left, .. } = comparison else { return; };
        let Some(column) = focal_column(left) else { return; };
        let Some(inner_type) = self.column_type(&read.table, column) else { return; };
        if self.column_type(enclosing, column).as_ref() != Some(&inner_type) { return; }
        // Views have projected fields but do not admit named-key reads.
        let Some(table) = self.table_decl(&read.table) else { return; };
        if read.keys.iter().any(|key| key.column.is_none() || key.column.as_deref() == Some(column)) { return; }
        if !is_conjunct(filter, comparison.site()) { return; }
        let has_key = |name: &str| name == column || read.keys.iter().any(|key| key.column.as_deref() == Some(name));
        if let Some(index) = &read.index {
            let Some(index) = table.indexes.iter().find(|i| &i.name == index) else { return; };
            let count = read.keys.len() + 1;
            if index.columns.len() < count || !index.columns[..count].iter().all(|name| has_key(name)) { return; }
        }
        let bounded = probe || read.range.is_some() || column == "id"
            || table.caps.iter().any(|cap| cap.by.iter().all(|name| has_key(name)))
            || table.indexes.iter().any(|index| index.unique && index.columns.iter().all(|name| has_key(name)));
        if !bounded { return; }
        let Some(rewrite) = self.keyed_read_rewrite(read, start, predicates, comparison.site(), column) else { return; };
        let description = self.comparison_source(comparison.site()).unwrap_or_else(|| format!(".{column}"));
        self.repair_message(comparison.site(), &rewrite,
            format!("{} compares the filtered {} row's .{column} with itself; bind the enclosing row with a named read key", description, read.table));
        if let Some(d) = self.diagnostics[diagnostic_start..].iter_mut().find(|d| d.code == "E_QUARRY_SELF_EQUALITY" && &d.site == comparison.site()) {
            d.rewrite = rewrite;
        }
    }
}

fn is_conjunct(value: &Expr, site: &Site) -> bool {
    if value.site() == site { return true; }
    matches!(value, Expr::Binary { op, left, right, .. } if op == "and" && (is_conjunct(left, site) || is_conjunct(right, site)))
}

fn focal_column(value: &Expr) -> Option<&str> {
    match value {
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => Some(name),
        _ => None,
    }
}

// @ref LLP 3000.013#2.1 — key operands keep the enclosing focal row; a filter introduces its own.
fn self_comparison<'a>(value: &'a Expr, optional: &impl Fn(&str) -> bool) -> Option<&'a Expr> {
    if let Expr::Binary { op, left, right, .. } = value
        && let Some(column) = focal_column(left) {
        let same = match (op.as_str(), right.as_ref()) {
            ("=" | "!=" | "<" | "<=" | ">" | ">=", right) => focal_column(right) == Some(column),
            ("in", Expr::Array { items, .. }) => items.iter().any(|item| focal_column(item) == Some(column)),
            _ => false,
        };
        // Ordered read predicates are false on null: inclusive reflexive
        // ordering is a useful presence test for an optional column.
        if same && !(matches!(op.as_str(), "<=" | ">=") && optional(column)) { return Some(value); }
    }
    let mut found = None;
    children(value, &mut |child| { if found.is_none() { found = self_comparison(child, optional); } });
    found
}

fn children<'a>(value: &'a Expr, visit: &mut impl FnMut(&'a Expr)) {
    match value {
        Expr::Binary { left, right, .. } => { visit(left); visit(right); }
        Expr::Unary { value, .. } | Expr::Assert { value, .. } | Expr::Member { base: value, .. }
            | Expr::Shape { base: value, .. } | Expr::ShapeUse { base: value, .. } => visit(value),
        Expr::Object { fields, .. } => { for field in fields { if let Some(value) = &field.value { visit(value); } } }
        Expr::Call { args, .. } | Expr::Array { items: args, .. } => { for value in args { visit(value); } }
        Expr::If { then, condition, otherwise, .. } => { visit(condition); visit(then); visit(otherwise); }
        Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => {
            for key in &read.keys { visit(&key.value); }
            for seek in &read.seeks { visit(&seek.value); }
            if let Some(value) = &read.matching { visit(value); }
            if let Some(value) = read.range.as_ref().and_then(|r| r.cursor.as_deref()) { visit(value); }
            // Inner filters were checked while parsing, in their own scope.
        }
        _ => {}
    }
}

// The intended predicate after transferring one top-level conjunct to a key.
pub(super) fn without_conjunct(value: &Expr, site: &Site) -> Option<Expr> {
    if value.site() == site { return None; }
    if let Expr::Binary { op, left, right, site: and_site } = value && op == "and" {
        return match (without_conjunct(left, site), without_conjunct(right, site)) {
            (Some(left), Some(right)) => Some(Expr::Binary { op: op.clone(), left: Box::new(left), right: Box::new(right), site: and_site.clone() }),
            (left, right) => left.or(right),
        };
    }
    Some(value.clone())
}
