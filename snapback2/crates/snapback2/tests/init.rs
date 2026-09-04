mod common;

use common::{OwnerGuard, Project, json_stdout, shared_package_dist, snapshot};
use serde_json::Value as Json;
use std::collections::BTreeSet;
use std::path::Path;

#[cfg(unix)]
use std::os::unix::fs::{PermissionsExt, symlink};

fn built_template_precondition(rendering: &str, schema: &str) {
    let path = shared_package_dist()
        .join("templates")
        .join(rendering)
        .join("snapback")
        .join(schema);
    assert!(
        path.is_file(),
        "precondition: built template is missing at {}; run (cd packages/snapback2 && node build.mjs)",
        path.display()
    );
}

fn assert_rendering(template: &str, chat: bool) {
    built_template_precondition(template, "schema.q");
    if chat {
        built_template_precondition(template, "deliveries.q");
    }
    let project = Project::new();
    let initialized = project.init(template, "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let authored = project.path.join("snapback");
    assert!(authored.join("schema.q").is_file());
    assert!(!authored.join("schema.ts").exists());
    let agents = std::fs::read_to_string(project.path.join("AGENTS.md")).unwrap();
    assert!(agents.contains("snapback/*.q"), "{agents}");
    let stale_inspection = project.path.join(".snapback/build/quarry/stale.ts");
    if template == "todos" {
        std::fs::write(&stale_inspection, "stale").expect("write stale inspection fixture");
    }
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "check failed: {}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );

    if chat {
        let compiled: Json = serde_json::from_slice(
            &std::fs::read(project.path.join(".snapback/build/project.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            compiled["schema"]["tables"]["messages"]["retain"],
            "delivered-history"
        );
        assert_eq!(
            compiled["schema"]["tables"]["deliveries"]["retain"],
            "until-revoked"
        );
        assert_eq!(
            compiled["schema"]["tables"]["deliveries"]["rules"]["read"],
            serde_json::json!({ "Eq": [{ "Field": "recipient" }, "Viewer"] })
        );
        assert!(
            compiled["schema"]["tables"]["deliveries"]["indexes"]
                .get("byMessageKindRecipient")
                .is_none()
        );
        assert!(compiled["schema"]["tables"]["memberCounts"].is_object());
        let operations = compiled["programs"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|program| program["name"].as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            operations.len(),
            24,
            "unexpected chat operation set: {operations:?}"
        );
        for operation in [
            "deliveries.inbox",
            "deliveries.thread",
            "deliveries.post",
            "deliveries.unsend",
            "deliveries.edit",
        ] {
            assert!(
                operations.contains(operation),
                "missing {operation}: {operations:?}"
            );
        }
    }

    if template == "todos" {
        assert!(
            !stale_inspection.exists(),
            "check retained a stale Quarry inspection entry"
        );
        for generated in ["schema.ts", "todos.ts"] {
            let source = std::fs::read_to_string(
                project.path.join(".snapback/build/quarry").join(generated),
            )
            .unwrap_or_else(|error| panic!("missing Quarry inspection copy {generated}: {error}"));
            assert!(source.starts_with("// GENERATED"), "{generated}: {source}");
        }
    }

    let tested = project.run(&["test", "--json"]);
    let receipt = json_stdout(&tested);
    if chat {
        assert_eq!(tested.status.code(), Some(1), "{receipt}");
        assert_eq!(receipt["verdict"], "blocked", "{receipt}");
        let checks = receipt["checks"].as_array().unwrap();
        for check in checks.iter().filter(|check| check["kind"] == "derived") {
            if check["name"] == "effects" {
                assert_eq!(check["verdict"], "blocked", "{check}");
                assert_eq!(
                    check["detail"]["reason"], "no engine in this build",
                    "{check}"
                );
            } else if matches!(check["name"].as_str(), Some("invalidation" | "replay")) {
                // @ref LLP 1006#6-the-write-validated-not-stamped — the generic
                // prover cannot forge ready ledger rows; the asset journey below
                // supplies the physical upload/claim proof instead, so the
                // generic check passes with an explicit skipped note.
                assert_eq!(check["verdict"], "pass", "{check}");
                let skipped = check["detail"]["skipped"].as_array().unwrap();
                for operation in ["messages.sendPhoto", "messages.sendClip"] {
                    let note = skipped
                        .iter()
                        .find(|item| item["op"] == operation)
                        .unwrap_or_else(|| panic!("missing {operation} skip: {check}"));
                    assert_eq!(note["reason"], "E_ASSET_PROBE_NEEDS_UPLOAD");
                }
            } else {
                assert_eq!(check["verdict"], "pass", "{check}");
            }
        }
        let journeys = checks
            .iter()
            .filter(|check| check["kind"] == "journey")
            .collect::<Vec<_>>();
        assert_eq!(journeys.len(), 14, "{receipt}");
        assert!(
            journeys.iter().all(|check| check["verdict"] == "pass"),
            "{receipt}"
        );
    } else {
        assert!(
            tested.status.success(),
            "test failed: {}{}",
            String::from_utf8_lossy(&tested.stdout),
            String::from_utf8_lossy(&tested.stderr)
        );
        assert_eq!(receipt["verdict"], "pass", "{receipt}");
    }
}

#[test]
fn quarry_todos_init_check_and_test_end_to_end() {
    assert_rendering("todos", false);
}

#[test]
fn quarry_chat_init_check_and_test_end_to_end() {
    assert_rendering("chat", true);
}

#[test]
fn template_ts_alias_is_a_usage_error() {
    let project = Project::new();
    let initialized = project.init("ts", "none");
    assert_eq!(initialized.status.code(), Some(2));
    assert_eq!(
        String::from_utf8_lossy(&initialized.stderr),
        "usage: snapback2 init [dir] [--template todos|chat] [--client react|expo|none] [--json] (expo requires chat)\n"
    );
    assert!(project.path.read_dir().unwrap().next().is_none());
}

#[test]
fn quarry_certification_refusal_rewrite_starts_with_the_authored_line() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let path = project.path.join("snapback/todos.q");
    let mut source = std::fs::read_to_string(&path).unwrap();
    source.push_str("\nquery unsafeCount():\n  return count(todos[] first 50 by byOwnerId)\n");
    std::fs::write(path, source).unwrap();

    let checked = project.run(&["check", "--json"]);
    assert_eq!(checked.status.code(), Some(1));
    let line = String::from_utf8_lossy(&checked.stdout)
        .lines()
        .next()
        .unwrap()
        .to_owned();
    let refusal: Json = serde_json::from_str(&line).unwrap();
    assert!(
        refusal["site"]
            .as_str()
            .unwrap_or_default()
            .starts_with("snapback/todos.q:"),
        "{refusal}"
    );
    let rewrite = refusal["rewrite"].as_str().unwrap_or_default();
    assert!(
        rewrite.starts_with("query unsafeCount():\n-- "),
        "{rewrite}"
    );
}

#[test]
fn quarry_optional_reads_total_equality_and_branch_writes_execute() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    std::fs::remove_file(project.path.join("snapback/todos.q")).unwrap();
    std::fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    std::fs::write(
        project.path.join("snapback/schema.q"),
        "use identity\n\ntable nodes:\n  name: text <=50\n  parent: nodes ?\n  public\n\ntable authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by author\n\ntable counters:\n  value: int\n  public\n  insert <- allow\n",
    ).unwrap();
    std::fs::write(
        project.path.join("snapback/runtime.q"),
        "query parentName(id: nodes):\n  node = nodes[id]! else NODE_MISSING\n  return node.parent.name\n\nquery parentsEqual(left: nodes, right: nodes):\n  a = nodes[left]! else LEFT_MISSING\n  b = nodes[right]! else RIGHT_MISSING\n  return a.parent = b.parent\n\nquery parentsDifferent(left: nodes, right: nodes):\n  a = nodes[left]! else LEFT_MISSING\n  b = nodes[right]! else RIGHT_MISSING\n  return a.parent != b.parent\n\nquery present(watermark: time ?):\n  if watermark != null:\n    return true\n  return false\n\nquery alicePosts(author: authors):\n  return posts[author] first 5\n\nmutation branchWrite(useFirst: bool):\n  if useFirst:\n    insert counters { value: 1 }\n  else:\n    insert counters { value: 2 }\n  return null\n",
    ).unwrap();
    std::fs::write(
        project.path.join("snapback/seed.ts"),
        "import { seed } from 'snapback2';\nexport default seed({ personas: ['alice'], rows: { nodes: [{ id: 'root', name: 'Root', parent: null }, { id: 'absent-b', name: 'Absent B', parent: null }, { id: 'present-a', name: 'Present A', parent: 'root' }, { id: 'present-b', name: 'Present B', parent: 'root' }], authors: [{ id: 'author-alice', name: 'Alice' }, { id: 'author-bob', name: 'Bob' }], posts: [{ id: 'post-alice', author: 'author-alice' }, { id: 'post-bob', author: 'author-bob' }], counters: [] } });\n",
    ).unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    let _owner = OwnerGuard::start(&project);
    let run = |op: &str, args: &str| {
        json_stdout(&project.run(&["run", op, args, "--as", "alice", "--json"]))
    };

    let parent = run("runtime.parentName", r#"{"id":"root"}"#);
    assert_eq!(parent["state"], "complete", "{parent}");
    assert!(parent["data"].is_null(), "{parent}");
    assert_eq!(
        run("runtime.present", r#"{"watermark":null}"#)["data"],
        false
    );
    assert_eq!(run("runtime.present", r#"{"watermark":123}"#)["data"], true);
    for (left, right, equal) in [
        ("root", "absent-b", true),
        ("root", "present-a", false),
        ("present-a", "root", false),
        ("present-a", "present-b", true),
    ] {
        let args = format!(r#"{{"left":"{left}","right":"{right}"}}"#);
        assert_eq!(run("runtime.parentsEqual", &args)["data"], equal);
        assert_eq!(run("runtime.parentsDifferent", &args)["data"], !equal);
    }
    let posts = run("runtime.alicePosts", r#"{"author":"author-alice"}"#);
    assert_eq!(posts["state"], "complete", "{posts}");
    assert_eq!(posts["data"].as_array().map(Vec::len), Some(1), "{posts}");
    assert_eq!(posts["data"][0]["id"], "post-alice", "{posts}");
    for value in [true, false] {
        let written = run("runtime.branchWrite", &format!(r#"{{"useFirst":{value}}}"#));
        assert_eq!(written["state"], "committed", "{written}");
    }
}

#[test]
fn quarry_surface_branch_write_executes_both_arms() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    std::fs::remove_file(project.path.join("snapback/todos.q")).unwrap();
    std::fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-surface/snapback");
    for file in ["schema.q", "surface.q"] {
        std::fs::copy(fixture.join(file), project.path.join("snapback").join(file)).unwrap();
    }
    std::fs::write(
        project.path.join("snapback/seed.ts"),
        r#"import { seed } from 'snapback2';
export default seed({
  personas: ['alice'],
  rows: {
    groups: [{ id: 'group-1', owner: 'dev:alice', label: 'Group' }],
    posts: [
      { id: 'post-1', author: 'dev:alice', group: 'group-1', body: 'first', at: 10, editedAt: null, visible: true, mood: 'plain' },
      { id: 'post-2', author: 'dev:alice', group: 'group-1', body: 'second', at: 20, editedAt: null, visible: true, mood: 'plain' },
      { id: 'post-3', author: 'dev:alice', group: 'group-1', body: 'third', at: 30, editedAt: null, visible: true, mood: 'plain' },
    ],
    counters: [],
    keyedRows: [
      { id: 'keyed-update', owner: 'dev:alice', label: 'update', value: 1 },
      { id: 'keyed-delete', owner: 'dev:alice', label: 'delete', value: 2 },
      { id: 'keyed-authored-present', owner: 'dev:alice', label: 'authored-present', value: 3 },
      { id: 'keyed-id-in-use', owner: 'dev:alice', label: 'id-in-use-original', value: 4 },
    ],
  },
});
"#,
    )
    .unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    let _owner = OwnerGuard::start(&project);
    let run = |op: &str, args: &str| {
        json_stdout(&project.run(&["run", op, args, "--as", "alice", "--json"]))
    };
    let after = run("surface.postsAfter", r#"{"author":"dev:alice","c":null}"#);
    assert_eq!(after["state"], "complete", "{after}");
    assert_eq!(after["data"].as_array().map(Vec::len), Some(3), "{after}");
    assert_eq!(after["next"], serde_json::Value::Null, "{after}");

    for value in [true, false] {
        let result = run("surface.branchWrite", &format!(r#"{{"useFirst":{value}}}"#));
        assert_eq!(result["state"], "committed", "{result}");
    }

    let updated = run(
        "surface.updateKeyedRow",
        r#"{"owner":"dev:alice","label":"update","value":11}"#,
    );
    assert_eq!(updated["state"], "committed", "{updated}");
    let update_read = run(
        "surface.keyedRow",
        r#"{"owner":"dev:alice","label":"update"}"#,
    );
    assert_eq!(update_read["data"]["id"], "keyed-update", "{update_read}");
    assert_eq!(update_read["data"]["value"], 11, "{update_read}");
    for (operation, args) in [
        (
            "surface.updateKeyedRow",
            r#"{"owner":"dev:alice","label":"missing-update","value":1}"#,
        ),
        (
            "surface.deleteKeyedRow",
            r#"{"owner":"dev:alice","label":"missing-delete"}"#,
        ),
    ] {
        let missing = run(operation, args);
        assert_eq!(missing["state"], "rejected", "{missing}");
        assert_eq!(missing["code"], "NOT_FOUND", "{missing}");
        assert_eq!(missing["family"], "input", "{missing}");
    }

    let upserted = run(
        "surface.upsertKeyedRow",
        r#"{"owner":"dev:alice","label":"upsert","value":21}"#,
    );
    assert_eq!(upserted["state"], "committed", "{upserted}");
    let upsert_read = run(
        "surface.keyedRow",
        r#"{"owner":"dev:alice","label":"upsert"}"#,
    );
    assert_eq!(upsert_read["data"]["value"], 21, "{upsert_read}");
    let upsert_id = upsert_read["data"]["id"]
        .as_str()
        .expect("alternate upsert inserted an id")
        .to_owned();
    let upsert_updated = run(
        "surface.upsertKeyedRow",
        r#"{"owner":"dev:alice","label":"upsert","value":22}"#,
    );
    assert_eq!(upsert_updated["state"], "committed", "{upsert_updated}");
    let upsert_update_read = run(
        "surface.keyedRow",
        r#"{"owner":"dev:alice","label":"upsert"}"#,
    );
    assert_eq!(
        upsert_update_read["data"]["id"], upsert_id,
        "{upsert_update_read}"
    );
    assert_eq!(
        upsert_update_read["data"]["value"], 22,
        "{upsert_update_read}"
    );

    let authored_absent = run(
        "surface.upsertKeyedRowWithId",
        r#"{"owner":"dev:alice","label":"migrated-upsert","value":31}"#,
    );
    assert_eq!(authored_absent["state"], "committed", "{authored_absent}");
    let authored_absent_read = run(
        "surface.keyedRow",
        r#"{"owner":"dev:alice","label":"migrated-upsert"}"#,
    );
    assert_eq!(
        authored_absent_read["data"]["value"], 31,
        "{authored_absent_read}"
    );
    let migrated_id = authored_absent_read["data"]["id"].clone();

    let authored_present = run(
        "surface.upsertKeyedRowWithId",
        r#"{"owner":"dev:alice","label":"migrated-upsert","value":32}"#,
    );
    assert_eq!(authored_present["state"], "committed", "{authored_present}");
    let authored_present_read = run(
        "surface.keyedRow",
        r#"{"owner":"dev:alice","label":"migrated-upsert"}"#,
    );
    assert_eq!(
        authored_present_read["data"]["id"], migrated_id,
        "{authored_present_read}"
    );
    assert_eq!(
        authored_present_read["data"]["value"], 32,
        "{authored_present_read}"
    );

    let deleted = run(
        "surface.deleteKeyedRow",
        r#"{"owner":"dev:alice","label":"delete"}"#,
    );
    assert_eq!(deleted["state"], "committed", "{deleted}");
    let delete_read = run(
        "surface.keyedRow",
        r#"{"owner":"dev:alice","label":"delete"}"#,
    );
    assert!(delete_read["data"].is_null(), "{delete_read}");

    let scalar_update_missing = run(
        "surface.updateKeyedRowById",
        r#"{"id":"missing-scalar-update","value":1}"#,
    );
    assert_eq!(
        scalar_update_missing["state"], "rejected",
        "{scalar_update_missing}"
    );
    assert_eq!(
        scalar_update_missing["code"], "NOT_FOUND",
        "{scalar_update_missing}"
    );
    assert_eq!(
        scalar_update_missing["family"], "input",
        "{scalar_update_missing}"
    );
    let scalar_delete_missing = run(
        "surface.deleteKeyedRowById",
        r#"{"id":"missing-scalar-delete"}"#,
    );
    assert_eq!(
        scalar_delete_missing["state"], "rejected",
        "{scalar_delete_missing}"
    );
    assert_eq!(
        scalar_delete_missing["code"], "NOT_FOUND",
        "{scalar_delete_missing}"
    );
    assert_eq!(
        scalar_delete_missing["family"], "input",
        "{scalar_delete_missing}"
    );
}

#[test]
fn quarry_clique_sends_a_dm_and_pages_feed_with_an_opaque_cursor() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    std::fs::remove_file(project.path.join("snapback/todos.q")).unwrap();
    std::fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-clique/snapback");
    for file in ["schema.q", "chat.q", "social.q"] {
        std::fs::copy(fixture.join(file), project.path.join("snapback").join(file)).unwrap();
    }

    let posts = (0..21)
        .map(|index| {
            serde_json::json!({
                "id": format!("post-{index:02}"),
                "author": "dev:alice",
                "body": format!("post {index}"),
                "parent": null,
                "at": index,
                "likeCount": 0,
                "replyCount": 0,
                "repostCount": 0,
            })
        })
        .collect::<Vec<_>>();
    let feed_items = (0..21)
        .map(|index| {
            serde_json::json!({
                "id": format!("feed-{index:02}"),
                "actor": "dev:alice",
                "post": format!("post-{index:02}"),
                "kind": "post",
                "origAuthor": "dev:alice",
                "at": index,
                "ord": index,
            })
        })
        .collect::<Vec<_>>();
    let seed = serde_json::json!({
        "personas": ["alice", "bob"],
        "rows": {
            "users": [
                {
                    "id": "user-alice", "principal": "dev:alice", "displayName": "Alice",
                    "handle": "alice", "bio": null, "location": null, "link": null,
                    "followerCount": 0, "followingCount": 0,
                },
                {
                    "id": "user-bob", "principal": "dev:bob", "displayName": "Bob",
                    "handle": "bob", "bio": null, "location": null, "link": null,
                    "followerCount": 0, "followingCount": 0,
                },
            ],
            "posts": posts,
            "feedItems": feed_items,
        },
    });
    std::fs::write(
        project.path.join("snapback/seed.ts"),
        format!("import {{ seed }} from 'snapback2';\nexport default seed({seed});\n"),
    )
    .unwrap();

    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    let _owner = OwnerGuard::start(&project);
    let run = |op: &str, args: &str| {
        json_stdout(&project.run(&["run", op, args, "--as", "alice", "--json"]))
    };

    let followed = run("social.toggleFollow", r#"{"u":"user-bob"}"#);
    assert_eq!(followed["state"], "committed", "{followed}");
    assert_eq!(followed["data"], true, "{followed}");
    let alice_after_follow = run("social.profile", r#"{"u":"user-alice"}"#);
    let bob_after_follow = run("social.profile", r#"{"u":"user-bob"}"#);
    assert_eq!(
        alice_after_follow["data"]["followingCount"], 1,
        "{alice_after_follow}"
    );
    assert_eq!(
        bob_after_follow["data"]["followerCount"], 1,
        "{bob_after_follow}"
    );
    let unfollowed = run("social.toggleFollow", r#"{"u":"user-bob"}"#);
    assert_eq!(unfollowed["state"], "committed", "{unfollowed}");
    assert_eq!(unfollowed["data"], false, "{unfollowed}");
    let alice_after_unfollow = run("social.profile", r#"{"u":"user-alice"}"#);
    let bob_after_unfollow = run("social.profile", r#"{"u":"user-bob"}"#);
    assert_eq!(
        alice_after_unfollow["data"]["followingCount"], 0,
        "{alice_after_unfollow}"
    );
    assert_eq!(
        bob_after_unfollow["data"]["followerCount"], 0,
        "{bob_after_unfollow}"
    );

    let dm = run("chat.startDm", r#"{"other":"user-bob"}"#);
    assert_eq!(dm["state"], "committed", "{dm}");
    let conversation = dm["data"]
        .as_str()
        .expect("startDm returns conversation id");
    let send_args = serde_json::json!({
        "c": conversation,
        "body": "hello Bob",
        "quoted": null,
        "ord": -100,
    })
    .to_string();
    let sent = run("chat.send", &send_args);
    assert_eq!(sent["state"], "committed", "{sent}");
    assert!(sent["data"]["id"].as_str().is_some(), "{sent}");
    let thread_args = serde_json::json!({ "c": conversation, "pageCursor": null }).to_string();
    let thread = run("chat.chatThread", &thread_args);
    assert_eq!(thread["state"], "complete", "{thread}");
    assert_eq!(thread["data"].as_array().map(Vec::len), Some(1), "{thread}");
    assert_eq!(thread["data"][0]["body"], "hello Bob", "{thread}");
    assert_eq!(thread["next"], serde_json::Value::Null, "{thread}");

    let first = run("social.globalFeed", r#"{"c":null}"#);
    assert_eq!(first["state"], "capped", "{first}");
    let first_rows = first["data"].as_array().expect("first feed page");
    assert_eq!(first_rows.len(), 20, "{first}");
    let cursor = first["next"].as_str().expect("first page opaque cursor");
    let mismatched_args =
        serde_json::json!({ "c": conversation, "pageCursor": cursor }).to_string();
    let mismatched = run("chat.chatThread", &mismatched_args);
    assert_eq!(mismatched["code"], "E_INPUT", "{mismatched}");
    let second_args = serde_json::json!({ "c": cursor }).to_string();
    let second = run("social.globalFeed", &second_args);
    assert_eq!(second["state"], "complete", "{second}");
    let second_rows = second["data"].as_array().expect("second feed page");
    assert_eq!(second_rows.len(), 1, "{second}");
    let first_ids = first_rows
        .iter()
        .map(|row| row["id"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert!(
        second_rows
            .iter()
            .all(|row| !first_ids.contains(row["id"].as_str().unwrap())),
        "opaque cursor pages overlap: first={first} second={second}"
    );
}

#[test]
fn init_is_idempotent_and_second_run_is_a_content_noop() {
    let project = Project::new();
    let first = project.init("chat", "react");
    assert!(
        first.status.success(),
        "first init failed: {}{}",
        String::from_utf8_lossy(&first.stdout),
        String::from_utf8_lossy(&first.stderr)
    );
    let before = snapshot(&project.path);
    let second = project.init("chat", "react");
    assert!(
        second.status.success(),
        "second init failed: {}{}",
        String::from_utf8_lossy(&second.stdout),
        String::from_utf8_lossy(&second.stderr)
    );
    assert_eq!(before, snapshot(&project.path));
    let agents = std::fs::read_to_string(project.path.join("AGENTS.md")).unwrap();
    assert_eq!(agents.matches("<!-- snapback2:start -->").count(), 1);
    assert_eq!(agents.matches("<!-- snapback2:end -->").count(), 1);
}

#[test]
fn todos_is_the_minimal_one_table_two_operation_template() {
    let project = Project::new();
    let initialized = project.init("todos", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let compiled: Json = serde_json::from_slice(
        &std::fs::read(project.path.join(".snapback/build/project.json")).unwrap(),
    )
    .unwrap();
    let tables = compiled["schema"]["tables"].as_object().unwrap();
    let operations = compiled["programs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|program| program["name"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(tables.keys().collect::<Vec<_>>(), vec!["todos"]);
    assert_eq!(operations, vec!["todos.add", "todos.list"]);
    assert!(project.path.join("snapback/seed.ts").is_file());
    assert!(project.path.join("snapback/tests/todos.test.ts").is_file());
}

#[test]
fn chat_template_ships_exactly_its_complete_owned_tree() {
    fn files(root: &Path, directory: &Path, output: &mut Vec<String>) {
        for entry in std::fs::read_dir(directory).unwrap().flatten() {
            if entry.path().is_dir() {
                files(root, &entry.path(), output);
            } else {
                output.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }

    let project = Project::new();
    let initialized = project.init("chat", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let snapback = project.path.join("snapback");
    let mut shipped = Vec::new();
    files(&snapback, &snapback, &mut shipped);
    shipped.sort();
    assert_eq!(
        shipped,
        [
            "deliveries.q",
            "delivery.ts",
            "feeds.q",
            "follows.q",
            "groups.q",
            "messages.q",
            "notifications.q",
            "posts.q",
            "profiles.q",
            "schema.q",
            "seed.ts",
            "tests/chat.test.ts",
        ]
    );
}

#[cfg(unix)]
#[test]
fn init_refuses_managed_symlinks_without_writing_through_them() {
    let project = Project::new();
    let outside_file = project.path.parent().unwrap().join("outside-agents");
    let original = b"leave me alone\n";
    std::fs::write(&outside_file, original).unwrap();
    symlink(&outside_file, project.path.join("AGENTS.md")).unwrap();

    let file_result = project.init("todos", "none");
    assert!(!file_result.status.success());
    assert_eq!(std::fs::read(&outside_file).unwrap(), original);

    std::fs::remove_file(project.path.join("AGENTS.md")).unwrap();
    let outside_directory = project.path.parent().unwrap().join("outside-snapback");
    std::fs::create_dir(&outside_directory).unwrap();
    symlink(&outside_directory, project.path.join("snapback")).unwrap();

    let directory_result = project.init("todos", "none");
    assert!(!directory_result.status.success());
    assert_eq!(std::fs::read_dir(outside_directory).unwrap().count(), 0);
}

#[test]
fn init_refuses_non_utf8_managed_text_without_changing_bytes() {
    for name in ["AGENTS.md", ".gitignore"] {
        let project = Project::new();
        let path = project.path.join(name);
        let original = b"preserve\xffbytes\n";
        std::fs::write(&path, original).unwrap();

        let output = project.init("todos", "none");
        assert!(
            !output.status.success(),
            "init unexpectedly accepted {name}"
        );
        assert_eq!(std::fs::read(path).unwrap(), original, "changed {name}");
    }
}

#[cfg(unix)]
#[test]
fn init_refuses_unreadable_managed_text_without_changing_bytes() {
    let project = Project::new();
    let path = project.path.join("AGENTS.md");
    let original = b"write-only but existing\n";
    std::fs::write(&path, original).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o200)).unwrap();

    let output = project.init("todos", "none");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(!output.status.success());
    assert_eq!(std::fs::read(path).unwrap(), original);
}

#[test]
fn chat_expo_scaffolds_flattened_app_shared_reducers_and_sdk54_dependencies() {
    let project = Project::new();
    let output = project.init("chat", "expo");
    assert!(output.status.success(), "{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    for path in ["App.tsx", "app.json", "index.js", "src/Composer.tsx", "src/screens/Inbox.tsx", "src/screens/Thread.tsx",
        "src/screens/Search.tsx", "shared/log.ts", "shared/log.js", "shared/offline.js"] {
        assert!(project.path.join(path).is_file(), "missing {path}");
    }
    let package: Json = serde_json::from_slice(&std::fs::read(project.path.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["main"], "index.js");
    assert_eq!(package["dependencies"]["expo"], "~54.0.37");
    assert_eq!(package["dependencies"]["react-native"], "0.81.5");
    assert_eq!(package["scripts"]["dev"], "expo start");
    assert!(package["dependencies"].get("react-native-web").is_none());
    let config: Json = serde_json::from_slice(&std::fs::read(project.path.join("tsconfig.json")).unwrap()).unwrap();
    assert!(config["include"].as_array().unwrap().contains(&serde_json::json!(".snapback/build/api.d.ts")));
    assert!(std::fs::read_to_string(project.path.join("src/Composer.tsx")).unwrap().contains("post.ready"));
}

#[test]
fn chat_react_keeps_shared_reducer_imports_after_flattening() {
    let project = Project::new();
    let output = project.init("chat", "react");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    assert!(project.path.join("shared/log.ts").is_file());
    assert!(project.path.join("shared/log.js").is_file());
    assert!(std::fs::read_to_string(project.path.join("src/Thread.tsx")).unwrap().contains("../shared/log.js"));
}
