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
fn maintain_prefix_needs_a_bound_and_expiring_rank_is_refused() {
    let bound = compile("maintain totals: count posts by author, at\n  read <- allow\nquery short():\n  return totals[viewer]\n");
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"), "{:?}", bound.diagnostics);
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
fn expiring_rank_rewrite_routes_by_window_intent() {
    let source = SOURCE.replace("  at: time", "  until: time\n  by byUntil: until\n  expire at .until\n  at: time");
    let bound = snapback4_lang::compile(&[("expiry.q".into(), format!("{source}\nmaintain totals: count posts by author\n  read <- allow\n  by byCount: value, id\n"))]);
    let diagnostic = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_MAINTAIN_EXPIRE").unwrap();
    println!("{diagnostic}");
    assert_eq!(diagnostic.message, "maintain totals cannot order by value because source posts expires: stored order is stale before the physical sweep, so taking stored top-N can miss a live winner; a count upper-bound threshold scan is not built");
    assert_eq!(diagnostic.guide, "feeds");
    assert_eq!(diagnostic.rewrite, "for a window over the entity's own immutable time, use guide feeds' hour-lanes Trending over a non-expiring source; for contributions arriving in the window, use its live bounded rollingLikes read: a candidate or contribution scan cut makes the ranking incomplete");
}

#[test]
fn fresh_trending_has_no_writable_score_and_an_explicit_public_device_variant() {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter()
        .find(|s| s.contains("query rollingLikes():")).unwrap();
    let private = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(private.diagnostics.is_empty() && private.notes.is_empty());
    assert!(!private.schema.tables.contains_key("ranked"));
    assert!(private.schema.schedules.is_empty());
    for name in ["rollingLikes"] { assert_eq!(private.schema.operations[name].runs.as_deref(), Some("server")); }
    let forged = snapback4_lang::compile(&[("schema.q".into(), format!("{source}\nmutation forge(postId: posts):\n  update likeCounts[postId] {{ value: 999 }}\n"))]);
    assert!(forged.diagnostics.iter().any(|d| d.message == "likeCounts is a maintained aggregate; write its source rows instead"), "{:?}", forged.diagnostics);
    let horizon = private.schema.tables["posts"].sync.as_ref().unwrap().horizon.as_ref().unwrap();
    assert_eq!((horizon.last, horizon.by.as_str()), (2000, "byTime"));
    let public = source.replace("  read <- .principal = viewer", "  read <- allow")
        .replace("  sync to .principal", "  sync public").replace("  online only\n", "")
        .replace("  sync public last 2000 by byTime", "  sync public");
    let public = snapback4_lang::compile(&[("schema.q".into(), public)]);
    assert!(public.diagnostics.is_empty(), "{:?}", public.diagnostics);
    assert_eq!(public.notes.iter().map(|d| d.code.as_str()).collect::<Vec<_>>(), ["N_MAINTAIN_SYNCED"]);
    assert!(public.schema.tables["posts"].sync.as_ref().unwrap().horizon.is_none());
    assert!(public.schema.tables["likes"].sync.as_ref().unwrap().horizon.is_none());
    assert!(public.schema.tables["likeCounts"].sync.is_some());
}

#[test]
fn w14a_hour_lanes_are_the_first_trending_answer() {
    let feeds = snapback4_lang::guide::card("feeds").unwrap();
    let first = feeds.split("## Trending:").nth(1).unwrap();
    assert!(first.starts_with(" posts younger than a day, ranked in the like's own transaction"));
    let source = snapback4_lang::guide::quarry(first).into_iter().next().unwrap();
    assert!(source.contains("maintain trend: count likes by hour(.postAt), postAt, postId"));
    assert!(source.contains("insert <- .principal = viewer and exists posts[id = .postId, at = .postAt]"));
    assert!(source.contains("immutable postId, principal, postAt"));
    assert!(source.contains("unique byPair: postId, principal"));
    assert!(source.contains("delete <- .principal = viewer"));
    assert_eq!(source.lines().filter(|line| line.starts_with("mutation ")).collect::<Vec<_>>(),
        ["mutation create(body: text <=500):", "mutation setLike(postId: posts, liked: bool):"]);
    assert_eq!(source.matches("[h] for h in range(hour(now) - 24, hour(now) + 1)").count(), 2);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert!(bound.schema.schedules.is_empty());
    assert_eq!(bound.schema.operations["trending"].runs.as_deref(), Some("server"));
    let forged = snapback4_lang::compile(&[("schema.q".into(), format!("{source}\nmutation forge():\n  update trend[0, 0, 'p'] {{ value: 999 }}\n"))]);
    assert!(forged.diagnostics.iter().any(|d| d.message == "trend is a maintained aggregate; write its source rows instead"), "{:?}", forged.diagnostics);
    let public = source.replace("  insert <- .authorId = viewer", "  insert <- .authorId = viewer\n  sync public")
        .replace("  delete <- .principal = viewer", "  delete <- .principal = viewer\n  sync public");
    let bound = snapback4_lang::compile(&[("schema.q".into(), public)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.notes.iter().map(|d| d.code.as_str()).collect::<Vec<_>>(), ["N_MAINTAIN_SYNCED"]);
    assert_eq!(bound.schema.operations["trending"].runs.as_deref(), Some("device"));
    assert_eq!(bound.schema.operations["setLike"].predicts.as_deref(), Some("eligible"));
    for name in ["posts", "likes", "trend"] { assert!(bound.schema.tables[name].sync.as_ref().unwrap().horizon.is_none()); }
}

#[test]
fn w15c_value_index_accepts_group_suffix_and_normalizes_total_group_key() {
    for key in ["author, value, at, id", "author, value, at", "value, at, author", "at, value, author, id", "value, at, id"] {
        let bound = compile(&format!("maintain totals: count posts by author, at\n  read <- allow\n  online only\n  by byCount: {key}\n"));
        assert!(bound.diagnostics.is_empty(), "{key}: {:?}", bound.diagnostics);
        assert!(bound.notes.is_empty());
        let mut expected = key.split(", ").collect::<Vec<_>>();
        if expected.last() != Some(&"id") { expected.push("id"); }
        assert_eq!(bound.schema.tables["totals"].indexes["byCount"].columns(), expected);
        assert_eq!(bound.schema.tables["totals"].indexes["byGroup"].columns(), ["author", "at"]);
        assert_eq!(bound.schema.tables["totals"].indexes["byId"].columns(), ["id"]);
    }
}

#[test]
fn w15c_value_index_refusal_pins_the_rule_and_rewrite() {
    // The rewrite is one pasteable `by` line: the author's group fields before `value` stay
    // as the lane scope, the omitted ones follow `value`, and `id` closes it.
    for (key, rewrite) in [
        ("author, value, score, id", "by byCount: author, value, at, id"),
        ("author, value, author, id", "by byCount: author, value, at, id"),
        ("author, author, value, id", "by byCount: author, value, at, id"),
        ("value, at, at, id", "by byCount: value, author, at, id"),
        ("author, value, value, id", "by byCount: author, value, at, id"),
        ("author, value, id, at", "by byCount: author, value, at, id"),
        ("author, value", "by byCount: author, value, at, id"),
        ("value, at", "by byCount: value, author, at, id"),
        ("value, id, id", "by byCount: value, author, at, id"),
    ] {
        let bound = compile(&format!("maintain totals: count posts by author, at\n  read <- allow\n  online only\n  by byCount: {key}\n"));
        let d = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_MAINTAIN").unwrap_or_else(|| panic!("{key}: {:?}", bound.diagnostics));
        assert_eq!(d.message, "a maintain value index is a prefix of group fields, then value, then any remaining group fields, then id (id may be omitted only when every group field is present); fields cannot repeat");
        assert_eq!(d.rewrite, rewrite, "{key}");
        assert_eq!(d.guide, "maintains");
        // The rewrite compiles, and keeps the author's scope.
        let fixed = compile(&format!("maintain totals: count posts by author, at\n  read <- allow\n  online only\n  {rewrite}\n"));
        assert!(fixed.diagnostics.is_empty(), "{rewrite}: {:?}", fixed.diagnostics);
    }
}

#[test]
fn w15c_old_value_indexes_and_expiry_refusal_are_unchanged() {
    for key in ["value, id", "author, value, id", "author, at, value, id"] {
        let b = compile(&format!("maintain totals: count posts by author, at\n  read <- allow\n  online only\n  by byCount: {key}\n"));
        assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?}", b.diagnostics);
        assert_eq!(b.schema.tables["totals"].indexes["byCount"].columns(), key.split(", ").collect::<Vec<_>>());
    }
    expiring_rank_rewrite_routes_by_window_intent();
    let source = SOURCE.replace("  at: time", "  until: time\n  by byUntil: until\n  expire at .until\n  at: time");
    for key in ["author, value, at, id", "author, value, at"] {
        let b = snapback4_lang::compile(&[("expiry.q".into(), format!("{source}maintain totals: count posts by author, at\n  read <- allow\n  by byCount: {key}\n"))]);
        assert_eq!(b.diagnostics[0].code, "E_QUARRY_MAINTAIN_EXPIRE");
        assert_eq!(b.diagnostics[0].message, "maintain totals cannot order by value because source posts expires: stored order is stale before the physical sweep, so taking stored top-N can miss a live winner; a count upper-bound threshold scan is not built");
    }
}

#[test]
fn w15c_cards_pin_the_interim_rule_and_newest_first_recipe() {
    let maintains = snapback4_lang::guide::card("maintains").unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(maintains.contains("Value indexes have a prefix of group fields, then value, then any remaining group fields, then id (implicit when every group field is present), until maintained columns ship; each field appears once."));
    let feeds = snapback4_lang::guide::card("feeds").unwrap();
    let source = snapback4_lang::guide::quarry(feeds).into_iter().find(|s| s.contains("maintain trend:")).unwrap();
    assert!(source.contains("by byScore: hour, value, postAt, postId\n"));
    assert!(feeds.contains("Equal scores put the newest post first"));
    let readme = include_str!("../../../packages/snapback4/README.md").split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(readme.contains("`guide maintains`") && readme.contains("`guide feeds`"), "the orientation reaches both complete references");
    // The complete ordering law above and the recipe's key now live on these linked cards.
    let reference = format!("{maintains} {}", feeds.split_whitespace().collect::<Vec<_>>().join(" "));
    assert!(reference.contains("by byScore: hour, value, postAt, postId") && reference.contains("Equal scores put the newest post first"));
    assert!(!reference.contains("ties use maintained id") && !readme.contains("ties use maintained id"));
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?}", b.diagnostics);
}

