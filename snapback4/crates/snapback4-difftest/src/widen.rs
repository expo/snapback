//! Generator widening (LLP 3000.035 §5.1, "what slice A does not cover").
//!
//! Each dimension is drawn from a stream independent of the base generator
//! (`generate::base`), so a seed whose draws select nothing is exactly the
//! base case, and every existing shape keeps its frequency apart from the
//! cases a dimension rewrites:
//!
//! - **prefetch-reachable reads**: a page (or bounded page) projecting
//!   cross-table point reads whose keys vary across its rows,
//!   `{ id, t: tags[.tag], u: tags[name = .label] }`, or a loop over a page
//!   reading `tags[row.tag]` (`Read::Fold`). `tags` has distinct ids, a
//!   unique `name` and, mostly, an owner read rule, so the Postgres batch
//!   planner marks, transfers and consumes rows
//!   (`issues/closed/20261007-quarry-store-oracle-prefetch-coverage-gap.md`);
//! - **blocks**: a mutation of several statements (lets, `require`, `if`,
//!   writes to `key` and `k2`, reads after writes);
//! - **a prelude**: further mutations run in sequence on the same store
//!   before `run`, possibly as another viewer, so state carries between
//!   operations; `observe` reads both keys afterwards;
//! - **expiry**: `expire at .until` on `items` (and sometimes `tags`), rows
//!   expiring at, just before and just after each operation's clock, a clock
//!   that advances between operations, sweeps, and writes setting
//!   `until: now + ttl`;
//! - **lower read lifetimes**, from their own stream: `not before .opensAt`
//!   rows null-open and just before, exactly at and just after the request
//!   clock, shared by the native, device and Lean campaigns;
//! - **secondary unique clashes** (OPEN W4): block writes put `tag0`/`tag1`,
//!   which seeded rows hold, into the unique `byTag`;
//! - **calendar builtins** (LLP 3000.040 §2): a scalar `run` over a `t: time`
//!   argument drawn from the shared calendar vectors, their edges, the i53
//!   ends and random times: `month`, `year`, `day`, `hour`, `bucket`,
//!   `monthStart`/`yearStart` round trips and their overflow;
//! - **bounded ints** (LLP 3000.040 §1): `items.score` declared `int M..N`,
//!   `int M..` or `int ..N`, seeded rows inside the bound, writes of the
//!   ordinary arithmetic that may leave it (`E_INPUT` on every host).
//!
//! Calendar and bounded-int dimensions draw from their own stream, so
//! every earlier dimension's decisions are unchanged.
//! - **branch pages** (LLP 3000.036.001), from their own stream: a page whose
//!   `where` is an `or` of pinned branches (`.bucket = bucket or .bucket = 1`,
//!   `.owner = viewer or .helper = viewer`), or whose read rule is two parties
//!   (`.owner = viewer or .helper = viewer`, with a `helper` column), so the
//!   merged plan, its cursor and its cuts meet every oracle.
//! - **bounded membership pages**, from their own stream: an unpinned page
//!   whose owner-or-membership rule discovers at most 16 held groups, with
//!   positional and reordered named membership probes.
// @ref LLP 3000.035#5.1 — generator widening behind independent probabilities.
use crate::{
    ast::*,
    generate::{Case, Rng, Step, TEXTS, VALUES},
};
use serde_json::{Value as Json, json};

const STREAM: u64 = 0x5749_4445_4e5f_4757;
const BRANCH_STREAM: u64 = 0x4252_414e_4348_4553;
const MEMBERSHIP_STREAM: u64 = 0x4d45_4d42_4552_4e41;
const NOT_BEFORE_STREAM: u64 = 0x4e4f_545f_4245_464f;
/// Clock gaps between operations (ms); 0 makes two operations simultaneous.
const GAPS: [i64; 6] = [0, 1, 37, 500, 1000, 60_000];
/// Offsets from an operation's clock at which a row expires.
const EDGES: [i64; 5] = [-1, 0, 1, 499, 2];
const TTLS: [i64; 4] = [0, 1, 50, 1000];
const KEYS: [&str; 5] = ["r0", "r1", "r2", "missing", "r3"];

