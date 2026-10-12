//! Exhaustive small-scope checking of union sync audiences (LLP 3000.036.000.000 §6).
//!
//! A table synced to the union of principal-column audiences and one group
//! audience must keep the device's two halves of the invariant: never hold
//! an image the viewer may not read (D1/D2, disclosure), and never miss one
//! it may (retention), so that every page the device certifies is complete.
//! Each world below enumerates every sequence of up to `DEPTH` successful
//! writes against the real engine, with a model of the rules written from
//! the schema text, and at every node checks:
//!
//! - write authority: every write the model refuses is refused without a
//!   commit; a resent operation applies nothing new;
//! - each principal's snapshot is exactly the rows the model admits;
//! - a stream from every watermark, at page sizes 1 and 1000, puts only
//!   images readable now and at some node of the path, deletes only rows
//!   the viewer could read at some node, scopes only groups it held, ends at
//!   the head, and applies to the same rows at both sizes;
//! - every model device that bootstrapped at an earlier node, and every one
//!   that applied only the first page of a stream at an earlier node, holds
//!   exactly the readable rows after draining;
//! - a real `snapback4-device` memory store that acquired at the root and
//!   followed the stream after every write, and one that acquired at the
//!   node, answer each of the world's queries; every answer it reports
//!   complete equals the server's, and a query whose pins the viewer reads
//!   must be complete.
//!
//! Every hazard of §4.1 is reachable at depth 1: Alice is in both teams and
//! owns a task in team 1, so giving it away (H1 through the column arm),
//! moving it between her teams (H1 between two groups), and leaving team 1
//! (H2) are single writes. Compound commits run both orders, and `bounce`
//! moves a task through a team and back inside one commit (the transient of
//! §3). `SNAPBACK4_UNION_NAIVE=1` replaces the device's R2 with the naive
//! leave in the model devices, so the test shows what the naive device loses.

use serde_json::{Value as Json, json};
use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::partition::EventKind;
use snapback4_core::schema::Schema;
use snapback4_core::value::{Value, object};
use snapback4_core::wire;
use std::collections::{BTreeMap, BTreeSet};

const ALICE: &str = "dev:alice";
const BOB: &str = "dev:bob";
const MALLORY: &str = "dev:mallory";
const PRINCIPALS: [&str; 3] = [ALICE, BOB, MALLORY];
const NOW: i64 = 1_000_000_000;
const BLOCKING_DEPTH: usize = 2;

type Rows = BTreeMap<String, BTreeMap<String, Json>>;

/// One operation: who runs which mutation with which arguments, and what
/// the model calls it.
#[derive(Clone, Debug)]
struct Op {
    actor: &'static str,
    kind: &'static str,
    args: Vec<(&'static str, Value)>,
}

impl Op {
    fn new(actor: &'static str, kind: &'static str, args: &[(&'static str, Value)]) -> Self {
        Self { actor, kind, args: args.to_vec() }
    }
    fn arg(&self, name: &str) -> &str {
        match self.args.iter().find(|(key, _)| *key == name).map(|(_, value)| value) {
            Some(Value::Id(id) | Value::String(id)) => id,
            _ => "",
        }
    }
}

/// A world: a schema, its seed, the model of its rules, its writes and the
/// queries a real device answers.
struct World {
    name: &'static str,
    source: String,
    /// The synced tables the model and the devices compare.
    tables: &'static [&'static str],
    seed: fn() -> Vec<(String, Value)>,
    /// The rows of each table the viewer may read now.
    readable: fn(&Rows, &str) -> Rows,
    /// The (content table, group) pairs the viewer holds now: the groups a
    /// scope may name.
    groups: fn(&Rows, &str) -> BTreeSet<(String, String)>,
    /// Every write any principal could attempt at a state.
    ops: fn(&Rows) -> Vec<Op>,
    /// The model of the write rules: `None` where the program itself
    /// refuses (a lookup the caller cannot read, a duplicate).
    admits: fn(&Rows, &Op) -> Option<bool>,
    /// R2: the column of each content table's group arm, and its column arms.
    group_column: fn(&str) -> Option<&'static str>,
    column_arms: fn(&str) -> &'static [&'static str],
    /// The queries a real device answers for a viewer: (name, args, whether
    /// the viewer reads the query's pins, so the answer must be complete).
    queries: fn(&Rows, &str) -> Vec<(&'static str, Json, bool)>,
    /// With windows a device holds a subset of the readable rows: the newest
    /// row of each arm group it holds, and nothing it may not read.
    newest: Option<fn(&Rows, &str) -> BTreeSet<(String, String)>>,
}

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn image(row: &Value) -> Json {
    match wire::to_json(row) {
        Json::Object(fields) => Json::Object(fields.into_iter().filter(|(_, v)| !v.is_null()).collect()),
        other => other,
    }
}

fn field<'a>(row: &'a Json, name: &str) -> &'a str {
    row[name].as_str().unwrap_or("")
}

fn naive() -> bool {
    std::env::var("SNAPBACK4_UNION_NAIVE").is_ok_and(|v| v == "1")
}

// ---- the owner-or-team world ----

const TEAMS: &str = "
table teams:
  name: text <=20
  read <- exists members[.id, viewer]
  insert <- deny
  sync

table members:
  team: teams
  principal: principal
  unique team, principal
  immutable team, principal
  read <- exists members[.team, viewer]
  insert <- exists members[.team, viewer]
  delete <- .principal = viewer
  sync

table tasks:
  owner: principal
  team: teams
  title: text <=20
  at: time
  by byOwner: owner, id
  by byTeam: team, id
  by aSearch: team, words(title), id
  read <- .owner = viewer or exists members[.team, viewer]
  insert <- .owner = viewer and exists members[.team, viewer]
  update (old, next) <- old.owner = viewer
  delete <- .owner = viewer
  sync

query myTasks():
  return tasks where .owner = viewer first 20 by .id
query teamTasks(team: teams):
  return tasks where .team = team first 20 by .id
query task(t: tasks):
  return tasks[t]
query myCount():
  return count(tasks where .owner = viewer)
query haveAny():
  return exists tasks where .owner = viewer
query teamHas(team: teams):
  return exists tasks where .team = team

mutation create(team: teams):
  return insert tasks { owner: viewer, team, title: 'x', at: now }
mutation give(task: tasks, to: principal):
  t = tasks[task] ! else NOT_FOUND
  update tasks[t] { owner: to }
  return null
mutation move(task: tasks, team: teams):
  t = tasks[task] ! else NOT_FOUND
  update tasks[t] { team }
  return null
mutation remove(task: tasks):
  t = tasks[task] ! else NOT_FOUND
  delete tasks[t]
  return null
mutation add(team: teams, who: principal):
  return insert members { team, principal: who }
mutation leave(team: teams):
  m = members[team, viewer] ! else NOT_MEMBER
  delete members[m]
  return null
mutation giveThenLeave(task: tasks, to: principal, team: teams):
  t = tasks[task] ! else NOT_FOUND
  update tasks[t] { owner: to }
  m = members[team, viewer] ! else NOT_MEMBER
  delete members[m]
  return null
mutation leaveThenGive(task: tasks, to: principal, team: teams):
  m = members[team, viewer] ! else NOT_MEMBER
  delete members[m]
  t = tasks[task] ! else NOT_FOUND
  update tasks[t] { owner: to }
  return null
mutation moveThenGive(task: tasks, team: teams, to: principal):
  t = tasks[task] ! else NOT_FOUND
  update tasks[t] { team }
  update tasks[t] { owner: to }
  return null
mutation addThenRemove(team: teams, who: principal, task: tasks):
  insert members { team, principal: who }
  t = tasks[task] ! else NOT_FOUND
  delete tasks[t]
  return null
mutation removeThenAdd(team: teams, who: principal, task: tasks):
  t = tasks[task] ! else NOT_FOUND
  delete tasks[t]
  insert members { team, principal: who }
  return null
mutation addThenMove(team: teams, who: principal, task: tasks, to: teams):
  insert members { team, principal: who }
  t = tasks[task] ! else NOT_FOUND
  update tasks[t] { team: to }
  return null
mutation bounce(task: tasks, via: teams):
  t = tasks[task] ! else NOT_FOUND
  home = t.team
  update tasks[t] { team: via }
  update tasks[t] { team: home }
  return null
";

const TEAM_IDS: [&str; 2] = ["t1", "t2"];

fn teams_seed() -> Vec<(String, Value)> {
    let member = |key: &str, team: &str, who: &str| ("members".to_owned(), object([("id", id(key)), ("team", id(team)), ("principal", id(who))]));
    let task = |key: &str, owner: &str, team: &str, at: i64| ("tasks".to_owned(), object([("id", id(key)), ("owner", id(owner)), ("team", id(team)), ("title", Value::String("x".into())), ("at", Value::Int(at))]));
    vec![
        ("teams".to_owned(), object([("id", id("t1")), ("name", Value::String("one".into()))])),
        ("teams".to_owned(), object([("id", id("t2")), ("name", Value::String("two".into()))])),
        member("ma1", "t1", ALICE),
        member("ma2", "t2", ALICE),
        member("mb2", "t2", BOB),
        task("ka", ALICE, "t1", 1),
        // An empty title has no entry in the word index that sorts before byTeam:
        // a leave must walk a plain index (round 2, GPT finding 2).
        ("tasks".to_owned(), object([("id", id("kb")), ("owner", id(BOB)), ("team", id("t2")), ("title", Value::String(String::new())), ("at", Value::Int(2))])),
    ]
}

fn member_of(now: &Rows, team: &str, p: &str) -> bool {
    now["members"].values().any(|row| field(row, "team") == team && field(row, "principal") == p)
}

fn teams_readable(now: &Rows, p: &str) -> Rows {
    let mut out = Rows::new();
    out.insert("teams".into(), now["teams"].iter().filter(|(key, _)| member_of(now, key, p)).map(|(k, v)| (k.clone(), v.clone())).collect());
    out.insert("members".into(), now["members"].iter().filter(|(_, row)| member_of(now, field(row, "team"), p)).map(|(k, v)| (k.clone(), v.clone())).collect());
    out.insert("tasks".into(), now["tasks"].iter().filter(|(_, row)| field(row, "owner") == p || member_of(now, field(row, "team"), p)).map(|(k, v)| (k.clone(), v.clone())).collect());
    out
}

fn teams_groups(now: &Rows, p: &str) -> BTreeSet<(String, String)> {
    let mut out = BTreeSet::new();
    for team in TEAM_IDS {
        if member_of(now, team, p) {
            for table in ["teams", "members", "tasks"] { out.insert((table.to_owned(), team.to_owned())); }
        }
    }
    out
}

fn teams_ops(now: &Rows) -> Vec<Op> {
    let mut out = Vec::new();
    let tasks: Vec<String> = now["tasks"].keys().cloned().collect();
    for actor in PRINCIPALS {
        for team in TEAM_IDS {
            out.push(Op::new(actor, "create", &[("team", id(team))]));
            out.push(Op::new(actor, "leave", &[("team", id(team))]));
            for who in PRINCIPALS { if who != actor { out.push(Op::new(actor, "add", &[("team", id(team)), ("who", id(who))])); } }
        }
        for task in &tasks {
            let home = field(&now["tasks"][task], "team").to_owned();
            let other = if home == "t1" { "t2" } else { "t1" };
            out.push(Op::new(actor, "remove", &[("task", id(task))]));
            out.push(Op::new(actor, "move", &[("task", id(task)), ("team", id(other))]));
            out.push(Op::new(actor, "bounce", &[("task", id(task)), ("via", id(other))]));
            // Acquisition beside a delete or a move out, in one commit (round 2, GPT finding 1).
            for who in PRINCIPALS {
                if who == actor { continue; }
                out.push(Op::new(actor, "addThenRemove", &[("team", id(&home)), ("who", id(who)), ("task", id(task))]));
                out.push(Op::new(actor, "removeThenAdd", &[("team", id(&home)), ("who", id(who)), ("task", id(task))]));
                out.push(Op::new(actor, "addThenMove", &[("team", id(&home)), ("who", id(who)), ("task", id(task)), ("to", id(other))]));
            }
            for to in PRINCIPALS {
                if to == actor { continue; }
                out.push(Op::new(actor, "give", &[("task", id(task)), ("to", id(to))]));
                out.push(Op::new(actor, "giveThenLeave", &[("task", id(task)), ("to", id(to)), ("team", id(&home))]));
                out.push(Op::new(actor, "leaveThenGive", &[("task", id(task)), ("to", id(to)), ("team", id(&home))]));
                out.push(Op::new(actor, "moveThenGive", &[("task", id(task)), ("team", id(other)), ("to", id(to))]));
            }
        }
    }
    out
}

fn teams_admits(now: &Rows, op: &Op) -> Option<bool> {
    let a = op.actor;
    let task = now["tasks"].get(op.arg("task"));
    // The program's lookup reads the task under its read rule first.
    let reads = |task: &Json| field(task, "owner") == a || member_of(now, field(task, "team"), a);
    let owner = |task: &Json| field(task, "owner") == a;
    match op.kind {
        "create" => Some(member_of(now, op.arg("team"), a)),
        "add" => if member_of(now, op.arg("team"), op.arg("who")) { None } else { Some(member_of(now, op.arg("team"), a)) },
        "leave" => if member_of(now, op.arg("team"), a) { Some(true) } else { None },
        "remove" | "give" | "move" | "moveThenGive" | "bounce" => match task {
            Some(task) if reads(task) => Some(owner(task)),
            _ => None,
        },
        "giveThenLeave" => match task {
            Some(task) if reads(task) && owner(task) => if member_of(now, op.arg("team"), a) { Some(true) } else { None },
            Some(task) if reads(task) => Some(false),
            _ => None,
        },
        "addThenRemove" | "removeThenAdd" | "addThenMove" => {
            // The insert needs the caller in the team and the principal outside it;
            // the lookup needs the task readable; the write needs its owner.
            if member_of(now, op.arg("team"), op.arg("who")) { return None; }
            match task {
                Some(task) if reads(task) && member_of(now, op.arg("team"), a) => Some(owner(task)),
                Some(task) if reads(task) => Some(false),
                _ => if member_of(now, op.arg("team"), a) && op.kind == "removeThenAdd" { None } else if !member_of(now, op.arg("team"), a) { Some(false) } else { None },
            }
        }
        "leaveThenGive" => {
            if !member_of(now, op.arg("team"), a) { return None; }
            // After leaving, the task is readable only to its owner.
            match task {
                Some(task) if owner(task) => Some(true),
                _ => None,
            }
        }
        other => panic!("unknown op {other}"),
    }
}

