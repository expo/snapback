use snapback4_lang::{Bound, compile};
use snapback4_core::ir;

const SOURCE: &str = include_str!("../../snapback4-sim/tests/fixtures/prefix-reads.q");

fn checked(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    bound
}

#[test]
fn prefix_reads_compile_without_notes_and_caps_follow_one_schema_number() {
    for cap in [100, 120] {
        let bound = checked(&SOURCE.replace("cap 100 by roomId", &format!("cap {cap} by roomId")));
        assert!(bound.notes.is_empty(), "{:?}", bound.notes);
        for name in ["roster", "bump", "nested"] {
            let program = &bound.programs.iter().find(|p| p.program.name == name).unwrap().program;
            assert!(ir::scans(program).iter().any(|scan| scan.table == "members" && scan.take.maximum() == cap));
        }
    }
}

#[test]
fn prefix_exists_plain_and_matching_are_scans_but_full_keys_stay_probes() {
    let schema = SOURCE.split("fn total():").next().unwrap();
    let bound = checked(&format!("{schema}\nquery plain(roomId: rooms):\n  return exists messages[roomId]\nquery words(roomId: rooms, q: text <=100):\n  return exists (messages[roomId] matching q)\nquery exact(roomId: rooms):\n  return exists members[roomId, viewer]\n"));
    for name in ["plain", "words"] {
        let program = &bound.programs.iter().find(|p| p.program.name == name).unwrap().program;
        assert_eq!(ir::scans(program).len(), 1);
        assert_eq!(ir::scans(program)[0].take.maximum(), 1);
    }
    let exact = &bound.programs.iter().find(|p| p.program.name == "exact").unwrap().program;
    assert!(ir::scans(exact).is_empty());
}

fn schema() -> &'static str { SOURCE.split("fn total():").next().unwrap() }

fn rejected(schema: &str, body: &str, code: &str) -> snapback4_lang::Diagnostic {
    let bound = compile(&[("schema.q".into(), format!("{schema}\n{body}"))]);
    let error = bound.diagnostics.iter().find(|error| error.code == code).unwrap_or_else(|| panic!("expected {code}: {:#?}", bound.diagnostics));
    println!("{}: {}\nrewrite: {}", error.code, error.message, error.rewrite);
    error.clone()
}

#[test]
fn prefix_positions_refuse_with_working_page_rewrites() {
    for body in ["query bad():\n  return members[viewer]\n", "mutation bad():\n  page = members[viewer]\n  return null\n"] {
        let error = rejected(schema(), body, "E_QUARRY_BOUND");
        assert!(error.rewrite.contains("cap N by principal") && error.rewrite.contains("first N"));
        checked(&format!("{}\n{}", schema(), body.replace("bad()", "bad(c: cursor ?)").replace("members[viewer]", "members[viewer] after c first 50")));
    }
    let helper = "fn total():\n  n = 0\n  for m in members[viewer]:\n    n = n + m.unread\n  return n\nmutation bad():\n  return total()\n";
    let error = rejected(schema(), helper, "E_QUARRY_PLACEMENT");
    assert!(error.message.starts_with("fn total:"), "{error:?}");
    assert_eq!(error.site.line as usize, schema().lines().count() + 8);
    checked(&format!("{}\n{}", schema(), helper.replace("members[viewer]", "members[viewer] first 50").replace("mutation bad():", "mutation bad(): server")));
    rejected(schema(), &helper.replace("return total()", "return members[viewer] first 50 where total() > 0"), "E_QUARRY_PLACEMENT");
    let job = "job sweep():\n  chunk r in rooms first 10 by byId:\n    for m in members[viewer]:\n      continue\n";
    checked(&format!("{}\n{job}", schema())); // LLP 3000.013: inner job domains use the chunk meter.
    checked(&format!("{}\n{}", schema(), job.replace("members[viewer]", "members[r.id]")));
    let job_schema = schema().replace("cap 100 by roomId", "cap 10000 by roomId");
    checked(&format!("{job_schema}\n{}", job.replace("members[viewer]", "members[r.id]")));
}

#[test]
fn oversize_caps_fall_back_to_the_meter_only_in_query_domains() {
    let large = schema().replace("cap 100 by roomId", "cap 50000 by roomId");
    let error = rejected(&large, "query roster(roomId: rooms):\n  return members[roomId]\n", "E_QUARRY_BOUND");
    assert!(error.message.contains("50000") && error.rewrite.contains("first N"));
    checked(&format!("{large}\nquery roster(roomId: rooms, c: cursor ?):\n  return members[roomId] after c first 50\n"));
    let bound = checked(&format!("{large}\nquery total(roomId: rooms):\n  n = 0\n  for m in members[roomId]:\n    n = n + m.unread\n  return n\n"));
    assert_eq!(ir::scans(&bound.programs[0].program)[0].take.maximum(), snapback4_core::Ceilings::default().examined);
}

#[test]
fn nonuniform_meter_domains_refuse_but_an_explicit_page_compiles() {
    let schema = schema().replace("read <- exists members[.roomId, viewer]", "read <- .unread = 0").replace("  sync to members[.roomId]", "  online only --");
    // Keep the messages rule well typed; only the lane source's rule changes.
    let schema = schema.replace("  read <- .unread = 0\n  online only -- last", "  read <- allow\n  online only -- last");
    for body in ["query total():\n  n = 0\n  for m in members[viewer]:\n    n = n + 1\n  return n\n", "query total(c: cursor ?):\n  return merge members after c first 20 by byRoomPrincipal:\n    [m.roomId] for m in members[viewer]\n"] {
        let error = rejected(&schema, body, "E_QUARRY_BOUND");
        assert!(error.rewrite.contains("first N") && error.rewrite.contains("unread"));
        checked(&format!("{schema}\n{}", body.replace("members[viewer]", "members[viewer] first 50")));
    }
}

