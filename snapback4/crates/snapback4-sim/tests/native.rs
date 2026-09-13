//! Native jobs (LLP 3000.005): the fixture module under `native-fixtures/
//! rescore` — Interview's rescore in Rust, and two jobs that misbehave on
//! purpose — compiled to wasm here and run by the engine as jobs.

use snapback4_core::JobState;
use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::partition::holdings;
use snapback4_core::value::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Interview's feed-relevant subset (LLP 3000.004 §5) with the scoring job
/// and the personalizer native, plus the misbehaving jobs: the fixture's own
/// schema, which the device test compiles too.
const SCHEMA: &str = include_str!("../../../native-fixtures/rescore/schema.q");

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

const NOW: i64 = 1_789_300_000_000;

/// The fixture module, built once per test binary: the schema's Rust types
/// written into the fixture crate, `cargo build` for wasm, the bytes read.
/// A missing toolchain fails loudly with the line that installs it.
fn module() -> &'static [u8] {
    static MODULE: OnceLock<Vec<u8>> = OnceLock::new();
    MODULE.get_or_init(|| {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("the snapback4 directory");
        let fixture = root.join("native-fixtures/rescore");
        let bound = snapback4_lang::compile(&[("schema.q".to_owned(), SCHEMA.to_owned())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        std::fs::write(fixture.join("src/schema.rs"), snapback4_lang::emit::rust(&bound)).expect("write the fixture's schema.rs");
        let target = root.join("target/native-fixture");
        let output = std::process::Command::new("cargo")
            .args(["build", "--release", "--quiet", "--target", "wasm32-unknown-unknown", "--manifest-path"])
            .arg(fixture.join("Cargo.toml"))
            .arg("--target-dir")
            .arg(&target)
            .env_remove("CARGO_TARGET_DIR")
            .output()
            .expect("cargo on PATH");
        assert!(output.status.success(), "the fixture did not build; is the target installed? `rustup target add wasm32-unknown-unknown`\n{}", String::from_utf8_lossy(&output.stderr));
        std::fs::read(target.join("wasm32-unknown-unknown/release/sb4_fixture_rescore.wasm")).expect("the built module")
    })
}

fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), SCHEMA.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap()
}

fn sent(outcome: snapback4_core::MutationOutcome) -> Value {
    match outcome.state {
        WriteState::Sent { result, .. } => result,
        WriteState::Failed { why, .. } => panic!("refused: {why}"),
    }
}

fn mutate(engine: &mut Engine, name: &str, viewer: &str, fields: &[(&str, Value)], at: i64) -> Value {
    sent(engine.mutate(name, None, Context::new(viewer, args(fields)).at(at)).unwrap())
}

/// Three posts, votes and a comment: the scored rows, in order, on a device.
fn seed_interview(engine: &mut Engine) -> (String, String, String) {
    let prompt = mutate(engine, "createPrompt", "dev:alice", &[("title", Value::String("Humans should stop reviewing code".into()))], NOW);
    let prompt = prompt.field("id").unwrap().as_str().unwrap().to_owned();
    let post = |engine: &mut Engine, viewer: &str, summary: &str, provider: Value| {
        mutate(engine, "writePost", viewer, &[("promptId", id(&prompt)), ("summary", Value::String(summary.into())), ("provider", provider)], NOW).field("id").unwrap().as_str().unwrap().to_owned()
    };
    let bobs = post(engine, "dev:bob", "Review less, more carefully.", Value::Null);
    let marcs = post(engine, "dev:marc", "No: review everything.", Value::Null);
    let models = post(engine, "dev:alice", "A model's take.", Value::String("Claude".into()));
    for (voter, target, direction) in [("dev:alice", &marcs, 1), ("dev:bob", &marcs, 1), ("dev:marc", &bobs, -1)] {
        mutate(engine, "vote", voter, &[("postId", id(target)), ("direction", Value::Int(direction))], NOW);
    }
    mutate(engine, "comment", "dev:bob", &[("postId", id(&models)), ("body", Value::String("Interesting.".into()))], NOW);
    (bobs, marcs, models)
}

