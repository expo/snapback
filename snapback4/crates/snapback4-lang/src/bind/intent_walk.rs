//! Mutable syntax traversal shared by planning and final index-name resolution.
use crate::ast::*;

pub(super) fn expression(value: &mut Expr, visit: &mut impl FnMut(&mut Expr)) {
    match value {
        Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => read_children(read, visit),
        Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. } | Expr::ShapeUse { base: value, .. } => expression(value, visit),
        Expr::Binary { left, right, .. } => { expression(left, visit); expression(right, visit); }
        Expr::Array { items, .. } | Expr::Call { args: items, .. } => { for item in items { expression(item, visit); } }
        Expr::Object { fields, .. } => { for field in fields { if let Some(value) = &mut field.value { expression(value, visit); } } }
        Expr::Shape { base, fields, .. } => { expression(base, visit); shape(fields, visit); }
        Expr::If { then, condition, otherwise, .. } => { expression(then, visit); expression(condition, visit); expression(otherwise, visit); }
        Expr::Walk { seed, .. } => expression(seed, visit),
        Expr::Write { keys, fields, condition, .. } => {
            for key in keys { expression(&mut key.value, visit); }
            for field in fields { if let Some(value) = &mut field.value { expression(value, visit); } }
            if let Some(value) = condition { expression(value, visit); }
        }
        Expr::Merge(merge) => {
            for value in [&mut merge.matching, &mut merge.filter, &mut merge.cursor].into_iter().flatten() { expression(value, visit); }
            let mut lanes = Vec::new();
            for mut lane in std::mem::take(&mut merge.lanes) {
                if let Some((_, read)) = &mut lane.nulls {
                    let mut value = Expr::Read(*read.clone());
                    expression(&mut value, visit);
                    let Expr::Read(planned) = value else { unreachable!("planned null scan") };
                    **read = planned;
                }
                if let Some(value) = &mut lane.distinct { expression(value, visit); }
                if let Some(fields) = &mut lane.project { shape(fields, visit); }
                for value in &mut lane.prefix { expression(value, visit); }
                if let Some((_, value)) = &mut lane.loop_ { expression(value, visit); }
                if let Some(read) = &mut lane.planned {
                    let mut value = Expr::Read(*read.clone());
                    expression(&mut value, visit);
                    match value {
                        Expr::Read(planned) => **read = planned,
                        Expr::Merge(nested) if lane.loop_.is_none() => {
                            for mut child in nested.lanes {
                                child.branch = lane.branch.clone();
                                child.project = lane.project.clone();
                                lanes.push(child);
                            }
                            continue;
                        }
                        _ => unreachable!("a planned lane is a read or an expanded read"),
                    }
                }
                lanes.push(lane);
            }
            merge.lanes = lanes;
        }
        Expr::Name { .. } | Expr::Focal { .. } | Expr::Literal { .. } => {}
    }
    visit(value);
}

fn read_children(read: &mut ReadExpr, visit: &mut impl FnMut(&mut Expr)) {
    for key in &mut read.keys { expression(&mut key.value, visit); }
    for seek in &mut read.seeks { expression(&mut seek.value, visit); }
    for value in [&mut read.filter, &mut read.matching].into_iter().flatten() { expression(value, visit); }
    if let Some(value) = read.range.as_mut().and_then(|range| range.cursor.as_mut()) { expression(value, visit); }
}

pub(super) fn shape(fields: &mut [ShapeField], visit: &mut impl FnMut(&mut Expr)) {
    for field in fields { if let ShapeField::Field { value, .. } = field { expression(value, visit); } }
}

pub(super) fn statements(body: &mut [Stmt], visit: &mut impl FnMut(&mut Expr)) {
    for stmt in body {
        match stmt {
            Stmt::Bind { value, .. } | Stmt::Expr { value, .. } | Stmt::Return { value, .. } => expression(value, visit),
            Stmt::Require { condition, .. } => expression(condition, visit),
            Stmt::Emit { payload, once, .. } => {
                expression(payload, visit);
                if let Some(key) = once { expression(key, visit); }
            }
            Stmt::If { condition, then_body, else_body, .. } => { expression(condition, visit); statements(then_body, visit); statements(else_body, visit); }
            Stmt::For { domain, body, .. } => { expression(domain, visit); statements(body, visit); }
            Stmt::Break { .. } | Stmt::Continue { .. } => {}
        }
    }
}

pub(super) fn document(doc: &mut Document, visit: &mut impl FnMut(&mut Expr)) {
    for program in &mut doc.programs { statements(&mut program.prelude, visit); statements(&mut program.body, visit); }
    for function in &mut doc.functions {
        match &mut function.body { FunctionBody::Expression(value) => expression(value, visit), FunctionBody::Block(body) => statements(body, visit) }
    }
    for decl in &mut doc.shapes { shape(&mut decl.fields, visit); }
}
