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
fn excludes(text: &str, words: &[&str]) {
    for word in words { assert!(!text.contains(word), "unexpected {word}: {text}"); }
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
            contains(&d.rewrite, &["viewer-owned existence", "eligible public window", "source owner-key coverage", "ordinary `exists`", "does not supply aggregate totals"]);
            contains(&d.rewrite, &[&format!("with own keys .{owner}"), &format!("on {}", if name == "ownLikes" {"likes"} else {"reposts"}), if name == "ownLikes" {"exists likes[post, viewer]"} else {"exists reposts[viewer, post]"}]);
            excludes(&d.rewrite.to_lowercase(), &["narrow the public source", "sync privately"]);
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
    excludes(&note.rewrite.to_lowercase(), &["narrow the public source", "sync privately"]);
}

#[test]
fn generic_view_sync_refusal_does_not_claim_coverage_from_an_unsynced_source() {
    for policy in ["", "  online only\n"] {
        let source = format!("table likes:\n  postId: id\n  public 'likes'\n{policy}view likeCounts: count likes by postId\n  read <- allow\n  sync public last 2000 by byId\n");
        let d = refusal(&bound(&source), "E_QUARRY_SYNTAX");
        assert_eq!(d.rewrite, "remove this sync line to inherit, or replace it with `online only`");
        excludes(&d.rewrite, &["loses", "lose offline", "absence coverage", "narrow the public source"]);
        for replacement in ["", "  online only\n"] {
            let repaired = clean(&source.replace("  sync public last 2000 by byId\n", replacement));
            assert!(repaired.schema.tables["likes"].sync.is_none());
            assert!(repaired.schema.tables["likeCounts"].sync.is_none());
        }
    }
}

#[test]
fn parser_refusal_resolves_later_source_in_another_file_and_read_after_sync() {
    let b = compile(&[("views.q".into(), "view owners: count events by .owner\n  sync to .owner\n  read <- .owner = viewer\n".into()),
        ("schema.q".into(), "table events:\n  owner: principal\n  public 'public events'\n  sync public\n".into())]);
    let d = refusal(&b, "E_QUARRY_SYNTAX");
    contains(&d.message, &["owners", "from events", "read <- .owner = viewer", "no horizon"]);
    excludes(&d.rewrite.to_lowercase(), &["narrow the public source", "sync privately"]);
    assert_eq!(d.site.file, "views.q"); assert_eq!(d.site.line, 2);
}

#[test]
fn helper_refusal_finds_a_transitive_job_caller() {
    let source = BUILDER.replace("totals = digestCounts(profile.principal, periodStart, periodEnd)", "totals = jobCounts(profile.principal, periodStart, periodEnd)")
        + "\nfn jobCounts(reader: principal, periodStart: time, periodEnd: time):\n  return wrappedCounts(reader, periodStart, periodEnd)\nfn wrappedCounts(reader: principal, periodStart: time, periodEnd: time):\n  return digestCounts(reader, periodStart, periodEnd)\n";
    assert!(!source.contains("totals = digestCounts("), "job must reach the helper through jobCounts and wrappedCounts");
    clean(&source);
    let d = refusal(&bound(&(source + PREVIEW)), "E_QUARRY_BOUND");
    contains(&d.message, &["viewer query caller chain: digestPreview", "-> digestCounts"]);
    contains(&d.message, &["partial preview", "entire unused viewer query `digestPreview`"]);
    contains(&d.rewrite, &["system job caller(s) digest"]);
}

#[test]
fn completed_sibling_helper_is_not_part_of_the_refused_caller_chain() {
    let preview = PREVIEW.replace("  return digestCounts", "  done = harmless()\n  return digestCounts");
    let d = refusal(&bound(&(BUILDER.to_owned() + "\nfn harmless(): 1\n" + &preview)), "E_QUARRY_BOUND");
    let chain = d.message.split("viewer query caller chain: ").nth(1).unwrap().split(". `members").next().unwrap();
    let names: Vec<_> = chain.split(" -> ").map(|call| call.split(" (at ").next().unwrap()).collect();
    assert_eq!(names, ["digestPreview", "digestCounts"]);
    excludes(&d.message, &["harmless"]);
}

#[test]
fn query_only_helper_gets_the_generic_prefix_repair() {
    let source = "table members:\n  principal: principal\n  unread: int\n  by byPrincipal: principal, id\n  read <- .unread = 0\n  online only\nfn total(reader: principal):\n  n = 0\n  for m in members[principal = reader] by byPrincipal:\n    n = n + 1\n  return n\nquery preview():\n  return total(viewer)\n";
    let d = refusal(&bound(source), "E_QUARRY_BOUND");
    assert!(d.rewrite.starts_with("use `first N`:"), "{d:?}");
    contains(&d.rewrite, &["cursor", "unread", "pin the deciding columns"]);
    excludes(&d.message, &["caller chain", "helper", "system authority"]);
    excludes(&d.rewrite, &["partial preview", "scheduled job", "system job", "recipient"]);
}

