//! Exhaustive evaluator roster complements the compiled, two-store generator.
use super::*;
use crate::{
    meter::{Ceilings, Cut, Meter},
    rows::MemoryRows,
    value::ReceiptTaint,
};

fn roster() -> Vec<Builtin> {
    use Builtin::*;
    vec![
        ProjectFields { table: "t".into() },
        ReceiptSettled { table: "t".into() },
        OptionalField {
            field: "number".into(),
        },
        Calendar { millis: 10 },
        Len,
        Slice,
        Concat,
        Lower,
        Trim,
        Sha256,
        Join,
        Group {
            field: "number".into(),
            optional: false,
        },
        Group {
            field: "number".into(),
            optional: true,
        },
        First,
        Last,
        At,
        Min,
        Max,
        Extremum {
            field: "number".into(),
            max: false,
            domain: false,
        },
        Extremum {
            field: "number".into(),
            max: true,
            domain: false,
        },
        ExtremumOf {
            max: false,
            domain: false,
        },
        ExtremumOf {
            max: true,
            domain: false,
        },
        Divmod {
            remainder_sink: "rest".into(),
        },
        Sort {
            keys: vec![crate::ir::SortKey {
                field: "number".into(),
                order: Order::Asc,
                optional: false,
            }],
        },
        MentionTokens,
        SearchPresent,
        DeterministicShare,
        Count,
        Sum,
        CountCapped,
        Connected,
    ]
}

fn arguments(builtin: &Builtin, compound: bool, taint: &ReceiptTaint) -> Vec<Expr> {
    let marked = |value: Value| {
        if compound {
            // An aggregate over a whole record must mark even its clean field.
            let row = object([
                (
                    "number",
                    Value::Int(1).with_receipt_taint(Some(taint.clone())),
                ),
                ("chosen", value),
            ]);
            Expr::Field {
                base: Box::new(Expr::Builtin {
                    builtin: Builtin::Min,
                    args: vec![Expr::Literal(row.clone()), Expr::Literal(row)],
                }),
                name: "chosen".into(),
            }
        } else {
            Expr::Literal(value.with_receipt_taint(Some(taint.clone())))
        }
    };
    let int = || marked(Value::Int(1));
    let text = || marked(Value::String(" @test ".into()));
    let row = || {
        marked(object([
            ("id", Value::Id("r".into())),
            ("number", Value::Int(1)),
        ]))
    };
    let list = || Expr::Array(vec![row()]);
    let literal = |v| Expr::Literal(Value::Int(v));
    // This match is intentionally exhaustive: a new builtin needs a witness.
    match builtin {
        Builtin::ProjectFields { .. }
        | Builtin::ReceiptSettled { .. }
        | Builtin::OptionalField { .. } => vec![row()],
        Builtin::Calendar { .. } => vec![int()],
        Builtin::Lower
        | Builtin::Trim
        | Builtin::Sha256
        | Builtin::MentionTokens
        | Builtin::SearchPresent
        | Builtin::Len
        | Builtin::Connected => vec![text()],
        Builtin::Slice => vec![list(), literal(0), literal(1)],
        Builtin::Concat => vec![Expr::Literal(Value::String("value=".into())), int()],
        Builtin::Join => vec![
            Expr::Array(vec![text()]),
            Expr::Literal(Value::String(",".into())),
        ],
        Builtin::Group { .. }
        | Builtin::First
        | Builtin::Last
        | Builtin::Sort { .. }
        | Builtin::Count
        | Builtin::CountCapped
        | Builtin::Extremum { .. } => vec![list()],
        Builtin::At => vec![list(), literal(0)],
        Builtin::Min | Builtin::Max | Builtin::Divmod { .. } => vec![int(), literal(1)],
        Builtin::ExtremumOf { .. } => vec![
            list(),
            Expr::Field {
                base: Box::new(Expr::Variable("$filter".into())),
                name: "number".into(),
            },
        ],
        Builtin::DeterministicShare => vec![literal(1), list(), row()],
        Builtin::Sum => vec![Expr::Array(vec![int()])],
    }
}