fn int(rng: &mut Rng, vars: &[String], depth: u32) -> Expr {
    match rng.pick(if depth > 1 { 5 } else { 8 }) {
        0 => Expr::Arg("a".into(), Type::Int),
        1 => Expr::Arg("b".into(), Type::Int),
        2 => Expr::Int([0, 1, 2, -1, 7][rng.pick(5) as usize]),
        3 if !vars.is_empty() => Expr::Var(vars[rng.pick(vars.len() as u64) as usize].clone(), Type::Int),
        3 | 4 => Expr::Score(key(rng)),
        n => Expr::Binary(
            if n == 7 { Bin::Mul } else { Bin::Add },
            Box::new(int(rng, vars, depth + 1)),
            Box::new(int(rng, vars, depth + 1)),
        ),
    }
}
fn boolean(rng: &mut Rng, vars: &[String], depth: u32) -> Expr {
    match rng.pick(if depth > 0 { 4 } else { 6 }) {
        0 => Expr::Present(key(rng)),
        1 => Expr::Binary(Bin::Eq, Box::new(int(rng, vars, 1)), Box::new(int(rng, vars, 1))),
        2 => Expr::Binary(Bin::Lt, Box::new(int(rng, vars, 1)), Box::new(int(rng, vars, 1))),
        3 => Expr::Bool(rng.pick(2) == 0),
        n => Expr::Binary(
            if n == 4 { Bin::Or } else { Bin::And },
            Box::new(boolean(rng, vars, depth + 1)),
            Box::new(boolean(rng, vars, depth + 1)),
        ),
    }
}
fn key(rng: &mut Rng) -> Key {
    if rng.pick(5) < 3 { Key::Key } else { Key::K2 }
}
fn write(rng: &mut Rng, vars: &[String], expire: bool) -> Stmt {
    let kind = [Write::Insert, Write::Upsert, Write::Update, Write::Delete][rng.pick(4) as usize].clone();
    Stmt::Write {
        kind,
        target: key(rng),
        value: int(rng, vars, 1),
        tag: ["tag", "tag0", "tag1", "tagx"][rng.pick(4) as usize].into(),
        ttl: (expire && rng.pick(2) == 0).then(|| TTLS[rng.pick(TTLS.len() as u64) as usize]),
    }
}
/// A block of one to four statements with at least one write. Lets are
/// top-level only, so every `Var` is in scope where it is used.
pub fn block(rng: &mut Rng, expire: bool, first: Option<Stmt>) -> Block {
    let mut vars: Vec<String> = vec![];
    let mut stmts = vec![];
    let n = 1 + rng.pick(4);
    let at = first.as_ref().map(|_| rng.pick(n + 1));
    for i in 0..n {
        if at == Some(i) {
            stmts.push(first.clone().unwrap());
        }
        stmts.push(match rng.pick(8) {
            0..=2 => write(rng, &vars, expire),
            3 | 4 => {
                let name = format!("v{i}");
                let e = int(rng, &vars, 0);
                vars.push(name.clone());
                Stmt::Let(name, e)
            }
            5 => Stmt::Require(boolean(rng, &vars, 0), "REQUIRED".into()),
            _ => {
                let then = vec![if rng.pick(3) == 0 { Stmt::Require(boolean(rng, &vars, 1), "REQUIRED".into()) } else { write(rng, &vars, expire) }];
                let otherwise = if rng.pick(2) == 0 { vec![write(rng, &vars, expire)] } else { vec![] };
                Stmt::If(boolean(rng, &vars, 0), then, otherwise)
            }
        });
    }
    if at == Some(n) {
        stmts.push(first.unwrap());
    }
    if !stmts.iter().any(|s| {
        let mut all = vec![];
        s.walk(&mut all);
        all.iter().any(|s| matches!(s, Stmt::Write { .. }))
    }) {
        stmts.push(write(rng, &vars, expire));
    }
    let ret = match rng.pick(3) {
        0 => boolean(rng, &vars, 0),
        _ => int(rng, &vars, 1),
    };
    Block { stmts, ret }
}
fn column(name: &str, ty: Type) -> Column {
    Column { name: name.into(), ty }
}
fn until() -> Column {
    column("until", Type::Nullable(Box::new(Type::Time)))
}
/// Pageable `items` rows: six to fourteen in the case's bucket.
fn page_rows(rng: &mut Rng, bucket: &Json, a: i64) -> Vec<(String, Json)> {
    (0..6 + rng.pick(9))
        .map(|i| {
            ("items".into(), json!({"id":format!("r{i}"), "owner":if rng.pick(2)==0 {"alice"} else {"bob"}, "bucket":bucket, "score":VALUES[rng.pick(7) as usize], "label":TEXTS[rng.pick(7) as usize], "flag":rng.pick(4)!=0, "maybe":if rng.pick(2)==0 {Json::Null} else {json!(a)}, "tag":format!("tag{i}")}))
        })
        .collect()
}
fn tags_table(rng: &mut Rng) -> Table {
    let rule = [Rule::Owner, Rule::Owner, Rule::Owner, Rule::Owner, Rule::Owner, Rule::Allow, Rule::Allow, Rule::Deny][rng.pick(8) as usize].clone();
    let residency = if rng.pick(3) == 0 {
        Residency::Online
    } else {
        match rule {
            Rule::Owner => Residency::Owner,
            Rule::Allow => Residency::Public,
            _ => Residency::Online,
        }
    };
    Table {
        name: "tags".into(),
        columns: vec![column("owner", Type::Principal), column("rank", Type::Int), column("name", Type::Text)],
        keys: vec![("byName".into(), vec!["name".into()], true)],
        caps: vec![],
        rule,
        residency,
        effects: None,
        expire: None,
        not_before: None,
    }
}
fn tags_rows(rng: &mut Rng) -> Vec<(String, Json)> {
    let mut rows = vec![];
    for (i, name) in TEXTS.iter().enumerate() {
        if rng.pick(3) != 0 {
            let owner = if rng.pick(2) == 0 { "alice" } else { "bob" };
            rows.push(("tags".into(), json!({"id": format!("tag{i}"), "owner": owner, "rank": rng.pick(10), "name": name})));
        }
    }
    rows
}
fn step_args(rng: &mut Rng) -> Json {
    let a = VALUES[rng.pick(7) as usize];
    let b = [0, 1, -1, 7][rng.pick(4) as usize];
    json!({"key": KEYS[rng.pick(5) as usize], "k2": KEYS[rng.pick(5) as usize], "bucket": rng.pick(2), "c": null,
        "n": if rng.pick(2) == 0 { Json::Null } else { json!(a) }, "a": a, "b": b})
}

