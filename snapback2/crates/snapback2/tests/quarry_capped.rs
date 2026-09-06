mod common;
#[allow(dead_code)]
mod owner_wire;

use common::{OwnerGuard, Project, json_stdout};
use serde_json::json;
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

#[test]
fn quarry_enriched_page_runs_through_owner_with_hidden_profile_null() {
    let project = fixture(
        SCHEMA,
        "query list(group: groups):\n  return items[group] first 50 { id, owner: profiles[.owner] { name } }\n",
    );
    let seed = seed_data();
    fs::write(
        project.path.join("snapback/seed.ts"),
        format!("import {{ seed }} from 'snapback2';\nexport default seed({seed});\n"),
    )
    .unwrap();
    let _owner = OwnerGuard::start(&project);
    let output = project.run(&[
        "run",
        "items.list",
        r#"{"group":"g1"}"#,
        "--as",
        "u1",
        "--json",
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let response = json_stdout(&output);
    assert_eq!(response["state"], "capped", "{response}");
    assert_eq!(
        response["data"],
        json!([
            {"id": "d1", "owner": {"name": "Visible"}}, {"id": "d2", "owner": null}
        ]),
        "{response}"
    );
    assert!(!response.to_string().contains("Secret"));
    let owner: serde_json::Value =
        serde_json::from_slice(&fs::read(project.path.join(".snapback/owner.json")).unwrap())
            .unwrap();
    let envelope = owner_wire::request(
        owner["port"].as_u64().unwrap() as u16,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "u1")],
        json!({"op": "items.list", "args": {"group": "g1"}, "receipt": true}),
    );
    assert_eq!(envelope.status, 200, "{}", envelope.body);
    assert_eq!(envelope.body["state"], "capped");
    assert!(envelope.body.get("rows").is_some(), "{}", envelope.body);
    assert!(!envelope.body.to_string().contains("Secret"));
}

#[test]
fn quarry_enriched_post_shape_count_and_require_refuse() {
    assert_structural_refusal(
        "query list(group: groups):\n  return count(items[group] first 50 { id, owner: profiles[.owner] { name } })\n",
        "returned result",
    );
    assert_structural_refusal(
        "query list(group: groups):\n  require count(items[group] first 50 { id, owner: profiles[.owner] { name } }) > 0 else EMPTY\n  return true\n",
        "require branch",
    );
}

#[test]
fn quarry_correctly_keyed_exists_over_nonuniform_scan_refuses() {
    assert_structural_refusal(
        "query list(group: groups):\n  for item in items[group] first 50:\n    return exists items[item.id]\n",
        "returned result",
    );
}

fn seed_data() -> serde_json::Value {
    json!({ "personas": ["u1", "u2"], "rows": {
        "groups": [{ "id": "g1", "title": "Group" }],
        "profiles": [
            { "id": "p1", "principal": "dev:u1", "name": "Visible" },
            { "id": "p2", "principal": "dev:u2", "name": "Secret" }
        ],
        "items": [
            { "id": "d1", "group": "g1", "owner": "dev:u1", "at": 1 },
            { "id": "d2", "group": "g1", "owner": "dev:u2", "at": 2 },
            { "id": "d3", "group": "g1", "owner": "dev:u1", "at": 3 }
        ],
        "shares": [
            { "id": "s1", "item": "d1", "principal": "dev:u1" },
            { "id": "s2", "item": "d2", "principal": "dev:u1" }
        ]
    }})
}

#[test]
fn typescript_lowered_nullable_guard_certifies_capped_and_executes_null() {
    use snapback2_core::*;
    use std::collections::BTreeMap;
    use std::process::Command;
    let project = fixture(
        SCHEMA,
        "query list(group: groups):\n  return items[group] first 50\n",
    );
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stdout)
    );
    let compiler = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/src")
        .canonicalize()
        .unwrap();
    let source = r#"import { query, t } from "snapback2";
import { groups, items, profiles } from "./schema";
export const list = query({ group: t.ref(groups) }, ({ db, args }) => {
  const collected = [];
  for (const item of db.scan(items.byGroup, [args.group], { take: 50 })) {
    const profile = db.get(profiles.byPrincipal, item.owner);
    let shape: any = null;
    if (profile !== null) { shape = { name: profile.name }; }
    collected.push({ id: item.id, owner: shape });
  }
  return collected;
});"#;
    let script = format!(
        r#"
import {{ lowerSource }} from {lower};
import {{ lowerSchema }} from {schema};
const schema = lowerSchema(await Bun.file({schema_file}).text(), "schema.ts", true);
if (schema.diagnostics.length) throw new Error(JSON.stringify(schema.diagnostics));
const result = lowerSource({source}, "items.ts", undefined, {{ tables: schema.tables }});
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
console.log(JSON.stringify(result.programs[0]));
"#,
        lower = json!(compiler.join("compiler.ts")),
        schema = json!(compiler.join("lower/schema.ts")),
        schema_file = json!(project.path.join(".snapback/build/quarry/schema.ts")),
        source = json!(source)
    );
    let script_path = project.path.join("lower-test.ts");
    fs::write(&script_path, script).unwrap();
    let output = Command::new("bun").arg(script_path).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let program: Program = serde_json::from_slice(&output.stdout).unwrap();
    let loop_body = program
        .body
        .iter()
        .find_map(|stmt| match stmt {
            Stmt::For { body, .. } => Some(body),
            _ => None,
        })
        .unwrap();
    assert!(loop_body.iter().any(|stmt| matches!(
        stmt,
        Stmt::Let {
            value: Expr::Literal(Value::Null),
            ..
        }
    )));
    assert!(
        loop_body
            .iter()
            .any(|stmt| matches!(stmt, Stmt::If { then_body, .. }
        if then_body.iter().any(|stmt| matches!(stmt, Stmt::Assign { .. }))))
    );
    let compiled: ProjectJson = serde_json::from_slice(
        &fs::read(project.path.join(".snapback/build/project.json")).unwrap(),
    )
    .unwrap();
    let certificate = Checker::new(&compiled.schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.completeness, Completeness::Capped);
    assert!(
        !certificate
            .read_sites
            .iter()
            .find(|site| site.table == "items")
            .unwrap()
            .hoist
    );
    let mut engine = Engine::memory(compiled.schema.clone()).unwrap();
    for (table, rows) in seed_data()["rows"].as_object().unwrap() {
        for row in rows.as_array().unwrap() {
            let values = row
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| {
                    let value = match &compiled.schema.tables[table].columns[key] {
                        ColumnType::Int | ColumnType::Time => Value::Int(value.as_i64().unwrap()),
                        ColumnType::Text { .. } => {
                            Value::String(value.as_str().unwrap().to_owned())
                        }
                        _ => Value::Id(value.as_str().unwrap().to_owned()),
                    };
                    (key.clone(), value)
                })
                .collect();
            engine.seed(table, Value::Row(values)).unwrap();
        }
    }
    let execution = engine
        .execute(
            &program,
            &certificate,
            Context::query(
                Actor::user("dev:u1").unwrap(),
                BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(execution.state, ExecutionState::Capped);
    assert_eq!(
        value_to_wire_json(&execution.result),
        json!([
            {"id": "d1", "owner": {"name": "Visible"}}, {"id": "d2", "owner": null}
        ])
    );
    assert!(
        !serde_json::to_string(&execution.receipt)
            .unwrap()
            .contains("Secret")
    );
}