#[test]
fn every_builtin_preserves_scalar_and_compound_taint() {
    let bound = snapback4_lang::compile(&[(
        "test.q".into(),
        "table t:\n  number: int\n  public\n  sync public\n".into(),
    )]);
    assert!(bound.diagnostics.is_empty());
    let schema =
        crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
    let rows = MemoryRows::new();
    let mut cases = 0;
    for compound in [false, true] {
        for builtin in roster() {
            let mark = ReceiptTaint::default();
            let expression = Expr::Builtin {
                args: arguments(&builtin, compound, &mark),
                builtin: builtin.clone(),
            };
            let mut runner = Runner::new(
                &rows,
                &schema,
                Context::new("alice", Default::default()).at(0),
                Meter::new(Ceilings::default(), Cut::Abort),
                0,
            );
            let result = runner
                .expr(&expression)
                .unwrap_or_else(|e| panic!("{builtin:?}, compound={compound}: {e:?}"));
            assert!(
                result.receipt_taint().is_some(),
                "{builtin:?}, compound={compound}: lost result taint: {result:?}"
            );
            result.consume_receipt_taint();
            assert!(mark.touched(), "{builtin:?}");
            cases += 1;
        }
    }
    assert_eq!(cases, 62);
}

#[test]
fn every_operator_preserves_taint_and_refusals_consume_it() {
    use BinaryOp::*;
    for op in [
        Eq,
        Ne,
        SameValueZero,
        Lt,
        Lte,
        Gt,
        Gte,
        Add,
        Sub,
        Mul,
        And,
        Or,
    ] {
        let value = match op {
            And | Or => Value::Bool(true),
            _ => Value::Int(1),
        };
        let mark = ReceiptTaint::default();
        let result = binary(
            op,
            value.clone().with_receipt_taint(Some(mark.clone())),
            value,
        )
        .unwrap();
        assert!(result.receipt_taint().is_some(), "{op:?}");
        result.consume_receipt_taint();
        assert!(mark.touched());
    }
    let mark = ReceiptTaint::default();
    assert!(
        binary(
            Add,
            Value::Int(crate::value::I53_MAX).with_receipt_taint(Some(mark.clone())),
            Value::Int(1)
        )
        .is_err()
    );
    assert!(mark.touched());
    let schema = Default::default();
    let rows = MemoryRows::new();
    for op in [UnaryOp::Not, UnaryOp::Neg] {
        let mark = ReceiptTaint::default();
        let value = match op {
            UnaryOp::Not => Value::Bool(true),
            UnaryOp::Neg => Value::Int(1),
        };
        let mut runner = Runner::new(
            &rows,
            &schema,
            Context::new("alice", Default::default()),
            Meter::new(Ceilings::default(), Cut::Abort),
            0,
        );
        let result = runner
            .expr(&Expr::Unary {
                op,
                value: Box::new(Expr::Literal(value.with_receipt_taint(Some(mark.clone())))),
            })
            .unwrap();
        assert!(result.receipt_taint().is_some());
        result.consume_receipt_taint();
        assert!(mark.touched());
    }
}