fn scores(engine: &Engine) -> BTreeMap<String, i64> {
    engine.store().rows("ranked").unwrap().iter().map(|row| (row.field("postId").unwrap().as_str().unwrap().to_owned(), row.field("score").unwrap().as_int().unwrap())).collect()
}

#[test]
fn a_native_job_scores_the_feed_and_the_ordinary_query_serves_it() {
    let mut engine = engine();
    assert_eq!(engine.declared_native_jobs(), vec!["boom", "clash", "overflow", "rescore"]);
    assert_eq!(engine.native_module().map(|m| m.reads().to_vec()), None);
    let jobs = engine.install_native(module()).unwrap();
    assert_eq!(jobs, vec!["rescore", "overflow", "clash", "boom"]);
    assert_eq!(engine.native_module().unwrap().reads(), ["personalize"]);
    let (bobs, marcs, models) = seed_interview(&mut engine);
    let run = engine.run_job("rescore", BTreeMap::new(), NOW + 1_000).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!((run.chunks, run.rows_written), (1, 3));
    // Two votes × 10, one comment × 2, one downvote × 10; age 0.
    let scored = scores(&engine);
    assert_eq!(scored[&marcs], 20);
    assert_eq!(scored[&models], 2);
    assert_eq!(scored[&bobs], -10);
    // The ordinary query reads the ranked partition in score order, with the
    // viewer's own vote beside each row.
    let read = engine.query("home", Context::new("dev:bob", BTreeMap::new()).at(NOW + 2_000)).unwrap();
    assert!(read.complete);
    let page = read.data.as_array().unwrap();
    let summaries: Vec<&str> = page.iter().map(|row| row.field("post").unwrap().field("summary").unwrap().as_str().unwrap()).collect();
    assert_eq!(summaries, ["No: review everything.", "A model's take.", "Review less, more carefully."]);
    assert_eq!(page[0].field("mine").unwrap().field("direction").unwrap(), &Value::Int(1));
    assert_eq!(page[2].field("mine").unwrap(), &Value::Null);
    // Every device holds the public ranked partition; a rescore updates it in place.
    let (events, _) = engine.snapshot("dev:marc").unwrap();
    assert_eq!(holdings(&events)["ranked"].len(), 3);
    for voter in ["dev:alice", "dev:bob", "dev:marc"] {
        mutate(&mut engine, "vote", voter, &[("postId", id(&bobs)), ("direction", Value::Int(1))], NOW + 3_000);
    }
    let run = engine.run_job("rescore", BTreeMap::new(), NOW + 4_000).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(engine.store().rows("ranked").unwrap().len(), 3, "rows updated, not duplicated");
    assert_eq!(scores(&engine)[&bobs], 30);
    let read = engine.query("home", Context::new("dev:bob", BTreeMap::new()).at(NOW + 5_000)).unwrap();
    assert_eq!(read.data.as_array().unwrap()[0].field("post").unwrap().field("summary").unwrap(), &Value::String("Review less, more carefully.".into()));
}

