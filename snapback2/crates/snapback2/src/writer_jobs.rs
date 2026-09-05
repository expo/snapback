use super::*;
use snapback2_core::OperatorId;

// @ref LLP 1016#d3--the-driver — a background turn after eight client turns at most, or whenever the queue is empty; idle jobs never sleep for recv_timeout.
pub(super) fn drive(state: &mut State, rx: Receiver<Request>) {
    let mut pending = None;
    let mut clients = 0_u8;
    loop {
        let preparation = state
            .sweep_assets_if_due()
            .and_then(|()| state.sweep_expired_sessions())
            .and_then(|()| state.auth_poll_timeout())
            .and_then(|timeout| {
                let runnable = state
                    .runtime()
                    .store()
                    .job_head()
                    .map_err(|e| Refusal::from_runtime(&e))?
                    .is_some();
                Ok(if runnable {
                    Duration::ZERO
                } else {
                    timeout
                        .min(state.asset_poll_timeout())
                        .min(state.timer_poll_timeout()?)
                })
            });
        let timeout = match preparation {
            Ok(t) => t,
            Err(e) => {
                fail(state, e);
                break;
            }
        };
        let request = match pending.take() {
            Some(r) => Ok(r),
            None => rx.recv_timeout(timeout),
        };
        match request {
            Ok(request) => {
                let result = state
                    .sweep_expired_sessions()
                    .and_then(|()| state.handle(request.action));
                let _ = request.reply.send(result);
                if state.stop.load(AtomicOrdering::SeqCst) {
                    break;
                }
                clients = clients.saturating_add(1);
                match rx.try_recv() {
                    Ok(request) => pending = Some(request),
                    Err(mpsc::TryRecvError::Disconnected) => break,
                    Err(mpsc::TryRecvError::Empty) => {}
                }
                if pending.is_some() && clients < 8 {
                    continue;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if let Err(e) = state.background_turn() {
            fail(state, e);
            break;
        }
        clients = 0;
    }
}
fn fail(state: &mut State, refusal: Refusal) {
    crate::watch::log(
        &state.root,
        json!({"exited":"background turn failed","refusal":refusal}),
    );
    state.stop.store(true, AtomicOrdering::SeqCst);
}
impl State {
    pub(super) fn background_turn(&mut self) -> Result<(), Refusal> {
        self.fire_due_timers_background_turn()?;
        if let Some(id) = self
            .runtime()
            .store()
            .job_head()
            .map_err(|e| Refusal::from_runtime(&e))?
        {
            let started = Instant::now();
            let now = self.now();
            let outcome = self
                .runtime_mut()
                .run_chunk_at(&id, now)
                .map_err(|e| Refusal::from_runtime(&e))?;
            // The commit alone, then the whole turn once live reruns are done (LLP 1016 §8).
            let commit_ms = started.elapsed().as_secs_f64() * 1000.0;
            if let Some(execution) = &outcome.execution {
                self.after_commit(execution.seq)?;
            }
            crate::watch::log(
                &self.root,
                json!({"kind":"job","job":id,"chunk":outcome.job.chunks,
                "state":outcome.job.state,"ms":started.elapsed().as_secs_f64()*1000.0,"commitMs":commit_ms,"refusal":outcome.job.last_error}),
            );
        }
        Ok(())
    }
    fn job_operator(&mut self, identity: Identity) -> Result<String, Refusal> {
        let Identity::Operator { by } = identity else {
            return Err(Refusal::operator_required());
        };
        self.require_operator(&by)?;
        Ok(by)
    }
    pub(super) fn jobs(&self) -> Result<Json, Refusal> {
        let rows = self
            .runtime()
            .store()
            .jobs(100)
            .map_err(|e| Refusal::from_runtime(&e))?;
        Ok(json!({"jobs":rows.iter().map(job_json).collect::<Vec<_>>(),"limit":100}))
    }
    pub(super) fn job(&self, id: &str, after: u64) -> Result<Json, Refusal> {
        let row = self
            .runtime()
            .job_record(id)
            .map_err(|e| Refusal::from_runtime(&e))?;
        let commits = self
            .runtime()
            .store()
            .job_commits(id, after, 500)
            .map_err(|e| Refusal::from_runtime(&e))?;
        let mut output = job_json(&row);
        // The original executable remains inspectable even when a successor parks it.
        if let Some(plan) = self
            .runtime()
            .store()
            .meta(&format!("job_plan:{}", row.program_hash))
            .map_err(|e| Refusal::from_runtime(&e))?
            && let Ok((_, cert)) =
                serde_json::from_str::<(Program, snapback2_core::Certificate)>(&plan)
        {
            output["sweeps"] = json!(cert.job.as_ref().map(|j| &j.sweeps));
        }
        let summary = self
            .runtime()
            .store()
            .job_commit_summary(id)
            .map_err(|e| Refusal::from_runtime(&e))?;
        for name in ["sweepChunks", "commitRange", "retainedChunks"] {
            output[name] = summary[name].clone();
        }
        output["commits"] = json!(commits);
        output["hasMoreCommits"] = json!(commits.len() == 500);
        Ok(output)
    }
    pub(super) fn job_control(
        &mut self,
        id: &str,
        resume: bool,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        let by = OperatorId(self.job_operator(identity)?);
        let now = self.now();
        let row = if resume {
            self.runtime_mut().resume_job_at(id, by, now)
        } else {
            self.runtime_mut().cancel_job_at(id, by, now)
        }
        .map_err(|e| Refusal::from_runtime(&e))?;
        let seq = self
            .runtime()
            .store()
            .commit_seq()
            .map_err(|e| Refusal::from_runtime(&e))?;
        self.after_commit(seq)?;
        Ok(job_json(&row))
    }
    pub(super) fn enqueue_job(
        &mut self,
        name: &str,
        args: Json,
        identity: Identity,
        plan: bool,
    ) -> Result<Json, Refusal> {
        let by = self.job_operator(identity)?;
        let (program, certificate) = self
            .runtime()
            .generation()
            .programs()
            .get(name)
            .cloned()
            .ok_or_else(|| {
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown job {name}"),
                    "use a job in /api/manifest",
                    "job",
                )
            })?;
        let values = job_args(&program, &args)?;
        if plan {
            return self
                .runtime()
                .plan_job(&program, &certificate, &values)
                .map_err(|e| Refusal::from_runtime(&e));
        }
        let now = self.now();
        let id = self
            .runtime_mut()
            .enqueue_job_at(name, values, OperatorId(by), now)
            .map_err(|e| Refusal::from_runtime(&e))?;
        let seq = self
            .runtime()
            .store()
            .commit_seq()
            .map_err(|e| Refusal::from_runtime(&e))?;
        self.after_commit(seq)?;
        let mut result = self.job(&id, 0)?;
        let counts = self
            .runtime()
            .store()
            .job_counts()
            .map_err(|e| Refusal::from_runtime(&e))?;
        result["queuePosition"] =
            json!(counts["queued"].as_u64().unwrap_or(0) + counts["running"].as_u64().unwrap_or(0));
        Ok(result)
    }
    pub(super) fn adhoc(
        &mut self,
        mut program: Program,
        source: String,
        args: Json,
        identity: Identity,
        plan: bool,
    ) -> Result<Json, Refusal> {
        let by = self.job_operator(identity)?;
        if source.len() > 65536 {
            return Err(adhoc_size());
        }
        let source_hash = snapback2_core::digest(&source);
        // Arguments are checked under the authored name so E_JOB_ARGS pastes the signature as written.
        let values = job_args(&program, &args)?;
        program.name = format!("adhoc:{source_hash}");
        let certificate = self
            .runtime()
            .certify_operator_program(&program)
            .map_err(|e| Refusal::from_runtime(&e))?;
        if plan {
            return self
                .runtime()
                .plan_job(&program, &certificate, &values)
                .map_err(|e| Refusal::from_runtime(&e));
        }
        let now = self.now();
        if program.kind == ProgramKind::Job {
            let id = self
                .runtime_mut()
                .enqueue_adhoc_job(&program, values, OperatorId(by), now, source)
                .map_err(|e| Refusal::from_runtime(&e))?;
            let seq = self
                .runtime()
                .store()
                .commit_seq()
                .map_err(|e| Refusal::from_runtime(&e))?;
            self.after_commit(seq)?;
            return self.job(&id, 0);
        }
        let execution = self
            .runtime_mut()
            .execute_adhoc_operator(&program, values, OperatorId(by.clone()), now)
            .map_err(|e| Refusal::from_runtime(&e))?;
        if matches!(execution.state, ExecutionState::Committed { .. }) {
            self.after_commit(execution.seq)?;
        } else {
            self.log_operator_read(&program.name, &by);
        }
        let mut response = writer_operator::operator_json(&execution);
        response["sourceHash"] = json!(source_hash);
        Ok(response)
    }
}
pub(super) fn job_args(program: &Program, args: &Json) -> Result<BTreeMap<String, Value>, Refusal> {
    writer_values::program_args(program, args).map_err(|e| {
        if program.kind == ProgramKind::Job {
            Refusal::new(
                "E_JOB_ARGS",
                "job",
                e.message,
                snapback2_core::jobs::quarry_signature(&program.name, &program.args),
                "job",
            )
            .with_site(&program.name)
        } else {
            e
        }
    })
}
fn job_json(row: &snapback2_core::jobs::JobRecord) -> Json {
    let mut json = json!(row);
    json.as_object_mut().unwrap().remove("source");
    json["sourceHash"] = json!(row.source.as_ref().map(snapback2_core::digest));
    json
}
pub(crate) fn adhoc_size() -> Refusal {
    Refusal::new(
        "E_ADHOC_SIZE",
        "operator",
        "ad hoc source exceeds 64 KiB",
        "declare it as a job",
        "job",
    )
    .with_site("run --file")
}
