//! Campaign accounting counts exclusions independently from successful oracles.
use crate::{
    ast::{Body, Read},
    execute,
    generate::{Case, generate},
    oracle::{self, Counts, Finding, Rewrite, Verdict},
    shrink,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback4_core::Ceilings;
use std::{collections::BTreeMap, path::Path, time::Instant};
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    pub generated: u64,
    pub compiled: u64,
    pub binder_refused_expected: u64,
    pub binder_refused_unexpected: u64,
    pub executed: u64,
    pub generator_errors: BTreeMap<String, u64>,
    pub by_oracle: BTreeMap<String, Counts>,
    pub coverage: BTreeMap<String, u64>,
    pub rewrite_coverage: BTreeMap<String, u64>,
    pub meter_dimensions: BTreeMap<String, Counts>,
    pub pageable_reads: u64,
    pub pages_with_resumable_cut: u64,
    pub runtime_refusals: BTreeMap<String, u64>,
    pub runtime_refused_unexpected: BTreeMap<String, u64>,
    #[serde(default)]
    pub store_stats: BTreeMap<String, u64>,
    #[serde(default)]
    pub slowest_case_seconds: f64,
    #[serde(default)]
    pub slowest_case_seed: Option<u64>,
    #[serde(default)]
    pub time_limited_workers: u64,
    pub seconds: f64,
    pub seed: u64,
    pub cases: u64,
}
impl Report {
    pub fn failed(&self) -> bool {
        self.binder_refused_unexpected > 0
            || !self.runtime_refused_unexpected.is_empty()
            || !self.generator_errors.is_empty()
            || self.by_oracle.values().any(|c| c.disagreeing > 0)
    }
    fn record(&mut self, name: &str, v: &Verdict) {
        self.by_oracle.entry(name.into()).or_default().record(v);
    }
}
pub fn check(case: &Case, report: &mut Report, mut found: impl FnMut(Finding)) {
    report.generated += 1;
    for feature in crate::coverage::features(case) {
        *report.coverage.entry(feature).or_default() += 1;
    }
    let source = case.program.source();
    if let Err(e) = execute::compile(&source) {
        report.binder_refused_unexpected += 1;
        *report
            .generator_errors
            .entry(format!("binder: {e}"))
            .or_default() += 1;
        return;
    }
    report.compiled += 1;
    let (mut engine, prelude) = match execute::world(case, &source) {
        Ok(e) => e,
        Err(e) => {
            *report.generator_errors.entry(e).or_default() += 1;
            return;
        }
    };
    // Execute the stored budget, so a replay's budget is an actual input.
    let budgeted = execute::execute(&mut engine, case, "run", &case.args);
    report.executed += 1;
    if let Some(code) = budgeted.refusal().and_then(|r| r["code"].as_str()) {
        *report.runtime_refusals.entry(code.into()).or_default() += 1;
        // A bounded `score` or `a` (LLP 3000.040 §5) refuses out-of-range values by design.
        let bounded = case.program.arg_bound.is_some()
            || case.program.tables.iter().any(|t| t.columns.iter().any(|c| matches!(c.ty, crate::ast::Type::IntRange(..))));
        if !matches!(
            code,
            "E_OVERFLOW" | "NOT_FOUND" | "NULL_ASSERT" | "E_RULE" | "E_CONSTRAINT" | "E_ID_REUSED" | "REQUIRED"
        ) && !(bounded && code == "E_INPUT") {
            *report
                .runtime_refused_unexpected
                .entry(code.into())
                .or_default() += 1;
        }
    }
    match oracle::repeat(case, &source) {
        Ok((v, n)) => {
            report.executed += n;
            report.record("repeat", &v);
            if let Verdict::Disagree(f) = v {
                found(f);
            }
        }
        Err(e) => {
            *report.generator_errors.entry(e).or_default() += 1;
        }
    }
    for r in [
        Rewrite::Commute,
        Rewrite::Identity,
        Rewrite::LazyOr,
        Rewrite::LazyAnd,
        Rewrite::Let,
        Rewrite::Declarations,
    ] {
        if let Some(p) = r.apply(&case.program) {
            let mut c = case.clone();
            c.program = p;
            for feature in crate::coverage::features(&c) {
                *report.rewrite_coverage.entry(feature).or_default() += 1;
            }
        }
        let (verdict, n) = match oracle::rewrite_against(case, &r, &mut engine, &prelude, &budgeted) {
            Ok(v) => v,
            Err(e) => {
                if e.starts_with("binder:") {
                    report.binder_refused_unexpected += 1;
                }
                *report.generator_errors.entry(e).or_default() += 1;
                continue;
            }
        };
        report.executed += n;
        report.record(&format!("rewrite-{}", r.name()), &verdict);
        if r.costs(&case.program) && !matches!(verdict, Verdict::Unsupported(_)) {
            report
                .by_oracle
                .get_mut(&format!("rewrite-{}", r.name()))
                .unwrap()
                .meter_fields_omitted += 1;
        }
        if let Verdict::Disagree(f) = verdict {
            found(f);
        }
    }
    if case.program.mutation() {
        report.record("meter", &Verdict::Unsupported("mutation-not-a-read".into()));
        return;
    }
    engine.set_ceilings(Ceilings::unbounded());
    let baseline = execute::execute(&mut engine, case, "run", &case.args);
    report.executed += 1;
    if baseline.refusal().is_some() {
        report.record("meter", &Verdict::Unsupported("uncut-refusal".into()));
        return;
    }
    let pageable = matches!(
        case.program.body,
        Body::Read {
            kind: Read::Page,
            ..
        }
    );
    if pageable {
        report.pageable_reads += 1;
    }
    let mut resumed = false;
    for dimension in oracle::DIMENSIONS {
        let total = baseline.meter(dimension).unwrap_or(0);
        if total == 0 {
            continue;
        }
        // An exceeded public counter identifies the next enforceable boundary.
        // Jump over allowances that reject the very same atomic charge. Steps
        // refuse without a ledger, so sweep them; output is one final charge.
        let mut n = 0;
        loop {
            let (v, count, cut) = crate::meter::check(case, &mut engine, &baseline, dimension, n);
            report.executed += count;
            if matches!(v, Verdict::Pass) && cut.cut() && cut.next().is_some() {
                resumed = true;
            }
            report.record("meter", &v);
            report
                .meter_dimensions
                .entry(dimension.into())
                .or_default()
                .record(&v);
            if let Verdict::Disagree(f) = v {
                found(f);
            }
            if !cut.cut() {
                break;
            }
            let next = if dimension == "output_bytes" {
                total
            } else {
                cut.meter(dimension)
                    .filter(|used| *used > n)
                    .unwrap_or(n + 1)
            };
            if next <= n || next > case.budget.heap_bytes.max(total + 1) {
                report.record(
                    "meter",
                    &Verdict::Unsupported(format!("{dimension}-boundary-search-limit")),
                );
                break;
            }
            n = next;
        }
    }
    if resumed {
        report.pages_with_resumable_cut += 1;
    }
}
pub fn run(seed: u64, cases: u64, out: &Path) -> Result<Report, String> {
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let started = Instant::now();
    let mut report = Report {
        seed,
        cases,
        ..Report::default()
    };
    let mut saved = BTreeMap::new();
    for i in 0..cases {
        let case = generate(seed.wrapping_add(i));
        check(&case, &mut report, |finding| {
            if saved.contains_key(&finding.signature) {
                return;
            }
            let artifact = shrink::shrink(case.clone(), finding);
            let path = out.join(&artifact.finding.signature);
            saved.insert(
                artifact.finding.signature.clone(),
                shrink::save(&path, &artifact),
            );
        });
        if !report.generator_errors.is_empty() {
            let path = out.join(format!("generator-{}", case.seed));
            std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            std::fs::write(path.join("case.q"), case.program.source())
                .map_err(|e| e.to_string())?;
            std::fs::write(
                path.join("case.json"),
                serde_json::to_vec_pretty(&case).unwrap(),
            )
            .map_err(|e| e.to_string())?;
            break;
        }
        if (i + 1) % 1000 == 0 {
            eprintln!("{} cases in {:.1}s", i + 1, started.elapsed().as_secs_f64());
        }
    }
    for result in saved.values() {
        result.clone()?;
    }
    report.seconds = started.elapsed().as_secs_f64();
    std::fs::write(
        out.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(report)
}
pub fn summary(report: &Report) -> Json {
    json!(report)
}

/// Independent seed intervals; workers share no engines or random state.
/// Merge integer counters only. `seconds` is the whole campaign's wall time.
pub fn parallel(
    seed: u64,
    cases: u64,
    workers: usize,
    out: &Path,
    executable: &Path,
) -> Result<Report, String> {
    parallel_mode(seed, cases, workers, out, executable, false)
}
pub fn parallel_mode(
    seed: u64,
    cases: u64,
    workers: usize,
    out: &Path,
    executable: &Path,
    stores: bool,
) -> Result<Report, String> {
    parallel_mode_bounded(seed, cases, workers, out, executable, stores, None)
}
pub fn parallel_mode_bounded(
    seed: u64,
    cases: u64,
    workers: usize,
    out: &Path,
    executable: &Path,
    stores: bool,
    seconds: Option<f64>,
) -> Result<Report, String> {
    parallel_command(seed, cases, workers, out, executable, if stores { "run-stores" } else { "run" }, seconds)
}

/// `verb` is `run`, `run-stores`, `run-devices` or `run-lean`; each worker runs it.
pub fn parallel_command(
    seed: u64,
    cases: u64,
    workers: usize,
    out: &Path,
    executable: &Path,
    verb: &str,
    seconds: Option<f64>,
) -> Result<Report, String> {
    if seconds.is_some() && verb == "run" {
        return Err("--seconds applies only to run-stores and run-devices".into());
    }
    if workers == 1 {
        match verb {
            "run-stores" => {
                #[cfg(feature = "postgres")]
                {
                    return crate::stores::run_bounded(seed, cases, out, seconds);
                }
                #[cfg(not(feature = "postgres"))]
                {
                    return Err("run-stores requires --features postgres".into());
                }
            }
            "run-devices" => return crate::devices::run_bounded(seed, cases, out, seconds),
            "run-lean" => return crate::lean::run_bounded(seed, cases, out, seconds),
            _ => return run(seed, cases, out),
        }
    }
    if workers == 0 || workers > 64 {
        return Err("--workers must be in 1..=64".into());
    }
    let started = Instant::now();
    let workers = workers.min(cases.max(1) as usize);
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    // Each process has its own SQLite allocator/mutex state. Threads showed
    // severe contention during the pilot even with independent memory stores.
    struct Worker {
        child: Option<std::process::Child>,
        path: std::path::PathBuf,
    }
    impl Drop for Worker {
        fn drop(&mut self) {
            if let Some(child) = &mut self.child {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    let mut jobs = Vec::new();
    let mut offset = 0;
    for i in 0..workers {
        let n = cases / workers as u64 + u64::from((i as u64) < cases % workers as u64);
        let path = out.join(format!("worker-{i}"));
        let start = seed.wrapping_add(offset);
        offset += n;
        let log = std::fs::File::create(out.join(format!("worker-{i}.log")))
            .map_err(|e| e.to_string())?;
        let mut command = std::process::Command::new(executable);
        command
            .args([
                verb,
                "--seed",
                &start.to_string(),
                "--cases",
                &n.to_string(),
                "--out",
            ])
            .arg(&path);
        if let Some(seconds) = seconds {
            command.args(["--seconds", &seconds.to_string()]);
        }
        let child = command
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log)
            .spawn()
            .map_err(|e| e.to_string())?;
        jobs.push(Worker {
            child: Some(child),
            path,
        });
    }
    fn add(a: &mut Json, b: Json) {
        match (a, b) {
            (Json::Object(a), Json::Object(b)) => {
                for (k, v) in b {
                    add(a.entry(k).or_insert(json!(0)), v);
                }
            }
            (a, Json::Object(b)) => {
                *a = Json::Object(b);
            }
            (a, Json::Number(b)) => {
                *a = json!(a.as_u64().unwrap_or(0) + b.as_u64().unwrap_or(0));
            }
            _ => {}
        }
    }
    let mut combined = json!({});
    let mut slowest = (0.0, None);
    let mut artifacts: BTreeMap<String, shrink::Artifact> = BTreeMap::new();
    for mut job in jobs {
        let status = job
            .child
            .as_mut()
            .unwrap()
            .wait()
            .map_err(|e| e.to_string())?;
        job.child.take();
        if !matches!(status.code(), Some(0 | 1)) {
            let detail = std::fs::read_to_string(job.path.join("report.json")).unwrap_or_default();
            return Err(format!(
                "campaign worker failed: {status}; path={}; report={detail}",
                job.path.display()
            ));
        }
        let path = &job.path;
        let report: Report = serde_json::from_slice(
            &std::fs::read(path.join("report.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if status.success() == report.failed() {
            return Err("worker exit status disagrees with its report".into());
        }
        if report.slowest_case_seconds > slowest.0 {
            slowest = (report.slowest_case_seconds, report.slowest_case_seed);
        }
        let mut value = serde_json::to_value(&report).unwrap();
        for key in [
            "seed",
            "cases",
            "seconds",
            "slowest_case_seconds",
            "slowest_case_seed",
        ] {
            value.as_object_mut().unwrap().remove(key);
        }
        add(&mut combined, value);
        for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
            let p = entry.map_err(|e| e.to_string())?.path().join("case.json");
            if !p.is_file() {
                continue;
            }
            let Ok(a) = serde_json::from_slice::<shrink::Artifact>(
                &std::fs::read(p).map_err(|e| e.to_string())?,
            ) else {
                continue;
            };
            let length = serde_json::to_vec(&a.case).unwrap().len();
            if artifacts
                .get(&a.finding.signature)
                .is_none_or(|old| length < serde_json::to_vec(&old.case).unwrap().len())
            {
                artifacts.insert(a.finding.signature.clone(), a);
            }
        }
    }
    for (signature, a) in artifacts {
        shrink::save(&out.join(signature), &a)?;
    }
    combined["slowest_case_seconds"] = json!(slowest.0);
    combined["slowest_case_seed"] = json!(slowest.1);
    combined["seed"] = json!(seed);
    combined["cases"] = json!(cases);
    combined["seconds"] = json!(started.elapsed().as_secs_f64());
    let report: Report = serde_json::from_value(combined).map_err(|e| e.to_string())?;
    std::fs::write(
        out.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(report)
}
