//! A3 publishes declared HTTP paths without publishing private handler programs.
use snapback4_core::schema::{RouteSpec, WorkPolicy, WorkSpec};
use snapback4_lang::{Bound, emit};
use std::path::PathBuf;
use std::process::Command;

// Existing server-half fixtures all opt in; keep declaration line locations stable.
fn compile(sources: &[(String, String)]) -> Bound {
    let mut sources = sources.to_vec();
    let index = sources.iter().position(|(file, _)| file == "schema.q").unwrap_or(0);
    if let Some((_, source)) = sources.get_mut(index) { source.push_str("\nuse server\n"); }
    snapback4_lang::compile(&sources)
}

fn clean(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{source}\n{:?}", bound.notes);
    bound
}

fn refused(source: &str, message: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    let diagnostic = bound.diagnostics.iter().find(|d| d.message.contains(message))
        .unwrap_or_else(|| panic!("{source}\nexpected {message}: {:?}", bound.diagnostics));
    assert_eq!(diagnostic.code, "E_ROUTE_DECLARATION");
    assert_eq!(diagnostic.guide, "routes");
    assert_eq!(diagnostic.site.file, "schema.q");
    assert!(diagnostic.site.line > 0 && diagnostic.site.col > 0);
    assert!(!diagnostic.rewrite.is_empty());
    assert!(!diagnostic.mechanical);
    bound
}

#[test]
fn session_defaults_and_provider_policy_bind_without_public_programs() {
    let bound = clean("route report: post \"/reports/export\"\nroute billing: post \"/hooks/billing\" as service:billing-worker secrets [Z_KEY, BILLING_KEY] retry 3 backoff 1m deadline 2h cancellation deny wait 250ms\n");
    assert_eq!(bound.schema.routes["report"], RouteSpec { path: "/reports/export".into(), service: None, work: WorkSpec::default(), wait_ms: 5_000 });
    let provider = &bound.schema.routes["billing"];
    assert_eq!(provider.path, "/hooks/billing");
    assert_eq!(provider.service.as_deref(), Some("service:billing-worker"));
    assert_eq!(provider.work.secrets, ["BILLING_KEY", "Z_KEY"]);
    assert_eq!(provider.work.policy, WorkPolicy { max_attempts: 3, backoff_ms: 60_000, deadline_ms: Some(7_200_000), cancellable: false });
    assert_eq!(provider.wait_ms, 250);
    assert!(bound.programs.is_empty());
    assert!(bound.schema.operations.is_empty());
    assert!(bound.schema.action_specs.is_empty());
    assert!(emit::backend_programs(&bound).is_empty());
    let client = emit::typescript(&bound);
    for private in ["report", "billing", "/hooks/", "@route/"] { assert!(!client.contains(private), "{client}"); }
}

#[test]
fn clauses_accept_any_order_and_the_core_policy_boundaries() {
    for seat in ["billing", "billing-worker", "123", "123abc", "_worker", "a-b_1"] {
        let source = format!("route hook: post \"/hook\" wait 25s cancellation allow deadline 30d backoff 5m secrets [KEY] retry 100 as service:{seat}\n");
        let bound = clean(&source);
        let spec = &bound.schema.routes["hook"];
        assert_eq!(spec.service.as_deref(), Some(format!("service:{seat}").as_str()));
        assert_eq!(spec.wait_ms, 25_000);
        assert_eq!(spec.work.policy.max_attempts, 100);
    }
    let bound = clean("route hook: post '/hook.v1_name-2' secrets [KEY] wait 1ms retry 1 backoff 1s deadline 1s\n");
    assert_eq!(bound.schema.routes["hook"].wait_ms, 1);
    assert_eq!(bound.schema.routes["hook"].work.secrets, ["KEY"]);
    assert_eq!(bound.schema.routes["hook"].service, None);
}