fn teams_queries(now: &Rows, viewer: &str) -> Vec<(&'static str, Json, bool)> {
    let mut out = vec![("myTasks", json!({}), true), ("myCount", json!({}), true), ("haveAny", json!({}), true)];
    for team in TEAM_IDS {
        out.push(("teamTasks", json!({"team": team}), member_of(now, team, viewer)));
        out.push(("teamHas", json!({"team": team}), member_of(now, team, viewer)));
    }
    for task in now["tasks"].keys().chain(["gone".to_owned()].iter()) {
        out.push(("task", json!({"t": task}), true));
    }
    out
}

fn teams_world() -> World {
    World {
        name: "owner or team",
        source: TEAMS.to_owned(),
        tables: &["teams", "members", "tasks"],
        seed: teams_seed,
        readable: teams_readable,
        groups: teams_groups,
        ops: teams_ops,
        admits: teams_admits,
        group_column: |table| match table { "teams" => Some("id"), "members" | "tasks" => Some("team"), _ => None },
        column_arms: |table| if table == "tasks" { &["owner"] } else { &[] },
        queries: teams_queries,
        newest: None,
    }
}

// ---- the windowed owner-or-team world ----

/// The same world with a window of one row per arm group (§5): the owner's
/// newest task, and each held team's newest task.
fn windowed_world() -> World {
    let source = TEAMS
        .replace("  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n  update (old, next) <- old.owner = viewer\n  delete <- .owner = viewer\n  sync\n",
                 "  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n  update (old, next) <- old.owner = viewer\n  delete <- .owner = viewer\n  sync last 1 by .at\n")
        .replace("query myTasks():\n  return tasks where .owner = viewer first 20 by .id\nquery teamTasks(team: teams):\n  return tasks where .team = team first 20 by .id\nquery task(t: tasks):\n  return tasks[t]\nquery myCount():\n  return count(tasks where .owner = viewer)\n",
                 "query myLatest():\n  return tasks where .owner = viewer last 1 by .at\nquery myTasks():\n  return tasks where .owner = viewer last 5 by .at\nquery teamLatest(team: teams):\n  return tasks where .team = team last 1 by .at\nquery teamTasks(team: teams):\n  return tasks where .team = team last 5 by .at\nquery task(t: tasks):\n  return tasks[t]\n");
    assert!(source.contains("sync last 1 by .at") && source.contains("myLatest"), "the windowed source");
    World {
        name: "owner or team, windowed",
        source,
        newest: Some(|now, p| {
            let readable = teams_readable(now, p);
            let newest = |rows: Vec<(&String, &Json)>| rows.into_iter().max_by_key(|(key, row)| (row["at"].as_i64().unwrap_or(0), (*key).clone())).map(|(key, _)| key.clone());
            let mut out = BTreeSet::new();
            if let Some(key) = newest(readable["tasks"].iter().filter(|(_, row)| field(row, "owner") == p).collect()) { out.insert(("tasks".to_owned(), key)); }
            for team in TEAM_IDS {
                if member_of(now, team, p) && let Some(key) = newest(readable["tasks"].iter().filter(|(_, row)| field(row, "team") == team).collect()) { out.insert(("tasks".to_owned(), key)); }
            }
            out
        }),
        queries: |now, viewer| {
            let mut out = vec![("myLatest", json!({}), true), ("myTasks", json!({}), false)];
            for team in TEAM_IDS {
                out.push(("teamLatest", json!({"team": team}), member_of(now, team, viewer)));
                out.push(("teamTasks", json!({"team": team}), false));
            }
            for task in now["tasks"].keys() { out.push(("task", json!({"t": task}), false)); }
            out
        },
        ..teams_world()
    }
}

// ---- the owner-or-staff world (an empty-group roster arm) ----

const STAFF: &str = "
table staff:
  principal: principal
  unique principal
  read <- exists staff[viewer]
  insert <- exists staff[viewer]
  delete <- .principal = viewer
  sync

table requests:
  owner: principal
  title: text <=20
  at: time
  by byOwner: owner, id
  read <- .owner = viewer or exists staff[viewer]
  insert <- .owner = viewer
  update (old, next) <- old.owner = viewer
  delete <- .owner = viewer
  sync

query mine():
  return requests where .owner = viewer first 20 by .id
query request(r: requests):
  return requests[r]

mutation open():
  return insert requests { owner: viewer, title: 'x', at: now }
mutation give(request: requests, to: principal):
  r = requests[request] ! else NOT_FOUND
  update requests[r] { owner: to }
  return null
mutation remove(request: requests):
  r = requests[request] ! else NOT_FOUND
  delete requests[r]
  return null
mutation hire(who: principal):
  return insert staff { principal: who }
mutation quit():
  s = staff[viewer] ! else NOT_STAFF
  delete staff[s]
  return null
mutation giveThenQuit(request: requests, to: principal):
  r = requests[request] ! else NOT_FOUND
  update requests[r] { owner: to }
  s = staff[viewer] ! else NOT_STAFF
  delete staff[s]
  return null
mutation quitThenGive(request: requests, to: principal):
  s = staff[viewer] ! else NOT_STAFF
  delete staff[s]
  r = requests[request] ! else NOT_FOUND
  update requests[r] { owner: to }
  return null
";

fn staff_of(now: &Rows, p: &str) -> bool {
    now["staff"].values().any(|row| field(row, "principal") == p)
}

fn staff_world() -> World {
    World {
        name: "owner or staff",
        source: STAFF.to_owned(),
        tables: &["staff", "requests"],
        seed: || {
            let request = |key: &str, owner: &str, at: i64| ("requests".to_owned(), object([("id", id(key)), ("owner", id(owner)), ("title", Value::String("x".into())), ("at", Value::Int(at))]));
            vec![("staff".to_owned(), object([("id", id("sa")), ("principal", id(ALICE))])), request("ra", ALICE, 1), request("rb", BOB, 2)]
        },
        readable: |now, p| {
            let staff = staff_of(now, p);
            let mut out = Rows::new();
            out.insert("staff".into(), if staff { now["staff"].clone() } else { BTreeMap::new() });
            out.insert("requests".into(), now["requests"].iter().filter(|(_, row)| staff || field(row, "owner") == p).map(|(k, v)| (k.clone(), v.clone())).collect());
            out
        },
        groups: |now, p| if staff_of(now, p) { [("staff".to_owned(), String::new()), ("requests".to_owned(), String::new())].into() } else { BTreeSet::new() },
        ops: |now| {
            let mut out = Vec::new();
            for actor in PRINCIPALS {
                out.push(Op::new(actor, "open", &[]));
                out.push(Op::new(actor, "quit", &[]));
                for who in PRINCIPALS { if who != actor { out.push(Op::new(actor, "hire", &[("who", id(who))])); } }
                for request in now["requests"].keys() {
                    out.push(Op::new(actor, "remove", &[("request", id(request))]));
                    for to in PRINCIPALS {
                        if to == actor { continue; }
                        for kind in ["give", "giveThenQuit", "quitThenGive"] { out.push(Op::new(actor, kind, &[("request", id(request)), ("to", id(to))])); }
                    }
                }
            }
            out
        },
        admits: |now, op| {
            let a = op.actor;
            let request = now["requests"].get(op.arg("request"));
            let reads = |row: &Json| staff_of(now, a) || field(row, "owner") == a;
            let owner = |row: &Json| field(row, "owner") == a;
            match op.kind {
                "open" => Some(true),
                "hire" => if staff_of(now, op.arg("who")) { None } else { Some(staff_of(now, a)) },
                "quit" => if staff_of(now, a) { Some(true) } else { None },
                "remove" | "give" => match request { Some(row) if reads(row) => Some(owner(row)), _ => None },
                "giveThenQuit" => match request {
                    Some(row) if reads(row) && owner(row) => if staff_of(now, a) { Some(true) } else { None },
                    Some(row) if reads(row) => Some(false),
                    _ => None,
                },
                "quitThenGive" => if !staff_of(now, a) { None } else { match request { Some(row) if owner(row) => Some(true), _ => None } },
                other => panic!("unknown op {other}"),
            }
        },
        group_column: |_| None,
        column_arms: |table| if table == "requests" { &["owner"] } else { &[] },
        queries: |now, _| {
            let mut out = vec![("mine", json!({}), true)];
            for request in now["requests"].keys().chain(["gone".to_owned()].iter()) { out.push(("request", json!({"r": request}), true)); }
            out
        },
        newest: None,
    }
}

// ---- the two-parties world ----

const PARTIES: &str = "
table orders:
  buyer: principal
  seller: principal
  title: text <=20
  by byBuyer: buyer, id
  by bySeller: seller, id
  read <- .buyer = viewer or .seller = viewer
  insert <- .seller = viewer
  update (old, next) <- old.seller = viewer
  delete <- .seller = viewer
  sync

query buys():
  return orders where .buyer = viewer first 20 by .id
query sales():
  return orders where .seller = viewer first 20 by .id
query order(o: orders):
  return orders[o]

mutation list(buyer: principal):
  return insert orders { buyer, seller: viewer, title: 'x' }
mutation assign(order: orders, buyer: principal):
  o = orders[order] ! else NOT_FOUND
  update orders[o] { buyer }
  return null
mutation handOver(order: orders, seller: principal):
  o = orders[order] ! else NOT_FOUND
  update orders[o] { seller }
  return null
mutation remove(order: orders):
  o = orders[order] ! else NOT_FOUND
  delete orders[o]
  return null
mutation bounce(order: orders, via: principal):
  o = orders[order] ! else NOT_FOUND
  home = o.buyer
  update orders[o] { buyer: via }
  update orders[o] { buyer: home }
  return null
";

fn parties_world() -> World {
    World {
        name: "two parties",
        source: PARTIES.to_owned(),
        tables: &["orders"],
        seed: || {
            let order = |key: &str, buyer: &str, seller: &str| ("orders".to_owned(), object([("id", id(key)), ("buyer", id(buyer)), ("seller", id(seller)), ("title", Value::String("x".into()))]));
            vec![order("oa", BOB, ALICE), order("ob", BOB, BOB)]
        },
        readable: |now, p| [("orders".to_owned(), now["orders"].iter().filter(|(_, row)| field(row, "buyer") == p || field(row, "seller") == p).map(|(k, v)| (k.clone(), v.clone())).collect())].into(),
        groups: |_, _| BTreeSet::new(),
        ops: |now| {
            let mut out = Vec::new();
            for actor in PRINCIPALS {
                for who in PRINCIPALS { out.push(Op::new(actor, "list", &[("buyer", id(who))])); }
                for order in now["orders"].keys() {
                    out.push(Op::new(actor, "remove", &[("order", id(order))]));
                    for who in PRINCIPALS {
                        out.push(Op::new(actor, "assign", &[("order", id(order)), ("buyer", id(who))]));
                        out.push(Op::new(actor, "handOver", &[("order", id(order)), ("seller", id(who))]));
                        out.push(Op::new(actor, "bounce", &[("order", id(order)), ("via", id(who))]));
                    }
                }
            }
            out
        },
        admits: |now, op| {
            let a = op.actor;
            match op.kind {
                "list" => Some(true),
                _ => match now["orders"].get(op.arg("order")) {
                    Some(row) if field(row, "buyer") == a || field(row, "seller") == a => Some(field(row, "seller") == a),
                    _ => None,
                },
            }
        },
        group_column: |_| None,
        column_arms: |_| &["buyer", "seller"],
        queries: |now, _| {
            let mut out = vec![("buys", json!({}), true), ("sales", json!({}), true)];
            for order in now["orders"].keys().chain(["gone".to_owned()].iter()) { out.push(("order", json!({"o": order}), true)); }
            out
        },
        newest: None,
    }
}

// ---- three parties, spelled explicitly ----

/// Two parties plus an agent, with the union written out: three column arms
/// in one `also`-carrying declaration, a scope-free world whose rows sit in
/// up to three of a viewer's partitions at once.
fn three_world() -> World {
    let source = PARTIES
        .replace("  seller: principal\n  title", "  seller: principal\n  agent: principal\n  title")
        .replace("  by bySeller: seller, id\n", "  by bySeller: seller, id\n  by byAgent: agent, id\n")
        .replace("  read <- .buyer = viewer or .seller = viewer\n", "  read <- .buyer = viewer or .seller = viewer or .agent = viewer\n")
        .replace("  delete <- .seller = viewer\n  sync\n", "  delete <- .seller = viewer\n  sync to .agent or .seller or .buyer\n")
        .replace("mutation list(buyer: principal):\n  return insert orders { buyer, seller: viewer, title: 'x' }", "mutation list(buyer: principal):\n  return insert orders { buyer, seller: viewer, agent: buyer, title: 'x' }\nmutation appoint(order: orders, agent: principal):\n  o = orders[order] ! else NOT_FOUND\n  update orders[o] { agent }\n  return null");
    assert!(source.contains("sync to .agent or .seller or .buyer") && source.contains("mutation appoint"), "the three-party source");
    let readable = |now: &Rows, p: &str| -> Rows { [("orders".to_owned(), now["orders"].iter().filter(|(_, row)| ["buyer", "seller", "agent"].iter().any(|c| field(row, c) == p)).map(|(k, v)| (k.clone(), v.clone())).collect())].into() };
    World {
        name: "three parties",
        source,
        seed: || {
            let order = |key: &str, buyer: &str, seller: &str, agent: &str| ("orders".to_owned(), object([("id", id(key)), ("buyer", id(buyer)), ("seller", id(seller)), ("agent", id(agent)), ("title", Value::String("x".into()))]));
            vec![order("oa", BOB, ALICE, MALLORY), order("ob", BOB, BOB, BOB)]
        },
        readable,
        ops: |now| {
            let mut out = (parties_world().ops)(now);
            for actor in PRINCIPALS {
                for order in now["orders"].keys() {
                    for who in PRINCIPALS { out.push(Op::new(actor, "appoint", &[("order", id(order)), ("agent", id(who))])); }
                }
            }
            out
        },
        admits: |now, op| match op.kind {
            "list" => Some(true),
            _ => match now["orders"].get(op.arg("order")) {
                Some(row) if ["buyer", "seller", "agent"].iter().any(|c| field(row, c) == op.actor) => Some(field(row, "seller") == op.actor),
                _ => None,
            },
        },
        column_arms: |_| &["buyer", "seller", "agent"],
        ..parties_world()
    }
}

