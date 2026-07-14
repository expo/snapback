//! Run the LLP 0032 M1 benchmark harness at full scale and print a report.
//!
//! Usage (macOS): `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \`
//!   `cargo run --release --bin snapback-bench`
//!
//! `--json` prints the machine-readable report; otherwise a labelled summary.
//!
//! @ref LLP 0032#phase-4--measurement — M1.

use snapback::bench::{BenchConfig, run};

fn main() -> anyhow::Result<()> {
    let json = std::env::args().any(|arg| arg == "--json");
    let report = run(&BenchConfig::full())?;

    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    println!("Snapback local-target benchmarks (LLP 0032 M1)");
    println!("  iterations per compute metric: {}", report.iterations);
    println!();
    println!(
        "  per-invocation VM cost:            {:>10.1} µs   (create + eval, no data)",
        report.vm_cost_us
    );
    println!(
        "    of which VM creation:            {:>10.1} µs   ({:.0}% — what a warm VM avoids; rest is eval)",
        report.vm_create_us,
        100.0 * report.vm_create_us / report.vm_cost_us.max(1.0)
    );
    println!(
        "  warm-path invocation (DK-4):       {:>10.1} µs   (invoke IIFE + reset sweep; {:.1}x cheaper than fresh)",
        report.warm_invoke_us,
        report.vm_cost_us / report.warm_invoke_us.max(1.0)
    );
    println!(
        "  single-writer throughput:          {:>10.0} mut/s (serial commits under the global mutex)",
        report.single_writer_mutations_per_sec
    );
    println!(
        "  matcher cost (skip path):          {:>10.2} µs/sub  (evaluated, not affected)",
        report.matcher_skip_us_per_sub
    );
    println!(
        "  live fan-out cost (affected):      {:>10.2} µs/sub  (re-query + serialize + enqueue)",
        report.fanout_us_per_affected_sub
    );
    println!(
        "  fan-out ceiling @ 10 ms budget:    {:>10.0} affected subs/commit",
        report.fanout_ceiling_subs_at_10ms
    );
    println!(
        "  op-log delta cost (DK-3 proj.):    {:>10.2} µs/sub  (classify changes + serialize; no re-query)",
        report.fanout_delta_us_per_affected_sub
    );
    println!(
        "  delta fan-out ceiling @ 10 ms:     {:>10.0} affected subs/commit  (the DK-3 lever)",
        report.fanout_delta_ceiling_subs_at_10ms
    );
    println!(
        "  read-set validation cost:          {:>10.2} µs/dep",
        report.read_set_validation_us_per_dep
    );
    println!(
        "  spurious-conflict rate (disjoint): {:>10.2}       (table-granularity; E4 target = 0)",
        report.spurious_conflict_rate
    );
    println!(
        "  ephemeral publish throughput:      {:>10.0} pub/s ({:.2} µs/publish)",
        report.ephemeral_publishes_per_sec, report.ephemeral_publish_us
    );
    println!(
        "  synchronized write hold (mutex):   {:>10.0} µs   (pre-L6 path: queues behind the writer)",
        report.read_during_write_via_lock_us
    );
    println!(
        "  synchronized write hold (lane):    {:>10.0} µs   (L6 read lane: pooled WAL reader, pinned snapshot)",
        report.read_during_write_via_read_lane_us
    );
    Ok(())
}
