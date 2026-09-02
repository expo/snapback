use super::*;
use pretty_assertions::assert_eq;
use snapback2_core::engine::RowRecord;

#[test]
fn client_replay_requires_exact_authority_even_when_the_hidden_row_is_held() {
    let schema = spike_schema();
    let program = hidden_rule_program();
    let certificate = checker(&schema).check(&program).unwrap();
    let context = query_context([("id", id("doc1"))]);
    let entitlement = row([("id", id("ent1")), ("userId", id("u1"))]);
    let document = row([("id", id("doc1")), ("title", text("Private"))]);

    let mut server = Engine::memory(schema.clone()).unwrap();
    server.seed("entitlements", entitlement.clone()).unwrap();
    server.seed("secretDocs", document.clone()).unwrap();
    let served = server
        .execute(&program, &certificate, context.clone())
        .unwrap();
    assert_eq!(served.result, document);
    assert_eq!(served.receipt.verdicts.len(), 1);

    let mut held = served.receipt.clone();
    held.rows.push(RowRecord {
        table: "entitlements".to_owned(),
        id: "ent1".to_owned(),
        row: entitlement,
    });
    let mut matching = ClientStore::hydrate(schema.clone(), &held).unwrap();
    let (state, replayed) = matching
        .reexecute(&program, &certificate, context.clone())
        .unwrap();
    assert_eq!(state, LocalState::Fresh);
    assert_eq!(replayed.result, served.result);

    let mut missing = held.clone();
    missing.verdicts.clear();
    let mut stale = Vec::new();
    stale.push(("missing", missing.clone()));
    for (name, mutate) in [
        ("rule hash", 0_u8),
        ("input digest", 1),
        ("principal", 2),
        ("auth epoch", 3),
    ] {
        let mut receipt = held.clone();
        match mutate {
            0 => receipt.verdicts[0].rule_hash = "stale-rule".to_owned(),
            1 => receipt.verdicts[0].pinned_inputs_digest = "stale-input".to_owned(),
            2 => receipt.verdicts[0].principal = "u2".to_owned(),
            _ => receipt.verdicts[0].auth_epoch += 1,
        }
        stale.push((name, receipt));
    }
    for (name, receipt) in stale {
        let mut client = ClientStore::hydrate(schema.clone(), &receipt).unwrap();
        let (state, replayed) = client
            .reexecute(&program, &certificate, context.clone())
            .unwrap();
        assert_eq!(replayed.result, Value::Null, "{name}");
        assert_eq!(
            state,
            LocalState::Partial(vec!["missing-authority".to_owned()]),
            "{name}"
        );
    }

    let mut negated_schema = schema.clone();
    let hidden = negated_schema.tables["secretDocs"].rules.read.clone();
    negated_schema
        .tables
        .get_mut("secretDocs")
        .unwrap()
        .rules
        .read = RuleExpr::Not(Box::new(hidden));
    let negated_certificate = checker(&negated_schema).check(&program).unwrap();
    let mut negated = ClientStore::hydrate(negated_schema, &missing).unwrap();
    let (state, replayed) = negated
        .reexecute(&program, &negated_certificate, context)
        .unwrap();
    assert_eq!(replayed.result, Value::Null);
    assert_eq!(
        state,
        LocalState::Partial(vec!["missing-authority".to_owned()])
    );

    let mut mutation_schema = schema;
    let mutation_rule = mutation_schema.tables["secretDocs"].rules.read.clone();
    mutation_schema
        .tables
        .get_mut("secretDocs")
        .unwrap()
        .rules
        .insert = mutation_rule;
    let mutation = write_program(
        "stageThenRequireAuthority",
        vec![
            Stmt::Insert {
                table: "users".to_owned(),
                row: literal_row(row([
                    ("id", id("staged")),
                    ("principal", id("staged")),
                    ("handle", text("staged")),
                ])),
            },
            Stmt::Insert {
                table: "secretDocs".to_owned(),
                row: literal_row(row([("id", id("doc2")), ("title", text("Blocked"))])),
            },
        ],
    );
    let mutation_certificate = checker(&mutation_schema).check(&mutation).unwrap();
    let mut mutation_receipt = missing;
    mutation_receipt
        .rows
        .retain(|row| row.table == "entitlements");
    mutation_receipt.absences.extend([
        (
            "users".to_owned(),
            "byHandle".to_owned(),
            vec![text("staged")],
        ),
        (
            "users".to_owned(),
            "byPrincipal".to_owned(),
            vec![id("staged")],
        ),
    ]);
    mutation_receipt.schema_hash = Some(mutation_schema.hash());
    let mut mutation_client = ClientStore::hydrate(mutation_schema, &mutation_receipt).unwrap();
    let (state, execution) = mutation_client
        .apply_mutation(
            &mutation,
            &mutation_certificate,
            mutation_context([], Vec::<String>::new()),
        )
        .unwrap();
    assert_eq!(
        state,
        LocalState::Partial(vec!["missing-authority".to_owned()])
    );
    assert_eq!(execution.result, Value::Null);
    assert!(mutation_client.rows("users").unwrap().is_empty());
    assert!(mutation_client.rows("secretDocs").unwrap().is_empty());
}