#[test]
fn a_native_job_resumes_by_the_state_it_returns() {
    let mut engine = engine();
    engine.install_native(module()).unwrap();
    let prompt = mutate(&mut engine, "createPrompt", "dev:alice", &[("title", Value::String("Many posts".into()))], NOW);
    let prompt = prompt.field("id").unwrap().as_str().unwrap().to_owned();
    engine.seed((0..250).map(|n| ("posts".to_owned(), snapback4_core::value::object([("id", id(&format!("post{n:03}"))), ("promptId", id(&prompt)), ("authorId", id("dev:alice")), ("summary", Value::String(format!("post {n}"))), ("at", Value::Int(NOW - n * 3_600_000))])))).unwrap();
    let job = engine.enqueue_job("rescore", BTreeMap::new(), NOW).unwrap();
    // A page of 100 per chunk: two full pages return `again` with the page's
    // position, the third (50 rows) returns `done`.
    let first = engine.run_job_chunk(NOW + 1).unwrap().unwrap();
    assert_eq!((first.state, first.chunks, first.rows_written), (JobState::Running, 1, 100));
    let second = engine.run_job_chunk(NOW + 2).unwrap().unwrap();
    assert_eq!((second.state, second.chunks, second.rows_written), (JobState::Running, 2, 200));
    let third = engine.run_job_chunk(NOW + 3).unwrap().unwrap();
    assert_eq!((third.state, third.chunks, third.rows_written), (JobState::Done, 3, 250));
    assert_eq!(third.id, job);
    assert!(engine.run_job_chunk(NOW + 4).unwrap().is_none(), "nothing queued");
    assert_eq!(engine.store().rows("ranked").unwrap().len(), 250);
    // Age decays with a float exponent: the oldest post scores lowest.
    let scored = scores(&engine);
    assert_eq!(scored["post000"], 0);
    assert_eq!(scored["post249"], -(249_f64.powf(1.5)).round() as i64);
}

#[test]
fn a_refused_write_parks_a_native_job_and_rolls_the_chunk_back() {
    let mut engine = engine();
    engine.install_native(module()).unwrap();
    let run = engine.run_job("clash", BTreeMap::new(), NOW).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert!(run.error.as_deref().unwrap_or("").starts_with("E_CONSTRAINT:"), "{run:?}");
    assert_eq!(engine.store().rows("ranked").unwrap().len(), 0, "the chunk rolled back, the first row with it");
}

/// The same path at the meter: 9,000 inserts against the 8,192 the job
/// ceilings allow. Ignored by default because the debug host spends about
/// twenty seconds on the JSON of 8,192 calls; `--ignored` runs it.
#[test]
#[ignore = "8,192 writes through the debug host take about 20 s; run with --ignored"]
fn a_write_past_the_ceiling_parks_a_native_job_and_rolls_the_chunk_back() {
    let mut engine = engine();
    engine.install_native(module()).unwrap();
    let run = engine.run_job("overflow", BTreeMap::new(), NOW).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert!(run.error.as_deref().unwrap_or("").starts_with("E_BOUND: rows written reached the ceiling"), "{run:?}");
    assert_eq!(engine.store().rows("comments").unwrap().len(), 0, "the chunk rolled back");
}

#[test]
fn a_trap_parks_a_native_job_with_the_reason() {
    let mut engine = engine();
    engine.install_native(module()).unwrap();
    let run = engine.run_job("boom", BTreeMap::new(), NOW).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    let error = run.error.unwrap_or_default();
    assert!(error.starts_with("E_NATIVE_TRAP:") && error.contains("panics on purpose"), "{error}");
}

#[test]
fn a_schedule_fires_a_native_job() {
    let mut engine = engine();
    engine.install_native(module()).unwrap();
    seed_interview(&mut engine);
    engine.fire_schedules(NOW).unwrap();
    assert_eq!(engine.fire_schedules(NOW + 300_000).unwrap(), vec!["rescoreEvery".to_owned()]);
    let run = engine.run_job_chunk(NOW + 300_001).unwrap().unwrap();
    assert_eq!((run.name.as_str(), run.state), ("rescore", JobState::Done));
    assert_eq!(engine.store().rows("ranked").unwrap().len(), 3);
}

#[test]
fn a_native_job_without_a_module_parks_and_says_so() {
    let mut engine = engine();
    let run = engine.run_job("rescore", BTreeMap::new(), NOW).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert!(run.error.as_deref().unwrap_or("").starts_with("E_NATIVE: job rescore is native but no module is installed"), "{run:?}");
}

#[test]
fn only_a_job_can_be_native() {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), "mutation x(): native\n".to_owned())]);
    assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
    assert_eq!(bound.diagnostics[0].code, "E_NATIVE");
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), "job x(): native\nschedule s every 1m: x\n".to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.programs[0].program.native && bound.programs[0].program.body.is_empty());
    assert_eq!(bound.schema.schedules[0].target, "x");
}
