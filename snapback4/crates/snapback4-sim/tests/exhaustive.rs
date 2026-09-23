//! Exhaustive small-scope checking of disclosure and write authority.
//!
//! The simulator samples interleavings under seeds. The disclosure bugs the
//! 2026-09-12 reviews found (`reviews.rs`) each needed one exact shape — a
//! principal named `public`, a commit larger than the page, a grant that
//! ends inside its own commit — and sampling rarely produces an exact shape.
//! This enumerates every sequence of up to `DEPTH` successful operations
//! over two viewers and two conversations against the real engine, and
//! after every operation checks what each principal's snapshot and streams
//! deliver against a model of the chat schema's rules written here, from
//! the schema text, not from the engine.
//!
//! Every write the model says the rules refuse is attempted at every node
//! and must be refused without a commit; every write it admits is explored
//! as a branch and its effect checked. At every node, for the two viewers
//! and a stranger who is never admitted:
//!
//! - the snapshot is exactly the rows the viewer may read now;
//! - a stream requested from *every* watermark (a device may send any), at
//!   page sizes 1 and 1000, delivers only row images the viewer may read
//!   now, never an image of a row labelled before the viewer's grant, never
//!   a delete or a scope for anything the viewer never held, ends at the
//!   head, and applies to the same rows at either page size;
//! - every device that bootstrapped at any earlier node and synced at any
//!   subset of the nodes since (page size 1) holds, after draining, exactly
//!   the rows the viewer may read now (for `messages`, `retain
//!   delivered-history`, at least those, and only retained ones outside the
//!   viewer's groups);
//! - `messageCounts` counts the messages;
//! - the write that reached the node, resent under its operation id,
//!   applies nothing new (LLP 3000 §6 invariant 3).
//!
//! `DEPTH` 2 runs in the blocking suite. Deeper runs are opt-in:
//! `SNAPBACK4_EXHAUSTIVE_DEPTH=3 cargo test -p snapback4-sim --release --test exhaustive -- --ignored`.

use serde_json::Value as Json;
use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::ir::Program;
use snapback4_core::partition::EventKind;
use snapback4_core::schema::{Audience, LeavePolicy, Schema};
use snapback4_core::value::{Value, object};
use snapback4_core::wire;
use snapback4_sim::chat::CHAT;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

const ALICE: &str = "dev:alice";
/// The second viewer is named like the public partition: a grant to it must
/// reach it alone (review finding 1).
const PUBLIC: &str = "public";
/// Never admitted: its snapshot and every stream it can request stay empty.
const STRANGER: &str = "dev:mallory";
const PRINCIPALS: [&str; 3] = [ALICE, PUBLIC, STRANGER];
const CONVERSATIONS: [&str; 2] = ["c1", "c2"];
const BLOCKING_DEPTH: usize = 2;
const NOW: i64 = 1_000_000_000;
const MAX_FAILURES: usize = 25;
/// A finding this checks for and tolerates until its ticket is fixed; remove
/// the tolerance with the fix.
const KNOWN: &str = "known, issues/20260923-snapback4-in-commit-grant-names-ids.md:";

/// Writes the chat app does not have, shaped like the reviews' findings: a
/// grant that ends in its own commit, a commit with a grant and content, a
/// grant replaced in one commit, two rows in one commit, and writes with no
/// `require` so that only the table rules stand between a viewer and a row.
const EXTRA: &str = "
mutation kick(conversationId: conversations, principal: principal):
  old = memberships[conversationId, principal] ! else NOT_MEMBER
  delete memberships[old]
  return null

mutation blip(conversationId: conversations, principal: principal):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  row = insert memberships { conversationId, principal, role: 'member', joinedAt: now }
  delete memberships[row]
  return null

mutation addAndSend(conversationId: conversations, principal: principal):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  insert memberships { conversationId, principal, role: 'member', joinedAt: now }
  insert messages { conversationId, authorId: viewer, body: 'welcome', at: now }
  return null

mutation rejoin(conversationId: conversations, principal: principal):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  old = memberships[conversationId, principal] ! else NOT_MEMBER
  delete memberships[old]
  insert memberships { conversationId, principal, role: 'member', joinedAt: now }
  return null

