use snapback4_lang::compile;

fn bound(predicate: &str) -> snapback4_lang::Bound {
    let source = format!("table referees:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable orders:\n  turn: id\n  owner: principal\n  sealed: bool default true\n  cap 100 by turn\n  read <- .owner = viewer or (exists referees[viewer] and {predicate})\n  online only\nquery refereeOrders(turn: id):\n  require exists referees[viewer] else REFEREE_ONLY\n  return orders where .turn = turn and .sealed = false first 100 by .id\n");
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    bound
}

#[test]
fn boolean_spelling_is_normalized_before_completeness_pins() {
    let bare_not = bound("not .sealed");
    let equality = bound(".sealed = false");
    let completeness = |bound: &snapback4_lang::Bound| bound.notes.iter()
        .filter(|note| matches!(note.code.as_str(), "N_NEVER_COMPLETE" | "N_CONDITIONAL_COMPLETE"))
        .map(|note| note.code.clone()).collect::<Vec<_>>();
    assert_eq!(completeness(&bare_not), completeness(&equality));
    assert!(completeness(&bare_not).is_empty(), "not .sealed must plan the same false pin: {:#?}", bare_not.notes);
}

#[test]
fn unsupported_renderer_does_not_claim_that_no_branched_query_exists() {
    let source = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable posts:\n  owner: principal\n  published: bool\n  at: int\n  read <- .owner = viewer or (exists staff[viewer] and .published)\n  online only\nquery feed():\n  return posts where .at + 1 > 0 first 20 by .id\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let note = bound.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").expect("a single-scan completeness note");
    assert!(note.message.contains("no verified complete form for this read"), "{note}");
    assert!(note.rewrite.contains("This does not rule out an author-written branched query"), "{note}");
    assert!(!note.message.contains("no single complete form") && !note.rewrite.contains("no single complete form"), "{note}");
}
