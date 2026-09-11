//! `snapback2 check`: the certificate as the gate (LLP 0329.014.004 §7), ported from spike S1.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use snapback2_core::{
    Auth, Ceilings, Certificate, CheckError, EffectDecl, Generation, Index, Program, ProjectJson,
    RuleExpr, Rules, Schema, Table, spike_schema, validate_schema,
};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read};
use std::path::Path;
use std::process::ExitCode;

use crate::project;
use crate::protocol::certification_family_guide;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    programs: Vec<Value>,
    #[serde(default)]
    schema: Option<Value>,
    #[serde(default)]
    schema_mode: SchemaMode,
    #[serde(default)]
    effects: Vec<EffectDecl>,
    #[serde(default)]
    auth: Option<Auth>,
    #[serde(default)]
    version: Option<u32>,
    #[serde(default)]
    ceilings: Option<Ceilings>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SchemaMode {
    #[default]
    Spike,
    Synthetic,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    results: Vec<ResultItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultItem {
    program: String,
    certificate: Option<Certificate>,
    error: Option<SerializableError>,
}

#[derive(Debug, Serialize)]
struct SerializableError {
    code: String,
    family: String,
    message: String,
    site: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    rule: Option<String>,
    rewrite: String,
    guide: String,
}

impl SerializableError {
    fn from_certify(error: CheckError, site: impl Into<String>) -> Self {
        let (family, guide) = certification_family_guide(&error.code);
        // A job-shape refusal carries the authored statement explicitly; other
        // certificate errors fall back to the enclosing program supplied here.
        let site = error.site.clone().unwrap_or_else(|| site.into());
        let rule = (error.code == "E_STRUCTURAL_FANOUT")
            .then(|| "a mutation population loop covers its selected range".to_owned());
        Self {
            code: error.code,
            family: family.to_owned(),
            message: error.message,
            site,
            rule,
            rewrite: error.rewrite,
            guide: guide.to_owned(),
        }
    }

    fn unsupported(site: &str, message: impl Into<String>) -> Self {
        Self {
            code: "E_CHECK_IR_UNSUPPORTED".to_owned(),
            family: "op".to_owned(),
            message: message.into(),
            site: site.to_owned(),
            rule: Some("the compiler and engine use the same project IR".to_owned()),
            rewrite: "use a snapback2 binary built with the matching project IR".to_owned(),
            guide: "programs/ir".to_owned(),
        }
    }

    fn input(site: &str, message: impl Into<String>) -> Self {
        Self {
            code: "E_CHECK_INPUT".to_owned(),
            family: "input".to_owned(),
            message: message.into(),
            site: site.to_owned(),
            rule: None,
            rewrite: "pass a readable project JSON file or pipe project JSON on stdin".to_owned(),
            guide: "programs/check".to_owned(),
        }
    }

    fn schema(error: snapback2_core::RuntimeError) -> Self {
        let code = error.code().to_owned();
        let mut message = error
            .to_string()
            .strip_prefix(&format!("{code}:"))
            .map(|message| message.trim_start().to_owned())
            .unwrap_or_else(|| error.to_string());
        let (mut family, mut guide, mut site) = ("schema", "schema/project", "<project>:schema".to_owned());
        let rewrite = match &error {
            snapback2_core::RuntimeError::SchemaConstraint { rewrite, .. } => rewrite.clone(),
            // @ref LLP 1019#1-the-declaration — a `deliver` refusal keeps its own
            // code, family, page, rewrite, and the declaration's site even when the
            // certify row is not located: `validate_schema` prefixes the site.
            snapback2_core::RuntimeError::SchemaDeliver { rewrite, .. } => {
                (family, guide) = certification_family_guide(&code);
                if let Some((declaration, rest)) = message.split_once(": ")
                    && declaration.starts_with("schema.tables.")
                {
                    site = declaration.to_owned();
                    message = rest.to_owned();
                }
                rewrite.clone()
            }
            _ => "restore the compiler-emitted schema invariants".to_owned(),
        };
        Self {
            code,
            family: family.to_owned(),
            message,
            site,
            rule: None,
            rewrite,
            guide: guide.to_owned(),
        }
    }
}

/// `snapback2 check` over stdin or `snapback2 check --ir project.json`.
/// The explicit-schema request and ProjectJson share `{ schema, programs }`;
/// additive project fields are intentionally ignored by serde.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — ProjectJson certification reports a result for every program.
pub fn run(path: Option<&str>, json: bool) -> ExitCode {
    let mut input = String::new();
    match path {
        Some(p) if p != "-" => {
            input = match std::fs::read_to_string(p) {
                Ok(s) => s,
                Err(e) => {
                    return print_response_with_code(
                        vec![refused_item(
                            "<input>",
                            SerializableError::input(p, format!("cannot read check input: {e}")),
                        )],
                        json,
                        2,
                    );
                }
            }
        }
        _ => {
            if let Err(error) = io::stdin().read_to_string(&mut input) {
                return print_response_with_code(
                    vec![refused_item(
                        "<input>",
                        SerializableError::input(
                            "<stdin>:1:1",
                            format!("cannot read check input: {error}"),
                        ),
                    )],
                    json,
                    2,
                );
            }
        }
    }
    if input.trim().is_empty() {
        return print_response_with_code(
            vec![refused_item(
                "<input>",
                SerializableError::input("<stdin>:1:1", "check --ir received empty input"),
            )],
            json,
            2,
        );
    }
    run_input(input, json)
}

pub fn run_input(input: String, json: bool) -> ExitCode {
    let request: Request = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => {
            return print_response(
                vec![refused_item(
                    "<request>",
                    SerializableError::unsupported(
                        "<request>:1:1",
                        format!(
                            "check request JSON is not supported by this engine build: {error}"
                        ),
                    ),
                )],
                json,
            );
        }
    };
    print_response(check_request(request), json)
}

