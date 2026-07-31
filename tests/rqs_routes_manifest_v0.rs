//! Acceptance for LLP 0090 rollout step 3's 0C enforcement pipeline
//! (ENG-25448/ENG-25454, contract LLP 0092 §0C):
//! the served route→query manifest (ensure admission, refusal codes, the
//! devManifestEntry retirement), the codegen-compiled `publicInline`
//! disclosure fact and the derived `rqsEligible` served-manifest predicate,
//! the schema-driven `params-v1` typed decode, `generation` rotation through
//! `routeManifestHash`, and the anonymous read-mode happy path that step 2's
//! interim NOT_PUBLIC posture made unsatisfiable.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use snapback::admin::AppState;
use snapback::bundle::{BundleQuerySpec, BundleRouteEntry, RoutesManifest};
use snapback::local::{EnsureAppInput, LocalSnapback};
use snapback::manifest::{
    AuthRequirement, DependencySummary, FieldManifest, FieldType, FilterExpr, FilterOp,
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, HandlerPlan,
    IndexManifest, OrderDirection, OrderExpr, PublicFunctionManifest, QueryPlan, SchemaManifest,
    TableManifest, ValueExpr,
};
use tower::ServiceExt;

fn wall_schema() -> SchemaManifest {
    SchemaManifest {
        app_id: "wall".to_owned(),
        schema_hash: Some("rqs-routes-schema-v0".to_owned()),
        tables: vec![TableManifest {
            name: "cells".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "boardId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "rank".to_owned(),
                    field_type: FieldType::Integer,
                    optional: false,
                },
            ],
            indexes: vec![IndexManifest {
                name: "by_board".to_owned(),
                fields: vec!["boardId".to_owned()],
                unique: false,
            }],
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            membership: None,
            asset_sharing: None,
        }],
        ..SchemaManifest::default()
    }
}

fn single_table_summary(table: &str) -> DependencySummary {
    DependencySummary {
        primary_table: Some(table.to_owned()),
        tables: vec![table.to_owned()],
        mode: Some("singleTable".to_owned()),
        auth_scope_field: None,
    }
}

/// `listCells`: public + authorityIndependent + publicInline, ordered (seq1),
/// board-scoped by a string arg — the graffiti shape.
fn list_cells() -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        "listCells",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "cells".to_owned(),
            filters: vec![FilterExpr {
                field: "boardId".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Arg("boardId".to_owned()),
            }],
            order: vec![OrderExpr {
                field: "_createdAt".to_owned(),
                direction: OrderDirection::Asc,
            }],
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: Some("by_board".to_owned()),
        })),
    );
    function.auth_requirement = Some(AuthRequirement::Public);
    function.authority_independent = true;
    function.public_inline = true;
    function.read_set_summary = single_table_summary("cells");
    function
}

/// Public + authorityIndependent but NOT publicInline: anonymously invocable,
/// never inline-disclosable (the second gate of 0090's Authorization scope).
fn list_ranked() -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        "listRanked",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "cells".to_owned(),
            filters: vec![FilterExpr {
                field: "rank".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Arg("rank".to_owned()),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    function.auth_requirement = Some(AuthRequirement::Public);
    function.authority_independent = true;
    function.read_set_summary = single_table_summary("cells");
    function
}

fn paint_cell() -> FunctionDefinition {
    FunctionDefinition::new(
        "paintCell",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(snapback::manifest::MutationPlan {
            steps: vec![snapback::manifest::MutationStep::Insert {
                table: "cells".to_owned(),
                values: std::collections::BTreeMap::from([
                    ("boardId".to_owned(), ValueExpr::Arg("boardId".to_owned())),
                    ("rank".to_owned(), ValueExpr::Arg("rank".to_owned())),
                ]),
                bind_id_as: Some("cellId".to_owned()),
            }],
            return_value: Some(snapback::manifest::ReturnValue::Binding(
                "cellId".to_owned(),
            )),
        })),
    )
}

fn wall_functions() -> FunctionManifest {
    FunctionManifest {
        app_id: "wall".to_owned(),
        bundle_hash: Some("rqs-routes-functions-v0".to_owned()),
        functions: vec![list_cells(), list_ranked(), paint_cell()],
        ..FunctionManifest::default()
    }
}

fn query_spec(function: &str, args: Value) -> BundleQuerySpec {
    BundleQuerySpec {
        function: function.to_owned(),
        args,
    }
}

