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
            None if !tables.is_empty() => format!("pass the intended read: {}", tables.iter().map(|table| format!("count({table})")).collect::<Vec<_>>().join(" or ")),
            None => "count(<read>) — name the table or filtered read to count".into(),
        }
    }

    pub(super) fn filtered_predicate(&mut self, table: &str, stops: &[&str], maintained: bool) -> Fallible<Expr> {
        let enclosing = self.focal_table.is_some();
        let start = self.position;
        let predicate = self.with_focal(table, |parser| {
            if maintained { parser.maintain_predicate(0) } else { parser.expression(0, stops) }
        })?;
        let Some(comparison) = self_comparison(&predicate) else { return Ok(predicate); };
        let Expr::Binary { left, op, .. } = comparison else { unreachable!() };
        let column = focal_column(left).expect("self-comparison column");
        let (rewrite, advice) = if enclosing {
            (format!("{table}[{column} = .{column}]"), "bind the enclosing row with a named read key".to_owned())
        } else if let Some((args_site, args)) = &self.repair_args {
            let type_ = self.document.tables.iter().chain(&self.known_tables).find(|t| t.name == table)
                .and_then(|t| t.columns.iter().find(|c| c.name == column)).map(|c| c.type_.clone())
                .unwrap_or(ScalarType { kind: TypeKind::Id, optional: false });
            let compatible: Vec<_> = args.iter().filter(|a| a.type_ == type_).collect();
            let argument = compatible.iter().find(|a| a.name == column).copied()
                .or_else(|| (compatible.len() == 1).then(|| compatible[0]));
            if let Some(argument) = argument {
                let mut repaired = predicate.clone();
                replace_comparison(&mut repaired, comparison.site(), Expr::Binary {
                    op: "=".into(), left: left.clone(), right: Box::new(Expr::Name { name: argument.name.clone(), site: comparison.site().clone() }), site: comparison.site().clone(),
                });
                (format!("where {}", print::expression(&repaired)), "compare with the operation argument".into())
            } else {
                let end_line = self.tokens.iter().find(|t| t.site.line > args_site.line && t.site.col == 1 && TOP_LEVEL.contains(&t.value.as_str()))
                    .map_or(u32::MAX, |t| t.site.line);
                let mut name = column.to_owned();
                while args.iter().any(|a| a.name == name) || self.tokens.iter().any(|t| t.kind == Kind::Word && t.value == name && t.site.line > args_site.line && t.site.line < end_line && t.site.col == 3) { name.push_str("Argument"); }
                let mut repaired = predicate.clone();
                replace_comparison(&mut repaired, comparison.site(), Expr::Binary {
                    op: "=".into(), left: left.clone(), right: Box::new(Expr::Name { name: name.clone(), site: comparison.site().clone() }), site: comparison.site().clone(),
                });
                let rewrite = self.declaration_rewrite(start, self.position, &print::expression(&repaired),
                    Some((args_site, format!("{name}: {}{}", print::scalar_type(&type_), if args.is_empty() { "" } else { ", " }))));
                (rewrite, "add an explicit operation argument and compare with it".into())
            }
        } else {
            // Aggregate and timeline declarations have no argument scope. Make
            // the constant behavior explicit; do not invent an outer row or key.
            let mut repaired = predicate.clone();
            replace_comparison(&mut repaired, comparison.site(), Expr::Literal {
                value: Literal::Bool(matches!(op.as_str(), "=" | "<=" | ">=" | "in")), site: comparison.site().clone(),
            });
            (self.declaration_rewrite(start, self.position, &print::expression(&repaired), None),
                "use the explicit constant only if intended, or replace it with a column-to-value predicate; declarations have no operation arguments".into())
        };
        self.diagnostics.push(Diagnostic::new(comparison.site(), "E_QUARRY_SELF_EQUALITY",
            format!("{} compares the filtered {table} row's .{column} with itself; {advice}", print::expression(comparison)), rewrite).guide("shapes"));
        // Keep parsing the declaration: the diagnostic blocks binding, while
        // later declarations remain available to complete typed repairs.
        Ok(predicate)
    }

    // A missing argument requires a whole declaration repair, not an unbound
    // name in a where fragment. Keep all other source text and body statements.
    fn declaration_rewrite(&self, start: usize, end: usize, replacement: &str, argument: Option<(&Site, String)>) -> String {
        let first = &self.tokens[start].site;
        let last = &self.tokens[end - 1];
        let header = argument.as_ref().map_or_else(|| {
            (0..first.line as usize).rev().find(|&i| self.source[i].starts_with(|c: char| !c.is_whitespace()) && !self.source[i].starts_with("--")).unwrap_or(first.line as usize - 1)
        }, |(site, _)| site.line as usize - 1);
        let tail = (first.line as usize..self.source.len()).find(|&i| self.source[i].starts_with(|c: char| !c.is_whitespace()) && !self.source[i].starts_with("--")).unwrap_or(self.source.len());
        let mut text = self.source[header..tail].join("\n");
        let offset = |site: &Site| self.source[header..site.line as usize - 1].iter().map(|s| s.len() + 1).sum::<usize>()
            + self.source[site.line as usize - 1].chars().take(site.col as usize - 1).map(char::len_utf8).sum::<usize>();
        let mut finish = offset(&last.site) + last.value.len();
        if last.kind == Kind::Str {
            let mut chars = text[offset(&last.site)..].char_indices();
            let quote = chars.next().expect("string token").1;
            while let Some((i, ch)) = chars.next() {
                if ch == '\\' { chars.next(); }
                else if ch == quote { finish = offset(&last.site) + i + ch.len_utf8(); break; }
            }
        }
        text.replace_range(offset(first)..finish, replacement);
        if let Some((site, value)) = argument { text.insert_str(offset(site) + 1, &value); }
        text
    }
}

