use super::index::encode_index_value;
use super::*;
use crate::jobs::{ChunkOutcome, JobRecord, upper_scan};
use crate::store_jobs::{bound_hash, save};

impl Engine {
    // @ref LLP 1016#d2--a-job-is-a-sequence-of-sweeps — the captured key, row writes, cursor, progress and job commit are one transaction.
    pub(crate) fn execute_job_chunk(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        mut job: JobRecord,
        now: i64,
        ids: VecDeque<String>,
    ) -> Result<ChunkOutcome, RuntimeError> {
        if program.kind != ProgramKind::Job
            || certificate.plan_hash != bound_hash(program, certificate, &self.schema)
            || certificate.schema_hash != self.schema.hash()
            || bound_hash(program, certificate, &self.schema) != job.program_hash
        {
            return Err(RuntimeError::TraceSubset(
                "job certificate identity mismatch".into(),
            ));
        }
        validate_inputs(&self.schema, program, &job.args)?;
        let job_certificate = certificate
            .job
            .as_ref()
            .ok_or_else(|| RuntimeError::Input("missing job certificate".into()))?;
        let chunk_certificate = job_certificate
            .per_chunk
            .get(job.sweep)
            .ok_or_else(|| RuntimeError::Input("job sweep out of range".into()))?;
        let Stmt::For {
            binding,
            domain: LoopDomain::Page(scan),
            body,
        } = &program.body[job.sweep]
        else {
            return Err(RuntimeError::Input("job needs a chunk".into()));
        };
        let Bound::Literal(take) = scan.take else {
            return Err(RuntimeError::Fanout);
        };
        let index = &self.schema.tables[&scan.table].indexes[&scan.index];
        let mut context = Context::system();
        context.connected = self.connected.clone();
        context.args = job.args.clone();
        context.now = Some(now);
        context.read_time = Some(now);
        context.new_ids = ids;
        context.operator_by = Some(job.enqueued_by.clone());
        let seq = self.store.commit_seq()?.saturating_add(1);
        let tx = self.store.conn.transaction()?;
        validate_asset_inputs(&tx, program, &context)?;
        let mut runner = Runner::new(
            &tx,
            &self.schema,
            chunk_certificate,
            context,
            &self.verdicts,
            &self.authority_absences,
            self.rule_authority,
            seq,
        );
        if job.upper_key.is_none() {
            let upper = runner.expr(&Expr::Scan(upper_scan(scan)))?;
            let Value::Array(rows) = upper else {
                return Err(RuntimeError::Input(
                    "job upper scan was not an array".into(),
                ));
            };
            job.upper_key = rows.first().map(|row| index_values(row, index));
        }
        let mut visited = Vec::new();
        if let Some(upper) = &job.upper_key {
            let mut page = scan.clone();
            page.after = job.cursor.as_ref().map(|key| {
                Box::new(Expr::Literal(Value::Array(
                    key[scan.prefix.len()..].to_vec(),
                )))
            });
            let Value::Array(rows) = runner.expr(&Expr::Scan(page))? else {
                return Err(RuntimeError::Input("job scan was not an array".into()));
            };
            let encoded_upper = upper
                .iter()
                .map(encode_index_value)
                .collect::<Result<Vec<_>, _>>()?;
            for row in rows {
                let key = index_values(&row, index);
                if key
                    .iter()
                    .map(encode_index_value)
                    .collect::<Result<Vec<_>, _>>()?
                    > encoded_upper
                {
                    break;
                }
                visited.push((key, row));
            }
        }
        // The bounded domain is materialized before any body runs, just like Stmt::For.
        let mut processed = 0;
        for (_, row) in &visited {
            runner.env.insert(binding.clone(), row.clone());
            processed += 1;
            match runner.statements(body)? {
                Flow::Next | Flow::Continue => {}
                Flow::Break | Flow::Return(..) => break,
            }
        }
        // Mutation control flow can finish this chunk early. Its cursor names only
        // the processed prefix, so prefetched but unvisited rows are never skipped.
        let page_finished = processed == visited.len();
        visited.truncate(processed);
        runner.check_final_constraints()?;
        runner.trace.writes.insert("_jobs".into(), 1);
        runner.assert_bounds()?;
        for (table, count) in &runner.trace.writes {
            if !table.starts_with('_') {
                *job.rows_written.entry(table.clone()).or_default() += count;
            }
        }
        job.chunks += 1;
        job.updated_at = now;
        job.state = "running".into();
        job.last_error = None;
        job.cursor = visited.last().map(|(key, _)| key.clone()).or(job.cursor);
        let exhausted = page_finished
            && (visited.len() < take as usize
                || job
                    .cursor
                    .as_ref()
                    .zip(job.upper_key.as_ref())
                    .is_some_and(|(a, b)| a == b));
        let progress = crate::jobs::ChunkRecord {
            sweep: job.sweep,
            chunk: job.chunks,
            cursor: job.cursor.clone(),
            rows_visited: visited.len(),
        };
        if exhausted {
            job.sweep += 1;
            job.cursor = None;
            job.upper_key = None;
            if job.sweep == job_certificate.sweeps.len() {
                job.state = "done".into();
                job.finished_at = Some(now);
            }
        }
        save(&tx, &job)?;
        let execution = Execution {
            result: Value::Null,
            result_provenance: ResultProvenance::None,
            trace: runner.trace,
            receipt: ClosureReceipt::default(),
            state: ExecutionState::Committed { seq },
            seq,
            next: None,
        };
        append_commit(
            &tx,
            &CommitRecord {
                seq,
                at: now,
                program: program.name.clone(),
                principal: crate::SYSTEM_PRINCIPAL_ID.to_owned(),
                kind: "job".into(),
                by: Some(job.enqueued_by.clone()),
                job: Some(job.id.clone()),
                job_chunk: Some(progress),
                schedule: None,
                touched: execution.trace.touched.clone(),
                writes: execution.trace.writes.clone(),
                emits: execution.trace.emits.len() as u64,
            },
        )?;
        tx.commit()?;
        Ok(ChunkOutcome {
            job,
            execution: Some(execution),
        })
    }
}

pub(crate) fn encode_job_key(value: &Value) -> Result<String, RuntimeError> {
    encode_index_value(value)
}
