//! Explain a rejected explicit index in terms of the supplied names and types.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.007#18.1 — valid unique orders normalize before binding;
    // other explicit indexes explain the column-ordered search alternative.
    pub(super) fn matching_nonwords_index(&self, info: &TableInfo, read: &ReadExpr, index: &ast::IndexDecl) -> Diagnostic {
        if index.is_plain() && index.unique {
            let prefix = &index.columns[..read.keys.len().min(index.columns.len())];
            let missing: Vec<_> = prefix.iter().filter(|column| !read.keys.iter().enumerate()
                .any(|(n, key)| key.column.as_ref().or_else(|| index.columns.get(n)) == Some(*column))).cloned().collect();
            let reason = if missing.is_empty() {
                format!("matching scope supplies {} keys for {} index columns", read.keys.len(), index.columns.len())
            } else {
                format!("matching scope keys must name its leading columns; missing leading column{}: {}", if missing.len() == 1 { "" } else { "s" }, missing.join(", "))
            };
            // Never turn a refused prefix into a scan of the unpinned complement.
            return Diagnostic::new(&read.site, "E_QUARRY_MATCHING_INDEX", format!("{}.{} is a plain unique index; {reason}", read.table, index.name), "");
        }
        let mut pinned: std::collections::BTreeSet<_> = read.keys.iter().enumerate()
            .filter_map(|(n, key)| key.column.as_ref().or_else(|| index.columns.get(n))).cloned().collect();
        let mut conjuncts = Vec::new();
        if let Some(predicate) = &read.filter { super::super::intent::split(*predicate.clone(), &mut conjuncts); }
        for predicate in conjuncts {
            if let Some((column, _)) = super::super::intent::equality(&predicate, info) { pinned.insert(column); }
        }
        let mut order: Vec<_> = index.columns.iter().filter(|column| !pinned.contains(*column)).cloned().collect();
        if order.is_empty() { order.push("id".into()); }
        let (reason, changes) = if index.is_plain() {
            ("is a plain index, not a words index; matching needs a words index. Order by columns so the planner builds the search index, or name a plain unique index with the desired order",
                vec![crate::repair::ReadChange::SearchOrder { keys: index.columns.clone(), order }])
        } else {
            ("has a computed key and no words key; matching needs a words index with the requested scope and order", Vec::new())
        };
        Diagnostic::new(&read.site, "E_QUARRY_MATCHING_INDEX", format!("{}.{} {reason}", read.table, index.name), "")
            .repair_read(&read.site, changes)
    }

    /// Names callers, not a proof that an arbitrary job's other work is legal.
    pub(super) fn helper_job_callers(&self, helper: &str) -> Vec<String> {
        fn calls(body: &mut [S]) -> Vec<String> {
            let mut names = Vec::new();
            super::super::intent_walk::statements(body, &mut |expr| {
                if let A::Call { name, .. } = expr { names.push(name.clone()); }
            });
            names
        }
        let mut callers = Vec::new();
        for doc in &self.catalog.documents {
            for job in doc.programs.iter().filter(|p| p.kind == ProgramKind::Job) {
                let mut pending = calls(&mut job.body.clone());
                pending.extend(calls(&mut job.prelude.clone()));
                let mut seen = std::collections::BTreeSet::new();
                while let Some(name) = pending.pop() {
                    if name == helper {
                        let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
                        callers.push(super::super::operation_name(module, &job.name));
                        break;
                    }
                    if !seen.insert(name.clone()) { continue; }
                    if let Some(function) = self.catalog.functions.get(&name) {
                        let mut body = match &function.body {
                            ast::FunctionBody::Block(body) => body.clone(),
                            ast::FunctionBody::Expression(value) => vec![S::Return { value: value.clone(), site: value.site().clone() }],
                        };
                        pending.extend(calls(&mut body));
                    }
                }
            }
        }
        callers
    }

    pub(super) fn index_mismatch(&self, info: &TableInfo, read: &ReadExpr, mode: ReadMode, keys: &[(Option<String>, Expr, Ty)], index: &ast::IndexDecl) -> Diagnostic {
        let expected = index.columns.iter().map(|col| format!("{col}: {}", self.key_ty(info, index, col).name())).collect::<Vec<_>>().join(", ");
        let supplied = read.keys.iter().zip(keys).map(|(part, (_, _, ty))| {
            let value = print::expression(&part.value);
            format!("{}{}: {}", part.column.as_ref().map_or(String::new(), |col| format!("{col} = ")), value, ty.name())
        }).collect::<Vec<_>>().join(", ");
        let label = format!("{}.{} takes ({expected}); supplied ({supplied})", read.table, index.name);
        let arguments = keys.iter().map(|(column, _, ty)|
            (column.as_deref(), !ty.is_optional() && *ty != Ty::Unknown)).collect::<Vec<_>>();
        let point_admitted = |candidate: &ast::IndexDecl|
            super::super::point_key::check(info, candidate, read, &arguments, false).is_ok();
        let accepts = |candidate: &ast::IndexDecl| {
            candidate.words.is_none() && match mode {
                ReadMode::Point | ReadMode::FilteredPoint => candidate.unique && candidate.columns.len() == keys.len(),
                ReadMode::Exists => candidate.columns.len() == keys.len(),
                ReadMode::Range => candidate.columns.len() > keys.len(),
            } && keys.iter().enumerate().all(|(i, (name, expr, ty))| {
                let col = name.as_ref().unwrap_or(&candidate.columns[i]);
                candidate.columns[..keys.len()].contains(col) && (ty.comparable(&self.key_ty(info, candidate, col)) || (self.key_ty(info, candidate, col).is_identity() && matches!(expr, Expr::Literal(Value::String(_)))))
            }) && (mode == ReadMode::Range || point_admitted(candidate))
        };
        let keys_match = keys.iter().enumerate().all(|(i, (name, expr, ty))| {
            let Some(col) = name.as_ref().or_else(|| index.columns.get(i)) else { return false; };
            index.columns.iter().take(keys.len()).any(|column| column == col)
                && (ty.comparable(&self.key_ty(info, index, col)) || (self.key_ty(info, index, col).is_identity() && matches!(expr, Expr::Literal(Value::String(_)))))
        });
        if mode == ReadMode::Range && keys.len() == index.columns.len() && keys_match {
            let mut guidance = if index.unique { "use a point for one row if its key arguments are admitted".to_owned() }
                else { format!("add id as the final column of {} to range over this prefix", index.name) };
            if self.kind == ProgramKind::Job {
                guidance.push_str("; for a job chunk, scan an ordered population and filter inside the chunk body");
            }
            let changes = if index.unique && point_admitted(index) { vec![crate::repair::ReadChange::Point] } else { Vec::new() };
            return type_error(&read.site, format!("{label} pins every key, leaving no column to range over; {guidance}"), "")
                .guide("indexes").repair_read(&read.site, changes);
        }
        let same_width = match mode {
            ReadMode::Range => keys.len() < index.columns.len(),
            _ => keys.len() == index.columns.len(),
        };
        let names_match = keys.iter().all(|(name, _, _)| name.as_ref().is_none_or(|name| index.columns.iter().take(keys.len()).any(|col| col == name)));
        let reason = if !same_width { "has the wrong number of keys" } else if !names_match { "names columns outside this index prefix" } else if mode != ReadMode::Range && !index.unique && mode != ReadMode::Exists { "cannot select one row because the index is not unique" } else { "has the wrong key type" };
        // Planner tokens cannot be pasted as an authored `by` name. Point
        // alternatives must also satisfy uniqueness and the current guards.
        let alternatives: Vec<_> = info.indexes.iter().filter(|candidate| candidate.name != index.name
            && !self.catalog.synthesized.contains(&(read.table.clone(), candidate.name.clone())) && accepts(candidate)).collect();
        let changes = if let [alternative] = alternatives.as_slice() {
            vec![crate::repair::ReadChange::Index(alternative.name.clone())]
        } else { Vec::new() };
        type_error(&read.site, format!("{label} {reason}; supply compatible arguments or select a matching index"), "")
            .guide("indexes").repair_read(&read.site, changes)
    }
}

// @ref LLP 3000.011.003.000#9 — hidden aggregate keys are nullable; choosing zero is explicit, never an automatic schema rewrite.
pub(super) fn write_rewrite(field: &ObjectField, expected: &Ty, got: &Ty) -> String {
    if let Ty::Optional(inner) = got {
        if matches!(inner.as_ref(), Ty::Int | Ty::Money(..) | Ty::Decimal(..)) && inner.writable_to(expected) {
            if let Some(value) = &field.value { return format!("{}: {} ?? 0 (only if your application treats a hidden/missing value as zero)", field.name, print::expression(value)); }
        }
    }
    format!("write {} into {}", expected.name(), field.name)
}
