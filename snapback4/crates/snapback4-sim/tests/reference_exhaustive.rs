//! Exhaustive small-scope checking of referential actions (LLP 3000.039 §9).
//!
//! Every sequence of up to two operations (three with
//! `SNAPBACK4_EXHAUSTIVE_DEPTH=3`) by two viewers over two boards
//! — add a card (private to its owner, cascading from its board), pin a card
//! with a public note (restricting the card), delete a board, delete a card —
//! runs against the real engine and a model written here from the schema
//! text. At every node:
//!
//! - each operation's outcome (commit, or its refusal code) is the model's,
//!   and a refusal commits nothing;
//! - the store holds exactly the model's rows (a cascade removes every card of
//!   the board, hidden ones included, and nothing else);
//! - for both viewers and a stranger, a snapshot is exactly the rows the
//!   rules admit now, and a device that bootstrapped at any earlier node and
//!   drains the stream from there (page sizes 1 and 1000) holds exactly
//!   them; a stream never puts a row the viewer may not read now and never
//!   deletes a row the viewer never held — a cascade's deletes of other
//!   principals' cards reach only their owners.
use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::partition::EventKind;
use snapback4_core::value::{Value, object};
use std::collections::{BTreeMap, BTreeSet};

const SCHEMA: &str = r#"
table boards:
  owner: principal
  public 'boards'
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync public
table cards:
  board: boards on delete cascade
  owner: principal
  cap 8 by board
  read <- .owner = viewer
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner
table notes:
  card: cards on delete restrict
  author: principal
  public 'notes'
  insert <- .author = viewer
  sync public
mutation addCard(id: id, board: boards):
  insert cards { id, board, owner: viewer }
  return null
mutation addNote(id: id, card: cards):
  insert notes { id, card, author: viewer }
  return null
mutation dropBoard(board: boards):
  delete boards[board]
  return null
mutation dropCard(card: cards):
  delete cards[card]
  return null
"#;

const ALICE: &str = "dev:alice";
const BOB: &str = "dev:bob";
const STRANGER: &str = "dev:mallory";
const VIEWERS: [&str; 3] = [ALICE, BOB, STRANGER];
const NOW: i64 = 1_000_000_000;
/// `SNAPBACK4_EXHAUSTIVE_DEPTH` deepens it (3 explores ~1,500 nodes in under a minute).
fn depth_limit() -> usize { std::env::var("SNAPBACK4_EXHAUSTIVE_DEPTH").ok().and_then(|d| d.parse().ok()).unwrap_or(2) }

fn id(s: &str) -> Value { Value::Id(s.into()) }