// ---- independent windows of two/three column arms ----
fn windowed_parties_world(three: bool) -> World {
    let mut world = if three {
        three_world()
    } else {
        parties_world()
    };
    world.source = world
        .source
        .replace("  title: text <=20", "  at: time\n  title: text <=20")
        .replace("title: 'x' }", "title: 'x', at: now }")
        .replace("  sync\n", "  sync last 1 by .at\n")
        .replace(
            "  sync to .agent or .seller or .buyer\n",
            "  sync to .agent or .seller or .buyer last 1 by .at\n",
        )
        .replace("first 20 by .id", "last 1 by .at");
    world.source.push_str("\nquery anyBuys():\n  return exists orders where .buyer = viewer\nquery buyCount():\n  return count(orders where .buyer = viewer)\n");
    if three {
        world
            .source
            .push_str("\nquery agencies():\n  return orders where .agent = viewer last 1 by .at\n");
    }
    world.seed = || {
        let row = |k: &str, buyer: &str, seller: &str, agent: &str, at: i64| {
            (
                "orders".into(),
                object([
                    ("id", id(k)),
                    ("buyer", id(buyer)),
                    ("seller", id(seller)),
                    ("agent", id(agent)),
                    ("at", Value::Int(at)),
                    ("title", Value::String("x".into())),
                ]),
            )
        };
        vec![
            row("oa", BOB, ALICE, MALLORY, 1),
            row("ob", BOB, BOB, BOB, 2),
            row("oc", ALICE, BOB, ALICE, 3),
        ]
    };
    if !three {
        world.seed = || {
            (windowed_parties_world(true).seed)()
                .into_iter()
                .map(|(t, mut row)| {
                    if let Value::Row(fields) = &mut row {
                        fields.remove("agent");
                    }
                    (t, row)
                })
                .collect()
        };
    }
    world.name = if three {
        "three parties, windowed"
    } else {
        "two parties, windowed"
    };
    world.newest = Some(|now, p| {
        ["buyer", "seller", "agent"]
            .into_iter()
            .filter_map(|c| {
                now["orders"]
                    .iter()
                    .filter(|(_, row)| field(row, c) == p)
                    .max_by_key(|(key, row)| (row["at"].as_i64().unwrap(), (*key).clone()))
                    .map(|(key, _)| ("orders".into(), key.clone()))
            })
            .collect()
    });
    world.queries = if three {
        |_, _| {
            vec![
                ("buys", json!({}), true),
                ("sales", json!({}), true),
                ("agencies", json!({}), true),
                ("anyBuys", json!({}), false),
                ("buyCount", json!({}), false),
            ]
        }
    } else {
        |_, _| {
            vec![
                ("buys", json!({}), true),
                ("sales", json!({}), true),
                ("anyBuys", json!({}), false),
                ("buyCount", json!({}), false),
            ]
        }
    };
    world
}

fn two_columns_group_readable(now: &Rows, p: &str) -> Rows {
    let mut rows = teams_readable(now, p);
    rows.get_mut("tasks").unwrap().extend(
        now["tasks"]
            .iter()
            .filter(|(_, row)| field(row, "reviewer") == p)
            .map(|(k, v)| (k.clone(), v.clone())),
    );
    rows
}

fn two_columns_group_world(windowed: bool) -> World {
    let mut world = if windowed {
        windowed_world()
    } else {
        teams_world()
    };
    world.source = world
        .source
        .replace(
            "  owner: principal\n  team",
            "  owner: principal\n  reviewer: principal\n  team",
        )
        .replace(
            ".owner = viewer or exists members",
            ".owner = viewer or .reviewer = viewer or exists members",
        )
        .replace(
            "owner: viewer, team, title",
            "owner: viewer, reviewer: viewer, team, title",
        );
    world.source.push_str(if windowed {
        "\nquery reviews():\n  return tasks where .reviewer = viewer last 1 by .at\n"
    } else {
        "\nquery reviews():\n  return tasks where .reviewer = viewer first 20 by .id\n"
    });
    world.seed = || {
        teams_seed()
            .into_iter()
            .map(|(t, mut row)| {
                if t == "tasks" {
                    if let Value::Row(fields) = &mut row {
                        fields.insert("reviewer".into(), id(ALICE));
                    }
                }
                (t, row)
            })
            .collect()
    };
    world.readable = two_columns_group_readable;
    world.column_arms = |t| {
        if t == "tasks" {
            &["owner", "reviewer"]
        } else {
            &[]
        }
    };
    world.name = if windowed {
        "two columns and group, windowed"
    } else {
        "two columns and group"
    };
    if windowed {
        world.newest = Some(|now, p| {
            let mut newest = windowed_world().newest.unwrap()(now, p);
            if let Some((k, _)) = now["tasks"]
                .iter()
                .filter(|(_, row)| field(row, "reviewer") == p)
                .max_by_key(|(k, row)| (row["at"].as_i64().unwrap(), (*k).clone()))
            {
                newest.insert(("tasks".into(), k.clone()));
            }
            newest
        });
        world.queries = |now, p| {
            let mut q = windowed_world().queries.clone()(now, p);
            q.push(("reviews", json!({}), true));
            q
        };
    } else {
        world.queries = |now, p| {
            let mut q = teams_queries(now, p);
            q.push(("reviews", json!({}), true));
            q
        };
    }
    world
}

#[test]
fn pure_column_windows_every_sequence_of_two_writes() {
    for three in [false, true] {
        let w = windowed_parties_world(three);
        let name = w.name;
        assert_clean(name, exhaust(w, BLOCKING_DEPTH), BLOCKING_DEPTH);
    }
}

#[test]
fn two_columns_plus_group_every_sequence_of_two_writes() {
    for windowed in [false, true] {
        let w = two_columns_group_world(windowed);
        let name = w.name;
        assert_clean(name, exhaust(w, BLOCKING_DEPTH), BLOCKING_DEPTH);
    }
}

// ---- the harness ----

struct Backend {
    world: World,
    schema: Schema,
    programs: Vec<snapback4_core::ir::Program>,
}

fn backend(world: World) -> Backend {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), world.source.clone())]);
    assert!(bound.diagnostics.is_empty(), "{}: {:?}", world.name, bound.diagnostics);
    let schema = bound.schema.clone();
    Backend { world, programs: bound.programs.iter().map(|p| p.program.clone()).collect(), schema }
}

impl Backend {
    fn fresh(&self) -> Engine {
        let mut engine = Engine::memory(self.schema.clone(), self.programs.iter().cloned()).unwrap();
        engine.seed((self.world.seed)()).unwrap();
        engine
    }

    fn tables(&self, engine: &Engine) -> Rows {
        self.world.tables.iter().map(|name| {
            let rows = engine.store().rows(name).unwrap();
            ((*name).to_owned(), rows.iter().map(|row| (row.field("id").unwrap().as_str().unwrap().to_owned(), image(row))).collect())
        }).collect()
    }

    fn empty(&self) -> Rows {
        self.world.tables.iter().map(|t| ((*t).to_owned(), BTreeMap::new())).collect()
    }
}

/// A write under a stable operation id and minted ids, so every replay of a
/// path makes the same rows.
fn run(engine: &mut Engine, op: &Op, step: usize, name: &str) -> Result<Option<u64>, String> {
    let args = op.args.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect();
    let ids = (0..4).map(|n| format!("{name}{}", (b'a' + n as u8) as char));
    let context = Context::new(op.actor, args).at(1_000 * (step as i64 + 1)).with_ids(ids);
    match engine.mutate(op.kind, Some(name), context).map_err(|e| format!("{op:?}: {e}"))?.state {
        WriteState::Sent { seq, .. } => Ok(Some(seq)),
        WriteState::Failed { .. } => Ok(None),
    }
}

/// A model device: a put holds the image, a del drops the row, a scope
/// drops the group's rows except (R2) those naming its trailing principal
/// in a column arm.
#[derive(Clone, Debug)]
struct Device {
    viewer: &'static str,
    watermark: u64,
    rows: Rows,
}

impl Device {
    fn key(&self) -> String {
        format!("{} {} {}", self.viewer, self.watermark, serde_json::to_string(&self.rows).unwrap())
    }

    fn apply(&mut self, world: &World, events: &[snapback4_core::store::LogEvent]) {
        for event in events {
            let rows = self.rows.entry(event.table.clone()).or_default();
            match event.kind.as_str() {
                "put" => { rows.insert(event.id.clone(), event.data.as_ref().map(image).unwrap_or(Json::Null)); }
                "del" => { rows.remove(&event.id); }
                "scope" => {
                    let data = event.data.as_ref().map(wire::to_json).unwrap_or(Json::Null);
                    let items = data.as_array().cloned().unwrap_or_default();
                    let arms = (world.column_arms)(&event.table);
                    let (group, keeper) = if arms.is_empty() { (items.first().cloned(), None) } else {
                        (if items.len() > 1 { items.first().cloned() } else { None }, items.last().and_then(|p| p.as_str()).map(str::to_owned))
                    };
                    let column = (world.group_column)(&event.table);
                    let naive = naive();
                    rows.retain(|_, row| {
                        let in_group = match (column, &group) {
                            (Some(column), Some(group)) => row[column] == *group,
                            // An empty group: the whole table.
                            (None, _) | (_, None) => true,
                        };
                        let spared = !naive && keeper.as_deref().is_some_and(|keeper| arms.iter().any(|arm| field(row, arm) == keeper));
                        !in_group || spared
                    });
                }
                other => panic!("an event of an unknown kind {other}"),
            }
        }
    }
}

/// What a principal could be shown along the path.
#[derive(Clone, Default)]
struct History {
    images: BTreeSet<(String, String, String)>,
    ids: BTreeSet<(String, String)>,
    groups: BTreeSet<(String, String)>,
}

#[derive(Clone, Default)]
struct PathState {
    devices: Vec<Device>,
    history: BTreeMap<&'static str, History>,
}

#[derive(Default)]
struct Report {
    nodes: usize,
    probes: usize,
    real_answers: usize,
    failures: BTreeMap<String, (usize, String)>,
}

impl Report {
    fn fail(&mut self, path: &[Op], message: String) {
        let property = message.split(" [").next().unwrap_or(&message).to_owned();
        let example = format!("after {:?}:\n    {message}", path.iter().map(|op| format!("{} {} {:?}", op.actor, op.kind, op.args.iter().map(|(k, v)| format!("{k}={}", wire::to_json(v))).collect::<Vec<_>>())).collect::<Vec<_>>());
        let entry = self.failures.entry(property).or_insert((0, example.clone()));
        entry.0 += 1;
        if example.len() < entry.1.len() { entry.1 = example; }
    }
    fn summary(&self) -> String {
        self.failures.iter().take(25).map(|(property, (n, example))| format!("[{n} nodes] {property}\n  shortest: {example}")).collect::<Vec<_>>().join("\n")
    }
}

/// Drain from `from` at `limit` per page, checking every event against what
/// the viewer may be shown; `stop_after` keeps only that many pages.
#[allow(clippy::too_many_arguments)]
fn drain(b: &Backend, engine: &mut Engine, viewer: &'static str, from: u64, limit: usize, head: u64, now: &Rows, history: &History, errs: &mut Vec<String>, stop_after: Option<usize>) -> (Vec<snapback4_core::store::LogEvent>, u64) {
    let want = (b.world.readable)(now, viewer);
    let mut watermark = from;
    let mut events = Vec::new();
    for page_number in 0..=head as usize + 2 {
        let page = engine.stream_at(viewer, watermark, limit, NOW).unwrap();
        for event in &page.events {
            let at = format!("{viewer} from {from}, limit {limit}: {} {}/{} at {}", event.kind, event.table, event.id, event.seq);
            match event.kind.as_str() {
                "put" => {
                    let data = event.data.as_ref().map(image).unwrap_or(Json::Null);
                    if !history.images.contains(&(event.table.clone(), event.id.clone(), data.to_string())) {
                        errs.push(format!("DISCLOSED an image the viewer never could read [{at}: {data}]"));
                    } else if want.get(&event.table).and_then(|rows| rows.get(&event.id)) != Some(&data) {
                        errs.push(format!("a put is not a row the viewer may read now [{at}: {data}]"));
                    }
                }
                "del" => if !history.ids.contains(&(event.table.clone(), event.id.clone())) {
                    errs.push(format!("DISCLOSED a delete naming a row the viewer never could read [{at}]"));
                },
                "scope" => {
                    let data = event.data.as_ref().map(wire::to_json).unwrap_or(Json::Null);
                    let roster = (b.world.group_column)(&event.table).is_none();
                    // A roster's one group is empty; a union scope's last element is its recipient.
                    let group = if roster { String::new() } else { data.as_array().and_then(|items| items.first()).and_then(Json::as_str).unwrap_or("").to_owned() };
                    let arms = (b.world.column_arms)(&event.table);
                    if !arms.is_empty() && data.as_array().and_then(|items| items.last()).and_then(Json::as_str) != Some(viewer) {
                        errs.push(format!("a union scope does not name its recipient [{at}: {data}]"));
                    }
                    if !history.groups.contains(&(event.table.clone(), group.clone())) {
                        errs.push(format!("DISCLOSED a scope naming a group the viewer never held [{at}: {data}]"));
                    }
                }
                other => errs.push(format!("an event of an unknown kind [{at}: {other}]")),
            }
        }
        events.extend(page.events);
        watermark = page.watermark;
        if stop_after.is_some_and(|n| page_number + 1 >= n) || !page.more {
            if !page.more && watermark != head { errs.push(format!("a drained stream stops short of the head [{viewer} from {from}: {watermark}; head {head}]")); }
            return (events, watermark);
        }
    }
    errs.push(format!("a stream does not end [{viewer} from {from}, limit {limit}]"));
    (events, watermark)
}

