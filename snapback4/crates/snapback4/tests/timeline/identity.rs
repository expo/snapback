use snapback4_core::{Engine, Value, schema::timeline::owned_id};

pub fn natural_key(suffix: &str, row: &Value) -> Vec<Value> {
    let fields: &[&str] = match suffix {
        "Authors" => &["principal"],
        "Pulls" => &["readerId", "authorId"],
        "PullCounts" | "PullTotals" => &["readerId"],
        "Feed" => &["readerId", "eventId"],
        "Broadcast" | "RemovedEvents" => &["eventId"],
        other => panic!("not a digest-owned role: {other}"),
    };
    fields.iter().map(|f| row.field(f).unwrap().clone()).collect()
}

pub fn assert_placement(e: &Engine, supplied: &[String]) {
    let supplied = supplied.iter().collect::<std::collections::HashSet<_>>();
    for t in &e.schema().timelines {
        for table in &t.owned {
            for row in e.store().rows(table).unwrap() {
                // Source event ids are public oracle identities (post id or fresh
                // repost id). All other owned identities are derived storage ids.
                let suffix = table.strip_prefix(&t.name).unwrap();
                if suffix == "Posts" { continue; }
                let actual = row.field("id").unwrap().as_str().unwrap();
                assert_eq!(actual, owned_id(&t.name, suffix, &natural_key(suffix, &row)), "{table}");
                assert!(!supplied.contains(&actual.to_string()), "caller placed {table}[{actual}]");
                assert_eq!(actual.len(), 64);
            }
        }
    }
}
