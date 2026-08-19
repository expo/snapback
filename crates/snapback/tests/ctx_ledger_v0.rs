//! LLP 0051 D1 (Increment 2, ENG-23892): the ctx-answer ledger — record and
//! replay of deterministic ctx answers — plus the runtime
//! deterministic-member denial on the Ibex leg for queries/mutations.
//!
//! These run Ibex-only (no workerd required); the cross-engine equivalence
//! cases live in tests/workerd_twin_v0.rs. Actions deliberately keep the
//! ambient members (`Date.now` busy-wait watchdogs are action tests —
//! tests/action_watchdog_v0.rs is the standing regression proof).

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, CTX_ANSWER_LEDGER_MAX_IDS, CTX_ANSWER_LEDGER_VERSION, CtxAnswerLedger,
    FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, IbexModule, PORTABLE_TIMESTAMP_MAX_MS, SchemaManifest, TableManifest,
    auth_fingerprint,
};

const LEDGER_MODULE_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async ledgeredIds(ctx, args) {
    var a = await ctx.runtime.id();
    var b = await ctx.runtime.id();
    var now = await ctx.runtime.now();
    var rowId = await ctx.db.insert('items', { label: 'ledger-' + args.tag, rank: 3 });
    return { a: a, b: b, now: now, rowId: rowId };
  },
  async idFlood(ctx, args) {
    var last = null;
    for (var i = 0; i < args.count; i++) { last = await ctx.runtime.id(); }
    return { last: last };
  },
  async listItems(ctx) {
    return await ctx.db.query('items').order('rank', 'asc').collect();
  },
  async insertOptionalOrderAndRead(ctx) {
    await ctx.db.insert('items', { label: 'high', rank: 2 });
    await ctx.db.insert('items', { label: 'omitted' });
    await ctx.db.insert('items', { label: 'low', rank: 1 });
    return {
      asc: await ctx.db.query('items').order('rank', 'asc').take(2).collect(),
      desc: await ctx.db.query('items').order('rank', 'desc').take(2).collect()
    };
  },
  async listLimitedItems(ctx, args) {
    return await ctx.db.query('items').order('rank', args.direction).take(2).collect();
  },
  async probeMemberDenied(ctx, args) {
    var parts = args.name.split('.');
    var holder = globalThis[parts[0]];
    var member = holder ? holder[parts[1]] : undefined;
    if (typeof member !== 'function') { return [{ denied: true, how: 'absent' }]; }
    try {
      member.call(holder);
      return [{ denied: false, how: 'callable' }];
    } catch (error) {
      var m = String(error && error.message || error);
      return [{ denied: m.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0 }];
    }
  },
  async probeDateCtor(ctx) {
    var out = { explicit: new Date(1000).getTime() === 1000 };
    try { new Date(); out.zeroArgDenied = false; } catch (e) {
      out.zeroArgDenied = String(e && e.message || e).indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0;
    }
    try { Date(); out.callDenied = false; } catch (e2) {
      out.callDenied = String(e2 && e2.message || e2).indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0;
    }
    out.parseWorks = Date.parse('2026-01-01T00:00:00Z') > 0;
    out.utcWorks = Date.UTC(2026, 0, 1) > 0;
    return [out];
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("ctx-ledger-v0".to_owned()),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "label".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                },
                FieldManifest {
                    name: "rank".to_owned(),
                    field_type: FieldType::Integer,
                    optional: true,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let define = |name: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: LEDGER_MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("ledgeredIds", FunctionKind::Mutation),
            define("idFlood", FunctionKind::Mutation),
            define("listItems", FunctionKind::Query),
            define("insertOptionalOrderAndRead", FunctionKind::Mutation),
            define("listLimitedItems", FunctionKind::Query),
            define("probeMemberDenied", FunctionKind::Query),
            define("probeDateCtor", FunctionKind::Query),
        ],
        ..FunctionManifest::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions());
    snapback
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn replay_input(args: Value, ledger: CtxAnswerLedger) -> HandlerInput {
    HandlerInput {
        ctx_ledger: Some(ledger),
        ..input(args)
    }
}

