use super::*;

#[test]
fn upgrade_card_version_and_nullable_count_are_bound_to_the_emitted_surface() {
    let changes = card("changes").unwrap();
    assert!(changes.starts_with(&format!("# Changes in {}\n", env!("CARGO_PKG_VERSION"))));
    assert_eq!(card("upgrade"), Some(changes));
    for name in ["changes", "client", "cheatsheet"] {
        let text = card(name).unwrap();
        assert!(text.contains("hidden key") && text.contains("null") && text.contains("authorized missing count group") && text.contains('0'), "{name}");
    }
    let source = "table orders:\n  owner: principal\n  cents: int\n  immutable owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nview qtySum: sum orders of .cents by .owner\n  read <- .owner = viewer\n  online only\nview qtyCount: count orders by .owner\n  read <- .owner = viewer\n  online only\nquery roomCount(owner: principal):\n  return qtyCount[owner]\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty());
    assert!(snapback4_lang::emit::typescript(&bound).contains("roomCount: Query<{ owner: string }, number | null>"));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let owner = args(&[("owner", id("dev:alice"))]);
    assert_eq!(engine.query("roomCount", Context::new("dev:alice", owner.clone())).unwrap().data, Value::Int(0));
    assert_eq!(engine.query("roomCount", Context::new("dev:bob", owner)).unwrap().data, Value::Null);
    let write = format!("{source}table totals:\n  total: int\n  public\n  insert <- allow\nmutation copy(owner: principal):\n  return insert totals {{ total: qtySum[owner] }}\n");
    let rejected = snapback4_lang::compile(&[("schema.q".into(), write.clone())]);
    assert!(rejected.diagnostics[0].rewrite.contains("qtySum[owner] ?? 0"));
    let repaired = snapback4_lang::compile(&[("schema.q".into(), write.replace("total: qtySum[owner]", "total: qtySum[owner] ?? 0"))]);
    assert!(repaired.diagnostics.is_empty(), "{:?}", repaired.diagnostics);
}

#[test]
fn docs_use_engine_file_types_period_boundaries_and_projection_identity() {
    let assets = card("assets").unwrap();
    for mime in snapback4_core::assets::FILE_TYPES {
        // Office types share an explicit family sentence rather than three long MIME spellings.
        if mime.starts_with("application/vnd.") { continue; }
        assert!(assets.contains(mime), "missing {mime}");
    }
    assert!(assets.contains("POST /assets") && !assets.contains("DX owns"));
    for (alias, target) in [("optional param", "types"), ("mutation default", "writes"), ("service seat", "deploy")] {
        assert_eq!(guide::resolve(alias), Some(target));
    }
    let source = "table rows:\n  title: text <=80\n  public\n  online only\nquery titles():\n  return rows first 10 by .id { title }\nquery identified():\n  return rows first 10 by .id { id, title }\njob sweep(periodStart: time, periodEnd: time):\n  for row in rows:\n    update rows[row] { title: 'done' }\nschedule weekly every 7d at 08:00: sweep\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let ts = snapback4_lang::emit::typescript(&bound);
    let titles = ts.lines().find(|line| line.trim_start().starts_with("titles: Query<")).unwrap();
    assert!(titles.contains("title: string") && !titles.contains("id: string"), "{titles}");
    let identified = ts.lines().find(|line| line.trim_start().starts_with("identified: Query<")).unwrap();
    assert!(identified.contains("id: string") && identified.contains("title: string"), "{identified}");
    let schedule = &bound.schema.schedules[0];
    assert_eq!(schedule.boundary(8 * 86_400_000), 7 * 86_400_000 + 8 * 3_600_000);
    let jobs = card("jobs").unwrap();
    assert!(jobs.contains("periodEnd` is the scheduled firing boundary") && jobs.contains("Thursday 08:00 UTC"));
    let types = card("types").unwrap();
    assert!(types.contains("`format email` accepts one ASCII `@`") && types.contains("alice@localhost"));
}
