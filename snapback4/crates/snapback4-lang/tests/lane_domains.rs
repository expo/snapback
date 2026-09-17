use snapback4_lang::compile;

const TABLE: &str = "table posts:\n  author: principal\n  at: time\n  by byAuthorTime: author, at, id\n  by byTime: at, id\n  public 'posts'\n";

#[test]
fn query_merge_accepts_statement_range_and_list_domains() {
    for (args, prefix, domain) in [
        ("c: cursor ?", "h", "range(hour(now) - 24, hour(now) + 1)"),
        ("authors: [principal] <=50, c: cursor ?", "a", "authors"),
        ("c: cursor ?", "a", "[viewer, viewer]"),
    ] {
        let (table, index) = if prefix == "h" { (TABLE.replace("at: time", "hour: int\n  at: time").replace("by byTime: at, id", "by byTime: hour, at, id"), "byTime") } else { (TABLE.into(), "byAuthorTime") };
        let bound = compile(&[("schema.q".into(), format!("{table}\nquery page({args}):\n  return merge posts after c first 10 by {index}:\n    [{prefix}] for {prefix} in {domain}\n"))]);
        assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
        assert!(bound.notes.is_empty(), "{:#?}", bound.notes);
    }
}

#[test]
fn static_widths_and_list_bounds_alone_control_wide_merge_notes() {
    let table = TABLE.replace("at: time", "hourKey: int\n  at: time").replace("by byTime: at, id", "by byTime: hourKey, at, id");
    for (domain, expected, wide) in [("range(1, 26)",Some(25),false), ("range(hour(now) - 24, hour(now) + 1)",Some(25),false), ("range(start * 2 - 24, start * 2 + 1)",Some(25),false), ("range((start + end) * 2, start + end * 2)",None,false), ("range(hour(now) - 51, hour(now))",Some(51),true), ("range(start, end)",None,false), ("range(8, 2)",Some(0),false), ("hours",Some(51),true), ("[1, 2, 3]",Some(3),false)] {
        let bound = compile(&[("schema.q".into(), format!("{table}\nquery page(start: int, end: int, hours: [int] <=51, c: cursor ?):\n  return merge posts after c first 10 by byTime:\n    [h] for h in {domain}\n"))]);
        assert!(bound.diagnostics.is_empty(), "{domain}: {:?}",bound.diagnostics);
        let program=&bound.programs[0].program;
        let snapback4_core::ir::Stmt::Return(snapback4_core::ir::Expr::Merge(merge))=program.body.last().unwrap() else { panic!("{program:?}") };
        assert_eq!(merge.static_lanes(),expected,"{domain}");
        assert_eq!(bound.notes.iter().any(|n|n.code=="N_WIDE_MERGE"),wide,"{domain}: {:?}",bound.notes);
    }
}

#[test]
fn lane_refusals_name_all_admitted_domains_and_keep_job_and_mutation_boundaries() {
    let tree=TABLE.replace("  author:","  parent: posts ?\n  author:");
    for domain in ["walk posts[seed] up .parent depth 8", "7"] {
        let source=format!("{tree}\nquery bad(seed: posts, c: cursor ?):\n  return merge posts after c first 10 by byAuthorTime:\n    [viewer] for h in {domain}\n");
        let bound=compile(&[("schema.q".into(),source)]);
        let error=bound.diagnostics.iter().find(|d|d.code=="E_QUARRY_SYNTAX").unwrap_or_else(||panic!("{:?}",bound.diagnostics));
        assert!(error.message.contains("range(a, b)") && error.message.contains("bounded list"));
        println!("{}: {}\nrewrite: {}",error.code,error.message,error.rewrite);
    }
    let mutation=format!("{TABLE}\nmutation bad(authors: [principal] <=50, c: cursor ?):\n  return merge posts after c first 10 by byAuthorTime:\n    [a] for a in authors\n");
    let bound=compile(&[("schema.q".into(),mutation)]);
    assert!(!bound.diagnostics.is_empty());
    // Literal/table merges already run inside job chunks; new domains remain query-only.
    let job=format!("{TABLE}\njob sweep():\n  chunk p in posts first 10 by byId:\n    page = merge posts first 10 by byAuthorTime:\n      [p.author]\n");
    assert!(compile(&[("schema.q".into(),job.clone())]).diagnostics.is_empty());
    let bound=compile(&[("schema.q".into(),job.replace("[p.author]", "[a] for a in [p.author]"))]);
    assert!(bound.diagnostics.iter().any(|d|d.message=="range and list merge lanes belong in queries"),"{:?}",bound.diagnostics);
}
