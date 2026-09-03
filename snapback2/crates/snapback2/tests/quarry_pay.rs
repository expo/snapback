mod common;

use common::{OwnerGuard, Project, json_stdout};
use serde_json::{Value as Json, json};
use snapback2_core::{
    Actor, Builtin, Ceilings, Checker, Context, Engine, Execution, Expr, Program, ProgramKind,
    RuntimeError, Schema, Stmt, Value,
};
use std::collections::BTreeMap;
use std::path::Path;

fn run_as(project: &Project, persona: &str, operation: &str, arguments: Json) -> Json {
    let arguments = arguments.to_string();
    json_stdout(&project.run(&["run", operation, &arguments, "--as", persona, "--json"]))
}

fn assert_rejected(value: &Json, code: &str, family: Option<&str>) {
    assert!(
        (value["state"] == "rejected" && value["code"] == code)
            || (value["state"] == "denied" && value["rule"] == code)
            || (family == Some("input") && value.get("state").is_none()),
        "{value}"
    );
    if value["state"] != "denied" {
        assert_eq!(value["code"], code, "{value}");
    }
    if let Some(family) = family {
        assert_eq!(value["family"], family, "{value}");
    }
}

fn data_rows(value: &Json) -> &[Json] {
    value["data"]
        .as_array()
        .unwrap_or_else(|| panic!("{value}"))
}

fn execute_share(
    amount: i64,
    recipients: &[&str],
    recipient: &str,
) -> Result<Execution, RuntimeError> {
    let program = Program {
        name: "pay.shareRuntimeProbe".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Builtin {
            builtin: Builtin::DeterministicShare,
            args: vec![
                Expr::Literal(Value::Int(amount)),
                Expr::Literal(Value::Array(
                    recipients
                        .iter()
                        .map(|value| Value::Id((*value).to_owned()))
                        .collect(),
                )),
                Expr::Literal(Value::Id(recipient.to_owned())),
            ],
        })],
    };
    let schema = Schema::default();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    Engine::memory(schema)?.execute(
        &program,
        &certificate,
        Context::query(Actor::user("share-probe").unwrap(), BTreeMap::new()),
    )
}

#[test]
fn pay_share_runtime_refuses_empty_duplicate_and_missing_recipients() {
    let empty = execute_share(100, &[], "user-alice").unwrap_err();
    assert_eq!(empty.code(), "E_DIV_ZERO");

    let duplicate = execute_share(100, &["user-alice", "user-alice"], "user-alice").unwrap_err();
    assert_eq!(duplicate.code(), "E_INPUT");
    assert!(duplicate.to_string().contains("unique"));

    let missing = execute_share(100, &["user-alice", "user-bob"], "user-carol").unwrap_err();
    assert_eq!(missing.code(), "E_INPUT");
    assert!(missing.to_string().contains("missing"));
}

#[test]
fn pay_share_runtime_assigns_extra_units_by_sorted_id_not_input_order() {
    let recipients = ["user-carol", "user-bob", "user-alice"];
    let shares = recipients
        .iter()
        .map(|recipient| execute_share(1_181, &recipients, recipient).unwrap().result)
        .collect::<Vec<_>>();
    assert_eq!(
        shares,
        vec![Value::Int(393), Value::Int(394), Value::Int(394)]
    );
}

