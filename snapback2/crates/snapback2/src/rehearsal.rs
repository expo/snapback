//! An owner runtime with no service capabilities: only a private store and a pinned clock.
use crate::{
    protocol::{Refusal, value_to_json},
    writer_wire::execution_json,
};
use serde_json::{Value as Json, json};
use snapback2_core::{
    ExecutionState, Generation, OperatorId, Program, ProgramKind, Runtime, Store, Value,
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

#[cfg(test)]
#[path = "rehearsal_tests.rs"]
mod tests;

/// The receipt lists at most this many effects and this many releases; counts are exact.
const DETAIL_LIMIT: u32 = 100;

pub enum Target {
    Declared(String),
    Adhoc { program: Program, source: String },
}

/// A program the live runtime admitted — name, kind, certificate, and arguments —
/// before any copy exists, so a refusal never pauses the writer for a backup.
struct Admitted {
    program: Program,
    values: BTreeMap<String, Value>,
    source: Option<String>,
}

/// Captured on the writer, then moved to the requesting thread. There is no
/// live-store handle, blob handle, owner startup, listener, or runner to inherit.
pub struct Snapshot {
    directory: Scratch,
    generation: Generation,
    now: i64,
    seq: u64,
    started: Instant,
    admitted: Admitted,
    by: String,
}

struct Scratch(PathBuf);
impl Scratch {
    fn new(parent: &Path) -> Result<Self, Refusal> {
        fs::create_dir_all(parent).map_err(failed)?;
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(failed)?;
        let name = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let path = parent.join(name);
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).map_err(failed)?;
        Ok(Self(path))
    }
    fn discard(&self) -> Result<(), Refusal> {
        fs::remove_dir_all(&self.0).map_err(failed)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

impl Snapshot {
    // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — admission on the live runtime comes first, so only a program that would run costs the writer a copy; snapshot, generation and clock then share one writer boundary, and only the copy reserves rehearsal ids.
    pub fn capture(
        live: &Runtime,
        parent: &Path,
        now: i64,
        target: Target,
        args: &Json,
        by: String,
    ) -> Result<Self, Refusal> {
        let admitted = admit(live, target, args)?;
        let started = Instant::now();
        let directory = Scratch::new(parent)?;
        let seq = live.store().commit_seq().map_err(failed)?;
        live.store()
            .snapshot_rehearsal_to(&directory.0.join("store.sqlite"))
            .map_err(failed)?;
        Ok(Self {
            directory,
            generation: live.generation().clone(),
            now,
            seq,
            started,
            admitted,
            by,
        })
    }

    pub fn run(self) -> Result<Json, Refusal> {
        self.run_observed(|_| {})
    }

    /// `observe` sees the copy after the program ran and before the copy is discarded.
    pub fn run_observed(self, observe: impl FnOnce(&Runtime)) -> Result<Json, Refusal> {
        let store = Store::open(&self.directory.0.join("store.sqlite")).map_err(failed)?;
        store.observe_rehearsal_releases().map_err(failed)?;
        let runtime = Runtime::open(store, self.generation.clone()).map_err(failed)?;
        // This constructor deliberately cannot accept the live owner's service handles.
        let mut rehearsal = Rehearsal {
            runtime,
            now: self.now,
        };
        let started = Instant::now();
        let mut receipt = rehearsal.execute(self.admitted, self.by)?;
        receipt["executionMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
        let external = rehearsal
            .runtime
            .store()
            .rehearsal_side_effects(self.seq, DETAIL_LIMIT)
            .map_err(failed)?;
        receipt
            .as_object_mut()
            .unwrap()
            .extend(side_effects_json(&external).as_object().unwrap().clone());
        receipt["snapshotSeq"] = json!(self.seq);
        receipt["now"] = json!(self.now);
        observe(&rehearsal.runtime);
        drop(rehearsal); // Close SQLite (including WAL/SHM) before discarding every copy file.
        self.directory.discard()?;
        receipt["copyDiscarded"] = json!(true);
        receipt["elapsedMs"] = json!(self.started.elapsed().as_secs_f64() * 1000.0);
        Ok(receipt)
    }
}

/// The same admission as the live seat: the declared program must exist, an ad hoc
/// program must certify against the live generation (effect targets included), and
/// the arguments must type under the authored name so `E_JOB_ARGS` pastes the signature.
fn admit(live: &Runtime, target: Target, args: &Json) -> Result<Admitted, Refusal> {
    match target {
        Target::Declared(name) => {
            let program = live
                .generation()
                .programs()
                .get(&name)
                .map(|(p, _)| p.clone())
                .ok_or_else(|| {
                    Refusal::from_runtime(&snapback2_core::RuntimeError::OpUnknown(name.clone()))
                })?;
            let values = crate::writer::rehearsal_args(&program, args)?;
            Ok(Admitted {
                program,
                values,
                source: None,
            })
        }
        Target::Adhoc {
            mut program,
            source,
        } => {
            let values = crate::writer::rehearsal_args(&program, args)?;
            program.name = format!("adhoc:{}", snapback2_core::digest(&source));
            live.certify_operator_program(&program)
                .map_err(|e| Refusal::from_runtime(&e).with_site(&program.name))?;
            Ok(Admitted {
                program,
                values,
                source: Some(source),
            })
        }
    }
}

struct Rehearsal {
    runtime: Runtime,
    now: i64,
}
impl Rehearsal {
    fn execute(&mut self, admitted: Admitted, by: String) -> Result<Json, Refusal> {
        let mut receipt = json!({
            "dryRun": true, "state": "done", "op": admitted.program.name, "kind": admitted.program.kind,
            "rowsWritten": {}, "chunks": 0, "refusals": [],
        });
        if let Some(source) = &admitted.source {
            receipt["sourceHash"] = json!(snapback2_core::digest(source));
        }
        let outcome = self.execute_inner(admitted, by, &mut receipt);
        if let Err(refusal) = outcome {
            // Engine/infrastructure failures mean the rehearsal itself failed. A program
            // the copy would not start is a successful observation, with all prior
            // committed chunks kept.
            if matches!(
                refusal.code.as_str(),
                "E_SQL" | "E_SERIALIZATION" | "E_REHEARSAL"
            ) || refusal.code.starts_with("E_STORE")
            {
                return Err(failed(refusal.message));
            }
            receipt["state"] = json!("refused");
            receipt["refusals"] = json!([refusal]);
        }
        Ok(receipt)
    }

    fn execute_inner(
        &mut self,
        admitted: Admitted,
        by: String,
        receipt: &mut Json,
    ) -> Result<(), Refusal> {
        let Admitted {
            program,
            values,
            source,
        } = admitted;
        if program.kind == ProgramKind::Job {
            let id = match source {
                Some(source) => self.runtime.enqueue_adhoc_job(
                    &program,
                    values,
                    OperatorId(by),
                    self.now,
                    source,
                ),
                None => {
                    self.runtime
                        .enqueue_job_at(&program.name, values, OperatorId(by), self.now)
                }
            }
            .map_err(|e| Refusal::from_runtime(&e).with_site(&program.name))?;
            receipt["job"] = json!(id);
            loop {
                // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — the same certified chunk driver, in-process, with one pinned clock and no background turns.
                let outcome = self
                    .runtime
                    .run_chunk_at(&id, self.now)
                    .map_err(|e| Refusal::from_runtime(&e).with_site(&program.name))?;
                receipt["chunks"] = json!(outcome.job.chunks);
                receipt["rowsWritten"] = json!(outcome.job.rows_written);
                if let Some(error) = outcome.job.last_error {
                    receipt["state"] = json!("parked");
                    receipt["refusals"] = json!([error]);
                    return Ok(());
                }
                if outcome.job.state == "done" {
                    break;
                }
            }
        } else {
            let execution = match source {
                Some(_) => {
                    self.runtime
                        .execute_adhoc_operator(&program, values, OperatorId(by), self.now)
                }
                None => self.runtime.execute_operator_at(
                    &program.name,
                    values,
                    OperatorId(by),
                    self.now,
                ),
            }
            .map_err(|e| Refusal::from_runtime(&e).with_site(&program.name))?;
            let result = execution_json(&execution);
            if matches!(execution.state, ExecutionState::Committed { .. }) {
                receipt["rowsWritten"] = json!(execution.trace.writes);
            }
            if matches!(execution.state, ExecutionState::Rejected { .. }) {
                let mut refusal = result.clone();
                refusal["site"] = json!(program.name);
                receipt["refusals"] = json!([refusal]);
                receipt["state"] = json!("rejected");
            }
            receipt["result"] = result;
        }
        Ok(())
    }
}

/// Effects as the runner would deliver them: `payloadBytes` measures the JSON an
/// effect receives (`effects.rs` claims rows through `value_to_json`), not the ledger's encoding.
fn side_effects_json(external: &snapback2_core::RehearsalSideEffects) -> Json {
    let effects = external
        .effects
        .iter()
        .map(|e| {
            json!({
                "effect": e.effect, "payloadBytes": value_to_json(&e.payload).to_string().len(),
            })
        })
        .collect::<Vec<_>>();
    let assets = external
        .assets_released
        .iter()
        .map(|a| {
            json!({
                "id": a.id, "bytes": a.bytes, "table": a.table, "row": a.row, "column": a.column,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "effects": effects, "effectCount": external.effect_count,
        "effectsTruncated": external.effect_count > u64::from(DETAIL_LIMIT),
        "assetsReleased": assets, "assetReleaseCount": external.asset_release_count,
        "assetsTruncated": external.asset_release_count > u64::from(DETAIL_LIMIT),
        "detailLimit": DETAIL_LIMIT,
    })
}

/// The rehearsal itself failed — snapshot, open, an engine or store fault while the
/// program ran, or discard. A program refusal inside a rehearsal is a receipt, not this.
pub fn failed(error: impl std::fmt::Display) -> Refusal {
    Refusal::new(
        "E_REHEARSAL",
        "operator",
        format!("rehearsal could not complete: {error}"),
        "check free disk space and the owner's store, then retry --dry-run",
        "job",
    )
    .with_site("run --dry-run")
}