fn check_request(request: Request) -> Vec<ResultItem> {
    let ceilings = request.ceilings.unwrap_or_default();
    let programs: Vec<(String, Result<Program, String>)> = request
        .programs
        .into_iter()
        .map(|value| {
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("<unknown>")
                .to_owned();
            let program = serde_json::from_value(value).map_err(|error| error.to_string());
            (name, program)
        })
        .collect();
    let parsed_programs: Vec<Program> = programs
        .iter()
        .filter_map(|(_, program)| program.as_ref().ok().cloned())
        .collect();
    let schema = match request.schema {
        Some(schema) => match serde_json::from_value(schema) {
            Ok(schema) => schema,
            Err(error) => {
                let mut results = vec![refused_item(
                    "<schema>",
                    SerializableError::unsupported(
                        "<project>:schema",
                        format!("project schema contains an unsupported IR variant: {error}"),
                    ),
                )];
                results.extend(uncertified_program_results(
                    programs,
                    "program cannot be certified because the project schema is unsupported",
                ));
                return results;
            }
        },
        None => match request.schema_mode {
            SchemaMode::Spike => spike_schema(),
            SchemaMode::Synthetic => synthetic_schema(&parsed_programs),
        },
    };
    if let Err(errors) = validate_schema(&schema) {
        // Preserve cap declaration sites alongside every other schema refusal.
        // Only invalid schemas need this lookup; successful certification runs once.
        let located = Generation::certify(
            &ProjectJson {
                version: 1,
                schema: schema.clone(),
                programs: vec![],
                effects: vec![],
                auth: Auth::default(),
            },
            ceilings.clone(),
        )
        .err()
        .unwrap_or_default();
        let mut results = errors
            .into_iter()
            .map(|error| {
                // A cap or `deliver` refusal keeps its own code, site, family, and page.
                let located_cap = match &error {
                    snapback2_core::RuntimeError::SchemaConstraint { message, .. } => located
                        .iter()
                        .find(|(_, e)| e.code == "E_SCHEMA_CONSTRAINT" && &e.message == message),
                    snapback2_core::RuntimeError::SchemaDeliver { code, message, .. } => located
                        .iter()
                        .find(|(_, e)| &e.code == code && message.ends_with(&e.message)),
                    _ => None,
                };
                let error = match located_cap {
                    Some((site, error)) => {
                        SerializableError::from_certify(error.clone(), site.clone())
                    }
                    None => SerializableError::schema(error),
                };
                refused_item("<schema>", error)
            })
            .collect::<Vec<_>>();
        results.extend(uncertified_program_results(
            programs,
            "program cannot be certified because the project schema is invalid",
        ));
        return results;
    }
    let project = ProjectJson {
        version: request.version.unwrap_or(1),
        auth: request.auth.unwrap_or_else(|| schema.auth.clone()),
        schema,
        programs: parsed_programs,
        effects: request.effects,
    };
    let program_names: BTreeSet<_> = project
        .programs
        .iter()
        .map(|program| program.name.clone())
        .collect();
    let generation =
        match Generation::certify(&project, ceilings.clone()) {
            Ok(generation) => Some(generation),
            Err(errors)
                if errors.iter().all(|(site, error)| {
                    program_names.contains(site) && error.code != "E_OP_DUPLICATE"
                }) =>
            {
                // Preserve the check command's per-program outcomes. A failed
                // generation exposes no partial certificates, so retry each
                // operation through the same complete trust boundary.
                None
            }
            Err(errors) => {
                let refused_programs: BTreeSet<_> = errors
                    .iter()
                    .filter_map(|(site, _)| program_names.contains(site).then_some(site.clone()))
                    .collect();
                let mut results = errors
                    .into_iter()
                    .map(|(site, error)| {
                        let program = if program_names.contains(&site) {
                            site.clone()
                        } else {
                            "<schema>".to_owned()
                        };
                        refused_item(&program, SerializableError::from_certify(error, site))
                    })
                    .collect::<Vec<_>>();
                results.extend(programs.into_iter().filter_map(|(name, program)| {
                match program {
                    Err(message) => Some(refused_item(
                        &name,
                        SerializableError::unsupported(
                            &format!("<project>:{name}"),
                            format!("program JSON contains an unsupported IR variant: {message}"),
                        ),
                    )),
                    Ok(_) if !refused_programs.contains(&name) => Some(refused_item(
                        &name,
                        SerializableError::unsupported(
                            &format!("<project>:{name}"),
                            "program cannot be certified because project certification failed",
                        ),
                    )),
                    Ok(_) => None,
                }
            }));
                return results;
            }
        };
    match generation {
        Some(generation) => programs
            .into_iter()
            .map(|(name, program)| match program {
                Ok(_) => {
                    // A schedule binding is certified beside the operations, not among them.
                    let certificate = generation
                        .programs()
                        .get(&name)
                        .map(|(_, certificate)| certificate.clone())
                        .or_else(|| generation.timer_binding(&name).map(|(_, c)| c.clone()))
                        .expect("certified generation contains every parsed program");
                    ResultItem {
                        program: name,
                        certificate: Some(certificate),
                        error: None,
                    }
                }
                Err(message) => refused_item(
                    &name,
                    SerializableError::unsupported(
                        &format!("<project>:{name}"),
                        format!("program JSON contains an unsupported IR variant: {message}"),
                    ),
                ),
            })
            .collect(),
        None => programs
            .into_iter()
            .flat_map(|(name, program)| match program {
                Err(message) => vec![refused_item(
                    &name,
                    SerializableError::unsupported(
                        &format!("<project>:{name}"),
                        format!("program JSON contains an unsupported IR variant: {message}"),
                    ),
                )],
                Ok(program) => {
                    let mut single = project.clone();
                    // Schedule bindings ride along: a schedule certifies only beside its binding.
                    let bindings = single
                        .schema
                        .schedules
                        .iter()
                        .map(|schedule| schedule.binding.clone())
                        .collect::<BTreeSet<_>>();
                    single.programs = project
                        .programs
                        .iter()
                        .filter(|p| bindings.contains(&p.name) && p.name != name)
                        .cloned()
                        .chain(std::iter::once(program))
                        .collect();
                    match Generation::certify(&single, ceilings.clone()) {
                        Ok(generation) => vec![ResultItem {
                            program: name.clone(),
                            certificate: Some(
                                generation
                                    .programs()
                                    .get(&name)
                                    .map(|(_, certificate)| certificate.clone())
                                    .or_else(|| {
                                        generation.timer_binding(&name).map(|(_, c)| c.clone())
                                    })
                                    .expect("certified generation contains its parsed program"),
                            ),
                            error: None,
                        }],
                        Err(errors) => errors
                            .into_iter()
                            .map(|(site, error)| {
                                let site = if site == name {
                                    format!("<project>:{site}")
                                } else {
                                    site
                                };
                                refused_item(&name, SerializableError::from_certify(error, site))
                            })
                            .collect(),
                    }
                }
            })
            .collect(),
    }
}

