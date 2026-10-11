//! Exhaustive small-scope checking of a global roster audience (LLP 3000.036.000 §3.2).
//!
//! `read <- exists members[viewer]` with an inferred `sync` is a target
//! audience with no group columns: one group, the whole roster. The chat
//! model in `exhaustive.rs` covers grouped memberships; this covers the
//! empty group the same way. Every sequence of up to three writes over
//! three principals (Alice seeded in the roster; Bob and Mallory outside it
//! until a member adds them) is run against the real engine, and at every node:
//!
//! - every write the model refuses is refused without a commit, including a
//!   caller adding itself or a non-member adding anyone;
//! - each principal's snapshot is exactly the rows the rules admit now;
//! - a stream from every watermark, at page sizes 1 and 1000, puts only
//!   images the viewer could read at some node and may read now, and the
//!   two page sizes apply to the same rows;
//! - every device that bootstrapped at an earlier node of the path holds,
//!   after draining, exactly the rows the rules admit now (joins acquire the
//!   roster's rows, leaves drop them).

use serde_json::Value as Json;
use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::partition::EventKind;
use snapback4_core::schema::{Audience, Schema};
use snapback4_core::value::{Value, object};
use snapback4_core::wire;
use std::collections::{BTreeMap, BTreeSet};

const ALICE: &str = "dev:alice";
const BOB: &str = "dev:bob";
const MALLORY: &str = "dev:mallory";
const PRINCIPALS: [&str; 3] = [ALICE, BOB, MALLORY];
const NOW: i64 = 1_000_000_000;
const DEPTH: usize = 3;

const SOURCE: &str = "
table members:
  principal: principal
  unique principal
  cap 8
  read <- exists members[viewer]
  insert <- exists members[viewer]
  delete <- exists members[viewer]
  sync

table notes:
  author: principal
  body: text <=40
  cap 8
  read <- exists members[viewer]
  insert <- .author = viewer and exists members[viewer]
  delete <- exists members[viewer]
  sync

mutation add(who: principal):
  return insert members { principal: who }

mutation join():
  return insert members { principal: viewer }

mutation remove(who: principal):
  m = members[who] ! else NOT_MEMBER
  delete members[m]
  return null

mutation post(body: text <=40):
  return insert notes { author: viewer, body }

mutation unpost(note: notes):
  delete notes[note]
  return null
";

fn bound() -> (Schema, Vec<snapback4_core::ir::Program>) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    (bound.schema, bound.programs.into_iter().map(|p| p.program).collect())
}

fn fresh() -> Engine {
    let (schema, programs) = bound();
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed([("members".to_owned(), object([("id", Value::Id("m-alice".into())), ("principal", Value::Id(ALICE.into()))]))]).unwrap();
    engine
}

