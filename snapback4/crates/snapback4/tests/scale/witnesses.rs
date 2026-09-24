//! Engine witnesses for LLP 3000.013 scale-certificate review findings.
use super::*;
use scale::Certificate;
use snapback4_core::{Metered, WriteState};

fn certificate(b: &Bound, name: &str) -> Certificate {
    analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == name).unwrap().program)
}
fn engine(b: Bound) -> Engine {
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn row(id: &str, fields: &[(&str, Value)]) -> Value {
    let mut fields: BTreeMap<_, _> = fields.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
    fields.insert("id".into(), Value::Id(id.into()));
    Value::Row(fields.into())
}
fn covers(c: &Certificate, used: Metered) {
    assert!(used.examined <= c.bounds.rows_examined, "{}: {used:?} exceeds {:?}", c.operation, c.bounds);
    assert!(used.rule_probes <= c.bounds.probes, "{}: {used:?} exceeds {:?}", c.operation, c.bounds);
    assert!(used.rows_written <= c.bounds.writes, "{}: {used:?} exceeds {:?}", c.operation, c.bounds);
}

const AUTHORIZED: &str = r#"
table grants:
  principal: principal
  unique byPrincipal: principal
  public
  online only
table posts:
  author: principal
  by byAuthor: author, id
  read <- exists grants[.author]
  online only
query feed(people: [principal] <=9):
  return merge posts first 20 by byAuthor:
    [p] for p in people
"#;

#[test]
fn authorized_merge_covers_openings_refills_and_overlapping_lanes() {
    let b = bound(AUTHORIZED);
    let query = certificate(&b, "feed");
    assert_eq!(query.class, Class::Constant);
    let mut e = engine(b);
    for author in 0..9 {
        let principal = Value::Id(format!("author{author}"));
        e.seed([("grants".into(), row(&format!("g{author}"), &[("principal", principal.clone())]))]).unwrap();
        e.seed((0..100).map(|i| ("posts".into(), row(&format!("p{i:03}-{author}"), &[("author", principal.clone())])))).unwrap();
    }
    // <=8 lanes batch a page; >8 use one-row lazy refills. Overlapping
    // lanes repeat both lookahead and authorization even for duplicate pops.
    for count in [1, 8, 9] {
        for overlap in [false, true] {
            let people = Value::Array((0..count).map(|i| Value::Id(format!("author{}", if overlap { 0 } else { i }))).collect());
            let context = || Context::new("viewer", BTreeMap::from([("people".into(), people.clone())]));
            let read = e.query("feed", context()).unwrap();
            assert!(read.capped_at.is_none(), "{read:?}");
            assert_eq!(read.data.as_array().unwrap().len(), 20);
            assert!(read.metered.rule_probes > 0);
            if count == 9 {
                assert_eq!(read.metered.rule_probes, if overlap { 189 } else { 29 });
                assert_eq!(read.metered.examined, if overlap { 378 } else { 58 });
            }
            covers(&query, read.metered);
        }
    }
}

#[test]
fn walk_includes_seed_authorization_and_nested_reads() {
    let b = bound(r#"
table grants:
  principal: principal
  unique byPrincipal: principal
  public
  online only
table nodes:
  owner: principal
  parent: nodes ?
  read <- exists grants[.owner]
  online only
query ancestors(id: nodes):
  return walk nodes[id] up .parent depth 1
query nested(id: nodes):
  chain = walk nodes[id] up .parent depth 1
  return chain { *, grant: grants[.owner] }
"#);
    let certs = [certificate(&b, "ancestors"), certificate(&b, "nested")];
    let mut e = engine(b);
    e.seed([
        ("grants".into(), row("grant", &[("principal", Value::Id("alice".into()))])),
        ("nodes".into(), row("root", &[("owner", Value::Id("alice".into())), ("parent", Value::Null)])),
        ("nodes".into(), row("child", &[("owner", Value::Id("alice".into())), ("parent", Value::Id("root".into()))])),
    ]).unwrap();
    for (c, examined) in certs.iter().zip([2, 4]) {
        let read = e.query(&c.operation, Context::new("alice", BTreeMap::from([("id".into(), Value::Id("child".into()))]))).unwrap();
        assert!(read.complete);
        assert_eq!(read.data.as_array().unwrap().len(), 2);
        assert_eq!(read.metered.examined, examined);
        assert_eq!(read.metered.rule_probes, 2);
        assert_eq!(c.class, Class::Constant);
        covers(c, read.metered);
    }
}

#[test]
fn mutation_scan_includes_admission_before_traversal() {
    let b = bound(r#"
table posts:
  public
  online only
mutation page():
  return posts first 20 by byId
query queryPage():
  return posts first 20 by byId
job sweep():
  chunk p in posts first 4 by byId:
    return p
"#);
    let c = certificate(&b, "page");
    let query = certificate(&b, "queryPage");
    let job = certificate(&b, "sweep");
    assert!(job.per_chunk);
    assert_eq!(job.bounds.rows_examined, 6);
    assert_eq!(c.bounds.rows_examined, 22);
    assert_eq!(query.bounds.rows_examined, 21); // Capping queries have no admission charge.
    let mut e = engine(b);
    e.seed((0..100).map(|i| ("posts".into(), row(&format!("p{i}"), &[])))).unwrap();
    let write = e.mutate("page", None, Context::new("alice", BTreeMap::new())).unwrap();
    assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
    assert_eq!(write.metered.examined, 22);
    assert_eq!(c.class, Class::Constant);
    covers(&c, write.metered);
    let read = e.query("queryPage", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(read.metered.examined, 21);
    covers(&query, read.metered);
}

#[test]
fn repeated_mutation_scans_cover_admission_near_and_across_the_ceiling() {
    let b = bound(r#"
table posts:
  public
  online only
mutation nearLimit():
  for i in range(0, 2730):
    page = posts first 1 by byId
  return 1
mutation many():
  for i in range(0, 4000):
    page = posts first 1 by byId
  return 1
query queryMany():
  for i in range(0, 4000):
    page = posts first 1 by byId
  return 1
"#);
    let near = certificate(&b, "nearLimit");
    let many = certificate(&b, "many");
    let query = certificate(&b, "queryMany");
    for c in [&near, &many, &query] { assert_eq!(c.class, Class::Constant); }
    // Each first-1 mutation scan pays admission + row + lookahead. The
    // near-limit case completes two rows below the default ceiling; the
    // reviewer's 4,000-iteration case now certifies 12,000, not 8,000.
    assert_eq!(near.bounds.rows_examined, 8190);
    assert_eq!(many.bounds.rows_examined, 12000);
    assert_eq!(query.bounds.rows_examined, 8000);
    let mut e = engine(b);
    e.seed((0..100).map(|i| ("posts".into(), row(&format!("p{i}"), &[])))).unwrap();
    let write = e.mutate("nearLimit", None, Context::new("alice", BTreeMap::new())).unwrap();
    assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
    assert_eq!(write.metered.examined, 8190);
    covers(&near, write.metered);
    let write = e.mutate("many", None, Context::new("alice", BTreeMap::new())).unwrap();
    assert!(matches!(&write.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"), "{write:?}");
    assert_eq!(write.metered.examined, 8193); // The failing charge is recorded.
    covers(&many, write.metered);
    let read = e.query("queryMany", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(read.capped_at.is_none(), "{read:?}");
    assert_eq!(read.data, Value::Int(1));
    assert_eq!(read.metered.examined, 8000);
    covers(&query, read.metered);
}

#[test]
fn non_expiring_public_word_search_grows_with_matching_words() {
    let b = bound(r#"
table notes:
  body: text <=200
  by byWords: words(body), id
  public
  online only
query search(q: text <=100, c: cursor ?):
  return notes matching q after c first 20 by byWords
query page(c: cursor ?):
  return notes after c first 20 by byId
"#);
    assert!(b.notes.is_empty(), "{:?}", b.notes);
    // Public, non-expiring rows isolate word expansion: no other growth
    // reason can preserve this verdict when the WordPrefix arm is removed.
    pin(&b, &["page"], &["search"]);
    let search = certificate(&b, "search");
    assert_eq!(search.growth_sites.len(), 1);
    assert_eq!(search.growth_sites[0].reason,
        "matching words and candidate notes rows (additional search terms filter)");
    assert_eq!(search.bounds.lanes, None);
    assert_eq!(certificate(&b, "page").bounds.rows_examined, 21);
    let mut e = engine(b);
    e.seed(["coffee", "coffers", "tea"].into_iter().map(|body|
        ("notes".into(), row(body, &[("body", Value::String(body.into()))])))).unwrap();
    let read = e.query("search", Context::new("alice", BTreeMap::from([
        ("q".into(), Value::String("cof".into())), ("c".into(), Value::Null),
    ]))).unwrap();
    assert!(read.complete, "{read:?}");
    assert_eq!(read.data.as_array().unwrap().len(), 2);
    covers(&search, read.metered);
}

#[test]
fn loop_carried_population_dependency_reaches_a_fixed_point_without_repricing() {
    let b = bound(r#"
table posts:
  author: principal
  public
  online only
maintain population: count posts by author
  read <- allow
  online only
query carried():
  p = population[viewer]
  x = 0
  y = 0
  for i in range(0, 2):
    x = y
    y = p
  n = 0
  for i in range(0, x):
    n = n + 1
  return n
query bounded():
  x = 0
  y = 0
  for i in range(0, 2):
    x = y
    y = population[viewer]
  return x
"#);
    let c = certificate(&b, "carried");
    let bounded = certificate(&b, "bounded");
    let mut e = engine(b);
    let mut steps = Vec::new();
    for (start, population) in [(0, 10), (10, 100)] {
        e.seed((start..population).map(|i| ("posts".into(), row(&format!("p{i}"), &[("author", Value::Id("alice".into()))])))).unwrap();
        let read = e.query("carried", Context::new("alice", BTreeMap::new())).unwrap();
        assert!(read.complete);
        assert_eq!(read.data, Value::Int(population));
        covers(&c, read.metered);
        steps.push(read.metered.steps);
        let read = e.query("bounded", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(read.metered.examined, 2);
        covers(&bounded, read.metered);
    }
    assert_eq!(steps, [84, 534]);
    // The maintained count is a constant-cost point; a later range using
    // its value through a loop-carried assignment grows with population.
    assert_eq!(c.class, Class::Grows);
    assert!(c.growth_sites.iter().any(|g| g.reason.contains("iterations of range(") && g.reason.ends_with("from stored data")), "{c:?}");
    assert_eq!(bounded.class, Class::Constant);
    assert_eq!(bounded.bounds.rows_examined, 2); // Dependency passes add no read costs.
}

#[test]
fn certificate_includes_the_charge_that_crosses_a_meter_ceiling() {
    let b = bound(r#"
table grants:
  key: text <=20
  unique byKey: key
  public
  online only
table posts:
  read <- exists grants['grant']
  online only
query probes():
  for i in range(0, 8193):
    p = posts['p0']
  return 1
mutation page():
  return grants first 8192 by byId
query population():
  n = 0
  for g in grants[] by byId:
    n = n + 1
  return n
"#);
    let probes = certificate(&b, "probes");
    let page = certificate(&b, "page");
    let population = certificate(&b, "population");
    let mut e = engine(b);
    e.seed([("grants".into(), row("grant", &[("key", Value::String("grant".into()))])), ("posts".into(), row("p0", &[]))]).unwrap();
    e.seed((0..8300).map(|i| ("grants".into(), row(&format!("g{i}"), &[("key", Value::String(format!("g{i}")))])))).unwrap();
    let read = e.query("probes", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(read.metered.rule_probes, 8193);
    covers(&probes, read.metered);
    let write = e.mutate("page", None, Context::new("alice", BTreeMap::new())).unwrap();
    assert!(matches!(write.state, WriteState::Failed { .. }), "{write:?}");
    assert_eq!(write.metered.examined, 8193);
    covers(&page, write.metered);
    let read = e.query("population", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(read.metered.examined, 8193);
    covers(&population, read.metered);
}

#[test]
fn write_certificate_includes_the_refused_1025th_insert() {
    let b = bound(r#"
table posts:
  number: int
  public
  insert <- allow
  online only
mutation many():
  for i in range(0, 1025):
    insert posts { number: i }
  return 1
query remaining():
  return posts first 1 by byId
"#);
    let c = certificate(&b, "many");
    assert_eq!(c.class, Class::Constant);
    assert_eq!(c.bounds.meters.rows_written, 1024);
    let mut e = engine(b);
    let write = e.mutate("many", None, Context::new("alice", BTreeMap::new())).unwrap();
    assert!(matches!(&write.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"), "{write:?}");
    // Refusal records the charge before aborting. The certificate must
    // cover that 1,025th write, not only the admitted 1,024-write ceiling.
    assert_eq!(write.metered.rows_written, 1025);
    covers(&c, write.metered);
    let read = e.query("remaining", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(read.data.as_array().unwrap().is_empty(), "the refused mutation must roll back");
}
