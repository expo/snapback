use super::*;
use crate::registry::ProjectJson;
pub(crate) fn project(raw: &str) -> ProjectJson {
    let value: serde_json::Value = serde_json::from_str(raw).unwrap();
    ProjectJson {
        version: 1,
        auth: Default::default(),
        schema: serde_json::from_value(value["schema"].clone()).unwrap(),
        programs: serde_json::from_value(value["programs"].clone()).unwrap(),
        effects: Vec::new(),
    }
}
fn merge_mut(p: &mut Program) -> &mut Merge {
    let Stmt::If { then_body, .. } = &mut p.body[1] else {
        panic!("if")
    };
    let Stmt::Const {
        value: Expr::Merge(m),
        ..
    } = &mut then_body[1]
    else {
        panic!("merge")
    };
    m
}
#[test]
fn captured_principal_is_not_rebound_by_same_name_shadow() {
    let mut shadow = project(SHADOWED);
    let mut control = project(CONTROL);
    let descriptor = merge_mut(&mut shadow.programs[0]).held_search.clone();
    assert!(descriptor.is_some());
    let errors = validate(&shadow.schema, &shadow.programs[0]);
    assert!(
        errors.iter().any(|e| e.message.contains("held_search")),
        "{errors:?}"
    );
    assert!(validate(&control.schema, &control.programs[0]).is_empty());
    merge_mut(&mut control.programs[0]).held_search = descriptor;
    let errors = validate(&control.schema, &control.programs[0]);
    assert!(
        errors.iter().any(|e| e.message.contains("held_search")),
        "{errors:?}"
    );
    // Same descriptor and same lexical alias shape, but capture viewer itself.
    let Stmt::Const { value, .. } = &mut shadow.programs[0].body[0] else {
        panic!("capture")
    };
    *value = Expr::Input(Input::Viewer);
    assert!(validate(&shadow.schema, &shadow.programs[0]).is_empty());
    // And rebinding that captured alias to another argument must invalidate it.
    shadow.programs[0].body.insert(
        1,
        Stmt::Let {
            name: "original".into(),
            value: Expr::Variable("who".into()),
        },
    );
    assert!(
        validate(&shadow.schema, &shadow.programs[0])
            .iter()
            .any(|e| e.message.contains("held_search"))
    );
}

