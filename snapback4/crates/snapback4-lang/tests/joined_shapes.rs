//! A join cannot choose one arm's wildcard precedence for the other arm.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile, types::Ty};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("fixtures/spread-metadata.q");

fn checked(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

fn context(flag: bool) -> Context {
    Context::new("alice", BTreeMap::from([("key".into(), Value::Id("note".into())), ("flag".into(), Value::Bool(flag))]))
}

#[test]
fn each_conditional_and_reassignment_arm_keeps_its_wildcard_rule() {
    let bound = checked(SOURCE);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("notes".into(), object([("id", Value::Id("note".into())), ("owner", Value::Id("alice".into())), ("title", Value::String("original".into()))]))]).unwrap();
    for flag in [true, false] {
        for name in ["shapedArms", "shapedConditional", "shapedReassignment", "spreadJoined"] {
            let result = engine.query(name, context(flag)).unwrap();
            assert_eq!(result.data.field("title").unwrap(), &Value::String(if flag || name == "spreadJoined" { "original" } else { "override" }.into()), "{name}, flag={flag}");
            assert_eq!(result.metered.examined, 1);
        }
        for name in ["joinedField", "reassignedField"] {
            assert_eq!(engine.query(name, context(flag)).unwrap().data, Value::String("original".into()), "{name}");
        }
    }
}

#[test]
fn shaping_an_already_joined_local_is_refused_for_conditionals_and_reassignments() {
    for body in [
        "  s = { ...p } if flag else p { * }\n",
        "  s = p { * } if flag else { ...p }\n",
        "  s = p { * }\n  if flag:\n    s = { ...p }\n",
        "  s = { ...p }\n  if flag:\n    s = p { * }\n",
    ] {
        let source = format!("{SOURCE}\nquery refused(key: notes, flag: bool):\n  p = notes[key] ! else NOT_FOUND\n{body}  return s {{ title: 'override', * }}\n");
        let bound = compile(&[("joined.q".into(), source.clone())]);
        let error = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_SHAPE_JOIN").unwrap_or_else(|| panic!("{body}: {:?}", bound.diagnostics));
        assert_eq!(error.site.file, "joined.q");
        assert_eq!(error.site.line as usize, source.lines().count());
        assert!(error.message.contains("different wildcard rules"), "{error:?}");
        assert!(error.rewrite.contains("before"), "{error:?}");
        assert!(error.rewrite.matches("title: 'override', *").count() >= 2, "{error:?}");
        assert!(snapback4_lang::guide::codes().contains(&error.code.as_str()));
        assert!(snapback4_lang::guide::explain_code(&error.code).is_some());
    }
}

#[test]
fn joining_and_reading_fields_does_not_shrink_the_bound_to_the_override_literal() {
    let bound = checked(SOURCE);
    for name in ["joinedField", "reassignedField"] {
        assert_eq!(bound.programs.iter().find(|p| p.program.name == name).unwrap().result, Ty::Text(10000));
    }
    let ts = snapback4_lang::emit::typescript(&bound);
    for name in ["shapedArms", "shapedConditional", "shapedReassignment"] {
        let Ty::RowMixed(Some(fields)) = &bound.programs.iter().find(|p| p.program.name == name).unwrap().result else { panic!("{name}: erased wildcard rules") };
        assert_eq!(fields["title"], Ty::Text(10000), "{name}");
        let line = ts.lines().find(|line| line.contains(&format!("{name}: Query<"))).unwrap();
        assert!(line.contains("title: string"), "{line}");
        assert_eq!(line.matches("pending?: boolean").count(), 1, "{line}");
    }
}

#[test]
fn the_two_arm_rewrite_compiles_and_preserves_both_answers() {
    let rejected = "  return s { title: 'override', *, extra: (1 + 2) * 3 }";
    let source = format!("{SOURCE}\nquery rewritten(key: notes, flag: bool):\n  p = notes[key] ! else NOT_FOUND\n  spreadArm = {{ ...p }}\n  shapeArm = p {{ * }}\n  s = spreadArm if flag else shapeArm\n{rejected}\n");
    let bound = compile(&[("schema.q".into(), source.clone())]);
    let error = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_SHAPE_JOIN").unwrap();
    let expression = error.rewrite.split_once(": ").unwrap().1.split_once("; ").unwrap().0;
    let bound = checked(&source.replace(rejected, &format!("  return {expression}")));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("notes".into(), object([("id", Value::Id("note".into())), ("owner", Value::Id("alice".into())), ("title", Value::String("original".into()))]))]).unwrap();
    for flag in [true, false] {
        let result = engine.query("rewritten", context(flag)).unwrap();
        assert_eq!(result.data.field("title").unwrap(), &Value::String(if flag { "original" } else { "override" }.into()));
        assert_eq!(result.data.field("extra").unwrap(), &Value::Int(9));
    }
}

