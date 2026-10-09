//! Exact SQLite/Postgres outcome comparisons, with prefetch on and off.
//!
//! There are NO store-specific field exceptions: tagged values/order, complete,
//! unavailable, cuts/sites, cursors, all seven meters, tables, expiry, seq,
//! auxiliary envelopes, refusals (including sites), mutation state/current,
//! events/replayed/receipt_only and post-write observations compare exactly.
//! Each cursor is followed unchanged and each continuation record also compares
//! exactly. Physical database-call/prefetch statistics are diagnostic counters,
//! not public query outcomes, and are not compared as logical meter charges.
//!
//! Boundaries are the public enforceable boundaries of slice A: exceeded charge
//! counts, integer step allowances and final output charge. No claim is made
//! about internal charges hidden by the public API after an error. A mutation
//! has no cursor; its cuts compare the refusal and post-write observation.
//! Every discovered mutation position is compared twice on SQLite. Postgres
//! uses up to eight positions per dimension: the first, last and a SplitMix64
//! sample seeded by case seed and dimension. Reads keep the entire sweep.
//! `mutation_positions_total`, `mutation_positions_postgres` and
//! `mutation_positions_postgres_skipped` count positions (each Postgres
//! position runs with prefetch both on and off). Byte allowances with no
//! exposed next charge still sweep on SQLite; they are not claimed as hidden
//! engine charge events. Fresh schema mode is opt-in for equivalence tests.
// @ref LLP 3000.035#5.1 — store oracle, shrinking and isolated seeded cases.
use crate::{
    campaign::Report,
    execute::{self, Outcome},
    generate::{Case, generate},
    oracle::{self, Oracle, Verdict},
    shrink,
};
use snapback4_core::Ceilings;
use std::{collections::BTreeSet, path::Path, time::Instant};

// Only explicit adapter refusals are unsupported. SQL and binder errors are not.
pub(crate) fn setup_error(error: snapback4_core::RuntimeError) -> String {
    use snapback4_core::RuntimeError;
    match &error {
        RuntimeError::Structural { code, .. }
            if matches!(
                *code,
                "E_QUARRY_EPHEMERAL" | "E_VIEW_KEY" | "E_POSTGRES_MAINTAINED_COLUMN"
            ) =>
        {
            format!("postgres-unsupported:{code}")
        }
        RuntimeError::Schema(message)
            if message
                == "Postgres evaluation supports data queries/mutations and transactional emit records only; assets, native modules, jobs, actions, routes and schedules are not implemented" =>
        {
            "postgres-unsupported:assets-native-jobs-actions-routes-schedules".into()
        }
        _ => crate::store_database::error_chain("engine setup", &error),
    }
}

pub use crate::store_database::Database;

/// The store oracle's dimension for the prelude's outcomes (SQLite against
/// Postgres, each world's prelude run once after seeding).
pub const PRELUDE: &str = "prelude";