pub fn widen(mut case: Case) -> Case {
    let mut rng = Rng::new(case.seed ^ STREAM);
    // Draw every dimension's decision first, in a fixed order.
    let expire_draw = rng.pick(6) == 0;
    let project = rng.pick(2) == 0;
    let convert = rng.pick(5) == 0;
    let blocky = rng.pick(2) == 0;
    let scalar_block = rng.pick(6) == 0;
    let prelude = rng.pick(6) == 0;
    let p = &mut case.program;
    let mut tags = false;
    // Prefetch-reachable reads.
    let pageable = matches!(p.body, Body::Read { kind: Read::Page | Read::Bounded, .. });
    if pageable && project {
        if let Body::Read { project, .. } = &mut p.body {
            *project = Some(projection(&mut rng));
        }
        tags = true;
    } else if matches!(p.body, Body::Scalar(_)) && convert {
        let kind = [Read::Page, Read::Page, Read::Bounded, Read::Fold][rng.pick(4) as usize].clone();
        let fold = matches!(kind, Read::Fold);
        p.body = Body::Read {
            kind,
            take: (rng.pick(5) + 4) as u32,
            descending: rng.pick(2) == 0,
            filter: rng.pick(4) == 0,
            owner: p.tables[0].rule == Rule::Owner,
            project: (!fold).then(|| projection(&mut rng)),
        };
        let a = case.args["a"].as_i64().unwrap_or(0);
        let bucket = case.args["bucket"].clone();
        case.rows.retain(|(t, _)| t != "items");
        let mut rows = page_rows(&mut rng, &bucket, a);
        rows.append(&mut case.rows);
        case.rows = rows;
        tags = true;
    }
    if tags {
        p.tables.push(tags_table(&mut rng));
        case.rows.extend(tags_rows(&mut rng));
    }
    branches(&mut case);
    predicate_reads(&mut case);
    let expire = expire_draw && !matches!(case.program.tables[0].residency, Residency::Group);
    // Blocks.
    let p = &mut case.program;
    match &p.body {
        Body::Write(kind, e) if blocky => {
            let first = Stmt::Write { kind: kind.clone(), target: Key::Key, value: e.clone(), tag: "tag".into(), ttl: None };
            p.body = Body::Block(block(&mut rng, expire, Some(first)));
        }
        Body::Scalar(_) if scalar_block && !convert => p.body = Body::Block(block(&mut rng, expire, None)),
        _ => {}
    }
    // A prelude of one to three mutations, sometimes as the other viewer.
    if prelude {
        for _ in 0..1 + rng.pick(3) {
            p.prelude.push(block(&mut rng, expire, None));
            let args = step_args(&mut rng);
            let viewer = (rng.pick(3) == 0).then(|| if case.principal == "alice" { "bob" } else { "alice" }.to_owned());
            case.steps.push(Step { args, at: 0, viewer, sweep: false });
        }
    }
    if p.wide() {
        case.args["k2"] = json!(["r1", "r0", "missing2"][rng.pick(3) as usize]);
    }
    // The clock: seeded, then each step, then `run`; it advances when there
    // is a prelude or expiry. Times stay positive.
    lang2(&mut case);
    if !case.steps.is_empty() || expire {
        case.clock += 300_000;
        let mut at = case.clock;
        let mut times = vec![case.clock];
        for _ in 0..=case.steps.len() {
            at -= GAPS[rng.pick(GAPS.len() as u64) as usize];
            times.push(at);
        }
        times.reverse();
        case.seeded_at = Some(times[0]);
        for (i, step) in case.steps.iter_mut().enumerate() {
            step.at = times[i + 1];
            step.sweep = expire && rng.pick(3) == 0;
        }
        case.sweep = expire && rng.pick(3) == 0;
        // Group cases qualify trusted logical verdicts with live rows. Physical
        // expired server candidates absent from acquisition have a separate
        // examined-meter mismatch (the inherited metered-examined signature).
        if expire && !matches!(case.program.tables[0].residency, Residency::Group) {
            let p = &mut case.program;
            p.tables[0].columns.push(until());
            p.tables[0].expire = Some("until".into());
            let expire_tags = rng.pick(4) == 0;
            if let Some(t) = p.tables.iter_mut().find(|t| t.name == "tags").filter(|_| expire_tags) {
                t.columns.push(until());
                t.expire = Some("until".into());
            }
            for (table, row) in &mut case.rows {
                if table == "items" || (table == "tags" && expire_tags) {
                    row["until"] = if rng.pick(3) == 0 {
                        Json::Null
                    } else {
                        json!(times[rng.pick(times.len() as u64) as usize] + EDGES[rng.pick(EDGES.len() as u64) as usize])
                    };
                }
            }
        }
    }
    references(&mut case);
    timed_disclosure(&mut case);
    membership_page(&mut case);
    case
}

