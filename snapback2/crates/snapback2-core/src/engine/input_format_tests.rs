use super::*;

fn formatted(format: TextFormat) -> ArgType {
    ArgType::Text {
        max: 200,
        min: 0,
        format: Some(format),
    }
}

#[test]
fn argument_formats_share_exact_column_predicates_and_closed_wire_values() {
    let handle = formatted(TextFormat::Handle);
    for text in ["", "abc", "a_09"] {
        validate_arg_value(&handle, &Value::String(text.into()), "handle").unwrap();
    }
    for text in ["A", "café", "a-b", "a b", "𐐀", "a\n"] {
        assert_eq!(
            validate_arg_value(&handle, &Value::String(text.into()), "handle")
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
    }
    let url = formatted(TextFormat::Url);
    for text in [
        "http://a",
        "https://例",
        "https://\u{feff}",
        "http://\u{180e}",
        "https://\u{200b}",
    ] {
        validate_arg_value(&url, &Value::String(text.into()), "url").unwrap();
    }
    for text in [
        "",
        "HTTP://a",
        "https://",
        "ftp://a",
        " https://a",
        "http://a\n",
        "http://a\u{85}",
        "http://a\u{a0}",
        "http://a\u{7f}",
    ] {
        assert!(
            validate_arg_value(&url, &Value::String(text.into()), "url").is_err(),
            "{text:?}"
        );
    }
    let positive = ArgType::Text {
        max: 20,
        min: 1,
        format: Some(TextFormat::Handle),
    };
    assert_eq!(
        canonical_json(&positive),
        r#"{"Text":{"max":20,"min":1,"format":"handle"}}"#
    );
    assert_eq!(
        canonical_json(&formatted(TextFormat::Url)),
        r#"{"Text":{"max":200,"format":"url"}}"#
    );
    let nested = ArgType::Optional(Box::new(ArgType::List {
        max: 2,
        of: Some(Box::new(ArgType::Optional(Box::new(positive)))),
    }));
    for value in [
        Value::Null,
        Value::Array(vec![Value::Null, Value::String("abc".into())]),
    ] {
        validate_arg_value(&nested, &value, "nested").unwrap();
    }
    for value in [
        Value::Array(vec![Value::String("".into())]),
        Value::Array(vec![Value::String("A".into())]),
        Value::Array(vec![Value::Null; 3]),
    ] {
        assert!(validate_arg_value(&nested, &value, "nested").is_err());
    }
    assert_eq!(
        serde_json::from_str::<ArgType>(&canonical_json(&nested)).unwrap(),
        nested
    );
    for invalid in [
        serde_json::Value::Null,
        serde_json::json!("email"),
        serde_json::json!("Handle"),
        serde_json::json!(1),
        serde_json::json!({}),
        serde_json::json!({"handle":null}),
        serde_json::json!({"url":null}),
        serde_json::json!([]),
    ] {
        assert!(
            serde_json::from_value::<ArgType>(
                serde_json::json!({"Text":{"max":20,"format":invalid}})
            )
            .is_err()
        );
    }
    let plain: ArgType = serde_json::from_str(r#"{"Text":{"max":20,"min":0}}"#).unwrap();
    assert_eq!(canonical_json(&plain), r#"{"Text":{"max":20}}"#);
}

#[test]
fn argument_formats_admit_before_query_mutation_and_channel_and_fence_v4() {
    let args = BTreeMap::from([
        ("handle".into(), formatted(TextFormat::Handle)),
        (
            "link".into(),
            ArgType::Optional(Box::new(formatted(TextFormat::Url))),
        ),
        (
            "items".into(),
            ArgType::List {
                max: 2,
                of: Some(Box::new(formatted(TextFormat::Handle))),
            },
        ),
    ]);
    let mut schema = Schema::default();
    schema.channels.insert(
        "topic".into(),
        Channel {
            value: BTreeMap::from([("typing".to_owned(), ArgType::Bool)]),
            ttl_ms: 1000,
            args: args.clone(),
            publish: RuleExpr::Allow,
            subscribe: RuleExpr::Allow,
        },
    );
    let mut query = Program {
        name: "formats".into(),
        kind: ProgramKind::Query,
        args,
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Variable("link".into()))],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check_all(&query)
        .unwrap();
    println!(
        "CERTIFIED_FORMAT {}",
        canonical_json(
            &serde_json::json!({"schema":schema,"program":query,"certificate":certificate})
        )
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let valid = BTreeMap::from([
        ("handle".into(), Value::String("abc".into())),
        (
            "items".into(),
            Value::Array(vec![Value::String("x_2".into())]),
        ),
    ]);
    let context = |args| Context::query(Actor::user("alice").unwrap(), args);
    assert_eq!(
        engine
            .execute(&query, &certificate, context(valid.clone()))
            .unwrap()
            .result,
        Value::Null
    );
    for (field, value) in [
        ("handle", Value::String("A".into())),
        ("link", Value::String("https://".into())),
        (
            "items",
            Value::Array(vec![Value::String("bad-name".into())]),
        ),
    ] {
        let mut invalid = valid.clone();
        invalid.insert(field.into(), value);
        assert_eq!(
            engine
                .execute(&query, &certificate, context(invalid.clone()))
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        let mut mutation = query.clone();
        mutation.kind = ProgramKind::Mutation;
        mutation.body = vec![Stmt::Require {
            condition: Expr::Literal(Value::Bool(false)),
            code: "BODY_EXECUTED".into(),
        }];
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&mutation)
            .unwrap();
        assert_eq!(
            engine
                .execute(&mutation, &cert, context(invalid.clone()))
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                schema: schema.clone(),
                programs: vec![query.clone()],
                effects: vec![],
                auth: Default::default(),
            },
            Ceilings::default(),
        )
        .unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
        for side in [ChannelSide::Publish, ChannelSide::Subscribe] {
            assert_eq!(
                runtime
                    .channel_admit("topic", side, &invalid, &context(invalid.clone()))
                    .unwrap_err()
                    .code(),
                "E_INPUT"
            );
            runtime
                .channel_admit("topic", side, &valid, &context(valid.clone()))
                .unwrap();
        }
    }
    for (value, evaluator) in [
        (
            "i53-codepoint-bytes-unicode-search-text-min-v4",
            certificate.evaluator_version.as_str(),
        ),
        (
            certificate.value_model_version.as_str(),
            "bounded-spike-rust-search-text-min-3",
        ),
    ] {
        let mut old = certificate.clone();
        old.value_model_version = value.into();
        old.evaluator_version = evaluator.into();
        assert!(matches!(
            engine.execute(&query, &old, context(valid.clone())),
            Err(RuntimeError::TraceSubset(_))
        ));
    }
    query.args.get_mut("handle").map(|ty| {
        let ArgType::Text { format, .. } = ty else {
            unreachable!()
        };
        *format = None;
    });
    assert_ne!(
        Checker::new(&schema, Ceilings::default())
            .check(&query)
            .unwrap()
            .plan_hash,
        certificate.plan_hash
    );
}