fn uncertified_program_results(
    programs: Vec<(String, Result<Program, String>)>,
    schema_message: &str,
) -> impl Iterator<Item = ResultItem> {
    programs.into_iter().map(move |(name, program)| {
        let error = match program {
            Err(message) => SerializableError::unsupported(
                &format!("<project>:{name}"),
                format!("program JSON contains an unsupported IR variant: {message}"),
            ),
            Ok(_) => SerializableError::unsupported(&format!("<project>:{name}"), schema_message),
        };
        refused_item(&name, error)
    })
}

/// Compile and certify an authored project, then refresh its uncommitted build cache.
// @ref LLP 1002#6-verbs-this-wave — project check is the one-shot owner pipeline.
pub fn run_project(root: &Path, json: bool) -> ExitCode {
    match project::compile_once(root) {
        Ok(compiled) => {
            let generation = compiled.generation.hash();
            let short = &generation[..generation.len().min(8)];
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "ok": true,
                        "generation": generation,
                        "operations": compiled.generation.programs().len(),
                        "schemaCertificate": compiled.generation.schema_certificate(),
                        "compilerMs": compiled.compiler_ms,
                    })
                );
            } else {
                println!("ok {short} {} ops", compiled.generation.programs().len());
            }
            ExitCode::SUCCESS
        }
        Err(refusals) => {
            for refusal in refusals {
                if json {
                    println!("{}", serde_json::to_string(&refusal).unwrap_or_default());
                } else {
                    print!(
                        "{}",
                        format_diagnostic(
                            &refusal.code,
                            refusal.site.as_deref(),
                            &refusal.message,
                            refusal.rewrite.as_deref()
                        )
                    );
                }
            }
            ExitCode::from(1)
        }
    }
}

