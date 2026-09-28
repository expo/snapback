//! LLP 3000.028 §§7.4–7.5: the calibration builder, not a reduced diagnostic sketch.
use snapback4_lang::{Bound, Diagnostic, compile};

pub const BUILDER: &str = include_str!("../../../experiments/p19-one-query/builder.q");
pub const PREVIEW: &str = "\nquery digestPreview(periodStart: time, periodEnd: time):\n  return digestCounts(viewer, periodStart, periodEnd)\n";

fn bound(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn refusal(b: &Bound, code: &str) -> Diagnostic {
    let errors: Vec<_> = b.diagnostics.iter().filter(|d| d.code == code).collect();
    assert_eq!(errors.len(), 1, "{:?}", b.diagnostics);
    errors[0].clone()
}
fn contains(text: &str, words: &[&str]) {
    for word in words { assert!(text.contains(word), "missing {word}: {text}"); }
}

#[test]
fn builder_public_aggregate_refuses_both_edits_and_explains_each_repair() {
    let original = clean(BUILDER);
    for (name, source, owner, by) in [("ownLikes", "likes", "principal", ".principal, .post"), ("ownReposts", "reposts", "actor", ".actor, .post")] {
        let declaration = format!("view {name}: count {source} by {by}");
        assert!(BUILDER.contains(&declaration));
        for sync in [false, true] {
            let edit = format!("{declaration}\n  read <- .{owner} = viewer{}", if sync { format!("\n  sync to .{owner}") } else { String::new() });
            let source = BUILDER.replace(&declaration, &edit);
            let b = bound(&source);
            let d = refusal(&b, if sync { "E_QUARRY_SYNTAX" } else { "E_SYNC" });
            contains(&d.message, &[name, "horizon-free public sync", "no horizon", &format!("from {}", if name == "ownLikes" { "likes" } else { "reposts" }), &format!("read <- .{owner} = viewer"), "cannot declare a separate sync audience"]);
            contains(&d.rewrite, &["read <- allow", "every device", "other viewers' keys", "online only", "lose offline aggregate/absence coverage", "test --residency", "guide maintains", "guide offline-interactions"]);
            assert_eq!(d.site.line, source.lines().position(|line| line == if sync { format!("  sync to .{owner}") } else { format!("  read <- .{owner} = viewer") }.as_str()).unwrap() as u32 + 1);
            let public = clean(&source.replace(&edit, &format!("{declaration}\n  read <- allow")));
            assert_eq!(public.schema.tables[name], original.schema.tables[name]);
            let online = clean(&source.replace(&edit, &format!("{declaration}\n  read <- .{owner} = viewer\n  online only")));
            assert!(online.schema.tables[name].sync.is_none());
            assert_eq!(online.schema.tables[if name == "ownLikes" { "likes" } else { "reposts" }], original.schema.tables[if name == "ownLikes" { "likes" } else { "reposts" }]);
        }
    }
    let note = original.notes.iter().find(|d| d.code == "N_MAINTAIN_SYNCED").unwrap();
    contains(&note.message, &["ownLikes", "ownReposts", "no horizon", "every device"]);
    contains(&note.rewrite, &["offline absence coverage", "lose that offline coverage", "guide maintains", "guide offline-interactions"]);
}

#[test]
fn parser_refusal_resolves_later_source_in_another_file_and_read_after_sync() {
    let b = compile(&[("views.q".into(), "view owners: count events by .owner\n  sync to .owner\n  read <- .owner = viewer\n".into()),
        ("schema.q".into(), "table events:\n  owner: principal\n  public 'public events'\n  sync public\n".into())]);
    let d = refusal(&b, "E_QUARRY_SYNTAX");
    contains(&d.message, &["owners", "from events", "read <- .owner = viewer", "no horizon"]);
    assert_eq!(d.site.file, "views.q"); assert_eq!(d.site.line, 2);
}

#[test]
fn query_refusal_stays_at_helper_loop_with_transitive_callers_and_job_context() {
    let original = clean(BUILDER);
    for wrapper in [false, true] {
        let preview = if wrapper { PREVIEW.replace("digestCounts(viewer", "wrapped(viewer") + "\nfn wrapped(reader: principal, periodStart: time, periodEnd: time):\n  return digestCounts(reader, periodStart, periodEnd)\n" } else { PREVIEW.into() };
        let b = bound(&(BUILDER.to_owned() + &preview));
        let d = refusal(&b, "E_QUARRY_BOUND");
        contains(&d.message, &["viewer query caller chain: digestPreview", "-> digestCounts", "members[principal = reader]", "conversation-based read rule", "no system authority"]);
        if wrapper { contains(&d.message, &["-> wrapped", "-> digestCounts"]); }
        assert_eq!(d.site.line, BUILDER.lines().position(|s| s.contains("for member in members[principal = reader]")).unwrap() as u32 + 1);
        contains(&d.rewrite, &["first 50", "partial preview", "not an equivalent complete total", "cursor", "system job caller(s) digest", "Inner recipient work must fit one chunk", "parks with E_BOUND"]);
        assert_eq!(b.programs.iter().find(|p| p.program.name == "digest").unwrap().program,
            original.programs.iter().find(|p| p.program.name == "digest").unwrap().program);
    }
}

#[test]
fn guide_and_why_keep_the_replica_and_partial_total_consequences() {
    for keyword in ["maintains", "sync", "residency", "offline-interactions"] {
        contains(snapback4_lang::guide::card(keyword).unwrap(), &["offline", "horizon"]);
    }
    let why = snapback4_lang::guide::explain_code("E_QUARRY_BOUND").unwrap();
    contains(&why, &["caller chain", "first 50", "partial preview", "cursor", "one chunk", "parks"]);
    let why = Diagnostic::new(&Default::default(), "E_SYNC", "", "").guide("maintains").explanation().unwrap();
    contains(&why, &["missing horizon", "offline aggregate/absence coverage", "guide offline-interactions"]);
}
