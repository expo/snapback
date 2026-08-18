//! LLP 0162 row-13 evidence for the narrow `operating.instance-forks` claim,
//! scoped by the 2026-08-05 author ruling to fork lifecycle metrics: cold-
//! and live-parent create latency by parent size, attributed and net diff
//! latency at a bounded journal span, drop/reap latency, and concurrent-
//! create contention.
//!
//! The measured medians are asserted against the ratified absolute bounds
//! (LLP 0162 author ratification, 2026-08-06), so a rerun is a pass/fail
//! row-13 gate, not just a report.
//!
//! Ignored by default; run explicitly against a release binary:
//! `cargo test --release --test instance_fork_bench_v1 -- --ignored --nocapture`
//! The run writes a dated receipt under `tests/acceptance/`.

use serde_json::{Value, json};
use snapback::manifest::SchemaManifest;
use snapback::storage::LocalDatabase;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Ratified absolute bounds (LLP 0162 author, 2026-08-06) for the narrow
/// `operating.instance-forks` claim. Medians are gated (the max column keeps
/// first-run warmup outliers visible without flaking the gate).
const BOUND_CREATE_SMALL_MS: f64 = 2_000.0;
const BOUND_CREATE_LARGE_32MIB_MS: f64 = 3_000.0;
const BOUND_CREATE_LIVE_MS: f64 = 2_000.0;
const BOUND_DROP_MS: f64 = 1_000.0;
const BOUND_ATTRIBUTED_DIFF_10K_MS: f64 = 500.0;
const BOUND_NET_DIFF_10K_MS: f64 = 750.0;
const BOUND_REAP_SWEEP_MS: f64 = 1_000.0;

fn snapback() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback"));
    command
        .stdin(Stdio::null())
        .env_remove("SNAPBACK_ADMIN_TOKEN");
    command
}

fn run_json(args: &[&str], operation: &str) -> (Value, f64) {
    let started = Instant::now();
    let output = snapback()
        .args(args)
        .output()
        .unwrap_or_else(|error| panic!("spawn {operation}: {error}"));
    let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
    assert!(
        output.status.success(),
        "{operation} failed\nstderr:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    (
        serde_json::from_slice(&output.stdout)
            .unwrap_or_else(|error| panic!("{operation} stdout is not JSON: {error}")),
        elapsed,
    )
}

fn stats(samples: &[f64]) -> Value {
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    json!({
        "samples": samples.len(),
        "minMs": sorted.first().copied().unwrap_or(0.0),
        "medianMs": sorted[sorted.len() / 2],
        "maxMs": sorted.last().copied().unwrap_or(0.0),
    })
}

fn normalize_integral_json_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                normalize_integral_json_numbers(value);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                normalize_integral_json_numbers(value);
            }
        }
        Value::Number(number) if number.is_f64() => {
            let value = number.as_f64().expect("JSON float");
            if value.fract() == 0.0 && value >= i64::MIN as f64 && value <= i64::MAX as f64 {
                *number = serde_json::Number::from(value as i64);
            }
        }
        _ => {}
    }
}

// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04 —
// publication-chain JSON must equal JSON.stringify(parsed, null, 2) plus one
// newline. Normalize f64 integral values before serde's two-space pretty
// encoding so JavaScript will not rewrite `2000.0` to `2000`.
fn canonical_receipt_json(value: &Value) -> Vec<u8> {
    let mut canonical = value.clone();
    normalize_integral_json_numbers(&mut canonical);
    let mut bytes = serde_json::to_vec_pretty(&canonical).expect("serialize bench receipt");
    bytes.push(b'\n');
    bytes
}

