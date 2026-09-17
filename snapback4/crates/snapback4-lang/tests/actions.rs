//! A2's declaration is shared by admission, settlement and both generated surfaces.
use snapback4_core::{ir::ArgType, schema::{ActionSpec, WorkPolicy}};
use snapback4_lang::{Bound, compile, emit, types::Ty};

fn clean(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{source}\n{:?}", bound.notes);
    bound
}

fn refused(source: &str, message: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().any(|d| d.message.contains(message)), "{source}\nexpected {message}: {:?}", bound.diagnostics);
    bound
}

#[test]
fn result_contract_types_refs_as_ids_and_optional_fields_as_required_nullable() {
    let bound = clean("table documents:\n  public 'documents'\n  online only\naction summarize(doc: documents) returns { summary: documents, label: text 1..100 ?, tags: [text <=20] <=5, status: enum('ready', 'pending'), amount: money USD, detail: json <=500 }\n");
    let spec = &bound.schema.action_specs["summarize"];
    let returns = spec.returns.as_ref().unwrap();
    assert_eq!(returns["summary"], ArgType::Ref { table: "documents".into() });
    assert!(matches!(&returns["label"], ArgType::Optional(inner) if matches!(inner.as_ref(), ArgType::Text { min: 1, max: 100, .. })));
    let api = emit::typescript(&bound);
    assert!(api.contains("summarize: Action<{ doc: string }, { amount: number; detail: unknown; label: string | null; status: \"ready\" | \"pending\"; summary: string; tags: string[] }>"), "{api}");
    assert!(!api.contains("label?:"));
    let server = emit::server_typescript(&bound);
    assert!(server.contains("summarize: (args: { doc: string }, ctx: ServerContext<never>) => Promise<{"), "{server}");
    assert!(server.contains("summary: string"));
    assert!(!server.contains("Rows["));
}

#[test]
fn legacy_unknown_and_empty_object_contracts_are_distinct() {
    let bound = clean("action legacy()\naction empty() returns {}\n");
    assert_eq!(bound.schema.action_specs["legacy"], ActionSpec::default());
    assert_eq!(bound.programs[0].result, Ty::Unknown);
    assert_eq!(bound.schema.action_specs["empty"].returns.as_ref().unwrap().len(), 0);
    let api = emit::typescript(&bound);
    assert!(api.contains("legacy: Action<Record<string, never>, unknown>"));
    assert!(api.contains("empty: Action<Record<string, never>, Record<string, never>>"));
}

#[test]
fn empty_handler_maps_cannot_accept_undeclared_functions() {
    let server = emit::server_typescript(&clean(""));
    assert!(server.contains("export type Actions = Record<string, never>;"));
    assert!(server.contains("export type Effects = Record<string, never>"));
}

#[test]
fn work_settings_bind_for_actions_and_effects_with_legacy_defaults() {
    let bound = clean("action send() returns { accepted: bool } secrets [MAIL_KEY, BILLING_KEY] retry 3 backoff 1m deadline 2h cancellation deny <- viewer = 'service:billing'\neffect notify secrets [PUSH_KEY] retry 2 backoff 5m deadline 30d cancellation allow\neffect legacy\n");
    let action = &bound.schema.action_specs["send"];
    assert_eq!(action.work.secrets, ["BILLING_KEY", "MAIL_KEY"]);
    assert_eq!(action.work.policy, WorkPolicy { max_attempts: 3, backoff_ms: 60_000, deadline_ms: Some(7_200_000), cancellable: false });
    assert_eq!(bound.schema.effect_specs["notify"].policy, WorkPolicy { max_attempts: 2, backoff_ms: 300_000, deadline_ms: Some(2_592_000_000), cancellable: true });
    assert_eq!(bound.schema.effect_specs["legacy"].policy, WorkPolicy { backoff_ms: 4_000, ..WorkPolicy::default() });
    let server = emit::server_typescript(&bound);
    assert!(server.contains("ServerContext<\"BILLING_KEY\" | \"MAIL_KEY\">"), "{server}");
    assert!(server.contains(&format!("contract: \"{}\"", action.contract(&bound.programs[0].program))));
    let notify = &bound.schema.effect_specs["notify"];
    assert!(server.contains(&format!("notify: {{ contract: \"{}\", secrets: [\"PUSH_KEY\"] }}", notify.effect_declaration_contract("notify"))), "{server}");
    assert!(server.contains("notify?: (payload: unknown, ctx: EffectContext<\"PUSH_KEY\">)"), "{server}");
    assert!(server.contains("legacy?: (payload: unknown, ctx: EffectContext<never>)"), "{server}");
    assert!(server.contains("effects?: Effects"));
    assert!(!server.contains("EffectHandler"));
    assert!(server.contains("return startServer(manifest, handlers, options)"));
    assert!(!server.contains("ctx.sql"));
}

