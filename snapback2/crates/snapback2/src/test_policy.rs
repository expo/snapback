//! Rule-derived checks for `snapback2 test`.
// @ref LLP 1002#7-test-and-the-receipt — policy is proved through the same
// receipt-producing test verb as the other derived checks.

use super::*;

pub(super) fn check_rules(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let mut probes = 0_u64;
    let mut tables = Map::new();
    let mut reserved = 0_usize;
    // Maintained groups cannot outnumber their seeded source rows. Use the
    // total seed as a conservative bound for chained maintained tables.
    let seed_rows = seed.rows.values().map(Vec::len).sum::<usize>();
    const PROBE_LIMIT: usize = 16_384;
    for (table_name, table) in &compiled.generation.schema().tables {
        if table.rules.read.is_public() {
            continue;
        }
        let rows = seed.rows.get(table_name).cloned().unwrap_or_default();
        if !rule_table_has_probe_rows(table_name, seed, &compiled.generation.schema().maintains) {
            blocked.push(json!({
                "table": table_name,
                "reason": format!("no seed rows for {table_name}"),
            }));
            tables.insert(
                table_name.clone(),
                json!({ "seedRows": 0, "personas": 0, "probes": 0 }),
            );
            continue;
        }
        let row_bound = if compiled
            .generation
            .schema()
            .maintains
            .iter()
            .any(|m| m.target == *table_name)
        {
            seed_rows
        } else {
            rows.len()
        };
        let needed = row_bound.saturating_mul(seed.personas.len().saturating_add(1));
        if reserved.saturating_add(needed) > PROBE_LIMIT {
            blocked.push(json!({ "table": table_name, "reason": "rule probe budget exhausted",
                "rowBound": row_bound, "personas": seed.personas.len() + 1,
                "requiredProbes": needed, "probeLimit": PROBE_LIMIT,
                "rewrite": "use a smaller representative seed; put larger data scenarios in journeys" }));
            continue;
        }
        reserved += needed;
        let mut personas = seed.personas.clone();
        let unlisted = format!("__snapback2_unlisted_{table_name}");
        personas.push(unlisted.clone());
        let mut table_probes = 0_u64;
        for persona in &personas {
            let actual = match visible_rule_ids(owner, table_name, persona, row_bound) {
                Ok(actual) => actual,
                Err(error) => {
                    failures.push(json!({
                        "table": table_name,
                        "as": persona,
                        "source": "data",
                        "error": error,
                    }));
                    continue;
                }
            };
            let expected_response = client::control(
                owner,
                "POST",
                "/control/verdicts",
                json!({ "table": table_name, "as": persona }),
            );
            let expected_body = match expected_response {
                Ok(response) if response.status < 400 => response.body,
                Ok(response) => {
                    failures.push(json!({
                        "table": table_name,
                        "as": persona,
                        "source": "engine",
                        "response": response.body,
                    }));
                    continue;
                }
                Err(error) => {
                    failures.push(json!({
                        "table": table_name,
                        "as": persona,
                        "source": "engine",
                        "error": error,
                    }));
                    continue;
                }
            };
            let verdicts = expected_body
                .get("rows")
                .and_then(Json::as_array)
                .cloned()
                .unwrap_or_default();
            let expected = verdicts
                .iter()
                .filter(|row| row.get("admitted").and_then(Json::as_bool) == Some(true))
                .filter_map(|row| row.get("id").and_then(Json::as_str).map(ToOwned::to_owned))
                .collect::<BTreeSet<_>>();
            table_probes += verdicts.len() as u64;
            probes += verdicts.len() as u64;
            if !rule_id_sets_match(&actual, &expected) {
                failures.push(json!({
                    "table": table_name,
                    "as": persona,
                    "expected": expected,
                    "actual": actual,
                }));
            }
        }
        tables.insert(
            table_name.clone(),
            json!({
                "seedRows": rows.len(),
                "personas": personas.len(),
                "probes": table_probes,
            }),
        );
    }
    let detail = json!({
        "probes": probes,
        "probeLimit": PROBE_LIMIT,
        "coverage": "every stored row and seed persona for each completed table; no row sampling",
        "tables": tables,
        "expectedBy": "engine",
        "actualBy": "data",
        "blocked": blocked,
    });
    if !failures.is_empty() {
        CheckReceipt::fail(
            "rules",
            "derived",
            elapsed_ms(started),
            json!({ "failures": failures, "summary": detail }),
        )
    } else if !blocked.is_empty() {
        CheckReceipt::blocked("rules", "derived", elapsed_ms(started), detail)
    } else {
        CheckReceipt::pass("rules", "derived", elapsed_ms(started), detail)
    }
}

pub(super) fn rule_table_has_probe_rows(
    table_name: &str,
    seed: &SeedData,
    maintains: &[snapback2_core::Maintain],
) -> bool {
    seed.rows
        .get(table_name)
        .is_some_and(|rows| !rows.is_empty())
        || maintains.iter().any(|maintain| {
            maintain.target == table_name
                && seed
                    .rows
                    .get(&maintain.source)
                    .is_some_and(|rows| !rows.is_empty())
        })
}

fn visible_rule_ids(
    owner: &OwnerInfo,
    table: &str,
    persona: &str,
    row_bound: usize,
) -> Result<BTreeSet<String>, Json> {
    let mut ids = BTreeSet::new();
    let mut after = None;
    for _ in 0..=row_bound {
        let response = client::control(
            owner,
            "POST",
            "/control/data",
            json!({
                "table": table,
                "index": "byId",
                "prefix": [],
                "after": after,
                "limit": 500,
                "as": persona,
            }),
        )
        .map_err(|error| json!({ "error": error }))?;
        if response.status >= 400 {
            return Err(json!({ "response": response.body }));
        }
        let page = response
            .body
            .get("data")
            .and_then(Json::as_array)
            .cloned()
            .unwrap_or_default();
        let next = response
            .body
            .get("next")
            .and_then(Json::as_str)
            .map(ToOwned::to_owned);
        ids.extend(
            page.iter()
                .filter_map(|row| row.get("id").and_then(Json::as_str).map(ToOwned::to_owned)),
        );
        // Non-uniform rules intentionally hide completeness: capped + no
        // cursor is terminal too. The exhaustive verdict set detects omissions.
        if response.body.get("state").and_then(Json::as_str) != Some("capped") || next.is_none() {
            return Ok(ids);
        }
        if next == after {
            return Err(
                json!({ "error": "capped rule page did not advance", "response": response.body }),
            );
        }
        after = next;
    }
    Err(json!({ "error": "rule paging exceeded the seeded row bound", "rowBound": row_bound }))
}

pub(super) fn rule_id_sets_match(actual: &BTreeSet<String>, expected: &BTreeSet<String>) -> bool {
    actual == expected
}