#[derive(Clone, Debug)]
enum Op {
    AddCard(&'static str, String, &'static str),
    AddNote(&'static str, String, String),
    DropBoard(&'static str, &'static str),
    DropCard(&'static str, String),
}

impl Op {
    fn call(&self) -> (&'static str, &'static str, Vec<(&'static str, Value)>) {
        match self {
            Op::AddCard(a, card, board) => (a, "addCard", vec![("id", id(card)), ("board", id(board))]),
            Op::AddNote(a, note, card) => (a, "addNote", vec![("id", id(note)), ("card", id(card))]),
            Op::DropBoard(a, board) => (a, "dropBoard", vec![("board", id(board))]),
            Op::DropCard(a, card) => (a, "dropCard", vec![("card", id(card))]),
        }
    }
}

/// The model: board -> owner, card -> (board, owner), note -> card.
#[derive(Clone, Debug, PartialEq)]
struct Model {
    boards: BTreeMap<String, String>,
    cards: BTreeMap<String, (String, String)>,
    notes: BTreeMap<String, String>,
}

impl Model {
    fn start() -> Self {
        Model {
            boards: [("b1", ALICE), ("b2", BOB)].map(|(b, o)| (b.to_owned(), o.to_owned())).into(),
            // A card of bob's on alice's board, hidden from her.
            cards: [("c0", ("b1", BOB)), ("c1", ("b1", ALICE))].map(|(c, (b, o))| (c.to_owned(), (b.to_owned(), o.to_owned()))).into(),
            notes: BTreeMap::new(),
        }
    }

    /// The outcome the schema's rules give: `Ok(next)` or the refusal code.
    fn apply(&self, op: &Op) -> Result<Model, &'static str> {
        let mut next = self.clone();
        match op {
            // Inserts check no reference: a card may name an absent board.
            Op::AddCard(a, card, board) => { next.cards.insert(card.clone(), ((*board).to_owned(), (*a).to_owned())); }
            Op::AddNote(_, note, card) => { next.notes.insert(note.clone(), card.clone()); }
            Op::DropBoard(a, board) => {
                let owner = self.boards.get(*board).ok_or("NOT_FOUND")?;
                if owner != a { return Err("E_RULE"); }
                // The closure: every card of the board, whoever owns it.
                let closure: Vec<String> = self.cards.iter().filter(|(_, (b, _))| b == board).map(|(c, _)| c.clone()).collect();
                if self.notes.values().any(|card| closure.contains(card)) { return Err("E_REFERENCED"); }
                next.boards.remove(*board);
                for card in closure { next.cards.remove(&card); }
            }
            Op::DropCard(a, card) => {
                let (_, owner) = self.cards.get(card).ok_or("NOT_FOUND")?;
                // Unreadable: the hidden-target refusal, before any probe.
                if owner != a { return Err("NOT_FOUND"); }
                if self.notes.values().any(|c| c == card) { return Err("E_REFERENCED"); }
                next.cards.remove(card);
            }
        }
        Ok(next)
    }

    /// The rows each viewer may read: every board and note, its own cards.
    fn readable(&self, viewer: &str) -> BTreeMap<&'static str, BTreeSet<String>> {
        BTreeMap::from([
            ("boards", self.boards.keys().cloned().collect()),
            ("cards", self.cards.iter().filter(|(_, (_, o))| o == viewer).map(|(c, _)| c.clone()).collect()),
            ("notes", self.notes.keys().cloned().collect()),
        ])
    }

    fn ops(&self, depth: usize) -> Vec<Op> {
        let mut ops = Vec::new();
        for (a, tag) in [(ALICE, "a"), (BOB, "b")] {
            for board in ["b1", "b2"] {
                ops.push(Op::AddCard(a, format!("c{depth}{tag}{board}"), board));
                ops.push(Op::DropBoard(a, board));
            }
            for card in self.cards.keys().cloned().chain(["missing".to_owned()]) {
                ops.push(Op::DropCard(a, card.clone()));
                ops.push(Op::AddNote(a, format!("n{depth}{tag}{card}"), card));
            }
        }
        ops
    }
}

fn fresh() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SCHEMA.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let start = Model::start();
    let mut rows = Vec::new();
    for (b, o) in &start.boards { rows.push(("boards".to_owned(), object([("id", id(b)), ("owner", id(o))]))); }
    for (c, (b, o)) in &start.cards { rows.push(("cards".to_owned(), object([("id", id(c)), ("board", id(b)), ("owner", id(o))]))); }
    engine.seed(rows).unwrap();
    engine
}

fn store(engine: &Engine) -> BTreeMap<&'static str, BTreeSet<String>> {
    ["boards", "cards", "notes"].into_iter().map(|t| (t, engine.store().rows(t).unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()).collect())).collect()
}

/// A device: what a viewer holds and where its stream stands.
#[derive(Clone)]
struct Device { watermark: u64, rows: BTreeMap<String, BTreeSet<String>> }

fn bootstrap(engine: &mut Engine, viewer: &str) -> Device {
    let (events, watermark) = engine.snapshot_at(viewer, NOW).unwrap();
    let mut rows: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for event in &events {
        assert_eq!(event.kind, EventKind::Put, "{viewer}: a snapshot carries a non-put");
        rows.entry(event.table.clone()).or_default().insert(event.id.clone());
    }
    Device { watermark, rows }
}

fn held(rows: &BTreeMap<String, BTreeSet<String>>) -> BTreeMap<&'static str, BTreeSet<String>> {
    ["boards", "cards", "notes"].into_iter().map(|t| (t, rows.get(t).cloned().unwrap_or_default())).collect()
}

