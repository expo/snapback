//! LLP 3000.009.000: the opt-in gates declarations, not shared work or seats.
use snapback4_lang::{Bound, compile, emit, guide};

fn check(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn refusal(bound: &Bound, file: &str, line: u32, form: &str, guide: &str) {
    assert!(!bound.server);
    let diagnostics: Vec<_> = bound.diagnostics.iter().filter(|d| d.site.file == file && d.site.line == line).collect();
    assert_eq!(diagnostics.len(), 1, "one refusal per declaration: {:?}", bound.diagnostics);
    let diagnostic = diagnostics[0];
    assert_eq!(diagnostic.site.col, 1);
    assert_eq!(diagnostic.code, "E_SERVER_REQUIRED");
    assert!(diagnostic.message.starts_with(&format!("{form} requires use server;")));
    assert!(diagnostic.message.contains("any module (schema.q is usual)"));
    assert!(diagnostic.message.contains("repeating it is harmless"));
    assert_eq!(diagnostic.rewrite, "use server");
    assert_eq!(diagnostic.guide, guide);
    assert!(!diagnostic.mechanical, "opting in is an author choice");
}

fn no_server_declarations(bound: &Bound) {
    assert!(!bound.server);
    assert!(bound.schema.action_specs.is_empty(), "refused actions must be dropped");
    assert!(bound.schema.routes.is_empty(), "refused routes must be dropped");
    assert!(bound.schema.schedules.is_empty(), "refused action schedules must be dropped");
    assert!(bound.schema.operations.is_empty());
    assert!(bound.programs.is_empty(), "refused declarations must not produce programs");
    let empty = check("");
    assert_eq!(emit::typescript(bound), emit::typescript(&empty));
    assert_eq!(emit::server_typescript(bound), emit::server_typescript(&empty));
}

#[test]
fn action_requires_server() {
    for source in ["action send() returns {}\n", "action remote(n: int)\n"] {
        let bound = check(source);
        assert_eq!(bound.diagnostics.len(), 1);
        refusal(&bound, "schema.q", 1, if source.contains("send") { "action send" } else { "action remote" }, "actions");
        no_server_declarations(&bound);
    }
}

#[test]
fn route_requires_server_even_with_a_service_seat() {
    for seat in ["", " as service:mail"] {
        let bound = check(&format!("route hook: post '/hook'{seat}\n"));
        assert_eq!(bound.diagnostics.len(), 1);
        refusal(&bound, "schema.q", 1, "route hook", "routes");
        no_server_declarations(&bound);
    }
}

#[test]
fn action_schedule_requires_server_even_without_a_service_clause() {
    for seat in ["", " as service:clock"] {
        let bound = check(&format!("action tick()\nschedule pulse every 1m{seat}: tick\n"));
        assert_eq!(bound.diagnostics.len(), 2);
        refusal(&bound, "schema.q", 1, "action tick", "actions");
        refusal(&bound, "schema.q", 2, "schedule pulse targeting action tick", "actions");
        no_server_declarations(&bound);
    }
}

#[test]
fn cross_module_action_schedule_is_refused_and_dropped() {
    let bound = compile(&[("schema.q".into(), "schedule reminder every 1m as service:mail: mail.send\n".into()),
        ("mail.q".into(), "action send()\n".into())]);
    assert_eq!(bound.diagnostics.len(), 2);
    refusal(&bound, "schema.q", 1, "schedule reminder targeting action mail.send", "actions");
    refusal(&bound, "mail.q", 1, "action send", "actions");
    no_server_declarations(&bound);
}

#[test]
fn one_directive_covers_all_modules_and_matches_identity_collection() {
    let declarations = "action send() returns {}\nroute hook: post '/hook'\nschedule reminder every 1m as service:mail: mail.send\n";
    let baseline = compile(&[("schema.q".into(), "use server\nuse identity guests\n".into()),
        ("mail.q".into(), declarations.into())]);
    for (schema_directives, module_directives) in [
        ("use server\nuse identity guests\n", ""),
        ("", "use identity guests\nuse server\n"),
        ("", "use identity guests\nuse server\nuse server\n"),
        ("use server\nuse identity guests\n", "use server\n"),
    ] {
        for reversed in [false, true] {
            let mut sources = vec![("schema.q".into(), schema_directives.into()),
                ("mail.q".into(), format!("{declarations}{module_directives}"))];
            if reversed { sources.reverse(); }
            let bound = compile(&sources);
            assert!(bound.server);
            assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
            assert!(bound.schema.action_specs.contains_key("mail.send"));
            assert!(bound.schema.routes.contains_key("mail.hook"));
            assert_eq!(bound.schema.schedules.len(), 1);
            assert_eq!(bound.schema.schedules[0].target, "mail.send");
            assert_eq!(bound.schema.schedules[0].service.as_deref(), Some("service:mail"));
            assert_eq!(serde_json::to_string(&bound.schema).unwrap(), serde_json::to_string(&baseline.schema).unwrap());
            assert_eq!(emit::backend_programs(&bound), emit::backend_programs(&baseline));
            assert_eq!(emit::typescript(&bound), emit::typescript(&baseline));
            assert_eq!(emit::server_typescript(&bound), emit::server_typescript(&baseline));
        }
    }
    let api = emit::typescript(&baseline);
    assert!(api.contains("send: Action<"));
    assert!(!api.contains("Route") && !api.contains("hook"));
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
    assert!(!bound.server);
    let effect = &bound.schema.effect_specs["notify"];
    assert_eq!(effect.secrets, ["PUSH_KEY"]);
    assert_eq!(effect.policy.max_attempts, 3);
    assert_eq!(effect.policy.backoff_ms, 2_000);
    assert_eq!(effect.policy.deadline_ms, Some(3_600_000));
    assert!(effect.policy.cancellable);
    assert_eq!(bound.schema.schedules[0].target, "sweep");
    assert_eq!(bound.schema.schedules[0].service, None);
    // Job seats already refuse independently of this opt-in; do not change the
    // scheduler's system-principal contract as part of declaration gating.
    let seated_source = source.replace("every 1d: sweep", "every 1d as service:pusher: sweep");
    let (document, parsed) = snapback4_lang::parse_document("schema.q", &seated_source);
    assert!(parsed.is_empty());
    assert_eq!(document.schedules[0].target, "sweep");
    assert_eq!(document.schedules[0].service.as_deref(), Some("service:pusher"));
    let seated = check(&seated_source);
    assert!(!seated.server);
    assert_eq!(seated.diagnostics.len(), 1);
    assert_eq!(seated.diagnostics[0].code, "E_SCHEDULE");
    assert_eq!(seated.diagnostics[0].message, "a job runs as the system; its schedule cannot declare a service seat");
    assert!(seated.schema.schedules.is_empty());
    assert_eq!(check(&format!("{seated_source}use server\n")).diagnostics, seated.diagnostics);
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
    assert!(!core.split([',', ' ']).any(|keyword| matches!(keyword, "actions" | "routes")));
    assert!(core.contains("effects") && core.contains("services") && core.contains("jobs"));
    assert_eq!(lines.next(), Some("with use server: actions, routes"));
    for name in ["actions", "routes"] { assert!(guide::card(name).unwrap().contains("use server")); }
    let services = guide::card("services").unwrap();
    assert!(services.contains("mintSession") && services.contains("revokeSessions") && services.contains("token --service"));
    assert!(!services.contains("x-snapback-action-lease") && !services.contains("replaceLostDelivery"));
    for (code, blurb) in guide::CODES.iter().filter(|(code, _)| code.starts_with("E_OIDC_")) {
        assert_eq!(snapback4_lang::diag::guide_for(code), "services");
        assert!(blurb.contains("SERVER.md") && blurb.ends_with(". guide services."), "{blurb}");
        assert!(services.contains(code) && services.contains("SERVER.md"));
    }
    for template in [guide::TEMPLATE, guide::TEMPLATE_ONLINE] {
        let (document, diagnostics) = snapback4_lang::parse_document("schema.q", template);
        assert!(diagnostics.is_empty());
        assert!(!document.server && document.actions.is_empty() && document.routes.is_empty());
    }
}