fn focal_column(value: &Expr) -> Option<&str> {
    match value {
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => Some(name),
        _ => None,
    }
}

// @ref LLP 3000.013#2.1 — key operands keep the enclosing focal row; a filter introduces its own.
fn self_comparison(value: &Expr) -> Option<&Expr> {
    if let Expr::Binary { op, left, right, .. } = value
        && let Some(column) = focal_column(left) {
        let same = match (op.as_str(), right.as_ref()) {
            ("=" | "!=" | "<" | "<=" | ">" | ">=", right) => focal_column(right) == Some(column),
            ("in", Expr::Array { items, .. }) => items.iter().any(|item| focal_column(item) == Some(column)),
            _ => false,
        };
        if same { return Some(value); }
    }
    let mut found = None;
    children(value, &mut |child| { if found.is_none() { found = self_comparison(child); } });
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

fn replace_comparison(value: &mut Expr, site: &Site, replacement: Expr) {
    if value.site() == site { *value = replacement; return; }
    let visit = |child: &mut Expr| replace_comparison(child, site, replacement.clone());
    match value {
        Expr::Binary { left, right, .. } => { visit(left); visit(right); }
        Expr::Unary { value, .. } | Expr::Assert { value, .. } | Expr::Member { base: value, .. }
            | Expr::Shape { base: value, .. } | Expr::ShapeUse { base: value, .. } => visit(value),
        Expr::Object { fields, .. } => { for field in fields { if let Some(value) = &mut field.value { visit(value); } } }
        Expr::Call { args, .. } | Expr::Array { items: args, .. } => { for value in args { visit(value); } }
        Expr::If { then, condition, otherwise, .. } => { visit(condition); visit(then); visit(otherwise); }
        Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => {
            for key in &mut read.keys { visit(&mut key.value); }
            for seek in &mut read.seeks { visit(&mut seek.value); }
            if let Some(value) = &mut read.matching { visit(value); }
            if let Some(value) = read.range.as_mut().and_then(|r| r.cursor.as_deref_mut()) { visit(value); }
        }
        _ => {}
    }
}
