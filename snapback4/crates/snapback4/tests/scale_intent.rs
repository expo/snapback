//! LLP 3000.013 cross-lane IR: projections, buckets, streaming and sweeps.
#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};
use snapback4_core::{Context, Engine, Value, wire};
use std::collections::BTreeMap;
use serde_json::json;

const SOURCE: &str = r#"
effect notify
table details:
  n: int
  public
  online only
table posts:
  owner: principal
  at: time
  rank: int
  detail: details
  immutable owner, at
  read <- .owner = viewer
  online only
table reposts:
  actor: principal
  at: time
  detail: details
  read <- .actor = viewer
  online only
view projected:
  posts { actor: .owner, at, detail: details[.detail] }
view activity:
  posts { actor: .owner, at, detail: details[.detail] }
  reposts { actor, at, detail: details[.detail] }
query projection(c: cursor ?):
  return projected where .actor = viewer first 2 by .at after c
query across(c: cursor ?):
  return activity where .actor = viewer first 2 by .at after c
query unpinned(c: cursor ?):
  return activity first 2 by .at after c
query bucketed(c: cursor ?):
  return posts where .owner = viewer and .at > now - 24h and .at <= now last 2 by .rank, .at after c
query total():
  return count(posts where .owner = viewer)
job sweep():
  for p in posts:
    emit notify { id: p.id } once [p.id]
mutation emitCount(): server
  emit notify { kind: 'count' } once [count(posts where .owner = viewer)]
"#;
fn bound() -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn cert(name: &str) -> scale::Certificate {
    let b = bound();
    analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == name).unwrap().program)
}
fn engine() -> Engine {
    let b = bound();
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = Vec::new();
    for n in 0..30 {
        let id = format!("p{n:03}");
        for (table, row) in [("details", json!({"id":id,"n":n})),
            ("posts", json!({"id":id,"owner":"alice","at":n*3_600_000,"rank":n%3,"detail":id})),
            ("reposts", json!({"id":id,"actor":if n%2 == 0 {"alice"} else {"bob"},"at":n*3_600_000,"detail":id}))] {
            rows.push((table.into(), wire::row_from_json(&engine.schema().tables[table], &row).unwrap()));
        }
    }
    engine.load(rows).unwrap();
    engine
}
fn query(name: &str) -> snapback4_core::engine::QueryOutcome {
    engine().query(name, Context::new("alice", if name == "total" { BTreeMap::new() } else { BTreeMap::from([("c".into(), Value::Null)]) }).at(29*3_600_000)).unwrap()
}
fn covered(c: &scale::Certificate, used: &snapback4_core::meter::Metered) {
    assert!(used.examined <= c.bounds.rows_examined, "{used:?} > {:?}", c.bounds);
    assert!(used.rule_probes <= c.bounds.probes, "{used:?} > {:?}", c.bounds);
}
#[test]
fn projected_lane_prices_candidate_projections_before_page_truncation() {
    let c = cert("projection");
    assert_eq!(c.class, Class::Constant);
    assert_eq!(c.bounds.lanes, Some(1));
    assert_eq!(c.bounds.rows_examined, 7); // Four fetched source rows, three point projections.
    let result = query("projection");
    assert_eq!(result.data.as_array().unwrap().len(), 2);
    assert_eq!(result.data.as_array().unwrap()[0].field("detail").unwrap().field("n").unwrap(), &Value::Int(0));
    covered(&c, &result.metered);
}
#[test]
fn cross_table_certificate_accounts_for_each_source_rule() {
    let c = cert("across");
    assert_eq!(c.class, Class::Constant);
    assert_eq!(c.bounds.lanes, Some(2));
    assert_eq!(c.bounds.rows_examined, 14);
    let result = query("across");
    assert!(result.data.as_array().unwrap().iter().all(|r| r.field("actor").unwrap() == &Value::Id("alice".into())));
    covered(&c, &result.metered);
    let unpinned = cert("unpinned");
    assert_eq!(unpinned.class, Class::Grows);
    assert!(unpinned.growth_sites.iter().any(|s| s.reason.contains("posts skipped by its per-row read rule")));
    assert!(unpinned.growth_sites.iter().any(|s| s.reason.contains("reposts skipped by its per-row read rule")));
    covered(&unpinned, &query("unpinned").metered);
}
#[test]
fn bucketed_rank_grows_only_with_edge_bucket_density() {
    let c = cert("bucketed");
    assert_eq!(c.class, Class::Grows);
    assert_eq!(c.bounds.lanes, Some(25));
    assert_eq!(c.growth_sites.len(), 1);
    assert!(c.growth_sites[0].reason.contains("two edge hours"), "{c:?}");
    assert!(c.growth_sites[0].reason.contains("25 lanes, page 2"));
    assert!(c.growth_sites[0].rewrite.is_empty());
    covered(&c, &query("bucketed").metered);
}
#[test]
fn streaming_total_is_population_work_even_without_page_retention() {
    let c = cert("total");
    assert_eq!(c.class, Class::Grows);
    assert!(c.growth_sites.iter().any(|s| s.reason.contains("domain")));
    let result = query("total");
    assert_eq!(result.data, Value::Int(30));
    covered(&c, &result.metered);
}
#[test]
fn automatic_sweep_is_bounded_per_chunk_and_grows_over_the_whole_job() {
    let c = cert("sweep");
    assert_eq!(c.class, Class::Constant);
    assert!(c.per_chunk);
    assert_eq!(c.bounds.rows_examined, 66); // Includes conservative admission and lookahead.
    assert_eq!(c.bounds.writes, 64);
    assert!(c.whole_job.iter().any(|s| s.contains("posts")));
    let job = engine().run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(job.state, snapback4_core::JobState::Done);
    assert!(job.rows_written <= c.bounds.writes);
}
#[test]
fn once_key_predicates_are_planned_and_counted() {
    let c = cert("emitCount");
    assert_eq!(c.class, Class::Grows);
    assert_eq!(c.bounds.writes, 1);
    let mut engine = engine();
    let outcome = engine.mutate("emitCount", None, Context::new("alice", BTreeMap::new())).unwrap();
    assert!(matches!(outcome.state, snapback4_core::WriteState::Sent { .. }), "{outcome:?}");
    covered(&c, &outcome.metered);
    assert_eq!(engine.effects(None, 10).unwrap().len(), 1);
}