fn wall_routes() -> RoutesManifest {
    RoutesManifest {
        format_version: 1,
        app: "wall".to_owned(),
        routes: vec![
            BundleRouteEntry {
                route: "/board/:boardId".to_owned(),
                queries: vec![query_spec(
                    "listCells",
                    json!({ "boardId": { "$param": "boardId" } }),
                )],
                persist: None,
                register_group_eligible: true,
            },
            BundleRouteEntry {
                route: "/ranked/:rank".to_owned(),
                queries: vec![query_spec(
                    "listRanked",
                    json!({ "rank": { "$param": "rank" } }),
                )],
                persist: None,
                register_group_eligible: false,
            },
        ],
    }
}

fn provisioned() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("in-memory instance");
    let outcome = snapback
        .ensure_app(
            EnsureAppInput {
                schema: Some(wall_schema()),
                functions: Some(wall_functions()),
                seed: None,
                routes: Some(wall_routes()),
            },
            true,
            "dev",
        )
        .expect("ensure with routes");
    assert_eq!(outcome.schema, "provisioned");
    assert_eq!(outcome.functions, "provisioned");
    assert_eq!(outcome.routes.as_deref(), Some("provisioned"));
    snapback
        .invoke_mutation(
            "paintCell",
            snapback::manifest::HandlerInput {
                args: json!({ "boardId": "wall", "rank": 7 }),
                ..Default::default()
            },
        )
        .expect("seed cell");
    snapback
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request")
}

