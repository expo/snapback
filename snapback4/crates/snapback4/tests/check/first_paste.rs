use super::*;

#[test]
fn failing_check_keeps_the_terse_prediction_reason() {
    let project = Project::new();
    project.source(&format!("{}\nquery broken():\n  return missingName\n", include_str!("../../../snapback4-lang/tests/fixtures/ag/upsert.q").replace("  sync\nview reactionCounts", "  sync last 2 by .id\nview reactionCounts")));
    for flags in [vec!["check"], vec!["check", "--verbose"]] {
        let output = project.run(&flags);
        assert!(!output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("insert arms"), "{text}");
    }
    assert_eq!(parsed(&project.run(&["check", "--json"]))["ok"], false);
}

#[test]
fn read_through_upsert_has_no_obsolete_server_only_note() {
    let project = Project::new();
    project.source("table parents:\n  public\n  sync public\ntable children:\n  parent: parents\n  owner: principal\n  body: text\n  immutable parent\n  unique parent, owner\n  cap 50 by parent\n  read through .parent\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  sync\nmutation save(parent: parents, body: text):\n  return upsert children[parent, viewer] { body }\n");
    for flags in [vec!["why", "save"], vec!["check"], vec!["check", "--verbose"], vec!["check", "--residency"]] {
        let output = project.run(&flags);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(!text.contains("upsert on a read-through child queues without a row"), "{text}");
        assert!(!text.contains("reads online-only table children"), "{text}");
        assert!(!text.contains("Read-through upserts: explicit insert/update"), "{text}");
        assert!(!text.contains("N_NOT_PREDICTABLE"), "{text}");
    }
}

#[test]
fn terse_check_counts_and_explains_search_behavior_warnings() {
    let project = Project::new();
    let schema = r#"
table members:
  conversation: id
  principal: principal
  unique conversation, principal
  read <- exists members[.conversation, viewer]
table messages:
  conversation: id
  text: text <=4000
  at: time
  search text
  by byWords: conversation, words(text), at, id
  read <- exists members[.conversation, viewer]
fn peers(chat: id):
  return members[conversation = chat] first 50 by .id
"#;
    for (read, codes) in [
        ("messages matching q where exists members[.conversation, viewer] last 20 by .at after c",
            vec!["N_SEARCH_WORDS", "N_SEARCH_OPEN"]),
        ("messages matching q last 20 by .at after c",
            vec!["N_SEARCH_UNSCOPED", "N_SEARCH_WORDS"]),
        ("messages matching q where exists members[.conversation, viewer] last 20 by .at after c { *, peers: peers(.conversation) }",
            vec!["N_SEARCH_WORDS", "N_SEARCH_OPEN", "N_SEARCH_SHAPE"]),
        ("merge messages matching q after c last 20 by byWords:\n    [m.conversation] for m in members[principal = viewer] first 100 by .conversation",
            vec!["N_SEARCH_WORDS"]),
    ] {
        project.source(&format!("{schema}\nquery search(q: text <=100, c: cursor ?):\n  return {read}\n"));
        let json = parsed(&project.run(&["check", "--json"]));
        let notes = json["notes"].as_array().unwrap().len() + json["search"].as_array().unwrap().len();
        for flags in [vec!["check"], vec!["check", "--cost"], vec!["check", "--residency"], vec!["check", "--verbose"]] {
            let output = project.run(&flags);
            assert!(output.status.success(), "{output:?}");
            let text = String::from_utf8(output.stdout).unwrap();
            assert!(text.lines().next().unwrap().contains(&format!(", {notes} note")), "{text}");
            for code in &codes {
                let line = text.lines().find(|line| line.contains(code)).unwrap_or_else(|| panic!("missing {code}: {text}"));
                if *code == "N_SEARCH_OPEN" {
                    assert!(line.contains("E_SEARCH_OPEN") && line.contains("without a continuation"), "{line}");
                }
                if *code == "N_SEARCH_WORDS" && read.starts_with("merge") {
                    assert!(line.contains("incomplete") && line.contains("heap-null") && line.contains("without next"), "{line}");
                }
                assert_eq!(line.contains("rewrite:"), flags.contains(&"--verbose"), "{line}");
            }
        }
        let mut verbose = parsed(&project.run(&["check", "--verbose", "--json"]));
        let mut json = json;
        verbose.as_object_mut().unwrap().remove("ms"); json.as_object_mut().unwrap().remove("ms");
        assert_eq!(json, verbose);
    }
}

