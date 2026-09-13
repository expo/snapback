use crate::protocol::{Fault, now};
use serde_json::Value as Json;
use snapback3_core::{
    Ceilings, ColumnType, Generation, ProgramKind, ProjectJson, Runtime, Store, Value,
};
use std::collections::{BTreeMap, BTreeSet};

const KNOWN_CAPABILITIES: &[&str] = &[
    "media",
    "effects",
    "jobs",
    "schedules",
    "channels",
    "connected",
    "clock",
];

#[derive(Clone, Debug, Default)]
pub struct RuntimeCapabilities(BTreeSet<String>);

impl RuntimeCapabilities {
    pub fn parse(value: Option<&str>) -> Result<Self, Fault> {
        let mut capabilities = BTreeSet::new();
        for capability in value
            .unwrap_or_default()
            .split(',')
            .filter(|v| !v.is_empty())
        {
            if !KNOWN_CAPABILITIES.contains(&capability) {
                return Err(Fault::input(format!(
                    "unknown runtime capability {capability}; expected {}",
                    KNOWN_CAPABILITIES.join(",")
                )));
            }
            capabilities.insert(capability.to_owned());
        }
        Ok(Self(capabilities))
    }

    pub fn has(&self, capability: &str) -> bool {
        self.0.contains(capability)
    }

    pub fn names(&self) -> Vec<&str> {
        self.0.iter().map(String::as_str).collect()
    }
}

