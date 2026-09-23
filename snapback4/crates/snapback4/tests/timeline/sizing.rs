use super::common::*;
use snapback4_core::{Engine, WriteState, schema::Constraint, value::object};
use snapback4_lang::recipe::{self, FollowingCaps, bridge::Mapping};
use std::{fs, path::PathBuf, process::Command};

fn source(clause: &str, edges: u32) -> String {
    format!("{}{DECLARATION}{clause}", APP.replace("  cap 100000\n", &format!("  cap {edges}\n")))
}

#[test]
fn sizing_values_and_bounds_are_exactly_the_recipe_parser() {
    for (authors, edges) in [
        (None, None), (Some("1008"), None), (None, Some("5921")),
        (Some("1008"), Some("5921")), (Some("50"), Some("1000")),
        (Some("1"), Some("31")), (Some("1"), Some("32")),
        (Some("50"), Some("50000")), (Some("50"), Some("50001")),
        (Some("134217727"), Some("4294967295")), (Some("134217728"), Some("1")),
        (Some("0"), None), (None, Some("0")), (Some("4294967296"), None),
        (Some("-1"), None), (None, Some("+2")), (Some("1.5"), None),
        (Some("nope"), None), (Some("1e3"), None), (Some("1_008"), None),
        (Some("'1008'"), None), (Some("0001008"), Some("0005921")),
    ] {
        let expected = FollowingCaps::parse(authors, edges);
        let keys = authors.map(|v| format!("authors {v}")).into_iter()
            .chain(edges.map(|v| format!("edges {v}"))).collect::<Vec<_>>();
        let clause = if keys.is_empty() { String::new() } else { format!("  size {}\n", keys.join(", ")) };
        let (doc, diagnostics) = snapback4_lang::parse_document("schema.q", &format!("{DECLARATION}{clause}"));
        match expected {
            Ok(caps) => { assert!(diagnostics.is_empty(), "{clause}: {diagnostics:?}"); assert_eq!(doc.timelines[0].size, caps); }
            Err(_) => {
                let d = diagnostics.iter().find(|d| d.code == "E_TIMELINE_SIZE").unwrap_or_else(|| panic!("{clause}: {diagnostics:?}"));
                assert_eq!(d.guide, "feeds"); assert!(!d.rewrite.is_empty());
            }
        }
    }
    for clause in ["size", "size authors", "size authors 1008,", "size authors 1008, authors 1009", "size events 1008", "size authors 1008 edges 5921"] {
        let (_, errors) = snapback4_lang::parse_document("schema.q", &format!("{DECLARATION}  {clause}\n"));
        assert!(errors.iter().any(|d| d.code == "E_TIMELINE_SIZE"), "{clause}: {errors:?}");
    }
}

#[test]
fn expansion_admission_profile_note_and_default_encoding() {
    let default = compile(&source("", 100000)).schema;
    let explicit = compile(&source("  size edges 100000, authors 1000\n", 100000)).schema;
    assert_eq!(default, explicit);
    let encoded = serde_json::to_string(&default.timelines[0]).unwrap();
    assert!(!encoded.contains("author_cap") && !encoded.contains("edge_cap"));
    let decoded: snapback4_core::schema::timeline::Timeline = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, default.timelines[0]);
    for (a, e, backfill) in [(50, 1000, 200), (201, 1000, 201), (864, 5921, 864), (865, 5921, 865), (1008, 5921, 865)] {
        let text = source(&format!("  size edges {e}, authors {a}\n"), e);
        let b = compile(&text); let t = &b.schema.timelines[0];
        assert_eq!((t.author_cap, t.edge_cap, t.backfill()), (a, e, backfill));
        assert_eq!(t.backfill(), FollowingCaps::parse(Some(&a.to_string()), Some(&e.to_string())).unwrap().backfill() as usize);
        for (table, expected) in [("feedAuthors", a), ("feedPulls", a * 32), ("feedPullCounts", a * 32), ("follows", e)] {
            assert!(b.schema.tables[table].constraints.contains(&Constraint::Cap { by: vec![], max: expected }));
        }
        for cap in [a - 1, a, a + 1] {
            let app = text.replacen("  immutable principal", &format!("  cap {cap}\n  immutable principal"), 1);
            let b = compile(&app);
            let notes = b.notes.iter().filter(|d| d.code == "N_TIMELINE_PROFILE_CAP").collect::<Vec<_>>();
            assert_eq!(notes.len(), usize::from(cap < a));
            if cap < a { assert_eq!(notes[0].guide, "feeds"); assert!(notes[0].message.contains("refuse first")); }
        }
    }
    for edges in [5920, 5922, 100000] {
        let b = snapback4_lang::compile(&[("schema.q".into(), source("  size authors 1008, edges 5921\n", edges))]);
        let d = b.diagnostics.iter().find(|d| d.code == "E_TIMELINE_FOLLOWS").unwrap();
        assert_eq!(d.guide, "feeds"); assert!(d.rewrite.contains("cap 5921")); assert!(b.schema.timelines.is_empty());
    }
}

