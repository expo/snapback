use snapback2_core::*;
use std::collections::BTreeMap;

fn project(value: BTreeMap<String, ArgType>, ttl_ms: u32) -> ProjectJson {
    ProjectJson {
        version: 1,
        schema: Schema {
            channels: BTreeMap::from([(
                "typing".into(),
                Channel {
                    args: BTreeMap::new(),
                    value,
                    publish: RuleExpr::Allow,
                    subscribe: RuleExpr::Allow,
                    ttl_ms,
                },
            )]),
            ..Schema::default()
        },
        programs: vec![],
        effects: vec![],
        auth: Auth::default(),
    }
}
#[test]
fn channel_generation_requires_a_bounded_typed_value_and_integer_seconds() {
    let good = BTreeMap::from([("typing".into(), ArgType::Bool)]);
    for ttl in [0, 999, 1001, 30_001, u32::MAX] {
        let p = project(good.clone(), ttl);
        assert!(Generation::certify(&p, Ceilings::default()).is_err());
        assert!(validate_schema(&p.schema).is_err());
    }
    assert!(Generation::certify(&project(BTreeMap::new(), 1000), Ceilings::default()).is_err());
    for kind in [
        ArgType::Cursor,
        ArgType::Bytes { max: 1 },
        ArgType::Image { max: 100 },
        ArgType::Video { max: 100 },
        ArgType::Optional(Box::new(ArgType::Cursor)),
        ArgType::List {
            of: Some(Box::new(ArgType::Bytes { max: 1 })),
            max: 2,
        },
        ArgType::Text {
            max: 1,
            min: 2,
            format: None,
        },
        ArgType::Text {
            max: 0,
            min: 0,
            format: None,
        },
        ArgType::List { of: None, max: 2 },
        ArgType::Enum { variants: vec![] },
        ArgType::Enum {
            variants: vec!["x".into(), "x".into()],
        },
        ArgType::Ref {
            table: "missing".into(),
        },
        ArgType::Decimal { scale: 13 },
        ArgType::Money {
            currency: "invalid".into(),
            scale: 2,
        },
    ] {
        let p = project(BTreeMap::from([("bad".into(), kind)]), 1000);
        assert!(
            Generation::certify(&p, Ceilings::default()).is_err(),
            "{:?}",
            p.schema.channels
        );
        assert!(validate_schema(&p.schema).is_err());
    }
    for ttl in [1000, 30_000] {
        Generation::certify(&project(good.clone(), ttl), Ceilings::default()).unwrap();
    }
}
#[test]
fn channel_value_reuses_durable_validation_and_normalizes_optional_fields() {
    let generation = Generation::certify(
        &project(
            BTreeMap::from([
                ("typing".into(), ArgType::Bool),
                (
                    "label".into(),
                    ArgType::Optional(Box::new(ArgType::Text {
                        max: 4,
                        min: 0,
                        format: None,
                    })),
                ),
                (
                    "users".into(),
                    ArgType::List {
                        of: Some(Box::new(ArgType::Principal)),
                        max: 2,
                    },
                ),
            ]),
            1000,
        ),
        Ceilings::default(),
    )
    .unwrap();
    let runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let good = BTreeMap::from([
        ("typing".into(), Value::Bool(true)),
        (
            "users".into(),
            Value::Array(vec![Value::Id("dev:alice".into())]),
        ),
    ]);
    let normalized = runtime.channel_value("typing", good.clone()).unwrap();
    assert_eq!(normalized["label"], Value::Null);
    let mut extra = good.clone();
    extra.insert("unknown".into(), Value::Null);
    assert!(runtime.channel_value("typing", extra).is_err());
    let mut missing = good.clone();
    missing.remove("typing");
    assert!(runtime.channel_value("typing", missing).is_err());
    let mut bad = good.clone();
    bad.insert("typing".into(), Value::Int(1));
    assert!(runtime.channel_value("typing", bad).is_err());
    let mut long = good.clone();
    long.insert("label".into(), Value::String("too long".into()));
    assert!(runtime.channel_value("typing", long).is_err());
    let mut forged = good;
    forged.insert(
        "users".into(),
        Value::Array(vec![Value::Id(SYSTEM_PRINCIPAL_ID.to_string())]),
    );
    assert!(runtime.channel_value("typing", forged).is_err());
}