#[test]
fn cal25_check_is_verdict_first_and_ephemeral_indexes_are_presented() {
    let project = Project::new();
    project.source("table typing:\n  room: id\n  principal: principal\n  unique room, principal\n  cap 50 by room\n  read <- allow\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  ephemeral 4s\nmutation setTyping(room: id):\n  upsert typing[room, viewer] {}\nquery typingIn(room: id):\n  return typing where .room = room\n");
    for flags in [vec!["check"], vec!["check", "--verbose"], vec!["check", "--residency"]] {
        let output = project.run(&flags);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.starts_with("check: ok"), "{text}");
        if flags.contains(&"--verbose") {
            assert!(text.contains("fails offline and is not queued"), "{text}");
            assert!(text.contains("write typing"), "{text}");
        } else { assert!(!text.contains("$intent:"), "{text}"); }
    }
    let ordinary = project.run(&["check", "--json"]);
    let verbose = project.run(&["check", "--verbose", "--json"]);
    let mut a = parsed(&ordinary); let mut b = parsed(&verbose);
    a.as_object_mut().unwrap().remove("ms"); b.as_object_mut().unwrap().remove("ms");
    assert_eq!(a, b, "verbose is only a text presentation choice");
    assert!(a.get("predictionSummary").is_some() && a.get("notes").is_some());
}

#[test]
fn first_attempt_unambiguous_rule_and_shape_repairs_apply_in_check_fix() {
    let project = Project::new();
    for (source, repair) in [
        (include_str!("../../../snapback4-lang/tests/fixtures/ag/rule-hop.q"), "-- reactionCounts inherits read through reactions.message"),
        (include_str!("../../../snapback4-lang/tests/fixtures/ag/shape-on.q"), "shape messageObject = { body }"),
    ] {
        project.source(source);
        let original = project.run(&["check"]);
        assert!(!original.status.success());
        assert!(String::from_utf8_lossy(&original.stderr).starts_with("check: "));
        let output = project.run(&["check", "--fix"]);
        assert!(output.status.success(), "{output:?}");
        let fixed = fs::read_to_string(project.0.join("snapback/schema.q")).unwrap();
        assert!(fixed.contains(repair), "{fixed}");
        assert!(project.run(&["check"]).status.success());
    }
}

#[test]
fn no_fix_silently_removes_a_preview_or_changes_query_residency() {
    let project = Project::new();
    for source in [include_str!("../../../snapback4-lang/tests/fixtures/ag/bound.q"), include_str!("../../../snapback4-lang/tests/fixtures/ag/name.q")] {
        project.source(source);
        project.run(&["check", "--fix"]);
        assert_eq!(fs::read_to_string(project.0.join("snapback/schema.q")).unwrap(), source);
    }
}

mod qx_fixture { include!("../../../snapback4-lang/tests/membership_paths/fixture.rs"); }
#[test]
fn membership_paths_keep_check_residency_output() {
    for depth in [2, 3] { for keep in [false, true] { for horizon in [false, true] {
        let mut outputs = Vec::new();
        for sugar in [false, true] {
            let project = Project::new();
            project.source(&qx_fixture::source(depth, sugar, keep, horizon, "conversation"));
            let output = project.run(&["check", "--residency", "--verbose"]);
            assert!(output.status.success(), "{output:?}");
            let text = String::from_utf8(output.stdout).unwrap();
            // The first line carries nondeterministic elapsed milliseconds.
            outputs.push(text.lines().enumerate().map(|(i, line)| if i == 0 { line.rsplit_once(", ").unwrap().0 } else { line }).collect::<Vec<_>>().join("\n"));
        }
        assert_eq!(outputs[0], outputs[1]);
    }}}
}