#[test]
fn explicit_caps_stay_silent_and_predicting_short_pages_stay_refused() {
    let explicit = SOURCE.replace("members[roomId]:", "members[roomId] first 100:").replace("return members[roomId]\n", "return members[roomId] first 100\n");
    assert!(checked(&explicit).notes.is_empty());
    let small = explicit.replace("members[roomId] first 100:", "members[roomId] first 20:");
    let error = rejected("", &small, "E_STRUCTURAL_FANOUT");
    assert!(error.message.contains("literal page bound must cover the schema cap 100"));
    assert!(error.rewrite.contains("for row in members[roomId] by byRoomPrincipal:") && !error.rewrite.contains("first 100"), "{error:?}");
}

#[test]
fn exists_modifiers_and_rule_probes_keep_their_boundaries() {
    for suffix in ["first 1", "last 1", "after c", "after c first 1"] {
        let body = format!("query bad(roomId: rooms, c: cursor ?):\n  return exists (messages[roomId] {suffix})\n");
        let error = rejected(schema(), &body, "E_QUARRY_SYNTAX");
        assert_eq!(error.rewrite, "exists messages[roomId]");
        checked(&format!("{}\nquery good(roomId: rooms):\n  return {}\n", schema(), error.rewrite));
    }
    checked(&format!("{}\nquery filtered(roomId: rooms):\n  return exists messages[roomId] where .body != ''\n", schema()));
    let body = "query grouped(q: text <=100, c: cursor ?):\n  return members[viewer] after c first 20 where exists messages[.roomId] matching q\n";
    let error = rejected(schema(), body, "E_QUARRY_MODIFIER_SCOPE");
    assert_eq!(error.rewrite, "(messages[.roomId] matching q)");
    assert!(error.mechanical);
    checked(&format!("{}\n{}", schema(), body.replace("messages[.roomId] matching q", &error.rewrite)));
    rejected(&schema().replace("read <- exists members[.roomId, viewer]", "read <- exists (members[.roomId] matching 'a')"), "", "E_QUARRY_UNKNOWN");
}

#[test]
fn mutation_exists_is_admitted_only_for_uniform_plain_nonexpiring_prefixes() {
    let good = "mutation checkPrefix():\n  return exists members[viewer]\n";
    checked(&format!("{}\n{good}", schema()));
    let private = schema().split("table messages:").next().unwrap().replace("read <- exists members[.roomId, viewer]", "read <- .unread = 0").replace("sync to members[.roomId]", "online only");
    rejected(&private, good, "E_STRUCTURAL_FANOUT");
    checked(&format!("{private}\n{}", good.replace("mutation", "query")));
    for body in ["mutation bad(roomId: rooms):\n  return exists messages[roomId]\n", "mutation bad(roomId: rooms, q: text <=100):\n  return exists (messages[roomId] matching q)\n"] {
        let error = rejected(schema(), body, "E_STRUCTURAL_FANOUT");
        assert!(error.rewrite.contains("query"));
        checked(&format!("{}\n{}", schema(), body.replace("mutation", "query")));
    }
}

#[test]
fn whole_table_domains_filters_and_bound_pages_share_prefix_recognition() {
    let body = "query all():\n  return rooms[]\nquery bound(roomId: rooms):\n  page = members[roomId] where .unread != 0\n  return page\nquery total():\n  n = 0\n  for m in members[viewer] by byPrincipalRoom where .unread != 0:\n    n = n + m.unread\n  for r in rooms[]:\n    n = n + 1\n  return n\n";
    assert!(checked(&format!("{}\n{body}", schema())).notes.is_empty());
    let uncapped = schema().replace("  cap 100\n", "").replace("  sync public\n", "  online only\n");
    checked(&format!("{uncapped}\nquery all():\n  n = 0\n  for r in rooms[]:\n    n = n + 1\n  return n\n"));
    let bound_page = "query bound():\n  page = members[viewer]\n  return count(page)\n";
    rejected(schema(), bound_page, "E_QUARRY_BOUND");
    let ambiguous = schema().replace("  by byPrincipalRoom:", "  by byPrincipalUnread: principal, unread, id\n  by byPrincipalRoom:");
    let error = rejected(&ambiguous, "query total():\n  n = 0\n  for m in members[viewer]:\n    n = n + m.unread\n  return n\n", "E_QUARRY_AMBIGUOUS");
    assert!(error.rewrite.contains("by byPrincipal"));
}

#[test]
fn matching_exists_modifier_rewrite_compiles_verbatim() {
    let body = "query bad(roomId: rooms, q: text <=100):\n  return exists (messages[roomId] matching q first 1 by byRoomWords)\n";
    let error = rejected(schema(), body, "E_QUARRY_SYNTAX");
    checked(&format!("{}\nquery good(roomId: rooms, q: text <=100):\n  return {}\n", schema(), error.rewrite));
    assert_eq!(error.rewrite, "exists messages[roomId] matching q by byRoomWords");
}