#[test]
fn generated_effect_declaration_contract_binds_exact_name_secrets_and_policy() {
    let base = clean("effect notify secrets [PUSH_KEY] retry 2 backoff 5s cancellation allow\n");
    let renamed = clean("effect notify_v2 secrets [PUSH_KEY] retry 2 backoff 5s cancellation allow\n");
    let secret = clean("effect notify secrets [OTHER_KEY] retry 2 backoff 5s cancellation allow\n");
    let policy = clean("effect notify secrets [PUSH_KEY] retry 3 backoff 5s cancellation allow\n");
    let contract = base.schema.effect_specs["notify"].effect_declaration_contract("notify");
    assert_ne!(contract, renamed.schema.effect_specs["notify_v2"].effect_declaration_contract("notify_v2"));
    assert_ne!(contract, secret.schema.effect_specs["notify"].effect_declaration_contract("notify"));
    assert_ne!(contract, policy.schema.effect_specs["notify"].effect_declaration_contract("notify"));
    let server = emit::server_typescript(&base);
    assert!(server.contains(&format!("contract: \"{contract}\"")), "{server}");
    assert!(!server.contains("createHash"), "the generated TypeScript must not recompute Rust declaration identity");
}

#[test]
fn malformed_results_never_acquire_metadata() {
    for (source, reason) in [
        ("returns { value: cursor }", "cannot contain a query cursor"),
        ("returns { value: [cursor] <=3 }", "cannot contain a query cursor"),
        ("returns { value: missing }", "unknown table"),
        ("returns { value: [missing] <=3 }", "unknown table"),
        ("returns { value: text 5..2 }", "minimum"),
        ("returns { value: text <=0 }", "positive maximum"),
        ("returns { value: json <=0 }", "positive maximum"),
        ("returns { value: bytes <=0 }", "positive maximum"),
        ("returns { value: image <=0 }", "positive maximum"),
        ("returns { value: video <=0 }", "positive maximum"),
        ("returns { value: [int] <=0 }", "positive maximum"),
        ("returns { value: [text 4..2] <=3 }", "minimum"),
        ("returns { value: enum('a', 'a') }", "distinct"),
        ("returns { value: int, value: text <=10 }", "duplicate result field"),
        ("returns { value: decimal 13 }", "scales"),
        ("returns { value: [int ?] <=3 }", "cannot be optional"),
        ("returns { value: int } returns {}", "duplicate returns clause"),
    ] {
        let bound = refused(&format!("action bad() {source}\n"), reason);
        assert!(!bound.schema.action_specs.contains_key("bad"));
        assert!(bound.programs.is_empty());
    }
    for source in ["action bad() returns int\n", "action bad() returns { x: { y: int } }\n", "action bad() returns { x: text <=4294967296 }\n"] {
        assert!(!compile(&[("schema.q".into(), source.into())]).diagnostics.is_empty(), "{source}");
    }
}

#[test]
fn clauses_refuse_duplicates_invalid_policy_and_reserved_secrets() {
    for clause in ["secrets [] secrets []", "retry 3 retry 4", "backoff 1s backoff 2s", "deadline 1s deadline 2s", "cancellation allow cancellation deny"] {
        for declaration in ["action bad()", "effect bad"] { refused(&format!("{declaration} {clause}\n"), "duplicate"); }
    }
    for clause in ["retry 0", "retry 101", "backoff 0s", "backoff 301s", "deadline 0s", "deadline 31d"] {
        for declaration in ["action bad()", "effect bad"] { refused(&format!("{declaration} {clause}\n"), "work policy"); }
    }
    refused("action bad() backoff 1w\n", "work duration");
    refused("action bad() cancellation maybe\n", "allow or deny");
    refused("action bad() secrets [MAIL_KEY, MAIL_KEY]\n", "duplicate secret");
    for secret in ["lowercase", "PATH", "HOME", "NODE_OPTIONS", "SNAPBACK_URL", "SNAPBACK4_BIN", "LD_PRELOAD", "DYLD_LIBRARY_PATH", "BASH_ENV", "LC_ALL", "TZ"] {
        for declaration in ["action bad()", "effect bad"] { refused(&format!("{declaration} secrets [{secret}]\n"), "reserved names"); }
    }
    clean("action boundary() retry 100 backoff 1s deadline 1s cancellation allow\n");
}