fn check_node(b: &Backend, engine: &mut Engine, head: u64, now: &Rows, state: &mut PathState) -> Vec<String> {
    let mut errs = Vec::new();
    for p in PRINCIPALS {
        let history = state.history.entry(p).or_default();
        for (table, rows) in (b.world.readable)(now, p) {
            for (key, row) in rows {
                history.images.insert((table.clone(), key.clone(), row.to_string()));
                history.ids.insert((table.clone(), key));
            }
        }
        history.groups.extend((b.world.groups)(now, p));
    }
    let mut devices = Vec::new();
    let mut seen = BTreeSet::new();
    let mut keep = |device: Device, devices: &mut Vec<Device>| if seen.insert(device.key()) { devices.push(device); };
    for p in PRINCIPALS {
        let history = state.history[p].clone();
        let (events, watermark) = engine.snapshot_at(p, NOW).unwrap();
        let mut rows = b.empty();
        for event in &events {
            if event.kind != EventKind::Put { errs.push(format!("a snapshot carries a non-put [{p}: {:?}]", event.kind)); }
            rows.entry(event.table.clone()).or_default().insert(event.id.clone(), event.data.as_ref().map(image).unwrap_or(Json::Null));
        }
        let want = (b.world.readable)(now, p);
        match b.world.newest {
            None => if rows != want { errs.push(format!("a snapshot is not the rows the rules admit [{p} holds {rows:?}; the rules admit {want:?}]")); },
            // With windows a snapshot is the newest rows of each arm group, all readable.
            Some(newest) => {
                let windows = newest(now, p);
                for (table, held) in &rows {
                    for (key, row) in held {
                        if want.get(table).and_then(|rows| rows.get(key)) != Some(row) { errs.push(format!("a snapshot holds a row the rules do not admit [{p}: {table}/{key}]")); }
                        if windows.iter().any(|(t, _)| t == table) && !windows.contains(&(table.clone(), key.clone())) { errs.push(format!("a snapshot holds a row outside every arm's window [{p}: {table}/{key}]")); }
                    }
                }
                for (table, key) in &windows {
                    if !rows.get(table).is_some_and(|rows| rows.contains_key(key)) { errs.push(format!("a snapshot lacks the newest row of an arm group [{p}: {table}/{key}]")); }
                }
                for (table, rows_now) in &want {
                    if !windows.iter().any(|(t, _)| t == table) && rows.get(table) != Some(rows_now) { errs.push(format!("a snapshot of an unwindowed table is not the rows the rules admit [{p}: {table}]")); }
                }
            }
        }
        if watermark != head { errs.push(format!("a snapshot is not at the head [{p} at {watermark}; head {head}]")); }
        let bootstrapped = Device { viewer: p, watermark, rows };
        // A device that will apply only the first page of its next stream.
        keep(bootstrapped.clone(), &mut devices);
        for from in 0..=head {
            let mut small = Device { viewer: p, watermark: from, rows: b.empty() };
            let mut large = small.clone();
            let (events, _) = drain(b, engine, p, from, 1, head, now, &history, &mut errs, None);
            small.apply(&b.world, &events);
            let (events, _) = drain(b, engine, p, from, 1_000, head, now, &history, &mut errs, None);
            large.apply(&b.world, &events);
            if small.rows != large.rows { errs.push(format!("the page size changes what a stream applies [{p} from {from}]")); }
        }
    }
    for device in &state.devices {
        let history = state.history[device.viewer].clone();
        // Drain fully: the device must converge to exactly the readable rows.
        let mut synced = device.clone();
        let (events, watermark) = drain(b, engine, synced.viewer, synced.watermark, 1, head, now, &history, &mut errs, None);
        synced.apply(&b.world, &events);
        synced.watermark = watermark;
        let want = (b.world.readable)(now, synced.viewer);
        for (table, rows) in &want {
            let held = synced.rows.get(table).cloned().unwrap_or_default();
            match b.world.newest {
                None => if &held != rows {
                    errs.push(format!("a synced device does not hold exactly what the rules admit [{} holds {table} {held:?}; the rules admit {rows:?}]", synced.viewer));
                },
                Some(_) => for (key, row) in &held {
                    if rows.get(key) != Some(row) { errs.push(format!("a synced device holds a row the rules do not admit now [{}: {table}/{key}]", synced.viewer)); }
                },
            }
        }
        // A window is not maintained at exactly N (NOT-DOING: exact horizon
        // maintenance): after deletions a carried device may hold fewer rows
        // than the window, and its pages then defer to the server (checked
        // by the real device below), so only over-holding is checked here.
        keep(synced, &mut devices);
        // Commits between stream pages: apply one page now, the rest later.
        let mut partial = device.clone();
        let (events, watermark) = drain(b, engine, partial.viewer, partial.watermark, 1, head, now, &history, &mut errs, Some(1));
        partial.apply(&b.world, &events);
        partial.watermark = watermark;
        keep(partial, &mut devices);
    }
    state.devices = devices;
    errs.sort();
    errs.dedup();
    errs
}

// ---- the real device ----

fn snapshot_page(engine: &mut Engine, principal: &str, after: Option<String>) -> (Json, Option<String>) {
    let page = engine.snapshot_acquisition_page_at(principal, after.as_deref(), 3, NOW).unwrap();
    let next = page.next.map(|n| n.encode());
    let events: Vec<Json> = page.events.iter().map(|e| json!({"data": e.data.as_ref().map(wire::to_json), "id": e.id, "kind": e.kind.word(), "table": e.table})).collect();
    let mut reply = json!({"acknowledged": {}, "after": after, "events": events, "generation": engine.generation(), "held": page.held,
        "more": next.is_some(), "next": next, "now": NOW, "snapshot": true, "watermark": page.watermark});
    if !page.acquisitions.is_empty() { reply["acquisitions"] = serde_json::to_value(&page.acquisitions).unwrap(); }
    (reply, next)
}

fn stream_page(engine: &mut Engine, principal: &str, from: u64) -> Json {
    let page = engine.stream_at(principal, from, 2, NOW).unwrap();
    let events: Vec<Json> = page.events.iter().map(|e| json!({"data": e.data.as_ref().map(wire::to_json), "id": e.id, "kind": e.kind, "seq": e.seq, "table": e.table})).collect();
    let mut reply = json!({"acknowledged": {}, "events": events, "generation": engine.generation(), "joined": page.joined, "more": page.more,
        "now": NOW, "snapshot": false, "watermark": page.watermark});
    if !page.acquisitions.is_empty() { reply["acquisitions"] = serde_json::to_value(&page.acquisitions).unwrap(); }
    if let Some(at) = page.images_at { reply["images_at"] = json!(at); }
    reply
}

type Real = snapback4_device::device::Device<snapback4_device::memory::MemoryStore>;

fn real_device(b: &Backend, engine: &mut Engine, principal: &str) -> Real {
    let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: b.schema.public_projection(), programs: b.programs.clone() };
    let mut device = snapback4_device::device::Device::open_store(snapback4_device::memory::MemoryStore::new(), Some(backend)).unwrap();
    let mut after = None;
    let mut first = true;
    loop {
        let (page, next) = snapshot_page(engine, principal, after.clone());
        let page: snapback4_device::device::StreamPage = serde_json::from_value(page).unwrap();
        device.apply(&page, first).unwrap();
        first = false;
        match next { Some(next) => after = Some(next), None => break }
    }
    follow(engine, &mut device, principal);
    device
}

/// A device that has applied only its snapshot's first page: the rest of
/// the snapshot, and its catch-up, come after the next write (round 4, GPT:
/// commits between snapshot pages and between arms).
fn split_device(b: &Backend, engine: &mut Engine, principal: &str) -> (Real, Option<String>) {
    let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: b.schema.public_projection(), programs: b.programs.clone() };
    let mut device = snapback4_device::device::Device::open_store(snapback4_device::memory::MemoryStore::new(), Some(backend)).unwrap();
    let (page, next) = snapshot_page(engine, principal, None);
    let page: snapback4_device::device::StreamPage = serde_json::from_value(page).unwrap();
    device.apply(&page, true).unwrap();
    (device, next)
}

fn finish(engine: &mut Engine, device: &mut Real, principal: &str, mut after: Option<String>) {
    while let Some(cursor) = after.take() {
        let (page, next) = snapshot_page(engine, principal, Some(cursor));
        let page: snapback4_device::device::StreamPage = serde_json::from_value(page).unwrap();
        device.apply(&page, false).unwrap();
        after = next;
    }
    follow(engine, device, principal);
}

fn follow(engine: &mut Engine, device: &mut Real, principal: &str) {
    for _ in 0..64 {
        let (watermark, _) = device.state().unwrap();
        let page = stream_page(engine, principal, watermark);
        let more = page["more"].as_bool().unwrap_or(false);
        let page: snapback4_device::device::StreamPage = serde_json::from_value(page).unwrap();
        device.apply(&page, false).unwrap();
        if !more { return; }
    }
    panic!("a real device's stream does not end");
}

/// Every answer the device certifies equals the server's; the queries whose
/// pins the viewer reads must be certified.
fn check_real(b: &Backend, engine: &mut Engine, device: &mut Real, viewer: &str, now: &Rows, label: &str, report: &mut Report) -> Vec<String> {
    let mut errs = Vec::new();
    for (query, args, must) in (b.world.queries)(now, viewer) {
        let typed = args.as_object().unwrap().iter().map(|(k, v)| (k.clone(), match v { Json::String(s) => Value::Id(s.clone()), _ => Value::Null })).collect();
        let server = engine.query(query, Context::new(viewer, typed).at(NOW));
        let (local, unknown, _) = device.query_with_coverage(query, viewer, &args, NOW);
        report.real_answers += 1;
        let at = format!("{label} {viewer} {query}({args})");
        match (local, server) {
            (Ok(local), Ok(server)) => {
                let certified = local.complete && !unknown && !local.unavailable;
                // A server `exists` over a per-row rule with no readable match is
                // unavailable, never false (LLP 3000.036 §15.11); only a server
                // answer can contradict the device.
                if certified && !server.unavailable && local.data != server.data {
                    errs.push(format!("a device page claims complete and differs from the server [{at}: device {} server {}]", wire::to_json(&local.data), wire::to_json(&server.data)));
                }
                // A carried windowed device may legitimately defer after deletions.
                if must && !certified && (b.world.newest.is_none() || label == "fresh" || label == "root") {
                    errs.push(format!("a device page the viewer's partition covers is not certified [{at}: complete {} unknown {unknown}]", local.complete));
                }
            }
            (Err(local), Err(server)) => if !unknown && local.code != server.code {
                errs.push(format!("a device refusal differs from the server's [{at}: {} vs {}]", local.code, server.code));
            },
            (Ok(local), Err(server)) => if local.complete && !unknown {
                errs.push(format!("a device answers what the server refuses [{at}: {}]", server.code));
            },
            (Err(local), Ok(_)) => if !unknown && !matches!(local.code.as_str(), "E_OFFLINE" | "E_UNAVAILABLE") {
                errs.push(format!("a device refuses what the server answers [{at}: {}]", local.code));
            },
        }
    }
    errs
}

// ---- the exploration ----

fn visit(b: &Backend, path: &mut Vec<Op>, parent: &PathState, depth: usize, report: &mut Report) {
    let mut engine = b.fresh();
    // Real devices that acquired at the root follow every write.
    let mut followers: Vec<(&'static str, Real)> = PRINCIPALS.iter().map(|p| (*p, real_device(b, &mut engine, p))).collect();
    let mut split: Vec<(&'static str, Real, Option<String>)> = PRINCIPALS.iter().map(|p| { let (device, next) = split_device(b, &mut engine, p); (*p, device, next) }).collect();
    for (step, op) in path[..path.len() - 1].iter().enumerate() {
        if run(&mut engine, op, step, &format!("s{step}")).ok().flatten().is_none() {
            return report.fail(path, format!("a replayed write did not commit again [{op:?}]"));
        }
        for (p, device) in &mut followers { follow(&mut engine, device, p); }
        for (p, device, next) in &mut split { finish(&mut engine, device, p, next.take()); }
    }
    let before = b.tables(&engine);
    let last = path.last().unwrap().clone();
    let expected = (b.world.admits)(&before, &last);
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
    let after = b.tables(&engine);
    let head = engine.seq().unwrap();
    match run(&mut engine, &last, step, &format!("s{step}")) {
        Ok(again) if again == outcome && engine.seq().unwrap() == head && b.tables(&engine) == after => {}
        other => report.fail(path, format!("a resent operation id applied again or changed its answer [{other:?}; first {outcome:?}]")),
    }
    let mut state = parent.clone();
    for e in check_node(b, &mut engine, head, &after, &mut state) { report.fail(path, e); }
    for (p, device, next) in &mut split {
        finish(&mut engine, device, p, next.take());
        for e in check_real(b, &mut engine, device, p, &after, "split", report) { report.fail(path, e); }
    }
    for (p, device) in &mut followers {
        follow(&mut engine, device, p);
        for e in check_real(b, &mut engine, device, p, &after, "followed", report) { report.fail(path, e); }
        let mut fresh = real_device(b, &mut engine, p);
        for e in check_real(b, &mut engine, &mut fresh, p, &after, "fresh", report) { report.fail(path, e); }
    }
    report.nodes += 1;
    for op in probe(b, &mut engine, path, &after, depth, report) {
        path.push(op);
        visit(b, path, &state, depth, report);
        path.pop();
    }
}

fn probe(b: &Backend, engine: &mut Engine, path: &mut Vec<Op>, now: &Rows, depth: usize, report: &mut Report) -> Vec<Op> {
    let head = engine.seq().unwrap();
    let mut branches = Vec::new();
    for op in (b.world.ops)(now) {
        match (b.world.admits)(now, &op) {
            Some(false) => {
                report.probes += 1;
                match run(engine, &op, path.len(), &format!("q{}", report.probes)) {
                    Ok(None) if engine.seq().unwrap() == head => {}
                    Ok(None) => { report.fail(path, format!("a refused write advanced the head [{op:?}]")); return Vec::new(); }
                    Ok(Some(_)) => { path.push(op); report.fail(path, "WRITE AUTHORITY: the rules should have refused the last write".into()); path.pop(); return Vec::new(); }
                    Err(e) => { report.fail(path, e); return Vec::new(); }
                }
            }
            _ if path.len() < depth => branches.push(op),
            _ => {}
        }
    }
    branches
}

fn exhaust(world: World, depth: usize) -> Report {
    let b = backend(world);
    let mut report = Report::default();
    let mut engine = b.fresh();
    let head = engine.seq().unwrap();
    let now = b.tables(&engine);
    let mut state = PathState::default();
    for e in check_node(&b, &mut engine, head, &now, &mut state) { report.fail(&[], e); }
    for p in PRINCIPALS {
        let mut device = real_device(&b, &mut engine, p);
        for e in check_real(&b, &mut engine, &mut device, p, &now, "root", &mut report) { report.fail(&[], e); }
    }
    report.nodes += 1;
    let branches = probe(&b, &mut engine, &mut Vec::new(), &now, depth, &mut report);
    let threads = std::env::var("SNAPBACK4_EXHAUSTIVE_THREADS").ok().and_then(|t| t.parse().ok()).unwrap_or(2);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let reports: Vec<Report> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads).map(|_| scope.spawn(|| {
            let mut report = Report::default();
            loop {
                let n = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(op) = branches.get(n) else { return report };
                visit(&b, &mut vec![op.clone()], &state, depth, &mut report);
            }
        })).collect();
        workers.into_iter().map(|w| w.join().unwrap()).collect()
    });
    for r in reports {
        report.nodes += r.nodes;
        report.probes += r.probes;
        report.real_answers += r.real_answers;
        for (property, (n, example)) in r.failures {
            let entry = report.failures.entry(property).or_insert((0, example.clone()));
            entry.0 += n;
            if example.len() < entry.1.len() { entry.1 = example; }
        }
    }
    report
}