fn refused_item(program: &str, error: SerializableError) -> ResultItem {
    ResultItem {
        program: program.to_owned(),
        certificate: None,
        error: Some(error),
    }
}

fn print_response(results: Vec<ResultItem>, json: bool) -> ExitCode {
    let refused = results.iter().any(|item| item.error.is_some());
    print_results(results, json);
    if refused {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn print_response_with_code(results: Vec<ResultItem>, json: bool, code: u8) -> ExitCode {
    print_results(results, json);
    ExitCode::from(code)
}

fn print_results(results: Vec<ResultItem>, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string(&Response { results }).expect("serialize check response")
        );
        return;
    }
    for result in results {
        if let Some(error) = result.error {
            print!(
                "{}",
                format_diagnostic(
                    &error.code,
                    Some(&error.site),
                    &error.message,
                    Some(&error.rewrite)
                )
            );
        } else {
            println!("ok {}", result.program);
        }
    }
}

fn synthetic_schema(programs: &[Program]) -> Schema {
    let mut schema = spike_schema();
    let mut reads = BTreeSet::new();
    let mut writes = BTreeSet::new();
    for program in programs {
        collect_sites(
            &serde_json::to_value(program).expect("serialize program for synthetic schema"),
            &mut reads,
            &mut writes,
        );
    }
    for (table_name, index_name) in reads {
        let table = schema
            .tables
            .entry(table_name)
            .or_insert_with(synthetic_table);
        table.indexes.entry(index_name).or_insert(Index {
            components: (vec!["id".to_owned()])
                .into_iter()
                .map(snapback2_core::search_key::IndexComponent::Column)
                .collect(),
            unique: false,
        });
    }
    for table_name in writes {
        schema
            .tables
            .entry(table_name)
            .or_insert_with(synthetic_table);
    }
    schema
}