fn utc_date_from_unix_days(days_since_epoch: u64) -> String {
    // Howard Hinnant's civil-from-days algorithm. Receipt dates are UTC run
    // dates, independent of the host's local timezone.
    let z = i64::try_from(days_since_epoch).expect("UTC day count fits i64") + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn utc_run_date() -> String {
    let days_since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("bench host clock is before the Unix epoch")
        .as_secs()
        / 86_400;
    utc_date_from_unix_days(days_since_epoch)
}

fn write_new_receipt(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    output.write_all(bytes)?;
    output.sync_all()
}

#[test]
fn emitted_receipt_json_is_checker_canonical() {
    let directory = tempfile::tempdir().expect("canonical receipt fixture");
    let path = directory.path().join("receipt.json");
    let receipt = json!({
        "integralBound": 2_000.0,
        "fractionalMeasurement": 12.5,
        "nested": { "integralMedian": 750.0 },
    });
    std::fs::write(&path, canonical_receipt_json(&receipt)).expect("write canonical receipt");
    let bytes = std::fs::read(&path).expect("read canonical receipt");
    let parsed: Value = serde_json::from_slice(&bytes).expect("parse canonical receipt");

    assert!(bytes.ends_with(b"\n"));
    assert!(String::from_utf8_lossy(&bytes).contains("  \"integralBound\": 2000,"));
    assert!(!String::from_utf8_lossy(&bytes).contains("2000.0"));
    assert_eq!(bytes, canonical_receipt_json(&parsed));
}

#[test]
fn lifecycle_receipt_run_date_uses_utc_calendar_days() {
    assert_eq!(utc_date_from_unix_days(0), "1970-01-01");
    assert_eq!(utc_date_from_unix_days(10_957), "2000-01-01");
}

#[test]
fn lifecycle_receipt_writer_refuses_to_overwrite_retained_evidence() {
    let directory = tempfile::tempdir().expect("append-only receipt fixture");
    let path = directory.path().join("dated-receipt.json");
    write_new_receipt(&path, b"retained\n").expect("write first receipt");

    let error = write_new_receipt(&path, b"replacement\n").unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(std::fs::read(path).unwrap(), b"retained\n");
}

fn parent_with_schema(directory: &Path, ballast_mb: u64) -> PathBuf {
    let source = directory.join("parent.sqlite3");
    let repo = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(repo.join("demos/todo/snapback/generated/schema.manifest.json"))
            .expect("generated Todo schema"),
    )
    .expect("Todo schema manifest");
    let mut parent = LocalDatabase::open(&source).expect("parent database");
    parent
        .schema_seed()
        .apply_schema(schema)
        .expect("apply parent schema");
    drop(parent);
    if ballast_mb > 0 {
        let conn = rusqlite::Connection::open(&source).expect("open parent");
        conn.execute_batch("CREATE TABLE ballast(id INTEGER PRIMARY KEY, bytes BLOB)")
            .unwrap();
        for row in 0..ballast_mb {
            conn.execute(
                "INSERT INTO ballast(id, bytes) VALUES(?1, zeroblob(1048576))",
                [row],
            )
            .unwrap();
        }
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
    }
    source
}

struct Lifecycle {
    create_ms: Vec<f64>,
    drop_ms: Vec<f64>,
}

fn create_drop_cycle(source: &Path, app_root: &Path, fork_root: &Path, rounds: usize) -> Lifecycle {
    let mut lifecycle = Lifecycle {
        create_ms: Vec::new(),
        drop_ms: Vec::new(),
    };
    for _ in 0..rounds {
        let (created, create_ms) = run_json(
            &[
                "fork",
                "create",
                "--from",
                source.to_str().unwrap(),
                "--ttl",
                "5m",
                "--app-root",
                app_root.to_str().unwrap(),
                "--fork-root",
                fork_root.to_str().unwrap(),
            ],
            "bench fork create",
        );
        lifecycle.create_ms.push(create_ms);
        let fork_id = created["data"]["receipt"]["lineage"]["forkId"]
            .as_str()
            .expect("fork id")
            .to_owned();
        let (_, drop_ms) = run_json(
            &[
                "fork",
                "drop",
                &fork_id,
                "--app-root",
                app_root.to_str().unwrap(),
                "--fork-root",
                fork_root.to_str().unwrap(),
            ],
            "bench fork drop",
        );
        lifecycle.drop_ms.push(drop_ms);
    }
    lifecycle
}

