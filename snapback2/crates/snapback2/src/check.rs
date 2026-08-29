//! `snapback2 check`: the certificate as the gate (LLP 0329.014.004 §7), ported from spike S1.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use snapback2_core::{
    Ceilings, Certificate, CheckError, Checker, Index, Program, RuleExpr, Rules, Schema, Table,
    spike_schema,
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
    family: String,
    message: String,
    rewrite: String,
}

impl From<CheckError> for SerializableError {
    fn from(error: CheckError) -> Self {
        Self {
            family: error.code,
            message: error.message,
            rewrite: error.rewrite,
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
                    eprintln!("snapback2 check: cannot read {p}: {e}");
                    return ExitCode::from(2);
                }
            }
        }
        _ => {
            io::stdin()
                .read_to_string(&mut input)
                .expect("read check request from stdin");
        }
    }
    let request: Request = serde_json::from_str(&input).expect("parse check request");
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
        Some(schema) => serde_json::from_value(schema).expect("parse explicit project schema"),
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
                    program: name,
                    certificate: None,
                    error: Some(error.into()),
                },
            },
            Err(message) => ResultItem {
                program: name,
                certificate: None,
                error: Some(SerializableError {
                    family: "E_OPAQUE".to_owned(),
                    message: format!(
                        "program JSON is not supported by this engine build: {message}"
                    ),
                    rewrite: "use a snapback2 binary built with the matching project IR".to_owned(),
                }),
            },
        })
        .collect();
    println!(
        "{}",
        serde_json::to_string(&Response { results }).expect("serialize check response")
    );
    ExitCode::SUCCESS
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
