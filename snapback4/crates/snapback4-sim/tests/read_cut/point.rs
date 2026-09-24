use snapback4_core::{Ceilings, Context, QueryOutcome, Value, engine::ReadCut, value::object};

pub const SOURCE: &str = r#"table permits:
  public 'probe fixture'
  sync public
table records:
  permit: permits
  read <- exists permits[.permit] and exists permits[.permit]
  online only
query point(count: int, key: records):
  for i in range(0, count):
    prior = records['visible']
  return records[id = key]
"#;

pub fn rows() -> Vec<(String, Value)> {
    vec![("permits".into(), object([("id", Value::Id("yes".into()))])),
        ("records".into(), object([("id", Value::Id("visible".into())), ("permit", Value::Id("yes".into()))])),
        ("records".into(), object([("id", Value::Id("hidden".into())), ("permit", Value::Id("no".into()))]))]
}

pub fn context(count: i64, key: &str) -> Context {
    Context::new("dev:reader", [("count".into(), Value::Int(count)), ("key".into(), Value::Id(key.into()))].into()).at(300)
}

pub fn wire(page: &QueryOutcome) -> serde_json::Value {
    serde_json::json!({"data":snapback4_core::wire::to_json(&page.data), "complete":page.complete, "cut":page.cut,
        "next":page.next, "seq":page.seq, "tables":page.tables, "nextExpiry":page.next_expiry, "viewer":"dev:reader"})
}

pub fn check(host: &str, mut query: impl FnMut(i64, &str, Ceilings) -> QueryOutcome) {
    let cut = query(4096, "visible", Ceilings::default());
    assert!(!cut.complete && cut.data == Value::Null && cut.next.is_none(), "{host}: {cut:?}");
    assert_eq!(cut.cut, Some(ReadCut::Meter), "{host}: exhausted authorization has no verdict");
    assert_eq!(cut.metered.rule_probes, 8194);
    println!("W8R1a point host={host} prior_reads=4096 examined={} probes={} complete={} cut={:?}", cut.metered.examined, cut.metered.rule_probes, cut.complete, cut.cut);
    let visible = query(4095, "visible", Ceilings::default());
    assert_eq!(visible.data.field("id").unwrap(), &Value::Id("visible".into()));
    assert_eq!(visible.cut, None);
    if host == "server" { assert!(visible.complete); }
    assert_eq!(visible.metered.rule_probes, 8192);
    let mut pairs = 0;
    for count in [0, 1, 2] {
        for examined in 0..=4 {
            for rule_probes in 0..=8 {
                let ceilings = Ceilings { examined, rule_probes, ..Default::default() };
                let absent = query(count, "absent", ceilings);
                let hidden = query(count, "hidden", ceilings);
                assert_eq!(wire(&absent), wire(&hidden), "{host} count={count} examined={examined} probes={rule_probes}");
                assert_eq!(absent.metered, hidden.metered, "static allowance includes short-circuit probes");
                pairs += 1;
            }
        }
    }
    println!("W8R1a point host={host} identical_pairs={pairs} positive_controls=1");
}
