//! LLP 3000.009.000: the opt-in gates declarations, not shared work or seats.
use snapback4_lang::{Bound, compile, emit, guide};

fn check(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn refusal(bound: &Bound, line: u32, message: &str) {
    let diagnostic = bound.diagnostics.iter().find(|d| d.site.line == line).expect("located refusal");
    assert_eq!(diagnostic.code, "E_SERVER_REQUIRED");
    assert_eq!(diagnostic.message, format!("{message} requires use server; add the directive to schema.q"));
    assert_eq!(diagnostic.rewrite, "use server");
    assert_eq!(diagnostic.guide, "actions");
    assert!(!diagnostic.mechanical, "opting in is an author choice");
}

#[test]
fn action_requires_server() {
    let bound = check("action send() returns {}\n");
    assert_eq!(bound.diagnostics.len(), 1);
    refusal(&bound, 1, "action send");
    assert!(bound.programs.is_empty() && bound.schema.action_specs.is_empty());
    assert!(!emit::typescript(&bound).contains("Action"));
}

#[test]
fn route_requires_server() {
    let bound = check("route hook: post '/hook'\n");
    assert_eq!(bound.diagnostics.len(), 1);
    refusal(&bound, 1, "route hook");
    assert!(bound.schema.routes.is_empty());
    assert!(!emit::server_typescript(&bound).contains("/hook"));
}

#[test]
fn action_schedule_requires_server_even_without_a_service_clause() {
    for seat in ["", " as service:mail"] {
        let bound = check(&format!("action send()\nschedule reminder every 1m{seat}: send\n"));
        assert_eq!(bound.diagnostics.len(), 2);
        refusal(&bound, 1, "action send");
        refusal(&bound, 2, "schedule reminder targeting action send");
        assert!(bound.schema.schedules.is_empty());
    }
    let bound = compile(&[("schema.q".into(), "schedule reminder every 1m as service:mail: mail.send\n".into()),
        ("mail.q".into(), "action send()\n".into())]);
    assert_eq!(bound.diagnostics.len(), 2);
    assert!(bound.diagnostics.iter().all(|d| d.code == "E_SERVER_REQUIRED" && d.rewrite == "use server" && d.guide == "actions"));
}

#[test]
fn one_directive_covers_all_modules_and_matches_identity_collection() {
    let mut sources = vec![("schema.q".into(), "use server\nuse identity guests\n".into()),
        ("mail.q".into(), "action send() returns {}\nroute hook: post '/hook'\nschedule reminder every 1m as service:mail: mail.send\n".into())];
    let bound = compile(&sources);
    assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.schema.action_specs.contains_key("mail.send"));
    assert!(bound.schema.routes.contains_key("mail.hook"));
    assert_eq!(bound.schema.schedules[0].target, "mail.send");
    let schema = serde_json::to_string(&bound.schema).unwrap();
    let programs = emit::backend_programs(&bound);
    let api = emit::typescript(&bound);
    let server = emit::server_typescript(&bound);
    assert!(api.contains("send: Action<"));
    assert!(!api.contains("Route") && !api.contains("hook"));
    // A module directive is accepted, just like identity, and repetition is idempotent.
    sources[0].1.clear();
    sources[1].1.push_str("use identity guests\nuse server\nuse server\n");
    sources.reverse();
    let module = compile(&sources);
    assert!(module.diagnostics.is_empty(), "{:?}", module.diagnostics);
    assert_eq!(serde_json::to_string(&module.schema).unwrap(), schema);
    assert_eq!(emit::backend_programs(&module), programs);
    assert_eq!(emit::typescript(&module), api);
    assert_eq!(emit::server_typescript(&module), server);
}

