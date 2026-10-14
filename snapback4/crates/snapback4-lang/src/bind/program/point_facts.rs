//! Presence facts for identical point reads across proved stable transaction states.
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

    // @ref LLP 3000.013#2.2 — post-write presence follows only a stable
    // point key and a read grant whose deciding state the write cannot change.
    pub(super) fn invalidate_after_write(&mut self, expr: &A) {
        let A::Write { op: WriteOp::Update, table, fields, .. } = expr else {
            self.invalidate_points(); return;
        };
        let Some(definition) = self.schema.table(table) else { self.invalidate_points(); return };
        let mut deciding = BTreeSet::new();
        definition.rules.read.fields(&mut deciding);
        let independent = self.row_independent_read_proved(table);
        let stable_read = independent || !fields.iter().any(|field| deciding.contains(&field.name));
        // Maintained columns and self-probes can change indirectly. Lifetimes
        // and through authority retain the conservative transaction barrier.
        let safe = self.ordinary_write_lifetime(table) && stable_read
            && definition.maintained.is_empty()
            && !rule_probes(&definition.rules.read, table)
            && rule_dependencies_stable(self.schema, &definition.rules.read);
        for scope in &mut self.scopes {
            for binding in scope.values_mut() {
                binding.fields.retain(|key, _| match key.first().map(String::as_str) {
                    Some(POINT) => safe && key.get(1) == Some(table) && key.get(2)
                        .and_then(|index| definition.index(index)).is_some_and(|index|
                            !fields.iter().any(|field| index.columns().contains(&field.name)
                                || key.iter().skip(3).any(|part| part.starts_with(&format!("Some({:?}):", field.name))))),
                    Some(maintain_types::AUTHORIZATION) => false,
                    _ => true,
                });
            }
        }
    }

    pub(super) fn ordinary_write_lifetime(&self, table: &str) -> bool {
        self.schema.table(table).is_some_and(|table| table.expire.is_none()
            && table.not_before.is_none() && table.through.is_none() && table.ephemeral.is_none())
    }

    pub(super) fn row_independent_read_proved(&self, table: &str) -> bool {
        let Some(info) = self.catalog.tables.get(table) else { return false };
        if self.schema.tables[table].rules.read.is_uniformly_readable() { return true; }
        let Some(rule) = info.decl.rules.iter().find(|rule| rule.effect == ast::Effect::Read) else { return false };
        fn proved(binder: &Binder<'_>, table: &str, value: &A) -> bool {
            if let A::Binary { op, left, right, .. } = value && op == "or" {
                return proved(binder, table, left) || proved(binder, table, right);
            }
            let mut value = value.clone();
            maintain_types::normalize_rule_constants(&mut value);
            let mut row_dependent = false;
            super::super::intent_walk::expression(&mut value, &mut |expr| {
                if matches!(expr, A::Focal { .. }) { row_dependent = true; }
                if let A::Call { name, .. } = expr && binder.catalog.functions.contains_key(name) {
                    row_dependent = true;
                }
                if let A::Read(read) | A::Exists { read, .. } | A::Created { read, .. } = expr {
                    row_dependent |= read.table == table || binder.catalog.tables.get(&read.table)
                        .is_none_or(|info| info.maintained.is_some())
                        || binder.schema.table(&read.table).is_none_or(|target| !target.maintained.is_empty() || target.through.is_some());
                }
            });
            !row_dependent && binder.point_guard_safe(&value) && binder.authorization_proved(&value, true)
        }
        proved(self, table, &rule.value)
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

fn rule_probes(rule: &snapback4_core::schema::RuleExpr, target: &str) -> bool {
    use snapback4_core::schema::RuleExpr;
    match rule {
        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => table == target,
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(|rule| rule_probes(rule, target)),
        RuleExpr::Not(rule) => rule_probes(rule, target),
        _ => false,
    }
}

fn rule_dependencies_stable(schema: &snapback4_core::schema::Schema, rule: &snapback4_core::schema::RuleExpr) -> bool {
    use snapback4_core::schema::RuleExpr;
    match rule {
        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => schema.table(table)
            .is_some_and(|target| target.maintained.is_empty() && target.through.is_none() && schema.maintain_for(table).is_none()),
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().all(|rule| rule_dependencies_stable(schema, rule)),
        RuleExpr::Not(rule) => rule_dependencies_stable(schema, rule),
        _ => true,
    }
}
