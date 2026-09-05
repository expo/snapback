mod common;

use common::{Project, json_stdout};
use std::fs;

const SCHEMA: &str = r#"use identity password

table groups:
  title: text <=20
  public

table profiles:
  principal: principal
  name: text <=20
  unique byPrincipal: principal
  read <- .principal = viewer

table shares:
  item: items
  principal: principal
  unique byItemPrincipal: item, principal
  read <- .principal = viewer

table items:
  owner: principal
  group: groups
  at: time
  by byGroup: group, at, id
  read <- exists shares[.id, viewer]

table snapshots:
  items: json <=4096
  public
"#;

fn fixture(schema: &str, source: &str) -> Project {
    let project = Project::new();
    let backend = project.path.join("snapback");
    fs::create_dir(&backend).unwrap();
    fs::write(backend.join("schema.q"), schema).unwrap();
    fs::write(backend.join("items.q"), source).unwrap();
    project
}

fn assert_compiles(schema: &str, source: &str) {
    let project = fixture(schema, source);
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    assert_eq!(json_stdout(&checked)["operations"], 1);
}

fn assert_structural_refusal(source: &str, sink: &str) {
    let project = fixture(SCHEMA, source);
    let checked = project.run(&["check", "--json"]);
    assert_eq!(checked.status.code(), Some(1));
    let refusals: Vec<serde_json::Value> = String::from_utf8(checked.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(
        refusals
            .iter()
            .any(|refusal| refusal["code"] == "E_STRUCTURAL_COUNT"
                && refusal["message"].as_str().unwrap().starts_with(sink)),
        "{refusals:?}"
    );
}

#[test]
fn quarry_nonuniform_bare_page_compiles() {
    assert_compiles(
        SCHEMA,
        "query list(group: groups):\n  return items[group] first 50\n",
    );
}

#[test]
fn quarry_nonuniform_enriched_page_compiles() {
    assert_compiles(
        SCHEMA,
        "query list(group: groups):\n  return items[group] first 50 { id, owner: profiles[.owner] { name } }\n",
    );
}

#[test]
fn quarry_uniform_enriched_page_compiles() {
    assert_compiles(
        &SCHEMA.replace("read <- exists shares[.id, viewer]", "read <- allow"),
        "query list(group: groups):\n  return items[group] first 50 { id, owner: profiles[.owner] { name } }\n",
    );
}

#[test]
fn quarry_nonuniform_count_still_refuses() {
    assert_structural_refusal(
        "query list(group: groups):\n  return count(items[group] first 50)\n",
        "returned result",
    );
}

#[test]
fn quarry_nonuniform_require_still_refuses() {
    assert_structural_refusal(
        "query list(group: groups):\n  require count(items[group] first 50) > 0 else EMPTY\n  return true\n",
        "require branch",
    );
}

#[test]
fn quarry_nonuniform_insert_still_refuses() {
    assert_structural_refusal(
        "mutation list(group: groups):\n  insert snapshots { items: items[group] first 50 }\n  return true\n",
        "inserted value",
    );
}

#[test]
fn quarry_chat_list_with_nonuniform_membership_rule_compiles() {
    let schema = r#"use identity password

table conversations:
  title: text <=50
  read <- exists memberships[.id, viewer]

table memberships:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId
  read <- exists shares[.id, viewer]

table shares:
  membership: memberships
  principal: principal
  unique byMembershipPrincipal: membership, principal
  read <- .principal = viewer
"#;
    let project = fixture(schema, "");
    fs::remove_file(project.path.join("snapback/items.q")).unwrap();
    fs::write(project.path.join("snapback/chats.q"),
        "query list():\n  return memberships[viewer] first 100 by byPrincipalConversation { conversationId, conversation: conversations[.conversationId] { title } }\n").unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    assert_eq!(json_stdout(&checked)["operations"], 1);
}