fn record(e: &mut impl execute::Executor, case: &Case) -> (Outcome, Vec<Outcome>) {
    let first = execute::execute(e, case, "run", &case.args);
    let mut trail = Vec::new();
    if case.program.mutation() {
        e.set_ceilings(Ceilings::unbounded());
        trail.push(execute::execute(e, case, "observe", &case.args));
    } else if first.next().is_some() {
        // Retain every raw continuation, including an erroneous one. Bounded
        // traversal prevents a bad cursor from wedging the scheduled campaign.
        e.set_ceilings(Ceilings::unbounded());
        let mut cursor = first.next().map(str::to_owned);
        let mut seen = BTreeSet::new();
        while let Some(c) = cursor {
            if !seen.insert(c.clone()) || trail.len() > case.rows.len() + 1 {
                trail.push(Outcome {
                    kind: "continuation-error".into(),
                    value: serde_json::json!({"error":"cursor-cycle"}),
                });
                break;
            }
            let mut args = case.args.clone();
            args["c"] = serde_json::json!(c);
            let next = execute::execute(e, case, "run", &args);
            cursor = next.next().map(str::to_owned);
            trail.push(next);
        }
    }
    (first, trail)
}
fn compare(
    oracle: &Oracle,
    left: &(Outcome, Vec<Outcome>),
    right: &(Outcome, Vec<Outcome>),
) -> Verdict {
    let disagree = |field: &str, a: Outcome, b: Outcome, continuation: Vec<Outcome>| {
        let mut v = oracle::disagreement(oracle, field, a, b, continuation);
        if let Verdict::Disagree(f) = &mut v {
            f.store_trace = Some(oracle::StoreTrace {
                left: std::iter::once(left.0.clone())
                    .chain(left.1.clone())
                    .collect(),
                right: std::iter::once(right.0.clone())
                    .chain(right.1.clone())
                    .collect(),
            });
        }
        v
    };
    let phase = match oracle {
        Oracle::Store {
            dimension: Some(d), ..
        }
        | Oracle::StoreSqliteRepeat {
            dimension: Some(d), ..
        } => d.as_str(),
        _ => "budget",
    };
    let mut trail = left.1.clone();
    trail.extend(right.1.clone());
    if let Some(f) = oracle::field(&left.0, &right.0, false) {
        return disagree(
            &format!("{phase}-{f}"),
            left.0.clone(),
            right.0.clone(),
            trail,
        );
    }
    for (a, b) in left.1.iter().zip(&right.1) {
        if let Some(f) = oracle::field(a, b, false) {
            return disagree(
                &format!("{phase}-continuation-{f}"),
                a.clone(),
                b.clone(),
                trail,
            );
        }
    }
    if left.1.len() != right.1.len() {
        return disagree(
            &format!("{phase}-continuation-length"),
            left.0.clone(),
            right.0.clone(),
            trail,
        );
    }
    Verdict::Pass
}
fn budget(oracle: &Oracle, case: &Case) -> Ceilings {
    match oracle {
        Oracle::Store {
            dimension: Some(d),
            ceiling,
            ..
        } => oracle::ceiling(d, *ceiling),
        _ => case.budget,
    }
}
pub fn reproduce(case: &Case, source: &str, oracle: &Oracle) -> Result<Verdict, String> {
    let mut db = Database::connect()?;
    let result = reproduce_in(&mut db, case, source, oracle);
    db.close()?;
    result
}
fn reproduce_in(
    db: &mut Database,
    case: &Case,
    source: &str,
    oracle: &Oracle,
) -> Result<Verdict, String> {
    if let Oracle::StoreSqliteRepeat { dimension, ceiling } = oracle {
        let mut sqlite = execute::engine(case, source)?;
        let snapshot = crate::store_database::SqliteSnapshot::capture(&sqlite)?;
        let ceilings = dimension
            .as_ref()
            .map_or(case.budget, |d| oracle::ceiling(d, *ceiling));
        sqlite.set_ceilings(ceilings);
        let left = record(&mut sqlite, case);
        snapshot.restore(&sqlite)?;
        sqlite.set_ceilings(ceilings);
        let right = record(&mut sqlite, case);
        return Ok(compare(oracle, &left, &right));
    }
    let Oracle::Store { prefetch, dimension, .. } = oracle else {
        return Err("not a store oracle".into());
    };
    if dimension.as_deref() == Some(PRELUDE) {
        let (_, left) = execute::world(case, source)?;
        let world = match db.create(case, source) {
            Ok(w) => w,
            Err(e) if e.starts_with("postgres-unsupported:") => return Ok(Verdict::Unsupported(e)),
            Err(e) => return Err(e),
        };
        let verdict = oracle::prelude_disagreement(oracle, &left, &world.prelude, false).unwrap_or(Verdict::Pass);
        db.remove(world)?;
        return Ok(verdict);
    }
    let mut world = match db.create(case, source) {
        Ok(w) => w,
        Err(e) if e.starts_with("postgres-unsupported:") => return Ok(Verdict::Unsupported(e)),
        Err(e) => return Err(e),
    };
    let result = (|| {
        let mut sqlite = execute::engine(case, source)?;
        sqlite.set_ceilings(budget(oracle, case));
        world.engine.set_ceilings(budget(oracle, case));
        world.engine.set_prefetch(*prefetch);
        world.clear_errors();
        let left = record(&mut sqlite, case);
        let right = record(&mut world.engine, case);
        world.check_errors(&right)?;
        Ok(compare(oracle, &left, &right))
    })();
    db.remove(world)?;
    result
}

