//! Facts about a row snapshot that survived its materialization predicate.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.036.002#10 — a filter refines only its surviving row snapshot.
    pub(super) fn refine_filtered_row(&mut self, name: &str, ty: &Ty, domain: &A) {
        let Ty::Row(table) = ty.required() else { return };
        let mut fields = Vec::new();
        self.filtered_fields(domain, &mut fields, 16);
        let Some(info) = self.catalog.tables.get(&table) else { return };
        let facts = fields.into_iter().filter_map(|field| info.columns.get(&field)
            .map(|ty| (vec![field], Ty::from_scalar(ty).required()))).collect::<Vec<_>>();
        if let Some(binding) = self.scopes.last_mut().and_then(|scope| scope.get_mut(name)) {
            binding.fields.extend(facts);
        }
    }

    fn filtered_fields(&self, domain: &A, fields: &mut Vec<String>, fuel: usize) {
        if fuel == 0 { return; }
        match domain {
            A::Read(read) => if let Some(filter) = &read.filter { not_null(filter, fields); },
            A::Name { name, .. } => if let Some(binding) = self.binding(name)
                && binding.origins.len() == 1 { self.filtered_fields(&binding.origins[0].1, fields, fuel - 1); },
            // Every alternative must prove the same fact. A merge may contain
            // source lanes whose predicates have a different focal namespace.
            _ => {}
        }
    }
}

fn not_null(predicate: &A, fields: &mut Vec<String>) {
    let A::Binary { op, left, right, .. } = predicate else { return };
    if op == "and" { not_null(left, fields); not_null(right, fields); return; }
    if op != "!=" { return; }
    let field = match (left.as_ref(), right.as_ref()) {
        (other, A::Literal { value: Literal::Null, .. }) | (A::Literal { value: Literal::Null, .. }, other) => other,
        _ => return,
    };
    if let Some(column) = crate::bind::intent::column(field) { fields.push(column.into()); }
}
