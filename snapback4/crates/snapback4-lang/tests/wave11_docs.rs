//! Published authorization examples execute under their authored rules.
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::guide;
const RECIPES: &str = include_str!("../src/guide/rule_recipes.md");
fn engine(marker: &str) -> Engine {
    let source = guide::quarry(RECIPES)
        .into_iter()
        .find(|s| s.contains(marker))
        .unwrap();
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{marker}: {:?}", b.diagnostics);
    assert!(b.notes.is_empty(), "{marker}: {:?}", b.notes);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn text(s: &str) -> Value {
    Value::String(s.into())
}
fn ctx(w: &str, p: &[(&str, Value)]) -> Context {
    Context::new(
        w,
        p.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
    )
    .at(1000)
}
fn row(t: &str, p: &[(&str, Value)]) -> (String, Value) {
    (
        t.into(),
        snapback4_core::value::object(p.iter().map(|(k, v)| (*k, v.clone()))),
    )
}
fn write(e: &mut Engine, op: &str, w: &str, p: &[(&str, Value)]) -> Value {
    match e.mutate(op, None, ctx(w, p)).unwrap().state {
        WriteState::Sent { result, .. } => result,
        WriteState::Failed { why, .. } => panic!("{op}: {} {}", why.code, why.message),
    }
}
fn read(e: &mut Engine, op: &str, w: &str, p: &[(&str, Value)]) -> Value {
    e.query(op, ctx(w, p)).unwrap().data
}
fn refused(e: &mut Engine, op: &str, w: &str, p: &[(&str, Value)]) {
    assert!(matches!(
        e.mutate(op, None, ctx(w, p)).unwrap().state,
        WriteState::Failed { .. }
    ));
}
#[test]
fn clean_recipes() {
    for m in [
        "table folders:",
        "table agreements:",
        "table drafts:",
        "table tokens:",
        "table responses:",
        "table bands:",
        "table library:",
    ] {
        engine(m);
    }
}
#[test]
fn copied_audience() {
    let mut e = engine("table folders:");
    let f = write(&mut e, "addFolder", "alice", &[])
        .field("id")
        .unwrap()
        .clone();
    let r = write(
        &mut e,
        "addFile",
        "alice",
        &[("folder", f.clone()), ("title", text("private"))],
    )
    .field("id")
    .unwrap()
    .clone();
    assert_eq!(
        read(&mut e, "file", "bob", &[("file", r.clone())]),
        Value::Null
    );
    assert_eq!(
        read(&mut e, "file", "alice", &[("file", r)]).field("title"),
        Ok(&text("private"))
    );
    refused(
        &mut e,
        "addFile",
        "bob",
        &[("folder", f), ("title", text("wrong"))],
    );
}
#[test]
fn consent_revocation() {
    let mut e = engine("table agreements:");
    e.seed([row(
        "agreements",
        &[
            ("id", id("a")),
            ("owner", id("owner")),
            ("first", id("alice")),
            ("second", id("bob")),
        ],
    )])
    .unwrap();
    let p = [("agreement", id("a"))];
    write(&mut e, "consent", "alice", &p);
    refused(&mut e, "open", "owner", &p);
    write(&mut e, "consent", "bob", &p);
    write(&mut e, "open", "owner", &p);
    assert_eq!(read(&mut e, "granted", "owner", &p), Value::Bool(true));
    assert_eq!(read(&mut e, "granted", "outsider", &p), Value::Bool(false));
    write(&mut e, "withdraw", "alice", &p);
    assert_eq!(read(&mut e, "granted", "owner", &p), Value::Bool(false));
}
#[test]
fn event_reveal() {
    let mut e = engine("table drafts:");
    let d = write(&mut e, "draft", "alice", &[("body", text("secret"))])
        .field("id")
        .unwrap()
        .clone();
    refused(&mut e, "reveal", "bob", &[("draft", d.clone())]);
    let r = write(&mut e, "reveal", "alice", &[("draft", d)])
        .field("id")
        .unwrap()
        .clone();
    assert_eq!(
        read(&mut e, "publication", "bob", &[("publication", r)]).field("body"),
        Ok(&text("secret"))
    );
}
#[test]
fn token_enrollment() {
    let mut e = engine("table tokens:");
    let secret = "012345678901234567890123456789012345";
    e.seed([
        row(
            "documents",
            &[
                ("id", id("d")),
                ("owner", id("alice")),
                ("body", text("linked")),
            ],
        ),
        row(
            "tokens",
            &[
                ("id", id("t")),
                ("document", id("d")),
                ("secret", text(secret)),
            ],
        ),
    ])
    .unwrap();
    let p = [("document", id("d"))];
    assert_eq!(read(&mut e, "document", "bob", &p), Value::Null);
    refused(
        &mut e,
        "claim",
        "bob",
        &[("secret", text("00000000000000000000000000000000"))],
    );
    write(&mut e, "claim", "bob", &[("secret", text(secret))]);
    assert_eq!(
        read(&mut e, "document", "bob", &p).field("body"),
        Ok(&text("linked"))
    );
    assert_eq!(read(&mut e, "document", "carol", &p), Value::Null);
    write(
        &mut e,
        "revokeLink",
        "service:ops",
        &[("secret", text(secret))],
    );
    refused(&mut e, "claim", "carol", &[("secret", text(secret))]);
    assert_eq!(
        read(&mut e, "document", "bob", &p).field("body"),
        Ok(&text("linked"))
    );
    write(
        &mut e,
        "revokeReader",
        "service:ops",
        &[("document", id("d")), ("principal", id("bob"))],
    );
    assert_eq!(read(&mut e, "document", "bob", &p), Value::Null);
}
#[test]
fn split_anonymity() {
    let mut e = engine("table responses:");
    let r = write(&mut e, "respond", "alice", &[("body", text("anonymous"))]);
    assert!(r.field("principal").is_err());
    let p = [("response", r.field("id").unwrap().clone())];
    assert_eq!(read(&mut e, "author", "bob", &p), Value::Null);
    assert_eq!(
        read(&mut e, "author", "alice", &p).field("principal"),
        Ok(&id("alice"))
    );
    assert_eq!(
        read(&mut e, "response", "bob", &p).field("body"),
        Ok(&text("anonymous"))
    );
}
#[test]
fn version_pointer() {
    let mut e = engine("table bands:");
    e.seed([
        row("bands", &[("id", id("b")), ("owner", id("alice"))]),
        row(
            "fans",
            &[("id", id("f")), ("band", id("b")), ("principal", id("bob"))],
        ),
        row(
            "versions",
            &[
                ("id", id("v1")),
                ("band", id("b")),
                ("owner", id("alice")),
                ("title", text("first")),
                ("cover", Value::Null),
            ],
        ),
        row(
            "versions",
            &[
                ("id", id("v2")),
                ("band", id("b")),
                ("owner", id("alice")),
                ("title", text("second")),
                ("cover", Value::Null),
            ],
        ),
    ])
    .unwrap();
    let p = [("version", id("v1"))];
    assert_eq!(read(&mut e, "version", "bob", &p), Value::Null);
    write(
        &mut e,
        "publish",
        "alice",
        &[("band", id("b")), ("version", id("v1"))],
    );
    assert_eq!(
        read(&mut e, "version", "bob", &p).field("title"),
        Ok(&text("first"))
    );
    write(
        &mut e,
        "publish",
        "alice",
        &[("band", id("b")), ("version", id("v2"))],
    );
    assert_eq!(read(&mut e, "version", "bob", &p), Value::Null);
    assert_eq!(
        read(&mut e, "version", "carol", &[("version", id("v2"))]),
        Value::Null
    );
}
#[test]
fn visitors_and_teams() {
    let mut e = engine("table library:");
    e.seed([
        row("teams", &[("id", id("t")), ("owner", id("alice"))]),
        row(
            "members",
            &[("id", id("m")), ("team", id("t")), ("principal", id("bob"))],
        ),
        row(
            "library",
            &[
                ("id", id("public")),
                ("team", id("t")),
                ("owner", id("alice")),
                ("shared", Value::Bool(true)),
                ("title", text("public")),
            ],
        ),
        row(
            "library",
            &[
                ("id", id("private")),
                ("team", id("t")),
                ("owner", id("alice")),
                ("shared", Value::Bool(false)),
                ("title", text("private")),
            ],
        ),
    ])
    .unwrap();
    assert_eq!(
        read(
            &mut e,
            "entry",
            "guest:visitor",
            &[("entry", id("private"))]
        ),
        Value::Null
    );
    assert_eq!(
        read(&mut e, "entry", "guest:visitor", &[("entry", id("public"))]).field("title"),
        Ok(&text("public"))
    );
    assert_eq!(
        read(&mut e, "entry", "bob", &[("entry", id("private"))]).field("title"),
        Ok(&text("private"))
    );
    for (op, who, p, count) in [
        ("mine", "alice", vec![("c", Value::Null)], 2),
        (
            "publicLibrary",
            "guest:visitor",
            vec![("c", Value::Null)],
            1,
        ),
        (
            "teamLibrary",
            "bob",
            vec![("team", id("t")), ("c", Value::Null)],
            2,
        ),
    ] {
        let page = e.query(op, ctx(who, &p)).unwrap();
        assert!(page.complete, "{op}: all intended rows are known");
        assert_eq!(page.data.as_array().unwrap().len(), count);
    }
}

const PRODUCTION: &str = include_str!("../src/guide/production.md");
#[test]
fn production_accounts_enroll_privately_and_survive_rollback() {
    let source = guide::quarry(PRODUCTION).remove(0);
    let compile = |source: String| {
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert!(b.notes.is_empty(), "{:?}", b.notes);
        b
    };
    let first = compile(source.clone());
    let mut e =
        Engine::memory(first.schema, first.programs.into_iter().map(|p| p.program)).unwrap();
    let mut entropy = 1234;
    let alice = snapback4_core::identity::signup(
        e.store(),
        "alice@example.test",
        "private-password",
        1000,
        &mut entropy,
    )
    .unwrap();
    let bob = snapback4_core::identity::signup(
        e.store(),
        "bob@example.test",
        "private-password",
        1000,
        &mut entropy,
    )
    .unwrap();
    write(
        &mut e,
        "register",
        &alice.principal,
        &[("displayName", text("Alice"))],
    );
    write(
        &mut e,
        "register",
        &bob.principal,
        &[("displayName", text("Bob"))],
    );
    refused(
        &mut e,
        "grantStaff",
        &bob.principal,
        &[("principal", id(&bob.principal))],
    );
    write(
        &mut e,
        "grantStaff",
        "service:ops",
        &[("principal", id(&alice.principal))],
    );
    refused(
        &mut e,
        "provisionCatalogue",
        &bob.principal,
        &[("slug", text("standard")), ("label", text("Unauthorized"))],
    );
    write(
        &mut e,
        "provisionCatalogue",
        "service:ops",
        &[("slug", text("standard")), ("label", text("Standard"))],
    );
    assert_eq!(e.store().rows("catalogues").unwrap().len(), 1);
    assert_eq!(
        read(&mut e, "catalogue", &bob.principal, &[("c", Value::Null)])
            .as_array()
            .unwrap()[0]
            .field("label"),
        Ok(&text("Standard"))
    );
    let team = write(
        &mut e,
        "createTeam",
        &alice.principal,
        &[("name", text("Production"))],
    )
    .field("id")
    .unwrap()
    .clone();
    write(
        &mut e,
        "enroll",
        &alice.principal,
        &[("team", team.clone()), ("principal", id(&bob.principal))],
    );
    refused(
        &mut e,
        "enroll",
        &bob.principal,
        &[("team", team.clone()), ("principal", id(&bob.principal))],
    );
    let directory = e.query("directory", ctx(&bob.principal, &[("c", Value::Null)]));
    assert_eq!(directory.unwrap_err().code, "NOT_STAFF");
    let directory = read(&mut e, "directory", &alice.principal, &[("c", Value::Null)]);
    assert_eq!(directory.as_array().unwrap().len(), 2);
    assert_eq!(
        read(
            &mut e,
            "teammates",
            &bob.principal,
            &[("team", team), ("c", Value::Null)]
        )
        .as_array()
        .unwrap()
        .len(),
        1
    );
    let upgraded = source.replace(
        "  displayName: text 1..80",
        "  displayName: text 1..80\n  bio: text <=80 ?",
    ) + "\nmutation setBio(bio: text <=80):\n  return update profiles[principal = viewer] { bio }\n";
    let v2 = compile(upgraded.clone());
    e.adopt_release(
        v2.schema,
        v2.programs.into_iter().map(|p| p.program),
        &snapback4_core::engine::release::ReleaseActivation::new(2, None),
        false,
    )
    .unwrap();
    write(
        &mut e,
        "setBio",
        &alice.principal,
        &[("bio", text("Restored on forward"))],
    );
    // Exercise a real account session against the adopted generation.
    let result = e
        .mutate(
            "register",
            None,
            ctx(&alice.principal, &[("displayName", text("Alice Updated"))])
                .with_session(&alice.token),
        )
        .unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }));
    let v1 = compile(source);
    e.adopt_release(
        v1.schema,
        v1.programs.into_iter().map(|p| p.program),
        &snapback4_core::engine::release::ReleaseActivation::new(1, Some(2)),
        false,
    )
    .unwrap();
    assert_eq!(
        read(&mut e, "myProfile", &alice.principal, &[]).field("displayName"),
        Ok(&text("Alice Updated"))
    );
    let login =
        snapback4_core::identity::login(e.store(), "alice@example.test", "private-password", 1001)
            .unwrap();
    assert_eq!(login.principal, alice.principal);
    let v2 = compile(upgraded);
    e.adopt_release(
        v2.schema,
        v2.programs.into_iter().map(|p| p.program),
        &snapback4_core::engine::release::ReleaseActivation::new(2, Some(1)),
        false,
    )
    .unwrap();
    assert_eq!(
        read(&mut e, "myProfile", &alice.principal, &[]).field("displayName"),
        Ok(&text("Alice Updated"))
    );
    assert_eq!(
        read(&mut e, "myProfile", &alice.principal, &[]).field("bio"),
        Ok(&text("Restored on forward"))
    );
}