/// Add lower-bound rows from an independent stream. Every selected case has
/// null-open, before-boundary, exact-boundary and future rows.
fn timed_disclosure(case: &mut Case) {
    let mut rng = Rng::new(case.seed ^ NOT_BEFORE_STREAM);
    if rng.pick(8) != 0 { return }
    // The executable model describes live(now), while the host publishes a
    // bounded pending backlog across requests. Seed at this request's clock
    // and avoid sequential clocks here; lifecycle tests cover publication.
    if case.seeded_at.is_some() || !case.steps.is_empty() { return }
    if case.rows.iter().filter(|(name, _)| name == "items").count() < 4 { return }
    let write = match &case.program.body {
        Body::Write(kind, _) => Some(kind.clone()),
        _ => None,
    };
    let table = &mut case.program.tables[0];
    if table.columns.iter().any(|c| c.name == "opensAt") { return }
    table.columns.push(Column { name: "opensAt".into(), ty: Type::Nullable(Box::new(Type::Time)) });
    table.keys.push(("byOpensAt".into(), vec!["opensAt".into(), "id".into()], false));
    table.not_before = Some("opensAt".into());
    let values = [Json::Null, json!(case.clock - 1), json!(case.clock), json!(case.clock + 1)];
    let mut i = 0;
    let mut future_key = None;
    let mut future_tag = None;
    for (name, row) in &mut case.rows {
        if name == &table.name {
            row["opensAt"] = values[i % values.len()].clone();
            if i % values.len() == 3 {
                future_key = row["id"].as_str().map(str::to_owned);
                if matches!(write, Some(Write::Insert)) {
                    row["tag"] = json!("tag");
                }
                future_tag = row["tag"].as_str().map(str::to_owned);
            }
            i += 1;
        }
    }
    match write {
        Some(Write::Insert) => {
            // The id is absent while `byTag` is occupied by a future row.
            // A physical unique lookup must refuse without disclosing it.
            table.rule = Rule::Allow;
            case.args["key"] = json!("future-unique-duplicate");
        }
        Some(Write::Upsert) => {
            // Natural-key target resolution is physical: patch this future
            // row, but keep its result/read image hidden until the boundary.
            table.rule = Rule::Allow;
            case.program.upsert_unique_tag = future_tag;
            if let Some(key) = future_key {
                case.args["key"] = json!(key);
            }
        }
        Some(Write::Update | Write::Delete) => {
            if let Some(key) = future_key {
                case.args["key"] = json!(key);
            }
        }
        None => {}
    }
}

