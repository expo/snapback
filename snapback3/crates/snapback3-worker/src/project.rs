use crate::protocol::{Fault, now};
use serde_json::Value as Json;
use snapback3_core::{Ceilings, ColumnType, Generation, ProgramKind, ProjectJson, Runtime, Value};
use std::collections::BTreeMap;

pub fn certify(project: ProjectJson) -> Result<Generation, Fault> {
    if !project.effects.is_empty()
        || !project.schema.effects.is_empty()
        || !project.schema.channels.is_empty()
        || !project.schema.schedules.is_empty()
        || project
            .programs
            .iter()
            .any(|p| p.kind == ProgramKind::Job || p.read_time_granularity_ms.is_some())
        || project
            .schema
            .tables
            .values()
            .any(|t| t.columns.values().any(asset))
    {
        return Err(Fault::new(
            "S3_CAPABILITY_UNAVAILABLE",
            "this slice supports Quarry queries and mutations; effects, jobs, channels, schedules, clock-sensitive live queries and media need their runtime slice",
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
    if generation.programs().values().any(|(_, certificate)| {
        certificate
            .read_sites
            .iter()
            .any(|site| site.table == snapback3_core::CONNECTED_TABLE)
    }) {
        return Err(Fault::new(
            "S3_CAPABILITY_UNAVAILABLE",
            "connected[] requires the presence runtime; this slice supports persisted query resources",
        ));
    }
    Ok(generation)
}

fn asset(column: &ColumnType) -> bool {
    match column {
        ColumnType::Image { .. } | ColumnType::Video { .. } => true,
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => asset(inner),
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