#[test]
fn record_mode_produces_the_ordered_ledger() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("ledgeredIds", input(json!({ "tag": "rec" })))
        .expect("record-mode mutation");
    let ledger = output.ctx_ledger.expect("ibex mutation carries a ledger");
    assert_eq!(ledger.version, CTX_ANSWER_LEDGER_VERSION);
    // Two runtime.id answers plus the db.insert row id, in answer order —
    // one `generatedIds` sequence (LLP 0008 wire pin).
    assert_eq!(ledger.ids.len(), 3);
    assert_eq!(output.result.get("a"), Some(&json!(ledger.ids[0])));
    assert_eq!(output.result.get("b"), Some(&json!(ledger.ids[1])));
    assert_eq!(output.result.get("rowId"), Some(&json!(ledger.ids[2])));
    assert_eq!(output.result.get("now"), Some(&json!(ledger.now)));
    // The fingerprint channel is server-retained; the output ledger never
    // carries it (D1 wire split).
    assert_eq!(ledger.auth_fingerprint, None);
}

#[test]
fn replay_mode_reproduces_the_recorded_answers() {
    let mut recorder = configured();
    let recorded = recorder
        .invoke_mutation("ledgeredIds", input(json!({ "tag": "rep" })))
        .expect("record-mode mutation");
    let ledger = recorded.ctx_ledger.clone().expect("ledger");

    // Fresh instance: replay must reproduce the result byte-for-byte —
    // same ids, same frozen clock — while reads re-evaluate live (reads are
    // never ledgered).
    let mut replayer = configured();
    let replayed = replayer
        .invoke_mutation(
            "ledgeredIds",
            replay_input(json!({ "tag": "rep" }), ledger.clone()),
        )
        .expect("replay-mode mutation");
    assert_eq!(replayed.result, recorded.result);
    // Replay echoes the consumed ledger.
    assert_eq!(
        replayed.ctx_ledger.as_ref().map(|l| &l.ids),
        Some(&ledger.ids)
    );
    assert_eq!(replayed.ctx_ledger.map(|l| l.now), Some(ledger.now));
}

#[test]
fn buffered_optional_order_fields_match_committed_null_last_ordering() {
    let mut snapback = configured();
    // Force IDs so the omitted row sorts first by ID. Before ENG-24490 the
    // buffered overlay treated its missing rank as an unorderable key and
    // fell back to this ID, while committed SQL materialized NULL and put it
    // last. The two present rows must win the limit in both directions.
    let ledger = CtxAnswerLedger {
        version: CTX_ANSWER_LEDGER_VERSION,
        ids: vec![
            snapback::ids::format_id(snapback::ids::Kind::Opaque, &[2; 16]),
            snapback::ids::format_id(snapback::ids::Kind::Opaque, &[0; 16]),
            snapback::ids::format_id(snapback::ids::Kind::Opaque, &[1; 16]),
        ],
        now: 123,
        auth_fingerprint: None,
    };
    let output = snapback
        .invoke_mutation(
            "insertOptionalOrderAndRead",
            replay_input(json!({}), ledger),
        )
        .expect("buffered ordering mutation");
    let labels = |rows: &Value| {
        rows.as_array()
            .expect("rows")
            .iter()
            .map(|row| row["label"].as_str().expect("label").to_owned())
            .collect::<Vec<_>>()
    };
    assert_eq!(labels(&output.result["asc"]), ["low", "high"]);
    assert_eq!(labels(&output.result["desc"]), ["high", "low"]);

    for (direction, expected) in [("asc", ["low", "high"]), ("desc", ["high", "low"])] {
        let committed = snapback
            .invoke_query("listLimitedItems", input(json!({ "direction": direction })))
            .expect("committed ordering query");
        assert_eq!(
            committed
                .rows
                .iter()
                .map(|row| row["label"].as_str().expect("label"))
                .collect::<Vec<_>>(),
            expected,
        );
    }
}