async fn send(app: &AppState, request: Request<Body>) -> (StatusCode, Value) {
    let response = snapback::server::app(app.clone())
        .oneshot(request)
        .await
        .expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

fn diagnostic_code(body: &Value) -> &str {
    body["diagnostic"]["code"].as_str().unwrap_or("")
}

async fn served_app() -> AppState {
    let snapback = tokio::task::spawn_blocking(|| {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        provisioned()
    })
    .await
    .expect("setup");
    AppState::detached(snapback)
}

/// The step-2 NOT_PUBLIC posture, now satisfiable (ENG-25453's blocked happy
/// path): an anonymous read of a served publicInline route answers the full
/// closed union with a resume token.
#[tokio::test]
async fn anonymous_read_of_public_inline_route_succeeds() {
    let app = served_app().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({ "route": "/board/:boardId", "params": { "boardId": "wall" } }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["entries"].as_array().map(Vec::len), Some(1));
    let entry = &body["entries"][0];
    assert_eq!(entry["function"], "listCells");
    // Schema-driven decode substituted the string param.
    assert_eq!(entry["args"], json!({ "boardId": "wall" }));
    assert_eq!(entry["rows"].as_array().map(Vec::len), Some(1));
    // rqsEligible ⇒ resume present, minted at the bundle's commit.
    assert!(
        entry["resume"]["token"].is_string(),
        "resume rides the entry"
    );
    assert_eq!(entry["resume"]["meta"]["version"], body["commitVersion"]);
}

/// A route naming a non-publicInline query refuses anonymously at admission
/// (server-side facts, not the route author's word) while a credentialed
/// read still works — and the typed decode turns `:rank` into a JSON number.
#[tokio::test]
async fn non_public_inline_route_refuses_anonymous_and_decodes_typed_params() {
    let app = served_app().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({ "route": "/ranked/:rank", "params": { "rank": "7" } }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_NOT_PUBLIC");

    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({
                "route": "/ranked/:rank",
                "params": { "rank": "7" },
                "auth": { "user_id": "user_1" },
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    let entry = &body["entries"][0];
    // Integer-typed schema field ⇒ the segment decoded as a number.
    assert_eq!(entry["args"], json!({ "rank": 7 }));
    assert_eq!(entry["rows"].as_array().map(Vec::len), Some(1));
    // Not publicInline but still rqsEligible: resume rides the entry.
    assert!(entry["resume"]["token"].is_string());

    // Strict decode: non-canonical and non-integral forms refuse.
    for bad in ["07", "7.5", "x", ""] {
        let (status, body) = send(
            &app,
            post_json(
                "/app/bundle",
                json!({
                    "route": "/ranked/:rank",
                    "params": { "rank": bad },
                    "auth": { "user_id": "user_1" },
                }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad:?} must refuse");
        assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_PARAMS_INVALID");
    }
}

/// Once a route manifest is served, it is the only source of entries: the
/// inline devManifestEntry form refuses by design and unknown patterns
/// answer ROUTE_UNKNOWN.
#[tokio::test]
async fn served_manifest_retires_dev_entry_and_owns_route_lookup() {
    let app = served_app().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({
                "route": "/board/:boardId",
                "params": { "boardId": "wall" },
                "devManifestEntry": {
                    "route": "/board/:boardId",
                    "queries": [{ "function": "listCells", "args": { "boardId": { "$param": "boardId" } } }],
                },
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_ENTRY_INVALID");

    let (status, body) = send(
        &app,
        post_json("/app/bundle", json!({ "route": "/nowhere", "params": {} })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_ROUTE_UNKNOWN");
}

/// Route-manifest ensure admission refuses incoherent manifests with the
/// coded load error: unknown function, non-query function, dangling or
/// untypable references, overlapping patterns, unknown format version, and
/// app mismatch.
#[test]
fn routes_manifest_admission_refusals_are_coded() {
    let mut snapback = LocalSnapback::memory().expect("in-memory instance");
    snapback
        .ensure_app(
            EnsureAppInput {
                schema: Some(wall_schema()),
                functions: Some(wall_functions()),
                seed: None,
                routes: None,
            },
            true,
            "dev",
        )
        .expect("ensure base pair");

    let manifest = |routes: Vec<BundleRouteEntry>| RoutesManifest {
        format_version: 1,
        app: "wall".to_owned(),
        routes,
    };
    let refuses = |snapback: &mut LocalSnapback, manifest: RoutesManifest, why: &str| {
        let error = snapback
            .install_routes_manifest(manifest)
            .expect_err(&format!("{why} must refuse"));
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_ROUTES_MANIFEST_INVALID",
            "{why}: {}",
            error.diagnostic.message
        );
    };

    refuses(
        &mut snapback,
        manifest(vec![BundleRouteEntry {
            route: "/x".to_owned(),
            queries: vec![query_spec("nope", json!({}))],
            persist: None,
            register_group_eligible: false,
        }]),
        "unknown function",
    );
    refuses(
        &mut snapback,
        manifest(vec![BundleRouteEntry {
            route: "/x".to_owned(),
            queries: vec![query_spec("paintCell", json!({}))],
            persist: None,
            register_group_eligible: false,
        }]),
        "non-query function",
    );
    refuses(
        &mut snapback,
        manifest(vec![BundleRouteEntry {
            route: "/x".to_owned(),
            queries: vec![query_spec(
                "listCells",
                json!({ "boardId": { "$param": "missing" } }),
            )],
            persist: None,
            register_group_eligible: false,
        }]),
        "dangling param reference",
    );
    refuses(
        &mut snapback,
        manifest(vec![BundleRouteEntry {
            route: "/x/:name".to_owned(),
            queries: vec![query_spec(
                "listCells",
                json!({ "boardId": "wall", "extra": { "$param": "name" } }),
            )],
            persist: None,
            register_group_eligible: false,
        }]),
        "reference into an arg with no schema-derived type",
    );
    refuses(
        &mut snapback,
        manifest(vec![BundleRouteEntry {
            route: "/x".to_owned(),
            queries: vec![query_spec("listCells", json!({}))],
            persist: None,
            register_group_eligible: false,
        }]),
        "required arg not covered",
    );
    refuses(
        &mut snapback,
        manifest(vec![BundleRouteEntry {
            route: "/ranked/:rank".to_owned(),
            queries: vec![query_spec(
                "listRanked",
                json!({ "rank": { "$param": "rank" } }),
            )],
            persist: None,
            register_group_eligible: true,
        }]),
        "registerGroupEligible with a non-string route-param target",
    );
    refuses(
        &mut snapback,
        manifest(vec![
            BundleRouteEntry {
                route: "/board/:boardId".to_owned(),
                queries: vec![query_spec(
                    "listCells",
                    json!({ "boardId": { "$param": "boardId" } }),
                )],
                persist: None,
                register_group_eligible: false,
            },
            BundleRouteEntry {
                route: "/board/wall".to_owned(),
                queries: vec![query_spec("listCells", json!({ "boardId": "wall" }))],
                persist: None,
                register_group_eligible: false,
            },
        ]),
        "overlapping patterns",
    );
    let mut wrong_version = manifest(vec![BundleRouteEntry {
        route: "/x".to_owned(),
        queries: vec![query_spec("listCells", json!({ "boardId": "wall" }))],
        persist: None,
        register_group_eligible: false,
    }]);
    wrong_version.format_version = 2;
    refuses(&mut snapback, wrong_version, "unknown format version");
    let mut wrong_app = manifest(vec![BundleRouteEntry {
        route: "/x".to_owned(),
        queries: vec![query_spec("listCells", json!({ "boardId": "wall" }))],
        persist: None,
        register_group_eligible: false,
    }]);
    wrong_app.app = "elsewhere".to_owned();
    refuses(&mut snapback, wrong_app, "app mismatch");
}

/// The route manifest's canonical hash is a `generation` component
/// (`routeManifestHash`, LLP 0091 §0A.6): installing rotates the digest;
/// a no-op re-ensure of the identical manifest preserves it.
#[test]
fn generation_rotates_with_route_manifest_identity() {
    let mut snapback = LocalSnapback::memory().expect("in-memory instance");
    snapback
        .ensure_app(
            EnsureAppInput {
                schema: Some(wall_schema()),
                functions: Some(wall_functions()),
                seed: None,
                routes: None,
            },
            true,
            "dev",
        )
        .expect("ensure base pair");
    let before = snapback.rqs_generation_digest().expect("generation");
    snapback
        .install_routes_manifest(wall_routes())
        .expect("install routes");
    let with_routes = snapback.rqs_generation_digest().expect("generation");
    assert_ne!(before, with_routes, "routeManifestHash rotates generation");

    // A no-op ensure of the identical manifest matches and preserves it.
    let outcome = snapback
        .ensure_app(
            EnsureAppInput {
                schema: None,
                functions: None,
                seed: None,
                routes: Some(wall_routes()),
            },
            true,
            "dev",
        )
        .expect("re-ensure");
    assert_eq!(outcome.routes.as_deref(), Some("matched"));
    assert_eq!(
        snapback.rqs_generation_digest().expect("generation"),
        with_routes
    );
}

/// `publicInline` is accepted only beside a valid `authorityIndependent`
/// declaration (LLP 0092 §0C.3); the served manifest re-enforces codegen's
/// rule at load.
#[test]
fn public_inline_without_authority_independent_is_a_load_error() {
    let mut invalid = list_cells();
    invalid.authority_independent = false;
    let manifest = FunctionManifest {
        app_id: "wall".to_owned(),
        bundle_hash: Some("rqs-routes-functions-bad".to_owned()),
        functions: vec![invalid],
        ..FunctionManifest::default()
    };
    let error = manifest
        .validate_artifact()
        .expect_err("publicInline without authorityIndependent must refuse");
    assert_eq!(error.diagnostic.code, "SNAPBACK_PUBLIC_INLINE_INVALID");
}

/// `rqsEligible` is derived, never authored: the public projection carries
/// the computed fact, and an authored `rqsEligible` field refuses at load
/// (`deny_unknown_fields`).
#[test]
fn rqs_eligible_is_derived_never_authored() {
    let projection = PublicFunctionManifest::from(wall_functions());
    let projected = serde_json::to_value(&projection).expect("projection serializes");
    let functions = projected["functions"].as_array().expect("functions");
    let by_name = |name: &str| -> &Value {
        functions
            .iter()
            .find(|function| function["name"] == name)
            .expect("named function")
    };
    assert_eq!(by_name("listCells")["rqsEligible"], json!(true));
    assert_eq!(by_name("listCells")["publicInline"], json!(true));
    assert_eq!(by_name("listRanked")["rqsEligible"], json!(true));
    assert!(by_name("listRanked").get("publicInline").is_none());
    assert!(by_name("paintCell").get("rqsEligible").is_none());

    // An authored `rqsEligible` field is an unknown field: refused at load.
    let mut authored = serde_json::to_value(wall_functions()).expect("manifest serializes");
    authored["functions"][0]["rqsEligible"] = json!(true);
    assert!(
        serde_json::from_value::<FunctionManifest>(authored).is_err(),
        "authored rqsEligible must refuse at decode"
    );
}

/// The derived predicate requires the closed-inputs proof: an otherwise
/// identical query with an incomplete read summary is not eligible and its
/// bundle entries answer `resume: null` (the closed union's other arm).
#[tokio::test]
async fn incomplete_read_summary_is_not_eligible() {
    let mut no_summary = list_cells();
    no_summary.read_set_summary = DependencySummary::default();
    assert!(snapback::manifest::rqs_eligible_digest_kind(&no_summary).is_none());
    assert!(snapback::manifest::rqs_eligible_digest_kind(&list_cells()).is_some());

    let app = {
        let snapback = tokio::task::spawn_blocking(move || {
            let _sanction = snapback::exec_guard::BlockingSanction::acquire();
            let mut snapback = LocalSnapback::memory().expect("in-memory instance");
            let mut functions = wall_functions();
            functions.functions[0].read_set_summary = DependencySummary::default();
            functions.bundle_hash = Some("rqs-routes-functions-nosummary".to_owned());
            snapback
                .ensure_app(
                    EnsureAppInput {
                        schema: Some(wall_schema()),
                        functions: Some(functions),
                        seed: None,
                        routes: Some(wall_routes()),
                    },
                    true,
                    "dev",
                )
                .expect("ensure");
            snapback
        })
        .await
        .expect("setup");
        AppState::detached(snapback)
    };
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({ "route": "/board/:boardId", "params": { "boardId": "wall" } }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert!(
        body["entries"][0]["resume"].is_null(),
        "non-eligible entries carry resume: null"
    );
}
