//! SQLite erases booleans to integers. Recover direct column types from the
//! adopted schema and SQL projection, never by guessing from names or 0/1.
// @ref LLP 3000.007#20.26 — positional JSON stays compatible; boolean recovery is presentation on the operator's adopted snapshot.
use snapback4_core::schema::{ColumnType, Schema};
use sqlparser::{ast::{Expr, ObjectName, Query, SelectItem, SelectItemQualifiedWildcardKind, SetExpr, Statement, TableFactor}, dialect::SQLiteDialect, parser::Parser};
use std::collections::{BTreeMap, BTreeSet};

type Columns = Vec<(String, bool)>;
type Tables = BTreeMap<String, Columns>;

pub(super) fn booleans(sql: &str, schema: &Schema, count: usize) -> Result<Vec<bool>, String> {
    let mut tables: Tables = schema.visible_tables().map(|(name, table)| {
        let mut columns = vec![("id".into(), false)];
        columns.extend(table.columns.iter().filter(|(name, _)| *name != "id")
            .map(|(name, kind)| (name.to_ascii_lowercase(), matches!(kind.required(), ColumnType::Bool))));
        (name.to_ascii_lowercase(), columns)
    }).collect();
    let statements = Parser::parse_sql(&SQLiteDialect {}, sql).map_err(|e| format!("--json-objects SQL projection: {e}; use --json for SQLite-specific syntax"))?;
    let [Statement::Query(query)] = statements.as_slice() else { return Err("--json-objects takes a SELECT".into()); };
    let columns = query_columns(query, &mut tables)?;
    if columns.len() != count { return Err("--json-objects cannot determine this projection's column types; select explicit columns or use --json".into()); }
    Ok(columns.into_iter().map(|(_, boolean)| boolean).collect())
}

fn name(name: &ObjectName) -> Option<String> {
    // SQLite schema qualification bypasses CTE shadowing; do not erase it.
    if name.0.len() != 1 { return None; }
    name.0.last()?.as_ident().map(|id| id.value.to_ascii_lowercase())
}

fn query_columns(query: &Query, inherited: &mut Tables) -> Result<Columns, String> {
    let mut tables = inherited.clone();
    if let Some(with) = &query.with {
        if with.recursive { return Err("--json-objects does not infer recursive CTE types; use --json".into()); }
        for cte in &with.cte_tables {
            if tables.contains_key(&cte.alias.name.value.to_ascii_lowercase()) {
                return Err("--json-objects does not infer shadowing CTEs; use --json".into());
            }
            let mut columns = query_columns(&cte.query, &mut tables)?;
            for (column, alias) in columns.iter_mut().zip(&cte.alias.columns) { column.0 = alias.name.value.to_ascii_lowercase(); }
            tables.insert(cte.alias.name.value.to_ascii_lowercase(), columns);
        }
    }
    set_columns(&query.body, &mut tables)
}

fn relation(factor: &TableFactor, tables: &mut Tables) -> Result<(String, Columns), String> {
    match factor {
        TableFactor::Table { name: object, alias, args: None, .. } => {
            let key = name(object).ok_or("--json-objects does not infer schema-qualified relations; use --json")?;
            let columns = tables.get(&key).ok_or("--json-objects needs application tables or typed CTEs")?.clone();
            Ok((alias.as_ref().map(|a| a.name.value.to_ascii_lowercase()).unwrap_or(key), columns))
        }
        TableFactor::Derived { subquery, alias, .. } => Ok((alias.as_ref().map(|a| a.name.value.to_ascii_lowercase()).unwrap_or_default(), query_columns(subquery, tables)?)),
        _ => Err("--json-objects cannot infer this table expression; use --json".into()),
    }
}

fn set_columns(body: &SetExpr, tables: &mut Tables) -> Result<Columns, String> {
    match body {
        SetExpr::Query(q) => query_columns(q, tables),
        SetExpr::SetOperation { left, right, .. } => {
            let mut left = set_columns(left, tables)?;
            let right = set_columns(right, tables)?;
            if left.len() != right.len() { return Err("incompatible SQL projections".into()); }
            for (l, r) in left.iter_mut().zip(right) { l.1 &= r.1; }
            Ok(left)
        }
        SetExpr::Select(select) => {
            let mut sources = Vec::new();
            for from in &select.from {
                sources.push(relation(&from.relation, tables)?);
                for join in &from.joins { sources.push(relation(&join.relation, tables)?); }
            }
            let mut output = Vec::new();
            for item in &select.projection {
                match item {
                    SelectItem::Wildcard(_) => output.extend(sources.iter().flat_map(|(_, cols)| cols.clone())),
                    SelectItem::QualifiedWildcard(SelectItemQualifiedWildcardKind::ObjectName(object), _) => {
                        let key = name(object).ok_or("unsupported wildcard")?;
                        let (_, cols) = sources.iter().find(|(alias, _)| *alias == key).ok_or("unknown wildcard table")?;
                        output.extend(cols.clone());
                    }
                    SelectItem::UnnamedExpr(expr) => {
                        let mut direct = expr;
                        while let Expr::Nested(inner) = direct { direct = inner; }
                        let label = match direct {
                            Expr::Identifier(id) => id.value.clone(),
                            Expr::CompoundIdentifier(ids) => ids.last().unwrap().value.clone(),
                            _ => expr.to_string(),
                        };
                        output.push((label.to_ascii_lowercase(), is_bool(expr, &sources)));
                    }
                    SelectItem::ExprWithAlias { expr, alias } => output.push((alias.value.to_ascii_lowercase(), is_bool(expr, &sources))),
                    _ => return Err("unsupported object-row projection; use --json".into()),
                }
            }
            let mut names = BTreeSet::new();
            if output.iter().any(|(name, _)| !names.insert(name)) {
                return Err("--json-objects needs unique names in every projection; alias duplicate columns".into());
            }
            Ok(output)
        }
        _ => Err("--json-objects needs a SELECT projection; use --json".into()),
    }
}

fn is_bool(expr: &Expr, sources: &[(String, Columns)]) -> bool {
    let (table, column) = match expr {
        Expr::Nested(expr) => return is_bool(expr, sources),
        Expr::Identifier(id) => (None, &id.value),
        Expr::CompoundIdentifier(ids) if ids.len() == 2 => (Some(ids[0].value.to_ascii_lowercase()), &ids[1].value),
        _ => return false, // Computed SQL expressions retain SQLite's own numeric types.
    };
    let found: Vec<bool> = sources.iter().filter(|(alias, _)| table.as_ref().is_none_or(|t| t == alias))
        .flat_map(|(_, cols)| cols.iter().filter(|(name, _)| name.eq_ignore_ascii_case(column)).map(|(_, boolean)| *boolean)).collect();
    // An unqualified duplicate only reaches execution when SQLite resolved it
    // through USING/NATURAL. All contributors must agree before typing it bool.
    !found.is_empty() && found.iter().all(|boolean| *boolean)
}
