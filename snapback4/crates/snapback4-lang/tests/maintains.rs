const SOURCE: &str = r#"table posts:
  author: principal
  parentId: id ?
  at: time
  active: bool
  score: int
  by byAuthor: author, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only
"#;

fn compile(tail: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("maintains.q".into(), format!("{SOURCE}\n{tail}"))])
}

#[test]
fn guessed_spelling_rewrite_keeps_calendar_duration_units() {
    let b = compile("query guessed():\n  return len([day(now, 8h), bucket(now, 1d, 8h)])\n");
    assert_eq!(b.diagnostics[0].code, "E_QUARRY_UNSUPPORTED");
    let fixed = compile(&format!("query guessed():\n  return {}\n", b.diagnostics[0].rewrite));
    assert!(fixed.diagnostics.is_empty(), "rewrite {:?}: {:?}", b.diagnostics[0].rewrite, fixed.diagnostics);
}

#[test]
fn calendar_offsets_preserve_zero_forms_and_refuse_outside_the_period() {
    for (plain, zero) in [("day(.at)", "day(.at, 0ms)"), ("hour(.at)", "hour(.at, 0s)"), ("bucket(.at, 2m)", "bucket(.at, 2m, 0m)")] {
        let program = |form: &str| format!("maintain totals: count posts by author, {form}\n  read <- allow\n  online only\nquery key():\n  return {}\n", form.replace(".at", "now"));
        let a = compile(&program(plain)); let b = compile(&program(zero));
        assert!(a.diagnostics.is_empty() && b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert_eq!(serde_json::to_value(&a.schema).unwrap(), serde_json::to_value(&b.schema).unwrap());
        assert_eq!(serde_json::to_value(&a.programs[0].program).unwrap(), serde_json::to_value(&b.programs[0].program).unwrap());
        let key = &a.schema.maintains[0].computed.values().next().unwrap();
        let encoded = serde_json::to_value(key).unwrap();
        assert_eq!(encoded, serde_json::json!({"function":key.function,"column":"at","millis":key.millis}));
        assert_eq!(serde_json::from_value::<snapback4_core::maintain::CalendarKey>(encoded).unwrap(), **key);
    }
    for bad in ["day(.at, 24h)", "day(.at, -1h)", "hour(.at, 60m)", "bucket(.at, 2m, 120s)", "bucket(.at, 0m, 0s)", "day(.at, 9007199254740992ms)"] {
        let b = compile(&format!("maintain totals: count posts by author, {bad}\n  read <- allow\n  online only\n"));
        assert!(!b.diagnostics.is_empty(), "{bad}");
        assert_eq!(b.diagnostics[0].code, "E_QUARRY_MAINTAIN", "{:?}", b.diagnostics);
        assert_eq!(b.diagnostics[0].guide, "maintains");
        let b = compile(&format!("query key():\n  return {}\n", bad.replace(".at", "now")));
        assert!(!b.diagnostics.is_empty()); assert_eq!(b.diagnostics[0].code, "E_QUARRY_MAINTAIN");
    }
}

#[test]
fn maintain_filter_calendar_pages_and_rank() {
    let bound = compile(r#"maintain dailyPosts: count posts where .parentId = null and .active by author, day(.at)
  read <- allow
  online only
maintain scores: sum posts of score where not .active or .score >= 0 by author
  read <- allow
  online only
  by byCount: value, id
maintain periods: count posts by author, hour(.at), bucket(.at, 2m)
  read <- allow
  online only
query today():
  return dailyPosts[viewer, day(now)]
query days(c: cursor ?):
  return dailyPosts[viewer] after c first 7 by byGroup { day, count: .value }
query mostLiked(c: cursor ?):
  return scores after c last 10 by byCount { author, count: .value }
query timeKeys():
  return { day: day(now), hour: hour(now), bucket: bucket(now, 2m) }
"#);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
}

#[test]
fn maintain_refusals_point_to_the_expression_and_offer_a_rewrite() {
    for head in [
        "count posts where .active = viewer by author",
        "count posts where .at < now by author",
        "count posts where exists posts['a'] by author",
        "count posts where count([1]) = 1 by author",
        "count posts where .score + 1 > 0 by author",
        "count posts by day(.at), day(.at)",
        "count posts by bucket(.at, 0m)",
        "count posts by day(.parentId)",
        "count posts by id",
    ] {
        let bound = compile(&format!("maintain totals: {head}\n  read <- allow\n  online only\n"));
        assert!(!bound.diagnostics.is_empty(), "accepted {head}");
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN"), "{head}: {:?}", bound.diagnostics);
    }
}

#[test]
fn maintain_scalar_needs_the_whole_key_and_expiring_rank_is_refused() {
    let bound = compile("maintain totals: count posts by author, at\n  read <- allow\nquery short():\n  return totals[viewer]\n");
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN"), "{:?}", bound.diagnostics);
    let source = SOURCE.replace("  at: time", "  until: time\n  by byUntil: until\n  expire at .until\n  at: time");
    let bound = snapback4_lang::compile(&[("expiry.q".into(), format!("{source}\nmaintain totals: count posts by author\n  read <- allow\n  by byCount: value, id\n"))]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN_EXPIRE"), "{:?}", bound.diagnostics);
}

#[test]
fn maintain_not_negates_a_comparison_and_parentheses_group_predicates() {
    let bound = compile("maintain totals: count posts where not .parentId = null and (.active or not .score >= 0) by author\n  read <- allow\n  online only\n");
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let predicate = bound.schema.maintains[0].filter.as_ref().unwrap();
    let row = |parent, active, score| snapback4_core::value::object([
        ("parentId", parent), ("active", snapback4_core::Value::Bool(active)), ("score", snapback4_core::Value::Int(score)),
    ]);
    assert!(predicate.matches(&row(snapback4_core::Value::Id("p".into()), false, -1)));
    assert!(!predicate.matches(&row(snapback4_core::Value::Null, true, 1)));
    assert!(!predicate.matches(&row(snapback4_core::Value::Id("p".into()), false, 1)));
}

#[test]
fn maintain_identity_literals_and_scoped_rank_prefix() {
    let prefix = "maintain scoped: count posts where .author = 'alice' by author, day(.at)\n  read <- allow\n  online only\n  by byCount: author, value, id\n";
    let good = compile(&format!("{prefix}query scoped(c: cursor ?):\n  return scoped[viewer] after c last 10 by byCount\n"));
    assert!(good.diagnostics.is_empty(), "{:?}", good.diagnostics);
    let bad = compile(&format!("{prefix}query unscoped(c: cursor ?):\n  return scoped after c last 10 by byCount\n"));
    assert!(bad.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN"), "{:?}", bad.diagnostics);
}

#[test]
fn expiring_rank_rewrite_names_the_fresh_bounded_trending_recipe() {
    let source = SOURCE.replace("  at: time", "  until: time\n  by byUntil: until\n  expire at .until\n  at: time");
    let bound = snapback4_lang::compile(&[("expiry.q".into(), format!("{source}\nmaintain totals: count posts by author\n  read <- allow\n  by byCount: value, id\n"))]);
    let diagnostic = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_MAINTAIN_EXPIRE").unwrap();
    println!("{diagnostic}");
    assert_eq!(diagnostic.message, "maintain totals cannot order by value because source posts expires: live values change before the physical sweep, so stored top-N can miss a winner");
    assert_eq!(diagnostic.guide, "feeds");
    assert_eq!(diagnostic.rewrite, "use guide feeds' fresh bounded Trending recipe: sort live counts at read time, with no schedule lag or writable score table; if the candidate or contribution scan hits the meter, the ranking is incomplete");
}

#[test]
fn fresh_trending_has_no_writable_score_and_an_explicit_public_device_variant() {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter()
        .find(|s| s.contains("query rollingLikes():")).unwrap();
    let private = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(private.diagnostics.is_empty() && private.notes.is_empty());
    assert!(!private.schema.tables.contains_key("ranked"));
    assert!(private.schema.schedules.is_empty());
    for name in ["trending", "rollingLikes"] { assert_eq!(private.schema.operations[name].runs.as_deref(), Some("server")); }
    let forged = snapback4_lang::compile(&[("schema.q".into(), format!("{source}\nmutation forge(postId: posts):\n  update likeCounts[postId] {{ value: 999 }}\n"))]);
    assert!(forged.diagnostics.iter().any(|d| d.message == "likeCounts is a maintained aggregate; write its source rows instead"), "{:?}", forged.diagnostics);
    let public = source.replace("  read <- .principal = viewer", "  read <- allow")
        .replace("  sync to .principal", "  sync public").replace("  online only\n", "");
    let public = snapback4_lang::compile(&[("schema.q".into(), public)]);
    assert!(public.diagnostics.is_empty(), "{:?}", public.diagnostics);
    assert_eq!(public.notes.iter().map(|d| d.code.as_str()).collect::<Vec<_>>(), ["N_MAINTAIN_SYNCED"]);
    assert!(public.schema.tables["likes"].sync.as_ref().unwrap().horizon.is_none());
    assert!(public.schema.tables["likeCounts"].sync.is_some());
}