#[test]
#[ignore = "row-13 benchmark: run explicitly with --release -- --ignored"]
fn fork_lifecycle_row13_bench() {
    let directory = tempfile::tempdir().expect("bench fixture");
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let repo = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let commit = String::from_utf8(
        Command::new("git")
            .args(["-C", repo.to_str().unwrap(), "rev-parse", "HEAD"])
            .output()
            .expect("git rev-parse")
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();

    // Cold small parent (schema only, ~100 KB database set).
    let small_dir = directory.path().join("small");
    std::fs::create_dir(&small_dir).unwrap();
    let small = parent_with_schema(&small_dir, 0);
    let small_root = directory.path().join("forks-small");
    let small_cycle = create_drop_cycle(&small, &app_root, &small_root, 5);

    // Cold large parent (~32 MB database set).
    let large_dir = directory.path().join("large");
    std::fs::create_dir(&large_dir).unwrap();
    let large = parent_with_schema(&large_dir, 32);
    let large_root = directory.path().join("forks-large");
    let large_cycle = create_drop_cycle(&large, &app_root, &large_root, 3);

    // Live parent: creates taken from a running server's ready descriptor.
    let live_ready = small_dir.join("parent.ready.json");
    let live_log = std::fs::File::create(small_dir.join("parent.log")).unwrap();
    let mut live_server = snapback()
        .args([
            "start",
            "--db",
            small.to_str().unwrap(),
            "--port",
            "0",
            "--ready-file",
            live_ready.to_str().unwrap(),
        ])
        .stdout(Stdio::from(live_log.try_clone().unwrap()))
        .stderr(Stdio::from(live_log))
        .spawn()
        .expect("spawn live parent");
    while !live_ready.is_file() {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let live_root = directory.path().join("forks-live");
    let live_cycle = create_drop_cycle(&live_ready, &app_root, &live_root, 3);
    let _ = live_server.kill();
    let _ = live_server.wait();

    // Bounded diff spans: 10k attributed journal rows, and a 10k-row net
    // divergence over a retained base.
    let wall_now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let diff_root = directory.path().join("forks-diff");
    std::fs::create_dir(&diff_root).unwrap();
    let expected = snapback::instance_fork::load_expected_app(&app_root)
        .expect("load bench app binding established by fork create");
    let attributed = snapback::instance_fork::publish_managed(
        &small,
        &diff_root.join("fork-attributed"),
        &expected,
        "bench-parent",
        wall_now,
        wall_now + 3_600_000,
        false,
    )
    .expect("publish attributed fixture");
    let netted = snapback::instance_fork::publish_managed_with_base(
        &small,
        &diff_root.join("fork-net"),
        &expected,
        "bench-parent",
        wall_now,
        wall_now + 3_600_000,
        false,
        true,
    )
    .expect("publish net fixture");
    for destination in ["fork-attributed", "fork-net"] {
        let conn =
            rusqlite::Connection::open(diff_root.join(destination).join("parent.sqlite3")).unwrap();
        conn.execute_batch(
            "UPDATE _snapback_version SET version=1 WHERE id=1;
             CREATE TABLE IF NOT EXISTS bench_rows(_id TEXT PRIMARY KEY, n INTEGER);",
        )
        .unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        for index in 0..10_000 {
            tx.execute(
                "INSERT INTO bench_rows(_id, n) VALUES(?1, ?2)",
                rusqlite::params![format!("row-{index}"), index],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
                 VALUES(1,'bench_rows',?1,'insert','{}',1)",
                [format!("row-{index}")],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let mut attributed_ms = Vec::new();
    let mut net_ms = Vec::new();
    for _ in 0..3 {
        let (_, elapsed) = run_json(
            &[
                "fork",
                "diff",
                &attributed.lineage.fork_id,
                "--app-root",
                app_root.to_str().unwrap(),
                "--fork-root",
                diff_root.to_str().unwrap(),
            ],
            "bench attributed diff",
        );
        attributed_ms.push(elapsed);
        let (_, elapsed) = run_json(
            &[
                "fork",
                "diff",
                &netted.lineage.fork_id,
                "--net",
                "--app-root",
                app_root.to_str().unwrap(),
                "--fork-root",
                diff_root.to_str().unwrap(),
            ],
            "bench net diff",
        );
        net_ms.push(elapsed);
    }

    // Reap: three expired (unbooted) forks removed by one injected-clock sweep.
    let reap_root = directory.path().join("forks-reap");
    std::fs::create_dir(&reap_root).unwrap();
    for index in 0..3 {
        snapback::instance_fork::publish_managed(
            &small,
            &reap_root.join(format!("fork-{index}")),
            &expected,
            "bench-parent",
            wall_now,
            wall_now + 1,
            false,
        )
        .expect("publish reap fixture");
    }
    let (reaped, reap_ms) = run_json(
        &[
            "fork",
            "reap",
            "--now-ms",
            &(wall_now + 10).to_string(),
            "--app-root",
            app_root.to_str().unwrap(),
            "--fork-root",
            reap_root.to_str().unwrap(),
        ],
        "bench fork reap",
    );
    assert_eq!(
        reaped["data"]["receipt"]["reapedForkIds"]
            .as_array()
            .unwrap()
            .len(),
        3
    );

    // Concurrent-create contention: three simultaneous creates against one
    // parent versus the sequential median.
    let contention_root = directory.path().join("forks-contention");
    let started = Instant::now();
    let created: Vec<String> = std::thread::scope(|scope| {
        (0..3)
            .map(|_| {
                let small = small.clone();
                let app_root = app_root.clone();
                let contention_root = contention_root.clone();
                scope.spawn(move || {
                    let (created, _) = run_json(
                        &[
                            "fork",
                            "create",
                            "--from",
                            small.to_str().unwrap(),
                            "--ttl",
                            "5m",
                            "--app-root",
                            app_root.to_str().unwrap(),
                            "--fork-root",
                            contention_root.to_str().unwrap(),
                        ],
                        "bench concurrent create",
                    );
                    created["data"]["receipt"]["lineage"]["forkId"]
                        .as_str()
                        .unwrap()
                        .to_owned()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect()
    });
    let concurrent_wall_ms = started.elapsed().as_secs_f64() * 1_000.0;
    for fork_id in &created {
        run_json(
            &[
                "fork",
                "drop",
                fork_id,
                "--app-root",
                app_root.to_str().unwrap(),
                "--fork-root",
                contention_root.to_str().unwrap(),
            ],
            "bench concurrent drop",
        );
    }

    let receipt = json!({
        "schemaVersion": "snapback.fork-lifecycle-bench.v1",
        "scope": "LLP 0162 row 13, narrow operating.instance-forks claim (author-scoped 2026-08-05)",
        "environment": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "cpus": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
            "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
            "commit": commit,
        },
        "measurements": {
            "createColdSmallParent": stats(&small_cycle.create_ms),
            "createColdLargeParent32MiB": stats(&large_cycle.create_ms),
            "createLiveParent": stats(&live_cycle.create_ms),
            "dropSmall": stats(&small_cycle.drop_ms),
            "dropLarge": stats(&large_cycle.drop_ms),
            "dropLive": stats(&live_cycle.drop_ms),
            "attributedDiff10kRows": stats(&attributed_ms),
            "netDiff10kRows": stats(&net_ms),
            "reapThreeExpiredForks": { "samples": 1, "medianMs": reap_ms },
            "concurrentCreate3WallMs": concurrent_wall_ms,
            "sequentialCreateMedianMs": stats(&small_cycle.create_ms)["medianMs"],
        },
        "ratifiedBounds": {
            "ratifiedBy": "LLP 0162 author (Charlie), 2026-08-06",
            "createColdSmallParentMs": BOUND_CREATE_SMALL_MS,
            "createColdLargeParent32MiBMs": BOUND_CREATE_LARGE_32MIB_MS,
            "createLiveParentMs": BOUND_CREATE_LIVE_MS,
            "dropMs": BOUND_DROP_MS,
            "attributedDiff10kRowsMs": BOUND_ATTRIBUTED_DIFF_10K_MS,
            "netDiff10kRowsMs": BOUND_NET_DIFF_10K_MS,
            "reapSweepMs": BOUND_REAP_SWEEP_MS,
            "concurrentCreate3WallMs": "<= 3x the sequential create bound",
        },
        "notes": [
            "create latency includes server boot, ready handshake, and manifest load — the full product surface",
            "diff spans are 10k journal rows, an order of magnitude under the 100k diff-work bound",
        ],
    });
    // Platform-qualified, run-dated filename so every requalification mints
    // a new artifact. create_new below makes the same-date/platform collision
    // fail closed instead of rewriting retained evidence.
    let out = repo.join(format!(
        "tests/acceptance/instance-fork-lifecycle-bench.{}.{}-{}.v1.json",
        utc_run_date(),
        std::env::consts::OS,
        std::env::consts::ARCH,
    ));
    let receipt_bytes = canonical_receipt_json(&receipt);
    write_new_receipt(&out, &receipt_bytes).unwrap_or_else(|error| {
        panic!(
            "refusing to overwrite dated lifecycle receipt {}: {error}",
            out.display()
        )
    });
    println!("receipt written: {}", out.display());
    print!("{}", String::from_utf8(receipt_bytes).unwrap());

    // The ratified gate: the receipt above persists either way, so a bound
    // failure is inspectable rather than silent.
    let median = |value: &Value| value["medianMs"].as_f64().unwrap();
    let checks = [
        (
            "createColdSmallParent",
            median(&receipt["measurements"]["createColdSmallParent"]),
            BOUND_CREATE_SMALL_MS,
        ),
        (
            "createColdLargeParent32MiB",
            median(&receipt["measurements"]["createColdLargeParent32MiB"]),
            BOUND_CREATE_LARGE_32MIB_MS,
        ),
        (
            "createLiveParent",
            median(&receipt["measurements"]["createLiveParent"]),
            BOUND_CREATE_LIVE_MS,
        ),
        (
            "dropSmall",
            median(&receipt["measurements"]["dropSmall"]),
            BOUND_DROP_MS,
        ),
        (
            "dropLarge",
            median(&receipt["measurements"]["dropLarge"]),
            BOUND_DROP_MS,
        ),
        (
            "dropLive",
            median(&receipt["measurements"]["dropLive"]),
            BOUND_DROP_MS,
        ),
        (
            "attributedDiff10kRows",
            median(&receipt["measurements"]["attributedDiff10kRows"]),
            BOUND_ATTRIBUTED_DIFF_10K_MS,
        ),
        (
            "netDiff10kRows",
            median(&receipt["measurements"]["netDiff10kRows"]),
            BOUND_NET_DIFF_10K_MS,
        ),
        (
            "reapThreeExpiredForks",
            median(&receipt["measurements"]["reapThreeExpiredForks"]),
            BOUND_REAP_SWEEP_MS,
        ),
        (
            "concurrentCreate3Wall",
            concurrent_wall_ms,
            3.0 * BOUND_CREATE_SMALL_MS,
        ),
    ];
    for (metric, observed, bound) in checks {
        assert!(
            observed <= bound,
            "{metric}: {observed:.1}ms exceeds the ratified bound {bound:.0}ms"
        );
    }
}