/// Add the bounded focal owner-or-membership shape to the ordinary campaign,
/// after other widening so its final plan reaches native rewrite and meter
/// oracles. The access table in every base case already carries the cap and
/// inverse principal index required for bounded discovery.
fn membership_page(case: &mut Case) {
    let mut rng = Rng::new(case.seed ^ MEMBERSHIP_STREAM);
    let Body::Read { kind: Read::Page | Read::Bounded, filter, owner, project, .. } = &mut case.program.body else { return };
    if rng.pick(16) != 0 { return }
    *filter = false;
    *owner = false;
    *project = None;
    let items = &mut case.program.tables[0];
    items.rule = Rule::OwnerOrWitness;
    items.effects = None;
    items.residency = Residency::Online;
    let access = case.program.tables.iter_mut().find(|table| table.name == "access").expect("generated access table");
    access.rule = Rule::Allow;
    access.effects = None;
    access.residency = Residency::Public;
    case.program.domain = Some("true".into());
    case.program.order = Some(vec!["id".into()]);
    case.program.residual = None;
    case.program.guard = None;
    case.program.membership_named_reordered = rng.pick(2) == 0;
}
/// Branch pages (LLP 3000.036.001), drawn from their own stream so every
/// other dimension's draws are unchanged.
fn branches(case: &mut Case) {
    let mut rng = Rng::new(case.seed ^ BRANCH_STREAM);
    if !matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, .. }) || rng.pick(4) != 0 {
        return;
    }
    let shape = rng.pick(4);
    let p = &mut case.program;
    // A party rule's page drops its owner pin, so its branches decide it.
    if shape < 2 && let Body::Read { owner, .. } = &mut p.body {
        *owner = false;
    }
    match shape {
        // Two parties in the read rule; `where` an `or` of the parties, or the bucket alone.
        0 | 1 => {
            p.tables[0].rule = Rule::TwoParty;
            p.tables[0].residency = Residency::Online;
            p.tables[0].columns.push(column("helper", Type::Nullable(Box::new(Type::Principal))));
            if shape == 0 {
                p.domain = Some("(.owner = viewer or .helper = viewer) and .bucket = bucket".into());
            }
            for (table, row) in &mut case.rows {
                if table == "items" {
                    row["helper"] = [Json::Null, json!("alice"), json!("bob")][rng.pick(3) as usize].clone();
                }
            }
        }
        // A bucket disjunction, under the case's rule (decided per bucket only by
        // `Witness`; an owner page keeps its pin and its single-index plan).
        _ => {
            p.domain = Some("(.bucket = bucket or .bucket = 1)".into());
            if shape == 3 {
                p.tables[0].rule = Rule::Witness;
                p.tables[0].residency = Residency::Group;
                // The membership insert rule must prove the group's audience.
                let access = p.tables.iter_mut().find(|t| t.name == "access").unwrap();
                access.rule = Rule::Member;
                access.effects = Some(vec![Rule::Member, Rule::Witness, Rule::Deny, Rule::Deny]);
                // Membership delivery follows its principal; items follow the held group.
                access.residency = Residency::Member;
                // The held-group oracle compares both branch verdicts. Absent
                // audiences also avoid data scratch on the server; native tests
                // separately cover a denied branch's data and logical probes.
                for bucket in [0, 1] {
                    let held = case.rows.iter().any(|(t, row)| t == "access" && row["bucket"] == json!(bucket) && row["principal"] == json!(case.principal));
                    if !held {
                        case.rows.push(("access".into(), json!({"id":format!("cut-held-{bucket}"),"bucket":bucket,"principal":case.principal})));
                    }
                }
            }
        }
    }
    if shape >= 2 {
        for (table, row) in &mut case.rows {
            if table == "items" {
                row["bucket"] = json!(rng.pick(2));
            }
        }
    }
}