#[test]
fn invalid_methods_paths_authority_and_body_forms_are_located_refusals() {
    for method in ["get", "POST", "put", "delete", "stream"] {
        refused(&format!("route bad: {method} \"/hook\"\n"), "only post");
    }
    for path in ["/", "relative", "//hook", "/hook/", "/a//b", "/./a", "/a/../b", "/a?b=1", "/a#b", "/a/%61", "/a/:id", "/a/*", "/a/{id}", "/a/é", "/a b", "/a\\b"] {
        let source = format!("route bad: post {}\n", serde_json::to_string(path).unwrap());
        assert!(refused(&source, "static absolute ASCII path").schema.routes.is_empty());
    }
    let long_path = format!("/{}", "a".repeat(256));
    refused(&format!("route bad: post \"{long_path}\"\n"), "static absolute ASCII path");
    for reserved in ["q", "m", "a", "actions", "effects", "routes", "assets", "auth", "dev", "seed", "sync", "changes", "schema", "api.ts", "native.wasm", "probe"] {
        refused(&format!("route bad: post \"/{reserved}\"\n"), "core HTTP endpoint");
        refused(&format!("route bad: post \"/{reserved}/hook\"\n"), "core HTTP endpoint");
    }
    refused("route bad: post \"/hook\" as user:alice\n", "explicit service seat");
    refused("route bad: post \"/hook\" as service:\n", "service seat name");
    refused(&format!("route bad: post \"/hook\" as service:{}\n", "a".repeat(65)), "explicit service");
    for suffix in ["<- allow", "returns {}", ":", "stream", "(body: json <=10)"] {
        refused(&format!("route bad: post \"/hook\" {suffix}\n"), "no Quarry body");
    }
    for name in ["bad-name", "bad.name", "123", "until-revoked"] {
        let bound = compile(&[("schema.q".into(), format!("route {name}: post \"/hook\"\n"))]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_ROUTE_DECLARATION" && d.guide == "routes"), "{name}: {:?}", bound.diagnostics);
        assert!(bound.schema.routes.is_empty());
    }
}

#[test]
fn verification_refusals_explain_the_route_boundary() {
    for code in ["E_ROUTE_VERIFY", "E_ROUTE_PENDING", "E_ROUTE_LEASE"] {
        assert_eq!(snapback4_lang::diag::guide_for(code), "routes");
        let explanation = snapback4_lang::guide::explain_code(code).unwrap();
        assert!(explanation.contains("Full card: snapback4 guide routes"), "{explanation}");
    }
    let card = snapback4_lang::guide::card("routes").unwrap();
    assert!(card.contains("HTTP 403 with E_ROUTE_VERIFY, with no durable admission"));
    assert!(card.contains("does not prove admission"));
}

#[test]
fn duplicate_clauses_and_invalid_work_settings_never_acquire_route_metadata() {
    for clause in ["as service:a as service:b", "wait 1s wait 2s", "secrets [] secrets []", "retry 3 retry 4", "backoff 1s backoff 2s", "deadline 1s deadline 2s", "cancellation allow cancellation deny"] {
        assert!(refused(&format!("route bad: post \"/hook\" {clause}\n"), "duplicate").schema.routes.is_empty());
    }
    for clause in ["retry 0", "retry 101", "backoff 0s", "backoff 301s", "deadline 0s", "deadline 31d"] {
        assert!(refused(&format!("route bad: post \"/hook\" {clause}\n"), "work policy").schema.routes.is_empty());
    }
    for wait in ["0ms", "0s", "25001ms", "26s", "1m", "1.5s"] {
        let bound = compile(&[("schema.q".into(), format!("route bad: post \"/hook\" wait {wait}\n"))]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_ROUTE_DECLARATION"), "{wait}: {:?}", bound.diagnostics);
        assert!(bound.schema.routes.is_empty());
    }
    refused("route bad: post \"/hook\" backoff 1w\n", "work duration");
    refused("route bad: post \"/hook\" cancellation maybe\n", "allow or deny");
    refused("route bad: post \"/hook\" secrets [KEY, KEY]\n", "duplicate secret");
    for secret in ["lowercase", "PATH", "HOME", "NODE_OPTIONS", "SNAPBACK_URL", "SNAPBACK4_BIN", "LD_PRELOAD", "DYLD_LIBRARY_PATH", "BASH_ENV", "LC_ALL", "TZ"] {
        refused(&format!("route bad: post \"/hook\" secrets [{secret}]\n"), "reserved names");
    }
}

#[test]
fn route_names_are_qualified_but_paths_and_public_namespaces_are_independent() {
    let bound = compile(&[("schema.q".into(), "route hooks: post \"/root\"\naction hooks()\n".into()), ("hooks.q".into(), "route billing: post \"/hooks/billing\"\naction billing()\n".into())]);
    // Existing client API forbids bare action hooks beside module hooks; routes
    // alone do not introduce that restriction, because their map is flat.
    assert!(bound.diagnostics.iter().any(|d| d.message.contains("API module")));
    let bound = compile(&[("schema.q".into(), "route hooks: post \"/root\"\n".into()), ("hooks.q".into(), "route billing: post \"/hooks/billing\"\naction billing()\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.routes.keys().map(String::as_str).collect::<Vec<_>>(), ["hooks", "hooks.billing"]);
    assert_eq!(bound.schema.routes["hooks.billing"].path, "/hooks/billing");
    assert_eq!(bound.programs.len(), 1);
    assert_eq!(bound.programs[0].program.name, "hooks.billing");
    let server = emit::server_typescript(&bound);
    assert!(server.contains("\"hooks.billing\": RouteHandler<never>"), "{server}");
    let duplicate = compile(&[("one/hooks.q".into(), "route billing: post \"/one\"\n".into()), ("two/hooks.q".into(), "route billing: post \"/two\"\n".into())]);
    assert_eq!(duplicate.diagnostics.len(), 1);
    assert_eq!(duplicate.diagnostics[0].site.file, "two/hooks.q");
    assert!(duplicate.diagnostics[0].message.contains("duplicate route hooks.billing; first declared at one/hooks.q:1:1"));
    assert_eq!(duplicate.schema.routes["hooks.billing"].path, "/one");
    let duplicate_path = refused("route first: post \"/same\"\nroute second: post \"/same\" as service:billing\n", "duplicate route path /same; first declared at schema.q:1:1");
    assert_eq!(duplicate_path.schema.routes.len(), 1);
    assert_eq!(duplicate_path.diagnostics[0].site.line, 2);
    let scheduled = compile(&[("schema.q".into(), "route hook: post \"/hook\"\nschedule attempt every 1m as service:billing: hook\n".into())]);
    assert!(scheduled.diagnostics.iter().any(|d| d.code == "E_QUARRY_UNKNOWN" && d.message.contains("names no job or action")));
}

#[test]
fn generated_manifest_types_and_prototype_properties_preserve_the_contract() {
    let bound = clean("route __proto__: post \"/proto\" secrets [A_KEY]\nroute service: post \"/hook\" as service:billing secrets [Z_KEY, BILLING_KEY]\n");
    let server = emit::server_typescript(&bound);
    assert!(server.contains("[\"__proto__\"]: RouteHandler<\"A_KEY\">"), "{server}");
    assert!(server.contains("service: ServiceRoute<\"BILLING_KEY\" | \"Z_KEY\">"), "{server}");
    for (name, route) in &bound.schema.routes {
        let key = if name == "__proto__" { "[\"__proto__\"]" } else { name };
        assert!(server.contains(&format!("{key}: {{ contract: \"{}\", method: \"POST\", path: \"{}\", service: {}", route.contract(name), route.path, route.service.as_ref().map_or("null".into(), |s| serde_json::to_string(s).unwrap()))), "{server}");
    }
    assert!(!server.contains("__proto__:"));
    assert!(!server.contains("@route/"));
    assert!(server.contains("export type Effects = Record<string, never>;") && server.contains("actions?: Actions; routes: Routes; effects?: Effects"), "{server}");
    let empty_server = emit::server_typescript(&clean(""));
    assert!(empty_server.contains("export type Effects = Record<string, never>;") && empty_server.contains("actions?: Actions; routes?: Routes; effects?: Effects"), "{empty_server}");
    let action_server = emit::server_typescript(&clean("action actionOnly()\n"));
    assert!(action_server.contains("export type Effects = Record<string, never>;") && action_server.contains("actions: Actions; routes?: Routes; effects?: Effects"), "{action_server}");
    let mixed = clean("action billing() returns {}\nroute billing: post \"/hook\"\neffect notify\n");
    let mixed_server = emit::server_typescript(&mixed);
    assert!(mixed_server.contains("actions: Actions; routes: Routes; effects?: Effects"), "{mixed_server}");
    assert!(mixed_server.contains("notify?: (payload: unknown, ctx: EffectContext<never>) => Promise<unknown> | unknown"), "{mixed_server}");
}

#[test]
fn generation_tracks_every_route_setting_but_not_clause_or_secret_order() {
    let base = "route hook: post \"/hook\" as service:billing secrets [A, Z] retry 3 backoff 2s deadline 1h cancellation allow wait 5s\n";
    let bound = clean(base);
    let contract = bound.schema.routes["hook"].contract("hook");
    for (from, to) in [("hook: post", "other: post"), ("\"/hook\"", "\"/other\""), ("service:billing", "service:other"), ("[A, Z]", "[A]"), ("retry 3", "retry 4"), ("backoff 2s", "backoff 3s"), ("deadline 1h", "deadline 2h"), ("cancellation allow", "cancellation deny"), ("wait 5s", "wait 6s")] {
        let changed = clean(&base.replace(from, to));
        let (name, spec) = changed.schema.routes.first_key_value().unwrap();
        assert_ne!(spec.contract(name), contract, "{from} -> {to}");
    }
    let reordered = clean("route hook: post \"/hook\" wait 5000ms cancellation allow retry 3 deadline 1h secrets [Z, A] as service:billing backoff 2s\n");
    assert_eq!(reordered.schema.routes["hook"].contract("hook"), contract);
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("snapback4-routes-types-{}-{unique}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

#[test]
fn generated_route_handlers_typecheck_against_the_real_runtime() {
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let scratch = Scratch::new();
    for (file, source) in [
        ("empty", ""),
        ("action-only", "action send() returns {}\n"),
        ("route-only", "route session: post \"/session\"\n"),
        ("mixed", "action send() returns {} secrets [ACTION_KEY]\nroute session: post \"/session\" secrets [SESSION_KEY]\nroute provider: post \"/hook\" as service:billing secrets [BILLING_KEY]\nroute __proto__: post \"/proto\"\neffect notify\n"),
    ] {
        let generated = emit::server_typescript(&clean(source));
        let generated = ["server", "contract", "worker"].into_iter().fold(generated, |text, name| {
            text.replace(&format!("\"snapback4/{name}\""), &serde_json::to_string(&workspace.join(format!("packages/snapback4/src/{name}.ts")).to_string_lossy()).unwrap())
        });
        std::fs::write(scratch.0.join(format!("{file}.ts")), generated).unwrap();
    }
    std::fs::write(scratch.0.join("check.ts"), include_str!("fixtures/routes-handlers.ts")).unwrap();
    let tsc = workspace.join("node_modules/typescript/bin/tsc");
    assert!(tsc.exists(), "the emitted-TypeScript check needs the existing snapback4 Bun dependencies");
    let result = Command::new("node").arg(tsc).args(["--noEmit", "--strict", "--skipLibCheck", "--allowImportingTsExtensions", "--target", "es2023", "--module", "esnext", "--moduleResolution", "bundler", "--types", "node", "--typeRoots"])
        .arg(workspace.join("node_modules/@types")).arg("check.ts").current_dir(&scratch.0).output().unwrap();
    assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
}