// Exact emitted ProjectJson from astra-search-shadowed-principal.json (full output SHA-256 a11ce0dc4f3dd6cf168915976fefd1146c4370a11aabaf3a8e2d2c6de4e3a94f).
const SHADOWED: &str = r###"{"schema":{"tables":{"conversations":{"columns":{"id":"Id","title":{"Text":{"max":50}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true}},"rules":{"read":{"Public":{"reason":"conversations is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"},"memberships":{"columns":{"id":"Id","conversation":{"Ref":{"table":"conversations"}},"principal":"Principal"},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byConversationPrincipal":{"components":[{"Column":"conversation"},{"Column":"principal"}],"unique":true},"byPrincipal":{"components":[{"Column":"principal"},{"Column":"conversation"},{"Column":"id"}],"unique":false}},"rules":{"read":{"Exists":{"table":"memberships","index":"byConversationPrincipal","key":[{"Field":"conversation"},"Viewer"],"provenance":"Shape"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[{"Unique":{"index":"byConversationPrincipal"}},{"Cap":{"by":["principal"],"max":100}}],"retain":"until-revoked"},"messages":{"columns":{"id":"Id","conversation":{"Ref":{"table":"conversations"}},"body":{"Optional":{"Text":{"max":4000}}},"caption":{"Optional":{"Text":{"max":50}}},"at":"Time"},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byConversationWords":{"components":[{"Column":"conversation"},{"WordPrefixes":{"fields":["body","caption"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"at"},{"Column":"id"}],"unique":false}},"rules":{"read":{"Exists":{"table":"memberships","index":"byConversationPrincipal","key":[{"Field":"conversation"},"Viewer"],"provenance":"Shape"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"},"people":{"columns":{"id":"Id","name":{"Text":{"max":50}},"handle":{"Optional":{"Text":{"max":20}}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byNameWords":{"components":[{"WordPrefixes":{"fields":["name","handle"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"id"}],"unique":false}},"rules":{"read":{"Public":{"reason":"people is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"}},"maintains":[],"channels":{},"auth":{"password":false,"guests":false},"effects":[]},"programs":[{"name":"search.global","kind":"Query","args":{"c":{"Optional":"Cursor"},"term":{"Text":{"max":2000}},"who":"Principal"},"read_time_granularity_ms":null,"body":[{"Const":{"name":"original","value":{"Variable":"who"}}},{"If":{"condition":{"Literal":{"Bool":true}},"then_body":[{"Const":{"name":"who","value":{"Input":"Viewer"}}},{"Const":{"name":"page","value":{"Merge":{"site":"snapback/search.q:5:12","lanes":[{"scan":{"site":"search.global.1","table":"messages","index":"byConversationWords","prefix":[{"Scalar":{"Field":{"base":{"Variable":"m"},"name":"conversation"}}},{"WordPrefix":{"source":{"Variable":"term"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":2000}}],"order":"Desc","take":{"Literal":20},"after":{"Variable":"c"},"before":null,"range":null,"opaque_cursor":true,"merge_site":"snapback/search.q:5:12","provenance":"Shape"},"source":{"site":"search.global.0","table":"memberships","index":"byPrincipal","prefix":[{"Scalar":{"Variable":"original"}}],"order":"Asc","take":{"Literal":100},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Arg"},"binding":"m"}],"held_search":{"table":"messages","index":"byConversationWords","term":{"source":{"Variable":"term"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":2000},"scope":[{"column":"conversation","value":{"Field":{"base":{"Variable":"m"},"name":"conversation"}}}],"suffix":["at","id"],"order":"Desc","take":{"Literal":20},"after":{"Variable":"c"},"discovery":{"scan":{"site":"search.global.0","table":"memberships","index":"byPrincipal","prefix":[{"Scalar":{"Variable":"original"}}],"order":"Asc","take":{"Literal":100},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Arg"},"binding":"m","authorization_index":"byConversationPrincipal"}}}}}},{"Return":{"Variable":"page"}}],"else_body":[]}},{"Return":{"Literal":"Null"}}]}],"effects":[]}"###;
// Exact emitted ProjectJson from astra-search-shadowed-principal-control.json (full output SHA-256 19840c98e8b535bffa440770189f606077ebef527d8eeb39be9e1da79e985d32).
const CONTROL: &str = r###"{"schema":{"tables":{"conversations":{"columns":{"id":"Id","title":{"Text":{"max":50}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true}},"rules":{"read":{"Public":{"reason":"conversations is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"},"memberships":{"columns":{"id":"Id","conversation":{"Ref":{"table":"conversations"}},"principal":"Principal"},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byConversationPrincipal":{"components":[{"Column":"conversation"},{"Column":"principal"}],"unique":true},"byPrincipal":{"components":[{"Column":"principal"},{"Column":"conversation"},{"Column":"id"}],"unique":false}},"rules":{"read":{"Exists":{"table":"memberships","index":"byConversationPrincipal","key":[{"Field":"conversation"},"Viewer"],"provenance":"Shape"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[{"Unique":{"index":"byConversationPrincipal"}},{"Cap":{"by":["principal"],"max":100}}],"retain":"until-revoked"},"messages":{"columns":{"id":"Id","conversation":{"Ref":{"table":"conversations"}},"body":{"Optional":{"Text":{"max":4000}}},"caption":{"Optional":{"Text":{"max":50}}},"at":"Time"},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byConversationWords":{"components":[{"Column":"conversation"},{"WordPrefixes":{"fields":["body","caption"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"at"},{"Column":"id"}],"unique":false}},"rules":{"read":{"Exists":{"table":"memberships","index":"byConversationPrincipal","key":[{"Field":"conversation"},"Viewer"],"provenance":"Shape"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"},"people":{"columns":{"id":"Id","name":{"Text":{"max":50}},"handle":{"Optional":{"Text":{"max":20}}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byNameWords":{"components":[{"WordPrefixes":{"fields":["name","handle"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"id"}],"unique":false}},"rules":{"read":{"Public":{"reason":"people is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"}},"maintains":[],"channels":{},"auth":{"password":false,"guests":false},"effects":[]},"programs":[{"name":"search.global","kind":"Query","args":{"c":{"Optional":"Cursor"},"term":{"Text":{"max":2000}},"who":"Principal"},"read_time_granularity_ms":null,"body":[{"Const":{"name":"original","value":{"Variable":"who"}}},{"If":{"condition":{"Literal":{"Bool":true}},"then_body":[{"Const":{"name":"person","value":{"Input":"Viewer"}}},{"Const":{"name":"page","value":{"Merge":{"site":"snapback/search.q:5:12","lanes":[{"scan":{"site":"search.global.1","table":"messages","index":"byConversationWords","prefix":[{"Scalar":{"Field":{"base":{"Variable":"m"},"name":"conversation"}}},{"WordPrefix":{"source":{"Variable":"term"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":2000}}],"order":"Desc","take":{"Literal":20},"after":{"Variable":"c"},"before":null,"range":null,"opaque_cursor":true,"merge_site":"snapback/search.q:5:12","provenance":"Shape"},"source":{"site":"search.global.0","table":"memberships","index":"byPrincipal","prefix":[{"Scalar":{"Variable":"original"}}],"order":"Asc","take":{"Literal":100},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Arg"},"binding":"m"}]}}}},{"Return":{"Variable":"page"}}],"else_body":[]}},{"Return":{"Literal":"Null"}}]}],"effects":[]}"###;