const REFERENCES: u64 = 0x5245_4645_5245_4e43;
/// Referential actions (LLP 3000.039): a quarter of the cases gain `kids`
/// referencing `items` with a random action (with its cap), rows naming
/// present and absent items, sometimes `notes` restricting kids; half of
/// their single writes become `delete items[key]`. Its own stream, so no other
/// case changes.
// @ref LLP 3000.039#9 — the generators exercise every action, diamonds aside, through deletes of the parent.
fn references(case: &mut Case) {
    let mut rng = Rng::new(case.seed ^ REFERENCES);
    if rng.pick(4) != 0 { return; }
    let action = [None, Some("restrict"), Some("cascade"), Some("set null"), Some("keep")][rng.pick(5) as usize].map(str::to_owned);
    let owner_read = rng.pick(2) == 0;
    let kids = Kids {
        nullable: action.as_deref() == Some("set null") || rng.pick(3) == 0,
        action,
        owner_read,
        synced: rng.pick(3) != 0,
        notes: rng.pick(3) == 0,
    };
    let targets = ["r0", "r0", "r1", "missing", "r2"];
    let count = rng.pick(4) + 1;
    for i in 0..count {
        let owner = if rng.pick(2) == 0 { "alice" } else { "bob" };
        case.rows.push(("kids".into(), json!({"id": format!("k{i}"), "item": targets[rng.pick(targets.len() as u64) as usize], "owner": owner})));
    }
    if kids.notes {
        for i in 0..rng.pick(3) {
            case.rows.push(("notes".into(), json!({"id": format!("n{i}"), "kid": format!("k{}", rng.pick(count))})));
        }
    }
    if let Body::Write(kind, _) = &mut case.program.body && rng.pick(2) == 0 {
        *kind = Write::Delete;
        // Delete a row the kids name, when there is one.
        if case.rows.iter().any(|(t, row)| t == "items" && row["id"] == "r0") { case.args["key"] = json!("r0"); }
    }
    case.program.kids = Some(kids);
}
// @ref LLP 3000.007#20.24.1 — draw interrupted reference predicates in the meter and device oracles.
fn predicate_reads(case: &mut Case) {
    let mut rng = Rng::new(case.seed ^ 0x4355_5450_5245_4401);
    if !matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, .. }) || rng.pick(8) != 0 { return; }
    let p = &mut case.program;
    p.tables[0].columns.iter_mut().find(|c| c.name == "tag").unwrap().ty = Type::Reference("tags".into());
    p.residual = Some(".tag.rank = 1".into());
    // A reference makes a bucket disjunction non-total, keeping one globally
    // non-uniform server scan while a held partition is complete locally.
    // Draw the reference on a pinned group instead; ordinary online cases
    // still cover the non-total disjunction's planner fallback.
    if matches!(p.tables[0].residency, Residency::Group) { p.domain = None; }
    // Keep targets live, readable and held so default cases reach continuation,
    // rather than failing on a missing or unauthorized reference before the cut.
    let mut tags = tags_table(&mut rng);
    tags.rule = Rule::Allow; tags.residency = Residency::Public;
    p.tables.retain(|t| t.name != "tags"); p.tables.push(tags);
    case.rows.retain(|(t, _)| t != "tags");
    let targets: std::collections::BTreeSet<String> = case.rows.iter().filter(|(t, _)| t == "items")
        .filter_map(|(_, row)| row["tag"].as_str().map(str::to_owned)).collect();
    for (n, tag) in targets.into_iter().enumerate() {
        case.rows.push(("tags".into(), json!({"id":tag,"owner":"alice","name":format!("target{n}"),"rank":if rng.pick(4)==0 {-1} else {1}})));
    }
}