#[test]
fn clique_pay_runs_exact_money_sends_splits_settlement_and_privacy() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    std::fs::remove_file(project.path.join("snapback/todos.q")).unwrap();
    std::fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    std::fs::create_dir_all(project.path.join("snapback/tests")).unwrap();

    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-clique/snapback");
    for file in ["schema.q", "chat.q", "social.q", "pay.q"] {
        std::fs::copy(fixture.join(file), project.path.join("snapback").join(file)).unwrap();
    }
    std::fs::copy(
        fixture.join("tests/pay.test.ts"),
        project.path.join("snapback/tests/pay.test.ts"),
    )
    .unwrap();

    let users = ["alice", "bob", "carol", "dave"]
        .into_iter()
        .map(|name| {
            json!({
                "id": format!("user-{name}"),
                "principal": format!("dev:{name}"),
                "displayName": format!("{}{}", name[..1].to_uppercase(), &name[1..]),
                "handle": name,
                "bio": null,
                "location": null,
                "link": null,
                "followerCount": 0,
                "followingCount": 0,
            })
        })
        .collect::<Vec<_>>();
    let members = ["alice", "bob", "carol"]
        .into_iter()
        .map(|name| {
            json!({
                "id": format!("member-{name}"),
                "conv": "conversation-group",
                "user": format!("dev:{name}"),
                "role": if name == "alice" { "admin" } else { "member" },
                "joinedAt": 0,
                "lastDeliveredAt": null,
                "lastReadAt": null,
            })
        })
        .collect::<Vec<_>>();
    let inbox = ["alice", "bob", "carol"]
        .into_iter()
        .map(|name| {
            json!({
                "id": format!("inbox-{name}"),
                "user": format!("dev:{name}"),
                "conv": "conversation-group",
                "joinedAt": 0,
            })
        })
        .collect::<Vec<_>>();
    let deposits = ["alice", "bob", "carol"]
        .into_iter()
        .map(|name| {
            json!({
                "id": format!("deposit-{name}"),
                "owner": format!("dev:{name}"),
                "counterparty": format!("dev:{name}"),
                "amount": 10_000,
                "kind": "deposit",
                "note": null,
                "expense": null,
                "at": 0,
            })
        })
        .collect::<Vec<_>>();
    let seed = json!({
        "personas": ["alice", "bob", "carol", "dave"],
        "rows": {
            "users": users,
            "conversations": [{
                "id": "conversation-group",
                "kind": "group",
                "name": "Friends",
                "description": null,
                "creator": "dev:alice",
                "createdAt": 0,
                "lastAt": 0,
            }],
            "members": members,
            "inbox": inbox,
            "ledger": deposits,
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

    {
        let _owner = OwnerGuard::start(&project);

        for (persona, expected) in [
            ("alice", 10_000),
            ("bob", 10_000),
            ("carol", 10_000),
            ("dave", 0),
        ] {
            let balance = run_as(&project, persona, "pay.myBalance", json!({}));
            assert_eq!(balance["data"], expected, "{balance}");
        }

        let alice_before = run_as(&project, "alice", "pay.myLedger", json!({}));
        let bob_before = run_as(&project, "bob", "pay.myLedger", json!({}));
        assert_eq!(data_rows(&alice_before).len(), 1, "{alice_before}");
        assert_eq!(data_rows(&bob_before).len(), 1, "{bob_before}");

        let sent = run_as(
            &project,
            "alice",
            "pay.sendMoney",
            json!({ "to": "user-bob", "amount": 250, "note": "lunch" }),
        );
        assert_eq!(sent["state"], "committed", "{sent}");
        assert_eq!(sent["data"], 9_750, "{sent}");
        assert_eq!(
            run_as(&project, "alice", "pay.myBalance", json!({}))["data"],
            9_750
        );
        assert_eq!(
            run_as(&project, "bob", "pay.myBalance", json!({}))["data"],
            10_250
        );

        let alice_ledger = run_as(&project, "alice", "pay.myLedger", json!({}));
        let bob_ledger = run_as(&project, "bob", "pay.myLedger", json!({}));
        assert_eq!(data_rows(&alice_ledger).len(), 2, "{alice_ledger}");
        assert_eq!(data_rows(&bob_ledger).len(), 2, "{bob_ledger}");
        let debit = data_rows(&alice_ledger)
            .iter()
            .find(|row| row["kind"] == "send")
            .unwrap();
        let credit = data_rows(&bob_ledger)
            .iter()
            .find(|row| row["kind"] == "receive")
            .unwrap();
        assert_eq!(debit["amount"], -250, "{debit}");
        assert_eq!(credit["amount"], 250, "{credit}");
        assert_eq!(debit["at"], credit["at"], "{debit} {credit}");
        assert_eq!(
            data_rows(&alice_ledger)[0]["kind"],
            "send",
            "{alice_ledger}"
        );
        assert_eq!(
            data_rows(&alice_ledger)[0]["counterpartyProfile"]["handle"],
            "bob",
            "{alice_ledger}"
        );
        assert_eq!(data_rows(&bob_ledger)[0]["kind"], "receive", "{bob_ledger}");
        assert_eq!(
            data_rows(&bob_ledger)[0]["counterpartyProfile"]["handle"],
            "alice",
            "{bob_ledger}"
        );

        let insufficient = run_as(
            &project,
            "alice",
            "pay.sendMoney",
            json!({ "to": "user-bob", "amount": 100_000, "note": null }),
        );
        assert_rejected(&insufficient, "INSUFFICIENT_FUNDS", None);
        let self_pay = run_as(
            &project,
            "alice",
            "pay.sendMoney",
            json!({ "to": "user-alice", "amount": 1, "note": null }),
        );
        assert_rejected(&self_pay, "SELF_PAY", None);
        let zero = run_as(
            &project,
            "alice",
            "pay.sendMoney",
            json!({ "to": "user-bob", "amount": 0, "note": null }),
        );
        assert_rejected(&zero, "NOT_POSITIVE", None);
        let fractional = run_as(
            &project,
            "alice",
            "pay.sendMoney",
            json!({ "to": "user-bob", "amount": 2.5, "note": null }),
        );
        assert_rejected(&fractional, "E_INPUT", Some("input"));
        let alice_after_refusals = run_as(&project, "alice", "pay.myLedger", json!({}));
        assert_eq!(
            data_rows(&alice_after_refusals).len(),
            2,
            "{alice_after_refusals}"
        );

        let dinner = run_as(
            &project,
            "alice",
            "pay.addExpense",
            json!({
                "c": "conversation-group",
                "description": "dinner",
                "total": 1_000,
                "tipRate": 1_800,
                "participants": ["user-carol", "user-alice", "user-bob"],
            }),
        );
        assert_eq!(dinner["state"], "committed", "{dinner}");
        let dinner_id = dinner["data"].as_str().expect("expense id");
        let dinner_view = run_as(
            &project,
            "alice",
            "pay.expenseShares",
            json!({ "c": "conversation-group", "e": dinner_id }),
        );
        let mut dinner_shares = data_rows(&dinner_view).to_vec();
        dinner_shares.sort_by_key(|row| row["debtor"].as_str().unwrap().to_owned());
        assert_eq!(
            dinner_shares
                .iter()
                .map(|row| json!([row["debtor"], row["amount"], row["settled"]]))
                .collect::<Vec<_>>(),
            vec![
                json!(["dev:alice", 394, true]),
                json!(["dev:bob", 393, false]),
                json!(["dev:carol", 393, false]),
            ]
        );

        let bob_open = run_as(&project, "bob", "pay.myOpenShares", json!({}));
        let bob_share = data_rows(&bob_open)
            .iter()
            .find(|row| row["expense"] == dinner_id)
            .expect("Bob dinner share");
        assert_eq!(bob_share["amount"], 393, "{bob_share}");
        assert_eq!(bob_share["expenseRow"]["description"], "dinner");
        let bob_share_id = bob_share["id"].as_str().unwrap().to_owned();

        let carol_settle = run_as(
            &project,
            "carol",
            "pay.settleShare",
            json!({ "s": bob_share_id }),
        );
        assert_rejected(&carol_settle, "NOT_YOUR_SHARE", None);
        let settled = run_as(
            &project,
            "bob",
            "pay.settleShare",
            json!({ "s": bob_share_id }),
        );
        assert_eq!(settled["state"], "committed", "{settled}");
        assert_eq!(settled["data"], true, "{settled}");
        assert_eq!(
            run_as(&project, "bob", "pay.myBalance", json!({}))["data"],
            9_857
        );
        assert_eq!(
            run_as(&project, "alice", "pay.myBalance", json!({}))["data"],
            10_143
        );
        let settled_view = run_as(
            &project,
            "alice",
            "pay.expenseShares",
            json!({ "c": "conversation-group", "e": dinner_id }),
        );
        let settled_share = data_rows(&settled_view)
            .iter()
            .find(|row| row["id"] == bob_share_id)
            .unwrap();
        assert_eq!(settled_share["settled"], true, "{settled_share}");
        assert!(
            settled_share["settledAt"].as_i64().is_some(),
            "{settled_share}"
        );
        let repeated = run_as(
            &project,
            "bob",
            "pay.settleShare",
            json!({ "s": bob_share_id }),
        );
        assert_rejected(&repeated, "ALREADY_SETTLED", None);

        let coffee = run_as(
            &project,
            "alice",
            "pay.addExpense",
            json!({
                "c": "conversation-group",
                "description": "coffee",
                "total": 1_001,
                "tipRate": 1_800,
                "participants": ["user-alice", "user-bob", "user-carol"],
            }),
        );
        assert_eq!(coffee["state"], "committed", "{coffee}");

        let cab = run_as(
            &project,
            "alice",
            "pay.addExpense",
            json!({
                "c": "conversation-group",
                "description": "cab",
                "total": 2,
                "tipRate": 1_800,
                "participants": ["user-alice", "user-bob", "user-carol"],
            }),
        );
        assert_eq!(cab["state"], "committed", "{cab}");
        let cab_view = run_as(
            &project,
            "alice",
            "pay.expenseShares",
            json!({ "c": "conversation-group", "e": cab["data"] }),
        );
        let mut cab_shares = data_rows(&cab_view).to_vec();
        cab_shares.sort_by_key(|row| row["debtor"].as_str().unwrap().to_owned());
        assert_eq!(
            cab_shares
                .iter()
                .map(|row| row["amount"].as_i64().unwrap())
                .collect::<Vec<_>>(),
            vec![1, 1, 0]
        );

        let outsider = run_as(
            &project,
            "alice",
            "pay.addExpense",
            json!({
                "c": "conversation-group",
                "description": "outsider",
                "total": 100,
                "tipRate": 0,
                "participants": ["user-alice", "user-dave"],
            }),
        );
        assert_rejected(&outsider, "PARTICIPANT_NOT_MEMBER", None);
        let duplicate = run_as(
            &project,
            "alice",
            "pay.addExpense",
            json!({
                "c": "conversation-group",
                "description": "duplicate",
                "total": 100,
                "tipRate": 0,
                "participants": ["user-alice", "user-alice"],
            }),
        );
        assert_rejected(&duplicate, "E_INPUT", Some("input"));
        let empty = run_as(
            &project,
            "alice",
            "pay.addExpense",
            json!({
                "c": "conversation-group",
                "description": "empty",
                "total": 100,
                "tipRate": 0,
                "participants": [],
            }),
        );
        assert_rejected(&empty, "NO_PARTICIPANTS", None);
        let after_refusals = run_as(
            &project,
            "alice",
            "pay.convExpenses",
            json!({ "c": "conversation-group" }),
        );
        assert_eq!(after_refusals["data"]["total"], 2_363, "{after_refusals}");
        let expenses = after_refusals["data"]["expenses"].as_array().unwrap();
        assert_eq!(expenses.len(), 3, "{after_refusals}");
        assert_eq!(
            expenses
                .iter()
                .map(|row| json!([row["description"], row["tip"], row["grand"]]))
                .collect::<Vec<_>>(),
            vec![
                json!(["cab", 0, 2]),
                json!(["coffee", 180, 1_181]),
                json!(["dinner", 180, 1_180]),
            ],
            "{after_refusals}"
        );

        let private = run_as(
            &project,
            "dave",
            "pay.convExpenses",
            json!({ "c": "conversation-group" }),
        );
        assert_rejected(&private, "NOT_MEMBER", None);
        let private_shares = run_as(
            &project,
            "dave",
            "pay.expenseShares",
            json!({ "c": "conversation-group", "e": dinner_id }),
        );
        assert_rejected(&private_shares, "NOT_MEMBER", None);
        assert_eq!(
            run_as(&project, "dave", "pay.myBalance", json!({}))["data"],
            0
        );
        let dave_send = run_as(
            &project,
            "dave",
            "pay.sendMoney",
            json!({ "to": "user-bob", "amount": 1, "note": null }),
        );
        assert_rejected(&dave_send, "INSUFFICIENT_FUNDS", None);
    }

    let journey = project.run(&["test", "--journeys-only", "--json"]);
    assert!(
        journey.status.success(),
        "{}{}",
        String::from_utf8_lossy(&journey.stdout),
        String::from_utf8_lossy(&journey.stderr)
    );
    let receipt = json_stdout(&journey);
    assert_eq!(receipt["verdict"], "pass", "{receipt}");
    let checks = receipt["checks"].as_array().unwrap();
    assert!(!checks.is_empty(), "{receipt}");
    assert!(
        checks
            .iter()
            .all(|check| check["kind"] == "journey" && check["verdict"] == "pass"),
        "{receipt}"
    );
}
