use snapback4_core::schema::ColumnType;
const SOURCE: &str = include_str!("fixtures/recorded-attribution.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("recorded.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
#[test]
fn exact_recorded_names_types_and_emission() {
    let b = bound(SOURCE);
    let likes = &b.schema.tables["likes"];
    assert_eq!(likes.recorded.keys().map(String::as_str).collect::<Vec<_>>(), ["postId.at", "postId.authorId", "postId.parentId"]);
    assert_eq!(b.schema.tables["posts"].recorded.keys().map(String::as_str).collect::<Vec<_>>(), ["parentId.authorId"]);
    assert_eq!(b.schema.tables["receivedLikes"].columns["postId.authorId"], ColumnType::Optional(Box::new(ColumnType::Principal)));
    assert_eq!(b.schema.tables["trend"].columns["postId.at"], ColumnType::Optional(Box::new(ColumnType::Time)));
    assert_eq!(b.schema.tables["trend"].columns["hour"], ColumnType::Optional(Box::new(ColumnType::Int)));
    assert_eq!(b.schema.tables["dailyLikes"].columns["day"], ColumnType::Int);
    for name in ["edit", "unlike"] { assert!(!b.schema.operations.get(&format!("recorded.{name}")).expect("declared operation").sites.iter().any(|s| s.kind == "recorded attribution")); }
    assert!(b.schema.operations["recorded.like"].sites.iter().any(|s| s.kind == "recorded attribution"));
    for (table,path) in [("likes","postId."),("posts","parentId.")] {
        let ts = snapback4_lang::emit::typescript(&b);
        let row = ts.split(&format!("  {table}: {{")).nth(1).unwrap().split("  };").next().unwrap();
        assert!(!row.contains(path),"{row}");
        let fields = row.lines().filter_map(|line|line.trim().split_once(':').map(|(field,_)|field.trim_matches('"').trim_end_matches('?'))).collect::<Vec<_>>();
        assert_eq!(fields, if table == "likes" {vec!["at","id","note","postId","principal","until","pending"]} else {vec!["at","authorId","id","parentId","until","pending"]});
    }
    let rust = snapback4_lang::emit::rust::rust(&b);
    for table in ["Likes","Posts"] {
        let row = rust.split(&format!("pub struct {table} {{")).nth(1).unwrap().split('}').next().unwrap();
        assert!(!row.contains("postId.") && !row.contains("parentId."),"{row}");
        let fields = row.lines().filter_map(|line|line.trim().strip_prefix("pub ").and_then(|line|line.split_once(':')).map(|(field,_)|field)).collect::<Vec<_>>();
        assert_eq!(fields, if table == "Likes" {vec!["at","id","note","post_id","principal","until"]} else {vec!["at","author_id","id","parent_id","until"]});
    }
    let ts = snapback4_lang::emit::typescript(&b);
    assert!(ts.split("  receivedLikes: {").nth(1).unwrap().split("  };").next().unwrap().contains("postId.authorId"));
    assert!(rust.split("pub struct ReceivedLikes {").nth(1).unwrap().split('}').next().unwrap().contains("#[serde(rename = \"postId.authorId\")]") );
    let b = bound(&SOURCE.replace("by postId.authorId", "by postId.id").replace("query received(authorId: principal ?)", "query received(authorId: id ?)"));
    assert_eq!(b.schema.tables["receivedLikes"].columns["postId.id"], ColumnType::Optional(Box::new(ColumnType::Id)));
}
#[test]
fn dotted_aggregate_keys_in_projection_predicate_sort_and_index_read() {
    let source = SOURCE.replace("  expire at .until\n", "").replace("  read <- allow\nmaintain dailyLikes", "  read <- allow\n  by ranking: value, postId.authorId\nmaintain dailyLikes");
    bound(&format!("{source}\nquery ranking():\n  return receivedLikes last 10 by ranking {{ authorId: .postId.authorId, count: .value }}\nquery trending():\n  rows = trend first 100 by byGroup {{ post: .postId, at: .postId.at, count: .value }}\n  return sort(rows, '-at')\nquery guarded():\n  for r in trend first 100 by byGroup:\n    if r.postId.at != null:\n      return r.postId.at + 1\n  return null\nquery lookup(author: principal ?):\n  return receivedLikes[postId.authorId = author]\nquery selected(author: principal ?):\n  return receivedLikes first 10 by byGroup where .postId.authorId = author {{ authorId: .postId.authorId, count: .value }}\nquery ordered():\n  rows = receivedLikes first 100 by byGroup\n  return sort(rows, 'postId.authorId')\n"));
}
#[test]
fn dotted_table_indexes_are_refused() {
    let source = SOURCE.replacen("  by byExpiry:", "  by bad: parentId.authorId\n  by byExpiry:", 1);
    let b = snapback4_lang::compile(&[("index.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.message.contains("index") && d.message.contains("path")), "{:?}", b.diagnostics);
}
#[test]
fn public_target_uses_effective_read_policy() {
    let expected = bound(SOURCE).schema.tables["likes"].recorded.clone();
    for policy in ["read <- allow", "read <- public()", "public 'posts are public'"] {
        let source = SOURCE.replacen("read <- allow",policy,1);
        let b = bound(&source);
        assert_eq!(b.schema.tables["likes"].recorded,expected);
    }
    for policy in ["read <- .authorId = viewer", "public 'posts are public'\n  read <- .authorId = viewer", "read <- public('owner')"] {
        let source = SOURCE.replacen("read <- allow",policy,1);
        assert_ne!(source,SOURCE);
        let b = snapback4_lang::compile(&[("policy.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN" && d.guide == "maintains" && d.message.contains("effective read rule must be unconditionally")), "{policy}: {:?}",b.diagnostics);
    }
    for policy in ["read <- allow\n  read <- .authorId = viewer", "read <- public\n  read <- .authorId = viewer"] {
        let b = snapback4_lang::compile(&[("duplicate.q".into(), SOURCE.replacen("read <- allow",policy,1))]);
        assert!(b.diagnostics.iter().any(|d|d.code == "E_QUARRY_UNKNOWN" && d.message.contains("duplicate read rule")),"{policy}: {:?}",b.diagnostics);
    }
}
#[test]
fn paths_in_by_equality_calendar_and_exactly_one_hop() {
    let days = bound(&SOURCE.replace("hour(postId.at)", "day(postId.at)"));
    assert_eq!(days.schema.tables["trend"].columns["day"],ColumnType::Optional(Box::new(ColumnType::Int)));
    assert_eq!(days.schema.maintains.iter().find(|m|m.target=="trend").unwrap().computed["day"].column,"postId.at");
    let exposed = snapback4_lang::compile(&[("hidden.q".into(),format!("{SOURCE}\nquery hidden():\n  return likes first 10 by byId {{author: .postId.authorId}}\n"))]);
    assert!(exposed.diagnostics.iter().any(|d|d.message.contains("reference has no fields")),"{:?}",exposed.diagnostics);
    for (from, to, message) in [
        ("  immutable postId\n", "", "likes.postId must be immutable"),
        ("where true by", "where postId.at > .at by", "ordered"),
        ("by postId.authorId", "by postId.parentId.authorId", "one hop"),
        ("hour(postId.at)", "hour(postId.parentId.at)", "one hop"),
        ("postId.parentId = null", "postId.parentId.authorId = null", "one hop"),
    ] {
        assert!(SOURCE.contains(from),"missing edit anchor: {from}");
        let source = SOURCE.replace(from,to);
        if from.contains("immutable") {assert!(source.contains("postId: posts") && !source.contains("immutable postId"));}
        let b = snapback4_lang::compile(&[("bad.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN" && d.guide == "maintains" && (d.message.contains(message) || d.rewrite.contains(message))), "{message}: {:?}", b.diagnostics);
    }
    let source = SOURCE.replace("parentId: posts ?", "parentId: posts").replace("by postId.authorId", "by postId.parentId.authorId");
    assert!(source.contains("parentId: posts\n") && !source.contains("parentId: posts ?"));
    let b = snapback4_lang::compile(&[("required-chain.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN" && d.guide == "maintains" && d.message.contains("one hop")), "{:?}", b.diagnostics);
}