#[test]
fn scheduled_actions_require_service_authority_and_clock_only_arguments() {
    let bound = clean("action remind(periodStart: time, periodEnd: time) returns {} <- viewer = 'service:billing'\nschedule renewal every 1d at 08:00 as service:billing: remind\naction tick()\nschedule heartbeat every 1m as service:clock: tick\n");
    assert_eq!(bound.schema.schedules[0].service.as_deref(), Some("service:billing"));
    assert_eq!(bound.schema.schedules[0].offset_ms, 28_800_000);
    assert_eq!(bound.schema.schedules[1].target, "tick");
    assert_eq!(clean("action tick()\nschedule pulse every 1m as service:billing-worker: tick\n").schema.schedules[0].service.as_deref(), Some("service:billing-worker"));
    assert_eq!(clean("action tick()\nschedule pulse every 1m as service:123: tick\n").schema.schedules[0].service.as_deref(), Some("service:123"));
    refused("action remind()\nschedule renewal every 1m: remind\n", "requires a service seat");
    refused("action remind()\nschedule renewal every 1m as user:billing: remind\n", "runs as a service seat");
    refused("schedule renewal every 1m as service:billing: absent\n", "names no job or action");
    for args in ["email: text <=100", "periodStart: int", "periodEnd: time ?"] {
        refused(&format!("action remind({args})\nschedule renewal every 1m as service:billing: remind\n"), "clock cannot supply");
    }
    let job = "table profiles:\n  public 'profiles'\n  online only\njob sweep():\n  chunk p in profiles first 1 by byId:\n    return\n";
    let old = clean(&format!("{job}schedule cleanup every 1m: sweep\n"));
    assert_eq!(old.schema.schedules[0].service, None);
    refused(&format!("{job}schedule cleanup every 1m as service:billing: sweep\n"), "job runs as the system");
}

#[test]
fn qualified_action_names_and_proto_properties_are_preserved() {
    let bound = compile(&[("mail.q".into(), "action send() returns { __proto__: text <=10 } secrets [MAIL_KEY]\nschedule reminder every 1m as service:mail: mail.send\n".into()), ("schema.q".into(), "action __proto__() returns {}\neffect __proto__\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let server = emit::server_typescript(&bound);
    assert!(server.contains("\"mail.send\": (args: Record<string, never>, ctx: ServerContext<\"MAIL_KEY\">)"), "{server}");
    assert!(server.contains("[\"__proto__\"]: (args:"));
    assert!(server.contains("[\"__proto__\"]: { contract:"));
    assert!(server.contains(&format!("[\"__proto__\"]: {{ contract: \"{}\", secrets: [] }}", bound.schema.effect_specs["__proto__"].effect_declaration_contract("__proto__"))));
    assert!(!server.contains("__proto__:"));
    let bare = compile(&[("mail.q".into(), "action send()\nschedule reminder every 1m as service:mail: send\n".into())]);
    let diagnostic = bare.diagnostics.iter().find(|d| d.message.contains("names bare action")).unwrap();
    assert_eq!(diagnostic.rewrite, "mail.send");
    assert!(diagnostic.mechanical);
}

#[test]
fn invalid_action_does_not_overwrite_an_existing_operation_or_valid_spec() {
    let bound = refused("action send() returns { ok: bool }\naction send() returns { other: int }\n", "duplicate operation");
    assert_eq!(bound.schema.action_specs["send"].returns.as_ref().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), ["ok"]);
    let bound = refused("query send():\n  return 1\naction send() returns {}\n", "duplicate operation");
    assert!(bound.schema.action_specs.is_empty());
    let bound = refused("action send() returns {} <- missing\n", "action rule compares");
    assert!(bound.schema.action_specs.is_empty());
}

#[test]
fn schedule_checks_the_same_static_service_rule_as_runtime_activation() {
    for rule in ["deny", "viewer = 'service:allowed'", "not (viewer = 'service:denied')", "viewer = 'service:allowed' or viewer = 'service:another'"] {
        let bound = refused(&format!("action tick() <- {rule}\nschedule pulse every 1m as service:denied: tick\n"), "refused by the action's admission rule");
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_SCHEDULE"));
    }
    for rule in ["allow", "viewer = 'service:allowed'", "viewer != 'service:denied'", "viewer = 'service:allowed' and not (viewer = 'service:denied')"] {
        clean(&format!("action tick() <- {rule}\nschedule pulse every 1m as service:allowed: tick\n"));
    }
}