fn synthetic_table() -> Table {
    let public = RuleExpr::Public {
        reason: "frontend synthetic checker schema".to_owned(),
    };
    Table {
        columns: BTreeMap::from([("id".to_owned(), snapback2_core::ColumnType::Id)]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
        rules: Rules {
            read: public.clone(),
            insert: public.clone(),
            update: public.clone(),
            delete: public,
        },
        constraints: Vec::new(),
        retain: Default::default(),
        tombstones: Vec::new(),
        deliver: None,
    }
}

fn collect_sites(
    value: &Value,
    reads: &mut BTreeSet<(String, String)>,
    writes: &mut BTreeSet<String>,
) {
    match value {
        Value::Array(values) => values
            .iter()
            .for_each(|value| collect_sites(value, reads, writes)),
        Value::Object(values) => {
            if let (Some(Value::String(table)), Some(Value::String(index))) =
                (values.get("table"), values.get("index"))
            {
                reads.insert((table.clone(), index.clone()));
            }
            for kind in ["Insert", "Update", "Upsert", "Delete"] {
                if let Some(Value::Object(write)) = values.get(kind)
                    && let Some(Value::String(table)) = write.get("table")
                {
                    writes.insert(table.clone());
                }
            }
            values
                .values()
                .for_each(|value| collect_sites(value, reads, writes));
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn invalid_implicit_id_and_program_parse_errors_are_reported_together() {
        let mut schema = serde_json::to_value(spike_schema()).unwrap();
        schema["tables"]["conversations"]["columns"]["id"] = json!({ "Text": { "max": 32 } });
        schema["tables"]["messages"]["columns"]["id"] = json!({ "Text": { "max": 32 } });
        let results = check_request(Request {
            programs: vec![json!({
                "name": "broken.program",
                "kind": "notAProgramKind",
                "args": {},
                "body": []
            })],
            schema: Some(schema),
            schema_mode: SchemaMode::Spike,
            effects: Vec::new(),
            auth: None,
            version: None,
            ceilings: None,
        });

        assert_eq!(results.len(), 3);
        assert_eq!(results[0].program, "<schema>");
        assert_eq!(results[0].error.as_ref().unwrap().code, "E_SCHEMA");
        assert!(
            results[0]
                .error
                .as_ref()
                .unwrap()
                .message
                .contains("conversations")
        );
        assert_eq!(results[1].program, "<schema>");
        assert_eq!(results[1].error.as_ref().unwrap().code, "E_SCHEMA");
        assert!(
            results[1]
                .error
                .as_ref()
                .unwrap()
                .message
                .contains("messages")
        );
        assert_eq!(results[2].program, "broken.program");
        assert_eq!(
            results[2].error.as_ref().unwrap().code,
            "E_CHECK_IR_UNSUPPORTED"
        );
        assert!(
            results[2]
                .error
                .as_ref()
                .unwrap()
                .message
                .contains("program JSON")
        );
    }

    /// The chat shape with `deliver` on messages and its generated log; `capped`
    /// false leaves memberships without the cap the prefix must pin.
    fn custody_schema(capped: bool) -> Schema {
        use snapback2_core::{ColumnType, Constraint, delivery, public_table};
        let column = |name: &str| snapback2_core::search_key::IndexComponent::Column(name.to_owned());
        let index = |columns: &[&str], unique: bool| Index {
            components: columns.iter().map(|name| column(name)).collect(),
            unique,
        };
        let by_id = BTreeMap::from([("byId".to_owned(), index(&["id"], true))]);
        let conversations = public_table(BTreeMap::from([("id".to_owned(), ColumnType::Id)]), by_id.clone());
        let mut memberships = public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                ("conversationId".to_owned(), ColumnType::Ref { table: "conversations".to_owned() }),
                ("principal".to_owned(), ColumnType::Principal),
            ]),
            BTreeMap::from([
                ("byId".to_owned(), index(&["id"], true)),
                ("byConversationPrincipal".to_owned(), index(&["conversationId", "principal"], false)),
            ]),
        );
        if capped {
            memberships.constraints.push(Constraint::Cap { by: vec!["conversationId".to_owned()], max: 50 });
        }
        let deliver = delivery::Deliver {
            target: "memberships".to_owned(),
            prefix: vec!["conversationId".to_owned()],
            principal: "principal".to_owned(),
            log: "deliveries".to_owned(),
            receipts: false,
            bootstrap: false,
        };
        let mut messages = public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                ("conversationId".to_owned(), ColumnType::Ref { table: "conversations".to_owned() }),
            ]),
            by_id,
        );
        messages.deliver = Some(deliver.clone());
        let mut schema = Schema::default();
        schema.tables.insert("conversations".to_owned(), conversations);
        schema.tables.insert("memberships".to_owned(), memberships);
        schema.tables.insert("messages".to_owned(), messages);
        let log = delivery::log_table(&schema, "messages", &deliver).expect("log shape");
        schema.tables.insert("deliveries".to_owned(), log);
        schema
    }

    fn check_schema(schema: Schema, programs: Vec<Value>) -> Vec<ResultItem> {
        check_request(Request {
            programs,
            schema: Some(serde_json::to_value(schema).unwrap()),
            schema_mode: SchemaMode::Spike,
            effects: Vec::new(),
            auth: None,
            version: None,
            ceilings: None,
        })
    }

    // @ref LLP 1019#1-the-declaration — the raw-schema form refuses under the
    // compiler's codes, families, and page, at the declaration's site.
    #[test]
    fn deliver_refusals_keep_their_codes_families_and_pages_on_the_ir_path() {
        let results = check_schema(custody_schema(false), Vec::new());
        let error = results[0].error.as_ref().unwrap();
        assert_eq!(results[0].program, "<schema>");
        assert_eq!(
            (error.code.as_str(), error.family.as_str(), error.guide.as_str(), error.site.as_str()),
            ("E_DELIVER_UNBOUNDED", "bound", "deliver", "schema.tables.messages.deliver")
        );
        assert_eq!(error.rewrite, "cap 50 by conversationId");
        assert_eq!(
            error.message,
            "deliver to memberships[.conversationId] pins no capped group: memberships has no cap N by conversationId"
        );

        let forged = json!({
            "name": "ops.forge", "kind": "Mutation", "args": {}, "read_time_granularity_ms": null,
            "body": [{ "Insert": { "table": "deliveries", "row": { "Object": { "id": { "Input": "NewId" } } } } }, { "Return": { "Literal": "Null" } }]
        });
        let results = check_schema(custody_schema(true), vec![forged]);
        let error = results[0].error.as_ref().unwrap();
        assert_eq!(results[0].program, "ops.forge");
        assert_eq!(
            (error.code.as_str(), error.family.as_str(), error.guide.as_str()),
            ("E_SCHEMA_DELIVER", "schema", "deliver")
        );
        assert!(error.message.contains("engine-owned table deliveries"), "{}", error.message);
        assert!(check_schema(custody_schema(true), Vec::new()).iter().all(|item| item.error.is_none()));

        let mut misnamed = custody_schema(true);
        misnamed.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().principal = "conversationId".to_owned();
        let results = check_schema(misnamed, Vec::new());
        let error = results[0].error.as_ref().unwrap();
        assert_eq!(
            (error.code.as_str(), error.family.as_str(), error.guide.as_str(), error.site.as_str()),
            ("E_DELIVER_PRINCIPAL", "schema", "deliver", "schema.tables.messages.deliver")
        );
        assert_eq!(error.rewrite, "deliver to memberships[.conversationId] by .principal as deliveries");
        assert_eq!(
            error.message,
            "deliver by .conversationId: memberships.conversationId is Ref(conversations), not principal"
        );
    }

    #[test]
    fn maintained_content_deliver_refusal_keeps_every_wire_label() {
        let mut schema = custody_schema(true);
        schema.tables.get_mut("messages").unwrap().columns.insert("value".into(), snapback2_core::ColumnType::Int);
        schema.maintains.push(snapback2_core::Maintain {
            target: "messages".into(), source: "memberships".into(),
            by: vec!["conversationId".into()], kind: snapback2_core::MaintainKind::Count, readable: None,
        });
        let result = serde_json::to_value(check_schema(schema, Vec::new())).unwrap();
        let error = &result[0]["error"];
        assert_eq!(error["code"], "E_SCHEMA_DELIVER");
        assert_eq!(error["family"], "schema");
        assert_eq!(error["guide"], "deliver");
        assert_eq!(error["site"], "schema.tables.messages.deliver");
        assert_eq!(error["rewrite"], "remove the deliver line from messages; declare deliver on the maintain's source table");
    }

    // @ref LLP 1019#1-the-declaration — when the certify row is not located, the
    // fallback still carries the delivery code's family, page, rewrite, and site.
    #[test]
    fn an_unlocated_deliver_refusal_keeps_its_labels_on_the_ir_path() {
        let error = SerializableError::schema(snapback2_core::RuntimeError::SchemaDeliver {
            code: "E_DELIVER_PRINCIPAL".to_owned(),
            message: "schema.tables.messages.deliver: deliver by .nobody: memberships has no such column".to_owned(),
            rewrite: "deliver to memberships[.conversationId] by .principal as deliveries".to_owned(),
        });
        assert_eq!(
            (error.code.as_str(), error.family.as_str(), error.guide.as_str(), error.site.as_str()),
            ("E_DELIVER_PRINCIPAL", "schema", "deliver", "schema.tables.messages.deliver")
        );
        assert_eq!(error.message, "deliver by .nobody: memberships has no such column");
        assert_eq!(error.rewrite, "deliver to memberships[.conversationId] by .principal as deliveries");
        assert!(error.rule.is_none());

        let unbounded = SerializableError::schema(snapback2_core::RuntimeError::SchemaDeliver {
            code: "E_DELIVER_UNBOUNDED".to_owned(),
            message: "schema.tables.messages.deliver: pins no capped group".to_owned(),
            rewrite: "cap 50 by conversationId".to_owned(),
        });
        assert_eq!((unbounded.family.as_str(), unbounded.guide.as_str()), ("bound", "deliver"));

        let generic = SerializableError::schema(snapback2_core::RuntimeError::Schema("missing table".to_owned()));
        assert_eq!(
            (generic.code.as_str(), generic.family.as_str(), generic.guide.as_str(), generic.site.as_str()),
            ("E_SCHEMA", "schema", "schema/project", "<project>:schema")
        );
        assert_eq!(generic.rewrite, "restore the compiler-emitted schema invariants");
    }

    #[test]
    fn reserved_application_auth_codes_keep_the_operation_error_envelope() {
        let error = SerializableError::from_certify(
            CheckError {
                site: None,
                code: "E_OP_RESERVED".to_owned(),
                message:
                    "application refusal code E_AUTH_SESSION uses the reserved E_AUTH_* namespace"
                        .to_owned(),
                rewrite: "use an application-owned refusal code without the E_AUTH_ prefix"
                    .to_owned(),
            },
            "<project>:ops.reject",
        );

        assert_eq!(error.code, "E_OP_RESERVED");
        assert_eq!(error.family, "op");
        assert_eq!(error.guide, "programs/operations");
    }
    #[test]
    fn cap_schema_sites_do_not_hide_other_schema_or_program_errors() {
        let mut schema = spike_schema();
        schema
            .tables
            .get_mut("memberships")
            .unwrap()
            .constraints
            .push(snapback2_core::Constraint::Cap {
                by: vec!["conversationId".into()],
                max: 0,
            });
        schema
            .tables
            .get_mut("messages")
            .unwrap()
            .indexes
            .values_mut()
            .next()
            .unwrap()
            .components
            .push(snapback2_core::search_key::IndexComponent::Column(
                "missing".into(),
            ));
        let results = check_request(Request {
            programs: vec![serde_json::json!({"name":"broken", "kind":"invalid"})],
            schema: Some(serde_json::to_value(schema).unwrap()),
            schema_mode: SchemaMode::Spike,
            effects: vec![],
            auth: None,
            version: None,
            ceilings: None,
        });
        assert!(results.iter().any(|r| {
            r.error.as_ref().is_some_and(|e| {
                e.code == "E_SCHEMA_CONSTRAINT"
                    && e.site.starts_with("schema.tables.memberships.constraints[")
            })
        }));
        assert!(results.iter().any(|r| {
            r.error
                .as_ref()
                .is_some_and(|e| e.message.contains("missing"))
        }));
        assert!(results.iter().any(|r| r.program == "broken"));
    }
}