#[test]
fn replay_clock_is_the_persisted_clock_and_obeys_the_portable_boundary() {
    let mut recorder = configured();
    let recorded = recorder
        .invoke_mutation("ledgeredIds", input(json!({ "tag": "clock" })))
        .expect("record mutation");
    let mut ledger = recorded.ctx_ledger.expect("ledger");
    ledger.now = PORTABLE_TIMESTAMP_MAX_MS;

    let mut replayer = configured();
    let preview = replayer
        .dry_run_mutation(
            "ledgeredIds",
            replay_input(json!({ "tag": "clock" }), ledger.clone()),
        )
        .expect("dry-run replay at maximum portable timestamp");
    assert!(preview.would_commit);
    assert_eq!(preview.result["now"], json!(PORTABLE_TIMESTAMP_MAX_MS));
    assert_eq!(
        preview.ledger.as_ref().map(|value| value.now),
        Some(ledger.now)
    );
    assert_eq!(preview.changes.len(), 1);
    let provisional = preview.changes[0].row.as_ref().expect("provisional row");
    assert_eq!(provisional["_createdAt"], json!(PORTABLE_TIMESTAMP_MAX_MS));
    assert_eq!(provisional["_updatedAt"], json!(PORTABLE_TIMESTAMP_MAX_MS));

    let replayed = replayer
        .invoke_mutation(
            "ledgeredIds",
            replay_input(json!({ "tag": "clock" }), ledger.clone()),
        )
        .expect("maximum portable timestamp replays");
    assert_eq!(replayed.result["now"], json!(PORTABLE_TIMESTAMP_MAX_MS));
    assert_eq!(
        replayed.ctx_ledger.as_ref().map(|value| value.now),
        Some(ledger.now)
    );
    let rows = replayer
        .invoke_query("listItems", input(json!({})))
        .expect("query replayed row")
        .rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["_createdAt"], json!(PORTABLE_TIMESTAMP_MAX_MS));
    assert_eq!(rows[0]["_updatedAt"], json!(PORTABLE_TIMESTAMP_MAX_MS));

    let mut beyond = configured();
    ledger.now = PORTABLE_TIMESTAMP_MAX_MS + 1;
    let error = beyond
        .invoke_mutation(
            "ledgeredIds",
            replay_input(json!({ "tag": "clock" }), ledger),
        )
        .expect_err("timestamp past the portable boundary must fail before execution");
    assert_eq!(error.diagnostic.code, "SNAPBACK_TIMESTAMP_OUT_OF_RANGE");
    assert!(
        beyond
            .invoke_query("listItems", input(json!({})))
            .expect("query after rejected replay")
            .rows
            .is_empty()
    );
}

#[test]
fn replay_past_the_ledger_end_is_a_typed_divergence_error() {
    let mut recorder = configured();
    let recorded = recorder
        .invoke_mutation("ledgeredIds", input(json!({ "tag": "short" })))
        .expect("record-mode mutation");
    let mut ledger = recorded.ctx_ledger.expect("ledger");
    ledger.ids.truncate(1);

    let mut replayer = configured();
    let error = replayer
        .invoke_mutation(
            "ledgeredIds",
            replay_input(json!({ "tag": "short" }), ledger),
        )
        .expect_err("consuming past the ledger end must fail");
    assert_eq!(error.diagnostic.code, "SNAPBACK_CTX_LEDGER_EXHAUSTED");
    // Drop-and-mark-failed posture: nothing committed.
    let rows = replayer
        .invoke_query("listItems", input(json!({})))
        .expect("query")
        .rows;
    assert!(rows.is_empty(), "a diverged replay must commit nothing");
}

