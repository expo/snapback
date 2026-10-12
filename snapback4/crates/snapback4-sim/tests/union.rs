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
            let mut out = parties_world().ops.clone()(now);
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