#[test]
fn residual_membership_certificate_displays_the_predicate_not_its_initializer() {
    let source = "table memberships:\n  orgId: principal\n  principal: principal\n  unique orgId, principal\n  public 'memberships'\ntable tasks:\n  orgId: principal\n  assignee: principal\n  status: enum('todo', 'doing', 'done')\n  createdAt: time\n  read <- .assignee = viewer\n  sync to .assignee\nquery page(c: cursor ?):\n  return tasks where .assignee = viewer and exists memberships[.orgId, viewer] and .status in ['todo', 'doing'] first 50 by .createdAt after c\n";
    for (before, after, expected) in [
        (".status in ['todo', 'doing']", ".status in ['todo', 'doing']", ".status in ['todo', 'doing']"),
        (".status in ['todo', 'doing']", ".status in states", ".status in states"),
    ] {
        let source = source.replace(before, after).replace("page(c:", "page(states: [text <=10] <=3, c:");
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let program = &b.programs[0].program;
        let c = analyze(&b.schema, program);
        let text = c.line();
        assert!(text.contains(expected), "{text}");
        assert!(!text.contains("skipped by `false`") && !text.contains("$contains"), "{text}");
        assert_eq!(c.class, Class::Grows, "the residual still contributes work");
    }
    // When the only predicate is extracted into pins/lanes, there is no
    // residual clause to print. The certificate must remain constant.
    let source = source.replace(" and exists memberships[.orgId, viewer]", "");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert_eq!(c.class, Class::Constant);
    assert!(!c.line().contains("skipped by"), "{}", c.line());
}
