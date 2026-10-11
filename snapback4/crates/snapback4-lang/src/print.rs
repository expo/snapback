//! Quarry text from syntax, for source-aware diagnostics and pasteable rewrites.
use crate::ast::*;

type Source<'a> = dyn Fn(&Expr) -> Option<(String, bool)> + 'a;

/// Rewrite callers may embed an expression in another operator or clause.
/// Use the same precedence renderer as source excerpts, with a grouped root.
pub fn expression(expr: &Expr) -> String {
    let grouped = match expr {
        Expr::Binary { .. } | Expr::Unary { .. } | Expr::If { .. } => true,
        Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } =>
            read.filter.is_some() || read.matching.is_some() || read.range.is_some(),
        _ => false,
    };
    with_source_at(expr, if grouped { 8 } else { 0 }, &|_| None)
}

pub(crate) fn with_source(expr: &Expr, source: &Source<'_>) -> String { with_source_at(expr, 0, source) }
pub(crate) fn with_source_at(expr: &Expr, minimum: u8, source: &Source<'_>) -> String { render(expr, minimum, source) }

pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n").replace('\t', "\\t"))
}

fn priority(expr: &Expr) -> u8 {
    match expr {
        Expr::Binary { op, .. } => crate::parser::precedence(op).unwrap_or(0),
        Expr::If { .. } | Expr::Read(_) | Expr::Exists { .. } | Expr::Created { .. } | Expr::Merge(_) | Expr::Write { .. } | Expr::Walk { .. } => 0,
        Expr::Unary { .. } => 7,
        Expr::Assert { .. } | Expr::Shape { .. } | Expr::ShapeUse { .. } | Expr::Member { .. } => 8,
        _ => 9,
    }
}

fn render(expr: &Expr, minimum: u8, source: &Source<'_>) -> String {
    let wrap = |text: String, grouped: bool| if priority(expr) < minimum && !grouped { format!("({text})") } else { text };
    if let Some((text, grouped)) = source(expr) { return wrap(text, grouped); }
    let sub = |e| render(e, 0, source);
    let text = match expr {
        Expr::Name { name, .. } => name.clone(),
        Expr::Focal { .. } => ".".into(),
        Expr::Literal { value, .. } => match value {
            Literal::Str(s) => quote(s), Literal::Number(n) => n.clone(),
            Literal::Bool(b) => b.to_string(), Literal::Null => "null".into(),
        },
        Expr::Array { items, .. } => format!("[{}]", items.iter().map(sub).collect::<Vec<_>>().join(", ")),
        Expr::Object { fields, .. } => format!("{{ {} }}", object_fields(fields, source)),
        Expr::Unary { op, value, .. } => {
            let value = render(value, 7, source);
            if op == "not" { format!("not {value}") }
            else if value.starts_with('-') { format!("-({value})") } else { format!("-{value}") }
        }
        Expr::Binary { op, left, right, .. } => {
            let p = priority(expr);
            let (l, r) = if op == "??" { (p + 1, p) } else { (p, p + 1) };
            format!("{} {op} {}", render(left, l, source), render(right, r, source))
        }
        Expr::Member { base, name, .. } => match base.as_ref() {
            Expr::Focal { .. } => format!(".{name}"),
            other => format!("{}.{name}", render(other, 8, source)),
        },
        Expr::Call { name, args, .. } => format!("{name}({})", args.iter().enumerate().map(|(n, arg)| {
            let value = sub(arg);
            if n > 0 && matches!(name.as_str(), "day" | "hour" | "bucket") && matches!(arg, Expr::Literal { value: Literal::Number(_), .. }) && source(arg).is_none() { format!("{value}ms") }
            else { value }
        }).collect::<Vec<_>>().join(", ")),
        Expr::Read(read) => read_with(read, source),
        Expr::Merge(merge) => format!("merge {}{}{} {} {} by {}{}:", merge.table, merge.matching.as_ref().map_or(String::new(), |q| format!(" matching {}", sub(q))), merge.cursor.as_ref().map_or(String::new(), |c| format!(" after {}", sub(c))), if merge.order == Order::Asc { "first" } else { "last" }, merge.take, merge.index, merge.filter.as_ref().map_or(String::new(), |p| format!(" where {}", sub(p)))),
        Expr::Exists { read, .. } => format!("exists {}", read_with(read, source)),
        Expr::Created { read, .. } => format!("created {}", read_with(read, source)),
        Expr::Assert { value, code, message, .. } => format!("{} ! else {code}{}", render(value, 8, source), message.as_deref().map(|m| format!(" {}", quote(m))).unwrap_or_default()),
        Expr::ShapeUse { base, name, .. } => format!("{} {name}", render(base, 8, source)),
        Expr::Shape { base, fields, .. } => format!("{} {{ {} }}", render(base, 8, source), shape_with(fields, source)),
        Expr::Walk { table, seed, column, depth, .. } => format!("walk {table}[{}] up .{column} depth {depth}", sub(seed)),
        Expr::If { then, condition, otherwise, .. } => format!("{} if {} else {}", render(then, 1, source), render(condition, 1, source), sub(otherwise)),
        Expr::Write { op, table, keys, fields, if_absent, condition, .. } => {
            let mut out = format!("{} {table}", op.word());
            // `delete row` / `update row { … }` keep their row-variable spelling.
            if *op != WriteOp::Insert && !keys.is_empty() { out.push_str(&format!("[{}]", keys.iter().map(|k| key_part(k, source)).collect::<Vec<_>>().join(", "))); }
            if *op != WriteOp::Delete { out.push_str(&format!(" {{ {} }}", object_fields(fields, source))); }
            if *if_absent { out.push_str(" if absent"); }
            if let Some(condition) = condition { out.push_str(&format!(" if {}", sub(condition))); }
            out
        }
    };
    wrap(text, false)
}

pub fn read_expr(read: &ReadExpr) -> String { read_with(read, &|_| None) }

fn read_with(read: &ReadExpr, source: &Source<'_>) -> String {
    if let Some((text, _)) = source(&Expr::Read(read.clone())) { return text; }
    let sub = |e| render(e, 0, source);
    if !read.order_keys.is_empty() && read.keys.iter().all(|key| key.column.is_some()) {
        let mut predicates = read.keys.iter().map(|key| format!(".{} = {}", key.column.as_ref().unwrap(), render(&key.value, 5, source))).collect::<Vec<_>>();
        predicates.extend(read.seeks.iter().map(|bound| format!(".{} {} {}", bound.column, bound.op, render(&bound.value, 5, source))));
        if let Some(filter) = &read.filter { predicates.push(render(filter, if predicates.is_empty() { 0 } else { 3 }, source)); }
        let mut out = read.table.clone();
        if !predicates.is_empty() { out.push_str(&format!(" where {}", predicates.join(" and "))); }
        if let Some(matching) = &read.matching { out.push_str(&format!(" matching {}", sub(matching))); }
        if let Some(range) = &read.range { out.push_str(&format!(" {} {}", if range.order == Order::Asc { "first" } else { "last" }, range.take)); }
        out.push_str(&format!(" by {}", read.order_keys.iter().map(|key| format!(".{key}")).collect::<Vec<_>>().join(", ")));
        if let Some(cursor) = read.range.as_ref().and_then(|range| range.cursor.as_ref()) { out.push_str(&format!(" after {}", sub(cursor))); }
        return out;
    }
    let mut out = format!("{}[{}]", read.table, read.keys.iter().map(|key| key_part(key, source)).chain(read.seeks.iter().map(|b| format!("{} {} {}", b.column, b.op, sub(&b.value)))).collect::<Vec<_>>().join(", "));
    if let Some(matching) = &read.matching { out.push_str(&format!(" matching {}", sub(matching))); }
    if let Some(range) = &read.range {
        if let Some(cursor) = &range.cursor { out.push_str(&format!(" after {}", sub(cursor))); }
        out.push_str(&format!(" {} {}", if range.order == Order::Asc { "first" } else { "last" }, range.take));
    }
    if let Some(index) = &read.index { out.push_str(&format!(" by {index}")); }
    if let Some(filter) = &read.filter { out.push_str(&format!(" where {}", sub(filter))); }
    out
}

fn key_part(part: &KeyPart, source: &Source<'_>) -> String {
    let value = render(&part.value, 0, source);
    match &part.column { Some(column) => format!("{column} = {value}"), None => value }
}

fn object_fields(fields: &[ObjectField], source: &Source<'_>) -> String {
    fields.iter().map(|field| match &field.value {
        Some(value) if field.spread => format!("...{}", render(value, 8, source)),
        Some(value) => format!("{}: {}", field.name, render(value, 0, source)), None => field.name.clone(),
    }).collect::<Vec<_>>().join(", ")
}

fn shape_with(fields: &[ShapeField], source: &Source<'_>) -> String {
    fields.iter().map(|field| match field {
        ShapeField::Spread { .. } => "*".to_owned(), ShapeField::NamedSpread { name, .. } => format!("...{name}"),
        ShapeField::Bare { name, .. } => name.clone(),
        ShapeField::Field { name, value, .. } => format!("{name}: {}", render(value, 0, source)),
    }).collect::<Vec<_>>().join(", ")
}

pub fn scalar_type(type_: &ScalarType) -> String {
    let base = match &type_.kind {
        TypeKind::Cursor => "cursor".to_owned(),
        TypeKind::Text { min, max, format } => {
            let mut out = match min {
                Some(min) => format!("text {min}..{max}"),
                None => format!("text <={max}"),
            };
            if let Some(format) = format {
                out.push_str(&format!(" format {format}"));
            }
            out
        }
        TypeKind::Id => "id".into(),
        TypeKind::Principal => "principal".into(),
        TypeKind::Int => "int".into(),
        TypeKind::Decimal { scale } => format!("decimal {scale}"),
        TypeKind::Money { currency, scale } => format!("money {currency} {scale}"),
        TypeKind::Time => "time".into(),
        TypeKind::Bool => "bool".into(),
        TypeKind::Json { max } => format!("json <={max}"),
        TypeKind::Bytes { max } => format!("bytes <={max}"),
        TypeKind::Image { max, once } => format!("image <={max}{}", if *once { " once" } else { "" }),
        TypeKind::Video { max } => format!("video <={max}"),
        TypeKind::Enum { variants } => format!("enum({})", variants.iter().map(|v| format!("'{v}'")).collect::<Vec<_>>().join(", ")),
        TypeKind::Ref { table } => table.clone(),
        TypeKind::List { item, min: 0, max } => format!("[{}] <={max}", scalar_type(item)),
        TypeKind::List { item, min, max } => format!("[{}] {min}..{max}", scalar_type(item)),
    };
    if type_.optional { format!("{base} ?") } else { base }
}