mutation burst(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  insert messages { conversationId, authorId: viewer, body: 'one', at: now }
  insert messages { conversationId, authorId: viewer, body: 'two', at: now }
  return null

mutation rawSend(conversationId: conversations):
  insert messages { conversationId, authorId: viewer, body: 'raw', at: now }
  return null

mutation rawJoin(conversationId: conversations):
  insert memberships { conversationId, principal: viewer, role: 'admin', joinedAt: now }
  return null

mutation rawUnsend(messageId: messages):
  delete messages[messageId]
  return null
";

struct Backend {
    schema: Schema,
    programs: Vec<Program>,
    /// Synced tables and the content column that names a row's conversation
    /// (`None` for a public table).
    synced: BTreeMap<String, Option<String>>,
    until_revoked: BTreeSet<String>,
}

fn backend() -> &'static Backend {
    static BACKEND: OnceLock<Backend> = OnceLock::new();
    BACKEND.get_or_init(|| {
        let bound = snapback4_lang::compile(&[("schema.q".to_owned(), format!("{CHAT}\n{EXTRA}"))]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema = bound.schema.clone();
        let mut synced = BTreeMap::new();
        for (name, _, sync) in schema.synced() {
            let group = match &sync.audience {
                Audience::Public => None,
                Audience::Target { table, prefix, .. } => {
                    // The model below knows one relation: a viewer is in a
                    // conversation's group while it has a membership there.
                    assert_eq!((table.as_str(), prefix.len()), ("memberships", 1), "{name}: the model covers membership audiences only");
                    Some(prefix[0].clone())
                }
                Audience::Column(column) => panic!("{name} syncs to .{column}; the model covers membership audiences only"),
            };
            synced.insert(name.to_owned(), group);
        }
        let until_revoked = schema.tables.iter().filter(|(name, t)| synced.contains_key(name.as_str()) && t.leave == LeavePolicy::UntilRevoked).map(|(name, _)| name.clone()).collect();
        Backend { programs: bound.programs.iter().map(|p| p.program.clone()).collect(), schema, synced, until_revoked }
    })
}

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn text(s: &str) -> Value {
    Value::String(s.into())
}

/// Two conversations, each with one admin; seq 1.
fn fresh() -> Engine {
    let b = backend();
    let mut engine = Engine::memory(b.schema.clone(), b.programs.iter().cloned()).unwrap();
    let membership = |key: &str, conversation: &str, principal: &str| object([("id", id(key)), ("conversationId", id(conversation)), ("principal", id(principal)), ("role", text("admin")), ("joinedAt", Value::Int(0))]);
    engine
        .seed([
            ("conversations".to_owned(), object([("id", id("c1")), ("title", text("One")), ("creatorId", id(ALICE))])),
            ("conversations".to_owned(), object([("id", id("c2")), ("title", text("Two")), ("creatorId", id(PUBLIC))])),
            ("memberships".to_owned(), membership("a1", "c1", ALICE)),
            ("memberships".to_owned(), membership("p2", "c2", PUBLIC)),
        ])
        .unwrap();
    engine
}

// ---- operations ----

#[derive(Clone, Debug, PartialEq, Eq)]
enum Op {
    Send(&'static str, &'static str),
    Burst(&'static str, &'static str),
    RawSend(&'static str, &'static str),
    RawJoin(&'static str, &'static str),
    Leave(&'static str, &'static str),
    Add(&'static str, &'static str, &'static str),
    AddAndSend(&'static str, &'static str, &'static str),
    Blip(&'static str, &'static str, &'static str),
    Kick(&'static str, &'static str, &'static str),
    Rejoin(&'static str, &'static str, &'static str),
    Edit(&'static str, String),
    Unsend(&'static str, String),
    RawUnsend(&'static str, String),
}

impl Op {
    fn actor(&self) -> &'static str {
        match self {
            Op::Send(a, _) | Op::Burst(a, _) | Op::RawSend(a, _) | Op::RawJoin(a, _) | Op::Leave(a, _) => a,
            Op::Add(a, ..) | Op::AddAndSend(a, ..) | Op::Blip(a, ..) | Op::Kick(a, ..) | Op::Rejoin(a, ..) => a,
            Op::Edit(a, _) | Op::Unsend(a, _) | Op::RawUnsend(a, _) => a,
        }
    }

    fn call(&self) -> (&'static str, Vec<(&'static str, Value)>) {
        let conv = |c: &str| ("conversationId", id(c));
        let who = |p: &str| ("principal", id(p));
        let msg = |m: &str| ("messageId", id(m));
        match self {
            Op::Send(_, c) => ("send", vec![conv(c), ("body", text("hi"))]),
            Op::Burst(_, c) => ("burst", vec![conv(c)]),
            Op::RawSend(_, c) => ("rawSend", vec![conv(c)]),
            Op::RawJoin(_, c) => ("rawJoin", vec![conv(c)]),
            Op::Leave(_, c) => ("leave", vec![conv(c)]),
            Op::Add(_, c, p) => ("addMember", vec![conv(c), who(p)]),
            Op::AddAndSend(_, c, p) => ("addAndSend", vec![conv(c), who(p)]),
            Op::Blip(_, c, p) => ("blip", vec![conv(c), who(p)]),
            Op::Kick(_, c, p) => ("kick", vec![conv(c), who(p)]),
            Op::Rejoin(_, c, p) => ("rejoin", vec![conv(c), who(p)]),
            Op::Edit(_, m) => ("edit", vec![msg(m), ("body", text("edited"))]),
            Op::Unsend(_, m) => ("unsend", vec![msg(m)]),
            Op::RawUnsend(_, m) => ("rawUnsend", vec![msg(m)]),
        }
    }

    /// Every write any principal could attempt at a state with `messages`.
    fn all(messages: &[String]) -> Vec<Op> {
        let mut out = Vec::new();
        for a in PRINCIPALS {
            for c in CONVERSATIONS {
                out.extend([Op::Send(a, c), Op::Burst(a, c), Op::RawSend(a, c), Op::RawJoin(a, c), Op::Leave(a, c)]);
                for p in PRINCIPALS {
                    out.extend([Op::Add(a, c, p), Op::AddAndSend(a, c, p), Op::Blip(a, c, p), Op::Kick(a, c, p), Op::Rejoin(a, c, p)]);
                }
            }
            for m in messages {
                out.extend([Op::Edit(a, m.clone()), Op::Unsend(a, m.clone()), Op::RawUnsend(a, m.clone())]);
            }
        }
        out
    }

    /// Branches the exploration takes. Admitting the stranger would leave no
    /// stranger, and an `Add` of a member commits nothing new; both are still
    /// attempted as probes. A blip may name the stranger: it never holds the
    /// grant (review finding 4).
    fn explored(&self, tables: &Tables) -> bool {
        match self {
            Op::Add(_, _, STRANGER) | Op::AddAndSend(_, _, STRANGER) | Op::Kick(_, _, STRANGER) | Op::Rejoin(_, _, STRANGER) => false,
            Op::Add(_, c, p) => !tables.member(c, p),
            _ => true,
        }
    }
}

// ---- the server's tables, and the model ----

/// Every synced table's rows by id, as images without null fields.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Tables(BTreeMap<String, BTreeMap<String, Json>>);

fn image(row: &Value) -> Json {
    match wire::to_json(row) {
        Json::Object(fields) => Json::Object(fields.into_iter().filter(|(_, v)| !v.is_null()).collect()),
        other => other,
    }
}

fn tables(engine: &Engine) -> Tables {
    let mut out = BTreeMap::new();
    for name in backend().synced.keys() {
        let rows = engine.store().rows(name).unwrap();
        out.insert(name.clone(), rows.iter().map(|row| (row.field("id").unwrap().as_str().unwrap().to_owned(), image(row))).collect());
    }
    Tables(out)
}

fn field<'a>(row: &'a Json, name: &str) -> &'a str {
    row[name].as_str().unwrap_or("")
}

impl Tables {
    fn rows(&self, table: &str) -> impl Iterator<Item = (&String, &Json)> {
        self.0.get(table).into_iter().flatten()
    }

    fn role(&self, c: &str, p: &str) -> Option<&str> {
        self.rows("memberships").find(|(_, r)| field(r, "conversationId") == c && field(r, "principal") == p).map(|(_, r)| field(r, "role"))
    }

    fn member(&self, c: &str, p: &str) -> bool {
        self.role(c, p).is_some()
    }

    fn admin(&self, c: &str, p: &str) -> bool {
        self.role(c, p) == Some("admin")
    }

    fn groups(&self, p: &str) -> BTreeSet<String> {
        self.rows("memberships").filter(|(_, r)| field(r, "principal") == p).map(|(_, r)| field(r, "conversationId").to_owned()).collect()
    }

    fn message(&self, m: &str) -> Option<(&str, &str)> {
        self.0.get("messages").and_then(|rows| rows.get(m)).map(|r| (field(r, "conversationId"), field(r, "authorId")))
    }

    /// The model of the read rules: every synced chat table is readable by
    /// the members of the row's conversation (`exists memberships[..,
    /// viewer]`); a public table by everyone.
    fn readable(&self, viewer: &str) -> Tables {
        let groups = self.groups(viewer);
        let mut out = BTreeMap::new();
        for (table, group) in &backend().synced {
            let rows = self.rows(table).filter(|(_, row)| group.as_ref().is_none_or(|column| groups.contains(field(row, column)))).map(|(k, v)| (k.clone(), v.clone())).collect();
            out.insert(table.clone(), rows);
        }
        Tables(out)
    }

    /// The model of the write rules and the mutations' `require`s. `None`
    /// where the outcome is not a security question.
    fn admits(&self, op: &Op) -> Option<bool> {
        Some(match op {
            Op::Send(a, c) | Op::Burst(a, c) | Op::RawSend(a, c) | Op::Leave(a, c) => self.member(c, a),
            // A row cannot witness its own insert rule; a member collides.
            Op::RawJoin(..) => false,
            Op::Add(a, c, _) => self.admin(c, a),
            Op::AddAndSend(a, c, p) | Op::Blip(a, c, p) => self.admin(c, a) && !self.member(c, p),
            // The row is read under the rule first: a non-member finds nothing.
            Op::Kick(a, c, p) => self.member(c, a) && self.member(c, p) && (a == p || self.admin(c, a)),
            // Deleting one's own admin row first leaves no admin to insert.
            Op::Rejoin(a, c, p) => self.admin(c, a) && self.member(c, p) && a != p,
            Op::Edit(a, m) | Op::Unsend(a, m) => self.message(m).is_some_and(|(c, author)| author == *a && self.member(c, a)),
            Op::RawUnsend(a, m) => match self.message(m) {
                Some((c, author)) if author == *a && !self.member(c, a) => return None,
                Some((_, author)) => author == *a,
                None => false,
            },
        })
    }
}

/// What the successful write must have changed, and nothing else.
fn check_effect(before: &Tables, after: &Tables, op: &Op) -> Result<(), String> {
    let diff = |table: &str| {
        let (b, a) = (before.0.get(table).cloned().unwrap_or_default(), after.0.get(table).cloned().unwrap_or_default());
        let added: Vec<Json> = a.iter().filter(|(k, _)| !b.contains_key(*k)).map(|(_, v)| v.clone()).collect();
        let removed: Vec<Json> = b.iter().filter(|(k, _)| !a.contains_key(*k)).map(|(_, v)| v.clone()).collect();
        let changed: Vec<(Json, Json)> = a.iter().filter_map(|(k, v)| b.get(k).filter(|old| *old != v).map(|old| (old.clone(), v.clone()))).collect();
        (added, removed, changed)
    };
    let (m_add, m_del, m_chg) = diff("memberships");
    let (x_add, x_del, x_chg) = diff("messages");
    let membership = |r: &Json, c: &str, p: &str| field(r, "conversationId") == c && field(r, "principal") == p;
    let message = |r: &Json, c: &str, a: &str| field(r, "conversationId") == c && field(r, "authorId") == a;
    let quiet_members = m_add.is_empty() && m_del.is_empty() && m_chg.is_empty();
    let quiet_messages = x_add.is_empty() && x_del.is_empty() && x_chg.is_empty();
    let ok = match op {
        Op::Send(a, c) | Op::RawSend(a, c) => quiet_members && x_add.len() == 1 && message(&x_add[0], c, a) && x_del.is_empty() && x_chg.is_empty(),
        Op::Burst(a, c) => quiet_members && x_add.len() == 2 && x_add.iter().all(|r| message(r, c, a)) && x_del.is_empty() && x_chg.is_empty(),
        Op::Leave(a, c) => quiet_messages && m_add.is_empty() && m_chg.is_empty() && m_del.len() == 1 && membership(&m_del[0], c, a),
        Op::Kick(_, c, p) => quiet_messages && m_add.is_empty() && m_chg.is_empty() && m_del.len() == 1 && membership(&m_del[0], c, p),
        Op::Add(_, c, p) if before.member(c, p) => quiet_members && quiet_messages,
        Op::Add(_, c, p) => quiet_messages && m_del.is_empty() && m_chg.is_empty() && m_add.len() == 1 && membership(&m_add[0], c, p) && field(&m_add[0], "role") == "member",
        Op::AddAndSend(a, c, p) => m_del.is_empty() && m_chg.is_empty() && m_add.len() == 1 && membership(&m_add[0], c, p) && x_add.len() == 1 && message(&x_add[0], c, a) && x_del.is_empty() && x_chg.is_empty(),
        Op::Blip(..) => quiet_members && quiet_messages,
        Op::Rejoin(_, c, p) => quiet_messages && m_chg.is_empty() && m_add.len() == 1 && m_del.len() == 1 && membership(&m_add[0], c, p) && membership(&m_del[0], c, p) && field(&m_add[0], "role") == "member",
        Op::Edit(_, m) => quiet_members && x_add.is_empty() && x_del.is_empty() && x_chg.len() == 1 && field(&x_chg[0].1, "id") == m && field(&x_chg[0].1, "body") == "edited",
        Op::Unsend(_, m) | Op::RawUnsend(_, m) => quiet_members && x_add.is_empty() && x_chg.is_empty() && x_del.len() == 1 && field(&x_del[0], "id") == m,
        Op::RawJoin(..) => false,
    };
    if ok { Ok(()) } else { Err(format!("a write had the wrong effect [memberships +{m_add:?} -{m_del:?} ~{m_chg:?}; messages +{x_add:?} -{x_del:?} ~{x_chg:?}]")) }
}

/// A maintained count equals the messages it counts.
fn check_counts(t: &Tables) -> Result<(), String> {
    for c in CONVERSATIONS {
        let n = t.rows("messages").filter(|(_, r)| field(r, "conversationId") == c).count() as i64;
        let row = t.rows("messageCounts").find(|(_, r)| field(r, "conversationId") == c).map(|(_, r)| r["value"].as_i64().unwrap_or(-1));
        if row.unwrap_or(0) != n || (n > 0 && row.is_none()) {
            return Err(format!("messageCounts does not count the messages [{c}: {row:?}; {n} messages]"));
        }
    }
    Ok(())
}

// ---- devices and delivery ----

/// A device's held rows, applied as the replica does: a put holds the
/// image, a del drops the row, a scope drops the group's rows from the
/// tables whose leave policy is until-revoked.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Device {
    viewer: &'static str,
    watermark: u64,
    rows: BTreeMap<String, BTreeMap<String, Json>>,
}

/// What a principal may ever have been shown along the current path.
#[derive(Clone, Default)]
struct History {
    /// (table, id, image) the principal could read at some node.
    images: BTreeSet<(String, String, String)>,
    ids: BTreeSet<(String, String)>,
    groups: BTreeSet<String>,
}

/// Per path: the conversations each principal was in after each commit.
type Grants = BTreeMap<u64, BTreeSet<(String, String)>>;

struct Node<'a> {
    head: u64,
    now: &'a Tables,
    history: &'a BTreeMap<&'static str, History>,
    grants: &'a Grants,
    transient: &'a Transient,
}

/// Rows and grants that lived only inside one commit (a `blip`).
#[derive(Clone, Default)]
struct Transient {
    rows: BTreeSet<(String, String)>,
    /// (principal, conversation)
    grants: BTreeSet<(String, String)>,
}

impl Device {
    /// Devices that hold the same rows at the same watermark are one device.
    fn key(&self) -> String {
        format!("{} {} {}", self.viewer, self.watermark, serde_json::to_string(&self.rows).unwrap())
    }

    fn apply(&mut self, events: &[snapback4_core::store::LogEvent]) {
        for event in events {
            match event.kind.as_str() {
                "put" => {
                    let data = event.data.as_ref().map(image).unwrap_or(Json::Null);
                    self.rows.entry(event.table.clone()).or_default().insert(event.id.clone(), data);
                }
                "del" => {
                    self.rows.entry(event.table.clone()).or_default().remove(&event.id);
                }
                "scope" => {
                    let group = event.data.as_ref().and_then(|d| d.as_array().ok()).and_then(|g| g.first()).and_then(|v| v.as_str().ok()).unwrap_or("").to_owned();
                    let column = backend().synced.get(&event.table).cloned().flatten();
                    if backend().until_revoked.contains(&event.table)
                        && let (Some(rows), Some(column)) = (self.rows.get_mut(&event.table), column)
                    {
                        rows.retain(|_, row| field(row, &column) != group);
                    }
                }
                _ => {}
            }
        }
    }

    /// Drain the stream from this device's watermark, checking every page.
    fn sync(&mut self, engine: &mut Engine, node: &Node<'_>, limit: usize, errs: &mut Vec<String>) -> Result<(), String> {
        let events = drain(engine, self.viewer, self.watermark, limit, node, errs)?;
        self.apply(&events);
        self.watermark = node.head;
        Ok(())
    }

    fn bootstrap(engine: &mut Engine, viewer: &'static str, node: &Node<'_>, errs: &mut Vec<String>) -> Result<Device, String> {
        let (events, watermark) = engine.snapshot_at(viewer, NOW).map_err(|e| e.to_string())?;
        let mut rows: BTreeMap<String, BTreeMap<String, Json>> = backend().synced.keys().map(|t| (t.clone(), BTreeMap::new())).collect();
        for event in &events {
            if event.kind != EventKind::Put {
                errs.push(format!("a snapshot carries a non-put [{viewer}: {:?} {}/{}]", event.kind, event.table, event.id));
            }
            rows.entry(event.table.clone()).or_default().insert(event.id.clone(), event.data.as_ref().map(image).unwrap_or(Json::Null));
        }
        let want = node.now.readable(viewer);
        if rows != want.0 {
            errs.push(format!("a snapshot is not the rows the rules admit [{viewer} holds {rows:?}; the rules admit {:?}]", want.0));
        }
        if watermark != node.head {
            errs.push(format!("a snapshot is not at the head [{viewer} at {watermark}; head {}]", node.head));
        }
        Ok(Device { viewer, watermark, rows })
    }

    /// After draining: the viewer's groups match the server exactly, and a
    /// retained row lies outside them.
    fn converged(&self, node: &Node<'_>, errs: &mut Vec<String>) {
        let want = node.now.readable(self.viewer);
        let groups = node.now.groups(self.viewer);
        let viewer = self.viewer;
        for (table, rows) in &want.0 {
            let held = self.rows.get(table).cloned().unwrap_or_default();
            if backend().until_revoked.contains(table) {
                if &held != rows {
                    errs.push(format!("a synced device does not hold what the rules admit [{viewer} holds {table} {held:?}; the rules admit {rows:?}]"));
                }
                continue;
            }
            for (key, row) in rows {
                if held.get(key) != Some(row) {
                    errs.push(format!("a synced device lacks a row the rules admit [{viewer} holds {table}/{key} as {:?}; the server has {row:?}]", held.get(key)));
                }
            }
            let column = backend().synced[table].clone();
            for (key, row) in &held {
                if !rows.contains_key(key) && column.as_ref().is_none_or(|c| groups.contains(field(row, c))) {
                    errs.push(format!("a synced device keeps a deleted row of a group it is in [{viewer}: {table}/{key}]"));
                }
            }
        }
    }
}

/// Stream from `from` to the head at `limit` per page, checking each event
/// against what the viewer may be shown. Returns the events in order;
/// property violations go to `errs`, and only a stream that cannot be read
/// to its end is an `Err`.
fn drain(engine: &mut Engine, viewer: &'static str, from: u64, limit: usize, node: &Node<'_>, errs: &mut Vec<String>) -> Result<Vec<snapback4_core::store::LogEvent>, String> {
    let history = &node.history[viewer];
    let want = node.now.readable(viewer);
    let mut watermark = from;
    let mut events = Vec::new();
    for _ in 0..=node.head + 2 {
        let page = engine.stream_at(viewer, watermark, limit, NOW).map_err(|e| e.to_string())?;
        if page.watermark < watermark {
            return Err(format!("a page moves the watermark back [{viewer} from {watermark} to {}]", page.watermark));
        }
        for event in &page.events {
            let at = format!("{viewer} from {from}, limit {limit}, page {watermark}..{}: {} {}/{} at {}", page.watermark, event.kind, event.table, event.id, event.seq);
            if event.seq <= watermark || event.seq > page.watermark {
                errs.push(format!("an event lies outside its page [{at}]"));
            }
            match event.kind.as_str() {
                "put" => {
                    let data = event.data.as_ref().map(image).unwrap_or(Json::Null);
                    let key = (event.table.clone(), event.id.clone(), data.to_string());
                    if !history.images.contains(&key) {
                        errs.push(format!("DISCLOSED a row image the viewer never could read [{at}: {data}]"));
                    } else if want.0.get(&event.table).and_then(|rows| rows.get(&event.id)) != Some(&data) {
                        errs.push(format!("a put is not a row the viewer may read now [{at}: {data}]"));
                    }
                    if let Some(column) = &backend().synced[&event.table] {
                        let group = field(&data, column).to_owned();
                        if !node.grants.get(&event.seq).is_some_and(|g| g.contains(&(group.clone(), viewer.to_owned()))) {
                            errs.push(format!("a put is labelled before the viewer's grant [{at}: group {group}]"));
                        }
                    }
                }
                "del" => {
                    let row = (event.table.clone(), event.id.clone());
                    if node.transient.rows.contains(&row) && !history.ids.contains(&row) {
                        errs.push(format!("{KNOWN} a delete names a row that lived only inside one commit [{at}]"));
                    } else if !history.ids.contains(&row) {
                        errs.push(format!("a delete names a row the viewer never could read [{at}]"));
                    }
                }
                "scope" => {
                    let group = event.data.as_ref().and_then(|d| d.as_array().ok()).and_then(|g| g.first()).and_then(|v| v.as_str().ok()).unwrap_or("");
                    if !history.groups.contains(group) && node.transient.grants.contains(&(viewer.to_owned(), group.to_owned())) {
                        errs.push(format!("{KNOWN} a scope names a group the viewer held only inside one commit [{at}]"));
                    } else if !history.groups.contains(group) {
                        errs.push(format!("a scope names a group the viewer never held [{at}]"));
                    }
                }
                other => errs.push(format!("an event of an unknown kind [{at}: {other}]")),
            }
        }
        events.extend(page.events);
        watermark = page.watermark;
        if !page.more {
            if watermark != node.head {
                errs.push(format!("a drained stream stops short of the head [{viewer} from {from}, limit {limit}: {watermark}; head {}]", node.head));
            }
            return Ok(events);
        }
    }
    Err(format!("a stream does not end [{viewer} from {from}, limit {limit}]"))
}

// ---- the exploration ----

#[derive(Default)]
struct Report {
    nodes: usize,
    probes: usize,
    /// Per property: how many nodes broke it, and the shortest path that did.
    failures: BTreeMap<String, (usize, String)>,
    known: BTreeMap<String, usize>,
}

impl Report {
    fn fail(&mut self, path: &[Op], message: String) {
        let property = message.split(" [").next().unwrap_or(&message).to_owned();
        if property.starts_with(KNOWN) {
            *self.known.entry(property).or_default() += 1;
            return;
        }
        let example = format!("after {path:?}:\n    {message}");
        let entry = self.failures.entry(property).or_insert((0, example.clone()));
        entry.0 += 1;
        if example.len() < entry.1.len() {
            entry.1 = example;
        }
    }

    fn merge(&mut self, other: Report) {
        self.nodes += other.nodes;
        self.probes += other.probes;
        for (property, (n, example)) in other.failures {
            let entry = self.failures.entry(property).or_insert((0, example.clone()));
            entry.0 += n;
            if example.len() < entry.1.len() {
                entry.1 = example;
            }
        }
        for (property, n) in other.known {
            *self.known.entry(property).or_default() += n;
        }
    }

    fn failed(&self) -> bool {
        !self.failures.is_empty()
    }

    fn summary(&self) -> String {
        self.failures.iter().take(MAX_FAILURES).map(|(property, (n, example))| format!("[{n} nodes] {property}\n  shortest: {example}")).collect::<Vec<_>>().join("\n")
    }
}

#[derive(Clone, Default)]
struct PathState {
    devices: Vec<Device>,
    history: BTreeMap<&'static str, History>,
    grants: Grants,
    transient: Transient,
}

/// Operation ids and minted row ids are unique per attempt: a refused
/// operation keeps its receipt, so a second attempt under its id is a
/// replay (LLP 3000 §6 invariant 3). A path's writes are named by their
/// step, so every replay of the path mints the same rows.
fn run(engine: &mut Engine, op: &Op, step: usize, name: &str) -> Result<Option<u64>, String> {
    let (mutation, args) = op.call();
    let args = args.into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
    let ids = (0..4).map(|n| format!("{name}{}", (b'a' + n as u8) as char));
    let context = Context::new(op.actor(), args).at(1_000 * (step as i64 + 1)).with_ids(ids);
    match engine.mutate(mutation, Some(name), context).map_err(|e| format!("{op:?}: {e}"))?.state {
        WriteState::Sent { seq, .. } => Ok(Some(seq)),
        WriteState::Failed { .. } => Ok(None),
    }
}

/// Visit the node `path` reaches, whose last write the model expects to be
/// admitted or does not judge. Returns without a node when the engine
/// refuses a write the model does not judge.
fn visit(path: &mut Vec<Op>, parent: &PathState, depth: usize, report: &mut Report) {
    let mut engine = fresh();
    for (step, op) in path[..path.len() - 1].iter().enumerate() {
        if run(&mut engine, op, step, &format!("s{step}")).ok().flatten().is_none() {
            return report.fail(path, format!("a replayed write did not commit again [{op:?}]"));
        }
    }
    let before = tables(&engine);
    let last = path.last().unwrap().clone();
    let expected = before.admits(&last);
    let step = path.len() - 1;
    let outcome = match run(&mut engine, &last, step, &format!("s{step}")) {
        Ok(outcome) => outcome,
        Err(e) => return report.fail(path, e),
    };
    match (expected, outcome) {
        (Some(false), Some(_)) => return report.fail(path, "WRITE AUTHORITY: the rules should have refused the last write".into()),
        (Some(true), None) => return report.fail(path, "the model admits the last write; the engine refused it".into()),
        (None, None) => return,
        _ => {}
    }
    let after = tables(&engine);
    if let Err(e) = check_effect(&before, &after, &last) {
        return report.fail(path, e);
    }
    let head = engine.seq().unwrap();
    // Invariant 3: the same operation id, sent again, applies nothing new.
    match run(&mut engine, &last, step, &format!("s{step}")) {
        Ok(again) if again == outcome && engine.seq().unwrap() == head && tables(&engine) == after => {}
        other => report.fail(path, format!("a resent operation id applied again or changed its answer [{other:?}; first {outcome:?}]")),
    }
    let mut state = parent.clone();
    if let Op::Blip(_, c, p) = &last {
        state.transient.rows.insert(("memberships".to_owned(), format!("s{step}a")));
        state.transient.grants.insert(((*p).to_owned(), (*c).to_owned()));
    }
    match check_node(&mut engine, head, &after, &mut state) {
        Ok(errs) => errs.into_iter().for_each(|e| report.fail(path, e)),
        Err(e) => return report.fail(path, e),
    }
    report.nodes += 1;
    explore(&mut engine, path, &after, &state, depth, report);
}

/// Record the node, then check every principal's snapshot, every stream it
/// can request, and every device schedule that reaches it.
// @ref LLP 3000#6-the-simulators-invariants — invariants 2, 3, 6 and 7 at every reachable state of the small scope, not at sampled ones.
fn check_node(engine: &mut Engine, head: u64, now: &Tables, state: &mut PathState) -> Result<Vec<String>, String> {
    let mut errs = Vec::new();
    if let Err(e) = check_counts(now) {
        errs.push(e);
    }
    state.grants.insert(head, PRINCIPALS.iter().flat_map(|p| now.groups(p).into_iter().map(move |c| (c, (*p).to_owned()))).collect());
    for p in PRINCIPALS {
        let history = state.history.entry(p).or_default();
        for (table, rows) in &now.readable(p).0 {
            for (key, row) in rows {
                history.images.insert((table.clone(), key.clone(), row.to_string()));
                history.ids.insert((table.clone(), key.clone()));
            }
        }
        history.groups.extend(now.groups(p));
    }
    let node = Node { head, now, history: &state.history, grants: &state.grants, transient: &state.transient };
    let mut devices = Vec::new();
    let mut seen = BTreeSet::new();
    let mut keep = |device: Device| {
        if seen.insert(device.key()) {
            devices.push(device);
        }
    };
    for p in PRINCIPALS {
        keep(Device::bootstrap(engine, p, &node, &mut errs)?);
        for from in 0..=head {
            let mut small = Device { viewer: p, watermark: from, rows: BTreeMap::new() };
            let mut large = small.clone();
            small.sync(engine, &node, 1, &mut errs)?;
            large.sync(engine, &node, 1_000, &mut errs)?;
            if small.rows != large.rows {
                errs.push(format!("the page size changes what a stream applies [{p} from {from}: limit 1 {:?}; limit 1000 {:?}]", small.rows, large.rows));
            }
        }
    }
    for device in &state.devices {
        keep(device.clone());
        let mut synced = device.clone();
        synced.sync(engine, &node, 1, &mut errs)?;
        synced.converged(&node, &mut errs);
        keep(synced);
    }
    state.devices = devices;
    errs.sort();
    errs.dedup();
    Ok(errs)
}

/// At a node: attempt every write the model refuses (each must fail without
/// a commit), then branch on every write it admits or does not judge.
fn explore(engine: &mut Engine, path: &mut Vec<Op>, now: &Tables, state: &PathState, depth: usize, report: &mut Report) {
    for op in probe(engine, path, now, depth, report) {
        path.push(op);
        visit(path, state, depth, report);
        path.pop();
    }
}

/// Attempt the refused writes; return the branches.
fn probe(engine: &mut Engine, path: &mut Vec<Op>, now: &Tables, depth: usize, report: &mut Report) -> Vec<Op> {
    let messages: Vec<String> = now.rows("messages").map(|(k, _)| k.clone()).collect();
    let head = engine.seq().unwrap();
    let mut branches = Vec::new();
    for op in Op::all(&messages) {
        match now.admits(&op) {
            Some(false) => {
                report.probes += 1;
                match run(engine, &op, path.len(), &format!("q{}", report.probes)) {
                    Ok(None) if engine.seq().unwrap() == head => {}
                    Ok(None) => {
                        report.fail(path, format!("a refused write advanced the head [{op:?}]"));
                        return Vec::new();
                    }
                    Ok(Some(_)) => {
                        path.push(op);
                        report.fail(path, "WRITE AUTHORITY: the rules should have refused the last write".into());
                        path.pop();
                        return Vec::new();
                    }
                    Err(e) => {
                        report.fail(path, e);
                        return Vec::new();
                    }
                }
            }
            _ if path.len() < depth && op.explored(now) => branches.push(op),
            _ => {}
        }
    }
    branches
}

fn exhaust(depth: usize) -> Report {
    let mut report = Report::default();
    let mut engine = fresh();
    let head = engine.seq().unwrap();
    let now = tables(&engine);
    let mut state = PathState::default();
    match check_node(&mut engine, head, &now, &mut state) {
        Ok(errs) => errs.into_iter().for_each(|e| report.fail(&[], e)),
        Err(e) => {
            report.fail(&[], e);
            return report;
        }
    }
    report.nodes += 1;
    // The root's subtrees are independent: each replays from a fresh engine.
    // Engine creation dominates, and SQLite's allocator mutex serializes it
    // across threads: two threads halve the time; more add contention.
    let branches = probe(&mut engine, &mut Vec::new(), &now, depth, &mut report);
    let threads = std::env::var("SNAPBACK4_EXHAUSTIVE_THREADS").ok().and_then(|t| t.parse().ok()).unwrap_or(2);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let reports: Vec<Report> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads)
            .map(|_| {
                scope.spawn(|| {
                    let mut report = Report::default();
                    loop {
                        let n = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(op) = branches.get(n) else { return report };
                        visit(&mut vec![op.clone()], &state, depth, &mut report);
                    }
                })
            })
            .collect();
        workers.into_iter().map(|w| w.join().unwrap()).collect()
    });
    reports.into_iter().for_each(|r| report.merge(r));
    report
}

fn assert_clean(report: Report, depth: usize) {
    eprintln!("exhaustive depth {depth}: {} nodes, {} refused writes attempted", report.nodes, report.probes);
    for (property, n) in &report.known {
        eprintln!("  tolerated {n} times: {property}");
    }
    assert!(!report.failed(), "{} kind(s) of failure:\n{}", report.failures.len(), report.summary());
}

#[test]
fn every_sequence_of_two_writes_keeps_disclosure_and_authority() {
    assert_clean(exhaust(BLOCKING_DEPTH), BLOCKING_DEPTH);
}

#[test]
#[ignore = "opt-in: SNAPBACK4_EXHAUSTIVE_DEPTH (default 3); minutes at depth 3"]
fn deeper() {
    let depth = std::env::var("SNAPBACK4_EXHAUSTIVE_DEPTH").ok().and_then(|d| d.parse().ok()).unwrap_or(3);
    assert_clean(exhaust(depth), depth);
}