#[test]
fn clean_insert_fields_codec_and_untaken_operands_stay_clean() {
    let mark = ReceiptTaint::default();
    let row = object([
        ("id", Value::Id("m".into())),
        ("text", Value::String("hello".into())),
        (
            "recipients",
            Value::Int(0).with_receipt_taint(Some(mark.clone())),
        ),
    ]);
    assert_eq!(row.field("id").unwrap().as_str().unwrap(), "m");
    assert_eq!(row.field("text").unwrap().as_str().unwrap(), "hello");
    let encoded = canonical_json(&row);
    let decoded: Value = crate::json_codec::from_text(&encoded).unwrap();
    assert!(decoded.receipt_taint().is_none());
    assert!(
        !mark.touched(),
        "image/output charging is not an authored decision"
    );
    let schema = Default::default();
    let rows = MemoryRows::new();
    let mut runner = Runner::new(
        &rows,
        &schema,
        Context::new("alice", Default::default()),
        Meter::new(Ceilings::default(), Cut::Abort),
        0,
    );
    runner
        .expr(&Expr::Binary {
            op: BinaryOp::Or,
            left: Box::new(Expr::Literal(Value::Bool(true))),
            right: Box::new(Expr::Literal(
                Value::Bool(false).with_receipt_taint(Some(mark.clone())),
            )),
        })
        .unwrap();
    assert!(!mark.touched());
    assert_eq!(
        crate::key::encode(&[row.field("recipients").unwrap().clone()]),
        crate::key::encode(&[Value::Int(0)])
    );
    assert!(mark.touched());
    assert!(crate::json_codec::from_text::<Value>(r#"{"Receipt":{"value":{"Int":1}}}"#).is_err());
    let key_mark = ReceiptTaint::default();
    let key = Value::Array(vec![object([(
        "n",
        Value::Int(1).with_receipt_taint(Some(key_mark.clone())),
    )])]);
    let encoded = canonical_json(&key);
    assert!(!key_mark.touched());
    assert_eq!(key.key_json(), encoded);
    assert!(key_mark.touched());
}

#[test]
fn extrema_preserve_compound_source_marks_on_clean_outputs() {
    let schema = Default::default();
    let rows = MemoryRows::new();
    for empty in [false, true] {
        for max in [false, true] {
            for projection in [false, true] {
                let mark = ReceiptTaint::default();
                let source = if empty {
                    Value::Array(vec![]).with_receipt_taint(Some(mark.clone()))
                } else {
                    Value::Array(vec![object([
                        (
                            "owned",
                            Value::Int(0).with_receipt_taint(Some(mark.clone())),
                        ),
                        ("chosen", Value::Int(2)),
                    ])])
                };
                let (builtin, args) = if projection {
                    (
                        Builtin::ExtremumOf { max, domain: false },
                        vec![
                            Expr::Literal(source),
                            Expr::Field {
                                base: Box::new(Expr::Variable("$filter".into())),
                                name: "chosen".into(),
                            },
                        ],
                    )
                } else {
                    (
                        Builtin::Extremum {
                            field: "chosen".into(),
                            max,
                            domain: false,
                        },
                        vec![Expr::Literal(source)],
                    )
                };
                let mut runner = Runner::new(
                    &rows,
                    &schema,
                    Context::new("alice", Default::default()),
                    Meter::new(Ceilings::default(), Cut::Abort),
                    0,
                );
                let result = runner.expr(&Expr::Builtin { builtin, args }).unwrap();
                assert!(mark.touched(), "the builtin outcome consumes the source");
                assert!(
                    result.receipt_taint().is_some(),
                    "empty={empty}, max={max}, projection={projection}: {result:?}"
                );
            }
        }
    }
}

#[test]
fn shapes_preserve_compound_source_marks_on_clean_outputs() {
    let schema = Default::default();
    let rows = MemoryRows::new();
    // A shaped result must carry root marks from one or several bases, even
    // when every projected field is clean or replaced by a literal.
    for sources in 0..3 {
        let mark = ReceiptTaint::default();
        let row = object([("chosen", Value::Int(2))]);
        let base = match sources {
            0 => row.with_receipt_taint(Some(mark.clone())),
            1 => Value::Array(vec![row.with_receipt_taint(Some(mark.clone()))]),
            _ => Value::Array(vec![row]).with_receipt_taint(Some(mark.clone())),
        };
        let mut runner = Runner::new(
            &rows,
            &schema,
            Context::new("alice", Default::default()),
            Meter::new(Ceilings::default(), Cut::Abort),
            0,
        );
        let result = runner
            .expr(&Expr::Shape {
                base: Box::new(Expr::Literal(base)),
                fields: [("chosen".into(), Expr::Literal(Value::Int(3)))].into(),
            })
            .unwrap();
        assert!(
            result.receipt_taint().is_some(),
            "shape source={sources}: {result:?}"
        );
        result.consume_receipt_taint();
        assert!(mark.touched());
    }
}

#[test]
fn project_fields_preserve_owned_marks_and_clean_siblings() {
    let bound = snapback4_lang::compile(&[(
        "test.q".into(),
        "table t:\n  number: int\n  public\n  sync public\n".into(),
    )]);
    assert!(bound.diagnostics.is_empty());
    let schema =
        crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
    let rows = MemoryRows::new();
    let mark = ReceiptTaint::default();
    let row = object([
        ("id", Value::Id("r".into())),
        (
            "number",
            Value::Int(1).with_receipt_taint(Some(mark.clone())),
        ),
    ]);
    let mut runner = Runner::new(
        &rows,
        &schema,
        Context::new("alice", Default::default()).at(0),
        Meter::new(Ceilings::default(), Cut::Abort),
        0,
    );
    let result = runner
        .expr(&Expr::Builtin {
            builtin: Builtin::ProjectFields { table: "t".into() },
            args: vec![Expr::Literal(row)],
        })
        .unwrap();
    assert_eq!(result.field("id").unwrap().as_str().unwrap(), "r");
    assert!(
        !mark.touched(),
        "compiler projection and clean id do not consume sibling accounting"
    );
    assert!(result.field("number").unwrap().receipt_taint().is_some());
    result.consume_receipt_taint();
    assert!(mark.touched());
}

#[test]
fn rule_decision_sink_consumes_marked_numeric_and_created_terms() {
    use crate::schema::{RuleExpr, RuleTerm};
    struct Answer;
    impl crate::engine::rules::Probe for Answer {
        fn exists(
            &mut self,
            _: &str,
            _: &str,
            _: &[Value],
            _: &[(String, Value)],
        ) -> Result<bool, RuntimeError> {
            Ok(true)
        }
        fn created(&mut self, _: &str, _: &str, _: &[Value]) -> bool {
            true
        }
    }
    for rule in [
        RuleExpr::Compare(
            BinaryOp::Gt,
            RuleTerm::Field("owned".into()),
            RuleTerm::Literal(Value::Int(0)),
        ),
        RuleExpr::Created {
            table: "other".into(),
            index: "byValue".into(),
            key: vec![RuleTerm::Field("owned".into())],
            provenance: KeyProvenance::Computed,
            equalities: vec![],
        },
    ] {
        let mark = ReceiptTaint::default();
        let row = object([(
            "owned",
            Value::Int(1).with_receipt_taint(Some(mark.clone())),
        )]);
        assert!(
            crate::engine::rules::evaluate(&rule, "alice", None, &row, true, &mut Answer).unwrap(),
            "{rule:?}"
        );
        assert!(mark.touched(), "{rule:?}");
    }
}

#[test]
fn effect_decision_sink_consumes_compound_payload() {
    let mut schema: crate::schema::Schema = Default::default();
    schema.effects.push("notify".into());
    let rows = MemoryRows::new();
    let mark = ReceiptTaint::default();
    let payload = object([(
        "owned",
        Value::Int(1).with_receipt_taint(Some(mark.clone())),
    )]);
    let mut runner = Runner::new(
        &rows,
        &schema,
        Context::new("alice", Default::default()).at(0),
        Meter::new(Ceilings::default(), Cut::Abort),
        0,
    );
    runner
        .statements(
            &[Stmt::Emit {
                effect: "notify".into(),
                payload: Expr::Literal(payload),
                once: None,
            }],
            "emit",
        )
        .unwrap();
    assert!(mark.touched());
}
