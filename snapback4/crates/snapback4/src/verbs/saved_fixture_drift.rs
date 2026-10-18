//! Read-only drift inspection for fixtures stored beside saved version sources.
//!
//! This is deliberately a `check` warning rather than fixture execution: a
//! historical case may mutate its memory engine, and `check` must remain an
//! inspection of files against the schema they were saved with.
// @ref LLP 3000.011.003.000.000#11-wave-14-truthful-starter-custody-day4 — saved fixture drift is structural, read-only evidence.
use super::{Options, Project, proof_source, test_cases, test_fixture, test_sweep};
use serde_json::Value as Json;
use snapback4_core::{
    engine::validate::{validate_arg, validate_row},
    ir::{ArgType, ProgramKind},
    schema::{ColumnType, materialize_optional_fields},
    value::Value,
    wire,
};
use std::path::{Path, PathBuf};

pub(super) fn warnings(project: &Project) -> Vec<String> {
    let versions = project.root.join("versions");
    let Ok(entries) = std::fs::read_dir(&versions) else {
        return Vec::new();
    };
    let mut saved = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let number = name.strip_prefix('v')?;
            (!number.is_empty()
                && number.bytes().all(|byte| byte.is_ascii_digit())
                && entry.path().is_dir())
            .then_some(entry.path())
        })
        .collect::<Vec<_>>();
    saved.sort();

    let mut warnings = Vec::new();
    for source in saved {
        let fixture = source.join("fixtures");
        if !fixture.is_dir() {
            continue;
        }
        let options = Options {
            positionals: Vec::new(),
            flags: [("source".into(), source.to_string_lossy().into_owned())].into(),
            json: false,
        };
        let sources = match proof_source::sources(project, &options, "source") {
            Ok(sources) => sources,
            Err(error) => {
                warnings.push(format!(
                    "{}: cannot read saved schema: {error}",
                    shown(project, &source)
                ));
                continue;
            }
        };
        let bound = proof_source::compile(&sources, &options, "source");
        if !bound.diagnostics.is_empty() {
            warnings.push(format!(
                "{}: saved schema has {} compile problem{}; fixtures were not inspected",
                shown(project, &source),
                bound.diagnostics.len(),
                if bound.diagnostics.len() == 1 {
                    ""
                } else {
                    "s"
                }
            ));
            continue;
        }
        inspect_rows(project, &fixture, &bound, &mut warnings);
        inspect_cases(project, &fixture, &bound, &mut warnings);
        inspect_sweep(project, &fixture, &bound, &mut warnings);
    }
    warnings
}