fn assert_clean(name: &str, report: Report, depth: usize) {
    eprintln!("union {name}, depth {depth}: {} nodes, {} refused writes attempted, {} real-device answers", report.nodes, report.probes, report.real_answers);
    assert!(report.failures.is_empty(), "{name}: {} kind(s) of failure:\n{}", report.failures.len(), report.summary());
}

fn depth() -> usize {
    std::env::var("SNAPBACK4_EXHAUSTIVE_DEPTH").ok().and_then(|d| d.parse().ok()).unwrap_or(3)
}

#[test]
fn owner_or_team_windowed_every_sequence_of_two_writes() {
    assert_clean("owner or team, windowed", exhaust(windowed_world(), BLOCKING_DEPTH), BLOCKING_DEPTH);
}

#[test]
fn owner_or_staff_every_sequence_of_two_writes() {
    assert_clean("owner or staff", exhaust(staff_world(), BLOCKING_DEPTH), BLOCKING_DEPTH);
}

#[test]
fn two_parties_every_sequence_of_two_writes() {
    assert_clean("two parties", exhaust(parties_world(), BLOCKING_DEPTH), BLOCKING_DEPTH);
}

#[test]
#[ignore = "opt-in: SNAPBACK4_EXHAUSTIVE_DEPTH (default 3)"]
fn every_world_deeper() {
    let depth = depth();
    for world in [windowed_world(), staff_world(), parties_world(), three_world()] {
        let name = world.name;
        assert_clean(name, exhaust(world, depth), depth);
    }
}

#[test]
fn three_parties_every_sequence_of_two_writes() {
    assert_clean("three parties", exhaust(three_world(), BLOCKING_DEPTH), BLOCKING_DEPTH);
}

#[test]
fn owner_or_team_every_sequence_of_two_writes() {
    assert_clean("owner or team", exhaust(teams_world(), BLOCKING_DEPTH), BLOCKING_DEPTH);
}

#[test]
#[ignore = "opt-in: SNAPBACK4_EXHAUSTIVE_DEPTH (default 3)"]
fn owner_or_team_deeper() {
    let depth = depth();
    assert_clean("owner or team", exhaust(teams_world(), depth), depth);
}

// ---- targeted cases ----

fn compiled(source: &str) -> (Schema, Vec<snapback4_core::ir::Program>) {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), source.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    (bound.schema, bound.programs.into_iter().map(|p| p.program).collect())
}

fn mutate(engine: &mut Engine, actor: &str, op: &str, args: &[(&str, Value)], step: i64) {
    let args = args.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect();
    let name = format!("e{step}");
    let context = Context::new(actor, args).at(NOW + step).with_ids((0..4).map(|n| format!("{name}{n}")));
    match engine.mutate(op, Some(&name), context).unwrap().state {
        WriteState::Sent { .. } => {}
        WriteState::Failed { .. } => panic!("{op} by {actor} was refused"),
    }
}

/// §9: a scope logged while the table synced to the team must not close the
/// team after the table stopped syncing to it, the viewer rejoined, and the
/// union came back. Without the audience epoch the stream reads the old
/// scope as the last word and a new task of the team never arrives.
#[test]
fn an_audience_epoch_keeps_an_old_scope_from_closing_a_rejoined_group() {
    let union = compiled(TEAMS);
    let owner_only = compiled(&TEAMS.replace("  read <- .owner = viewer or exists members[.team, viewer]\n", "  read <- .owner = viewer\n"));
    assert!(!owner_only.0.tables["tasks"].sync.as_ref().unwrap().is_union());
    let mut engine = Engine::memory(union.0.clone(), union.1.clone()).unwrap();
    engine.seed(teams_seed()).unwrap();
    mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
    engine.adopt(owner_only.0.clone(), owner_only.1.clone()).unwrap();
    // Alice rejoins while tasks sync to owners only: no join is logged for tasks.
    engine.seed([("members".to_owned(), object([("id", id("back")), ("team", id("t1")), ("principal", id(ALICE))]))]).unwrap();
    engine.adopt(union.0.clone(), union.1.clone()).unwrap();
    let (_, watermark) = engine.snapshot_at(ALICE, NOW).unwrap();
    engine.seed([("members".to_owned(), object([("id", id("mb1")), ("team", id("t1")), ("principal", id(BOB))]))]).unwrap();
    mutate(&mut engine, BOB, "create", &[("team", id("t1"))], 3);
    let page = engine.stream_at(ALICE, watermark, 1_000, NOW).unwrap();
    let created: Vec<_> = page.events.iter().filter(|event| event.table == "tasks" && event.kind == "put").map(|event| event.id.clone()).collect();
    assert_eq!(created, ["e30"], "Alice holds t1 again, so Bob's new task in it reaches her: {:?}", page.events);
}

/// §4.3: the leave walk passes spared rows; 600 of them ahead of the rows it
/// must drop do not stop it, and none of them is lost.
#[test]
fn a_leave_keeps_every_spared_row_however_many_come_first() {
    let b = backend(teams_world());
    let mut engine = Engine::memory(b.schema.clone(), b.programs.clone()).unwrap();
    let mut rows = teams_seed();
    for n in 0..600 {
        rows.push(("tasks".to_owned(), object([("id", id(&format!("a{n:03}"))), ("owner", id(ALICE)), ("team", id("t1")), ("title", Value::String("x".into())), ("at", Value::Int(10 + n))])));
    }
    for n in 0..3 {
        rows.push(("tasks".to_owned(), object([("id", id(&format!("z{n}"))), ("owner", id(BOB)), ("team", id("t1")), ("title", Value::String("x".into())), ("at", Value::Int(1_000 + n))])));
    }
    engine.seed(rows).unwrap();
    let mut device = real_device(&b, &mut engine, ALICE);
    mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
    follow(&mut engine, &mut device, ALICE);
    let (count, unknown, _) = device.query_with_coverage("myCount", ALICE, &json!({}), NOW);
    let count = count.unwrap();
    assert!(count.complete && !unknown);
    assert_eq!(count.data, Value::Int(601), "Alice's 600 tasks in t1 and her seeded task stay");
    for n in 0..3 {
        let (task, unknown, _) = device.query_with_coverage("task", ALICE, &json!({"t": format!("z{n}")}), NOW);
        let task = task.unwrap();
        assert!(task.complete && !unknown && task.data == Value::Null, "Bob's task z{n} left with the team");
    }
}

/// Round 3 (Muse finding 1): a row deleted and recreated under its id in one
/// commit, in another team, keeps the deletion owed to the partition it left:
/// the first incarnation's `del` survives the second's birth.
#[test]
fn a_row_recreated_elsewhere_in_one_commit_still_revokes_where_it_was() {
    let source = format!("{TEAMS}\nmutation recreate(task: tasks, team: teams):\n  t = tasks[task] ! else NOT_FOUND\n  delete tasks[t]\n  return insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n");
    let (schema, programs) = compiled(&source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed(teams_seed()).unwrap();
    // Mallory holds t1 only; Bob holds t2 only.
    engine.seed([("members".to_owned(), object([("id", id("mm1")), ("team", id("t1")), ("principal", id(MALLORY))]))]).unwrap();
    let (_, before) = engine.snapshot_at(MALLORY, NOW).unwrap();
    // The commit deletes ka (Alice's, in t1) and recreates it under the same
    // id as Alice's task in t2.
    let args = [("task".to_owned(), id("ka")), ("team".to_owned(), id("t2"))].into();
    let outcome = engine.mutate("recreate", Some("re"), Context::new(ALICE, args).at(NOW).with_ids(["ka".to_owned()])).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }), "{:?}", outcome.state);
    let mallory = engine.stream_at(MALLORY, before, 1_000, NOW).unwrap();
    let last = mallory.events.iter().rev().find(|event| event.table == "tasks" && event.id == "ka");
    assert_eq!(last.map(|event| event.kind.as_str()), Some("del"), "Mallory held ka through t1 and must lose it: {:?}", mallory.events);
    let bob = engine.stream_at(BOB, before, 1_000, NOW).unwrap();
    assert!(bob.events.iter().any(|event| event.id == "ka" && event.kind == "put"), "Bob reads the new ka through t2: {:?}", bob.events);
}