// @ref LLP 1002#diagnostics-say-the-fix — preserve the entire repair in both check forms.
fn format_diagnostic(
    code: &str,
    site: Option<&str>,
    message: &str,
    rewrite: Option<&str>,
) -> String {
    let mut output = format!(
        "refused {code}{}\n",
        site.map(|site| format!(" at {site}")).unwrap_or_default()
    );
    wrap_diagnostic(&mut output, &format!("message: {message}"));
    if let Some(rewrite) = rewrite {
        wrap_diagnostic(&mut output, &format!("rewrite: {rewrite}"));
    }
    output
}

fn wrap_diagnostic(output: &mut String, text: &str) {
    let mut first = true;
    for line in text.split('\n') {
        let chars: Vec<char> = line.chars().collect();
        let mut remaining = chars.as_slice();
        loop {
            let width = if first { 98 } else { 96 };
            let count = if remaining.len() <= width {
                remaining.len()
            } else {
                remaining[..width]
                    .iter()
                    .rposition(|c| c.is_whitespace())
                    .map(|i| i + 1)
                    .unwrap_or(width)
            };
            output.push_str(if first { "  " } else { "    " });
            first = false;
            output.extend(&remaining[..count]);
            output.push('\n');
            remaining = &remaining[count..];
            if remaining.is_empty() {
                break;
            }
        }
    }
}

