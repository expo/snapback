//! External observation wrapper for the exact LLP 0162 pre-profile library.
//!
//! This isolated crate is copied into the reconstructed baseline worktree. It
//! does not change the three accepted product instrumentation paths; its own
//! source, lockfile, path dependency, and executable are provenance subjects.

use std::time::Duration;

use anyhow::bail;
use serde::Serialize;
use snapback::bench::{BenchConfig, BenchReport, IdleObservation, measure_idle, run};

const IDLE_SAMPLE_SECONDS: u64 = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Observation {
    protocol: &'static str,
    report: BenchReport,
    idle: IdleObservation,
}

fn main() -> anyhow::Result<()> {
    if cfg!(debug_assertions) {
        bail!("baseline observation worker must be a --release binary");
    }
    let report = run(&BenchConfig::agent_safe_step0())?;
    let idle = measure_idle(Duration::from_secs(IDLE_SAMPLE_SECONDS))?;
    println!(
        "{}",
        serde_json::to_string(&Observation {
            protocol: "agentSafeDormantBaselineWorkerV1",
            report,
            idle,
        })?
    );
    Ok(())
}