#[test]
fn exact_compiler_search_recipes_certify() {
    let project = project(RECIPES);
    for program in &project.programs {
        let certificate = Checker::new(&project.schema, Ceilings::default())
            .check_all(program)
            .unwrap_or_else(|errors| panic!("{}: {errors:#?}", program.name));
        println!(
            "CERTIFIED_RECIPE {}",
            crate::value::canonical_json(
                &serde_json::json!({"schema":project.schema,"program":program,"certificate":certificate})
            )
        );
    }
}

#[test]
fn held_assertions_and_derived_shape_are_independently_checked() {
    let project = project(RECIPES);
    let global = project
        .programs
        .iter()
        .find(|p| p.name == "search.global")
        .unwrap();
    for change in 0..4 {
        let mut p = global.clone();
        let Stmt::Const {
            value: Expr::Merge(m),
            ..
        } = &mut p.body[0]
        else {
            panic!("merge")
        };
        match change {
            0 => m.held_search.as_mut().unwrap().term.source_max = 10,
            1 => {
                m.lanes[0].scan.before = Some(Box::new(Expr::Literal(Value::Array(vec![
                    Value::Int(3),
                    Value::Id("a".into()),
                ]))))
            }
            2 => {
                m.lanes[0].source.as_mut().unwrap().range = Some(crate::ir::Range {
                    gt: None,
                    gte: None,
                    lt: Some(Box::new(Expr::Literal(Value::Id("z".into())))),
                    lte: None,
                })
            }
            _ => m.lanes[0].setup.push(Stmt::Require {
                site: None,
                condition: Expr::Literal(Value::Bool(true)),
                code: "extra".into(),
            }),
        }
        assert!(
            validate(&project.schema, &p).iter().any(|e| e.message.contains("held_search")
                && e.rewrite.contains("term: text <=N")
                && e.rewrite.contains("global-search pager"))
        );
    }
    let people = project
        .programs
        .iter()
        .find(|p| p.name == "search.findPeople")
        .unwrap();
    for q in [1999, 2001] {
        let mut p = people.clone();
        let Stmt::Return(Expr::Scan(scan)) = &mut p.body[0] else {
            panic!("scan")
        };
        let IndexKeyExpr::WordPrefix { source_max, .. } = &mut scan.prefix[0] else {
            unreachable!()
        };
        *source_max = q;
        assert!(
            validate(&project.schema, &p)
                .iter()
                .any(|e| e.message.contains("source_max"))
        );
    }
    let mut optional = people.clone();
    optional.args.insert(
        "term".into(),
        ArgType::Optional(Box::new(ArgType::Text {
            max: 2000,
            min: 0,
            format: None,
        })),
    );
    assert!(
        validate(&project.schema, &optional)
            .iter()
            .any(|e| e.message.contains("source_max"))
    );
    let mut omitted = people.clone();
    let Stmt::Return(Expr::Scan(scan)) = &mut omitted.body[0] else {
        unreachable!()
    };
    scan.prefix.clear();
    assert!(!validate(&project.schema, &omitted).is_empty());
    let mut schema = project.schema;
    schema
        .tables
        .get_mut("people")
        .unwrap()
        .indexes
        .get_mut("byNameWords")
        .unwrap()
        .unique = true;
    assert!(crate::engine::validate_schema(&schema).is_err());
}
// Exact fcd45 compiler recipe ProjectJson, preserved as a compiler/engine boundary regression.
#[path = "../../bin/export_corpus/search_recipes.rs"]
mod recipes;
pub(crate) use recipes::RECIPES;