#[cfg(test)]
#[test]
fn check_preserves_a_200_character_rewrite_and_unicode_message() {
    let rewrite = "x".repeat(200);
    let message = "é".repeat(200);
    let printed = format_diagnostic("E_INPUT", Some("messages.q:2:3"), &message, Some(&rewrite));
    assert!(printed.lines().all(|line| line.chars().count() <= 100));
    let joined = printed
        .lines()
        .skip(1)
        .map(|line| line.strip_prefix("    ").or_else(|| line.strip_prefix("  ")).unwrap())
        .collect::<String>();
    assert_eq!(joined, format!("message: {message}rewrite: {rewrite}"));
}

#[cfg(test)]
#[test]
fn check_hangs_wrapped_candidate_index_repairs_under_the_rewrite() {
    let rewrite = "posts[] first 50 by byTime; posts[] first 50 by byAuthorTime; candidate indexes: posts.byTime (at: time, id: posts); posts.byAuthorTime (authorId: principal, at: time, id: posts)";
    let printed = format_diagnostic("E_UNBOUND_SCAN", Some("posts.q:2:3"), "`posts[]` reads a range; name its bound", Some(rewrite));
    let lines: Vec<_> = printed.lines().skip_while(|line| !line.starts_with("  rewrite:")).collect();
    assert!(lines.len() > 1);
    assert!(lines.iter().skip(1).all(|line| line.starts_with("    ")), "{printed}");
    let joined: String = lines.iter().enumerate().map(|(i, line)| &line[if i == 0 { 2 } else { 4 }..]).collect();
    assert_eq!(joined, format!("rewrite: {rewrite}"));
    assert!(printed.lines().all(|line| line.chars().count() <= 100));
}