#[test]
fn replay_under_changed_authority_is_refused() {
    let auth = AuthInput {
        principal: Some("user".to_owned()),
        session_id: Some("sess_1".to_owned()),
        user_id: Some("user_1".to_owned()),
        ..AuthInput::default()
    };
    let mut recorder = configured();
    let mut recorded_input = input(json!({ "tag": "auth" }));
    recorded_input.auth = auth.clone();
    let recorded = recorder
        .invoke_mutation("ledgeredIds", recorded_input)
        .expect("record-mode mutation");
    let mut ledger = recorded.ctx_ledger.expect("ledger");
    // The retained fingerprint belongs to the server-resolved authority, not
    // the legacy wire/body object. In dev mode only the asserted user survives
    // canonicalization; principal and session_id are not independent authority.
    let canonical_auth = AuthInput {
        user_id: auth.user_id.clone(),
        ..AuthInput::default()
    };
    ledger.auth_fingerprint = Some(auth_fingerprint(&canonical_auth));

    // Same authority: fingerprint matches, replay proceeds.
    let mut same = configured();
    let mut same_input = replay_input(json!({ "tag": "auth" }), ledger.clone());
    same_input.auth = auth.clone();
    same.invoke_mutation("ledgeredIds", same_input)
        .expect("replay under the recorded authority succeeds");

    // Changed authority: refuse rather than replay (LLP 0043 §Auth posture).
    let mut other = configured();
    let mut other_input = replay_input(json!({ "tag": "auth" }), ledger);
    other_input.auth = AuthInput {
        principal: Some("user".to_owned()),
        session_id: Some("sess_2".to_owned()),
        user_id: Some("user_2".to_owned()),
        ..AuthInput::default()
    };
    let error = other
        .invoke_mutation("ledgeredIds", other_input)
        .expect_err("replay under a different auth context must be refused");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_STALE_RESULT");
}

#[test]
fn unknown_ledger_versions_are_refused() {
    let mut snapback = configured();
    let ledger = CtxAnswerLedger {
        version: CTX_ANSWER_LEDGER_VERSION + 1,
        ids: Vec::new(),
        now: 1,
        auth_fingerprint: None,
    };
    let error = snapback
        .invoke_mutation("ledgeredIds", replay_input(json!({ "tag": "v" }), ledger))
        .expect_err("an unknown ledger version must be refused");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED"
    );
}

#[test]
fn the_ledger_length_cap_is_a_typed_error() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation(
            "idFlood",
            input(json!({ "count": CTX_ANSWER_LEDGER_MAX_IDS + 1 })),
        )
        .expect_err("an id-generation loop past the cap must fail typed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED");
    // Under the cap stays fine.
    snapback
        .invoke_mutation("idFlood", input(json!({ "count": 16 })))
        .expect("under-cap id generation succeeds");
}

/// The Ibex deterministic-member gap is closed for queries/mutations
/// (LLP 0051 Increment 2): runtime denial, single-sourced from the allowlist
/// `members` list, plus the zero-arg Date-constructor rule (ENG-23588) —
/// explicit-timestamp construction and the static parsers stay usable.
#[test]
fn deterministic_members_are_denied_on_ibex_queries() {
    let snapback = configured();
    for member in ["Date.now", "Math.random"] {
        let output = snapback
            .invoke_query("probeMemberDenied", input(json!({ "name": member })))
            .expect("probe query");
        assert_eq!(
            output.rows[0].get("denied"),
            Some(&json!(true)),
            "ibex query: {member} must be denied at runtime, got {:?}",
            output.rows[0]
        );
    }
    let output = snapback
        .invoke_query("probeDateCtor", input(json!({})))
        .expect("date ctor probe");
    let row = &output.rows[0];
    assert_eq!(row.get("explicit"), Some(&json!(true)), "got {row}");
    assert_eq!(row.get("zeroArgDenied"), Some(&json!(true)), "got {row}");
    assert_eq!(row.get("callDenied"), Some(&json!(true)), "got {row}");
    assert_eq!(row.get("parseWorks"), Some(&json!(true)), "got {row}");
    assert_eq!(row.get("utcWorks"), Some(&json!(true)), "got {row}");
}