fn projection(rng: &mut Rng) -> Vec<Proj> {
    let mut fields = vec![];
    if rng.pick(2) == 0 {
        fields.push(Proj::Score);
    }
    match rng.pick(4) {
        0 => fields.push(Proj::NameLookup),
        1 => {
            fields.push(Proj::TagGet);
            fields.push(Proj::NameLookup);
        }
        _ => fields.push(Proj::TagGet),
    }
    fields
}

const LANG2_STREAM: u64 = 0x4c41_4e47_3230_3430;
/// Calendar inputs: the shared vectors (`snapback4-core` `calendar.rs`, the
/// Lean examples), the instants beside them, other century edges and the i53 ends.
pub const CALENDAR_TIMES: [i64; 20] = [
    0, -1, 1, -2_678_400_000, -2_678_400_001, 951_782_400_000, 951_868_799_999, 1_791_676_800_000,
    1_798_761_599_999, 1_798_761_600_000, -2_203_891_200_000, -2_203_891_200_001, 9_007_199_254_740_991,
    -9_007_199_254_740_991, 4_102_444_800_000, 946_684_800_000, -62_167_219_200_000, -62_167_219_200_001,
    253_402_300_800_000, 9_007_199_254_740_990,
];
const BOUNDS: [(Option<i64>, Option<i64>); 5] = [
    (Some(-1), Some(1)), (Some(0), None), (None, Some(7)), (Some(-9_007_199_254_740_990), Some(9_007_199_254_740_990)), (Some(1), Some(1)),
];
fn calendar_time(rng: &mut Rng) -> i64 {
    if rng.pick(3) == 0 {
        let span = 2 * 9_007_199_254_740_991u64 + 1;
        (rng.next() % span) as i64 - 9_007_199_254_740_991
    } else {
        CALENDAR_TIMES[rng.pick(CALENDAR_TIMES.len() as u64) as usize]
    }
}
fn calendar(rng: &mut Rng) -> Expr {
    let t = || Expr::Arg("t".into(), Type::Time);
    let cal = |f: Cal, e: Expr| Expr::Calendar(f, Box::new(e));
    let add = |a: Expr, b: Expr| Expr::Binary(Bin::Add, Box::new(a), Box::new(b));
    let small = |rng: &mut Rng| [Expr::Int(0), Expr::Int(1), Expr::Int(-1), Expr::Int(12), Expr::Arg("b".into(), Type::Int)][rng.pick(5) as usize].clone();
    match rng.pick(10) {
        0 => cal(Cal::Month, t()),
        1 => cal(Cal::Year, t()),
        2 => cal(Cal::Day, t()),
        3 => cal(Cal::Hour, t()),
        4 => {
            let period = [60_000, 7_200_000, 604_800_000][rng.pick(3) as usize];
            let offset = [0, 1, 1_800_000][rng.pick(3) as usize] % period;
            cal(Cal::Bucket(period, offset), t())
        }
        5 => cal(Cal::MonthStart, add(cal(Cal::Month, t()), small(rng))),
        6 => cal(Cal::YearStart, add(cal(Cal::Year, t()), small(rng))),
        7 => Expr::Binary(Bin::Lt, Box::new(t()), Box::new(cal(Cal::MonthStart, add(cal(Cal::Month, t()), Expr::Int(1))))),
        8 => Expr::Binary(Bin::Lt, Box::new(cal(Cal::YearStart, cal(Cal::Year, t()))), Box::new(add(t(), Expr::Int(1)))),
        _ => cal(if rng.pick(2) == 0 { Cal::MonthStart } else { Cal::YearStart }, Expr::Arg("a".into(), Type::Int)),
    }
}
fn lang2(case: &mut Case) {
    let mut rng = Rng::new(case.seed ^ LANG2_STREAM);
    let calendar_body = rng.pick(5) == 0;
    let bounded = rng.pick(6) == 0;
    let bounded_arg = rng.pick(6) == 0;
    let arg_bound = BOUNDS[rng.pick(BOUNDS.len() as u64) as usize];
    if bounded_arg {
        // `a` takes the generator's i53-edge values, so most calls refuse E_INPUT on every host.
        case.program.arg_bound = Some(arg_bound);
    }
    if calendar_body && matches!(case.program.body, Body::Scalar(_)) {
        case.program.body = Body::Scalar(calendar(&mut rng));
        case.program.time_arg = true;
        case.args["t"] = json!(calendar_time(&mut rng));
    }
    if bounded {
        let (min, max) = BOUNDS[rng.pick(BOUNDS.len() as u64) as usize];
        if let Some(c) = case.program.tables[0].columns.iter_mut().find(|c| c.name == "score") {
            c.ty = Type::IntRange(min, max);
        }
        for (table, row) in &mut case.rows {
            if table == "items" && let Some(score) = row["score"].as_i64() {
                row["score"] = json!(score.clamp(min.unwrap_or(i64::MIN), max.unwrap_or(i64::MAX)));
            }
        }
        // `check` refuses a constant outside the bound; keep the write and
        // move its refusal to run time, where the hosts are compared.
        fn hide(stmts: &mut [Stmt], min: Option<i64>, max: Option<i64>) {
            for s in stmts {
                match s {
                    Stmt::Write { value: value @ Expr::Int(_), .. } => {
                        let Expr::Int(n) = value else { unreachable!() };
                        if min.is_some_and(|m| *n < m) || max.is_some_and(|m| *n > m) {
                            let n = *n;
                            *value = Expr::Binary(Bin::Add, Box::new(Expr::Int(n)), Box::new(Expr::Binary(Bin::Mul, Box::new(Expr::Int(0)), Box::new(Expr::Arg("b".into(), Type::Int)))));
                        }
                    }
                    Stmt::If(_, a, b) => {
                        hide(a, min, max);
                        hide(b, min, max);
                    }
                    _ => {}
                }
            }
        }
        if let Body::Block(b) = &mut case.program.body {
            hide(&mut b.stmts, min, max);
        }
        for b in &mut case.program.prelude {
            hide(&mut b.stmts, min, max);
        }
    }
}
