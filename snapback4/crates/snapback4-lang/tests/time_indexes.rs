use snapback4_lang::compile;

#[test]
fn time_index_keys_compile_at_any_position_and_in_unique_constraints() {
    let source = "table visits:\n  principal: principal\n  at: time\n  by byHour: hour(at), at, id\n  by byPrincipalHour: principal, hour(at), at, id\n  by byBucket: bucket(at, 2h, 30m), at, id\n  unique byDay: principal, day(at) else ALREADY_HERE 'Already checked in.'\n  public 'visits'\nquery page(c: cursor ?):\n  return visits[viewer, hour >= -1, hour < 2] after c first 10 by byPrincipalHour\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:#?}", bound.notes);
}

fn source(column: &str, component: &str) -> String {
    format!("table visits:\n  principal: principal\n  {column}\n  by byTime: {component}, id\n  public 'visits'\n")
}

#[test]
fn invalid_time_keys_and_name_collisions_have_located_rewrites() {
    for (column, component, message) in [
        ("at: time ?", "day(at)", "must be a required time column"),
        ("at: int", "hour(at)", "must be a required time column"),
        ("at: time", "bucket(other.at, 2h)", "required time column of visits"),
        ("at: time", "day(at), day(at)", "each time function occurs at most once"),
        ("at: time\n  hour: int", "hour(at)", "collides with the computed index key"),
        ("at: time", "day(at, 24h)", "offset must be nonnegative and smaller"),
        ("at: time", "bucket(at, 0ms)", "positive representable literal duration"),
        ("at: time", "day()", "calendar key takes a time"),
        ("at: time", "hour(at) + 1", "not a computed expression"),
    ] {
        let bound=compile(&[("schema.q".into(),source(column,component))]);
        let error=bound.diagnostics.iter().find(|e| e.message.contains(message)).unwrap_or_else(||panic!("{component}: {:?}",bound.diagnostics));
        assert!(!error.rewrite.is_empty());
        println!("{}: {}\nrewrite: {}",error.code,error.message,error.rewrite);
    }
    let good=source("at: time", "day(at), hour(at, 30m), bucket(at, 2h, 30m)");
    let bound=compile(&[("schema.q".into(),good)]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let malformed_job = format!("{}\njob sweep():\n  chunk row in visits first 10 by byTime:\n    continue\n", source("at: time", "day()"));
    assert!(!compile(&[("schema.q".into(), malformed_job)]).diagnostics.is_empty());
}

#[test]
fn calendar_keys_stay_outside_row_rules_caps_sync_and_mutation_pages() {
    let base=source("at: time", "principal, hour(at), at");
    for tail in ["query bad():\n  return visits[viewer] first 10 by byTime { hour }\n", "mutation bad():\n  return visits[viewer] first 10 by byTime\n", "mutation bad():\n  return insert visits { principal: viewer, at: now, hour: 1 }\n"] {
        let bound=compile(&[("schema.q".into(),format!("{base}\n{tail}"))]);
        assert!(!bound.diagnostics.is_empty(),"accepted {tail}");
    }
    for change in [base.replace("  public 'visits'", "  read <- .hour = 1"),base.replace("  public 'visits'", "  cap 10 by hour\n  public 'visits'"),base.replace("  public 'visits'", "  read <- .principal = viewer\n  sync last 10 by byTime")] {
        assert!(!compile(&[("schema.q".into(),change)]).diagnostics.is_empty());
    }
    let bound=compile(&[("schema.q".into(),format!("{base}\nquery page(c: cursor ?):\n  return visits[viewer, hour(now)] after c first 10 by byTime {{ * }}\n"))]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    assert!(!bound.schema.tables["visits"].columns.contains_key("hour"));
}

#[test]
fn job_cursor_checks_the_column_beneath_the_time_function() {
    let base=source("at: time", "hour(at), at");
    let job="\njob sweep():\n  chunk row in visits first 10 by byTime:\n    continue\n";
    let bound=compile(&[("schema.q".into(),format!("{base}{job}"))]);
    let error=bound.diagnostics.iter().find(|d| d.code=="E_JOB_CURSOR_INDEX").unwrap_or_else(||panic!("{:?}",bound.diagnostics));
    assert!(error.message.contains("sweeps by at,"));
    assert!(!error.message.contains("at, at"));
    assert!(error.rewrite.starts_with("use `for row in visits:`") && error.rewrite.contains("declare `immutable at`"));
    let bound=compile(&[("schema.q".into(),format!("{}{job}",base.replace("  at: time", "  at: time\n  immutable at")))]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
}