/// Drain from the device's watermark at `limit`, checking every event.
fn drain(engine: &mut Engine, viewer: &str, mut device: Device, limit: usize, now: &Model, ever: &BTreeSet<(String, String)>, errs: &mut Vec<String>) -> Device {
    let want = now.readable(viewer);
    for _ in 0..1000 {
        let page = engine.stream_at(viewer, device.watermark, limit, NOW).unwrap();
        for event in &page.events {
            let key = (event.table.clone(), event.id.clone());
            match event.kind.as_str() {
                "put" => {
                    if !want.get(event.table.as_str()).is_some_and(|ids| ids.contains(&event.id)) {
                        errs.push(format!("{viewer}: a put of {}/{} the viewer may not read now", event.table, event.id));
                    }
                    device.rows.entry(event.table.clone()).or_default().insert(event.id.clone());
                }
                "del" => {
                    if !ever.contains(&key) {
                        errs.push(format!("{viewer}: a delete of {}/{} the viewer never held", event.table, event.id));
                    }
                    device.rows.entry(event.table.clone()).or_default().remove(&event.id);
                }
                other => errs.push(format!("{viewer}: an unexpected {other} event")),
            }
        }
        device.watermark = page.watermark;
        if !page.more { break; }
    }
    device
}

struct Path { ops: Vec<Op>, models: Vec<Model>, devices: Vec<BTreeMap<&'static str, Device>> }

fn explore(path: &mut Path, errs: &mut Vec<String>, nodes: &mut usize) {
    let depth = path.ops.len();
    let model = path.models.last().unwrap().clone();
    if depth == depth_limit() { return; }
    for op in model.ops(depth) {
        let mut engine = fresh();
        for done in &path.ops {
            let (viewer, name, args) = done.call();
            engine.mutate(name, None, Context::new(viewer, args.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()).at(NOW)).unwrap();
        }
        let before = store(&engine);
        let (viewer, name, args) = op.call();
        let outcome = engine.mutate(name, None, Context::new(viewer, args.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()).at(NOW)).unwrap();
        let expected = model.apply(&op);
        let at = format!("{:?} then {op:?}", path.ops);
        match (&outcome.state, &expected) {
            (WriteState::Sent { .. }, Ok(_)) => {}
            (WriteState::Failed { why, .. }, Err(code)) if why.code == *code => {
                if store(&engine) != before { errs.push(format!("{at}: a refusal changed the store")); }
                continue;
            }
            (state, want) => { errs.push(format!("{at}: engine {state:?}, model {want:?}")); continue; }
        }
        let next = expected.unwrap();
        *nodes += 1;
        if store(&engine) != held(&BTreeMap::from([
            ("boards".to_owned(), next.boards.keys().cloned().collect()),
            ("cards".to_owned(), next.cards.keys().cloned().collect()),
            ("notes".to_owned(), next.notes.keys().cloned().collect()),
        ])) {
            errs.push(format!("{at}: the store {:?} is not the model's {next:?}", store(&engine)));
        }
        let mut here = BTreeMap::new();
        for viewer in VIEWERS {
            let snapshot = bootstrap(&mut engine, viewer);
            if held(&snapshot.rows) != next.readable(viewer) {
                errs.push(format!("{at}: {viewer}'s snapshot {:?} is not what the rules admit {:?}", snapshot.rows, next.readable(viewer)));
            }
            // Every row this viewer could read at any node on this path.
            let mut ever = BTreeSet::new();
            for m in path.models.iter().chain([&next]) {
                for (table, ids) in m.readable(viewer) { for i in ids { ever.insert((table.to_owned(), i)); } }
            }
            for earlier in &path.devices {
                for limit in [1, 1000] {
                    let device = drain(&mut engine, viewer, earlier[viewer].clone(), limit, &next, &ever, errs);
                    if held(&device.rows) != next.readable(viewer) {
                        errs.push(format!("{at}: {viewer} synced at limit {limit} holds {:?}, not {:?}", device.rows, next.readable(viewer)));
                    }
                }
            }
            here.insert(viewer, snapshot);
        }
        if errs.len() > 25 { return; }
        path.ops.push(op);
        path.models.push(next);
        path.devices.push(here);
        explore(path, errs, nodes);
        path.ops.pop();
        path.models.pop();
        path.devices.pop();
    }
}

#[test]
fn every_short_sequence_cascades_restricts_and_discloses_as_the_rules_say() {
    let mut engine = fresh();
    let start: BTreeMap<_, _> = VIEWERS.into_iter().map(|v| (v, bootstrap(&mut engine, v))).collect();
    let mut path = Path { ops: Vec::new(), models: vec![Model::start()], devices: vec![start] };
    let (mut errs, mut nodes) = (Vec::new(), 0);
    explore(&mut path, &mut errs, &mut nodes);
    assert!(errs.is_empty(), "{} problems over {nodes} nodes:\n{}", errs.len(), errs.join("\n"));
    assert!(nodes > 40, "explored {nodes} nodes");
    println!("referential actions: {nodes} nodes at depth {}", depth_limit());
}
