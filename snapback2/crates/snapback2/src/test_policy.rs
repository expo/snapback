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
    for (table_name, table) in &compiled.generation.schema().tables {
        if table.rules.read.is_public() {
            continue;
        }
        let rows = seed.rows.get(table_name).cloned().unwrap_or_default();
        if rows.is_empty() {
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
        let mut personas = seed.personas.clone();
        let unlisted = format!("__snapback2_unlisted_{table_name}");
        personas.push(unlisted.clone());
        let mut table_probes = 0_u64;
        for persona in &personas {
            let actual_response = client::control(
                owner,
                "POST",
                "/control/data",
                json!({
                    "table": table_name,
                    "index": "byId",
                    "prefix": [],
                    "limit": 500,
                    "as": persona,
                }),
            );
            let actual_body = match actual_response {
                Ok(response) if response.status < 400 => response.body,
                Ok(response) => {
                    failures.push(json!({
                        "table": table_name,
                        "as": persona,
                        "source": "data",
                        "response": response.body,
                    }));
                    continue;
                }
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
            let actual = actual_body
                .get("data")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
                .filter_map(|row| row.get("id").and_then(Json::as_str).map(ToOwned::to_owned))
                .collect::<BTreeSet<_>>();
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

pub(super) fn rule_id_sets_match(actual: &BTreeSet<String>, expected: &BTreeSet<String>) -> bool {
    actual == expected
}
