//! Job viewer scopes and calls to the same declared queries used by clients.
use super::*;

pub(super) fn diagnostic(site: &Site, code: &str, message: &str, rewrite: &str) -> Diagnostic {
    Diagnostic::new(site, code, message, rewrite).guide("jobs")
}
pub(super) fn read_only(site: &Site) -> Diagnostic {
    diagnostic(site, "E_JOB_VIEWER_READ_ONLY", "as is read-only: writes, emits, new ids and once asset consumption have side effects", "compute inside as; act outside the block")
}

impl Binder<'_> {
    // @ref LLP 3000.007#21.12 — viewer scopes are read-only, under the job's transaction and meter.
    pub(super) fn as_viewer(&mut self, principal: &A, body: &[S], site: &Site, out: &mut setup::Body) -> Fallible<()> {
        if self.caller_kind != ProgramKind::Job || self.in_prelude || self.loops + self.caller_loops == 0 || self.viewer_depth.is_some() {
            return Err(diagnostic(site, "E_JOB_VIEWER_CONTEXT", "as belongs inside a job sweep and cannot nest", "put as recipient.principal: inside for recipient in recipients:"));
        }
        let (value, ty) = self.expr(principal, out)?;
        if !matches!(ty, Ty::Principal) && !matches!(principal, A::Literal { value: Literal::Str(s), .. } if snapback4_core::value::identity_fits(s) && s != snapback4_core::SYSTEM_PRINCIPAL) {
            return Err(diagnostic(principal.site(), "E_JOB_VIEWER_PRINCIPAL", "as requires a present non-system principal", "use a principal column or argument; keep intentional system reads outside as"));
        }
        let loops = self.loops;
        self.loops = 0;
        self.caller_loops += loops;
        self.clear_authority_refinements();
        self.viewer_depth = Some(self.depth);
        let mut code = setup::Body::default();
        let result = self.block(body, &mut code, false);
        self.clear_authority_refinements();
        self.viewer_depth = None;
        self.loops = loops;
        self.caller_loops -= loops;
        result?;
        out.push(Stmt::Let { name: self.temp("as"), value: Expr::Builtin { builtin: Builtin::JobAs, args: vec![value, Expr::Block { body: code.code, value: Box::new(ir::lit(Value::Null)) }] } });
        Ok(())
    }

    // @ref LLP 3000.007#21.12 — calls are reevaluated under the new viewer,
    // including implicit/transitive helper dependencies. Snapshot fields stay
    // valid. Conservatively discard all call facts at both authority edges.
    fn clear_authority_refinements(&mut self) {
        self.call_types.clear();
        for scope in &mut self.scopes {
            for binding in scope.values_mut() {
                binding.fields.retain(|path, _| path.first().is_none_or(|part| part != "$pureCall"));
            }
        }
    }

    pub(super) fn job_query_call(&mut self, name: &str, args: &[A], site: &Site, out: &mut setup::Body) -> Option<Fallible<(Expr, Ty)>> {
        if self.viewer_depth.is_none() || self.catalog.functions.contains_key(name) { return None; }
        let all = name == "$jobAll" && self.viewer_depth.is_some();
        let (name, args) = if all {
            match args { [A::Call { name, args, .. }] => (name.as_str(), args.as_slice()), _ => return Some(Err(diagnostic(site, "E_JOB_VIEWER_QUERY", "all takes a declared paged query call", "for row in all(unreadPreview(periodStart, periodEnd, null)):"))) }
        } else { (name, args) };
        if name == "all" && self.viewer_depth.is_some() { return Some(Err(diagnostic(site, "E_JOB_VIEWER_QUERY", "all is a streaming for domain", "for row in all(queryName(..., null)):"))); }
        if self.viewer_depth.is_some() && matches!(name, "consume" | "consumeOnce") { return Some(Err(read_only(site))); }
        let caller_module = std::path::Path::new(&site.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        let (module, decl) = self.catalog.documents.iter().find_map(|doc| {
            let module = std::path::Path::new(&doc.file).file_stem()?.to_str()?;
            doc.programs.iter().find(|decl| super::super::operation_name(module, &decl.name) == name || module == caller_module && decl.name == name).map(|decl| (module.to_owned(), decl.clone()))
        })?;
        Some((|| {
            if self.viewer_depth.is_none() || decl.kind != ProgramKind::Query || decl.native || decl.held {
                return Err(diagnostic(site, "E_JOB_VIEWER_QUERY", "only declared Quarry queries may be called inside a job as block", "compute with a query inside as; call mutations, actions and native operations outside it"));
            }
            let mut diagnostics = Vec::new();
            let query = Binder::bind(self.catalog, self.schema, &module, &decl, &mut diagnostics)
                .ok_or_else(|| diagnostics.into_iter().next().unwrap_or_else(|| diagnostic(site, "E_JOB_VIEWER_QUERY", "query could not be bound", "fix the declared query first")))?;
            if snapback4_core::ir::read_sites(&query.program).iter().any(|read| self.schema.table(&read.table).is_some_and(|table| table.ephemeral.is_some())) {
                return Err(diagnostic(site, "E_JOB_VIEWER_QUERY", "job viewer queries read durable data", "keep ephemeral reads in a client query; persist the state the job needs"));
            }
            if args.len() != query.args.len() { return Err(type_error(site, format!("{name} takes {} arguments", query.args.len()), "pass the same positional arguments as the declared query, including its cursor")); }
            let mut fields = BTreeMap::new();
            for ((name, expected), given) in query.args.iter().zip(args) {
                let (value, ty) = if expected.required().is_identity() { self.expr_as_identity(given, out, expected)? } else { self.expr(given, out)? };
                if !ty.assignable_to(expected) { return Err(type_error(given.site(), format!("{name} requires {}, got {}", expected.name(), ty.name()), "pass the query's declared argument type")); }
                fields.insert(name.clone(), value);
            }
            let cursors: Vec<_> = query.args.iter().filter(|(_, ty)| ty.required() == Ty::Cursor).map(|(name, _)| name.clone()).collect();
            let cursor = (cursors.len() == 1).then(|| cursors[0].clone());
            let ty = if all {
                let Some((item, _)) = query.result.sequence() else { return Err(diagnostic(site, "E_JOB_VIEWER_QUERY", "all needs a query returning a row list", "return the paged list from the query")); };
                if cursor.is_none() || snapback4_core::engine::drain_cursor(&query.program) != cursor { return Err(diagnostic(site, "E_JOB_VIEWER_QUERY", "all needs one cursor argument that owns the returned page", "declare c: cursor ? and return a page after c; start with null")); }
                Ty::List(Box::new(item), u32::MAX)
            } else { Ty::Object(BTreeMap::from([("data".into(), query.result), ("next".into(), Ty::Cursor.optional())])) };
            Ok((Expr::Builtin { builtin: Builtin::JobQuery { program: Box::new(query.program), cursor, all }, args: vec![Expr::Object(fields)] }, ty))
        })())
    }
}