#[test]
fn recorded_attribution_admission_and_nullable_keys() {
    let source = include_str!("fixtures/recorded-attribution.q");
    let compile = |source: &str| snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    let good = compile(source);
    assert!(good.diagnostics.is_empty(), "{:?}", good.diagnostics);
    let likes = &good.schema.tables["likes"];
    assert_eq!(likes.recorded.len(), 3);
    assert!(likes.columns["postId.at"].is_optional());
    assert!(good.schema.tables["trend"].columns["hour"].is_optional());
    assert!(good.schema.operations["like"].sites.iter().any(|s| s.table == "posts" && s.kind == "recorded attribution"));
    let types = snapback4_lang::emit::typescript(&good);
    let likes_type = types.split("  likes: {").nth(1).unwrap().split("  };").next().unwrap();
    assert!(!likes_type.contains("postId."), "{likes_type}");
    for bad in [
        source.replacen("read <- allow", "read <- .authorId = viewer", 1),
        source.replace("  immutable postId\n", ""),
        source.replace("immutable authorId, parentId, at", "immutable parentId, at"),
        source.replace("by postId.authorId", "by postId.parentId.authorId"),
        source.replace("by postId.authorId", "by postId.unknown"),
        source.replace("where true by", "where postId.at > 0 by"),
    ] {
        let bound = compile(&bad);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN" && d.guide == "maintains" && !d.rewrite.is_empty()), "{:?}", bound.diagnostics);
    }
}
