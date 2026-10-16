//! Execute the exact shipped snippets, including both allowed and hidden paths.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, JobState, Value, WriteState, wire};
use snapback4_lang::guide;
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
fn engine(marker: &str) -> Engine {
    let source = guide::quarry(guide::card("rule-recipes").unwrap())
        .into_iter()
        .find(|s| s.contains(marker))
        .unwrap();
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{marker}: {:?}", b.diagnostics);
    assert!(
        b.notes.iter().all(|n| n.code == "N_EPHEMERAL_SERVER"),
        "{marker}: {:?}",
        b.notes
    );
    Engine::new_at(
        snapback4_core::store::Store::memory().unwrap(),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        0,
    )
    .unwrap()
}
fn ctx(e: &Engine, op: &str, who: &str, args: Json, now: i64) -> Context {
    let args = e
        .program(op)
        .unwrap()
        .args
        .iter()
        .map(|(k, t)| {
            (
                k.clone(),
                wire::from_json(t, args.get(k).unwrap_or(&Json::Null)).unwrap(),
            )
        })
        .collect();
    Context::new(who, args).at(now)
}
fn write(e: &mut Engine, op: &str, who: &str, args: Json, now: i64) -> Json {
    let c = ctx(e, op, who, args, now);
    match e.mutate(op, None, c).unwrap().state {
        WriteState::Sent { result, .. } => wire::to_json(&result),
        other => panic!("{op}: {other:?}"),
    }
}
fn fail(e: &mut Engine, op: &str, who: &str, args: Json, now: i64, code: &str) {
    let c = ctx(e, op, who, args, now);
    let state = e.mutate(op, None, c).unwrap().state;
    assert!(
        matches!(&state, WriteState::Failed { why, .. } if why.code == code),
        "{op}: expected {code}, got {state:?}"
    );
}