/// Round 3 (Muse finding 2): R1 also covers a single group audience whose
/// group column can change. A task moved between two teams its viewer holds
/// logs a `put` to the new team and a `del` to the old; served from
/// serve-time state, the `del` is the current image and the row stays.
#[test]
fn a_row_moved_between_two_held_groups_of_one_audience_stays() {
    let source = "table teams:\n  name: text <=20\n  read <- exists members[.id, viewer]\n  insert <- deny\n  sync\ntable members:\n  team: teams\n  principal: principal\n  unique team, principal\n  immutable team, principal\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  sync\ntable tasks:\n  team: teams\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  update <- exists members[.team, viewer]\n  sync\nmutation move(task: tasks, team: teams):\n  t = tasks[task] ! else NOT_FOUND\n  update tasks[t] { team }\n  return null\n";
    let (schema, programs) = compiled(source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed([
        ("teams".to_owned(), object([("id", id("t1")), ("name", Value::String("a".into()))])),
        ("teams".to_owned(), object([("id", id("t2")), ("name", Value::String("b".into()))])),
        ("members".to_owned(), object([("id", id("m1")), ("team", id("t1")), ("principal", id(ALICE))])),
        ("members".to_owned(), object([("id", id("m2")), ("team", id("t2")), ("principal", id(ALICE))])),
        ("tasks".to_owned(), object([("id", id("k")), ("team", id("t1"))])),
    ]).unwrap();
    let (_, watermark) = engine.snapshot_at(ALICE, NOW).unwrap();
    mutate(&mut engine, ALICE, "move", &[("task", id("k")), ("team", id("t2"))], 1);
    let page = engine.stream_at(ALICE, watermark, 1_000, NOW).unwrap();
    let last = page.events.iter().rev().find(|event| event.id == "k").expect("an event for k");
    assert_eq!(last.kind, "put", "{:?}", page.events);
}

/// Round 3 (GPT finding 1): a stream from a watermark before the audience
/// epoch reads no group log of the earlier audience. Alice was never in t2
/// while a task of t2 was deleted; after the arm is removed, Alice joins and
/// the union returns, a stream from 0 names no deletion she never could read.
#[test]
fn a_stream_from_before_the_epoch_reads_no_earlier_group_log() {
    let union = compiled(TEAMS);
    let owner_only = compiled(&TEAMS.replace("  read <- .owner = viewer or exists members[.team, viewer]\n", "  read <- .owner = viewer\n"));
    let mut engine = Engine::memory(union.0.clone(), union.1.clone()).unwrap();
    // Alice only in t1 here; Bob owns kb in t2.
    engine.seed(teams_seed().into_iter().filter(|(table, row)| !(table == "members" && row.field("id").ok() == Some(&id("ma2")))).collect::<Vec<_>>()).unwrap();
    mutate(&mut engine, BOB, "remove", &[("task", id("kb"))], 1);
    engine.adopt(owner_only.0.clone(), owner_only.1.clone()).unwrap();
    engine.seed([("members".to_owned(), object([("id", id("late")), ("team", id("t2")), ("principal", id(ALICE))]))]).unwrap();
    engine.adopt(union.0.clone(), union.1.clone()).unwrap();
    for limit in [1, 1_000] {
        let mut watermark = 0;
        loop {
            let page = engine.stream_at(ALICE, watermark, limit, NOW).unwrap();
            assert!(page.events.iter().all(|event| event.id != "kb"), "Alice never could read kb: {:?}", page.events);
            watermark = page.watermark;
            if !page.more { break; }
        }
    }
}

/// Round 3 (GPT finding 3): a renewal inside the acquiring commit is still
/// that commit's acquisition. Mallory joins a group with one deadline, the
/// same commit renews it and deletes a row of the group: she is never sent
/// the row's id.
#[test]
fn a_renewal_inside_the_acquiring_commit_reads_nothing_of_that_commit() {
    let source = "table members:\n  team: id\n  principal: principal\n  until: time\n  unique team, principal\n  by byUntil: until\n  immutable team, principal\n  expire at .until\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  update <- exists members[.team, viewer]\n  sync\ntable notes:\n  team: id\n  immutable team\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  delete <- exists members[.team, viewer]\n  sync\nmutation admitAndDrop(who: principal, note: notes):\n  m = insert members { team: 'g', principal: who, until: now + 100 }\n  update members[m] { until: now + 200 }\n  n = notes[note] ! else NOT_FOUND\n  delete notes[n]\n  return null\n";
    let (schema, programs) = compiled(source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed([
        ("members".to_owned(), object([("id", id("ma")), ("team", id("g")), ("principal", id(ALICE)), ("until", Value::Int(NOW * 10))])),
        ("notes".to_owned(), object([("id", id("x")), ("team", id("g"))])),
    ]).unwrap();
    let (_, before) = engine.snapshot_at(MALLORY, NOW).unwrap();
    mutate(&mut engine, ALICE, "admitAndDrop", &[("who", id(MALLORY)), ("note", id("x"))], 1);
    for limit in [1, 1_000] {
        let mut watermark = before;
        loop {
            let page = engine.stream_at(MALLORY, watermark, limit, NOW + 20).unwrap();
            assert!(page.events.iter().all(|event| event.id != "x"), "Mallory never could read x: {:?}", page.events);
            watermark = page.watermark;
            if !page.more { break; }
        }
    }
}

/// Round 4 (GPT finding 1): the audience epoch's identity includes how stored
/// membership images are read, so changing a group column's default (which
/// decides the group an old row names) starts a new epoch.
#[test]
fn a_changed_membership_default_is_a_new_audience() {
    let source = |default: &str| format!("table members:\n  team: text <=5 default '{default}'\n  principal: principal\n  unique team, principal\n  immutable team, principal\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  sync\ntable notes:\n  owner: principal\n  team: text <=5\n  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer\n  sync\n");
    let (one, _) = compiled(&source("g1"));
    let (two, _) = compiled(&source("g2"));
    let changed = snapback4_core::partition::changed_group_audiences(Some(&one), &two);
    assert!(changed.contains(&"notes".to_owned()) && changed.contains(&"members".to_owned()), "{changed:?}");
    assert!(snapback4_core::partition::changed_group_audiences(Some(&one), &one).is_empty());
}

/// Round 4 (GPT finding 2): a scope logged under an earlier audience is not
/// streamed under a new one. Alice leaves t1 under owner-or-team; the union
/// is retargeted to an empty-group roster; a stream from before the leave
/// carries no `tasks` scope of the old width the current device would refuse.
#[test]
fn a_scope_of_an_earlier_audience_is_not_streamed() {
    let union = compiled(TEAMS);
    let roster = compiled(&format!("{}\ntable staff:\n  principal: principal\n  unique principal\n  read <- exists staff[viewer]\n  insert <- exists staff[viewer]\n  sync\n",
        TEAMS.replace("  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n", "  read <- .owner = viewer or exists staff[viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n")));
    let mut engine = Engine::memory(union.0.clone(), union.1.clone()).unwrap();
    engine.seed(teams_seed()).unwrap();
    mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
    engine.adopt(roster.0.clone(), roster.1.clone()).unwrap();
    let page = engine.stream_at(ALICE, 0, 1_000, NOW).unwrap();
    assert!(page.events.iter().all(|event| !(event.table == "tasks" && event.kind == "scope")), "{:?}", page.events);
    // The members table kept its audience: its own scope still streams.
    assert!(page.events.iter().any(|event| event.table == "members" && event.kind == "scope"), "{:?}", page.events);
}

/// Round 5 (GPT finding 1): an existing row that enters a new arm with an
/// image already expired at its commit's end names nothing to that arm. Bob
/// buys and sells `o`; one commit makes Mallory the buyer and ends the row's
/// life. Mallory could read `o` at neither boundary: she is sent nothing,
/// then or after the sweep; Bob loses the row.
#[test]
fn an_expiring_move_into_another_arm_names_nothing_there() {
    let source = "table orders:\n  buyer: principal\n  seller: principal\n  until: time\n  by byBuyer: buyer, id\n  by bySeller: seller, id\n  by byUntil: until\n  expire at .until\n  read <- .buyer = viewer or .seller = viewer\n  insert <- .seller = viewer\n  update <- allow\n  sync\nmutation hand(order: orders, who: principal):\n  o = orders[order] ! else NOT_FOUND\n  update orders[o] { buyer: who, until: now }\n  return null\n";
    let (schema, programs) = compiled(source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed([("orders".to_owned(), object([("id", id("o")), ("buyer", id(BOB)), ("seller", id(BOB)), ("until", Value::Int(NOW * 10))]))]).unwrap();
    let before = engine.seq().unwrap();
    mutate(&mut engine, BOB, "hand", &[("order", id("o")), ("who", id(MALLORY))], 1);
    let streams = |engine: &mut Engine, viewer: &str, at: i64| -> Vec<(String, String)> {
        let mut out = Vec::new();
        for limit in [1, 1_000] {
            let mut watermark = before;
            loop {
                let page = engine.stream_at(viewer, watermark, limit, at).unwrap();
                out.extend(page.events.iter().filter(|event| event.id == "o").map(|event| (event.kind.clone(), event.seq.to_string())));
                watermark = page.watermark;
                if !page.more { break; }
            }
        }
        out
    };
    assert!(streams(&mut engine, MALLORY, NOW + 10).is_empty(), "Mallory never could read o");
    assert!(streams(&mut engine, BOB, NOW + 10).iter().any(|(kind, _)| kind == "del"), "Bob loses o");
    engine.sweep_expired(NOW + 100, 100).unwrap();
    assert!(streams(&mut engine, MALLORY, NOW + 100).is_empty(), "nor after the sweep");
}

// Revision 7: exercise epoch transitions through both real device applicators.
fn epoch_trace_applies<S: snapback4_device::store::DeviceStore>(store: S, backend: snapback4_device::device::Backend, trace: &[Json], query: &str, args: &Json, expected: &Value) {
    let mut device = snapback4_device::device::Device::open_store(store, Some(backend)).unwrap();
    for (n, page) in trace.iter().enumerate() {
        let page = serde_json::from_value(page.clone()).unwrap();
        device.apply(&page, n == 0).unwrap();
    }
    let (answer, unknown, _) = device.query_with_coverage(query, ALICE, args, NOW + 10);
    let answer = answer.unwrap();
    assert!(answer.complete && !unknown && !answer.unavailable, "{answer:?}, unknown={unknown}");
    assert_eq!(&answer.data, expected);
}

fn epoch_snapshot_trace(engine: &mut Engine) -> Vec<Json> {
    let mut trace = Vec::new();
    let mut after = None;
    loop {
        let (page, next) = snapshot_page(engine, ALICE, after);
        trace.push(page);
        after = next;
        if after.is_none() { return trace; }
    }
}

fn epoch_stream_trace(engine: &mut Engine, from: u64, limit: usize, trace: &mut Vec<Json>) {
    stream_trace_at(engine,from,limit,NOW+10,trace);
}

fn stream_trace_at(engine: &mut Engine, from: u64, limit: usize, now: i64, trace: &mut Vec<Json>) {
    let mut watermark = from;
    loop {
        let page = engine.stream_at(ALICE, watermark, limit, now).unwrap();
        assert!(page.acquisitions.iter().all(|marker| marker.at <= page.events.len()), "marker past page: {page:?}");
        let events: Vec<_> = page.events.iter().map(|e| json!({"data": e.data.as_ref().map(wire::to_json), "id": e.id, "kind": e.kind, "seq": e.seq, "table": e.table})).collect();
        trace.push(json!({"acknowledged": {}, "events": events, "generation": engine.generation(), "joined": page.joined,
            "more": page.more, "now": now, "snapshot": false, "watermark": page.watermark, "acquisitions": page.acquisitions, "images_at": page.images_at}));
        assert!(page.watermark > watermark || !page.more, "empty page must advance");
        watermark = page.watermark;
        if !page.more { break; }
    }
}

#[test]
fn an_obsolete_scope_does_not_shift_a_later_window_acquisition() {
    let source = windowed_world().source;
    let old = compiled(&source);
    let new = compiled(&format!("{}\ntable staff:\n  principal: principal\n  unique principal\n  read <- exists staff[viewer]\n  insert <- exists staff[viewer]\n  sync\n",
        source.replace("  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n", "  read <- .owner = viewer or exists staff[viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n")));
    for limit in [1, 1_000] {
        let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
        engine.seed_at(teams_seed(), NOW).unwrap();
        let from = engine.seq().unwrap();
        mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
        engine.adopt(new.0.clone(), new.1.clone()).unwrap();
        let mut trace = epoch_snapshot_trace(&mut engine);
        engine.seed_at([("staff".to_owned(), object([("id", id("a-staff")), ("principal", id(ALICE))]))], NOW + 2).unwrap();
        epoch_stream_trace(&mut engine, from, limit, &mut trace);
        let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: new.0.public_projection(), programs: new.1.clone() };
        // The group window is now the whole staff roster; querying the owner's
        // own window is still certified, and exercises application of its peers' markers.
        let expected = engine.query("myLatest", Context::new(ALICE, BTreeMap::new()).at(NOW + 10)).unwrap().data;
        epoch_trace_applies(snapback4_device::memory::MemoryStore::new(), backend.clone(), &trace, "myLatest", &json!({}), &expected);
        epoch_trace_applies(snapback4_core::Store::memory().unwrap(), backend, &trace, "myLatest", &json!({}), &expected);
    }
}

#[test]
fn a_first_post_epoch_renewal_keeps_history_without_granting_acquisition_history() {
    let source = "table members:\n  group: text <=10\n  person: principal\n  until: time\n  immutable group, person\n  unique group, person\n  expire at .until\n  read <- .person = viewer\n  insert <- exists members[.group, viewer]\n  update <- .person = viewer\n  sync\ntable notes:\n  group: text <=10\n  body: text <=10\n  read <- exists members[.group, viewer]\n  insert <- allow\n  delete <- allow\n  sync\nquery notes(group: text <=10):\n  return notes where .group = group first 20 by .id\nmutation renewDelete(who: principal, until: time, note: notes):\n  upsert members[group = 'g', person = who] { until }\n  delete notes[note]\n  return null\n";
    let old = compiled(&source.replace("  sync\nquery notes", "  online only\nquery notes"));
    let new = compiled(source);
    for limit in [1, 1_000] {
        for lifetime in [Some(NOW + 100), Some(NOW + 1), None] {
            let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
            let mut rows = vec![("notes".into(), object([("id", id("n")), ("group", Value::String("g".into())), ("body", Value::String("x".into()))]))];
            if let Some(until) = lifetime { rows.push(("members".into(), object([("id", id("m")), ("group", Value::String("g".into())), ("person", id(ALICE)), ("until", Value::Int(until))]))); }
            engine.seed_at(rows, NOW).unwrap();
            engine.adopt(new.0.clone(), new.1.clone()).unwrap();
            let mut trace = epoch_snapshot_trace(&mut engine);
            let from = engine.seq().unwrap();
            let mut context = Context::system().at(NOW + 2);
            context.args = BTreeMap::from([("who".into(), id(ALICE)), ("until".into(), Value::Int(NOW + 200)), ("note".into(), id("n"))]);
            let outcome = engine.mutate("renewDelete", Some("renew-delete"), context).unwrap();
            assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            if lifetime.is_none() {
                assert!(trace.iter().flat_map(|p| p["events"].as_array().unwrap()).all(|e| !(e["table"] == "notes" && e["id"] == "n")), "a genuine acquisition learns no deleted id");
            }
            let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: new.0.public_projection(), programs: new.1.clone() };
            epoch_trace_applies(snapback4_device::memory::MemoryStore::new(), backend.clone(), &trace, "notes", &json!({"group":"g"}), &Value::Array(Vec::new()));
            epoch_trace_applies(snapback4_core::Store::memory().unwrap(), backend, &trace, "notes", &json!({"group":"g"}), &Value::Array(Vec::new()));
        }
    }
}

#[test]
fn an_expiry_default_change_starts_a_new_epoch_and_discloses_no_expired_ids() {
    let source = "table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  immutable group, person\n  unique group, person\n  expire at .until\n  read <- .person = viewer\n  insert <- exists members[.group, viewer]\n  sync\ntable notes:\n  group: text <=10\n  body: text <=10\n  read <- exists members[.group, viewer]\n  insert <- allow\n  delete <- allow\n  sync\nmutation remove(note: notes):\n  delete notes[note]\n  return null\n";
    let old = compiled(source);
    let new = compiled(&source.replace("until: time ?", &format!("until: time default {}", NOW + 200)));
    let changed = snapback4_core::partition::changed_group_audiences(Some(&old.0), &new.0);
    assert!(changed.contains(&"notes".into()), "{changed:?}");
    for limit in [1, 1_000] {
        let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
        let alice = object([("id", id("ma")), ("group", Value::String("g".into())), ("person", id(ALICE))]);
        let bob = object([("id", id("mb")), ("group", Value::String("g".into())), ("person", id(BOB)), ("until", Value::Int(NOW + 1_000))]);
        engine.seed_at([("members".into(), alice.clone()), ("members".into(), bob)], NOW).unwrap();
        // Preserve an older stored image with its optional field omitted;
        // activation interprets required literal defaults without storing them.
        engine.store().conn().execute("UPDATE r SET data = ?1 WHERE id = 'ma'", [snapback4_core::value::canonical_json(&alice)]).unwrap();
        engine.adopt_at(new.0.clone(), new.1.clone(), NOW + 100).unwrap();
        let (_, from) = engine.snapshot_at(ALICE, NOW + 150).unwrap();
        engine.seed_at([("notes".into(), object([("id", id("x")), ("group", Value::String("g".into())), ("body", Value::String("x".into()))]))], NOW + 250).unwrap();
        let mut context = Context::system().at(NOW + 260);
        context.args.insert("note".into(), id("x"));
        assert!(matches!(engine.mutate("remove", Some("remove-x"), context).unwrap().state, WriteState::Sent { .. }));
        engine.sweep_expired(NOW + 300, 100).unwrap();
        let mut watermark = from;
        loop {
            let page = engine.stream_at(ALICE, watermark, limit, NOW + 310).unwrap();
            assert!(page.events.iter().all(|event| !(event.table == "notes" && event.id == "x")), "Alice never read x: {page:?}");
            watermark = page.watermark;
            if !page.more { break; }
        }
    }
}

#[test]
fn removed_roster_joins_never_expand_under_an_owner_only_audience() {
    let old = compiled(STAFF);
    let new = compiled(&STAFF.replace("read <- .owner = viewer or exists staff[viewer]", "read <- .owner = viewer"));
    for limit in [1, 1_000] {
        let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
        engine.seed_at((staff_world().seed)(), NOW).unwrap();
        engine.adopt_at(new.0.clone(), new.1.clone(), NOW + 1).unwrap();
        let baseline = epoch_snapshot_trace(&mut engine);
        mutate(&mut engine, ALICE, "open", &[], 2);
        let head = engine.seq().unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: new.0.public_projection(), programs: new.1.clone() };
        let expected = engine.query("mine", Context::new(ALICE, BTreeMap::new()).at(NOW + 10)).unwrap().data;
        for from in 0..=head {
            let mut trace = if from == 0 { Vec::new() }
                else if from == head { epoch_snapshot_trace(&mut engine) }
                else { baseline.clone() };
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            assert!(trace.iter().flat_map(|p| p["events"].as_array().unwrap()).all(|e| !(e["table"] == "requests" && e["kind"] == "scope")), "removed group scopes cannot reappear");
            epoch_trace_applies(snapback4_device::memory::MemoryStore::new(), backend.clone(), &trace, "mine", &json!({}), &expected);
            epoch_trace_applies(snapback4_core::Store::memory().unwrap(), backend.clone(), &trace, "mine", &json!({}), &expected);
        }
    }
}

