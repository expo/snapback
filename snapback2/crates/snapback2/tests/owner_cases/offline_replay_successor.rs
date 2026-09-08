//! Stored replay terminals are independent of the current certified program.
// @ref LLP 1012#7-writes-offline — authenticate the live session first, then
// answer identical retries from the principal's ledger across successors.

use super::offline_resume::{append_source, boot};
use super::*;
use crate::owner_wire::Response;
use snapback2_core::{ArgType, ColumnType};

fn replay_request(grant: &Value, offset: u64, accept: bool) -> Value {
    json!({
        "op": "replayReview.echo",
        "args": { "value": "absent", "accept": accept },
        "replay": {
            "grant": grant["id"], "offset": offset, "count": 1,
            "intent": format!("{}:{offset}", grant["id"].as_str().unwrap()),
            "trace": {
                "points": [{ "table": "replayRecords", "index": "byCode", "key": ["absent"], "digest": null }],
                "verdicts": [],
            },
        },
    })
}

fn replay(port: u16, token: &str, body: &Value) -> Response {
    let bearer = format!("Bearer {token}");
    request(
        port,
        "POST",
        "/api/mutation",
        &[("Authorization", &bearer)],
        body.clone(),
    )
}

fn apply_project(port: u16, secret: &str, project: &ProjectJson) {
    let headers = [("X-Snapback-Control", secret)];
    let applied = request(
        port,
        "POST",
        "/control/apply",
        &headers,
        json!({ "project": project }),
    );
    if applied.body["code"] == "E_SUCCESSOR_DESTRUCTIVE" {
        let migrated = request(
            port,
            "POST",
            "/control/migrate",
            &headers,
            json!({
                "project": project, "plan": applied.body["plan"],
            }),
        );
        assert_eq!(migrated.status, 200, "{}", migrated.body);
    } else {
        assert_eq!(applied.status, 200, "{}", applied.body);
    }
}

