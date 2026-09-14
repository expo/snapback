//! Quarry text from syntax, for rewrites that paste a canonical form.

use crate::ast::*;

pub fn expression(expr: &Expr) -> String {
    match expr {
        Expr::Name { name, .. } => name.clone(),
        Expr::Focal { .. } => ".".into(),
        Expr::Literal { value, .. } => match value {
            Literal::Str(s) => format!("'{s}'"),
            Literal::Number(n) => n.clone(),
            Literal::Bool(b) => b.to_string(),
            Literal::Null => "null".into(),
        },
        Expr::Array { items, .. } => format!("[{}]", items.iter().map(expression).collect::<Vec<_>>().join(", ")),
        Expr::Object { fields, .. } => format!("{{ {} }}", object_fields(fields)),
        Expr::Unary { op, value, .. } => if op == "not" { format!("not {}", expression(value)) } else { format!("-{}", expression(value)) },
        Expr::Binary { op, left, right, .. } => format!("{} {op} {}", expression(left), expression(right)),
        Expr::Member { base, name, .. } => match base.as_ref() {
            Expr::Focal { .. } => format!(".{name}"),
            other => format!("{}.{name}", expression(other)),
        },
        Expr::Call { name, args, .. } => format!("{name}({})", args.iter().map(expression).collect::<Vec<_>>().join(", ")),
        Expr::Read(read) => read_expr(read),
        Expr::Merge(merge) => format!("merge {} {} {} by {}:", merge.table, if merge.order == Order::Asc { "first" } else { "last" }, merge.take, merge.index),
        Expr::Exists { read, .. } => format!("exists {}", read_expr(read)),
        Expr::Created { read, .. } => format!("created {}", read_expr(read)),
        Expr::Assert { value, code, .. } => format!("{} ! else {code}", expression(value)),
        Expr::ShapeUse { base, name, .. } => format!("{} {name}", expression(base)),
        Expr::Shape { base, fields, .. } => format!("{} {{ {} }}", expression(base), shape_fields(fields)),
        Expr::Walk { table, seed, column, depth, .. } => format!("walk {table}[{}] up .{column} depth {depth}", expression(seed)),
        Expr::If { then, condition, otherwise, .. } => format!("{} if {} else {}", expression(then), expression(condition), expression(otherwise)),
        Expr::Write { op, table, keys, fields, if_absent, condition, .. } => {
            let mut out = format!("{} {table}", op.word());
            if *op != WriteOp::Insert {
                out.push_str(&format!("[{}]", keys.iter().map(key_part).collect::<Vec<_>>().join(", ")));
            }
            if *op != WriteOp::Delete {
                out.push_str(&format!(" {{ {} }}", object_fields(fields)));
            }
            if *if_absent {
                out.push_str(" if absent");
            }
            if let Some(condition) = condition {
                out.push_str(&format!(" if {}", expression(condition)));
            }
            out
        }
    }
}

pub fn read_expr(read: &ReadExpr) -> String {
    let mut out = format!("{}[{}]", read.table, read.keys.iter().map(key_part).chain(read.seeks.iter().map(|b| format!("{} {} {}", b.column, b.op, expression(&b.value)))).collect::<Vec<_>>().join(", "));
    if let Some(matching) = &read.matching {
        out.push_str(&format!(" matching {}", expression(matching)));
    }
    if let Some(range) = &read.range {
        if let Some(cursor) = &range.cursor {
            out.push_str(&format!(" after {}", expression(cursor)));
        }
        out.push_str(&format!(" {} {}", if range.order == Order::Asc { "first" } else { "last" }, range.take));
    }
    if let Some(index) = &read.index {
        out.push_str(&format!(" by {index}"));
    }
    if let Some(filter) = &read.filter { out.push_str(&format!(" where {}", expression(filter))); }
    out
}

fn key_part(part: &KeyPart) -> String {
    match &part.column {
        Some(column) => format!("{column} = {}", expression(&part.value)),
        None => expression(&part.value),
    }
}

fn object_fields(fields: &[ObjectField]) -> String {
    fields
        .iter()
        .map(|field| match &field.value {
            Some(value) => format!("{}: {}", field.name, expression(value)),
            None => field.name.clone(),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn shape_fields(fields: &[ShapeField]) -> String {
    fields
        .iter()
        .map(|field| match field {
            ShapeField::Spread { .. } => "*".to_owned(),
            ShapeField::NamedSpread { name, .. } => format!("...{name}"),
            ShapeField::Bare { name, .. } => name.clone(),
            ShapeField::Field { name, value, .. } => format!("{name}: {}", expression(value)),
        })
        .collect::<Vec<_>>()
        .join(", ")
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
        TypeKind::List { item, max } => format!("[{}] <={max}", scalar_type(item)),
    };
    if type_.optional { format!("{base} ?") } else { base }
}