fn shown(project: &Project, path: &Path) -> String {
    path.strip_prefix(&project.root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

fn fixture_files(fixture: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = std::fs::read_dir(fixture)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn inspect_rows(
    project: &Project,
    fixture: &Path,
    bound: &snapback4_lang::Bound,
    warnings: &mut Vec<String>,
) {
    let files = match fixture_files(fixture) {
        Ok(files) => files,
        Err(error) => {
            warnings.push(format!(
                "{}: cannot read fixture directory: {error}",
                shown(project, fixture)
            ));
            return;
        }
    };
    for path in files {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(table) = name.strip_suffix(".jsonl") else {
            continue;
        };
        if name == test_cases::FILE {
            continue;
        }
        let Some(definition) = bound.schema.tables.get(table) else {
            warnings.push(format!(
                "{}: saved schema has no table `{table}`",
                shown(project, &path)
            ));
            continue;
        };
        // Complete-image validation remains authoritative for authored fields.
        // Engine-assigned fields are absent at this read-only input boundary,
        // so a private schema copy marks only those omissions as nullable.
        let mut validation_schema = bound.schema.clone();
        let validation_definition = validation_schema.tables.get_mut(table).unwrap();
        for (field, kind) in &mut validation_definition.columns {
            if definition.sequences.contains_key(field)
                || definition.engine_field(field)
                || snapback4_core::schema::timeline::is_slot(field)
            {
                *kind = ColumnType::Optional(Box::new(kind.clone()));
            }
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) => {
                warnings.push(format!(
                    "{}: cannot read fixture: {error}",
                    shown(project, &path)
                ));
                continue;
            }
        };
        for (index, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let at = format!("{}:{}", shown(project, &path), index + 1);
            let mut row: Json = match serde_json::from_str(line) {
                Ok(row) => row,
                Err(error) => {
                    warnings.push(format!("{at}: invalid JSON: {error}"));
                    continue;
                }
            };
            let Some(fields) = row.as_object() else {
                warnings.push(format!("{at}: fixture row is not an object"));
                continue;
            };
            let unknown = fields
                .keys()
                .filter(|field| !definition.columns.contains_key(*field))
                .cloned()
                .collect::<Vec<_>>();
            for field in &unknown {
                warnings.push(format!("{at}: table `{table}` has no field `{field}`"));
            }
            if !unknown.is_empty() {
                continue;
            }
            let engine_owned = fields.keys().find_map(|field| {
                if snapback4_core::schema::timeline::is_slot(field) {
                    Some(("E_TIMELINE_OWNED", format!("{table}.{field} is an engine event slot; omit it from fixtures")))
                } else if definition.engine_field(field) {
                    Some(("E_RECORDED_FIELD", format!("{table}.{field} is engine-recorded; omit it from fixtures")))
                } else if definition.maintained.contains_key(field) {
                    Some(("E_MAINTAINED_COLUMN", format!("{table}.{field} is engine-maintained; omit it and fixture the source rows")))
                } else {
                    None
                }
            });
            if let Some((code, message)) = engine_owned {
                warnings.push(format!(
                    "{at}: row does not match table `{table}`: {code}: {message}"
                ));
                continue;
            }
            let supplied_sequences = definition
                .sequences
                .keys()
                .filter(|field| fields.contains_key(*field))
                .collect::<Vec<_>>();
            for field in &supplied_sequences {
                warnings.push(format!(
                    "{at}: row does not match table `{table}`: E_SEQUENCE_SUPPLIED: {table}.{field} is engine-assigned; omit {field} from fixtures"
                ));
            }
            if !supplied_sequences.is_empty() {
                continue;
            }
            if let Err(error) =
                test_fixture::relative_times(definition, &mut row, snapback4_core::now_ms())
            {
                warnings.push(format!("{at}: row does not match table `{table}`: {error}"));
                continue;
            }
            if let Some(error) = wire::bare_principal(definition, &row) {
                warnings.push(format!("{at}: row does not match table `{table}`: {error}"));
                continue;
            }
            let now = snapback4_core::now_ms();
            let mut decoded = match wire::row_from_json(definition, &row) {
                Ok(decoded) => decoded,
                Err(error) => {
                    warnings.push(format!("{at}: row does not match table `{table}`: {error}"));
                    continue;
                }
            };
            // The seed path supplies defaults and canonical missing values before
            // validating its complete image. Do the same preparation here, then
            // use the core trust-boundary validator without opening an engine.
            if definition.defaults.keys().any(|name| {
                decoded
                    .as_object()
                    .is_ok_and(|fields| !fields.contains_key(name))
            }) {
                let mut fields = decoded.as_object().unwrap().clone();
                for (name, default) in &definition.defaults {
                    fields
                        .entry(name.clone())
                        .or_insert_with(|| default.value(now, snapback4_core::SYSTEM_PRINCIPAL));
                }
                decoded = Value::Row(fields.into());
            }
            materialize_optional_fields(&mut decoded, definition);
            if let Err(error) = validate_row(&validation_schema, table, &decoded) {
                warnings.push(format!("{at}: row does not match table `{table}`: {error}"));
            }
        }
    }
}

fn inspect_sweep(
    project: &Project,
    fixture: &Path,
    bound: &snapback4_lang::Bound,
    warnings: &mut Vec<String>,
) {
    let fixture_name = fixture.to_string_lossy().into_owned();
    if let Err(error) = test_sweep::load(Some(&fixture_name), bound) {
        warnings.push(format!(
            "{}: {error}",
            shown(project, &fixture.join(test_sweep::FILE))
        ));
    }
}

fn inspect_cases(
    project: &Project,
    fixture: &Path,
    bound: &snapback4_lang::Bound,
    warnings: &mut Vec<String>,
) {
    let path = fixture.join(test_cases::FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            warnings.push(format!(
                "{}: cannot read cases: {error}",
                shown(project, &path)
            ));
            return;
        }
    };
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        let at = format!("{}:{}", shown(project, &path), index + 1);
        let case: Json = match serde_json::from_str(line) {
            Ok(case) => case,
            Err(error) => {
                warnings.push(format!("{at}: invalid JSON: {error}"));
                continue;
            }
        };
        if let Err(error) = test_cases::validate(&case) {
            warnings.push(format!("{at}: {error}"));
            continue;
        }
        let Some(op) = case.get("op").and_then(Json::as_str) else {
            warnings.push(format!("{at}: each case names `op`"));
            continue;
        };
        let Some(program) = bound
            .programs
            .iter()
            .find(|candidate| candidate.program.name == op)
            .map(|candidate| &candidate.program)
        else {
            warnings.push(format!("{at}: saved schema has no operation `{op}`"));
            continue;
        };
        if program.kind == ProgramKind::Job {
            warnings.push(format!(
                "{at}: `{op}` is a job; fixture cases run queries and mutations"
            ));
            continue;
        }
        // E_INPUT cases intentionally exercise malformed argument shapes.
        if case.get("expect").and_then(Json::as_str) == Some("E_INPUT") {
            continue;
        }
        let args = case
            .get("args")
            .cloned()
            .unwrap_or_else(|| Json::Object(Default::default()));
        let Some(fields) = args.as_object() else {
            continue;
        }; // validate already reported this shape.
        for name in fields
            .keys()
            .filter(|name| !program.args.contains_key(*name))
        {
            warnings.push(format!("{at}: operation `{op}` takes no argument `{name}`"));
        }
        for (name, kind) in &program.args {
            let Some(raw) = fields.get(name) else {
                if !matches!(kind, ArgType::Optional(_)) {
                    warnings.push(format!(
                        "{at}: operation `{op}` is missing argument `{name}`"
                    ));
                }
                continue;
            };
            if dynamic_alias(raw) {
                continue;
            }
            let mut one = Json::Object(
                [(name.clone(), test_cases::literal_escapes(raw.clone()))]
                    .into_iter()
                    .collect(),
            );
            if let Err(error) =
                test_fixture::argument_times(&program.args, &mut one, snapback4_core::now_ms())
            {
                warnings.push(format!("{at}: operation `{op}` argument `{name}`: {error}"));
                continue;
            }
            let value = &one.as_object().unwrap()[name];
            let decoded = match wire::from_json(kind, value) {
                Ok(decoded) => decoded,
                Err(error) => {
                    warnings.push(format!("{at}: operation `{op}` argument `{name}` does not match the saved schema: {error}"));
                    continue;
                }
            };
            if let Err(error) = validate_arg(&bound.schema, kind, &decoded, name) {
                warnings.push(format!("{at}: operation `{op}` argument `{name}` does not match the saved schema: {error}"));
            }
        }
    }
}

fn dynamic_alias(value: &Json) -> bool {
    match value {
        Json::String(text) => text.starts_with('$') && !text.starts_with("$$") && text.len() > 1,
        Json::Array(items) => items.iter().any(dynamic_alias),
        Json::Object(fields) if fields.len() == 1 && fields.contains_key("$literal") => false,
        Json::Object(fields) => fields.values().any(dynamic_alias),
        _ => false,
    }
}