// @ref LLP 1020#a4-check---cost — diagnostic certificates never enter the build cache or grant admission.
pub fn run_cost_project(root: &Path, selected: Option<&str>, json: bool) -> ExitCode {
    let lowered = project::CompilerWorker::spawn()
        .map_err(|error| vec![error])
        .and_then(|mut worker| worker.lower_source(root, None));
    let (project, source) = match lowered {
        Ok(value) => value,
        Err(errors) => {
            for error in errors {
                if json { println!("{}", serde_json::to_string(&error).unwrap()); }
                else { print!("{}", format_diagnostic(&error.code, error.site.as_deref(), &error.message, error.rewrite.as_deref())); }
            }
            return ExitCode::from(1);
        }
    };
    let ceilings = Ceilings::default();
    let request: Request = serde_json::from_value(serde_json::to_value(&project).unwrap()).unwrap();
    let mut results = check_request(request);
    let refused = results.iter().any(|item| item.error.is_some());
    if let Some(name) = selected {
        let matches: Vec<_> = project.programs.iter().filter(|p| p.name == name || p.name.rsplit('.').next() == Some(name)).collect();
        if matches.len() != 1 {
            return crate::owner::print_refusal(crate::protocol::Refusal::input(
                format!("cost operation {name} is unknown or ambiguous"),
                format!("use one of {}", project.programs.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")),
            ), json, 2);
        }
        results.retain(|item| item.program == matches[0].name || item.program == "<schema>");
    }
    let checker = snapback2_core::Checker::new(&project.schema, ceilings.clone());
    let schema_valid = validate_schema(&project.schema).is_ok();
    let mut reports = Vec::new();
    let mut seen = BTreeSet::new();
    for item in &results {
        if !seen.insert(item.program.clone()) { continue; }
        let Some(program) = project.programs.iter().find(|p| p.name == item.program) else { continue; };
        let certificate = item.certificate.clone().or_else(|| schema_valid.then(|| checker.inspect(program).certificate).flatten());
        let errors: Vec<_> = results.iter().filter(|r| r.program == item.program).filter_map(|r| r.error.as_ref()).collect();
        if !json {
            println!("{} ({:?}) — {}", program.name, program.kind, if errors.is_empty() { "admitted" } else { "refused; partial certificate" });
            if let Some(certificate) = &certificate {
                print_cost(certificate, &source.sources, &ceilings);
            } else { println!("  priced plan unavailable: program could not be analyzed"); }
            for error in &errors { print!("{}", format_diagnostic(&error.code, Some(&error.site), &error.message, Some(&error.rewrite))); }
        }
        reports.push(serde_json::json!({"program": program.name, "kind": program.kind,
            "admitted": errors.is_empty(), "certificate": certificate, "errors": errors}));
    }
    if json { println!("{}", serde_json::json!({"ok": !refused, "ceilings": ceilings, "results": reports, "sources": source.sources,
        "schemaErrors": results.iter().filter(|r| r.program == "<schema>").collect::<Vec<_>>() })); }
    else {
        for item in results.iter().filter(|r| r.program == "<schema>") {
            if let Some(error) = &item.error { print!("{}", format_diagnostic(&error.code, Some(&error.site), &error.message, Some(&error.rewrite))); }
        }
    }
    if refused { ExitCode::from(1) } else { ExitCode::SUCCESS }
}

/// A merge site is spelled `file:line:col` by the compiler; read it as the location it names.
fn site_location(site: &str) -> Option<project::SourceSite> {
    let (rest, col) = site.rsplit_once(':')?;
    let (file, line) = rest.rsplit_once(':')?;
    Some(project::SourceSite { file: file.to_owned(), line: line.parse().ok()?, col: col.parse().ok()?, ..Default::default() })
}

fn print_cost(certificate: &Certificate, sources: &BTreeMap<String, project::SourceSite>, ceilings: &Ceilings) {
    if let Some(job) = &certificate.job {
        for (n, chunk) in job.per_chunk.iter().enumerate() {
            println!("  chunk {} (one commit; total chunks unbounded)", n + 1);
            print_cost(chunk, sources, ceilings);
        }
        return;
    }
    const METERS: [&str; 8] = ["examined entries", "index entries", "rule probes", "steps", "heap bytes", "output bytes", "closure bytes", "write rows"];
    println!("  source / term\texamined\tindex\tprobes\tsteps\theap\toutput\tclosure\twrites");
    // One row per (source line, term): a term priced on several meters, or repeated per
    // lowered statement of one authored line, reads as one line with its meters filled in.
    let mut rows: Vec<(String, String, [Option<i128>; 8])> = Vec::new();
    for term in &certificate.cost_terms {
        // A term is placed by its site alone: a declared site, or a merge site that is itself
        // spelled `file:line:col`. A program-level term (a budget reserve, the search closure)
        // prints at the operation's declaration.
        let source = term.site.as_deref().and_then(|id| sources.get(id));
        let location = match (source, term.site.as_deref().and_then(site_location)) {
            (Some(s), _) => Some(s.clone()),
            (None, Some(location)) => Some(location),
            (None, None) => sources.get(&certificate.program).cloned(),
        };
        let location = location.map(|s| { let s = s.r#use.as_deref().unwrap_or(&s); format!("{}:{}", s.file, s.line) })
            .unwrap_or_else(|| term.site.clone().unwrap_or_else(|| certificate.program.clone()));
        let Some(column) = METERS.iter().position(|meter| *meter == term.meter) else { continue };
        let row = match rows.iter_mut().find(|(at, source, _)| *at == location && *source == term.source) {
            Some(row) => row,
            None => { rows.push((location, term.source.clone(), [None; 8])); rows.last_mut().expect("pushed row") }
        };
        row.2[column] = Some(row.2[column].unwrap_or(0) + term.value);
    }
    for (location, source, cells) in rows {
        let cells = cells.map(|cell| cell.map_or_else(|| "·".to_owned(), |value| value.to_string()));
        println!("  {location} {source}\t{}", cells.join("\t"));
    }
    let writes = certificate.write_sites.iter().fold(certificate.maintained_amplification, |n, w| n.saturating_add(w.max_rows));
    println!("total\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}", certificate.max_examined, certificate.max_index_entries,
        certificate.max_rule_probes, certificate.max_steps, certificate.max_heap_bytes, certificate.max_output_bytes, certificate.max_closure_bytes, writes);
    println!("ceilings\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ceilings.examined, ceilings.index_entries, ceilings.rule_probes, ceilings.steps,
        ceilings.heap_bytes, ceilings.output_bytes, ceilings.closure_bytes, ceilings.write_rows);
}