fn read(e: &mut Engine, op: &str, who: &str, args: Json, now: i64) -> Json {
    let c = ctx(e, op, who, args, now);
    wire::to_json(&e.query(op, c).unwrap().data)
}
fn seed(e: &mut Engine, table: &str, data: Json) {
    let row = wire::row_from_json(e.schema().table(table).unwrap(), &data).unwrap();
    e.seed_at(vec![(table.into(), row)], 0).unwrap();
}
#[test]
fn every_recipe_compiles_in_its_own_snippet_class() {
    let blocks = guide::quarry(guide::card("rule-recipes").unwrap());
    assert_eq!(
        blocks.len(),
        29,
        "each standalone recipe has its own compilation class"
    );
    for s in blocks {
        let timed_peer = s.contains("mutation reportWords(") && s.contains("table peerCounts:");
        let b = snapback4_lang::compile(&[("schema.q".into(), s)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        if timed_peer {
            // The published recipe documents this intentional runtime guard.
            assert_eq!(b.notes.len(), 1, "{:?}", b.notes);
            assert_eq!(b.notes[0].code, "N_IMMUTABLE_PATCH");
            assert!(b.notes[0].message.contains("peerCounts.opensAt"));
            assert!(b.notes[0].message.contains("equals the stored value"));
        } else {
            assert!(b.notes.iter().all(|n| n.code == "N_EPHEMERAL_SERVER"), "{:?}", b.notes);
        }
        Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    }
}
#[test]
fn day_assignment_and_half_open_window_are_independent_authorities() {
    let mut e = engine("table dayReaders:");
    write(
        &mut e,
        "assignDay",
        "service:ops",
        json!({"who":"alice","dayNumber":2}),
        1000,
    );
    let p = write(
        &mut e,
        "publishDay",
        "service:ops",
        json!({"dayNumber":2,"opensAt":2000,"endsAt":3000,"body":"secret"}),
        1000,
    );
    let args = json!({"publication":p["id"]});
    for (who, now, visible) in [
        ("alice", 1999, false),
        ("alice", 2000, true),
        ("bob", 2000, false),
        ("alice", 2999, true),
        ("alice", 3000, false),
    ] {
        assert_eq!(
            !read(&mut e, "dayPublication", who, args.clone(), now).is_null(),
            visible,
            "{who} at {now}"
        );
    }
    fail(
        &mut e,
        "assignDay",
        "bob",
        json!({"who":"bob","dayNumber":2}),
        3000,
        "NOT_OPERATOR",
    );
}
#[test]
fn public_identity_does_not_publish_private_sheet() {
    let mut e = engine("table privateSheets:");
    let r = write(
        &mut e,
        "createIdentity",
        "alice",
        json!({"name":"Alice","notes":"private"}),
        1000,
    );
    let args = json!({"identity":r["id"]});
    assert_eq!(
        read(&mut e, "identity", "bob", args.clone(), 1000)["name"],
        "Alice"
    );
    assert!(read(&mut e, "privateSheet", "bob", args.clone(), 1000).is_null());
    assert_eq!(
        read(&mut e, "privateSheet", "alice", args, 1000)["notes"],
        "private"
    );
}
#[test]
fn dashboard_discloses_count_to_staff_but_not_private_bodies() {
    let mut e = engine("table dashboardStaff:");
    seed(
        &mut e,
        "dashboardStaff",
        json!({"id":"staff","principal":"bob"}),
    );
    let r = write(&mut e, "ticket", "alice", json!({"body":"private"}), 1000);
    assert_eq!(read(&mut e, "dashboardRole", "bob", json!({}), 1000), true);
    assert_eq!(
        read(&mut e, "dashboardRole", "carol", json!({}), 1000),
        false
    );
    assert_eq!(
        read(&mut e, "statusCount", "bob", json!({"status":"open"}), 1000),
        json!({"count":1})
    );
    assert_eq!(
        read(
            &mut e,
            "statusCount",
            "bob",
            json!({"status":"closed"}),
            1000
        ),
        json!({"count":0})
    );
    assert_eq!(
        read(
            &mut e,
            "statusCount",
            "carol",
            json!({"status":"closed"}),
            1000
        ),
        json!({"count":null})
    );
    assert!(
        read(
            &mut e,
            "privateTicket",
            "bob",
            json!({"ticket":r["id"]}),
            1000
        )
        .is_null()
    );
}
#[test]
fn live_parent_transfer_moves_existing_child_authority() {
    let mut e = engine("table movableFolders:");
    let f = write(&mut e, "newMovableFolder", "alice", json!({}), 1000);
    let r = write(
        &mut e,
        "liveFile",
        "alice",
        json!({"folder":f["id"],"body":"private"}),
        1000,
    );
    let args = json!({"file":r["id"]});
    assert!(!read(&mut e, "liveFileById", "alice", args.clone(), 1000).is_null());
    assert!(read(&mut e, "liveFileById", "bob", args.clone(), 1000).is_null());
    write(
        &mut e,
        "transferFolder",
        "alice",
        json!({"folder":f["id"],"who":"bob"}),
        1000,
    );
    assert!(read(&mut e, "liveFileById", "alice", args.clone(), 1000).is_null());
    assert!(!read(&mut e, "liveFileById", "bob", args, 1000).is_null());
}
#[test]
fn publication_needs_ten_distinct_irrevocable_approvals() {
    let mut e = engine("table petitionPublications:");
    let p = write(
        &mut e,
        "petition",
        "alice",
        json!({"body":"private until threshold"}),
        1000,
    );
    let args = json!({"petition":p["id"]});
    fail(
        &mut e,
        "publishPetition",
        "alice",
        args.clone(),
        1000,
        "TOO_FEW",
    );
    for n in 0..9 {
        write(&mut e, "approve", &format!("voter{n}"), args.clone(), 1000);
    }
    fail(
        &mut e,
        "publishPetition",
        "alice",
        args.clone(),
        1000,
        "TOO_FEW",
    );
    write(&mut e, "approve", "voter9", args.clone(), 1000);
    write(&mut e, "publishPetition", "alice", args.clone(), 1000);
    assert_eq!(
        read(&mut e, "petitionPublication", "outsider", args, 1000)["body"],
        "private until threshold"
    );
}
#[test]
fn closed_ballots_expose_only_the_maintained_result() {
    let mut e = engine("table ballots:");
    let p = write(&mut e, "poll", "alice", json!({}), 1000);
    let args = json!({"poll":p["id"],"choice":"yes"});
    write(&mut e, "vote", "bob", args.clone(), 1000);
    assert_eq!(
        read(&mut e, "ballotResult", "carol", args.clone(), 1000),
        json!({"count":null})
    );
    assert!(read(&mut e, "ownBallot", "carol", json!({"poll":p["id"]}), 1000).is_null());
    write(&mut e, "closePoll", "alice", json!({"poll":p["id"]}), 1000);
    assert_eq!(
        read(&mut e, "ballotResult", "carol", args.clone(), 1000),
        json!({"count":1})
    );
    assert_eq!(
        read(
            &mut e,
            "ballotResult",
            "carol",
            json!({"poll":p["id"],"choice":"no"}),
            1000
        ),
        json!({"count":0})
    );
    fail(&mut e, "vote", "carol", args, 1000, "E_RULE");
}
#[test]
fn presence_copies_scope_and_revokes_with_enrolment() {
    let mut e = engine("table presenceRows:");
    seed(
        &mut e,
        "spaces",
        json!({"id":"s","title":"private participation"}),
    );
    for who in ["alice", "bob"] {
        seed(
            &mut e,
            "enrolments",
            json!({"id":who,"space":"s","principal":who}),
        );
    }
    write(&mut e, "pulse", "alice", json!({"space":"s"}), 1000);
    let args = json!({"space":"s","who":"alice"});
    assert!(!read(&mut e, "presence", "bob", args.clone(), 1000).is_null());
    assert!(read(&mut e, "presence", "carol", args.clone(), 1000).is_null());
    write(&mut e, "leaveSpace", "bob", json!({"space":"s"}), 1000);
    assert!(read(&mut e, "presence", "bob", args.clone(), 1000).is_null());
    fail(
        &mut e,
        "pulse",
        "bob",
        json!({"space":"s"}),
        1000,
        "NOT_FOUND",
    );
    assert!(
        e.schema().operations["pulse"].renews,
        "the presence helper must support SDK renewal"
    );
    // Rejoining creates a new durable enrolment id while the old memory row is
    // still alive; its stable scope/principal key must renew immediately.
    write(&mut e, "leaveSpace", "alice", json!({"space":"s"}), 1000);
    assert!(read(&mut e, "presence", "alice", args.clone(), 1000).is_null());
    seed(
        &mut e,
        "enrolments",
        json!({"id":"alice-rejoined","space":"s","principal":"alice"}),
    );
    write(&mut e, "pulse", "alice", json!({"space":"s"}), 1001);
    assert!(!read(&mut e, "presence", "alice", args.clone(), 1001).is_null());
    assert!(read(&mut e, "presence", "alice", args, 5001).is_null());
}
#[test]
fn system_job_comparison_does_not_publish_scores() {
    let mut e = engine("table secretScores:");
    let a = write(&mut e, "secretScore", "alice", json!({"score":9}), 1000);
    let b = write(&mut e, "secretScore", "bob", json!({"score":2}), 1000);
    assert!(
        read(
            &mut e,
            "secretScoreById",
            "carol",
            json!({"score":a["id"]}),
            1000
        )
        .is_null()
    );
    let args = [
        ("left".into(), Value::Id(a["id"].as_str().unwrap().into())),
        ("right".into(), Value::Id(b["id"].as_str().unwrap().into())),
    ]
    .into();
    assert!(matches!(
        e.run_job("compare", args, 1000).unwrap().state,
        JobState::Done
    ));
    let rows = e.store().rows("comparisons").unwrap();
    assert_eq!(rows.len(), 1);
    let key = wire::to_json(rows[0].field("id").unwrap());
    let r = read(
        &mut e,
        "comparison",
        "carol",
        json!({"comparison":key}),
        1000,
    );
    assert_eq!(r["leftHigher"], true);
    assert!(r.get("score").is_none());
}
#[test]
fn invitation_enrols_without_reading_the_hidden_parent() {
    let mut e = engine("table hiddenClubs:");
    let c = write(&mut e, "club", "alice", json!({"title":"private"}), 1000);
    let args = json!({"club":c["id"]});
    assert!(read(&mut e, "hiddenClub", "bob", args.clone(), 1000).is_null());
    fail(&mut e, "acceptClub", "bob", args.clone(), 1000, "NOT_FOUND");
    write(
        &mut e,
        "inviteClub",
        "alice",
        json!({"club":c["id"],"who":"bob"}),
        1000,
    );
    assert!(read(&mut e, "hiddenClub", "bob", args.clone(), 1000).is_null());
    write(&mut e, "acceptClub", "bob", args.clone(), 1000);
    assert_eq!(
        read(&mut e, "hiddenClub", "bob", args.clone(), 1000)["title"],
        "private"
    );
    assert!(read(&mut e, "hiddenClub", "carol", args, 1000).is_null());
}
#[test]
fn media_link_revocation_and_expiry_have_separate_custody() {
    let mut e = engine("table mediaDocuments:");
    let d = write(
        &mut e,
        "mediaDocument",
        "alice",
        json!({"title":"private image"}),
        1000,
    );
    let asset = e.store_asset("alice", PNG, 1000).unwrap();
    write(
        &mut e,
        "placeMedia",
        "alice",
        json!({"document":d["id"],"image":wire::to_json(&asset.column_value())}),
        1000,
    );
    assert!(e.asset_access("bob", &asset.id, 1000).is_err());
    let secret = "0123456789abcdef0123456789abcdef";
    write(
        &mut e,
        "mediaLink",
        "service:ops",
        json!({"document":d["id"],"secret":secret,"expiresAt":2000}),
        1000,
    );
    write(&mut e, "claimMedia", "bob", json!({"secret":secret}), 1000);
    let args = json!({"document":d["id"]});
    assert!(!read(&mut e, "mediaDocumentById", "bob", args.clone(), 1000).is_null());
    assert!(e.asset_access("bob", &asset.id, 1000).is_ok());
    write(
        &mut e,
        "revokeMediaLink",
        "service:ops",
        json!({"secret":secret}),
        1000,
    );
    fail(
        &mut e,
        "claimMedia",
        "carol",
        json!({"secret":secret}),
        1000,
        "BAD_LINK",
    );
    assert!(!read(&mut e, "mediaDocumentById", "bob", args.clone(), 1000).is_null());
    write(
        &mut e,
        "revokeMediaReader",
        "service:ops",
        json!({"document":d["id"],"who":"bob"}),
        1000,
    );
    assert!(read(&mut e, "mediaDocumentById", "bob", args.clone(), 1000).is_null());
    assert!(e.asset_access("bob", &asset.id, 1000).is_err());
    let secret2 = "fedcba9876543210fedcba9876543210";
    write(
        &mut e,
        "mediaLink",
        "service:ops",
        json!({"document":d["id"],"secret":secret2,"expiresAt":2000}),
        1000,
    );
    write(
        &mut e,
        "claimMedia",
        "carol",
        json!({"secret":secret2}),
        1000,
    );
    assert!(!read(&mut e, "mediaDocumentById", "carol", args.clone(), 1999).is_null());
    assert!(read(&mut e, "mediaDocumentById", "carol", args.clone(), 2000).is_null());
    assert!(e.asset_access("carol", &asset.id, 2000).is_err());
    assert!(!read(&mut e, "mediaDocumentById", "alice", args, 2000).is_null());
}

#[test]
fn public_metadata_self_join_does_not_publish_private_payload() {
    let mut e = engine("table clubCatalogue:");
    for open in [false, true] {
        let c = write(
            &mut e,
            "catalogueClub",
            "alice",
            json!({"title":"visible","open":open,"body":"private"}),
            1000,
        );
        let args = json!({"club":c["id"]});
        assert_eq!(
            read(&mut e, "catalogueClubById", "bob", args.clone(), 1000)["title"],
            "visible"
        );
        assert!(read(&mut e, "clubSheet", "bob", args.clone(), 1000).is_null());
        if open {
            write(&mut e, "selfJoinClub", "bob", args.clone(), 1000);
            assert_eq!(
                read(&mut e, "clubSheet", "bob", args, 1000)["body"],
                "private"
            );
        } else {
            fail(&mut e, "selfJoinClub", "bob", args, 1000, "E_RULE");
        }
    }
}
#[test]
fn hidden_only_page_is_complete_empty_and_never_a_denial() {
    let source = "table readers:\n  scope: text <=20\n  principal: principal\n  unique scope, principal\n  read <- .principal = viewer\n  online only\ntable secrets:\n  scope: text <=20\n  body: text <=80\n  read <- exists readers[.scope, viewer]\n  online only\nquery page(c: cursor ?):\n  return secrets where .scope = 'private' first 20 by .id after c\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    seed(
        &mut e,
        "secrets",
        json!({"id":"s","scope":"private","body":"hidden"}),
    );
    let c = ctx(&e, "page", "bob", json!({"c":null}), 1000);
    let page = e.query("page", c).unwrap();
    assert_eq!(wire::to_json(&page.data), json!([]));
    assert!(page.complete);
    assert!(page.next.is_none());
    assert!(page.cut.is_none());
}