#[derive(Clone, Debug)]
enum Op {
    Add(&'static str, &'static str),
    Join(&'static str),
    Remove(&'static str, &'static str),
    Post(&'static str),
    Unpost(&'static str, String),
}

impl Op {
    fn actor(&self) -> &'static str {
        match self { Op::Add(a, _) | Op::Join(a) | Op::Remove(a, _) | Op::Post(a) | Op::Unpost(a, _) => a }
    }
    fn call(&self) -> (&'static str, Vec<(&'static str, Value)>) {
        match self {
            Op::Add(_, who) => ("add", vec![("who", Value::Id((*who).into()))]),
            Op::Join(_) => ("join", vec![]),
            Op::Remove(_, who) => ("remove", vec![("who", Value::Id((*who).into()))]),
            Op::Post(_) => ("post", vec![("body", Value::String("hi".into()))]),
            Op::Unpost(_, note) => ("unpost", vec![("note", Value::Id(note.clone()))]),
        }
    }
}

type Rows = BTreeMap<String, BTreeMap<String, Json>>;

fn image(row: &Value) -> Json {
    match wire::to_json(row) {
        Json::Object(fields) => Json::Object(fields.into_iter().filter(|(_, v)| !v.is_null()).collect()),
        other => other,
    }
}

fn tables(engine: &Engine) -> Rows {
    ["members", "notes"].iter().map(|name| {
        let rows = engine.store().rows(name).unwrap();
        ((*name).to_owned(), rows.iter().map(|row| (row.field("id").unwrap().as_str().unwrap().to_owned(), image(row))).collect())
    }).collect()
}

fn member(now: &Rows, p: &str) -> bool {
    now["members"].values().any(|row| row["principal"].as_str() == Some(p))
}

/// The rules, written from the schema text: a roster member reads every row.
fn readable(now: &Rows, p: &str) -> Rows {
    if member(now, p) { now.clone() } else { now.keys().map(|t| (t.clone(), BTreeMap::new())).collect() }
}

/// Whether the rules admit the write; `None` when the program itself refuses
/// (a missing row) and the rules are never reached.
fn admits(now: &Rows, op: &Op) -> Option<bool> {
    let actor = member(now, op.actor());
    match op {
        Op::Add(_, who) => if member(now, who) { None } else { Some(actor) },
        Op::Join(a) => if member(now, a) { None } else { Some(false) },
        Op::Remove(_, who) => if member(now, who) { Some(actor) } else { None },
        Op::Post(_) => Some(actor),
        Op::Unpost(_, note) => if now["notes"].contains_key(note) { Some(actor) } else { None },
    }
}

fn ops(now: &Rows) -> Vec<Op> {
    let mut out = Vec::new();
    for actor in PRINCIPALS {
        out.extend([Op::Add(actor, BOB), Op::Add(actor, MALLORY), Op::Join(actor), Op::Remove(actor, ALICE), Op::Remove(actor, BOB), Op::Post(actor)]);
        for note in now["notes"].keys() { out.push(Op::Unpost(actor, note.clone())); }
    }
    out
}

fn run(engine: &mut Engine, op: &Op, step: usize) -> Result<Option<u64>, String> {
    let (mutation, args) = op.call();
    let args = args.into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
    let name = format!("s{step}");
    let ids = (0..4).map(|n| format!("{name}{}", (b'a' + n as u8) as char));
    let context = Context::new(op.actor(), args).at(1_000 * (step as i64 + 1)).with_ids(ids);
    match engine.mutate(mutation, Some(&name), context).map_err(|e| format!("{op:?}: {e}"))?.state {
        WriteState::Sent { seq, .. } => Ok(Some(seq)),
        WriteState::Failed { .. } => Ok(None),
    }
}

#[derive(Clone)]
struct Device { viewer: &'static str, watermark: u64, rows: Rows }

impl Device {
    fn apply(&mut self, events: &[snapback4_core::store::LogEvent]) {
        for event in events {
            let rows = self.rows.entry(event.table.clone()).or_default();
            match event.kind.as_str() {
                "put" => { rows.insert(event.id.clone(), event.data.as_ref().map(image).unwrap_or(Json::Null)); }
                "del" => { rows.remove(&event.id); }
                // The roster's one group is the whole table: a leave drops it.
                "scope" => rows.clear(),
                _ => {}
            }
        }
    }
}

#[derive(Default, Clone)]
struct PathState {
    /// (viewer, table, id, image) the viewer could read at some node of the path.
    shown: BTreeSet<(String, String, String, String)>,
    devices: Vec<Device>,
}

fn drain(engine: &mut Engine, viewer: &'static str, from: u64, limit: usize, head: u64, now: &Rows, state: &PathState, errs: &mut Vec<String>) -> Vec<snapback4_core::store::LogEvent> {
    let want = readable(now, viewer);
    let mut watermark = from;
    let mut events = Vec::new();
    for _ in 0..=head + 2 {
        let page = engine.stream_at(viewer, watermark, limit, NOW).unwrap();
        for event in &page.events {
            if event.kind == "put" {
                let data = event.data.as_ref().map(image).unwrap_or(Json::Null);
                if !state.shown.contains(&(viewer.to_owned(), event.table.clone(), event.id.clone(), data.to_string())) {
                    errs.push(format!("DISCLOSED {viewer} from {from}: {}/{} {data}", event.table, event.id));
                } else if want.get(&event.table).and_then(|rows| rows.get(&event.id)) != Some(&data) {
                    errs.push(format!("a put the viewer may not read now: {viewer} from {from}: {}/{}", event.table, event.id));
                }
            }
        }
        events.extend(page.events);
        watermark = page.watermark;
        if !page.more { break; }
    }
    if watermark != head { errs.push(format!("{viewer} from {from} stops at {watermark}, head {head}")); }
    events
}

fn check_node(engine: &mut Engine, now: &Rows, state: &mut PathState) -> Vec<String> {
    let mut errs = Vec::new();
    let head = engine.seq().unwrap();
    for p in PRINCIPALS {
        for (table, rows) in readable(now, p) {
            for (key, row) in rows { state.shown.insert((p.to_owned(), table.clone(), key, row.to_string())); }
        }
    }
    let mut devices = Vec::new();
    for p in PRINCIPALS {
        let (events, watermark) = engine.snapshot_at(p, NOW).unwrap();
        let mut rows: Rows = ["members", "notes"].iter().map(|t| ((*t).to_owned(), BTreeMap::new())).collect();
        for event in &events {
            assert_eq!(event.kind, EventKind::Put);
            rows.entry(event.table.clone()).or_default().insert(event.id.clone(), event.data.as_ref().map(image).unwrap_or(Json::Null));
        }
        if rows != readable(now, p) { errs.push(format!("{p}'s snapshot {rows:?} is not what the rules admit {:?}", readable(now, p))); }
        if watermark != head { errs.push(format!("{p}'s snapshot is at {watermark}, head {head}")); }
        devices.push(Device { viewer: p, watermark, rows });
        for from in 0..=head {
            let mut small = Device { viewer: p, watermark: from, rows: Rows::new() };
            let mut large = small.clone();
            let events = drain(engine, p, from, 1, head, now, state, &mut errs);
            small.apply(&events);
            let events = drain(engine, p, from, 1_000, head, now, state, &mut errs);
            large.apply(&events);
            if small.rows != large.rows { errs.push(format!("{p} from {from}: page sizes disagree")); }
        }
    }
    for device in &state.devices {
        let mut synced = device.clone();
        let events = drain(engine, synced.viewer, synced.watermark, 1, head, now, state, &mut errs);
        synced.apply(&events);
        synced.watermark = head;
        let want = readable(now, synced.viewer);
        for (table, rows) in &want {
            let held = synced.rows.get(table).cloned().unwrap_or_default();
            if &held != rows { errs.push(format!("a device of {} holds {table} {held:?}; the rules admit {rows:?}", synced.viewer)); }
        }
        devices.push(synced);
    }
    state.devices = devices;
    errs
}

fn explore(path: &mut Vec<Op>, state: &PathState, failures: &mut Vec<String>, nodes: &mut usize) {
    // Replay the path on a fresh engine; every step was admitted before.
    let mut engine = fresh();
    for (step, op) in path.iter().enumerate() {
        if run(&mut engine, op, step).unwrap().is_none() { failures.push(format!("{path:?}: a replayed write did not commit")); return; }
    }
    let now = tables(&engine);
    let mut state = state.clone();
    for e in check_node(&mut engine, &now, &mut state) { failures.push(format!("{path:?}: {e}")); }
    *nodes += 1;
    if path.len() == DEPTH { return; }
    for op in ops(&now) {
        let mut probe = fresh();
        for (step, earlier) in path.iter().enumerate() { run(&mut probe, earlier, step).unwrap(); }
        let head = probe.seq().unwrap();
        let outcome = run(&mut probe, &op, path.len()).unwrap();
        match (admits(&now, &op), outcome) {
            (Some(false), Some(_)) => failures.push(format!("{path:?} + {op:?}: WRITE AUTHORITY: the rules should refuse")),
            (Some(true), None) => failures.push(format!("{path:?} + {op:?}: the model admits it; the engine refused")),
            (_, None) => if probe.seq().unwrap() != head { failures.push(format!("{path:?} + {op:?}: a refused write committed")) },
            (_, Some(_)) => {
                path.push(op);
                explore(path, &state, failures, nodes);
                path.pop();
            }
        }
    }
}

#[test]
fn a_global_roster_is_one_group_inferred_from_the_read_rule() {
    let (schema, _) = bound();
    for table in ["members", "notes"] {
        let sync = schema.table(table).unwrap().sync.as_ref().unwrap();
        assert_eq!(sync.audience, Audience::Target { table: "members".into(), prefix: vec![], principal: "principal".into() }, "{table}");
        assert_eq!(sync.line(), "sync");
    }
    // A self-join or an open insert still grants an audience nobody held.
    for rule in [".principal = viewer", "allow", "exists members[viewer] or .principal = viewer"] {
        let source = SOURCE.replacen("  insert <- exists members[viewer]\n", &format!("  insert <- {rule}\n"), 1);
        let refused = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(refused.diagnostics.iter().any(|d| d.code == "E_SYNC" && d.message.contains("independent grant") && d.rewrite.contains("exists members[viewer]")), "{rule}: {:?}", refused.diagnostics);
    }
}

#[test]
fn every_sequence_of_three_roster_writes_keeps_disclosure_and_authority() {
    let mut failures = Vec::new();
    let mut nodes = 0;
    explore(&mut Vec::new(), &PathState::default(), &mut failures, &mut nodes);
    assert!(nodes > 50, "explored only {nodes} nodes");
    assert!(failures.is_empty(), "{} failures over {nodes} nodes:\n{}", failures.len(), failures.iter().take(25).cloned().collect::<Vec<_>>().join("\n"));
}