#[test]
fn effects_and_job_schedules_keep_the_complete_core_surface() {
    let source = "effect notify secrets [PUSH_KEY] retry 3 backoff 2s deadline 1h cancellation allow\n\
table work:\n  owner: principal\n  read <- viewer = 'service:pusher'\n  insert <- viewer = 'service:pusher'\n  online only\n\
mutation enqueue():\n  emit notify {}\n\
job sweep():\n  chunk row in work first 10 by byId:\n    emit notify { owner: row.owner }\n\
schedule daily every 1d: sweep\n";
    let bound = check(source);
    assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
    let effect = &bound.schema.effect_specs["notify"];
    assert_eq!(effect.secrets, ["PUSH_KEY"]);
    assert_eq!(effect.policy.max_attempts, 3);
    assert_eq!(effect.policy.backoff_ms, 2_000);
    assert_eq!(effect.policy.deadline_ms, Some(3_600_000));
    assert!(effect.policy.cancellable);
    assert_eq!(bound.schema.schedules[0].target, "sweep");
    assert_eq!(bound.schema.schedules[0].service, None);
    let api = emit::typescript(&bound);
    assert!(!api.contains("Action") && !api.contains("Route"), "{api}");
    let server = emit::server_typescript(&bound);
    assert!(server.contains("from \"snapback4/server\""));
    assert!(server.contains("ctx: EffectContext<\"PUSH_KEY\">"));
    assert!(server.contains(&effect.effect_declaration_contract("notify")));
    assert!(server.contains("actions?: Actions; routes?: Routes; effects?: Effects"));
    // The directive changes neither core schema serialization nor effect contracts.
    let enabled = check(&format!("{source}use server\n"));
    assert!(emit::typescript(&enabled).contains("import type { Action, Cursor, Mutation, Query }"));
    assert_eq!(api, emit::typescript(&enabled).replace("Action, ", ""));
    assert_eq!(serde_json::to_string(&bound.schema).unwrap(), serde_json::to_string(&enabled.schema).unwrap());
    assert_eq!(server, emit::server_typescript(&enabled));
}

#[test]
fn why_and_discovery_keep_the_opt_in_one_step_away() {
    let why = guide::explain_code("E_SERVER_REQUIRED").unwrap();
    assert!(why.contains("use server") && why.ends_with("Full card: snapback4 guide actions"));
    let listing = guide::listing();
    let mut lines = listing.lines();
    let core = lines.next().unwrap();
    assert!(!core.contains("actions") && !core.contains("routes"));
    assert!(core.contains("effects") && core.contains("services") && core.contains("jobs"));
    assert_eq!(lines.next(), Some("with use server: actions, routes"));
    for name in ["actions", "routes"] { assert!(guide::card(name).unwrap().contains("use server")); }
    let services = guide::card("services").unwrap();
    assert!(services.contains("mintSession") && services.contains("revokeSessions") && services.contains("token --service"));
    assert!(!services.contains("x-snapback-action-lease") && !services.contains("replaceLostDelivery") && !services.contains("E_OIDC_"));
    for template in [guide::TEMPLATE, guide::TEMPLATE_ONLINE] {
        let (document, diagnostics) = snapback4_lang::parse_document("schema.q", template);
        assert!(diagnostics.is_empty());
        assert!(!document.server && document.actions.is_empty() && document.routes.is_empty());
    }
}

#[test]
fn the_language_server_block_retains_its_routes_and_scheduled_action() {
    let blocks = guide::quarry(guide::LANGUAGE);
    let bound = check(&format!("{}\n{}", blocks[0], blocks[1]));
    assert!(bound.diagnostics.is_empty() && bound.notes.is_empty());
    assert_eq!(bound.schema.routes.keys().map(String::as_str).collect::<Vec<_>>(), ["providerEvent", "roomExport"]);
    assert_eq!(bound.schema.routes["providerEvent"].service.as_deref(), Some("service:reporter"));
    assert_eq!(bound.schema.routes["roomExport"].service, None);
    assert!(!bound.schema.operations.contains_key("roomExport"));
    let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let at = 86_400_000 + 28_800_000;
    assert!(engine.fire_schedules(at).unwrap().is_empty());
    assert_eq!(engine.fire_schedules(at + 86_400_000).unwrap(), ["everyNight", "summariesEveryDay"]);
    assert_eq!(engine.action_counts().unwrap().get("queued"), Some(&1));
}
