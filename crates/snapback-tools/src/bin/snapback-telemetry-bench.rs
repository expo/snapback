//! Emit LLP 0154's reproducible Phase-1 benchmark evidence as JSON.
//!
//! @ref LLP 0154#d7--aggregates-a-watermarked-state-machine-mergeable-by-construction —
//!   the capacity gate covers amplification, burst/shedding, the physical cap,
//!   flush/sweep/query stalls, and application latency on versus off.

use snapback_tools::telemetry_bench::{Phase1BenchmarkConfig, run_phase1_benchmark};

fn main() -> anyhow::Result<()> {
    let smoke = std::env::args().any(|argument| argument == "--smoke");
    let config = if smoke {
        Phase1BenchmarkConfig::smoke()
    } else {
        Phase1BenchmarkConfig::full()
    };
    let report = run_phase1_benchmark(&config)?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