#[test]
fn service_seat_program_probes_need_the_explicit_read_branch() {
    let source = guide::quarry(guide::card("deploy").unwrap()).remove(0)
        + "\nquery probe(principal: principal):\n  return exists admins[principal = principal]\n";
    for (schema, expected) in [
        (source.clone(), true),
        (
            source.replace(
                "read <- .principal = viewer or viewer = 'service:ops'",
                "read <- .principal = viewer",
            ),
            false,
        ),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), schema)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        write(
            &mut e,
            "grantAdmin",
            "service:ops",
            &[("principal", id("user:alice"))],
        );
        assert_eq!(
            read(
                &mut e,
                "probe",
                "service:ops",
                &[("principal", id("user:alice"))]
            ),
            Value::Bool(expected)
        );
    }
}

#[test]
fn twice_written_row_returns_the_bound_snapshot_not_the_last_image() {
    let source = "table records:\n  body: text <=80\n  public 'snapshot test'\n  insert <- allow\n  update <- allow\n  online only\nmutation original():\n  r = insert records { body: 'before' }\n  update records[r.id] { body: 'after' }\n  return r\nquery record(record: records):\n  return records[record]\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.is_empty(), "{:?}", b.notes);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let returned = write(&mut e, "original", "alice", &[]);
    assert_eq!(returned.field("body"), Ok(&text("before")));
    let stored = read(
        &mut e,
        "record",
        "alice",
        &[("record", returned.field("id").unwrap().clone())],
    );
    assert_eq!(stored.field("body"), Ok(&text("after")));
}
