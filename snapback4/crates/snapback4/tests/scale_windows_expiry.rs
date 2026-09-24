//! The certificate distinguishes window density and unswept expiry from history.
#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};
use snapback4_core::{Context, Engine, Value, wire};
use serde_json::json;
use std::collections::BTreeMap;

const HOUR: i64 = 3_600_000;
const NOW: i64 = 25 * HOUR + HOUR / 2;
const SOURCE: &str = r#"
table posts:
  at: time
  likeCount: int
  removed: bool
  public
  online only
query trending(c: cursor ?):
  return posts where .at > now - 24h and .at <= now last 10 by .likeCount, .at after c
query daily(c: cursor ?):
  return posts where .at >= now - 7d and .at < now last 10 by .likeCount, .at after c
query subhour(c: cursor ?):
  return posts where .at > now - 15m and .at <= now last 10 by .likeCount, .at after c
query residual(c: cursor ?):
  return posts where .likeCount != 7 and .at > now - 24h and .at <= now last 10 by .likeCount, .at after c
query unbounded(c: cursor ?):
  return posts where .at > now - 24h last 10 by .likeCount, .at after c
table messages:
  expiresAt: time ?
  expire at .expiresAt
  public
  online only
query messagesPage(c: cursor ?):
  return messages first 50 by .id after c
"#;

fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

fn certificate(b: &snapback4_lang::Bound, name: &str) -> scale::Certificate {
    analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == name).unwrap().program)
}

fn engine(b: snapback4_lang::Bound) -> Engine {
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}

fn query(engine: &mut Engine, name: &str) -> snapback4_core::engine::QueryOutcome {
    engine.query(name, Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])).at(NOW)).unwrap()
}

fn covered(c: &scale::Certificate, result: &snapback4_core::engine::QueryOutcome) {
    assert!(result.metered.examined <= c.bounds.rows_examined, "{result:?} > {c:?}");
    assert!(result.metered.rule_probes <= c.bounds.probes);
}

#[test]
fn window_explanation_requires_exact_time_filters_and_matching_calendar_key() {
    let mut b = compile(SOURCE);
    for (name, lanes, edges) in [("trending", 25, "hours"), ("daily", 8, "days"), ("subhour", 2, "hours")] {
        let c = certificate(&b, name);
        assert_eq!(c.class, Class::Grows);
        assert_eq!(c.bounds.lanes, Some(lanes));
        assert_eq!(c.growth_sites.len(), 1);
        assert!(c.line().contains(&format!("two edge {edges}")), "{c:?}");
        assert!(c.line().contains(&format!("at most {lanes} lanes, page 10")));
        assert!(c.growth_sites[0].rewrite.is_empty());
    }
    for name in ["residual", "unbounded"] {
        let c = certificate(&b, name);
        assert!(!c.line().contains("two edge"), "{c:?}");
        assert!(!c.growth_sites[0].rewrite.is_empty());
    }
    // A calendar key with a different origin cannot prove these UTC bounds.
    for index in b.schema.tables.get_mut("posts").unwrap().indexes.values_mut() {
        for component in &mut index.components {
            if let snapback4_core::schema::IndexComponent::Calendar(key) = component { key.offset = 1; }
        }
    }
    assert!(!certificate(&b, "trending").line().contains("two edge"));
}

#[test]
fn window_on_another_time_column_keeps_generic_growth_and_rewrite() {
    let source = r#"
table posts:
  createdAt: time
  publishedAt: time
  likeCount: int
  by byCreatedHour: hour(createdAt), likeCount, publishedAt, id
  public
  online only
query window(c: cursor ?):
  return merge posts after c last 10 by byCreatedHour where .publishedAt > now - 24h and .publishedAt <= now:
    [h] for h in range(hour(now - 24h), hour(now) + 1)
"#;
    // Matching endpoints and lane bounds are insufficient: publication-time
    // rejects can occur in every creation-time bucket, including interior ones.
    let b = compile(source);
    let c = certificate(&b, "window");
    assert_eq!(c.class, Class::Grows);
    assert_eq!(c.bounds.lanes, Some(25));
    assert_eq!(c.growth_sites.len(), 1);
    assert!(c.growth_sites[0].reason.starts_with("posts skipped by `"), "{c:?}");
    assert!(c.growth_sites[0].reason.contains(".publishedAt"), "{c:?}");
    assert_eq!(c.growth_sites[0].rewrite,
        "pin the filter column in the read, or add a view indexed by that predicate");
    assert!(!c.line().contains("two edge"), "{c:?}");

    // Change only the filtered column; this otherwise identical plan proves
    // the recognized edge-bucket case and isolates the column-identity check.
    let matching = compile(&source.replace(".publishedAt", ".createdAt"));
    let matching = certificate(&matching, "window");
    assert!(matching.line().contains("two edge hours"), "{matching:?}");
    assert!(matching.growth_sites[0].rewrite.is_empty());
    assert_eq!(c.bounds.rows_examined, matching.bounds.rows_examined);
}

