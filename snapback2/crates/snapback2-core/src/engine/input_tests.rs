use super::*;
use crate::{Ceilings, Channel, ChannelSide, Checker, Generation, ProjectJson, Runtime};

#[path = "input_format_tests.rs"]
mod formats;

#[test]
fn declared_query_clock_is_pinned_even_when_timed_branch_is_unvisited() {
    let schema = Schema::default();
    let mut program = Program {
        name: "clock.branch".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: Some(1000),
        body: vec![Stmt::If {
            condition: Expr::Literal(Value::Bool(false)),
            then_body: vec![Stmt::Return(Expr::Input(Input::ReadTime))],
            else_body: vec![Stmt::Return(Expr::Literal(Value::Int(1)))],
        }],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let mut context = Context::query(Actor::user("alice").unwrap(), BTreeMap::new());
    for time in [None, Some(I53_MIN - 1), Some(I53_MAX + 1)] {
        context.read_time = time;
        assert!(matches!(
            engine.execute(&program, &certificate, context.clone()),
            Err(RuntimeError::Input(_))
        ));
    }
    for time in [I53_MIN, -1, 0, 1, 999, I53_MAX] {
        context.read_time = Some(time);
        assert_eq!(
            context.query_read_time(&program, &certificate).unwrap(),
            Some(time)
        );
        assert_eq!(
            engine
                .execute(&program, &certificate, context.clone())
                .unwrap()
                .result,
            Value::Int(1)
        );
    }
    let mut forged = certificate.clone();
    forged.read_time_granularity_ms = None;
    assert!(matches!(
        engine.execute(&program, &forged, context.clone()),
        Err(RuntimeError::TraceSubset(_))
    ));
    program.body = vec![Stmt::Return(Expr::Literal(Value::Int(1)))];
    let declared = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    program.read_time_granularity_ms = None;
    let untimed = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(declared.max_closure_bytes, untimed.max_closure_bytes + 32);
    assert_eq!(context.query_read_time(&program, &untimed).unwrap(), None);
    for granularity in [0, I53_MAX as u64 + 1] {
        program.read_time_granularity_ms = Some(granularity);
        assert!(
            Checker::new(&schema, Ceilings::default())
                .check(&program)
                .is_err()
        );
    }
}

#[test]
fn text_minimum_counts_scalars_recursively_and_keeps_canonical_identity() {
    let positive = ArgType::Text {
        max: 4,
        min: 2,
        format: None,
    };
    for source in ["ab", "𐐀a", "e\u{301}"] {
        validate_arg_value(&positive, &Value::String(source.into()), "input").unwrap();
    }
    for source in ["", "𐐀", "abcde", "a\0"] {
        assert_eq!(
            validate_arg_value(&positive, &Value::String(source.into()), "input")
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
    }
    let nested = ArgType::Optional(Box::new(ArgType::List {
        max: 2,
        of: Some(Box::new(ArgType::Optional(Box::new(positive.clone())))),
    }));
    validate_arg_value(&nested, &Value::Null, "input").unwrap();
    validate_arg_value(
        &nested,
        &Value::Array(vec![Value::Null, Value::String("ab".into())]),
        "input",
    )
    .unwrap();
    assert!(
        validate_arg_value(
            &nested,
            &Value::Array(vec![Value::String("a".into())]),
            "input"
        )
        .is_err()
    );
    assert!(validate_arg_value(&nested, &Value::Array(vec![Value::Null; 3]), "input").is_err());
    let omitted: ArgType = serde_json::from_str(r#"{"Text":{"max":4}}"#).unwrap();
    let zero: ArgType = serde_json::from_str(r#"{"Text":{"max":4,"min":0}}"#).unwrap();
    assert_eq!(digest(&omitted), digest(&zero));
    assert_eq!(canonical_json(&zero), r#"{"Text":{"max":4}}"#);
    assert_ne!(digest(&zero), digest(&positive));
    let invalid = ArgType::Optional(Box::new(ArgType::Text {
        max: 1,
        min: 2,
        format: None,
    }));
    assert!(validate_arg_value(&invalid, &Value::Null, "input").is_err());
}

#[test]
fn text_minimum_certification_execution_channel_and_semantic_fence() {
    let kind = ArgType::Text {
        max: 4,
        min: 2,
        format: None,
    };
    let args = BTreeMap::from([("term".into(), kind.clone())]);
    let mut schema = Schema::default();
    schema.channels.insert(
        "topic".into(),
        Channel {
            args: args.clone(),
            publish: RuleExpr::Allow,
            subscribe: RuleExpr::Allow,
            ttl_ms: 1000,
        },
    );
    let p = Program {
        name: "minimum".into(),
        kind: ProgramKind::Query,
        args,
        read_time_granularity_ms: None,
        body: vec![crate::Stmt::Return(crate::Expr::Variable("term".into()))],
    };
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    println!(
        "CERTIFIED_MINIMUM {}",
        canonical_json(&serde_json::json!({"schema":schema,"program":p,"certificate":cert}))
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let context = |term: &str| {
        Context::query(
            crate::Actor::user("alice").unwrap(),
            BTreeMap::from([("term".into(), Value::String(term.into()))]),
        )
    };
    assert_eq!(
        engine.execute(&p, &cert, context("a")).unwrap_err().code(),
        "E_INPUT"
    );
    assert_eq!(
        engine.execute(&p, &cert, context("𐐀a")).unwrap().result,
        Value::String("𐐀a".into())
    );
    for (value, evaluator) in [
        (
            "i53-codepoint-bytes-unicode-search-v3",
            cert.evaluator_version.as_str(),
        ),
        (
            cert.value_model_version.as_str(),
            "bounded-spike-rust-search-2",
        ),
    ] {
        let mut old = cert.clone();
        old.value_model_version = value.into();
        old.evaluator_version = evaluator.into();
        assert!(matches!(
            engine.execute(&p, &old, context("ab")),
            Err(RuntimeError::TraceSubset(_))
        ));
    }
    let mut optional = p.clone();
    optional
        .args
        .insert("term".into(), ArgType::Optional(Box::new(kind)));
    let optional_cert = Checker::new(&schema, Ceilings::default())
        .check(&optional)
        .unwrap();
    let omitted = Context::query(crate::Actor::user("alice").unwrap(), BTreeMap::new());
    assert_eq!(
        engine
            .execute(&optional, &optional_cert, omitted)
            .unwrap()
            .result,
        Value::Null
    );
    let mut mutation = p.clone();
    mutation.kind = ProgramKind::Mutation;
    mutation.body = vec![crate::Stmt::Require {
        condition: crate::Expr::Literal(Value::Bool(false)),
        code: "BODY_EXECUTED".into(),
    }];
    let mutation_cert = Checker::new(&schema, Ceilings::default())
        .check(&mutation)
        .unwrap();
    assert_eq!(
        engine
            .execute(&mutation, &mutation_cert, context("a"))
            .unwrap_err()
            .code(),
        "E_INPUT"
    );
    let mut invalid = p.clone();
    invalid.args.insert(
        "term".into(),
        ArgType::Text {
            max: 1,
            min: 2,
            format: None,
        },
    );
    assert!(
        Checker::new(&schema, Ceilings::default())
            .check(&invalid)
            .is_err()
    );
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            auth: Default::default(),
            schema: schema.clone(),
            programs: vec![p],
            effects: vec![],
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    assert_eq!(
        runtime
            .channel_admit(
                "topic",
                ChannelSide::Subscribe,
                &context("a").args,
                &context("a")
            )
            .unwrap_err()
            .code(),
        "E_INPUT"
    );
    runtime
        .channel_admit(
            "topic",
            ChannelSide::Publish,
            &context("ab").args,
            &context("ab"),
        )
        .unwrap();
    schema.channels.get_mut("topic").unwrap().args.insert(
        "term".into(),
        ArgType::Optional(Box::new(ArgType::Text {
            max: 1,
            min: 2,
            format: None,
        })),
    );
    assert!(Engine::memory(schema).is_err());
}

#[path = "minimum_compiler_fixture.rs"]
mod compiler_fixture;
#[test]
fn exact_e6_compiler_minimum_ir_certifies_and_refuses_before_body_or_effect() {
    let json: serde_json::Value = serde_json::from_str(compiler_fixture::PROJECT).unwrap();
    let schema: Schema = serde_json::from_value(json["schema"].clone()).unwrap();
    let programs: Vec<Program> = serde_json::from_value(json["programs"].clone()).unwrap();
    for program in &programs {
        let certificate = Checker::new(&schema, Ceilings::default())
            .check_all(program)
            .unwrap_or_else(|e| panic!("{}: {e:?}", program.name));
        assert!(certificate.has_current_semantics());
        if program.name == "ops.inspect" || program.name == "ops.send" {
            let mut engine = Engine::memory(schema.clone()).unwrap();
            let args = BTreeMap::from([
                ("body".into(), Value::String(String::new())),
                ("options".into(), Value::Array(vec![])),
            ]);
            let error = engine
                .execute(
                    program,
                    &certificate,
                    Context::query(crate::Actor::user("alice").unwrap(), args),
                )
                .unwrap_err();
            assert_eq!(error.code(), "E_INPUT");
            assert_eq!(engine.store.commit_seq().unwrap(), 0);
        }
    }
}

#[test]
fn query_asset_lists_keep_whole_container_duplicate_refusal() {
    // Reuse the unchanged shipped asset-shape input; a query has no mutation
    // ledger pass to catch a duplicate missed by entry validation.
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../corpus/asset-shape-list-duplicate.json"
    ))
    .unwrap();
    let program: Program = serde_json::from_value(fixture["program"].clone()).unwrap();
    let context = Context::query(
        Actor::user(fixture["context"]["viewer"].as_str().unwrap()).unwrap(),
        serde_json::from_value(fixture["context"]["args"].clone()).unwrap(),
    );
    assert_eq!(serde_json::to_value(&context).unwrap(), fixture["context"]);
    let project = ProjectJson {
        version: 1,
        schema: Schema::default(),
        programs: vec![program.clone()],
        effects: vec![],
        auth: crate::Auth::default(),
    };
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let error = runtime.execute(&program.name, context.clone()).unwrap_err();
    println!("duplicate_asset_query_refusal={error:?}");
    assert_eq!(error.code(), "E_ASSET_TYPE");
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
    let mut single = context;
    let Value::Array(values) = single.args.get_mut("asset").unwrap() else {
        unreachable!()
    };
    values.pop();
    let execution = runtime.execute(&program.name, single).unwrap();
    assert_eq!(execution.result.as_array().unwrap().len(), 1);
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
}