#[test]
fn a_mix_survives_aliases_further_joins_nullable_values_and_container_fields() {
    let mut bodies = vec![
        "  s = { ...p } if flag else p { * }\n  s = s if flag else p { * }\n  return s { * }".to_owned(),
        "  s = { ...p } if flag else p { * }\n  alias = s\n  return alias { * }".into(),
        "  s = { ...p } if flag else p { * }\n  optional = s if flag else null\n  return optional { * }".into(),
        "  s = { item: { ...p } } if flag else { item: p { * } }\n  return s.item { * }".into(),
        "  s = [{ ...p }, p { * }]\n  return s { * }".into(),
    ];
    // A raw row or scalar used to erase RowMixed to Unknown; the next join
    // then chose RowShape's wildcard rule for the spread arm too.
    for other in ["p", "1"] {
        for joined in [format!("s if flag else {other}"), format!("{other} if flag else s")] {
            bodies.push(format!("  s = {{ ...p }} if flag else p {{ * }}\n  x = {joined}\n  x = x if flag else p {{ * }}\n  return x {{ title: 'override', * }}"));
            bodies.push(format!("  s = {{ ...p }} if flag else p {{ * }}\n  x = s\n  if flag:\n    x = {joined}\n  x = p {{ * }} if flag else x\n  alias = x\n  return alias {{ title: 'override', * }}"));
        }
    }
    // Losing a container's structure must not erase its nested marker either.
    for container in ["{ item: s }", "[s]", "s if flag else null"] {
        bodies.push(format!("  s = {{ ...p }} if flag else p {{ * }}\n  x = ({container}) if flag else 1\n  x = x if flag else p {{ * }}\n  return x {{ title: 'override', * }}"));
    }
    for body in bodies {
        let source = format!("{SOURCE}\nquery refused(key: notes, flag: bool):\n  p = notes[key] ! else NOT_FOUND\n{body}\n");
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_SHAPE_JOIN"), "{body}: {:?}", bound.diagnostics);
    }
}

#[test]
fn shaped_conditionals_run_only_the_selected_arm_and_preserve_nullable_bases() {
    let source = format!("{SOURCE}\nquery lazy(key: notes, flag: bool):\n  return ({{ ...notes[key] ! else NOT_FOUND }} if flag else notes['missing'] {{ * }}) {{ title: 'override', * }}\n");
    let bound = checked(&source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("notes".into(), object([("id", Value::Id("note".into())), ("owner", Value::Id("alice".into())), ("title", Value::String("original".into()))]))]).unwrap();
    let first = engine.query("lazy", context(true)).unwrap();
    assert_eq!(first.data.field("title").unwrap(), &Value::String("original".into()));
    assert_eq!(first.metered.examined, 1);
    let absent = engine.query("lazy", Context::new("alice", BTreeMap::from([("key".into(), Value::Id("missing-too".into())), ("flag".into(), Value::Bool(false))]))).unwrap();
    assert_eq!(absent.data, Value::Null);
    assert_eq!(absent.metered.examined, 1);
}

#[test]
fn losing_field_knowledge_keeps_the_conflict_without_inventing_a_result_type() {
    for other in ["p", "1", "{ item: s }", "[s]"] {
        let source = format!("{SOURCE}\nquery opaque(key: notes, flag: bool):\n  p = notes[key] ! else NOT_FOUND\n  s = {{ ...p }} if flag else p {{ * }}\n  x = s if flag else {other}\n  return x\n");
        let bound = checked(&source);
        let result = &bound.programs.iter().find(|p| p.program.name == "opaque").unwrap().result;
        // Known object fields can still join structurally; incompatible arms
        // must not promise an object shape or a scalar to the client.
        if other != "{ item: s }" {
            assert_eq!(result, &Ty::RowMixed(None));
            assert_eq!(snapback4_lang::emit::ty_ts(result), "unknown");
        }
        let shape = compile(&[("schema.q".into(), source.replace("return x\n", "return x { * }\n"))]);
        assert!(shape.diagnostics.iter().any(|d| d.code == "E_QUARRY_SHAPE_JOIN"), "{other}: {:?}", shape.diagnostics);
        if other == "1" {
            let spread = compile(&[("schema.q".into(), source.replace("return x\n", "return { ...x }\n"))]);
            assert!(spread.diagnostics.iter().any(|d| d.code == "E_QUARRY_SPREAD"), "{:?}", spread.diagnostics);
        }
    }
}
