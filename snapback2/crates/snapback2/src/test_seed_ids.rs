//! Schema-directed seed-id selection for derived operation probes.
// @ref LLP 1002#7-test-and-the-receipt — probe ids come only from schema-directed seed rows.

use super::{Json, SeedData, json};

pub(super) fn seed_id_arg(
    op: &str,
    name: &str,
    table: Option<&str>,
    seed: &SeedData,
    sample: usize,
) -> Result<Json, String> {
    if name == "outboxId" {
        return Ok(json!("outbox-test"));
    }
    table
        .and_then(|table| seed_id(seed, table, sample).or_else(|| seed_id(seed, table, 0)))
        .ok_or_else(|| format!("cannot choose a seed id for {op}.{name}"))
}

pub(super) fn named_id_table<'a>(name: &str, seed: &'a SeedData) -> Option<&'a str> {
    let stem = name.strip_suffix("Id").filter(|stem| !stem.is_empty())?;
    let stem = stem.to_ascii_lowercase();
    let matches = seed
        .rows
        .keys()
        .filter(|table| {
            let table = table.to_ascii_lowercase();
            table == stem || plural(&stem) == table
        })
        .map(String::as_str)
        .collect::<Vec<_>>();
    if matches.len() == 1 {
        Some(matches[0])
    } else {
        None
    }
}

fn plural(value: &str) -> String {
    if let Some(stem) = value.strip_suffix('y')
        && !matches!(stem.chars().last(), Some('a' | 'e' | 'i' | 'o' | 'u'))
    {
        return format!("{stem}ies");
    }
    if matches!(value.chars().last(), Some('s' | 'x' | 'z'))
        || value.ends_with("ch")
        || value.ends_with("sh")
    {
        format!("{value}es")
    } else {
        format!("{value}s")
    }
}

fn seed_id(seed: &SeedData, table: &str, index: usize) -> Option<Json> {
    seed.rows.get(table)?.get(index)?.get("id").cloned()
}
