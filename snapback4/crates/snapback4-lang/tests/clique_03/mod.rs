use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::Bound;
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;
mod lifecycle;
mod measure;
mod model;
mod replay;
use model::Model;
pub const APP: &str = include_str!("../../../../examples/clique-03/snapback/schema.q");
pub const BASE_TIME: i64 = 1_767_225_600_000;
pub fn bound(source: &str) -> Bound {
    let b = snapback4_lang::compile(&[("clique-03/schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
pub fn engine(source: &str) -> Engine {
    let b = bound(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
pub fn id(s: &str) -> Value {
    Value::Id(s.into())
}
pub fn text(s: &str) -> Value {
    Value::String(s.into())
}
pub fn ctx(who: &str, args: &[(&str, Value)], at: i64) -> Context {
    Context::new(
        who,
        args.iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
    .at(at)
}
pub fn sent(e: &mut Engine, op: &str, who: &str, args: &[(&str, Value)], at: i64, key: &str) {
    let out = e
        .mutate(
            op,
            Some(key),
            ctx(who, args, at).with_ids([key.to_owned(), format!("{key}-event")]),
        )
        .unwrap();
    assert!(
        matches!(out.state, WriteState::Sent { .. }),
        "{op} {who} {key}: {out:?}"
    );
}
fn without(source: &str, prefix: &str) -> String {
    let begin = source.find(prefix).unwrap();
    let mut end = begin + source[begin..].find("\n").unwrap() + 1;
    for line in source[end..].split_inclusive('\n') {
        if !line.trim().is_empty() && !line.starts_with(char::is_whitespace) {
            break;
        }
        end += line.len();
    }
    format!("{}{}", &source[..begin], &source[end..])
}
fn prior() -> String {
    // Remove both reply paths so adoption really captures post attribution on replies.
    let s = APP
        .replace("  likeCount: count likes by postId\n", "")
        .replace("  by byHourLikes: hour(at), likeCount, at, id\n", "");
    let s = without(&s, "maintain receivedReplies:");
    let s = without(&s, "maintain dailyReceivedReplies:");
    let s = without(&s, "query insights(");
    without(&s, "query trending(")
}
fn pages(e: &mut Engine, op: &str, who: &str, args: &[(&str, Value)], at: i64) -> Vec<Value> {
    let mut rows = Vec::new();
    let mut cursor = Value::Null;
    let mut seen = BTreeSet::new();
    loop {
        let mut args = args.to_vec();
        args.push(("c", cursor));
        let p = e.query(op, ctx(who, &args, at)).unwrap();
        assert!(p.complete && p.cut.is_none(), "{op} {who}: {p:?}");
        rows.extend(p.data.as_array().unwrap().iter().cloned());
        match p.next {
            Some(c) => {
                assert!(seen.insert(c.clone()), "cursor repeated");
                cursor = text(&c);
            }
            None => break,
        }
        assert!(seen.len() < 5000, "unbounded paging");
    }
    rows
}
fn field<'a>(r: &'a Value, name: &str) -> &'a str {
    r.field(name).unwrap().as_str().unwrap()
}
pub fn run_fixture(full: bool) {
    let start = Instant::now();
    let mut e = engine(&prior());
    let mut m = Model::default();
    let stats = replay::seed(&mut e, &mut m, full);
    println!(
        "CLIQUE_SEED {}",
        json!({"full":full,"elapsed_s":start.elapsed().as_secs_f64(),"replay":stats})
    );
    m.check_following(&mut e);
    let (device, path) = lifecycle::adopt(&mut e, &m);
    m.check(&mut e);
    measure::reads(&mut e, &m);
    lifecycle::pending_restart(&mut e, &mut m, device, path);
    lifecycle::removals(&mut e, &mut m);
    m.check(&mut e);
    measure::amplification();
    println!(
        "CLIQUE_OK {}",
        json!({"full":full,"elapsed_s":start.elapsed().as_secs_f64(),"posts":m.posts.len(),"replies":m.replies.len(),"likes":m.likes.len(),"edges":m.edges.len()})
    );
}
