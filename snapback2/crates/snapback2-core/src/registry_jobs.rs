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
        let row = JobRecord {
            id: id.clone(),
            name: program.name.clone(),
            source,
            program_hash: bound_hash(program, certificate, &self.generation.schema),
            generation: self.generation.hash(),
            args,
            state: "queued".into(),
            sweep: 0,
            upper_key: None,
            cursor: None,
            chunks: 0,
            rows_written: BTreeMap::new(),
            enqueued_by: by.0,
            created_at: now,
            updated_at: now,
            finished_at: None,
            last_error: None,
        };
        let tx = self.engine.store_mut().conn.transaction()?;
        // Persist the already compiled executable; restart never compiles ad hoc source.
        tx.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES (?1,?2)",
            rusqlite::params![
                format!("job_plan:{}", row.program_hash),
                encode(&(program, certificate))?
            ],
        )?;
        save(&tx, &row)?;
        crate::store_jobs::audit_control(&tx, &row, "enqueue", &row.enqueued_by)?;
        tx.commit()?;
        Ok(id)
    }
    pub fn run_chunk(&mut self, id: &str) -> Result<ChunkOutcome, RuntimeError> {
        self.run_chunk_at(id, unix_millis())
    }
    pub fn run_chunk_at(&mut self, id: &str, now: i64) -> Result<ChunkOutcome, RuntimeError> {
        let row = self.job_record(id)?;
        if !matches!(row.state.as_str(), "queued" | "running") {
            return Ok(ChunkOutcome {
                job: row,
                execution: None,
            });
        }
        let (program, certificate) = self.job_program(&row)?;
        let ids = self.reserve_new_ids()?;
        match self
            .engine
            .execute_job_chunk(&program, &certificate, row.clone(), now, ids)
        {
            Ok(outcome) => Ok(outcome),
            Err(error) => {
                if crate::engine::mutation_rejection_code(&error).is_none() {
                    return Err(error);
                }
                // The failed transaction has already rolled back. Parking preserves its old cursor.
                let mut parked = row;
                let mut refusal = JobRefusal::new(
                    error.code(),
                    error.to_string(),
                    &format!("{}:chunk:{}", parked.name, parked.sweep),
                    "fix the refused data or constraint, then run --resume <job-id> --as system",
                );
                refusal.family = if error.code() == "E_CONSTRAINT" {
                    "constraint"
                } else if matches!(error.code(), "E_STEPS" | "E_FANOUT" | "E_TRACE_SUBSET") {
                    "bound"
                } else {
                    "input"
                }
                .into();
                parked.state = "parked".into();
                parked.last_error = Some(refusal);
                parked.updated_at = now;
                let tx = self.engine.store_mut().conn.transaction()?;
                save(&tx, &parked)?;
                tx.commit()?;
                Ok(ChunkOutcome {
                    job: parked,
                    execution: None,
                })
            }
        }
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
        if matches!(row.state.as_str(), "queued" | "running" | "parked") {
            row.state = "cancelled".into();
            row.updated_at = now;
            row.finished_at = Some(now);
            let tx = self.engine.store_mut().conn.transaction()?;
            save(&tx, &row)?;
            crate::store_jobs::audit_control(&tx, &row, "cancel", &by.0)?;
            tx.commit()?;
        }
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
            return Err(RuntimeError::Input(
                "only parked jobs can resume; cancellation is terminal".into(),
            ));
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