#[test]
fn window_explanation_does_not_hide_nonuniform_authorization() {
    let source = SOURCE.replacen("  public", "  read <- .removed = false", 1);
    let b = compile(&source);
    let c = certificate(&b, "trending");
    // A keeps the ordinary scan when inferred lane prefixes cannot decide
    // authorization. It must retain both the residual and read-rule warning.
    assert!(!c.line().contains("two edge hours"), "{c:?}");
    assert!(c.line().contains("posts skipped by `"), "{c:?}");
    assert!(c.line().contains("per-row read rule"));
    assert_eq!(c.growth_sites.len(), 2);

    // An authored calendar merge still proves edge-only time filtering; its
    // separate read rule can reject rows in every bucket and must stay visible.
    let source = source.replacen("  removed: bool", "  removed: bool\n  by byHour: hour(at), likeCount, at, id", 1)
        .replacen("return posts where .at > now - 24h and .at <= now last 10 by .likeCount, .at after c",
            "return merge posts after c last 10 by byHour where .at > now - 24h and .at <= now:\n    [h] for h in range(hour(now - 24h), hour(now) + 1)", 1);
    let b = compile(&source);
    let c = certificate(&b, "trending");
    assert!(c.line().contains("two edge hours"), "{c:?}");
    assert!(c.line().contains("per-row read rule"), "{c:?}");
    assert_eq!(c.growth_sites.len(), 2);
}

fn seed_posts(engine: &mut Engine, prefix: &str, count: usize, at: i64, rank: i64) {
    let table = &engine.schema().tables["posts"];
    let rows: Vec<(String, Value)> = (0..count).map(|n| ("posts".into(), wire::row_from_json(table,
        &json!({"id":format!("{prefix}{n:05}"),"at":at,"likeCount":rank,"removed":false})).unwrap())).collect();
    engine.load(rows).unwrap();
}

#[test]
fn history_does_not_increase_window_work_but_edge_density_does() {
    let b = compile(SOURCE);
    let c = certificate(&b, "trending");
    let mut engine = engine(b);
    seed_posts(&mut engine, "inside", 30, 10 * HOUR, 1);
    let initial = query(&mut engine, "trending");
    seed_posts(&mut engine, "history", 500, -100 * HOUR, 100);
    seed_posts(&mut engine, "future", 500, 100 * HOUR, 100);
    let history = query(&mut engine, "trending");
    assert_eq!(initial.data, history.data);
    assert_eq!(initial.metered.examined, history.metered.examined);
    seed_posts(&mut engine, "old-edge", 100, HOUR + 1, 100);
    seed_posts(&mut engine, "new-edge", 100, NOW + 1, 100);
    let dense = query(&mut engine, "trending");
    assert_eq!(dense.data, initial.data);
    assert!(dense.complete);
    assert!(dense.metered.examined > history.metered.examined);
    for result in [&initial, &history, &dense] { covered(&c, result); }
    println!("window examined: initial={}, with history={}, dense edges={}", initial.metered.examined, history.metered.examined, dense.metered.examined);
    seed_posts(&mut engine, "cut-edge", 8_200, HOUR + 1, 100);
    let cut = query(&mut engine, "trending");
    assert!(!cut.complete);
    covered(&c, &cut);
}

#[test]
fn expiry_backlog_can_outlive_one_tick_and_remains_meter_bounded() {
    let b = compile(SOURCE);
    let c = certificate(&b, "messagesPage");
    assert_eq!(c.class, Class::Grows);
    assert!(c.line().contains("not yet swept"));
    assert!(c.line().contains("1-second tick, at most 2,000 rows per pass"));
    assert!(c.line().contains("can leave older rows"));
    assert!(c.growth_sites[0].rewrite.is_empty());
    let mut engine = engine(b);
    let rows: Vec<(String, Value)> = (0..2_001).map(|n| ("messages".into(), wire::row_from_json(&engine.schema().tables["messages"],
        &json!({"id":format!("m{n:05}"),"expiresAt":0})).unwrap())).collect();
    engine.load(rows).unwrap();
    let before = query(&mut engine, "messagesPage");
    assert!(before.data.as_array().unwrap().is_empty());
    assert_eq!(engine.sweep_expired(NOW, 2_000).unwrap(), 2_000);
    let after = query(&mut engine, "messagesPage");
    assert!(after.data.as_array().unwrap().is_empty());
    assert!(after.metered.examined > 0, "an old expired row remains after this pass");
    assert!(after.metered.examined < before.metered.examined);
    for result in [&before, &after] { covered(&c, result); }
    assert_eq!(engine.sweep_expired(NOW + 1_000, 2_000).unwrap(), 1);
    println!("expiry examined: before={}, after first sweep={}", before.metered.examined, after.metered.examined);
}

#[test]
fn cost_text_and_json_keep_window_and_expiry_growth_without_empty_rewrites() {
    let dir = std::env::temp_dir().join(format!("sb4-window-cost-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("snapback")).unwrap();
    std::fs::write(dir.join("snapback/schema.q"), SOURCE).unwrap();
    let run = |args: &[&str]| {
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    let text = run(&["check", "--cost"]);
    for (name, phrase) in [("trending", "two edge hours"), ("messagesPage", "not yet swept")] {
        let section = text.split(&format!("  query {name}:\n")).nth(1).unwrap().split("  query ").next().unwrap();
        assert!(section.contains(phrase), "{section}");
        assert!(!section.contains("; rewrite:"), "{section}");
    }
    let json: serde_json::Value = serde_json::from_str(&run(&["check", "--cost", "--json"])).unwrap();
    for name in ["trending", "messagesPage"] {
        let c = json["scale"].as_array().unwrap().iter().find(|c| c["operation"] == name).unwrap();
        assert_eq!(c["class"], "grows");
        assert_eq!(c["growth_sites"][0]["rewrite"], "");
        assert!(c["bounds"]["rows_examined"].as_u64().unwrap() >= 8_193);
    }
    std::fs::remove_dir_all(dir).unwrap();
}
