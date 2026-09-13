// @ref LLP 1019#native-acquisition-restart — the native kernel bypasses only
// authored statement/replay machinery; rules, containment and write lifecycle remain.
use super::*;
use crate::acquisition::{self, AcquisitionAcknowledgement, AcquisitionEvent};

impl Engine {
    pub(super) fn acquisition_context(&self, program: &Program, certificate: &Certificate, context: &mut Context) -> Result<(), RuntimeError> {
        if self.rule_authority != RuleAuthority::StoreAuthoritative
            || !certificate.has_current_semantics() || certificate.plan_hash != digest(program)
            || certificate.schema_hash != self.hashes.schema {
            return Err(RuntimeError::TraceSubset("native acquisition certificate/authority mismatch".into()));
        }
        validate_inputs(&self.schema, program, &context.args)?;
        context.query_read_time(program, certificate)?;
        context.connected = self.connected.clone();
        Ok(())
    }

    pub(crate) fn acquire_page(&mut self, program: &Program, certificate: &Certificate, mut context: Context,
        content: &str, log: &str, after: Option<String>,
    ) -> Result<(Execution, Vec<AcquisitionEvent>, Option<String>, bool), RuntimeError> {
        self.acquisition_context(program, certificate, &mut context)?;
        let seq = self.store.commit_seq()?;
        let transaction = self.store.conn.transaction()?;
        let mut runner = Runner::new(&transaction, &self.schema, &self.hashes, certificate, context,
            &self.verdicts, &self.authority_absences, self.rule_authority, seq);
        runner.reuse_images = true;
        let values = runner.scan_tracked(&acquisition::scan(log))?;
        let mut events = Vec::with_capacity(values.len());
        let cursor = if let Some(last) = values.last() {
            Some(encode_cursor(&self.schema, &CursorPosition {
                table: log.into(), index: "byRecipient".into(), order: Order::Asc,
                suffix: vec![crate::CursorColumn { name: "seq".into(), kind: ColumnType::Int }, crate::CursorColumn { name: "id".into(), kind: ColumnType::Id }],
                values: vec![last.value.field("seq")?.clone(), last.value.field("id")?.clone()],
            }).map_err(|e| RuntimeError::Input(e.to_string()))?)
        } else { after };
        for tracked in values {
            // The private plan reserves six dispatch steps besides the point
            // helper: two statements, its result tuple, and field-key work.
            runner.step(6)?;
            let event = tracked.value;
            let id = event.field("id")?.as_str()?.to_owned();
            let row = event.field("row")?.as_str()?.to_owned();
            let disposition = if event.field("kind")?.as_str()? == "removed" { "removed" } else {
                let body = runner.expr(&acquisition::get(content, "byId", vec![Expr::Literal(event.field("row")?.clone())], format!("_acquire.{log}.body")))?;
                if body == Value::Null { "unavailable" } else { "present" }
            };
            events.push(AcquisitionEvent { id, row, disposition });
        }
        runner.assert_bounds()?;
        if runner.missing_authority { return Err(RuntimeError::TraceSubset("native acquisition lacks current authority".into())); }
        let exhausted = runner.trace.ranges.first().is_some_and(|range| range.stop == StopReason::Exhausted);
        let execution = Execution { result: Value::Null, result_provenance: ResultProvenance::None,
            trace: runner.trace, receipt: runner.receipt,
            state: if exhausted { ExecutionState::Complete } else { ExecutionState::Capped }, seq, next: None };
        transaction.commit()?;
        Ok((execution, events, cursor, exhausted))
    }

    pub(crate) fn acquire_receipts(&mut self, program: &Program, certificate: &Certificate, mut context: Context,
        content: &str, d: &crate::delivery::Deliver,
    ) -> Result<AcquisitionAcknowledgement, RuntimeError> {
        self.acquisition_context(program, certificate, &mut context)?;
        if crate::delivery::acknowledgement(&self.schema, program).is_none() {
            return Err(RuntimeError::TraceSubset("native receipt requires canonical acknowledgement".into()));
        }
        let principal = context.viewer().to_owned();
        let at = context.now.unwrap_or_else(unix_millis);
        let current_seq = self.store.commit_seq()?;
        let seq = current_seq.saturating_add(1);
        let certificate = self.custody_certificate(certificate, false)?;
        let transaction = self.store.conn.transaction()?;
        let mut runner = Runner::new(&transaction, &self.schema, &self.hashes, &certificate, context,
            &self.verdicts, &self.authority_absences, self.rule_authority, seq);
        runner.native_receipts(program, content, d)?;
        let changed = !runner.trace.writes.is_empty();
        let seq = if changed { seq } else { current_seq };
        let execution = Execution { result: Value::Null, result_provenance: ResultProvenance::None,
            trace: runner.trace, receipt: runner.receipt, state: ExecutionState::Committed { seq }, seq, next: None };
        let commit = if changed {
            let commit = CommitRecord { job: None, job_chunk: None, schedule: None,
                seq, at, program: program.name.clone(), principal, kind: "receipt".into(), by: None,
                touched: execution.trace.touched.clone(), scope_touches: execution.trace.scope_touches.clone(),
                writes: execution.trace.writes.clone(), emits: execution.trace.emits.len() as u64 };
            append_commit(&transaction, &commit)?;
            Some(commit)
        } else { None };
        transaction.commit()?;
        Ok(AcquisitionAcknowledgement { execution, commit })
    }
}

impl Runner<'_> {
    pub(super) fn native_receipts(&mut self, program: &Program, content: &str, d: &crate::delivery::Deliver) -> Result<(), RuntimeError> {
        // @ref LLP 1001#native-owner-image-pipeline — native commands retain
        // full authoritative evidence; only the unreturned client export is absent.
        self.reuse_images = true;
        self.export_receipt = false;
        let table = d.receipts_table().expect("canonical receipts declaration");
        self.acknowledgement = Some(table.clone());
        let events = self.context.args["events"].as_array()?.to_vec();
        for id in events {
            // Fixed native guards/field dispatch replace the larger generated
            // statement path; read, membership and write helpers charge apart.
            self.step(12)?;
            let event = self.expr(&acquisition::get(&d.log, "byId", vec![Expr::Literal(id)], format!("{}.event", program.name)))?;
            if event == Value::Null || event.field("kind")?.as_str()? == "removed" { continue; }
            let body = self.expr(&acquisition::get(content, "byId", vec![Expr::Literal(event.field("row")?.clone())], format!("{}.content", program.name)))?;
            require_present(&body)?;
            let receipt = self.expr(&acquisition::get(&table, "byRow", vec![Expr::Literal(event.field("row")?.clone()), Expr::Input(Input::Viewer)], format!("{}.receipt", program.name)))?;
            require_present(&receipt)?;
            let original = self.expr(&acquisition::get(&d.log, "byId", vec![Expr::Literal(receipt.field("id")?.clone())], format!("{}.original", program.name)))?;
            self.env.insert("original".into(), original);
            self.update(&table, receipt.field("id")?, object([("received", Value::Bool(true)), ("seq", Value::Int(self.seq as i64))]))?;
        }
        self.check_final_constraints()?;
        self.assert_bounds()?;
        if self.missing_authority { return Err(RuntimeError::TraceSubset("native receipt lacks current authority".into())); }
        Ok(())
    }
}

fn require_present(value: &Value) -> Result<(), RuntimeError> {
    if value == &Value::Null { Err(RuntimeError::Require { code: "E_RULE".into(), site: None }) } else { Ok(()) }
}