// Named disclosure follow-ups: vary wire pagination while applying to both stores.
fn snapshot_trace_at(engine: &mut Engine, viewer: &str, limit: usize) -> Vec<Json> {
    let mut trace = Vec::new();
    let mut after = None;
    loop {
        let page = engine
            .snapshot_acquisition_page_at(viewer, after.as_deref(), limit, NOW + 10)
            .unwrap();
        let next = page.next.map(|n| n.encode());
        let events: Vec<_> = page.events.iter().map(|e| json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect();
        assert!(page.acquisitions.iter().all(|a| a.at <= events.len()));
        trace.push(json!({"snapshot":true,"watermark":page.watermark,"generation":engine.generation(),"after":after,"next":next,"more":next.is_some(),"now":NOW + 10,"held":page.held,"acquisitions":page.acquisitions,"events":events}));
        after = next;
        if after.is_none() {
            return trace;
        }
    }
}

fn compare_trace<S: snapback4_device::store::DeviceStore>(
    store: S,
    b: &Backend,
    engine: &mut Engine,
    viewer: &str,
    trace: &[Json],
) {
    let backend = snapback4_device::device::Backend {
        generation: engine.generation(),
        schema: b.schema.clone(),
        programs: b.programs.clone(),
    };
    let mut device = snapback4_device::device::Device::open_store(store, Some(backend)).unwrap();
    for (n, page) in trace.iter().enumerate() {
        device
            .apply(&serde_json::from_value(page.clone()).unwrap(), n == 0)
            .unwrap();
    }
    let now = b.tables(engine);
    for (query, args, known) in (b.world.queries)(&now, viewer) {
        let (local, unknown, _) = device.query_with_coverage(query, viewer, &args, NOW + 10);
        let server = engine.query(
            query,
            Context::new(
                viewer,
                args.as_object()
                    .unwrap()
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            wire::from_json(
                                &b.programs.iter().find(|p| p.name == query).unwrap().args[k],
                                v,
                            )
                            .unwrap(),
                        )
                    })
                    .collect(),
            )
            .at(NOW + 10),
        );
        match (local, server) {
            (Ok(local), Ok(server)) => {
                if known {
                    assert!(
                        local.complete && !unknown,
                        "{query}: {local:?}, unknown={unknown}"
                    );
                }
                if local.complete && !unknown && !local.unavailable && !server.unavailable {
                    assert_eq!(local.data, server.data, "{query} for {viewer}");
                }
            }
            (Err(local), Err(server)) => assert_eq!(local.code, server.code),
            (Ok(local), Err(server)) => assert!(
                !local.complete || unknown,
                "{query}: local {local:?} vs server {server:?}"
            ),
            (Err(local), Ok(_)) => assert!(
                unknown || matches!(local.code.as_str(), "E_OFFLINE" | "E_UNAVAILABLE"),
                "{query}: {local:?}"
            ),
        }
    }
}

#[test]
fn snapshots_at_every_small_page_size_certify_each_union_arm_on_both_stores() {
    for world in [
        teams_world(),
        windowed_world(),
        staff_world(),
        parties_world(),
        three_world(),
        windowed_parties_world(false),
        windowed_parties_world(true),
        two_columns_group_world(true),
    ] {
        let b = backend(world);
        let mut engine = b.fresh();
        for viewer in PRINCIPALS {
            for limit in [1, 2, 3, 4, 5, 6, 7, 8, 1000] {
                let trace = snapshot_trace_at(&mut engine, viewer, limit);
                compare_trace(
                    snapback4_device::memory::MemoryStore::new(),
                    &b,
                    &mut engine,
                    viewer,
                    &trace,
                );
                compare_trace(
                    snapback4_core::store::Store::memory().unwrap(),
                    &b,
                    &mut engine,
                    viewer,
                    &trace,
                );
            }
        }
    }
}

#[test]
fn two_prefix_scopes_spare_both_column_keepers_without_crossing_groups() {
    let source = "table members:\n  area: text <=20\n  lane: text <=20\n  principal: principal\n  unique area, lane, principal\n  immutable area, lane, principal\n  read <- .principal = viewer\n  insert <- exists members[.area, .lane, viewer]\n  delete <- .principal = viewer\n  sync\ntable notes:\n  area: text <=20\n  lane: text <=20\n  owner: principal\n  reviewer: principal\n  at: time\n  read <- .owner = viewer or .reviewer = viewer or exists members[.area, .lane, viewer]\n  insert <- .owner = viewer and exists members[.area, .lane, viewer]\n  sync\nquery mine():\n  return notes where .reviewer = viewer first 20 by .id\nmutation leave(area: text, lane: text):\n  m = members[area, lane, viewer] ! else NOT_MEMBER\n  delete members[m]\n  return null\n";
    let (schema, programs) = compiled(source);
    for windowed in [false, true] {
        let (schema, programs) = if windowed {
            compiled(
                &source
                    .replace("  sync\nquery mine", "  sync last 3 by .at\nquery mine")
                    .replace("first 20 by .id", "last 3 by .at"),
            )
        } else {
            (schema.clone(), programs.clone())
        };
        let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
        let member = |key: &str, lane: &str| {
            (
                "members".into(),
                object([
                    ("id", id(key)),
                    ("area", Value::String("a".into())),
                    ("lane", Value::String(lane.into())),
                    ("principal", id(ALICE)),
                ]),
            )
        };
        let note = |key: &str, lane: &str, owner: &str, reviewer: &str, at: i64| {
            (
                "notes".into(),
                object([
                    ("id", id(key)),
                    ("area", Value::String("a".into())),
                    ("lane", Value::String(lane.into())),
                    ("owner", id(owner)),
                    ("reviewer", id(reviewer)),
                    ("at", Value::Int(at)),
                ]),
            )
        };
        engine
            .seed([
                member("m1", "x"),
                member("m2", "y"),
                note("owner", "x", ALICE, BOB, 1),
                note("reviewer", "x", BOB, ALICE, 2),
                note("private", "x", BOB, BOB, 3),
                note("other", "y", BOB, BOB, 4),
            ])
            .unwrap();
        let mut trace = snapshot_trace_at(&mut engine, ALICE, 1);
        let from = engine.seq().unwrap();
        mutate(
            &mut engine,
            ALICE,
            "leave",
            &[
                ("area", Value::String("a".into())),
                ("lane", Value::String("x".into())),
            ],
            1,
        );
        epoch_stream_trace(&mut engine, from, 1, &mut trace);
        assert!(
            trace
                .iter()
                .flat_map(|p| p["events"].as_array().unwrap())
                .filter(|e| e["kind"] == "scope" && e["table"] == "notes")
                .all(|e| e["data"] == json!(["a", "x", ALICE]))
        );
        let expected = engine
            .query("mine", Context::new(ALICE, BTreeMap::new()).at(NOW + 10))
            .unwrap()
            .data;
        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            schema,
            programs,
        };
        check_spared_trace(
            snapback4_device::memory::MemoryStore::new(),
            backend.clone(),
            &trace,
            &["owner", "reviewer", "other"],
            &["private"],
            "notes",
            "mine",
            &expected,
        );
        check_spared_trace(
            snapback4_core::store::Store::memory().unwrap(),
            backend,
            &trace,
            &["owner", "reviewer", "other"],
            &["private"],
            "notes",
            "mine",
            &expected,
        );
    }
}

fn check_spared_trace<S: snapback4_device::store::DeviceStore>(
    store: S,
    backend: snapback4_device::device::Backend,
    trace: &[Json],
    kept: &[&str],
    gone: &[&str],
    table: &str,
    query: &str,
    expected: &Value,
) {
    let mut device = snapback4_device::device::Device::open_store(store, Some(backend)).unwrap();
    for (n, page) in trace.iter().enumerate() {
        device
            .apply(&serde_json::from_value(page.clone()).unwrap(), n == 0)
            .unwrap();
    }
    let (answer, unknown, _) = device.query_with_coverage(query, ALICE, &json!({}), NOW + 10);
    let answer = answer.unwrap();
    assert!(answer.complete && !unknown, "{answer:?}, unknown={unknown}");
    assert_eq!(&answer.data, expected);
    assert_eq!(
        device.store().witness_count(table).unwrap(),
        kept.len() as u64,
        "the committed store keeps every spared row and removes {} revoked rows",
        gone.len()
    );
}

#[test]
fn a_large_roster_scope_walks_interleaved_owners_across_500_row_batches() {
    for windowed in [false, true] {
        let source = if windowed {
            STAFF
                .replace(
                    "  sync\n\nquery mine",
                    "  sync last 600 by .at\n\nquery mine",
                )
                .replace("first 20 by .id", "last 1 by .at")
        } else {
            STAFF.replace("first 20 by .id", "first 2000 by .id")
        };
        let (schema, programs) = compiled(&source);
        let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
        let mut seed = vec![(
            "staff".into(),
            object([("id", id("sa")), ("principal", id(ALICE))]),
        )];
        let mut kept = Vec::new();
        let mut gone = Vec::new();
        for n in 0..1200 {
            let key = format!("r{n:04}");
            let owner = if n % 2 == 0 {
                kept.push(key.clone());
                ALICE
            } else {
                gone.push(key.clone());
                BOB
            };
            seed.push((
                "requests".into(),
                object([
                    ("id", id(&key)),
                    ("owner", id(owner)),
                    ("title", Value::String("x".into())),
                    ("at", Value::Int(n)),
                ]),
            ));
        }
        engine.seed(seed.clone()).unwrap();
        for limit in [1, 1000] {
            let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
            let from = engine.seq().unwrap();
            // Rebuild below for the second pagination variant.
            mutate(&mut engine, ALICE, "quit", &[], 1);
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            let expected = engine
                .query("mine", Context::new(ALICE, BTreeMap::new()).at(NOW + 10))
                .unwrap()
                .data;
            let backend = snapback4_device::device::Backend {
                generation: engine.generation(),
                schema: schema.clone(),
                programs: programs.clone(),
            };
            let kept: Vec<_> = kept.iter().map(String::as_str).collect();
            let gone: Vec<_> = gone.iter().map(String::as_str).collect();
            check_spared_trace(
                snapback4_device::memory::MemoryStore::new(),
                backend.clone(),
                &trace,
                &kept,
                &gone,
                "requests",
                "mine",
                &expected,
            );
            check_spared_trace(
                snapback4_core::store::Store::memory().unwrap(),
                backend,
                &trace,
                &kept,
                &gone,
                "requests",
                "mine",
                &expected,
            );
            engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
            engine.seed(seed.clone()).unwrap();
        }
    }
}

#[test]
fn epoch_identity_changes_for_each_interpretation_and_inherited_lifetime_input() {
    use snapback4_core::schema::{ColumnDefault, ColumnType, Index};
    let (schema, _) = compiled(TEAMS);
    for input in [
        "content-type",
        "group-type",
        "recipient-type",
        "index",
        "capture",
        "ancestor-default",
        "ancestor-expiry-type",
        "ancestor-expiry-column",
    ] {
        let mut before = schema.clone();
        if input.starts_with("ancestor") || input == "capture" {
            let mut parent = before.tables["members"].clone();
            parent.columns.insert(
                "until".into(),
                ColumnType::Optional(Box::new(ColumnType::Time)),
            );
            parent.expire = Some("until".into());
            before.tables.insert("parents".into(), parent);
            before.tables.get_mut("members").unwrap().through =
                Some(snapback4_core::schema::through::Through {
                    reference: "parent".into(),
                    parent: "parents".into(),
                    fields: BTreeMap::new(),
                    identity: "capture".into(),
                    expiring: true,
                });
        }
        let mut after = before.clone();
        match input {
            "content-type" => {
                after
                    .tables
                    .get_mut("tasks")
                    .unwrap()
                    .columns
                    .insert("team".into(), ColumnType::Text { max: 20 });
            }
            "group-type" => {
                after
                    .tables
                    .get_mut("members")
                    .unwrap()
                    .columns
                    .insert("team".into(), ColumnType::Text { max: 20 });
            }
            "recipient-type" => {
                after.tables.get_mut("members").unwrap().columns.insert(
                    "principal".into(),
                    ColumnType::Optional(Box::new(ColumnType::Principal)),
                );
            }
            "index" => {
                let members = after.tables.get_mut("members").unwrap();
                let columns: Vec<String> = vec!["team".into(), "principal".into()];
                members.indexes.retain(|_, i| i.columns() != columns);
                members
                    .indexes
                    .insert("renamed".into(), Index::of(&["team", "principal"], true));
            }
            "capture" => {
                after
                    .tables
                    .get_mut("members")
                    .unwrap()
                    .through
                    .as_mut()
                    .unwrap()
                    .identity = "new-capture".into();
            }
            "ancestor-default" => {
                after
                    .tables
                    .get_mut("parents")
                    .unwrap()
                    .defaults
                    .insert("until".into(), ColumnDefault::Literal(Value::Int(NOW)));
            }
            "ancestor-expiry-type" => {
                after
                    .tables
                    .get_mut("parents")
                    .unwrap()
                    .columns
                    .insert("until".into(), ColumnType::Time);
            }
            "ancestor-expiry-column" => {
                after.tables.get_mut("parents").unwrap().expire = Some("other".into());
            }
            _ => unreachable!(),
        }
        assert!(
            snapback4_core::partition::changed_group_audiences(Some(&before), &after)
                .contains(&"tasks".into()),
            "{input}"
        );
    }
}