pub fn certify(
    project: ProjectJson,
    capabilities: &RuntimeCapabilities,
) -> Result<Generation, Fault> {
    let mut missing = BTreeSet::new();
    if (!project.effects.is_empty() || !project.schema.effects.is_empty())
        && !capabilities.has("effects")
    {
        missing.insert("effects");
    }
    if !project.schema.channels.is_empty() && !capabilities.has("channels") {
        missing.insert("channels");
    }
    if !project.schema.schedules.is_empty() && !capabilities.has("schedules") {
        missing.insert("schedules");
    }
    if project.programs.iter().any(|p| p.kind == ProgramKind::Job) && !capabilities.has("jobs") {
        missing.insert("jobs");
    }
    if project
        .programs
        .iter()
        .any(|p| p.read_time_granularity_ms.is_some())
        && !capabilities.has("clock")
    {
        missing.insert("clock");
    }
    if project
        .schema
        .tables
        .values()
        .any(|t| t.columns.values().any(asset))
        || project
            .programs
            .iter()
            .any(|program| program.args.values().any(arg_asset))
    {
        if !capabilities.has("media") {
            missing.insert("media");
        }
    }
    if !missing.is_empty() {
        return Err(Fault::new(
            "S3_CAPABILITY_UNAVAILABLE",
            format!(
                "the integrated owner did not declare runtime readiness for: {}",
                missing.into_iter().collect::<Vec<_>>().join(", ")
            ),
        ));
    }
    let generation = Generation::certify(&project, Ceilings::default()).map_err(|errors| {
        Fault::new(
            "S3_CERTIFICATION",
            errors
                .iter()
                .map(|(name, error)| format!("{name}: {error}"))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    })?;
    if !capabilities.has("connected")
        && generation.programs().values().any(|(_, certificate)| {
            certificate
                .read_sites
                .iter()
                .any(|site| site.table == snapback3_core::CONNECTED_TABLE)
        })
    {
        return Err(Fault::new(
            "S3_CAPABILITY_UNAVAILABLE",
            "connected[] requires the presence runtime; this slice supports persisted query resources",
        ));
    }
    Ok(generation)
}

/// Open the installed project before considering an explicitly supplied new
/// source. The stored value is compiler input, not a trusted certificate: each
/// child certifies it again and checks all three installed identities before it
/// can publish a runtime.
// @ref LLP 2000#integration-choices — restart authority is the project meaning committed with generation custody, not a later Node artifact write.
pub fn open_runtime(
    store: Store,
    candidate: Option<ProjectJson>,
    capabilities: &RuntimeCapabilities,
    accept_candidate: bool,
    adopt_legacy: bool,
) -> Result<Runtime, Fault> {
    let installed = store.meta("generation").map_err(Fault::runtime)?;
    let stored_project = store.meta("project_json").map_err(Fault::runtime)?;

    let Some(stored_project) = stored_project else {
        if adopt_legacy && !accept_candidate {
            return Err(Fault::input(
                "--adopt-legacy-project is valid only for an explicit initial project acceptance",
            ));
        }
        if installed.is_some() && !adopt_legacy {
            return Err(Fault::new(
                "S3_PROJECT_RECOVERY_REQUIRED",
                "this legacy store has no certified project recovery custody; verify that the current source is the intended installed project, then restart dev or serve with --adopt-legacy-project once",
            ));
        }
        if !accept_candidate {
            return Err(Fault::new(
                "S3_PROJECT_SOURCE_REQUIRED",
                "this store has no committed project recovery custody; start it through an explicit --accept-project source acceptance",
            ));
        }
        let candidate = candidate
            .ok_or_else(|| Fault::input("--accept-project requires --project <artifact.json>"))?;
        let candidate = certify(candidate, capabilities)?;
        return Runtime::open(store, candidate).map_err(|error| Fault::new("S3_SUCCESSOR", error));
    };

    let recovered_project: ProjectJson =
        serde_json::from_str(&stored_project).map_err(|error| {
            Fault::new(
                "S3_PROJECT_CUSTODY",
                format!("installed project recovery custody is invalid JSON: {error}"),
            )
        })?;
    let recovered = certify(recovered_project, capabilities)?;
    verify_installed_identity(&store, &recovered)?;
    let mut runtime =
        Runtime::open(store, recovered).map_err(|error| Fault::new("S3_PROJECT_CUSTODY", error))?;
    if accept_candidate {
        let candidate = candidate
            .ok_or_else(|| Fault::input("--accept-project requires --project <artifact.json>"))?;
        let candidate = certify(candidate, capabilities)?;
        if generation_identity(runtime.generation()) != generation_identity(&candidate) {
            runtime
                .apply_successor(candidate)
                .map_err(|error| Fault::new("S3_SUCCESSOR", error))?;
        }
    }
    Ok(runtime)
}

fn verify_installed_identity(store: &Store, generation: &Generation) -> Result<(), Fault> {
    let installed = [
        ("generation", generation.hash()),
        ("program_generation", generation.program_hash().to_owned()),
        ("effects_generation", generation.effects_hash()),
    ];
    for (key, expected) in installed {
        if store.meta(key).map_err(Fault::runtime)?.as_deref() != Some(expected.as_str()) {
            return Err(Fault::new(
                "S3_PROJECT_CUSTODY",
                format!("installed project recovery custody does not match {key}"),
            ));
        }
    }
    Ok(())
}

fn generation_identity(generation: &Generation) -> (String, String, String) {
    (
        generation.hash(),
        generation.program_hash().to_owned(),
        generation.effects_hash(),
    )
}

fn asset(column: &ColumnType) -> bool {
    match column {
        ColumnType::Image { .. } | ColumnType::Video { .. } => true,
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => asset(inner),
        _ => false,
    }
}

fn arg_asset(arg: &snapback3_core::ArgType) -> bool {
    match arg {
        snapback3_core::ArgType::Image { .. } | snapback3_core::ArgType::Video { .. } => true,
        snapback3_core::ArgType::Optional(inner) => arg_asset(inner),
        snapback3_core::ArgType::List {
            of: Some(inner), ..
        } => arg_asset(inner),
        _ => false,
    }
}

pub fn seed(runtime: &mut Runtime, seed: &Json) -> Result<(), Fault> {
    let seed = seed.get("seed").unwrap_or(seed);
    let personas = seed
        .get("personas")
        .and_then(Json::as_array)
        .ok_or_else(|| Fault::input("seed needs personas array"))?;
    let tables = seed
        .get("rows")
        .and_then(Json::as_object)
        .ok_or_else(|| Fault::input("seed needs rows object"))?;
    let row_count: usize = tables
        .values()
        .map(|value| value.as_array().map_or(0, Vec::len))
        .sum();
    if row_count > 150_000 || personas.len() > 10_000 {
        return Err(Fault::input(
            "an administrative seed may contain at most 150,000 rows and 10,000 personas",
        ));
    }
    for persona in personas {
        let name = persona
            .as_str()
            .ok_or_else(|| Fault::input("persona must be a string"))?;
        runtime
            .ensure_persona(name, now())
            .map_err(Fault::internal)?;
    }
    let mut rows = Vec::new();
    for (table, values) in tables {
        let schema = runtime
            .generation()
            .schema()
            .tables
            .get(table)
            .ok_or_else(|| Fault::input(format!("unknown seed table {table}")))?;
        for value in values
            .as_array()
            .ok_or_else(|| Fault::input("seed table must be an array"))?
        {
            let object = value
                .as_object()
                .ok_or_else(|| Fault::input("seed row must be an object"))?;
            let mut fields = BTreeMap::new();
            for (column, value) in object {
                let kind = schema
                    .columns
                    .get(column)
                    .ok_or_else(|| Fault::input(format!("unknown column {table}.{column}")))?;
                fields.insert(
                    column.clone(),
                    snapback3_core::wire::json_as_kind(value, kind).map_err(Fault::runtime)?,
                );
            }
            rows.push((table.clone(), Value::Row(fields.into())));
        }
    }
    // An explicit, private import budget. The same validator and single data
    // transaction apply; no application operation gets these larger ceilings.
    runtime
        .seed_with_ceilings(
            &rows,
            Ceilings {
                examined: 100_000_000,
                index_entries: 100_000_000,
                rule_probes: 10_000_000,
                steps: 100_000_000,
                heap_bytes: 4 * 1024 * 1024 * 1024,
                closure_bytes: 512 * 1024 * 1024,
                // Includes maintained and indexed write amplification, in
                // addition to the separately bounded 150,000 supplied rows.
                write_rows: 1_000_000,
                ..Ceilings::default()
            },
        )
        .map_err(Fault::runtime)?;
    Ok(())
}
