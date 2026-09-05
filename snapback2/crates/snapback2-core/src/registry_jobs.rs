use super::*;
use crate::jobs::{ChunkOutcome, JobRecord, JobRefusal};
use crate::store_jobs::{bound_hash, decode, encode, save};

impl Runtime {
    pub fn enqueue_job(
        &mut self,
        name: &str,
        args: BTreeMap<String, Value>,
        by: OperatorId,
    ) -> Result<String, RuntimeError> {
        self.enqueue_job_at(name, args, by, unix_millis())
    }
    pub fn enqueue_job_at(
        &mut self,
        name: &str,
        args: BTreeMap<String, Value>,
        by: OperatorId,
        now: i64,
    ) -> Result<String, RuntimeError> {
        let (program, certificate) = self
            .generation
            .programs
            .get(name)
            .cloned()
            .ok_or_else(|| RuntimeError::OpUnknown(name.into()))?;
        self.enqueue_certified_job(&program, &certificate, args, by, now, None)
    }
    pub fn enqueue_adhoc_job(
        &mut self,
        program: &Program,
        args: BTreeMap<String, Value>,
        by: OperatorId,
        now: i64,
        source: String,
    ) -> Result<String, RuntimeError> {
        let certificate = self.certify_operator_program(program)?;
        self.enqueue_certified_job(program, &certificate, args, by, now, Some(source))
    }
    fn enqueue_certified_job(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        args: BTreeMap<String, Value>,
        by: OperatorId,
        now: i64,
        source: Option<String>,
    ) -> Result<String, RuntimeError> {
        if program.kind != ProgramKind::Job {
            return Err(RuntimeError::Input(
                "enqueue requires a job declaration".into(),
            ));
        }
        if args.keys().any(|name| !program.args.contains_key(name)) {
            return Err(RuntimeError::Job(Box::new(JobRefusal::args(
                &program.name,
                &program.args,
                "unknown job arguments",
            ))));
        }
        crate::engine::validate_inputs(&self.generation.schema, program, &args).map_err(|e| {
            RuntimeError::Job(Box::new(JobRefusal::args(
                &program.name,
                &program.args,
                e.to_string(),
            )))
        })?;
        let id = format!(
            "job_{}",
            self.reserve_new_ids()?
                .pop_front()
                .ok_or_else(|| RuntimeError::Input("no job id available".into()))?
        );
        let tx = self.engine.store_mut().conn.transaction()?;
        let row = crate::store_jobs::enqueue(
            &tx,
            &self.generation.schema,
            program,
            certificate,
            args,
            id.clone(),
            by.0,
            now,
            source,
        )?;
        crate::store_jobs::audit_control(&tx, &row, "enqueue", &row.enqueued_by)?;
        tx.commit()?;
        Ok(id)
    }
    pub fn run_chunk(&mut self, id: &str) -> Result<ChunkOutcome, RuntimeError> {
        self.run_chunk_at(id, unix_millis())
    }
    // @ref LLP 1016#d3--the-driver — a chunk that cannot run parks the job with its envelope; the owner keeps serving. Only a store fault while parking propagates.
    pub fn run_chunk_at(&mut self, id: &str, now: i64) -> Result<ChunkOutcome, RuntimeError> {
        let row = self.job_record(id)?;
        if !matches!(row.state.as_str(), "queued" | "running") {
            return Ok(ChunkOutcome {
                job: row,
                execution: None,
            });
        }
        let site = format!("{}:chunk:{}", row.name, row.sweep);
        let (program, certificate) = match self.job_program(&row) {
            Ok(pair) => pair,
            Err(error) => {
                // The executable is not the one the row bound: a changed or missing declaration,
                // a plan that no longer decodes, or an ad hoc program the live generation refuses.
                let refusal = match error {
                    RuntimeError::Job(refusal) => *refusal,
                    other => {
                        let mut refusal = JobRefusal::generation(&row.name);
                        refusal.message = format!("{}: {other}", refusal.message);
                        refusal
                    }
                };
                return self.park(row, refusal, now);
            }
        };
        let ids = self.reserve_new_ids()?;
        match self
            .engine
            .execute_job_chunk(&program, &certificate, row.clone(), now, ids)
        {
            Ok(outcome) => Ok(outcome),
            // The failed transaction has already rolled back. Parking preserves its old cursor.
            Err(error) => self.park(row, JobRefusal::rejected(&error, &site), now),
        }
    }
    fn park(
        &mut self,
        mut row: JobRecord,
        refusal: JobRefusal,
        now: i64,
    ) -> Result<ChunkOutcome, RuntimeError> {
        let refusal = refusal.with_job(&row.id, row.sweep, row.chunks + 1);
        row.state = "parked".into();
        row.last_error = Some(refusal);
        row.updated_at = now;
        let tx = self.engine.store_mut().conn.transaction()?;
        save(&tx, &row)?;
        tx.commit()?;
        Ok(ChunkOutcome {
            job: row,
            execution: None,
        })
    }
    pub fn cancel_job(&mut self, id: &str) -> Result<JobRecord, RuntimeError> {
        let by = self.job_record(id)?.enqueued_by;
        self.cancel_job_at(id, OperatorId(by), unix_millis())
    }
    pub fn cancel_job_at(
        &mut self,
        id: &str,
        by: OperatorId,
        now: i64,
    ) -> Result<JobRecord, RuntimeError> {
        let mut row = self.job_record(id)?;
        if !matches!(row.state.as_str(), "queued" | "running" | "parked") {
            return Err(RuntimeError::Job(Box::new(JobRefusal::state(
                id,
                &row.state,
                "cancel",
                "queued, running, or parked",
            ))));
        }
        row.state = "cancelled".into();
        row.updated_at = now;
        row.finished_at = Some(now);
        let tx = self.engine.store_mut().conn.transaction()?;
        save(&tx, &row)?;
        crate::store_jobs::audit_control(&tx, &row, "cancel", &by.0)?;
        tx.commit()?;
        Ok(row)
    }
    pub fn resume_job(&mut self, id: &str) -> Result<JobRecord, RuntimeError> {
        let by = self.job_record(id)?.enqueued_by;
        self.resume_job_at(id, OperatorId(by), unix_millis())
    }
    pub fn resume_job_at(
        &mut self,
        id: &str,
        by: OperatorId,
        now: i64,
    ) -> Result<JobRecord, RuntimeError> {
        let mut row = self.job_record(id)?;
        if row.state != "parked" {
            return Err(RuntimeError::Job(Box::new(JobRefusal::state(
                id, &row.state, "resume", "parked",
            ))));
        }
        let pair = self.job_program(&row)?;
        row.state = "queued".into();
        row.last_error = None;
        row.updated_at = now;
        row.generation = self.generation.hash();
        let tx = self.engine.store_mut().conn.transaction()?;
        if row.source.is_some() {
            tx.execute(
                "INSERT OR REPLACE INTO _meta(key,value) VALUES (?1,?2)",
                rusqlite::params![format!("job_plan:{}", row.program_hash), encode(&pair)?],
            )?;
        }
        save(&tx, &row)?;
        crate::store_jobs::audit_control(&tx, &row, "resume", &by.0)?;
        tx.commit()?;
        Ok(row)
    }
    pub fn job_record(&self, id: &str) -> Result<JobRecord, RuntimeError> {
        self.store()
            .job_get(id)?
            .ok_or_else(|| RuntimeError::Input(format!("unknown job {id}")))
    }
    pub fn job_program(&self, row: &JobRecord) -> Result<(Program, Certificate), RuntimeError> {
        let pair = if row.source.is_some() {
            let json = self
                .store()
                .meta(&format!("job_plan:{}", row.program_hash))?
                .ok_or_else(|| RuntimeError::Input("job executable missing".into()))?;
            let (program, stored): (Program, Certificate) = decode(&json)?;
            let cert = if stored.schema_hash == self.generation.hash() {
                stored
            } else {
                self.certify_operator_program(&program)?
            };
            (program, cert)
        } else {
            self.generation
                .programs
                .get(&row.name)
                .cloned()
                .ok_or_else(|| RuntimeError::Job(Box::new(JobRefusal::generation(&row.name))))?
        };
        if pair.0.kind != ProgramKind::Job
            || bound_hash(&pair.0, &pair.1, &self.generation.schema) != row.program_hash
        {
            return Err(RuntimeError::Job(Box::new(JobRefusal::generation(
                &row.name,
            ))));
        }
        Ok(pair)
    }
    /// Ad hoc admission uses the complete generation checker, including effect target binding.
    pub fn certify_operator_program(&self, program: &Program) -> Result<Certificate, RuntimeError> {
        let project = ProjectJson {
            version: 1,
            schema: self.generation.schema.clone(),
            auth: self.generation.schema.auth.clone(),
            programs: self
                .generation
                .programs
                .values()
                .filter(|(p, _)| p.name != program.name)
                .map(|(p, _)| p.clone())
                // Schedule bindings are certified programs outside the operation map.
                .chain(
                    self.generation
                        .timer_bindings
                        .values()
                        .map(|c| c.binding.clone()),
                )
                .chain(std::iter::once(program.clone()))
                .collect(),
            effects: self.generation.effects.values().cloned().collect(),
        };
        let admitted = Generation::certify(&project, Ceilings::default()).map_err(|errors| {
            RuntimeError::Schema(
                errors
                    .iter()
                    .map(|(_, e)| e.to_string())
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        })?;
        Ok(admitted.programs[&program.name].1.clone())
    }
    pub fn execute_adhoc_operator(
        &mut self,
        program: &Program,
        args: BTreeMap<String, Value>,
        by: OperatorId,
        now: i64,
    ) -> Result<Execution, RuntimeError> {
        let certificate = self.certify_operator_program(program)?;
        self.run_operator(program, &certificate, args, by, now)
    }
}

impl Runtime {
    pub fn plan_job(
        &self,
        program: &Program,
        certificate: &Certificate,
        args: &BTreeMap<String, Value>,
    ) -> Result<serde_json::Value, RuntimeError> {
        crate::engine::validate_inputs(&self.generation.schema, program, args).map_err(|e| {
            RuntimeError::Job(Box::new(JobRefusal::args(
                &program.name,
                &program.args,
                e.to_string(),
            )))
        })?;
        let job = certificate
            .job
            .as_ref()
            .ok_or_else(|| RuntimeError::Input("--plan requires a job".into()))?;
        let mut sweeps = Vec::new();
        for (sweep, ceiling) in job.sweeps.iter().zip(&job.per_chunk) {
            let prefix = sweep
                .prefix_template
                .iter()
                .map(|expr| match expr {
                    Expr::Literal(v) => Ok(v.clone()),
                    Expr::Variable(name) => args
                        .get(name)
                        .cloned()
                        .ok_or_else(|| RuntimeError::Input(format!("missing job argument {name}"))),
                    _ => Err(RuntimeError::Input("invalid job prefix".into())),
                })
                .collect::<Result<Vec<_>, _>>()?;
            let entries = self
                .store()
                .index_entry_count(&sweep.table, &sweep.index, &prefix)?;
            sweeps.push(serde_json::json!({"table":sweep.table,"index":sweep.index,"prefixTemplate":sweep.prefix_template,"prefix":prefix,
                "take":sweep.take,"entries":entries,"impliedChunks":entries.div_ceil(u64::from(sweep.take)).max(1),"ceilings":ceiling}));
        }
        Ok(
            serde_json::json!({"kind":"job","name":program.name,"programHash":bound_hash(program,certificate,&self.generation.schema),"sweeps":sweeps,"chunks":"unbounded","engineWrites":["_jobs"]}),
        )
    }
}