#[test]
fn sized_registration_accepts_1008_and_refuses_1009_identically() {
    let mut p = Pair::sized(1008, 5921);
    for n in 1..=1008 {
        p.register(&format!("a{n:04}"));
        if n >= 1000 { p.equal(); assert_eq!(rows(&p.declared, "feedAuthors").len(), n); }
    }
    let out = p.step("register", "a1009", &[]);
    assert!(matches!(&out[0].state, WriteState::Failed { why, .. } if why.code == "E_CONSTRAINT"));
    p.equal(); assert_eq!(rows(&p.declared, "profiles").len(), 1008);
}

#[test]
fn sized_backfill_clamps_to_200_and_865_without_changing_source_cap() {
    for (authors, edges, backfill) in [(50, 1000, 200), (1008, 5921, 865)] {
        let mut p = Pair::sized(authors, edges);
        p.register("author"); p.register("reader");
        for n in 0..1000 { p.publish("author", &format!("p{n:04}")); }
        let full = p.step("publish", "author", &[("postId", id("overflow"))]);
        assert!(matches!(&full[0].state, WriteState::Failed { why, .. } if why.code == "E_CONSTRAINT"));
        let out = p.sent("follow", "reader", &[("authorId", id("author"))]);
        assert_eq!([out[0].metered.rows_written, out[1].metered.rows_written], [backfill + 2, backfill + 1]);
        let events = p.pages("reader", "following");
        assert_eq!(events.iter().map(|r| r.field("id").unwrap().clone()).collect::<Vec<_>>(),
            (1000 - backfill..1000).rev().map(|n| id(&format!("p{n:04}"))).collect::<Vec<_>>());
        p.equal();
    }
}

#[test]
fn sized_5921_edge_cap_refuses_identically_and_rolls_back() {
    let mut p = Pair::sized(1008, 5921);
    for n in 0..200 { p.register(&format!("a{n}")); }
    // A ring of degree <=30 reaches the global bound before any endpoint or
    // promotion bound. Every edge is installed by an ordinary mutation.
    for n in 0..5921 {
        let viewer = format!("a{}", n % 200);
        let target = format!("a{}", (n % 200 + n / 200 + 1) % 200);
        for (e, writes) in [(&mut p.recipe, 2), (&mut p.declared, 1)] {
            let out = e.mutate("follow", None, context(&viewer, &[("authorId", id(&target))], p.at)).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "edge {n}: {out:?}");
            assert_eq!(out.metered.rows_written, writes); // only the duplicate recipe edge
        }
        p.at += 1;
    }
    p.equal(); assert_eq!(rows(&p.declared, "follows").len(), 5921);
    let out = p.step("follow", "a121", &[("authorId", id("a151"))]);
    assert!(matches!(&out[0].state, WriteState::Failed { why, .. } if why.code == "E_CONSTRAINT"));
    p.equal();
}

