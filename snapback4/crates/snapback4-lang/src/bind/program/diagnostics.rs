//! Explain a rejected explicit index in terms of the supplied names and types.
use super::*;

impl Binder<'_> {
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
            super::super::point_key::check(info, candidate, read, &arguments).is_ok();
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
            let mut point = read.clone();
            point.range = None;
            point.filter = None;
            point.seeks.clear();
            let point = print::read_expr(&point);
            let mut rewrite = if index.unique {
                if point_admitted(index) { format!("use {point} for one row") } else { String::new() }
            } else {
                format!("add id as the final column of {} to range over this prefix", index.name)
            };
            if self.kind == ProgramKind::Job {
                let take = read.range.as_ref().map_or(50, |range| range.take);
                let guard = index.columns.iter().zip(&read.keys).map(|(col, part)| format!("row.{} != {}", part.column.as_ref().unwrap_or(col), print::expression(&part.value))).collect::<Vec<_>>().join(" or ");
                if !rewrite.is_empty() { rewrite.push_str("; "); }
                rewrite.push_str(&format!("in a chunk, use `chunk row in {} first {take} by byId:` then `if {guard}: continue`", read.table));
            }
            return type_error(&read.site, format!("{label} pins every key, leaving no column to range over"), rewrite).guide("indexes");
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
        let rewrite = if let [alternative] = alternatives.as_slice() {
            let mut fixed = read.clone();
            fixed.index = Some(alternative.name.clone());
            let mut rewrite = format!("{} — this index accepts the supplied key", print::read_expr(&fixed));
            if let (Some(col), Some((_, _, ty))) = (index.columns.first(), keys.first()) {
                rewrite.push_str(&format!("; for {}, pass {} instead of {}", index.name, self.key_ty(info, index, col).name(), ty.name()));
            }
            rewrite
        } else if mode == ReadMode::Range {
            let columns = &index.columns[..index.columns.len().saturating_sub(1)];
            format!("{}[{}] first 50 by {} — supply {} in index order", read.table, columns.join(", "), index.name, columns.iter().map(|col| format!("{col}: {}", self.key_ty(info, index, col).name())).collect::<Vec<_>>().join(", "))
        } else { String::new() };
        type_error(&read.site, format!("{label} {reason}"), rewrite).guide("indexes")
    }
}
