//! Boot-run-exit verification against a fresh owner and isolated store.
// @ref LLP 1002#7-test-and-the-receipt — derived probes and journeys share one receipt-backed owner.

use crate::client;
use crate::owner::{self, OwnerInfo};
use crate::project::{CompiledProject, CompilerWorker, SeedData, locate_root};
use crate::protocol::{Refusal, json_to_value};
use crate::receipt::{CheckReceipt, TestReceipt};
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use snapback2_core::{
    ArgType, Certificate, Context, ExecutionState, Generation, Program, ProgramKind, Runtime,
    Store, Value,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitCode, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub fn run(args: &[String]) -> ExitCode {
    if args.iter().enumerate().any(|(index, arg)| {
        arg == "--blocked"
            && args
                .get(index + 1)
                .is_none_or(|value| value.starts_with("--"))
    }) {
        return usage();
    }
    let options = match verbs::parse_options(
        args,
        &["--blocked", "--project"],
        &["--journeys-only", "--derived-only", "--json"],
    ) {
        Ok(options) => options,
        Err(code) => return code,
    };
    if options.positionals().len() != 1 {
        return usage();
    }
    let json_output = options.has("--json");
    let root = match locate_root(options.value("--project").map(Path::new)) {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    let stamp = timestamp();
    if let Some(reason) = options.value("--blocked") {
        let receipt = TestReceipt::explicitly_blocked(reason);
        return finish(&root, stamp, receipt, json_output);
    }
    let journeys_only = options.has("--journeys-only");
    let derived_only = options.has("--derived-only");
    if journeys_only && derived_only {
        return usage();
    }

    let compile_started = Instant::now();
    let (compiled, seed) = match compile(&root) {
        Ok(value) => value,
        Err(errors) => {
            let check = CheckReceipt::fail(
                "certify",
                "derived",
                elapsed_ms(compile_started),
                json!({ "refusals": errors }),
            );
            return finish(
                &root,
                stamp,
                TestReceipt::new(
                    String::new(),
                    vec!["snapback2 check".to_owned()],
                    vec![check],
                ),
                json_output,
            );
        }
    };
    let mut checks = Vec::new();
    if !journeys_only {
        checks.push(CheckReceipt::pass(
            "certify",
            "derived",
            elapsed_ms(compile_started),
            json!({ "operations": compiled.generation.programs.len() }),
        ));
    }

    let mut isolated = match IsolatedOwner::start(&root, stamp) {
        Ok(owner) => owner,
        Err(error) => {
            checks.push(CheckReceipt::fail(
                "owner",
                "derived",
                0,
                serde_json::to_value(error).unwrap_or(Json::Null),
            ));
            return finish(
                &root,
                stamp,
                TestReceipt::new(
                    compiled.generation.hash,
                    vec!["snapback2 dev --foreground".to_owned()],
                    checks,
                ),
                json_output,
            );
        }
    };
    let commands = vec![
        "snapback2 dev --foreground --port 0".to_owned(),
        "seed".to_owned(),
        if journeys_only {
            "snapback2 test --journeys-only".to_owned()
        } else if derived_only {
            "snapback2 test --derived-only".to_owned()
        } else {
            "snapback2 test".to_owned()
        },
    ];

    if !journeys_only {
        checks.push(check_rules(&isolated.info, &compiled, &seed));
        checks.push(check_bounds(&isolated.info, &compiled, &seed));
        checks.push(check_invalidation(&isolated.info, &compiled, &seed));
        checks.push(check_replay(&isolated.info, &compiled, &seed));
        if let Some(effects) = check_effects(&isolated.info, &compiled) {
            checks.push(effects);
        }
    }
    if !derived_only {
        checks.extend(run_journeys(&root, &isolated.info));
    }
    isolated.stop();
    finish(
        &root,
        stamp,
        TestReceipt::new(compiled.generation.hash, commands, checks),
        json_output,
    )
}

fn compile(root: &Path) -> Result<(CompiledProject, SeedData), Vec<Refusal>> {
    let mut worker = CompilerWorker::spawn().map_err(|error| vec![error])?;
    let compiled = worker.compile(root)?;
    let seed = worker.seed(root)?;
    Ok((compiled, seed))
}

fn finish(root: &Path, stamp: u128, receipt: TestReceipt, json_output: bool) -> ExitCode {
    if let Err(error) = receipt.write(root, stamp) {
        return owner::print_refusal(error, json_output, 1);
    }
    if json_output {
        println!("{}", serde_json::to_string(&receipt).unwrap_or_default());
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&receipt).unwrap_or_default()
        );
    }
    if receipt.verdict == "pass" {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

struct IsolatedOwner {
    info: OwnerInfo,
    cleanup: OwnerCleanup,
}

struct OwnerCleanup {
    child: Option<Child>,
    scratch: PathBuf,
    store: PathBuf,
}

impl OwnerCleanup {
    fn clean(&mut self) {
        if let Some(mut child) = self.child.take() {
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(3) {
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                thread::sleep(Duration::from_millis(20));
            }
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        let _ = fs::remove_dir_all(&self.scratch);
        remove_store(&self.store);
    }
}

impl Drop for OwnerCleanup {
    fn drop(&mut self) {
        self.clean();
    }
}

impl IsolatedOwner {
    fn start(root: &Path, stamp: u128) -> Result<Self, Refusal> {
        let scratch = root.join(format!(".snapback/test-run-{stamp}"));
        let project = scratch.join("project");
        copy_tree(&root.join("snapback"), &project.join("snapback"))?;
        fs::create_dir_all(project.join(".snapback")).map_err(test_io)?;
        let store = root.join(format!(".snapback/test-{stamp}.sqlite"));
        let owner_store = project.join(".snapback/store.sqlite");
        link_store(&store, &owner_store)?;
        let executable = std::env::current_exe().map_err(test_io)?;
        let child = Command::new(executable)
            .args([
                "dev",
                "--project",
                project.to_str().unwrap_or_default(),
                "--foreground",
                "--owner-child",
                "--json",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(test_io)?;
        // Cleanup owns the child and every scratch path from the instant spawn succeeds.
        // Any `?` below therefore kills/reaps the child and removes `.snapback/test-*`.
        let mut cleanup = OwnerCleanup {
            child: Some(child),
            scratch,
            store,
        };
        let stdout = cleanup
            .child
            .as_mut()
            .and_then(|child| child.stdout.take())
            .ok_or_else(|| {
                Refusal::owner(
                    "E_OWNER_TEST_START",
                    "test owner has no stdout",
                    "rerun snapback2 test",
                )
            })?;
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader.read_line(&mut line).map_err(test_io)?;
        if line.trim().is_empty() {
            let stderr = cleanup
                .child
                .as_mut()
                .and_then(|child| {
                    child.stderr.take().map(|mut stderr| {
                        let mut text = String::new();
                        let _ = stderr.read_to_string(&mut text);
                        text
                    })
                })
                .unwrap_or_default();
            return Err(Refusal::owner(
                "E_OWNER_TEST_START",
                format!("fresh owner exited before ready: {stderr}"),
                "run snapback2 dev --foreground and fix the startup refusal",
            ));
        }
        let _: Json = serde_json::from_str(&line).map_err(|error| {
            Refusal::owner(
                "E_OWNER_TEST_START",
                format!("fresh owner returned invalid ready JSON: {error}: {line}"),
                "rerun snapback2 test",
            )
        })?;
        let info: OwnerInfo = serde_json::from_slice(
            &fs::read(project.join(".snapback/owner.json")).map_err(test_io)?,
        )
        .map_err(|error| {
            Refusal::owner(
                "E_OWNER_TEST_START",
                format!("fresh owner state is invalid: {error}"),
                "rerun snapback2 test",
            )
        })?;
        Ok(Self { info, cleanup })
    }

    fn stop(&mut self) {
        if self.cleanup.child.is_none() {
            return;
        }
        let _ = client::control(
            &self.info,
            "POST",
            "/control/stop",
            json!({ "cause": "snapback2 test complete" }),
        );
        self.cleanup.clean();
    }
}

impl Drop for IsolatedOwner {
    fn drop(&mut self) {
        self.stop();
    }
}

fn check_rules(owner: &OwnerInfo, compiled: &CompiledProject, seed: &SeedData) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let mut probes = 0_u64;
    let mut tables = Map::new();
    for (table_name, table) in &compiled.generation.schema.tables {
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
                    failures.push(json!({ "table": table_name, "as": persona, "source": "data", "error": error }));
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
                    failures.push(json!({ "table": table_name, "as": persona, "source": "engine", "error": error }));
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
                failures.push(json!({ "table": table_name, "as": persona, "expected": expected, "actual": actual }));
            }
            if persona == &unlisted && !actual.is_empty() {
                failures.push(json!({
                    "table": table_name,
                    "as": persona,
                    "expected": [],
                    "actual": actual,
                    "reason": "persona named in no seed row must see zero rows",
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

fn rule_id_sets_match(actual: &BTreeSet<String>, expected: &BTreeSet<String>) -> bool {
    actual == expected
}

fn check_bounds(owner: &OwnerInfo, compiled: &CompiledProject, seed: &SeedData) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut probes = 0_u64;
    for (name, (program, _certificate)) in &compiled.generation.programs {
        if program.kind != ProgramKind::Query {
            continue;
        }
        for persona in &seed.personas {
            probes += 1;
            let response = client::control(
                owner,
                "POST",
                "/control/why",
                json!({ "op": name, "args": generated_args(program, seed), "as": persona }),
            );
            match response {
                Ok(response) if response.status < 400 => {}
                Ok(response) => {
                    failures.push(json!({
                        "op": name,
                        "as": persona,
                        "source": "engine",
                        "code": response.body.get("code").cloned().unwrap_or(Json::Null),
                        "response": response.body,
                    }));
                }
                Err(error) => {
                    failures.push(
                        json!({ "op": name, "as": persona, "source": "engine", "error": error }),
                    );
                }
            }
        }
    }
    result_check(
        "bounds",
        started,
        failures,
        json!({
            "probes": probes,
            "failureCode": "E_TRACE_SUBSET",
            "enforcedBy": "engine",
        }),
    )
}

fn check_invalidation(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let mut probes = 0_u64;
    let mut attempts = 0_u64;
    let mut silence_probes = 0_u64;
    let mut intersections = Vec::new();
    for (query_name, (query, query_certificate)) in &compiled.generation.programs {
        if query.kind != ProgramKind::Query {
            continue;
        }
        let query_args = generated_args_at(query, seed, 0);
        for (mutation_name, (mutation, mutation_certificate)) in &compiled.generation.programs {
            if mutation.kind != ProgramKind::Mutation {
                continue;
            }
            let shared_sites = certificate_site_intersection(
                query_certificate,
                mutation_certificate,
                &compiled.generation,
            );
            let candidates = probe_candidates(mutation, seed);
            if shared_sites.is_empty() {
                for (persona, mutation_args) in &candidates {
                    attempts += 1;
                    let (committed, failure) = invalidation_attempt(
                        owner,
                        query_name,
                        &query_args,
                        mutation_name,
                        mutation_args,
                        persona,
                        false,
                    );
                    if let Some(failure) = failure {
                        failures.push(failure);
                    }
                    if committed {
                        probes += 1;
                        silence_probes += 1;
                        break;
                    }
                }
                continue;
            }

            intersections.push(json!({
                "query": query_name,
                "mutation": mutation_name,
                "sites": shared_sites.iter().map(|(table, index)| json!({
                    "table": table,
                    "index": index,
                })).collect::<Vec<_>>(),
            }));
            let mut committed_intersection = false;
            for (persona, mutation_args) in candidates
                .iter()
                .filter(|(_, args)| probe_args_align(&query_args, args))
            {
                attempts += 1;
                let (committed, failure) = invalidation_attempt(
                    owner,
                    query_name,
                    &query_args,
                    mutation_name,
                    mutation_args,
                    persona,
                    true,
                );
                if let Some(failure) = failure {
                    failures.push(failure);
                }
                if committed {
                    committed_intersection = true;
                    probes += 1;
                    break;
                }
            }
            if !committed_intersection {
                blocked.push(json!({
                    "query": query_name,
                    "mutation": mutation_name,
                    "reason": "no committing probe",
                }));
                continue;
            }

            // A second seed key for the same table/index is the strongest
            // silence probe: the write site overlaps statically but its
            // concrete touched key is outside this subscription's prefix.
            for (persona, mutation_args) in candidates
                .iter()
                .filter(|(_, args)| probe_args_diverge(&query_args, args))
            {
                attempts += 1;
                let (committed, failure) = invalidation_attempt(
                    owner,
                    query_name,
                    &query_args,
                    mutation_name,
                    mutation_args,
                    persona,
                    false,
                );
                if let Some(failure) = failure {
                    failures.push(failure);
                }
                if committed {
                    probes += 1;
                    silence_probes += 1;
                    break;
                }
            }
        }
    }
    let detail = json!({
        "probes": probes,
        "attempts": attempts,
        "silenceProbes": silence_probes,
        "transport": "SSE",
        "intersectionLevel": "table+index",
        "intersections": intersections,
        "blocked": blocked,
    });
    if !failures.is_empty() {
        CheckReceipt::fail(
            "invalidation",
            "derived",
            elapsed_ms(started),
            json!({ "failures": failures, "summary": detail }),
        )
    } else if !blocked.is_empty() {
        CheckReceipt::blocked("invalidation", "derived", elapsed_ms(started), detail)
    } else {
        CheckReceipt::pass("invalidation", "derived", elapsed_ms(started), detail)
    }
}

fn certificate_site_intersection(
    query: &Certificate,
    mutation: &Certificate,
    generation: &Generation,
) -> BTreeSet<(String, String)> {
    let reads = query
        .read_sites
        .iter()
        .map(|site| (site.table.clone(), site.index.clone()))
        .collect::<BTreeSet<_>>();
    let writes = mutation
        .write_sites
        .iter()
        .flat_map(|site| {
            generation
                .schema
                .tables
                .get(&site.table)
                .into_iter()
                .flat_map(move |table| {
                    table
                        .indexes
                        .keys()
                        .cloned()
                        .map(move |index| (site.table.clone(), index))
                })
        })
        .collect::<BTreeSet<_>>();
    reads.intersection(&writes).cloned().collect()
}

fn probe_args_align(query: &Json, mutation: &Json) -> bool {
    let Some(query) = query.as_object() else {
        return true;
    };
    let Some(mutation) = mutation.as_object() else {
        return true;
    };
    query
        .iter()
        .filter_map(|(name, value)| mutation.get(name).map(|other| (value, other)))
        .all(|(left, right)| left == right)
}

fn probe_args_diverge(query: &Json, mutation: &Json) -> bool {
    let Some(query) = query.as_object() else {
        return false;
    };
    let Some(mutation) = mutation.as_object() else {
        return false;
    };
    query
        .iter()
        .any(|(name, value)| mutation.get(name).is_some_and(|other| other != value))
}

fn invalidation_attempt(
    owner: &OwnerInfo,
    query: &str,
    query_args: &Json,
    mutation: &str,
    mutation_args: &Json,
    persona: &str,
    expect_delivery: bool,
) -> (bool, Option<Json>) {
    if let Err(error) = client::control(owner, "POST", "/control/reset", json!({})) {
        return (
            false,
            Some(json!({ "query": query, "mutation": mutation, "as": persona, "error": error })),
        );
    }
    let mut stream = match SseProbe::connect(owner, query, query_args.clone(), persona) {
        Ok(stream) => stream,
        Err(error) => {
            return (
                false,
                Some(
                    json!({ "query": query, "mutation": mutation, "as": persona, "error": error }),
                ),
            );
        }
    };
    if let Err(error) = stream.event(Duration::from_secs(2)) {
        return (
            false,
            Some(json!({
                "query": query,
                "mutation": mutation,
                "as": persona,
                "error": format!("initial SSE delivery missing: {error}"),
            })),
        );
    }
    let body = match client::api(
        owner,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", persona)],
        json!({ "op": mutation, "args": mutation_args }),
    ) {
        Ok(response) => response.body,
        Err(error) => {
            return (
                false,
                Some(
                    json!({ "query": query, "mutation": mutation, "as": persona, "error": error }),
                ),
            );
        }
    };
    if body.get("state").and_then(Json::as_str) != Some("committed") {
        return (false, None);
    }
    let expected_seq = body.get("seq").and_then(Json::as_u64);
    if expect_delivery {
        match stream.event(Duration::from_secs(2)) {
            Ok(delivery) if delivery.get("seq").and_then(Json::as_u64) == expected_seq => {
                (true, None)
            }
            delivery => (
                true,
                Some(json!({
                    "query": query,
                    "mutation": mutation,
                    "as": persona,
                    "expectedSeq": expected_seq,
                    "delivery": delivery.ok(),
                })),
            ),
        }
    } else {
        match stream.event(Duration::from_millis(250)) {
            Ok(delivery) => (
                true,
                Some(json!({
                    "query": query,
                    "mutation": mutation,
                    "as": persona,
                    "error": "non-intersecting committed mutation delivered",
                    "delivery": delivery,
                })),
            ),
            Err(_) => (true, None),
        }
    }
}

fn check_replay(owner: &OwnerInfo, compiled: &CompiledProject, seed: &SeedData) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let mut probes = 0_u64;
    let mut attempts = 0_u64;
    let mut forks_count = 0_u64;
    for (index, (name, (program, _))) in compiled.generation.programs.iter().enumerate() {
        if program.kind != ProgramKind::Mutation {
            continue;
        }
        let mut committed_probe = false;
        for (candidate_index, (persona, args)) in
            probe_candidates(program, seed).into_iter().enumerate()
        {
            attempts += 1;
            if let Err(error) = client::control(owner, "POST", "/control/reset", json!({})) {
                failures.push(json!({ "op": name, "as": persona, "error": error }));
                break;
            }
            let mut forks = Vec::new();
            for side in ["a", "b"] {
                let fork_name = format!("replay-{index}-{candidate_index}-{side}");
                let response =
                    client::control(owner, "POST", "/control/fork", json!({ "name": fork_name }));
                match response {
                    Ok(response) if response.status < 400 => {
                        forks_count += 1;
                        forks.push(
                            owner
                                .project
                                .join(".snapback/forks")
                                .join(format!("replay-{index}-{candidate_index}-{side}.sqlite")),
                        );
                    }
                    Ok(response) => failures.push(
                        json!({ "op": name, "as": persona, "side": side, "response": response.body }),
                    ),
                    Err(error) => failures.push(
                        json!({ "op": name, "as": persona, "side": side, "error": error }),
                    ),
                }
            }
            if forks.len() != 2 {
                break;
            }
            let runs = forks
                .iter()
                .map(|path| {
                    replay_fork(path, &compiled.generation, program, &args, &persona, index)
                })
                .collect::<Result<Vec<_>, _>>();
            match runs {
                Ok(runs) if runs.iter().all(|(_, committed)| *committed) => {
                    committed_probe = true;
                    probes += 1;
                    if runs[0].0 != runs[1].0 {
                        failures.push(json!({ "op": name, "as": persona, "left": runs[0].0, "right": runs[1].0 }));
                    }
                    break;
                }
                Ok(runs) if runs.iter().any(|(_, committed)| *committed) => {
                    failures.push(json!({
                        "op": name,
                        "as": persona,
                        "error": "identical replay forks disagreed on commit state",
                        "runs": runs.into_iter().map(|(run, _)| run).collect::<Vec<_>>(),
                    }));
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    failures.push(json!({ "op": name, "as": persona, "error": error }));
                    break;
                }
            }
        }
        if !committed_probe {
            blocked.push(json!({
                "op": name,
                "reason": format!("no committing probe for {name}"),
            }));
        }
    }
    let detail = json!({
        "probes": probes,
        "attempts": attempts,
        "forks": forks_count,
        "blocked": blocked,
        "clock": "1700000000000 + mutation index",
        "newIds": "replay-<mutation>-<ordinal>",
        "comparison": "byte-identical committed execution + authoritative trace",
    });
    if !failures.is_empty() {
        CheckReceipt::fail(
            "replay",
            "derived",
            elapsed_ms(started),
            json!({ "failures": failures, "summary": detail }),
        )
    } else if !blocked.is_empty() {
        CheckReceipt::blocked("replay", "derived", elapsed_ms(started), detail)
    } else {
        CheckReceipt::pass("replay", "derived", elapsed_ms(started), detail)
    }
}

fn replay_fork(
    path: &Path,
    generation: &Generation,
    program: &Program,
    generated: &Json,
    persona: &str,
    index: usize,
) -> Result<(Json, bool), Refusal> {
    let store = Store::open(path).map_err(|error| Refusal::from_runtime(&error))?;
    let mut runtime = Runtime::open(store, generation.clone())
        .map_err(|error| Refusal::from_successor(&error))?;
    let mut args = BTreeMap::new();
    for name in program.args.keys() {
        let value = generated.get(name).cloned().unwrap_or(Json::Null);
        let value = if (name == "id" || name.ends_with("Id")) && value.as_str().is_some() {
            Value::Id(value.as_str().unwrap_or_default().to_owned())
        } else {
            json_to_value(&value)?
        };
        args.insert(name.clone(), value);
    }
    let mut context = Context::query(format!("dev:{persona}"), args);
    context.principal_kind = "persona".to_owned();
    context.now = Some(1_700_000_000_000_i64.saturating_add(index as i64));
    context.new_ids = (0..1024)
        .map(|ordinal| format!("replay-{index}-{ordinal}"))
        .collect::<VecDeque<_>>();
    let execution = runtime
        .execute(&program.name, context)
        .map_err(|error| Refusal::from_runtime(&error))?;
    let committed = matches!(execution.state, ExecutionState::Committed { .. });
    serde_json::to_value(execution)
        .map(|execution| (execution, committed))
        .map_err(|error| {
            Refusal::owner(
                "E_OWNER_TEST_REPLAY",
                format!("cannot serialize replay execution: {error}"),
                "rerun snapback2 test",
            )
        })
}

fn check_effects(owner: &OwnerInfo, compiled: &CompiledProject) -> Option<CheckReceipt> {
    let started = Instant::now();
    let status = client::control(owner, "GET", "/control/status", json!({}))
        .ok()
        .map(|response| response.body)
        .unwrap_or_else(|| json!({}));
    let engine = status
        .get("effects")
        .and_then(|effects| effects.get("engine"))
        .and_then(Json::as_str)
        .unwrap_or("none");
    if compiled.generation.effects.is_empty() {
        None
    } else if engine == "none" {
        Some(CheckReceipt::blocked(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({ "reason": "no engine in this build", "declarations": compiled.generation.effects.keys().collect::<Vec<_>>() }),
        ))
    } else {
        Some(CheckReceipt::pass(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({ "engine": engine, "declarations": compiled.generation.effects.keys().collect::<Vec<_>>() }),
        ))
    }
}

fn run_journeys(root: &Path, owner: &OwnerInfo) -> Vec<CheckReceipt> {
    let files = match journey_files(root) {
        Ok(files) => files,
        Err(error) => {
            return vec![CheckReceipt::fail(
                "journeys",
                "journey",
                0,
                serde_json::to_value(error).unwrap_or(Json::Null),
            )];
        }
    };
    if files.is_empty() {
        return Vec::new();
    }
    let runner = match runner_path() {
        Ok(runner) => runner,
        Err(error) => {
            return vec![CheckReceipt::fail(
                "journeys",
                "journey",
                0,
                serde_json::to_value(error).unwrap_or(Json::Null),
            )];
        }
    };
    let mut command = Command::new("node");
    command
        .arg(runner)
        .arg("--url")
        .arg(&owner.url)
        .arg("--secret")
        .arg(&owner.secret)
        .arg("--");
    command.args(&files);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) => {
            return vec![CheckReceipt::fail(
                "journeys",
                "journey",
                0,
                json!({ "error": error.to_string() }),
            )];
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut checks = stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<CheckReceipt>(line).ok())
        .collect::<Vec<_>>();
    if checks.is_empty()
        || (!output.status.success() && !checks.iter().any(|check| check.verdict == "fail"))
    {
        checks.push(CheckReceipt::fail(
            "journey runner",
            "journey",
            0,
            json!({
                "status": output.status.code(),
                "stdout": stdout,
                "stderr": String::from_utf8_lossy(&output.stderr),
            }),
        ));
    }
    checks
}

fn generated_args(program: &Program, seed: &SeedData) -> Json {
    generated_args_at(program, seed, 0)
}

fn generated_args_at(program: &Program, seed: &SeedData, sample: usize) -> Json {
    let mut args = Map::new();
    for (name, kind) in &program.args {
        let value = generated_arg(name, kind, seed, sample);
        args.insert(name.clone(), value);
    }
    Json::Object(args)
}

fn generated_arg(name: &str, kind: &ArgType, seed: &SeedData, sample: usize) -> Json {
    match kind {
        ArgType::Id | ArgType::Scalar | ArgType::Json { .. } => scalar_arg(name, seed, sample),
        ArgType::Text { .. } => {
            let candidate = scalar_arg(name, seed, sample);
            candidate
                .as_str()
                .map(|value| json!(value))
                .unwrap_or_else(|| json!("derived test"))
        }
        ArgType::Int | ArgType::Time => json!(1),
        ArgType::Bool => json!(false),
        ArgType::Optional(inner) => generated_arg(name, inner, seed, sample),
        ArgType::List { .. } => json!([]),
        ArgType::Enum { variants } => variants
            .first()
            .cloned()
            .map(Json::String)
            .unwrap_or(Json::Null),
        ArgType::Decimal { .. } | ArgType::Money { .. } => json!(100),
    }
}

fn scalar_arg(name: &str, seed: &SeedData, sample: usize) -> Json {
    if name == "result" {
        return json!({ "providerId": "provider-test" });
    }
    if name == "effect" {
        return json!("notify");
    }
    if name == "conversationId" {
        return seed_id(seed, "conversations", sample)
            .or_else(|| seed_id(seed, "conversations", 0))
            .unwrap_or_else(|| json!("conversation-1"));
    }
    if name == "recipientId" {
        return seed_id(seed, "profiles", 1).unwrap_or_else(|| json!("dev:bob"));
    }
    if name == "outboxId" {
        return json!("outbox-test");
    }
    if name == "id" || name.ends_with("Id") {
        return first_seed_id(seed).unwrap_or_else(|| json!("derived-id"));
    }
    if matches!(name, "body" | "title" | "note" | "label") {
        return json!("derived test");
    }
    if name.starts_with("is") || name == "done" {
        return json!(false);
    }
    json!(1)
}

fn probe_candidates(program: &Program, seed: &SeedData) -> Vec<(String, Json)> {
    let personas = if seed.personas.is_empty() {
        vec!["alice".to_owned()]
    } else {
        seed.personas.clone()
    };
    let samples = if program.args.contains_key("conversationId") {
        seed.rows
            .get("conversations")
            .map(Vec::len)
            .unwrap_or(1)
            .max(1)
    } else {
        1
    };
    let mut seen = BTreeSet::new();
    let mut candidates = Vec::new();
    for sample in 0..samples {
        let args = generated_args_at(program, seed, sample);
        for persona in &personas {
            let identity = format!(
                "{persona}:{}",
                serde_json::to_string(&args).unwrap_or_default()
            );
            if seen.insert(identity) {
                candidates.push((persona.clone(), args.clone()));
            }
        }
    }
    candidates
}

fn seed_id(seed: &SeedData, table: &str, index: usize) -> Option<Json> {
    seed.rows.get(table)?.get(index)?.get("id").cloned()
}

fn first_seed_id(seed: &SeedData) -> Option<Json> {
    seed.rows
        .values()
        .flat_map(|rows| rows.iter())
        .find_map(|row| row.get("id").cloned())
}

fn result_check(name: &str, started: Instant, failures: Vec<Json>, detail: Json) -> CheckReceipt {
    if failures.is_empty() {
        CheckReceipt::pass(name, "derived", elapsed_ms(started), detail)
    } else {
        CheckReceipt::fail(
            name,
            "derived",
            elapsed_ms(started),
            json!({ "failures": failures, "summary": detail }),
        )
    }
}

struct SseProbe {
    reader: BufReader<TcpStream>,
}

impl SseProbe {
    fn connect(owner: &OwnerInfo, op: &str, args: Json, persona: &str) -> Result<Self, Refusal> {
        let mut stream = TcpStream::connect(("127.0.0.1", owner.port)).map_err(test_io)?;
        let encoded =
            percent_encode(&serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_owned()));
        write!(
            stream,
            "GET /api/subscribe?op={}&args={} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Snapback-As: {}\r\nConnection: close\r\n\r\n",
            percent_encode(op),
            encoded,
            owner.port,
            persona,
        )
        .map_err(test_io)?;
        stream.flush().map_err(test_io)?;
        let mut reader = BufReader::new(stream);
        let mut status = String::new();
        reader.read_line(&mut status).map_err(test_io)?;
        if !status.contains(" 200 ") {
            return Err(Refusal::owner(
                "E_OWNER_TEST_SSE",
                format!("subscription returned {status}"),
                "run snapback2 why for the query and persona",
            ));
        }
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).map_err(test_io)?;
            if line == "\r\n" || line.is_empty() {
                break;
            }
        }
        Ok(Self { reader })
    }

    fn event(&mut self, timeout: Duration) -> Result<Json, String> {
        self.reader
            .get_mut()
            .set_read_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        loop {
            let mut size = String::new();
            self.reader
                .read_line(&mut size)
                .map_err(|error| error.to_string())?;
            let size = usize::from_str_radix(size.trim(), 16).map_err(|error| error.to_string())?;
            if size == 0 {
                return Err("subscription ended".to_owned());
            }
            let mut payload = vec![0_u8; size];
            self.reader
                .read_exact(&mut payload)
                .map_err(|error| error.to_string())?;
            let mut crlf = [0_u8; 2];
            self.reader
                .read_exact(&mut crlf)
                .map_err(|error| error.to_string())?;
            let text = String::from_utf8_lossy(&payload);
            if let Some(data) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                return serde_json::from_str(data).map_err(|error| error.to_string());
            }
        }
    }
}

fn authored_journey_files(root: &Path) -> Vec<PathBuf> {
    let mut files = fs::read_dir(root.join("snapback/tests"))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".test.ts"))
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn journey_files(root: &Path) -> Result<Vec<PathBuf>, Refusal> {
    let authored = authored_journey_files(root);
    if authored.is_empty() {
        return Ok(Vec::new());
    }
    let build = root.join(".snapback/build/tests");
    let mut output = Vec::new();
    for source in authored {
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .strip_suffix(".test.ts")
            .unwrap_or_default();
        let built = build.join(format!("{name}.mjs"));
        let source_modified = source.metadata().and_then(|metadata| metadata.modified());
        let built_modified = built.metadata().and_then(|metadata| metadata.modified());
        if !built.is_file()
            || matches!((source_modified, built_modified), (Ok(source), Ok(built)) if built < source)
        {
            return Err(Refusal::owner(
                "E_OWNER_TEST_STALE",
                format!(
                    "{} has no current built journey at {}",
                    source.display(),
                    built.display()
                ),
                "run snapback2 check",
            ));
        }
        output.push(built);
    }
    Ok(output)
}

fn runner_path() -> Result<PathBuf, Refusal> {
    let candidates = [
        std::env::var_os("SNAPBACK2_TEST_RUNNER").map(PathBuf::from),
        std::env::var_os("SNAPBACK2_COMPILER")
            .map(PathBuf::from)
            .and_then(|path| path.parent().map(|parent| parent.join("test-runner.mjs"))),
        Some(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../packages/snapback2/dist/test-runner.mjs"),
        ),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            Refusal::owner(
                "E_OWNER_NO_TEST_RUNNER",
                "the shipped dist/test-runner.mjs was not found",
                "reinstall snapback2 or set SNAPBACK2_TEST_RUNNER",
            )
        })
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), Refusal> {
    fs::create_dir_all(target).map_err(test_io)?;
    let mut entries = fs::read_dir(source)
        .map_err(test_io)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(test_io)?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let destination = target.join(entry.file_name());
        if path.is_dir() {
            copy_tree(&path, &destination)?;
        } else {
            fs::copy(&path, &destination).map_err(test_io)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn link_store(target: &Path, link: &Path) -> Result<(), Refusal> {
    std::os::unix::fs::symlink(target, link).map_err(test_io)
}

#[cfg(not(unix))]
fn link_store(_target: &Path, _link: &Path) -> Result<(), Refusal> {
    Err(Refusal::owner(
        "E_OWNER_TEST_STORE",
        "isolated test stores require symbolic-link support in this build",
        "run snapback2 test on a supported Unix host",
    ))
}

fn remove_store(path: &Path) {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let _ = fs::remove_file(path);
    }
}

fn test_io(error: std::io::Error) -> Refusal {
    Refusal::owner(
        "E_OWNER_TEST_IO",
        error.to_string(),
        "make .snapback writable and rerun snapback2 test",
    )
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn usage() -> ExitCode {
    eprintln!(
        "usage: snapback2 test [--blocked reason] [--journeys-only] [--derived-only] [--json]"
    );
    ExitCode::from(2)
}

#[cfg(test)]
mod derived_tests {
    use super::*;
    use snapback2_core::{Ceilings, Checker, Engine, RuntimeError};

    #[test]
    fn startup_cleanup_guard_reaps_the_child_and_removes_every_test_path() {
        let root = std::env::temp_dir().join(format!(
            "snapback2-startup-cleanup-{}-{}",
            std::process::id(),
            timestamp()
        ));
        let scratch = root.join(".snapback/test-run-failed");
        let store = root.join(".snapback/test-failed.sqlite");
        fs::create_dir_all(&scratch).unwrap();
        fs::write(&store, b"test").unwrap();
        let child = Command::new("node")
            .args(["-e", "setInterval(() => {}, 1000)"])
            .spawn()
            .unwrap();
        let mut cleanup = OwnerCleanup {
            child: Some(child),
            scratch: scratch.clone(),
            store: store.clone(),
        };

        cleanup.clean();

        assert!(cleanup.child.is_none());
        assert!(!scratch.exists());
        assert!(!store.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn generated_args_exercises_every_arg_type_variant() {
        let program = Program {
            name: "all.args".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([
                ("id".to_owned(), ArgType::Id),
                ("text".to_owned(), ArgType::Text { max: 20 }),
                ("int".to_owned(), ArgType::Int),
                ("bool".to_owned(), ArgType::Bool),
                ("time".to_owned(), ArgType::Time),
                ("json".to_owned(), ArgType::Json { max_bytes: 100 }),
                (
                    "optional".to_owned(),
                    ArgType::Optional(Box::new(ArgType::Text { max: 20 })),
                ),
                (
                    "list".to_owned(),
                    ArgType::List {
                        of: Some(Box::new(ArgType::Int)),
                        max: 4,
                    },
                ),
                (
                    "enum".to_owned(),
                    ArgType::Enum {
                        variants: vec!["first".to_owned(), "second".to_owned()],
                    },
                ),
                ("decimal".to_owned(), ArgType::Decimal { scale: 2 }),
                (
                    "money".to_owned(),
                    ArgType::Money {
                        currency: "USD".to_owned(),
                        scale: 2,
                    },
                ),
                ("scalar".to_owned(), ArgType::Scalar),
            ]),
            read_time_granularity_ms: None,
            body: vec![snapback2_core::Stmt::Return(snapback2_core::Expr::Literal(
                Value::Null,
            ))],
        };

        let args = generated_args(&program, &SeedData::default());

        assert_eq!(args.as_object().unwrap().len(), 12);
        assert_eq!(args["enum"], "first");
        assert_eq!(args["list"], json!([]));
        assert_eq!(args["decimal"], 100);
        assert_eq!(args["money"], 100);
    }

    #[test]
    fn rules_equality_rejects_extra_and_missing_visible_rows() {
        let expected = BTreeSet::from(["seed".to_owned()]);
        assert!(!rule_id_sets_match(
            &BTreeSet::from(["ghost".to_owned(), "seed".to_owned()]),
            &expected,
        ));
        assert!(!rule_id_sets_match(&BTreeSet::new(), &expected));
    }

    #[test]
    fn bounds_failure_fixture_gets_e_trace_subset_from_the_engine() {
        let schema = snapback2_core::spike_schema();
        let program = snapback2_core::thread_program(10);
        let mut certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        certificate.read_sites.clear();
        let mut engine = Engine::memory(schema).unwrap();
        let mut context = Context::query(
            "dev:alice",
            BTreeMap::from([(
                "conversationId".to_owned(),
                Value::Id("conversation-1".to_owned()),
            )]),
        );
        context.principal_kind = "persona".to_owned();

        let error = engine.execute(&program, &certificate, context).unwrap_err();

        assert_eq!(error.code(), "E_TRACE_SUBSET");
        assert!(matches!(error, RuntimeError::TraceSubset(_)));
    }
}