#[test]
fn offline_replay_terminals_survive_operation_and_traced_schema_successors() {
    let (root, mut owner, port, secret) = boot(|root| {
        append_source(
            root,
            "snapback/schema.q",
            r#"

table replayRecords:
  code: text <=20
  unique byCode: code
  public 'test replay metadata'
  insert <- deny
  update <- deny
  delete <- deny
"#,
        );
        append_source(
            root,
            "snapback/replayReview.q",
            r#"
mutation echo(value: text <=20, accept: bool):
  record = replayRecords[value]
  require accept else DECLINED
  return { value, record }

mutation fallback(value: text <=20, accept: bool):
  require accept else DECLINED
  return value
"#,
        );
    });
    let credentials =
        json!({ "email": "replay-successor@example.com", "password": "correct horse" });
    let signup = request(port, "POST", "/api/auth/signup", &[], credentials.clone());
    assert_eq!(signup.status, 200, "{}", signup.body);
    let login = request(port, "POST", "/api/auth/login", &[], credentials.clone());
    assert_eq!(login.status, 200, "{}", login.body);
    let token = login.body["token"].as_str().unwrap();
    let grant = &login.body["grant"];
    let committed_request = replay_request(grant, 0, true);
    let rejected_request = replay_request(grant, 1, false);
    let before = status(port, &secret);
    let committed = replay(port, token, &committed_request);
    // Even a successful mutation with no row effects crosses a new sequence.
    // A matching replay retains that sequence and does not execute it again.
    let after_commit = status(port, &secret);
    assert_eq!(committed.body["seq"], before["seq"].as_u64().unwrap() + 1);
    assert_eq!(after_commit["seq"], committed.body["seq"]);
    assert_eq!(
        after_commit["executions"],
        before["executions"].as_u64().unwrap() + 1
    );
    let retried = replay(port, token, &committed_request);
    assert_eq!(retried.body_bytes, committed.body_bytes);
    let after_retry = status(port, &secret);
    assert_eq!(after_retry["seq"], after_commit["seq"]);
    assert_eq!(after_retry["executions"], after_commit["executions"]);
    let rejected = replay(port, token, &rejected_request);
    assert_eq!(committed.status, 200, "{}", committed.body);
    assert_eq!(committed.body["state"], "committed", "{}", committed.body);
    assert_eq!(rejected.status, 200, "{}", rejected.body);
    assert_eq!(rejected.body["state"], "rejected", "{}", rejected.body);
    assert_eq!(rejected.body["code"], "DECLINED", "{}", rejected.body);

    let original: ProjectJson =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    let fallback = original
        .programs
        .iter()
        .find(|op| op.name == "replayReview.fallback")
        .unwrap();
    let mut removed = original.clone();
    removed.programs.retain(|op| op.name != "replayReview.echo");
    let mut changed_kind = original.clone();
    changed_kind
        .programs
        .iter_mut()
        .find(|op| op.name == "replayReview.echo")
        .unwrap()
        .kind = ProgramKind::Query;
    let mut changed_type = original.clone();
    changed_type
        .programs
        .iter_mut()
        .find(|op| op.name == "replayReview.echo")
        .unwrap()
        .body = fallback.body.clone();
    changed_type
        .schema
        .tables
        .get_mut("replayRecords")
        .unwrap()
        .columns
        .insert("code".to_owned(), ColumnType::Bool);
    let mut removed_index = changed_type.clone();
    removed_index
        .schema
        .tables
        .get_mut("replayRecords")
        .unwrap()
        .indexes
        .remove("byCode");
    let mut removed_table = removed_index.clone();
    removed_table.schema.tables.remove("replayRecords");
    let mut changed_args = original.clone();
    changed_args
        .programs
        .iter_mut()
        .find(|op| op.name == "replayReview.echo")
        .unwrap()
        .args
        .insert(
            "accept".to_owned(),
            ArgType::Text {
                max: 20,
                min: 0,
                format: None,
            },
        );
    // The replacement body uses no changed argument, so certification succeeds.
    changed_args
        .programs
        .iter_mut()
        .find(|op| op.name == "replayReview.echo")
        .unwrap()
        .body = vec![Stmt::Return(Expr::Literal(snapback2_core::Value::Null))];

    for (label, project, new_code) in [
        ("operation removed", removed, "E_OP_UNKNOWN"),
        ("operation is now a query", changed_kind, "E_OP_KIND"),
        ("traced key changed type", changed_type, "E_INPUT"),
        ("traced index removed", removed_index, "E_INPUT"),
        ("traced table removed", removed_table, "E_INPUT"),
        ("argument changed type", changed_args, "E_INPUT"),
    ] {
        apply_project(port, &secret, &project);
        let before = status(port, &secret);
        for (body, terminal) in [
            (&committed_request, &committed),
            (&rejected_request, &rejected),
        ] {
            let retry = replay(port, token, body);
            assert_eq!(retry.status, 200, "{label}: {}", retry.body);
            assert_eq!(
                retry.body_bytes, terminal.body_bytes,
                "{label}: byte-identical terminal"
            );
            for field in ["args", "trace"] {
                let mut different = body.clone();
                if field == "args" {
                    different["args"]["value"] = json!("different");
                } else {
                    different["replay"]["trace"]["points"][0]["table"] = json!("noSuchTable");
                }
                let refused = replay(port, token, &different);
                assert_eq!(
                    refused.body["code"], "E_OFFLINE_INTENT_REUSE",
                    "{label}, changed {field}: {}",
                    refused.body
                );
            }
        }
        let new_intent = replay(port, token, &replay_request(grant, 2, true));
        assert_eq!(
            new_intent.body["code"], new_code,
            "{label}: new intents use current validation: {}",
            new_intent.body
        );
        let after = status(port, &secret);
        assert_eq!(after["seq"], before["seq"], "{label}: no writes");
        assert_eq!(
            after["executions"], before["executions"],
            "{label}: no executions"
        );
    }

    // A foreign principal cannot fetch either recorded terminal.
    let guest = request(port, "POST", "/api/auth/guest", &[], json!({}));
    assert_eq!(guest.status, 200, "{}", guest.body);
    for body in [&committed_request, &rejected_request] {
        let foreign = replay(port, guest.body["token"].as_str().unwrap(), body);
        assert_eq!(
            foreign.body["code"], "E_OFFLINE_INTENT_EXPIRED",
            "{}",
            foreign.body
        );
        assert!(foreign.body.get("intent").is_none());
    }
    let bearer = format!("Bearer {token}");
    let logout = request(
        port,
        "POST",
        "/api/auth/logout",
        &[("Authorization", &bearer)],
        json!({}),
    );
    assert_eq!(logout.status, 200, "{}", logout.body);
    let fresh = request(port, "POST", "/api/auth/login", &[], credentials);
    assert_eq!(fresh.status, 200, "{}", fresh.body);
    assert_ne!(fresh.body["authEpoch"], login.body["authEpoch"]);
    for (body, terminal) in [
        (&committed_request, &committed),
        (&rejected_request, &rejected),
    ] {
        let dead = replay(port, token, body);
        assert_eq!(dead.status, 401, "{}", dead.body);
        assert_eq!(dead.body["code"], "E_AUTH_SESSION");
        let own = replay(port, fresh.body["token"].as_str().unwrap(), body);
        assert_eq!(own.body_bytes, terminal.body_bytes);
    }
    apply_project(port, &secret, &original);
    let unsettled = replay(
        port,
        fresh.body["token"].as_str().unwrap(),
        &replay_request(grant, 2, true),
    );
    assert_eq!(
        unsettled.body["state"], "committed",
        "validation failures never spent the intent: {}",
        unsettled.body
    );
    stop_owner(
        port,
        &secret,
        &mut owner,
        "replay successor regression complete",
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_auth_session_answers_match_the_authenticated_delivery_epoch() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let credentials = json!({ "email": "epoch-wire@example.com", "password": "correct horse" });
    let mut epochs = Vec::new();
    for (path, body) in [
        ("/api/auth/signup", credentials.clone()),
        ("/api/auth/login", credentials),
        ("/api/auth/guest", json!({})),
    ] {
        let auth = request(port, "POST", path, &[], body);
        assert_eq!(auth.status, 200, "{path}: {}", auth.body);
        let epoch = auth.body["authEpoch"]
            .as_u64()
            .expect("session epoch is public auth evidence");
        assert!(epoch > 0, "a bearer has a non-persona epoch");
        epochs.push(epoch);
        let bearer = format!("Bearer {}", auth.body["token"].as_str().unwrap());
        let headers = [("Authorization", bearer.as_str())];
        let me = request(port, "GET", "/api/auth/me", &headers, json!({}));
        assert_eq!(me.status, 200, "{}", me.body);
        assert_eq!(me.body["authEpoch"], epoch);
        assert_eq!(me.body["viewer"], auth.body["viewer"]);
        let query = request(
            port,
            "POST",
            "/api/query",
            &headers,
            json!({
                "op": "profiles.mine", "args": {}, "receipt": true,
            }),
        );
        assert_eq!(query.status, 200, "{}", query.body);
        assert_eq!(query.body["authority"]["authEpoch"], epoch);
    }
    assert_ne!(
        epochs[0], epochs[1],
        "a fresh login changes the same principal's epoch"
    );
    stop_owner(
        port,
        &secret,
        &mut owner,
        "auth epoch wire regression complete",
    );
    fs::remove_dir_all(root).unwrap();
}