#[test]
fn job_bound_helpers_require_a_query_ineligible_prefix() {
    for body in [
        "  n = 0\n  for m in members[principal = reader] by byPrincipal:\n    n = n + 1\n  return n\n",
        "  return count(members[principal = reader] by byPrincipal)\n",
    ] {
        for (cap, query_ineligible) in [("  cap 10 by principal\n", false), ("  cap 10000 by principal\n", true), ("", true), ("  cap 10 by unread\n", true)] {
            let source = format!("table members:\n  principal: principal\n  unread: int\n  by byPrincipal: principal, id\n{cap}  read <- .unread = 0\n  online only\nfn total(reader: principal):\n{body}job sweep():\n  for m in members:\n    n = total(m.principal)\n");
            let b = clean(&source);
            let job = b.programs.iter().find(|p| p.program.name == "sweep").unwrap();
            let helpers: Vec<_> = job.job_bound_helpers.iter().map(String::as_str).collect();
            assert_eq!(helpers, if query_ineligible { vec!["total"] } else { vec![] }, "{source}");
            let preview = bound(&(source + "\nquery preview():\n  return total(viewer)\n"));
            if query_ineligible {
                let d = refusal(&preview, "E_QUARRY_BOUND");
                contains(&d.message, &["viewer query caller chain: preview", "-> total"]);
                contains(&d.rewrite, &["system job caller(s) sweep"]);
                contains(&d.message, &["partial preview"]);
            } else {
                assert!(preview.diagnostics.is_empty(), "{:?}", preview.diagnostics);
            }
        }
    }
}

#[test]
fn query_replacement_points_at_declaration_with_helper_loop_and_job_context() {
    let original = clean(BUILDER);
    for wrapper in [false, true] {
        let preview = if wrapper { PREVIEW.replace("digestCounts(viewer", "wrapped(viewer") + "\nfn wrapped(reader: principal, periodStart: time, periodEnd: time):\n  return digestCounts(reader, periodStart, periodEnd)\n" } else { PREVIEW.into() };
        let b = bound(&(BUILDER.to_owned() + &preview));
        let d = refusal(&b, "E_QUARRY_BOUND");
        contains(&d.message, &["viewer query caller chain: digestPreview", "-> digestCounts", "members[principal = reader]", "conversation-based read rule", "no system authority"]);
        if wrapper { contains(&d.message, &["-> wrapped", "-> digestCounts"]); }
        assert_eq!(d.site.line, (BUILDER.to_owned() + &preview).lines().position(|s| s.starts_with("query digestPreview")).unwrap() as u32 + 1);
        assert!(d.message.contains("replace lines"));
        contains(&d.message, &["first 50", "partial preview", "not an equivalent complete total", "cursor", "Inner recipient work must fit one chunk", "parks with E_BOUND"]);
        contains(&d.rewrite, &["system job caller(s) digest"]);
        assert_eq!(b.programs.iter().find(|p| p.program.name == "digest").unwrap().program,
            original.programs.iter().find(|p| p.program.name == "digest").unwrap().program);
    }
}

#[test]
fn guide_and_why_keep_the_replica_and_partial_total_consequences() {
    for keyword in ["maintains", "sync", "residency", "offline-interactions"] {
        contains(snapback4_lang::guide::card(keyword).unwrap(), &["offline", "horizon"]);
    }
    let why = snapback4_lang::guide::explain_code("E_QUARRY_SYNTAX").unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
    contains(&why, &["Remove its sync line to inherit, or replace it with `online only`.",
        "The offline-loss repair applies only when the view is proved to inherit horizon-free public sync and its explicit read is narrower.",
        "An unsynced or online-only source supplies no partition for the view to lose.",
        "lose offline aggregate/absence coverage"]);
    excludes(&why, &["Remove the view's sync line, then keep its public read"]);
    let why = snapback4_lang::guide::explain_code("E_QUARRY_BOUND").unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
    contains(&why, &["caller chain", "first 50", "partial preview", "cursor", "one chunk", "parks"]);
    contains(&why, &["Only for a non-uniform meter read inside a helper also reached by a job does the refusal name the caller chain and job.",
        "Other non-uniform query prefixes keep the `first N`/cursor or deciding-column repair."]);
    excludes(&why, &["The refusal stays at the failed loop and names the caller chain."]);
    let why = Diagnostic::new(&Default::default(), "E_SYNC", "", "").guide("maintains").explanation().unwrap();
    contains(&why, &["missing horizon", "offline aggregate/absence coverage", "guide offline-interactions"]);
    let definition = snapback4_lang::guide::CODES.iter().find(|(code, _)| *code == "N_MAINTAIN_SYNCED").unwrap().1;
    contains(definition, &["no horizon", "online only", "loses offline aggregate/absence coverage"]);
}

#[test]
fn owner_key_rewrite_from_each_narrowing_diagnostic_compiles_verbatim() {
    for sync in [false,true] {
        let declaration="view ownLikes: count likes by .principal, .post";
        let edit=format!("{declaration}\n  read <- .principal = viewer{}",if sync {"\n  sync to .principal"} else {""});
        let bad=BUILDER.replace(declaration,&edit);
        let d=refusal(&bound(&bad),if sync {"E_QUARRY_SYNTAX"} else {"E_SYNC"});
        let sync_line=d.rewrite.split('`').find(|s|s.starts_with("sync public last")).unwrap();
        let read=d.rewrite.split('`').find(|s|s.starts_with("exists likes[")).unwrap();
        clean(&bad.replace(&edit,"").replace("sync public last 2000 by .at",sync_line)
            .replace("ownLikes[viewer, post] > 0",read)
            .replace("ownLikes[viewer, .id] > 0",&read.replace("[post,","[.id,")));
    }
    let filtered=BUILDER.replace("view ownLikes: count likes by .principal, .post", "view ownLikes: count likes where .at > 0 by .principal, .post\n  read <- .principal = viewer");
    let d=refusal(&bound(&filtered),"E_SYNC");
    assert!(!d.rewrite.contains("replace ownLikes with"),"a filtered count's Boolean result is not source-key existence: {d:?}");
}