/// Read probes share the seeded world. Write probes restore the seed snapshot.
/// The factory owns one physical schema per worker, never one per ceiling.
pub fn check(
    case: &Case,
    report: &mut Report,
    db: &mut Database,
    mut found: impl FnMut(crate::oracle::Finding),
) -> Result<(), String> {
    report.generated += 1;
    for feature in crate::coverage::features(case) {
        *report.coverage.entry(feature).or_default() += 1;
    }
    let source = case.program.source();
    execute::compile(&source).map_err(|e| format!("binder: {e}"))?;
    report.compiled += 1;
    let (mut sqlite, sqlite_prelude) = execute::world(case, &source)?;
    let snapshot = crate::store_database::SqliteSnapshot::capture(&sqlite)?;
    let mut world = match db.create(case, &source) {
        Ok(w) => w,
        Err(e) if e.starts_with("postgres-unsupported:") => {
            for prefetch in [true, false] {
                let oracle = Oracle::Store {
                    prefetch,
                    dimension: None,
                    ceiling: 0,
                };
                report
                    .by_oracle
                    .entry(oracle.name())
                    .or_default()
                    .record(&Verdict::Unsupported(e.clone()));
            }
            return Ok(());
        }
        Err(e) => return Err(e),
    };
    if !case.steps.is_empty() || case.sweep {
        let oracle = Oracle::Store {
            prefetch: true,
            dimension: Some(PRELUDE.into()),
            ceiling: 0,
        };
        let verdict = oracle::prelude_disagreement(&oracle, &sqlite_prelude, &world.prelude, false).unwrap_or(Verdict::Pass);
        report.executed += 2 * sqlite_prelude.len() as u64;
        report.by_oracle.entry("store-postgres-prelude".into()).or_default().record(&verdict);
        if let Verdict::Disagree(f) = verdict {
            found(f);
        }
    }
    let result = (|| {
        let write = case.program.mutation();
        let mut probes = vec![(None, 0)];
        // Sweep from the uncut public ledger; each probe includes its complete
        // continuation. Probe selection follows SQLite, never the candidate store.
        let baseline = execute::execute(&mut sqlite, case, "run", &case.args);
        report.executed += 1;
        if let Some(code) = baseline.refusal().and_then(|v| v["code"].as_str()) {
            *report.runtime_refusals.entry(code.into()).or_default() += 1;
            if !matches!(
                code,
                "E_OVERFLOW"
                    | "NOT_FOUND"
                    | "NULL_ASSERT"
                    | "E_RULE"
                    | "E_CONSTRAINT"
                    | "E_ID_REUSED"
                    | "E_BOUND"
                    | "REQUIRED"
            ) {
                *report
                    .runtime_refused_unexpected
                    .entry(code.into())
                    .or_default() += 1;
            }
        }
        if write {
            snapshot.restore(&sqlite)?;
        }
        sqlite.set_ceilings(Ceilings::unbounded());
        let uncut = execute::execute(&mut sqlite, case, "run", &case.args);
        report.executed += 1;
        for dimension in oracle::DIMENSIONS {
            let total = uncut.meter(dimension).unwrap_or(0);
            if total == 0 {
                continue;
            }
            let mut n = 0;
            loop {
                if n == 1000 || n == 10000 || n == 100000 {
                    eprintln!(
                        "boundary progress seed={} dimension={dimension} n={n} total={total}",
                        case.seed
                    );
                }
                probes.push((Some(dimension.to_string()), n));
                if write {
                    snapshot.restore(&sqlite)?;
                }
                sqlite.set_ceilings(oracle::ceiling(dimension, n));
                let cut = execute::execute(&mut sqlite, case, "run", &case.args);
                report.executed += 1;
                if !cut.cut() {
                    break;
                }
                let next = if dimension == "output_bytes" {
                    total
                } else {
                    cut.meter(dimension).filter(|v| *v > n).unwrap_or(n + 1)
                };
                if next <= n || next > case.budget.heap_bytes.max(total + 1) {
                    return Err(format!("{dimension}-boundary-search-limit"));
                }
                n = next;
            }
        }
        let mut selected = BTreeSet::from([0]);
        if write {
            // Independently seeded per dimension; selection is independent of
            // Postgres outcomes and includes both end positions.
            for dimension in oracle::DIMENSIONS {
                let positions: Vec<_> = probes
                    .iter()
                    .enumerate()
                    .filter(|(_, (d, _))| d.as_deref() == Some(dimension))
                    .map(|(i, _)| i)
                    .collect();
                let mut rng = crate::generate::Rng::new(
                    case.seed
                        ^ dimension
                            .bytes()
                            .fold(0u64, |a, b| a.wrapping_mul(131) ^ b as u64),
                );
                if let (Some(first), Some(last)) = (positions.first(), positions.last()) {
                    selected.insert(*first);
                    selected.insert(*last);
                    while selected.iter().filter(|i| positions.contains(i)).count()
                        < positions.len().min(8)
                    {
                        selected.insert(positions[rng.next() as usize % positions.len()]);
                    }
                }
            }
            *report
                .store_stats
                .entry("mutation_positions_total".into())
                .or_default() += probes.len() as u64;
            *report
                .store_stats
                .entry("mutation_positions_postgres".into())
                .or_default() += selected.len() as u64;
            *report
                .store_stats
                .entry("mutation_positions_postgres_skipped".into())
                .or_default() += (probes.len() - selected.len()) as u64;
        }
        let mut first_world = true;
        let mut transferred_case = false;
        for (position, (dimension, ceiling)) in probes.into_iter().enumerate() {
            if write {
                snapshot.restore(&sqlite)?;
            }
            let settings = Oracle::Store {
                prefetch: true,
                dimension: dimension.clone(),
                ceiling,
            };
            sqlite.set_ceilings(budget(&settings, case));
            let left = record(&mut sqlite, case);
            report.executed += 1 + left.1.len() as u64;
            if write {
                snapshot.restore(&sqlite)?;
                sqlite.set_ceilings(budget(&settings, case));
                let again = record(&mut sqlite, case);
                report.executed += 1 + again.1.len() as u64;
                let repeat = Oracle::StoreSqliteRepeat {
                    dimension: dimension.clone(),
                    ceiling,
                };
                let verdict = compare(&repeat, &left, &again);
                report
                    .by_oracle
                    .entry("store-sqlite-mutation-repeat".into())
                    .or_default()
                    .record(&verdict);
                if let Verdict::Disagree(f) = verdict {
                    found(f);
                }
                if !selected.contains(&position) {
                    continue;
                }
            }
            // Database calls per mode: fewer with prefetch on means cached
            // answers were consumed (the cache never authorizes or meters,
            // so this physical witness is the only one the API exposes).
            let mut calls = [0u64; 2];
            for prefetch in [true, false] {
                let oracle = Oracle::Store {
                    prefetch,
                    dimension: dimension.clone(),
                    ceiling,
                };
                // The first world is untouched until its first call.
                if write && !first_world {
                    db.restore(&mut world, case, &source)?;
                }
                first_world = false;
                world.engine.set_prefetch(prefetch);
                world.engine.set_ceilings(budget(&oracle, case));
                let before = world.engine.stats();
                world.clear_errors();
                let right = record(&mut world.engine, case);
                world.check_errors(&right)?;
                let after = world.engine.stats();
                for (name, delta) in [
                    (
                        "database_calls",
                        after.database_calls - before.database_calls,
                    ),
                    (
                        "prefetch_marked_reads",
                        after.prefetch_marked_reads - before.prefetch_marked_reads,
                    ),
                    (
                        "prefetch_rows_transferred",
                        after.prefetch_rows_transferred - before.prefetch_rows_transferred,
                    ),
                    (
                        "prefetch_bytes_transferred",
                        after.prefetch_bytes_transferred - before.prefetch_bytes_transferred,
                    ),
                ] {
                    *report
                        .store_stats
                        .entry(format!("{}-{name}", oracle.name()))
                        .or_default() += delta;
                }
                calls[usize::from(prefetch)] = after.database_calls - before.database_calls;
                if prefetch && after.prefetch_rows_transferred > before.prefetch_rows_transferred {
                    transferred_case = true;
                }
                report.executed += 1 + right.1.len() as u64;
                let verdict = compare(&oracle, &left, &right);
                report
                    .by_oracle
                    .entry(oracle.name())
                    .or_default()
                    .record(&verdict);
                if let Some(d) = &dimension {
                    report
                        .meter_dimensions
                        .entry(format!("{}-{d}", oracle.name()))
                        .or_default()
                        .record(&verdict);
                }
                if let Verdict::Disagree(f) = verdict {
                    found(f);
                }
            }
            if calls[1] < calls[0] {
                *report.store_stats.entry("prefetch_consumption_witness_probes".into()).or_default() += 1;
                *report.store_stats.entry("prefetch_database_calls_saved".into()).or_default() += calls[0] - calls[1];
            }
        }
        if transferred_case {
            *report.store_stats.entry("prefetch_cases_with_transfer".into()).or_default() += 1;
        }
        Ok(())
    })();
    db.remove(world)?;
    result
}

