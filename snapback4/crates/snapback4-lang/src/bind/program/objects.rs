//! Object spread is binder sugar: no new runtime or wire form.
// @ref LLP 3000.013#7 — intent forms lower into the existing ruled, metered interpreter.
use super::*;

type Field = (String, Expr, Ty, Site);

impl Binder<'_> {
    pub(super) fn object(&mut self, fields: &[ObjectField], out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let mut names = std::collections::BTreeSet::new();
        if fields.iter().all(|field| !field.spread && names.insert(&field.name)) {
            return self.plain_object(fields, out);
        }
        let fields = self.object_fields(fields, None, out)?;
        let mut values = BTreeMap::new();
        let mut types = BTreeMap::new();
        for (name, value, ty, _) in fields {
            values.insert(name.clone(), value);
            types.insert(name, ty);
        }
        Ok((Expr::Object(values), Ty::Object(types)))
    }

    fn plain_object(&mut self, fields: &[ObjectField], out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let mut exprs = Vec::<(String, Expr)>::new();
        let mut types = BTreeMap::new();
        let mut failed = None;
        for field in fields {
            let mut setup = setup::Body::default();
            let value = match &field.value {
                Some(value) => self.expr(value, &mut setup),
                None => self.name(&field.name, &field.site),
            };
            let (e, t) = match value {
                Ok(value) => value,
                Err(error) => { self.record_error(error.clone()); failed.get_or_insert(error); continue; }
            };
            self.sequence_setup(exprs.iter_mut().map(|(_, e)| e), setup, out);
            // Object IR stores fields by name. Minted ids still follow source
            // field order when no child needs a statement-producing expansion.
            let e = if expr::allocates(&e) { self.snapshot(e, out) } else { e };
            if types.contains_key(&field.name) {
                return Err(unknown(&field.site, format!("duplicate field {}", field.name), "keep one"));
            }
            exprs.push((field.name.clone(), e));
            types.insert(field.name.clone(), t);
        }
        match failed { Some(error) => Err(error), None => Ok((Expr::Object(exprs.into_iter().collect()), Ty::Object(types))) }
    }

    /// Bind operands once, in source order, including overwritten operands.
    /// Only explicit field selections reach the existing object IR. Reads
    /// still authorize the source before any of its fields can be selected.
    fn object_fields(&mut self, fields: &[ObjectField], table: Option<&TableInfo>, out: &mut setup::Body) -> Fallible<Vec<Field>> {
        let mut result = Vec::new();
        let mut failed = None;
        for field in fields {
            let mut setup = setup::Body::default();
            let bound = if field.spread {
                self.expr(field.value.as_ref().expect("a spread operand"), &mut setup)
            } else if let Some(expected) = table.and_then(|t| t.columns.get(&field.name)).map(Ty::from_scalar)
                .or_else(|| (table.is_some() && field.name == "id").then_some(Ty::Id)) {
                self.field_value(field, &expected, &mut setup)
            } else {
                match &field.value {
                    Some(value) => self.expr(value, &mut setup),
                    None => self.name(&field.name, &field.site),
                }
            };
            let (value, ty) = match bound {
                Ok(bound) => bound,
                Err(error) => { self.record_error(error.clone()); failed.get_or_insert(error); continue; }
            };
            out.extend(setup);
            if field.spread {
                let operand = field.value.as_ref().unwrap();
                if !matches!(ty.required(), Ty::Row(_) | Ty::WriteRow(_) | Ty::Object(_) | Ty::RowShape(_)) {
                    let expression = print::expression(operand);
                    let rewrite = if let Ty::Ref(table) = ty.required() {
                        let key = if ty.is_optional() { format!("{expression} ! else NOT_FOUND") } else { expression };
                        format!("p = {table}[{key}] ! else NOT_FOUND\nreturn {{ ...p }}")
                    } else { format!("return {{ value: {expression} }}") };
                    return Err(Diagnostic::new(&field.site, "E_QUARRY_SPREAD",
                        format!("...{} needs statically known row or object fields; got {}", print::expression(operand), ty.name()),
                        rewrite).guide("shapes"));
                }
                if ty.is_optional() {
                    return Err(Diagnostic::new(&field.site, "E_QUARRY_SPREAD",
                        format!("...{} needs a present row or object; got {}", print::expression(operand), ty.name()),
                        format!("p = {} ! else NOT_FOUND\nreturn {{ ...p }}", print::expression(operand))).guide("shapes"));
                }
                let value = self.snapshot(value, out);
                for (name, ty) in self.row_fields(&ty, &field.site)? {
                    result.push((name.clone(), ir::field(value.clone(), &name), ty, field.site.clone()));
                }
            } else {
                // Snapshot anything that can read, fail or allocate before
                // evaluating the next operand. Lexical field selections stay
                // in the object so existing device provenance is preserved.
                result.push((field.name.clone(), self.snapshot(value, out), ty, field.site.clone()));
            }
        }
        match failed { Some(error) => Err(error), None => Ok(result) }
    }

    /// Write payloads share object syntax. Expand before ordinary column,
    /// maintained-column, identity, default and write-rule validation.
    pub(super) fn expand_object_fields(&mut self, fields: &[ObjectField], table: Option<&TableInfo>, out: &mut setup::Body) -> Fallible<Vec<ObjectField>> {
        let mut expanded = BTreeMap::new();
        for (name, value, ty, site) in self.object_fields(fields, table, out)? {
            let temporary = self.temp("field");
            let runtime = self.declare(&temporary, ty);
            out.push(Stmt::Let { name: runtime, value });
            expanded.insert(name.clone(), ObjectField { spread: false, name,
                value: Some(A::Name { name: temporary, site: site.clone() }), site });
        }
        Ok(expanded.into_values().collect())
    }
}
