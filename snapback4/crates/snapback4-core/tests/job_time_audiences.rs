//! Jobs pin the durable time-audience floor in the transaction which runs
//! their Quarry or native body. A later host-clock rollback, including after
//! restart, cannot hide a row that the job already published.

use snapback4_core::{Context, Engine, JobState, Store, Value, value::object};
use std::{collections::BTreeMap, path::{Path, PathBuf}, sync::OnceLock};

const SOURCE: &str = "table inputs:
  public 'job inputs'
  online only
table releases:
  kind: text <=10
  opensAt: time
  observedAt: time
  unique byKind: kind
  by byOpening: opensAt
  not before .opensAt
  public 'scheduled releases'
  sync public
query release(kind: text <=10):
  return releases[kind = kind]
job publishQuarry():
  for input in inputs:
    insert releases { kind: 'quarry', opensAt: 150, observedAt: now }
job publishTimed(): native
";

fn compiled() -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    bound
}

fn module() -> &'static [u8] {
    static MODULE: OnceLock<Vec<u8>> = OnceLock::new();
    MODULE.get_or_init(|| {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .expect("the snapback4 directory");
        let fixture = root.join("native-fixtures/time-audience");
        let target = root.join("target/native-time-audience-fixture");
        let output = std::process::Command::new("cargo")
            .args(["build", "--release", "--quiet", "--target", "wasm32-unknown-unknown", "--manifest-path"])
            .arg(fixture.join("Cargo.toml"))
            .arg("--target-dir")
            .arg(&target)
            .env_remove("CARGO_TARGET_DIR")
            .env("CARGO_INCREMENTAL", "0")
            .env("CARGO_PROFILE_DEV_DEBUG", "0")
            .env("CARGO_PROFILE_TEST_DEBUG", "0")
            .output()
            .expect("cargo on PATH");
        assert!(output.status.success(), "the fixture did not build; is the target installed? `rustup target add wasm32-unknown-unknown`\n{}", String::from_utf8_lossy(&output.stderr));
        std::fs::read(target.join("wasm32-unknown-unknown/release/sb4_fixture_time_audience.wasm"))
            .expect("the built module")
    })
}

fn path(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "sb4-job-time-audience-{label}-{}-{}",
        std::process::id(),
        snapback4_core::ids::seed(),
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("store.sqlite")
}

fn row_at(engine: &mut Engine, kind: &str, now: i64) -> Value {
    let mut args = BTreeMap::new();
    args.insert("kind".into(), Value::String(kind.into()));
    let answer = engine.query("release", Context::new("reader", args).at(now)).unwrap();
    assert!(answer.complete, "{answer:?}");
    answer.data
}

fn run_and_restart(path: &Path, job: &str, kind: &str, native: bool, advance_first: bool) {
    let bound = compiled();
    let mut engine = Engine::new_at(
        Store::open(path).unwrap(),
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
        100,
    )
    .unwrap();
    if native {
        engine.install_native(module()).unwrap();
    } else {
        engine.seed_at([("inputs".into(), object([("id", Value::Id("input".into()))]))], 100).unwrap();
    }
    if advance_first {
        assert_eq!(engine.advance_time_audiences_at(200).unwrap(), 200);
    }

    let run = engine.run_job(job, BTreeMap::new(), if advance_first { 120 } else { 200 }).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(engine.store().meta("time_audience_clock").unwrap().as_deref(), Some("200"));
    let live = row_at(&mut engine, kind, 120);
    assert_eq!(live.field("observedAt").unwrap(), &Value::Int(200));
    drop(engine);

    let mut restarted = Engine::open_at(Store::open(path).unwrap(), 120).unwrap();
    assert_eq!(restarted.store().meta("time_audience_clock").unwrap().as_deref(), Some("200"));
    let live = row_at(&mut restarted, kind, 120);
    assert_eq!(live.field("observedAt").unwrap(), &Value::Int(200));
}

#[test]
fn quarry_job_pins_publication_clock_through_rollback_and_restart() {
    let path = path("quarry");
    run_and_restart(&path, "publishQuarry", "quarry", false, false);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn quarry_job_uses_a_newer_durable_floor_for_now_and_publication() {
    let path = path("quarry-clamped");
    run_and_restart(&path, "publishQuarry", "quarry", false, true);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn native_job_pins_publication_clock_through_rollback_and_restart() {
    let path = path("native");
    run_and_restart(&path, "publishTimed", "native", true, false);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn native_job_uses_a_newer_durable_floor_for_now_and_publication() {
    let path = path("native-clamped");
    run_and_restart(&path, "publishTimed", "native", true, true);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn an_untimed_job_does_not_create_a_clock_floor() {
    let source = "table inputs:
  observedAt: time
  public 'inputs'
  online only
job stamp():
  for input in inputs:
    update inputs[input] { observedAt: now }
";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let mut engine = Engine::new_at(
        Store::memory().unwrap(),
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
        100,
    ).unwrap();
    engine.seed_at([("inputs".into(), object([
        ("id", Value::Id("input".into())),
        ("observedAt", Value::Int(0)),
    ]))], 100).unwrap();

    let run = engine.run_job("stamp", BTreeMap::new(), 50).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(engine.store().meta("time_audience_clock").unwrap(), None);
    assert_eq!(engine.store().rows("inputs").unwrap()[0].field("observedAt").unwrap(), &Value::Int(50));
}