pub fn run(seed: u64, cases: u64, out: &Path) -> Result<Report, String> {
    run_bounded(seed, cases, out, None)
}
pub fn run_bounded(
    seed: u64,
    cases: u64,
    out: &Path,
    seconds: Option<f64>,
) -> Result<Report, String> {
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let started = Instant::now();
    let mut report = Report {
        seed,
        cases,
        ..Report::default()
    };
    let mut db = match Database::connect() {
        Ok(db) => db,
        Err(error) => {
            *report.generator_errors.entry(error.clone()).or_default() += 1;
            report.seconds = started.elapsed().as_secs_f64();
            std::fs::write(
                out.join("report.json"),
                serde_json::to_vec_pretty(&report).unwrap(),
            )
            .map_err(|e| e.to_string())?;
            return Err(error);
        }
    };
    let mut saved = BTreeSet::new();
    let mut failure = None;
    for i in 0..cases {
        if seconds.is_some_and(|limit| started.elapsed().as_secs_f64() >= limit) {
            report.time_limited_workers = 1;
            break;
        }
        let case_started = Instant::now();
        let case = generate(seed.wrapping_add(i));
        let mut findings = Vec::new();
        let checked = check(&case, &mut report, &mut db, |f| {
            if saved.insert(f.signature.clone()) {
                findings.push(f);
            }
        });
        if let Err(error) = checked {
            let path = out.join(format!("setup-{}", case.seed));
            std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            std::fs::write(path.join("case.q"), case.program.source())
                .map_err(|e| e.to_string())?;
            std::fs::write(
                path.join("case.json"),
                serde_json::to_vec_pretty(&case).unwrap(),
            )
            .map_err(|e| e.to_string())?;
            *report.generator_errors.entry(error.clone()).or_default() += 1;
            failure = Some(error);
            break;
        }
        for f in findings {
            let a = shrink::shrink_with(case.clone(), f, |c, s, o| reproduce_in(&mut db, c, s, o));
            shrink::save(&out.join(&a.finding.signature), &a)?;
        }
        let elapsed = case_started.elapsed().as_secs_f64();
        if elapsed > report.slowest_case_seconds {
            report.slowest_case_seconds = elapsed;
            report.slowest_case_seed = Some(case.seed);
        }
        if elapsed > 2.0 {
            eprintln!("slow case {}: {:.3}s", case.seed, elapsed);
        }
        if (i + 1) % 10 == 0 {
            eprintln!("{} cases in {:.1}s", i + 1, started.elapsed().as_secs_f64());
        }
    }
    db.close()?;
    report.seconds = started.elapsed().as_secs_f64();
    std::fs::write(
        out.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    if let Some(error) = failure {
        return Err(error);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::Body;
    use serde_json::json;

    #[test]
    fn restored_world_matches_fresh_bytes() {
        let mut reuse = Database::connect().unwrap();
        let mut fresh = Database::connect_fresh().unwrap();
        // Widened seeds: a mutation after a prelude (restored to the
        // post-prelude snapshot), and an expiring table after a sweep.
        let widened = [
            (0..).find(|s| { let c = generate(*s); !c.steps.is_empty() && c.program.mutation() }).unwrap(),
            (0..).find(|s| { let c = generate(*s); c.sweep && c.program.mutation() }).unwrap(),
        ];
        for seed in [0, 3, 19, 23, 24, 26].into_iter().chain(widened) {
            let case = generate(seed);
            let source = case.program.source();
            let mut a = reuse.create(&case, &source).unwrap();
            let mut b = fresh.create(&case, &source).unwrap();
            for prefetch in [true, false] {
                for ceilings in [
                    case.budget,
                    oracle::ceiling("heap_bytes", 6669),
                    oracle::ceiling("steps", 0),
                ] {
                    if case.program.mutation() {
                        reuse.restore(&mut a, &case, &source).unwrap();
                        fresh.restore(&mut b, &case, &source).unwrap();
                    }
                    a.engine.set_prefetch(prefetch);
                    b.engine.set_prefetch(prefetch);
                    a.engine.set_ceilings(ceilings);
                    b.engine.set_ceilings(ceilings);
                    let left = record(&mut a.engine, &case);
                    let right = record(&mut b.engine, &case);
                    assert_eq!(
                        serde_json::to_vec(&left).unwrap(),
                        serde_json::to_vec(&right).unwrap(),
                        "seed {seed}"
                    );
                }
            }
            reuse.remove(a).unwrap();
            fresh.remove(b).unwrap();
        }
        reuse.close().unwrap();
        fresh.close().unwrap();
    }

    #[test]
    fn sqlite_restore_matches_fresh_and_restores_a_committed_write() {
        let mut case = generate(0);
        case.program.body = Body::Write(crate::ast::Write::Insert, crate::ast::Expr::Int(1));
        case.program.tables[0].rule = crate::ast::Rule::Allow;
        case.args["key"] = json!("fresh-id");
        let source = case.program.source();
        let mut reuse = execute::engine(&case, &source).unwrap();
        let snapshot = crate::store_database::SqliteSnapshot::capture(&reuse).unwrap();
        for ceilings in [case.budget, oracle::ceiling("rows_written", 0), case.budget] {
            snapshot.restore(&reuse).unwrap();
            reuse.set_ceilings(ceilings);
            let mut fresh = execute::engine(&case, &source).unwrap();
            fresh.set_ceilings(ceilings);
            assert_eq!(record(&mut reuse, &case), record(&mut fresh, &case));
        }
    }

    #[test]
    fn store_comparison_preserves_each_field_and_each_continuation() {
        let first = Outcome {
            kind: "query".into(),
            value: json!({
                "data":{"Int":1}, "complete":false, "unavailable":false,
                "cut":"capped", "capped_at":["examined","run:1"],
                "word_cut_at":null, "next":"opaque", "metered":{
                    "examined":1,"index_entries":2,"rule_probes":3,"steps":4,
                    "heap_bytes":5,"output_bytes":6,"rows_written":7},
                "tables":["items"],"next_expiry":100,"seq":1,"delivery":null,
                "refusal":{"code":"E_BOUND","site":"run:1"}
            }),
        };
        let oracle = Oracle::Store {
            prefetch: true,
            dimension: Some("examined".into()),
            ceiling: 0,
        };
        let pair = (first.clone(), vec![first.clone()]);
        assert!(matches!(compare(&oracle, &pair, &pair), Verdict::Pass));
        for key in first.value.as_object().unwrap().keys() {
            let mut changed = pair.clone();
            changed.0.value[key] = json!("different");
            assert!(
                matches!(compare(&oracle, &pair, &changed), Verdict::Disagree(_)),
                "{key}"
            );
            let mut changed = pair.clone();
            changed.1[0].value[key] = json!("different");
            let Verdict::Disagree(f) = compare(&oracle, &pair, &changed) else {
                panic!("continuation {key}")
            };
            assert_eq!(f.store_trace.unwrap().right[1], changed.1[0]);
        }
        for dimension in oracle::DIMENSIONS {
            let mut changed = pair.clone();
            changed.0.value["metered"][dimension] = json!(1234);
            assert!(
                matches!(compare(&oracle, &pair, &changed), Verdict::Disagree(_)),
                "{dimension}"
            );
        }
        assert!(matches!(
            compare(&oracle, &pair, &(first, vec![])),
            Verdict::Disagree(_)
        ));
    }

    #[test]
    fn unsupported_is_limited_to_explicit_adapter_reasons() {
        use snapback4_core::RuntimeError;
        assert_eq!(
            setup_error(RuntimeError::Structural {
                code: "E_QUARRY_EPHEMERAL",
                message: "not supported".into()
            }),
            "postgres-unsupported:E_QUARRY_EPHEMERAL"
        );
        assert!(
            !setup_error(RuntimeError::Store("connection lost".into()))
                .starts_with("postgres-unsupported:")
        );
        assert!(
            !setup_error(RuntimeError::Schema("invalid generated schema".into()))
                .starts_with("postgres-unsupported:")
        );
    }
}
