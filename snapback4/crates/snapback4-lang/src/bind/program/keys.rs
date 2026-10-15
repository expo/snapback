//! Bind key operands once, retaining authored sequencing and contextual literals.
use super::*;

impl<'a> Binder<'a> {
    pub(super) fn bind_key_parts(&mut self, info: &TableInfo, read: &ReadExpr, end: usize,
        keys: &mut Vec<(Option<String>, Expr, Ty)>, out: &mut setup::Body) -> Fallible<()> {
        for (position, part) in read.keys.iter().enumerate().take(end).skip(keys.len()) {
            let mut setup = setup::Body::default();
            let expected = part.column.as_deref().or_else(|| read.index.as_ref().and_then(|name| info.indexes.iter().find(|i| &i.name == name)).and_then(|i| i.columns.get(position)).map(String::as_str)).and_then(|column| key_identity(info, column));
            let (e, t) = match expected {
                Some(expected) => self.expr_as_reference(&part.value, &mut setup, &expected)?,
                None => self.expr(&part.value, &mut setup)?,
            };
            self.sequence_setup(keys.iter_mut().map(|(_, e, _)| e), setup, out);
            let e = if expr::allocates(&e) { self.snapshot(e, out) } else { e };
            keys.push((part.column.clone(), e, t));
        }
        self.contextualize_bound_keys(info, read, keys)?;
        Ok(())
    }

    /// Apply the selected index's identity context to operands already bound
    /// for type-directed positional selection. This changes only their
    /// retained IR/type and never evaluates the authored expression again.
    pub(super) fn contextualize_bound_keys(&self, info: &TableInfo, read: &ReadExpr,
        keys: &mut [(Option<String>, Expr, Ty)]) -> Fallible<()> {
        if let Some(index) = read.index.as_ref().and_then(|name| info.indexes.iter().find(|i| &i.name == name)) {
            for (position,(column,value,ty)) in keys.iter_mut().enumerate() {
                if let Some(expected) = column.as_deref().or_else(|| index.columns.get(position).map(String::as_str)).and_then(|c| key_identity(info,c)) {
                    if let Expr::Literal(Value::String(text)) = value {
                        if text.is_empty() {
                            return Err(type_error(read.keys[position].value.site(), "an empty text literal cannot be an id", "use a non-empty id literal, or null"));
                        }
                        *value = Expr::Literal(Value::Id(text.clone()));
                        *ty = expected.required();
                    } else {
                        (*value,*ty) = self.row_identity(value.clone(),ty.clone(),&expected);
                    }
                }
            }
        }
        Ok(())
    }

    // Mixed-key normalization names an already-bound positional prefix. Only
    // a literal acquires new context; compound expressions keep their IR/setup.
    pub(super) fn name_bound_keys(&mut self, info: &TableInfo, read: &ReadExpr,
        keys: &mut [(Option<String>, Expr, Ty)]) -> Fallible<()> {
        for ((column, expr, ty), part) in keys.iter_mut().zip(&read.keys) {
            *column = part.column.clone();
            if let Some(expected) = column.as_deref().and_then(|column| key_identity(info, column))
                && matches!(&part.value, A::Literal { value: Literal::Str(_), .. }) {
                (*expr, *ty) = self.expr_as_reference(&part.value, &mut setup::Body::default(), &expected)?;
            }
        }
        Ok(())
    }
}

fn key_identity(info: &TableInfo, column: &str) -> Option<Ty> {
    let ty = if column == "id" { Ty::Ref(info.decl.name.clone()) }
        else { Ty::from_scalar(info.columns.get(column)?) };
    ty.required().is_identity().then_some(ty)
}
