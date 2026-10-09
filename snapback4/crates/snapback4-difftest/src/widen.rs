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
//! - **secondary unique clashes** (OPEN W4): block writes put `tag0`/`tag1`,
//!   which seeded rows hold, into the unique `byTag`.
// @ref LLP 3000.035#5.1 — generator widening behind independent probabilities.
use crate::{
    ast::*,
    generate::{Case, Rng, Step, TEXTS, VALUES},
};
use serde_json::{Value as Json, json};

const STREAM: u64 = 0x5749_4445_4e5f_4757;
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
        rule,
        residency,
        effects: None,
        expire: None,
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
    let expire = rng.pick(6) == 0;
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
        if expire {
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
    case
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
