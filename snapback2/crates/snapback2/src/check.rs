//! `snapback2 check`: the certificate as the gate (LLP 0329.014.004 §7), ported from spike S1.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use snapback2_core::{
    spike_schema, Ceilings, Certificate, CheckError, Checker, Index, Program, RuleExpr, Rules,
    Schema, Table,
};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read};
use std::process::ExitCode;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    programs: Vec<Value>,
    #[serde(default)]
    schema: Option<Value>,
    #[serde(default)]
    schema_mode: SchemaMode,
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
    fn from_check(error: CheckError, program: &str) -> Self {
        let family = if error.code.starts_with("E_BOUND")
            || error.code.starts_with("E_UNBOUND")
            || error.code == "E_STRUCTURAL_COUNT"
        {
            "bound"
        } else {
            "opaque"
        };
        let guide = match error.code.as_str() {
            "E_UNBOUND_SCAN" => "bound/scan",
            "E_STRUCTURAL_COUNT" => "bound/count",
            "E_AMBIENT_TIME" => "opaque/time",
            _ if family == "bound" => "bound/ceiling",
            _ => "opaque/subset",
        };
        Self {
            code: error.code,
            family: family.to_owned(),
            message: error.message,
            site: format!("<project>:{program}"),
            rule: None,
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
}

/// `snapback2 check [request.json]` or `snapback2 check --project project.json`.
/// The explicit-schema request and ProjectJson share `{ schema, programs }`;
/// additive project fields are intentionally ignored by serde.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — ProjectJson certification reports a result for every program.
pub fn run(path: Option<&str>) -> ExitCode {
    let mut input = String::new();
    match path {
        Some(p) if p != "-" => {
            input = match std::fs::read_to_string(p) {
                Ok(s) => s,
                Err(e) => {
                    return print_response(vec![refused_item(
                        "<input>",
                        SerializableError::input(p, format!("cannot read check input: {e}")),
                    )]);
                }
            }
        }
        _ => {
            if let Err(error) = io::stdin().read_to_string(&mut input) {
                return print_response(vec![refused_item(
                    "<input>",
                    SerializableError::input(
                        "<stdin>:1:1",
                        format!("cannot read check input: {error}"),
                    ),
                )]);
            }
        }
    }
    let request: Request = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => {
            return print_response(vec![refused_item(
                "<request>",
                SerializableError::unsupported(
                    "<request>:1:1",
                    format!("check request JSON is not supported by this engine build: {error}"),
                ),
            )]);
        }
    };
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
                return print_response(vec![refused_item(
                    "<schema>",
                    SerializableError::unsupported(
                        "<project>:schema",
                        format!("project schema contains an unsupported IR variant: {error}"),
                    ),
                )]);
            }
        },
        None => match request.schema_mode {
            SchemaMode::Spike => spike_schema(),
            SchemaMode::Synthetic => synthetic_schema(&parsed_programs),
        },
    };
    let checker = Checker::new(&schema, Ceilings::default());
    let results = programs
        .into_iter()
        .map(|(name, program)| match program {
            Ok(program) => match checker.check(&program) {
                Ok(certificate) => ResultItem {
                    program: name,
                    certificate: Some(certificate),
                    error: None,
                },
                Err(error) => ResultItem {
                    program: name.clone(),
                    certificate: None,
                    error: Some(SerializableError::from_check(error, &name)),
                },
            },
            Err(message) => ResultItem {
                program: name.clone(),
                certificate: None,
                error: Some(SerializableError::unsupported(
                    &format!("<project>:{name}"),
                    format!("program JSON contains an unsupported IR variant: {message}"),
                )),
            },
        })
        .collect();
    print_response(results)
}

fn refused_item(program: &str, error: SerializableError) -> ResultItem {
    ResultItem {
        program: program.to_owned(),
        certificate: None,
        error: Some(error),
    }
}

fn print_response(results: Vec<ResultItem>) -> ExitCode {
    let refused = results.iter().any(|item| item.error.is_some());
    println!(
        "{}",
        serde_json::to_string(&Response { results }).expect("serialize check response")
    );
    if refused {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
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
            columns: vec!["id".to_owned()],
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
        columns: BTreeMap::new(),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
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
                if let Some(Value::Object(write)) = values.get(kind) {
                    if let Some(Value::String(table)) = write.get("table") {
                        writes.insert(table.clone());
                    }
                }
            }
            values
                .values()
                .for_each(|value| collect_sites(value, reads, writes));
        }
        _ => {}
    }
}
