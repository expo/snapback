use super::*;
#[path = "search_recipes.rs"]
mod recipes;
pub(super) fn add(cases: &mut Vec<CorpusCase>) {
    let project: serde_json::Value = serde_json::from_str(recipes::RECIPES).unwrap();
    let schema: Schema = serde_json::from_value(project["schema"].clone()).unwrap();
    let programs: Vec<Program> = serde_json::from_value(project["programs"].clone()).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for (i, c) in ["c1", "c2"].into_iter().enumerate() {
        engine
            .seed("conversations", row([("id", id(c)), ("title", text(c))]))
            .unwrap();
        engine
            .seed(
                "memberships",
                row([
                    ("id", id(&format!("member-{c}"))),
                    ("conversation", id(c)),
                    ("principal", id("alice")),
                ]),
            )
            .unwrap();
        for j in 0..24 {
            engine
                .seed(
                    "messages",
                    row([
                        ("id", id(&format!("m{i}-{j:02}"))),
                        ("conversation", id(c)),
                        (
                            "body",
                            if j % 2 == 0 {
                                text("CAFÉ cafe\u{301}")
                            } else {
                                Value::Null
                            },
                        ),
                        ("caption", text("café")),
                        ("at", Value::Int(j * 2 + i as i64)),
                    ]),
                )
                .unwrap();
        }
    }
    for (name, handle) in [
        ("Élodie", Value::Null),
        ("STRASSE", text("Straße")),
        ("漢字", Value::Null),
    ] {
        engine
            .seed(
                "people",
                row([("id", id(name)), ("name", text(name)), ("handle", handle)]),
            )
            .unwrap();
    }
    for (name, op, term) in [
        ("search-held-global-first-page", "search.global", "CA"),
        (
            "search-chat-optional-field-union",
            "search.inConversation",
            "cafe\u{301}",
        ),
        (
            "search-people-independent-q",
            "search.findPeople",
            "e\u{301}",
        ),
        ("search-people-simple-fold", "search.findPeople", "stras"),
        ("search-empty-is-not-wildcard", "search.findPeople", " -- "),
    ] {
        let program = programs.iter().find(|p| p.name == op).unwrap().clone();
        let mut args = BTreeMap::from([("term".into(), text(term)), ("c".into(), Value::Null)]);
        if op == "search.inConversation" {
            args.insert("conversation".into(), id("c1"));
        }
        let context = Context::query(Actor::user("alice").unwrap(), args);
        let execution = authoritative(&mut engine, &schema, &program, context.clone());
        let mut equivalent = execution.receipt.clone();
        for range in &mut equivalent.ranges {
            for atom in &mut range.prefix {
                if let snapback3_core::search_key::IndexAtom::WordPrefix(p) = atom {
                    p.source = p.source.to_lowercase();
                }
            }
        }
        let case = case_from_parts(
            name,
            "unicode-search",
            schema.clone(),
            program.clone(),
            context.clone(),
            equivalent,
            vec![],
            None,
            None,
        );
        assert_eq!(
            case.expected.local_result,
            Some(execution.result.clone()),
            "{name}"
        );
        assert!(
            case.expected.partial_sites.is_empty(),
            "{name}: {:?}",
            case.expected.partial_sites
        );
        cases.push(case);
        if let Some(next) = execution.next {
            let mut context = context;
            context.args.insert("c".into(), text(&next));
            let second = authoritative(&mut engine, &schema, &program, context.clone());
            cases.push(case_from_parts(
                &format!("{name}-next"),
                "unicode-search",
                schema.clone(),
                program,
                context,
                second.receipt,
                vec![],
                None,
                None,
            ));
        }
    }
}