#[test]
fn sized_activation_and_redefinition_are_atomic() {
    for (authors, edges) in [(50, 1000), (1008, 5921)] {
        for count in [authors, authors + 1] {
            let b = compile(&APP.replace("  cap 100000\n", &format!("  cap {edges}\n")));
            let mut e = Engine::memory(b.schema, []).unwrap();
            e.load((0..count).map(|n| ("profiles".into(), object([("id", id(&format!("p{n}"))), ("principal", id(&format!("a{n}")))])))).unwrap();
            let before = snapshot(&e); let generation = e.generation(); let seq = e.seq().unwrap();
            let b = sized_bound(true, Some((authors, edges)));
            let result = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program));
            if count > authors {
                let error = result.unwrap_err(); assert_eq!(error.code(), "E_TIMELINE_ACTIVATE");
                assert!(error.to_string().contains(&authors.to_string()));
                assert_eq!(snapshot(&e), before); assert_eq!(e.generation(), generation);
            } else {
                result.unwrap(); assert_eq!(rows(&e, "feedAuthors").len(), authors as usize);
                let before = snapshot(&e); let generation = e.generation();
                for size in [(authors + 1, edges), (authors, edges + 1)] {
                    let b = sized_bound(true, Some(size));
                    let refusal = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err().refusal();
                    assert_eq!(refusal.code, "E_TIMELINE_REDEFINE"); assert_eq!(refusal.guide.as_deref(), Some("feeds"));
                    assert!(refusal.rewrite.unwrap().contains("first scope sizes the timeline before data exists"));
                    assert_eq!(snapshot(&e), before); assert_eq!(e.generation(), generation);
                }
            }
            assert_eq!(e.seq().unwrap(), seq, "activation emits no row events");
        }
    }
    let mut e = engine(true);
    let b = sized_bound(true, Some((1008, 5921)));
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.schema().timelines[0].author_cap, 1008);
}

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("f3c-{}-{}", std::process::id(), snapback4_core::now_ms()));
        fs::create_dir_all(path.join("snapback")).unwrap(); Self(path)
    }
}
impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

#[test]
fn cli_installs_the_sized_oracle_recipe_and_bridge_and_reports_cost() {
    let dir = Temp::new();
    let app = APP.replace("  cap 100000\n", "  cap 5921\n");
    fs::write(dir.0.join("snapback/schema.q"), &app).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir.0).args([
        "init", "--recipe", "feeds", "--prefix", "feed", "--authors", "1008", "--edges", "5921",
        "--public-profiles", "profiles:principal", "--public-posts", "posts:authorId:at",
        "--public-follows", "follows:followerId:followedId", "--public-reposts", "reposts:actorId:postId:at",
    ]).output().unwrap();
    assert!(out.status.success(), "{out:?}");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap(), recipe::following_sized("feed", "feed", FollowingCaps::parse(Some("1008"), Some("5921")).unwrap()).unwrap());
    let mapping = Mapping::parse("profiles:principal", "posts:authorId:at", "follows:followerId:followedId", "reposts:actorId:postId:at").unwrap();
    assert_eq!(fs::read_to_string(dir.0.join("snapback/feed_bridge.q")).unwrap(), mapping.render(&compile(&app).schema, "feed").unwrap());
    fs::remove_file(dir.0.join("snapback/feed.q")).unwrap(); fs::remove_file(dir.0.join("snapback/feed_bridge.q")).unwrap();
    for (a, e, bound) in [(1008, 5921, 865), (50, 1000, 200)] {
        fs::write(dir.0.join("snapback/schema.q"), format!("{}\nmutation register():\n  insert profiles {{ principal: viewer }}\nmutation follow(authorId: principal):\n  insert follows {{ followerId: viewer, followedId: authorId }} if absent\n", source(&format!("  size authors {a}, edges {e}\n"), e))).unwrap();
        let out = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir.0).args(["check", "--cost"]).output().unwrap();
        assert!(out.status.success(), "{out:?}");
        let text = String::from_utf8(out.stdout).unwrap();
        for expected in [format!("authors={a}, edges={e}, pulls={}, pullCounts={}", a * 32, a * 32), format!("backfill/author={bound}"), format!("visit newest {bound}"), format!("activation registers <={a}")] {
            assert!(text.contains(&expected), "missing {expected}: {text}");
        }
    }
}
