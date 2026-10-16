//! A live parent snapshot can prove a private count's exact immutable audience.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.036.002#10 — a checked immutable parent field is an
    // authorization fact, never an assumption that a readable parent admits all children.
    pub(super) fn snapshot_authorizes(&self, read: &ReadExpr) -> bool {
        let Some(info) = self.catalog.tables.get(&read.table) else { return false };
        if !self.ordinary_write_lifetime(&read.table) { return false; }
        let Some((index, key, equalities)) = self.authority_point(info, read) else { return false };
        self.scopes.iter().flat_map(|scope| scope.iter()).any(|(name, binding)| {
            if binding.fields.get(&vec!["$sourceSnapshot".into()]) != Some(&Ty::Bool) || binding.origins.len() != 1 || binding.ty.is_optional() { return false; }
            let mut origin = &binding.origins[0].1;
            if let A::Assert { value, .. } = origin { origin = value; }
            let A::Read(original) = origin else { return false };
            if original.table != read.table || !original.keys.iter().all(|key| self.fixed_snapshot_key(&key.value))
                || !self.point_present(original) { return false; }
            let Some((old_index, old_key, _)) = self.authority_point(info, original) else { return false };
            if old_index != index || old_key != key { return false; }
            equalities.iter().all(|(field, value)| {
                if index.columns.contains(field) { return true; }
                if !info.decl.immutable.iter().any(|(fields, _)| fields.contains(field)) { return false; }
                let site = value.site().clone();
                let condition = A::Binary { op: "=".into(), left: Box::new(A::Member {
                    base: Box::new(A::Name { name: name.clone(), site: site.clone() }), name: field.clone(), site: site.clone() }),
                    right: Box::new(value.clone()), site };
                self.authorization_proved(&condition, true)
            })
        })
    }

    fn fixed_snapshot_key(&self, value: &A) -> bool {
        match value {
            A::Literal { .. } => true,
            A::Name { name, .. } => name == "viewer" || self.binding(name).is_some_and(|binding| binding.parameter),
            _ => false,
        }
    }

    fn authority_point<'a>(&self, info: &'a TableInfo, read: &ReadExpr) -> Option<(&'a ast::IndexDecl, Vec<Expr>, BTreeMap<String, A>)> {
        if read.range.is_some() || read.filter.is_some() || read.matching.is_some() || !read.seeks.is_empty() { return None; }
        let normalized = super::super::mixed_keys::read(info, read, self.catalog).ok()?.into_owned();
        let mut binder = self.clone();
        let (bound, index, _) = binder.select_index(info, &normalized, ReadMode::FilteredPoint, &mut setup::Body::default()).ok()?;
        let index = info.indexes.iter().find(|candidate| candidate.name == index.name)?;
        let named = normalized.keys.iter().all(|key| key.column.is_some());
        let parts = normalized.keys.iter().enumerate().map(|(at, part)| {
            Some((part.column.clone().or_else(|| index.columns.get(at).cloned())?, part.value.clone()))
        }).collect::<Option<BTreeMap<_,_>>>()?;
        let key = index.columns.iter().enumerate().map(|(at,column)| {
            bound.iter().enumerate().find_map(|(position,(name,value,_))|
                (if named { name.as_ref() == Some(column) } else { position == at }).then_some(value.clone()))
        }).collect::<Option<Vec<_>>>()?;
        Some((index,key,parts))
    }
}