#[test]
fn coalesce_capture_keeps_its_original_bound_across_shadowing() {
    let mut project = project(Q_CAPTURE);
    assert!(
        validate(&project.schema, &project.programs[0])
            .iter()
            .any(|e| e.message.contains("source_max"))
    );
    // Rename-control IR: only the unused nested binding and its compiler-emitted Q differ.
    let Stmt::If { then_body, .. } = &mut project.programs[0].body[5] else {
        panic!("branch")
    };
    let Stmt::Const { name, .. } = &mut then_body[0] else {
        panic!("shadow")
    };
    *name = "renamed".into();
    let Stmt::Const {
        value: Expr::Scan(scan),
        ..
    } = &mut then_body[1]
    else {
        panic!("scan")
    };
    let IndexKeyExpr::WordPrefix { source_max, .. } = &mut scan.prefix[0] else {
        panic!("prefix")
    };
    *source_max = 2000;
    assert!(validate(&project.schema, &project.programs[0]).is_empty());
    assert!(
        Checker::new(&project.schema, Ceilings::default())
            .check_all(&project.programs[0])
            .is_ok()
    );
    // Restoring the unused shadow cannot narrow the already captured value.
    let Stmt::If { then_body, .. } = &mut project.programs[0].body[5] else {
        unreachable!()
    };
    let Stmt::Const { name, .. } = &mut then_body[0] else {
        unreachable!()
    };
    *name = "wide".into();
    assert!(validate(&project.schema, &project.programs[0]).is_empty());
}
// Exact counterexample ProjectJson SHA-256 515a150fbc8dda8f63092ed1c2f51197f80c599945576487a62d73810bdb32f3
const Q_CAPTURE: &str = r###"{"schema":{"tables":{"people":{"columns":{"id":"Id","name":{"Text":{"max":50}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byNameWords":{"components":[{"WordPrefixes":{"fields":["name"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"id"}],"unique":false}},"rules":{"read":{"Public":{"reason":"people is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"}},"maintains":[],"channels":{},"auth":{"password":false,"guests":false},"effects":[]},"programs":[{"name":"probe.probe","kind":"Query","args":{"term":{"Optional":{"Text":{"max":2000}}}},"read_time_granularity_ms":null,"body":[{"Const":{"name":"wide","value":{"Variable":"term"}}},{"Let":{"name":"__logicalLeft0","value":{"Variable":"wide"}}},{"Let":{"name":"__logicalResult1","value":{"Variable":"__logicalLeft0"}}},{"If":{"condition":{"Binary":{"op":"Eq","left":{"Variable":"__logicalLeft0"},"right":{"Literal":"Null"}}},"then_body":[{"Assign":{"name":"__logicalResult1","value":{"Literal":{"String":""}}}}],"else_body":[]}},{"Const":{"name":"original","value":{"Variable":"__logicalResult1"}}},{"If":{"condition":{"Literal":{"Bool":true}},"then_body":[{"Const":{"name":"wide","value":{"Literal":{"String":"x"}}}},{"Const":{"name":"page","value":{"Scan":{"site":"probe.probe.0","table":"people","index":"byNameWords","prefix":[{"WordPrefix":{"source":{"Variable":"original"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":1}}],"order":"Asc","take":{"Literal":20},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Computed"}}}},{"Return":{"Variable":"page"}}],"else_body":[]}},{"Return":{"Literal":"Null"}}]}],"effects":[]}"###;