#[test]
fn rebirth_chains_disclose_only_commit_boundary_audiences() {
    let source = format!(
        "{TEAMS}\nmutation rebirth(task: tasks, team: teams, to: principal):\n  t = tasks[task] ! else NOT_FOUND\n  update tasks[t] {{ team }}\n  delete tasks[t]\n  r = insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n  update tasks[r] {{ owner: to }}\n  return null\nmutation born(team: teams, to: principal):\n  t = insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n  update tasks[t] {{ team: 't1' }}\n  update tasks[t] {{ team }}\n  delete tasks[t]\n  r = insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n  update tasks[r] {{ owner: to }}\n  return null\n"
    );
    let (schema, programs) = compiled(&source);
    for op in ["rebirth", "born"] {
        let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
        engine.seed(teams_seed()).unwrap();
        engine
            .seed([(
                "members".into(),
                object([
                    ("id", id("mm1")),
                    ("team", id("t1")),
                    ("principal", id(MALLORY)),
                ]),
            )])
            .unwrap();
        let before = engine.seq().unwrap();
        let args = BTreeMap::from([
            ("task".into(), id("ka")),
            ("team".into(), id("t2")),
            ("to".into(), id(BOB)),
        ]);
        let args = if op == "born" {
            args.into_iter().filter(|(k, _)| k != "task").collect()
        } else {
            args
        };
        let key = if op == "born" { "born" } else { "ka" };
        let out = engine
            .mutate(
                op,
                Some(op),
                Context::new(ALICE, args)
                    .at(NOW + 1)
                    .with_ids([key.into(), key.into()]),
            )
            .unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        for limit in [1, 1000] {
            for (viewer, reads) in [(ALICE, true), (BOB, true), (MALLORY, false)] {
                let mut from = before;
                let mut events = Vec::new();
                loop {
                    let page = engine.stream_at(viewer, from, limit, NOW + 10).unwrap();
                    from = page.watermark;
                    events.extend(page.events);
                    if !page.more {
                        break;
                    }
                }
                let named: Vec<_> = events
                    .iter()
                    .filter(|e| e.table == "tasks" && e.id == key)
                    .collect();
                if reads {
                    assert!(
                        named.iter().any(|e| e.kind == "put"),
                        "{op} for {viewer}: {named:?}"
                    );
                } else if op == "born" {
                    assert!(
                        named.is_empty(),
                        "a transient birth names no id to {viewer}: {named:?}"
                    );
                } else {
                    assert!(
                        named.iter().any(|e| e.kind == "del")
                            && named.iter().all(|e| e.kind != "put"),
                        "old reader gets only revocation: {named:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn windowed_epoch_leave_rejoin_create_is_blocking_on_both_stores() {
    let b = backend(windowed_world());
    // Change the group arm before the three separate commits.
    let (mut schema, programs) = compiled(&b.world.source);
    schema.tables.get_mut("members").unwrap().defaults.insert(
        "principal".into(),
        snapback4_core::schema::ColumnDefault::Literal(id(MALLORY)),
    );
    for limit in [1, 2, 3, 1000] {
        let mut engine = b.fresh();
        engine
            .seed([(
                "members".into(),
                object([
                    ("id", id("mm1")),
                    ("team", id("t1")),
                    ("principal", id(MALLORY)),
                ]),
            )])
            .unwrap();
        engine.adopt(schema.clone(), programs.clone()).unwrap();
        let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
        let from = engine.seq().unwrap();
        mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
        // Alice must be reacquired by an existing t1 member.
        mutate(
            &mut engine,
            MALLORY,
            "add",
            &[("team", id("t1")), ("who", id(ALICE))],
            2,
        );
        mutate(&mut engine, ALICE, "create", &[("team", id("t1"))], 3);
        epoch_stream_trace(&mut engine, from, limit, &mut trace);
        let b = Backend {
            world: windowed_world(),
            schema: schema.clone(),
            programs: programs.clone(),
        };
        compare_trace(
            snapback4_device::memory::MemoryStore::new(),
            &b,
            &mut engine,
            ALICE,
            &trace,
        );
        compare_trace(
            snapback4_core::store::Store::memory().unwrap(),
            &b,
            &mut engine,
            ALICE,
            &trace,
        );
    }
}

#[test]
fn roster_and_team_scopes_interleave_with_both_tables_owner_changes() {
    let staff = STAFF
        .replace("mutation ", "mutation staff")
        .replace("query ", "query staff");
    for reverse in [false, true] {
        let writes = [
            "  update tasks[t] { owner: to }",
            "  delete members[m]",
            "  update requests[r] { owner: to }",
            "  delete staff[s]",
        ];
        let writes: Vec<_> = if reverse {
            writes.into_iter().rev().collect()
        } else {
            writes.into_iter().collect()
        };
        let source = format!(
            "{TEAMS}\n{staff}\nmutation interleave(task: tasks, request: requests, to: principal):\n  t = tasks[task] ! else NOT_FOUND\n  m = members[t.team, viewer] ! else NOT_MEMBER\n  r = requests[request] ! else NOT_FOUND\n  s = staff[viewer] ! else NOT_STAFF\n{}\n  return null\n",
            writes.join("\n")
        );
        let (schema, programs) = compiled(&source);
        for limit in [1, 3, 1000] {
            let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
            let mut seed = teams_seed();
            seed.extend([
                (
                    "staff".into(),
                    object([("id", id("sa")), ("principal", id(ALICE))]),
                ),
                (
                    "requests".into(),
                    object([
                        ("id", id("r")),
                        ("owner", id(ALICE)),
                        ("title", Value::String("x".into())),
                        ("at", Value::Int(1)),
                    ]),
                ),
                (
                    "requests".into(),
                    object([
                        ("id", id("private")),
                        ("owner", id(BOB)),
                        ("title", Value::String("x".into())),
                        ("at", Value::Int(2)),
                    ]),
                ),
            ]);
            engine.seed(seed).unwrap();
            let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
            let from = engine.seq().unwrap();
            mutate(
                &mut engine,
                ALICE,
                "interleave",
                &[("task", id("ka")), ("request", id("r")), ("to", id(BOB))],
                1,
            );
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            let backend = snapback4_device::device::Backend {
                generation: engine.generation(),
                schema: schema.clone(),
                programs: programs.clone(),
            };
            for query in ["myCount", "staffmine"] {
                let expected = engine
                    .query(query, Context::new(ALICE, BTreeMap::new()).at(NOW + 10))
                    .unwrap()
                    .data;
                epoch_trace_applies(
                    snapback4_device::memory::MemoryStore::new(),
                    backend.clone(),
                    &trace,
                    query,
                    &json!({}),
                    &expected,
                );
                epoch_trace_applies(
                    snapback4_core::store::Store::memory().unwrap(),
                    backend.clone(),
                    &trace,
                    query,
                    &json!({}),
                    &expected,
                );
            }
        }
    }
}

#[test]
fn renewal_epoch_and_sweep_between_pages_name_only_previously_readable_ids() {
    let old = "table members:\n  principal: principal\n  until: time ?\n  unique principal\n  immutable principal\n  expire at .until\n  read <- .principal = viewer\n  insert <- exists members[viewer]\n  update <- .principal = viewer\n  delete <- .principal = viewer\n  sync\ntable notes:\n  at: time\n  read <- exists members[viewer]\n  insert <- exists members[viewer]\n  delete <- exists members[viewer]\n  online only\nquery notes():\n  return notes last 2 by .at\nmutation renew(until: time ?):\n  upsert members[id = 'ma'] { principal: viewer, until }\n  return null\nmutation remove(n: notes):\n  delete notes[n]\n  return null\n";
    let synced = old.replace("  online only", "  sync last 2 by .at");
    let (old_schema, old_programs) = compiled(old);
    let (schema, programs) = compiled(&synced);
    // An expiring group is still outside the union contract, including read-through lifetimes.
    let refused = snapback4_lang::compile(&[(
        "bad.q".into(),
        synced.replace(
            "  at: time\n  read <- exists",
            "  owner: principal\n  at: time\n  read <- .owner = viewer or exists",
        ),
    )]);
    assert!(
        refused
            .diagnostics
            .iter()
            .any(|d| d.code == "E_SYNC" && d.message.contains("cannot expire")),
        "{:?}",
        refused.diagnostics
    );
    for limit in [1, 2, 1000] {
        let mut engine = Engine::memory(old_schema.clone(), old_programs.clone()).unwrap();
        engine
            .seed([
                (
                    "members".into(),
                    object([
                        ("id", id("ma")),
                        ("principal", id(ALICE)),
                        ("until", Value::Int(NOW + 100)),
                    ]),
                ),
                (
                    "notes".into(),
                    object([("id", id("old")), ("at", Value::Int(1))]),
                ),
                (
                    "notes".into(),
                    object([("id", id("new")), ("at", Value::Int(2))]),
                ),
            ])
            .unwrap();
        engine.adopt(schema.clone(), programs.clone()).unwrap();
        let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
        let from = engine.seq().unwrap();
        mutate(
            &mut engine,
            ALICE,
            "renew",
            &[("until", Value::Int(NOW + 200))],
            1,
        );
        mutate(&mut engine, ALICE, "remove", &[("n", id("old"))], 2);
        let first = engine.stream_at(ALICE, from, limit, NOW + 10).unwrap();
        let events:Vec<_>=first.events.iter().map(|e|json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect();
        trace.push(json!({"snapshot":false,"watermark":first.watermark,"more":first.more,"now":NOW+10,"generation":engine.generation(),"events":events,"acquisitions":first.acquisitions,"images_at":first.images_at,"joined":first.joined}));
        // Sweep after the first wire page, then revive through an existing live roster reader.
        engine.sweep_expired(NOW + 201, 100).unwrap();
        engine
            .seed_at(
                [(
                    "members".into(),
                    object([
                        ("id", id("ma")),
                        ("principal", id(ALICE)),
                        ("until", Value::Int(NOW + 1000)),
                    ]),
                )],
                NOW + 300,
            )
            .unwrap();
        stream_trace_at(&mut engine, first.watermark, limit, NOW + 310, &mut trace);
        let expected = engine
            .query("notes", Context::new(ALICE, BTreeMap::new()).at(NOW + 310))
            .unwrap()
            .data;
        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            schema: schema.clone(),
            programs: programs.clone(),
        };
        epoch_trace_applies(
            snapback4_device::memory::MemoryStore::new(),
            backend.clone(),
            &trace,
            "notes",
            &json!({}),
            &expected,
        );
        epoch_trace_applies(
            snapback4_core::store::Store::memory().unwrap(),
            backend,
            &trace,
            "notes",
            &json!({}),
            &expected,
        );
    }
}

#[test]
fn a_rebound_already_expired_grant_never_names_its_new_group() {
    let old = "table members:\n  team: text <=20\n  alternate: text <=20\n  person: principal\n  until: time ?\n  immutable team, alternate, person\n  unique team, person\n  unique person\n  read <- .person = viewer\n  insert <- exists members[.team, viewer]\n  delete <- .person = viewer\n  sync\ntable notes:\n  owner: principal\n  team: text <=20\n  body: text <=20\n  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer\n  sync\nmutation remove(person: principal):\n  m = members[person = person] ! else NOT_FOUND\n  delete members[m]\n  return null\n";
    let new = old.replace("until: time ?", &format!("until: time default {}\n  expire at .until", NOW+50))
        .replace("unique team, person", "unique alternate, person")
        .replace(".owner = viewer or exists members[.team, viewer]", "exists members[.team, viewer]")
        .replace("insert <- exists members[.team, viewer]", "insert <- exists members[.alternate, viewer]");
    let old=compiled(old); let new=compiled(&new);
    for limit in [1,1000] {
        let mut engine=Engine::memory(old.0.clone(),old.1.clone()).unwrap();
        let alice=object([("id",id("ma")),("team",Value::String("old-a".into())),("alternate",Value::String("never-held".into())),("person",id(ALICE))]);
        let bob=object([("id",id("mb")),("team",Value::String("old-b".into())),("alternate",Value::String("live-b".into())),("person",id(BOB)),("until",Value::Int(NOW+1000))]);
        engine.seed_at([("members".into(),alice.clone()),("members".into(),bob)],NOW).unwrap();
        engine.store().conn().execute("UPDATE r SET data = ?1 WHERE id = 'ma'",[snapback4_core::value::canonical_json(&alice)]).unwrap();
        engine.adopt_at(new.0.clone(),new.1.clone(),NOW+100).unwrap();
        let (_,watermark)=engine.snapshot_at(ALICE,NOW+150).unwrap();
        for swept in [false,true] {
            if swept { engine.sweep_expired(NOW+300,100).unwrap(); }
            for from in [0,watermark] {
                let mut from=from;
                loop {
                    let page=engine.stream_at(ALICE,from,limit,NOW+310).unwrap();
                    assert!(page.events.iter().all(|e|e.table!="notes" || e.kind!="scope"),"{swept}, {page:?}");
                    from=page.watermark;if !page.more {break;}
                }
            }
        }
        let (_,from)=engine.snapshot_at(BOB,NOW+310).unwrap();
        mutate(&mut engine,BOB,"remove",&[("person",id(BOB))],400);
        let page=engine.stream_at(BOB,from,limit,NOW+500).unwrap();
        assert!(page.events.iter().any(|e| e.table=="notes" && e.kind=="scope" && e.data==Some(Value::Array(vec![Value::String("live-b".into())]))),"a grant live after activation still revokes: {page:?}");
    }
}
