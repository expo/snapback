//! Read-only job scopes reuse the ordinary server runner, on the chunk's rows.
use super::{Context, runner::{Runner, Flow}};
use crate::{RuntimeError, Value, ir::{Expr, Program, ProgramKind, Stmt}, value::object};
use std::collections::BTreeMap;

fn refusal(code: &'static str, message: &str) -> RuntimeError {
    RuntimeError::Structural { code, message: message.into() }
}

impl Runner<'_> {
    /// The server query door and job query calls share this execution path.
    pub(super) fn run_server_query(&mut self, program: &Program) -> Result<Value, RuntimeError> {
        #[cfg(feature = "server-search")]
        let search = (!self.context.is_system()).then(|| crate::search_plan::ordinary::plan(self.schema, program)).flatten();
        #[cfg(feature = "server-search")]
        let program = search.as_ref().map_or(program, |plan| &plan.program);
        #[cfg(feature = "server-search")]
        { self.ordinary_search_cursor = search.as_ref().map(|plan| plan.cursor_indexes.clone()); }
        self.run(program)
    }

    // @ref LLP 3000.007#21.12 — no authority cache crosses a viewer boundary.
    pub(super) fn job_as(&mut self, args: &[Expr]) -> Result<Value, RuntimeError> {
        if self.job_read_scope != 1 || args.len() != 2 {
            return Err(refusal("E_JOB_VIEWER_CONTEXT", "as requires a server job sweep; it cannot nest"));
        }
        if !super::read_only::expression::<false>(&args[1]) {
            return Err(refusal("E_JOB_VIEWER_READ_ONLY", "compute inside as; act outside the read-only block"));
        }
        let principal = self.expr(&args[0])?;
        let principal = match &principal { Value::Id(value) | Value::String(value) => value.as_str(), _ => "" };
        if principal == crate::SYSTEM_PRINCIPAL || !crate::value::identity_fits(principal) {
            return Err(refusal("E_JOB_VIEWER_PRINCIPAL", "as requires a present non-system principal; keep system reads outside as"));
        }
        let mut context = Context::new(principal, BTreeMap::new());
        context.now = self.context.now;
        context.read_time = self.context.now;
        context.generation = self.context.generation;
        context.presence = self.context.presence.clone();
        let mut child = self.job_read_child(context);
        child.env = std::mem::take(&mut self.env);
        child.consts = std::mem::take(&mut self.consts);
        let result = child.expr(&args[1]);
        let result = result.and_then(|value| child.job_read_available().map(|()| value));
        self.env = std::mem::take(&mut child.env);
        self.consts = std::mem::take(&mut child.consts);
        self.finish_job_read_child(child);
        result
    }

    fn job_read_available(&self) -> Result<(), RuntimeError> {
        if self.query_unavailable || self.page_overflow || self.value_source_incomplete || self.page_position_lost() || self.timeline_pending || self.word_cut_at.is_some() || self.meter.capped_at.is_some() {
            return Err(refusal("E_JOB_VIEWER_READ", "viewer read is unavailable or incomplete; narrow the query before computing a digest"));
        }
        Ok(())
    }

    fn job_query(&mut self, program: &Program, mut args: BTreeMap<String, Value>) -> Result<(Value, Option<String>), RuntimeError> {
        if self.job_read_scope != 2 || program.kind != ProgramKind::Query || program.native {
            return Err(refusal("E_JOB_VIEWER_QUERY", "call a declared Quarry query inside a job as block"));
        }
        if !super::read_only::statements::<false>(&program.body) {
            return Err(refusal("E_JOB_VIEWER_READ_ONLY", "compute inside as; act outside the read-only block"));
        }
        super::server_query_allowed(self.schema, &program.name).map_err(|error| refusal("E_JOB_VIEWER_QUERY", &error.message))?;
        super::validate::validate_inputs(self.schema, program, &mut args)?;
        let mut context = Context::new(&self.context.viewer, args);
        context.now = self.context.now;
        context.read_time = self.context.read_time;
        context.generation = self.context.generation;
        context.presence = self.context.presence.clone();
        let mark = self.meter.mark();
        let mut child = self.job_read_child(context);
        let result = (|| {
            let data = child.run_server_query(program)?;
            child.job_read_available()?;
            let next = child.outcome_next_cursor()?;
            // A non-uniform query deliberately withholds exhaustion. Never turn
            // that preview into an exact background total.
            if child.non_uniform { return Err(refusal("E_JOB_VIEWER_READ", "query does not certify exhaustion; use a uniformly authorized viewer query")); }
            Ok((data, next))
        })();
        self.finish_job_read_child(child);
        // The query frame has died; only its returned page and cursor survive.
        self.meter.release_heap(mark);
        if let Ok((data, next)) = &result { self.meter.heap(super::runner::expression_heap(&data) + next.as_ref().map_or(0, |s| s.len() as u64))?; }
        result
    }

    fn job_query_args(&mut self, args: &[Expr]) -> Result<BTreeMap<String, Value>, RuntimeError> {
        if args.len() != 1 { return Err(refusal("E_JOB_VIEWER_QUERY", "pass the declared query arguments")); }
        Ok(self.expr(&args[0])?.as_object()?.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
    }

    pub(super) fn job_query_value(&mut self, program: &Program, args: &[Expr]) -> Result<Value, RuntimeError> {
        let args = self.job_query_args(args)?;
        let (data, next) = self.job_query(program, args)?;
        Ok(object([("data", data), ("next", next.map(Value::String).unwrap_or(Value::Null))]))
    }

    // One page retained at a time; all examinations and rule work share the
    // chunk's ledger. An error leaves no partial effect or emission key.
    pub(super) fn job_query_rows(&mut self, program: &Program, cursor: Option<&str>, args: &[Expr], binding: &str, body: &[Stmt], site: &str) -> Result<Flow, RuntimeError> {
        let cursor = cursor.ok_or_else(|| refusal("E_JOB_VIEWER_QUERY", "all requires a query with one cursor argument"))?;
        let mut args = self.job_query_args(args)?;
        loop {
            self.meter.step(1)?;
            let (data, next) = self.job_query(program, args.clone())?;
            let page_bytes = super::runner::expression_heap(&data);
            let mark = self.meter.mark();
            let Value::Array(rows) = data else { return Err(refusal("E_JOB_VIEWER_QUERY", "all requires a query returning a row list")); };
            for row in rows {
                self.bind(binding, row);
                match self.statements(body, site)? {
                    Flow::Next | Flow::Continue => {},
                    Flow::Break => return Ok(Flow::Next),
                    flow @ Flow::Return(_) => return Ok(flow),
                }
            }
            self.env.remove(binding);
            self.meter.release_row_heap(mark, page_bytes);
            let Some(next) = next else { return Ok(Flow::Next); };
            let next = Value::String(next);
            if args.get(cursor) == Some(&next) { return Err(refusal("E_JOB_VIEWER_READ", "query cursor made no progress; narrow the query")); }
            args.insert(cursor.into(), next);
        }
    }
}
