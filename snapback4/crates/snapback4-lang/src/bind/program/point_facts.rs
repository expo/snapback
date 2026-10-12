//! Presence facts for identical point reads within one unchanged transaction state.
use super::*;
use std::collections::BTreeSet;
const POINT: &str = "$point";

impl Binder<'_> {
    // A compound condition cannot prove an earlier read after a later effect.
    // Unknown/table-reading helpers are conservative here; direct guards need none.
    pub(super) fn point_guard_safe(&self, value: &A) -> bool {
        match value {
            A::Name { .. } | A::Focal { .. } | A::Literal { .. } => true,
            A::Member { base, .. } | A::Unary { value: base, .. } | A::Assert { value: base, .. } => self.point_guard_safe(base),
            A::Binary { left, right, .. } => self.point_guard_safe(left) && self.point_guard_safe(right),
            A::Call { name, args, .. } => self.catalog.functions.get(name).is_none_or(|f| self.pure_functions.get(&f.name) == Some(&true))
                && args.iter().all(|a| self.point_guard_safe(a)),
            A::Read(read) | A::Exists { read, .. } => read.keys.iter().all(|k| self.point_guard_safe(&k.value)) && read.filter.is_none() && read.matching.is_none() && read.range.is_none(),
            _ => false,
        }
    }
    fn point_key(&self, read: &ReadExpr) -> Option<(Vec<String>, BTreeSet<String>)> {
        if read.range.is_some() || read.matching.is_some() || read.filter.is_some() || !read.seeks.is_empty() { return None; }
        let info = self.catalog.tables.get(&read.table)?;
        if info.maintained.is_some() || info.decl.ephemeral.is_some() { return None; }
        let mut binder = self.clone();
        let mut setup = setup::Body::default();
        let (bound, index, _) = binder.select_index(info, read, ReadMode::FilteredPoint, &mut setup).ok()?;
        // Exists over a nonunique key does not prove a point lookup.
        if !index.unique || bound.len() != index.columns.len() { return None; }
        let mut roots = BTreeSet::from([pure_calls::CONSTANTS.to_owned()]);
        let mut key = vec![POINT.into(), read.table.clone(), index.name];
        for part in &read.keys {
            key.push(format!("{:?}:{}", part.column, self.stable_value(&part.value, &mut roots)?.key()));
        }
        Some((key, roots))
    }
    // @ref LLP 3000.007#5.2 — key roots and the transaction-state anchor own
    // facts, so lexical joins, rebindings and loop fixed points invalidate them.
    pub(super) fn narrow_point(&mut self, read: &ReadExpr) {
        let Some((key, roots)) = self.point_key(read) else { return; };
        for root in roots {
            let Some(mut binding) = self.binding(&root).cloned() else { return; };
            binding.fields.insert(key.clone(), Ty::Bool);
            self.scopes.last_mut().unwrap().insert(root, binding);
        }
    }
    // @ref LLP 3000.013#14.7 — the runner buffers page domains before bodies.
    /// A row from a freshly read, wholly write-free table domain is an exact
    /// live point throughout the loop. Store it in the ordinary point-fact
    /// domain; buffered or writeful loops must establish a current witness.
    pub(super) fn narrow_fresh_row(&mut self, name: &str, ty: &Ty, site: &Site) {
        let Ty::Row(table) = ty.required() else { return };
        let value = A::Member {
            base: Box::new(A::Name { name: name.into(), site: site.clone() }),
            name: "id".into(),
            site: site.clone(),
        };
        self.narrow_point(&ReadExpr {
            cursor_prefix: None, computed: Default::default(), order_keys: Vec::new(), table,
            keys: vec![ast::KeyPart { column: None, value, site: site.clone() }], seeks: Vec::new(), filter: None,
            index: None, range: None, matching: None, site: site.clone(),
        });
    }
    pub(super) fn source_may_write(&self, body: &[S]) -> bool {
        let mut body = body.to_vec();
        let mut found = false;
        super::super::intent_walk::statements(&mut body, &mut |expr| match expr {
            A::Write { .. } => found = true,
            // Helpers and named shapes expand later. Declining to certify
            // them keeps freshness conservative without duplicating lowering's
            // recursive effect analysis here.
            A::Call { name, .. } if self.catalog.functions.contains_key(name) => found = true,
            A::ShapeUse { .. } => found = true,
            A::Shape { fields, .. } if fields.iter().any(|field| matches!(field, ast::ShapeField::NamedSpread { .. })) => found = true,
            _ => {}
        });
        found
    }
    pub(super) fn point_present(&self, read: &ReadExpr) -> bool {
        self.point_key(read).is_some_and(|(key, roots)| roots.iter().all(|root|
            self.binding(root).is_some_and(|binding| binding.fields.get(&key) == Some(&Ty::Bool))))
    }
    pub(super) fn invalidate_points(&mut self) {
        for scope in &mut self.scopes {
            for binding in scope.values_mut() {
                // A write invalidates these transaction facts, not the local's
                // value. Clear shadowed roots too, and keep assignment revisions
                // stable so a job sweep does not mistake a guard for an accumulator.
                binding.fields.retain(|key, _| key.first().is_none_or(|k| {
                    k != POINT && k != maintain_types::AUTHORIZATION
                }));
            }
        }
    }

    pub(super) fn parent_rewrite(&self, value: &A) -> Option<String> {
        let A::Member { base, name, .. } = value else { return None; };
        let A::Read(read) = base.as_ref() else { return None; };
        let info = self.catalog.tables.get(&read.table)?;
        let field = Ty::from_scalar(info.columns.get(name)?);
        if self.point_present(read) || field.is_optional() || info.maintained.is_some()
            || info.decl.columns.iter().any(|c| c.name == *name && c.written_by.is_some() && !c.readable_by_audience) { return None; }
        Some(format!("require exists {} else NOT_FOUND — a membership or required reference does not prove this row exists; alternatively bind {} ! else NOT_FOUND", print::read_expr(read), print::read_expr(read)))
    }
}

pub(super) fn writes(body: &[Stmt]) -> bool {
    ir::effects::Effects::writes_in(body)
}
