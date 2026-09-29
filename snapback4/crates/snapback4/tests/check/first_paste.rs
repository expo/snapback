use super::*;

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