#[test]
fn exact_emitted_coalesce_and_object_controls_keep_capture_time_q() {
    for raw in CAPTURE_CONTROLS {
        let mut p = project(raw);
        Checker::new(&p.schema, Ceilings::default())
            .check_all(&p.programs[0])
            .unwrap();
        // Same exact captured expression, with only its asserted bound forged.
        let branch = p.programs[0]
            .body
            .iter_mut()
            .rev()
            .find_map(|s| match s {
                Stmt::If { then_body, .. } => Some(then_body),
                _ => None,
            })
            .unwrap();
        let Stmt::Const {
            value: Expr::Scan(scan),
            ..
        } = &mut branch[0]
        else {
            panic!("scan")
        };
        let IndexKeyExpr::WordPrefix { source_max, .. } = &mut scan.prefix[0] else {
            panic!("prefix")
        };
        *source_max = 1;
        let errors = Checker::new(&p.schema, Ceilings::default())
            .check_all(&p.programs[0])
            .unwrap_err();
        assert!(
            errors.iter().any(|e| e.message.contains("source_max")),
            "{errors:?}"
        );
    }
}
const CAPTURE_CONTROLS: &[&str] = &[
    // minimal-coalesce-other-true.json full input SHA256 1b5dbf4a49b5fd46a481a249a610c7fa852aac11066813f988908c539dd19802
    r###"{"schema":{"tables":{"people":{"columns":{"id":"Id","name":{"Text":{"max":50}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byNameWords":{"components":[{"WordPrefixes":{"fields":["name"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"id"}],"unique":false}},"rules":{"read":{"Public":{"reason":"people is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"}},"maintains":[],"channels":{},"auth":{"password":false,"guests":false},"effects":[]},"programs":[{"name":"probe.probe","kind":"Query","args":{"term":{"Optional":{"Text":{"max":2000}}}},"read_time_granularity_ms":null,"body":[{"Const":{"name":"wide","value":{"Variable":"term"}}},{"Let":{"name":"__logicalLeft0","value":{"Variable":"wide"}}},{"Let":{"name":"__logicalResult1","value":{"Variable":"__logicalLeft0"}}},{"If":{"condition":{"Binary":{"op":"Eq","left":{"Variable":"__logicalLeft0"},"right":{"Literal":"Null"}}},"then_body":[{"Assign":{"name":"__logicalResult1","value":{"Literal":{"String":""}}}}],"else_body":[]}},{"Const":{"name":"original","value":{"Variable":"__logicalResult1"}}},{"If":{"condition":{"Literal":{"Bool":true}},"then_body":[{"Const":{"name":"page","value":{"Scan":{"site":"probe.probe.0","table":"people","index":"byNameWords","prefix":[{"WordPrefix":{"source":{"Variable":"original"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":2000}}],"order":"Asc","take":{"Literal":20},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Computed"}}}},{"Const":{"name":"other","value":{"Literal":{"String":"x"}}}},{"Return":{"Variable":"page"}}],"else_body":[]}},{"Return":{"Literal":"Null"}}]}],"effects":[]}"###,
    // minimal-coalesce-wide-true.json full input SHA256 3de58350c8a95e6612edfcc46745a99e47119ce93cb8404ae2365ba4c3a063bb
    r###"{"schema":{"tables":{"people":{"columns":{"id":"Id","name":{"Text":{"max":50}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byNameWords":{"components":[{"WordPrefixes":{"fields":["name"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"id"}],"unique":false}},"rules":{"read":{"Public":{"reason":"people is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"}},"maintains":[],"channels":{},"auth":{"password":false,"guests":false},"effects":[]},"programs":[{"name":"probe.probe","kind":"Query","args":{"term":{"Optional":{"Text":{"max":2000}}}},"read_time_granularity_ms":null,"body":[{"Const":{"name":"wide","value":{"Variable":"term"}}},{"Let":{"name":"__logicalLeft0","value":{"Variable":"wide"}}},{"Let":{"name":"__logicalResult1","value":{"Variable":"__logicalLeft0"}}},{"If":{"condition":{"Binary":{"op":"Eq","left":{"Variable":"__logicalLeft0"},"right":{"Literal":"Null"}}},"then_body":[{"Assign":{"name":"__logicalResult1","value":{"Literal":{"String":""}}}}],"else_body":[]}},{"Const":{"name":"original","value":{"Variable":"__logicalResult1"}}},{"If":{"condition":{"Literal":{"Bool":true}},"then_body":[{"Const":{"name":"page","value":{"Scan":{"site":"probe.probe.0","table":"people","index":"byNameWords","prefix":[{"WordPrefix":{"source":{"Variable":"original"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":2000}}],"order":"Asc","take":{"Literal":20},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Computed"}}}},{"Const":{"name":"wide","value":{"Literal":{"String":"x"}}}},{"Return":{"Variable":"page"}}],"else_body":[]}},{"Return":{"Literal":"Null"}}]}],"effects":[]}"###,
    // minimal-object-other-true.json full input SHA256 86957aa42b2a0b6f661baf465824561654adfaddb4e009a35b932551be2044df
    r###"{"schema":{"tables":{"people":{"columns":{"id":"Id","name":{"Text":{"max":50}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byNameWords":{"components":[{"WordPrefixes":{"fields":["name"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"id"}],"unique":false}},"rules":{"read":{"Public":{"reason":"people is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"}},"maintains":[],"channels":{},"auth":{"password":false,"guests":false},"effects":[]},"programs":[{"name":"probe.probe","kind":"Query","args":{"term":{"Text":{"max":2000}}},"read_time_granularity_ms":null,"body":[{"Const":{"name":"wide","value":{"Variable":"term"}}},{"Const":{"name":"original","value":{"Field":{"base":{"Object":{"text":{"Variable":"wide"}}},"name":"text"}}}},{"If":{"condition":{"Literal":{"Bool":true}},"then_body":[{"Const":{"name":"page","value":{"Scan":{"site":"probe.probe.0","table":"people","index":"byNameWords","prefix":[{"WordPrefix":{"source":{"Variable":"original"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":2000}}],"order":"Asc","take":{"Literal":20},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Arg"}}}},{"Const":{"name":"other","value":{"Literal":{"String":"x"}}}},{"Return":{"Variable":"page"}}],"else_body":[]}},{"Return":{"Literal":"Null"}}]}],"effects":[]}"###,
    // minimal-object-wide-true.json full input SHA256 6bcf3a8af089ae29d85e65d92e5a315ea84a552313886d3ce0bdd33f2c80c331
    r###"{"schema":{"tables":{"people":{"columns":{"id":"Id","name":{"Text":{"max":50}}},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true},"byNameWords":{"components":[{"WordPrefixes":{"fields":["name"],"contract":"u17-nfc-scf-nfc-wsp-p"}},{"Column":"id"}],"unique":false}},"rules":{"read":{"Public":{"reason":"people is public in Quarry"}},"insert":"Deny","update":"Deny","delete":"Deny"},"constraints":[],"retain":"until-revoked"}},"maintains":[],"channels":{},"auth":{"password":false,"guests":false},"effects":[]},"programs":[{"name":"probe.probe","kind":"Query","args":{"term":{"Text":{"max":2000}}},"read_time_granularity_ms":null,"body":[{"Const":{"name":"wide","value":{"Variable":"term"}}},{"Const":{"name":"original","value":{"Field":{"base":{"Object":{"text":{"Variable":"wide"}}},"name":"text"}}}},{"If":{"condition":{"Literal":{"Bool":true}},"then_body":[{"Const":{"name":"page","value":{"Scan":{"site":"probe.probe.0","table":"people","index":"byNameWords","prefix":[{"WordPrefix":{"source":{"Variable":"original"},"contract":"u17-nfc-scf-nfc-wsp-p","source_max":2000}}],"order":"Asc","take":{"Literal":20},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Arg"}}}},{"Const":{"name":"wide","value":{"Literal":{"String":"x"}}}},{"Return":{"Variable":"page"}}],"else_body":[]}},{"Return":{"Literal":"Null"}}]}],"effects":[]}"###,
];

#[path = "capture_cases.rs"]
mod capture_cases;
#[test]
fn exact_literal_usage_and_tuple_lowering_bind_actual_ir_not_source_intent() {
    for (name, bad, raw) in capture_cases::CASES {
        let p = project(raw);
        let errors = validate(&p.schema, &p.programs[0]);
        assert_eq!(
            errors.iter().any(|e| e.message.contains("source_max")),
            *bad,
            "{name}: {errors:?}"
        );
        if !bad {
            Checker::new(&p.schema, Ceilings::default())
                .check_all(&p.programs[0])
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        }
    }
}
