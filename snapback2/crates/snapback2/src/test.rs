//! Boot-run-exit verification against a fresh owner and isolated store.
// @ref LLP 1002#7-test-and-the-receipt — derived probes and journeys share one receipt-backed owner.

use crate::client;
use crate::owner::{self, OwnerInfo};
use crate::project::{CompiledProject, CompilerWorker, SeedData, locate_root};
use crate::protocol::{Refusal, json_to_value, value_to_json};
use crate::receipt::{CheckReceipt, TestReceipt};
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use snapback2_core::{
    ArgType, Context, Generation, Program, ProgramKind, RuleExpr, RuleTerm, Runtime, Store, Value,
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
    let json_output = verbs::has(args, "--json");
    let root = match locate_root(verbs::flag(args, "--project").map(Path::new)) {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    let stamp = timestamp();
    if let Some(reason) = verbs::flag(args, "--blocked") {
        let receipt = TestReceipt::explicitly_blocked(reason);
        return finish(&root, stamp, receipt, json_output);
    }
    let journeys_only = verbs::has(args, "--journeys-only");
    let derived_only = verbs::has(args, "--derived-only");
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
        checks.push(check_effects(&isolated.info, &compiled));
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
    child: Option<Child>,
    info: OwnerInfo,
    project: PathBuf,
    store: PathBuf,
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
        let mut child = Command::new(executable)
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
        let stdout = child.stdout.take().ok_or_else(|| {
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
            let stderr = child
                .stderr
                .take()
                .map(|mut stderr| {
                    let mut text = String::new();
                    let _ = stderr.read_to_string(&mut text);
                    text
                })
                .unwrap_or_default();
            let _ = child.wait();
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
        Ok(Self {
            child: Some(child),
            info,
            project: scratch,
            store,
        })
    }

    fn stop(&mut self) {
        if self.child.is_none() {
            return;
        }
        let _ = client::control(
            &self.info,
            "POST",
            "/control/stop",
            json!({ "cause": "snapback2 test complete" }),
        );
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
        let _ = fs::remove_dir_all(&self.project);
        remove_store(&self.store);
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
    let mut probes = 0_u64;
    let mut personas = seed.personas.clone();
    personas.push("__snapback2_unlisted".to_owned());
    for (table_name, table) in &compiled.generation.schema.tables {
        if table.rules.read.is_public() {
            continue;
        }
        let rows = seed.rows.get(table_name).cloned().unwrap_or_default();
        for persona in &personas {
            probes += rows.len() as u64;
            let response = client::control(
                owner,
                "POST",
                "/control/verdicts",
                json!({ "table": table_name, "rows": rows, "as": persona }),
            );
            let body = match response {
                Ok(response) if response.status < 400 => response.body,
                Ok(response) => {
                    failures.push(
                        json!({ "table": table_name, "as": persona, "response": response.body }),
                    );
                    continue;
                }
                Err(error) => {
                    failures.push(json!({ "table": table_name, "as": persona, "error": error }));
                    continue;
                }
            };
            let actual = body
                .get("rows")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
                .filter(|row| row.get("verdict").and_then(Json::as_str) == Some("allow"))
                .filter_map(|row| row.get("id").and_then(Json::as_str))
                .collect::<BTreeSet<_>>();
            let expected = rows
                .iter()
                .filter(|row| {
                    eval_rule(
                        &table.rules.read,
                        row,
                        &format!("dev:{persona}"),
                        &compiled.generation,
                        seed,
                    )
                })
                .filter_map(|row| row.get("id").and_then(Json::as_str))
                .collect::<BTreeSet<_>>();
            if actual != expected {
                failures.push(json!({ "table": table_name, "as": persona, "expected": expected, "actual": actual }));
            }
        }
    }
    let restored_generation = client::control(owner, "GET", "/control/status", json!({}))
        .ok()
        .and_then(|response| {
            response
                .body
                .get("generation")
                .and_then(Json::as_str)
                .map(ToOwned::to_owned)
        });
    if restored_generation.as_deref() != Some(compiled.generation.hash.as_str()) {
        failures.push(json!({
            "error": "verdict probes did not restore the certified generation",
            "expected": compiled.generation.hash,
            "actual": restored_generation,
        }));
    }
    result_check(
        "rules",
        started,
        failures,
        json!({ "probes": probes, "serverRoute": "/control/verdicts" }),
    )
}

fn eval_rule(
    rule: &RuleExpr,
    row: &Json,
    viewer: &str,
    generation: &Generation,
    seed: &SeedData,
) -> bool {
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow => true,
        RuleExpr::Deny => false,
        RuleExpr::Eq(left, right) => term(left, row, viewer) == term(right, row, viewer),
        RuleExpr::Ne(left, right) => term(left, row, viewer) != term(right, row, viewer),
        RuleExpr::And(rules) => rules
            .iter()
            .all(|rule| eval_rule(rule, row, viewer, generation, seed)),
        RuleExpr::Or(rules) => rules
            .iter()
            .any(|rule| eval_rule(rule, row, viewer, generation, seed)),
        RuleExpr::Not(rule) => !eval_rule(rule, row, viewer, generation, seed),
        RuleExpr::PrincipalKind(kind) => kind == "persona",
        RuleExpr::Exists {
            table, index, key, ..
        } => {
            let Some(columns) = generation
                .schema
                .tables
                .get(table)
                .and_then(|table| table.indexes.get(index))
                .map(|index| &index.columns)
            else {
                return false;
            };
            let wanted: Vec<_> = key
                .iter()
                .map(|rule_term| term(rule_term, row, viewer))
                .collect();
            seed.rows.get(table).into_iter().flatten().any(|candidate| {
                columns
                    .iter()
                    .map(|column| candidate.get(column).cloned().unwrap_or(Json::Null))
                    .eq(wanted.iter().cloned())
            })
        }
    }
}

fn term(term: &RuleTerm, row: &Json, viewer: &str) -> Json {
    match term {
        RuleTerm::Field(name) => row.get(name).cloned().unwrap_or(Json::Null),
        RuleTerm::Viewer => Json::String(viewer.to_owned()),
        RuleTerm::Literal(value) => value_to_json(value),
    }
}

fn check_bounds(owner: &OwnerInfo, compiled: &CompiledProject, seed: &SeedData) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut probes = 0_u64;
    for (name, (program, certificate)) in &compiled.generation.programs {
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
            let body = match response {
                Ok(response) if response.status < 400 => response.body,
                Ok(response) => {
                    failures.push(json!({ "op": name, "as": persona, "response": response.body }));
                    continue;
                }
                Err(error) => {
                    failures.push(json!({ "op": name, "as": persona, "error": error }));
                    continue;
                }
            };
            let trace = body.get("trace").cloned().unwrap_or_else(|| json!({}));
            let examined = trace.get("examined").and_then(Json::as_u64).unwrap_or(0);
            let steps = trace.get("steps").and_then(Json::as_u64).unwrap_or(0);
            let rule_probes = trace
                .get("rule_probes")
                .or_else(|| trace.get("ruleProbes"))
                .and_then(Json::as_u64)
                .unwrap_or(0);
            let sites = certificate
                .read_sites
                .iter()
                .map(|site| site.site.as_str())
                .collect::<BTreeSet<_>>();
            let traced_sites = trace
                .get("ranges")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
                .chain(
                    trace
                        .get("points")
                        .and_then(Json::as_array)
                        .into_iter()
                        .flatten(),
                )
                .filter_map(|site| site.get("site").and_then(Json::as_str));
            if examined > certificate.max_examined
                || steps > certificate.max_steps
                || rule_probes > certificate.max_rule_probes
                || traced_sites.into_iter().any(|site| !sites.contains(site))
            {
                failures.push(json!({
                    "code": "E_TRACE_SUBSET",
                    "op": name,
                    "as": persona,
                    "trace": trace,
                    "certificate": certificate,
                }));
            }
        }
    }
    result_check(
        "bounds",
        started,
        failures,
        json!({ "probes": probes, "failureCode": "E_TRACE_SUBSET" }),
    )
}

fn check_invalidation(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut probes = 0_u64;
    let persona = seed.personas.first().map(String::as_str).unwrap_or("alice");
    for (query_name, (query, query_certificate)) in &compiled.generation.programs {
        if query.kind != ProgramKind::Query {
            continue;
        }
        let read_tables = query_certificate
            .read_sites
            .iter()
            .map(|site| site.table.as_str())
            .collect::<BTreeSet<_>>();
        for (mutation_name, (mutation, mutation_certificate)) in &compiled.generation.programs {
            if mutation.kind != ProgramKind::Mutation {
                continue;
            }
            probes += 1;
            let intersects = mutation_certificate
                .write_sites
                .iter()
                .any(|site| read_tables.contains(site.table.as_str()));
            let mut stream =
                match SseProbe::connect(owner, query_name, generated_args(query, seed), persona) {
                    Ok(stream) => stream,
                    Err(error) => {
                        failures.push(
                        json!({ "query": query_name, "mutation": mutation_name, "error": error }),
                    );
                        continue;
                    }
                };
            if stream.event(Duration::from_secs(2)).is_err() {
                failures.push(json!({ "query": query_name, "mutation": mutation_name, "error": "initial SSE delivery missing" }));
                continue;
            }
            let mutation_response = client::api(
                owner,
                "POST",
                "/api/mutation",
                &[("X-Snapback-As", persona)],
                json!({ "op": mutation_name, "args": generated_args(mutation, seed) }),
            );
            let body = match mutation_response {
                Ok(response) if response.status < 400 => response.body,
                Ok(response) => response.body,
                Err(error) => {
                    failures.push(
                        json!({ "query": query_name, "mutation": mutation_name, "error": error }),
                    );
                    continue;
                }
            };
            let committed = body.get("state").and_then(Json::as_str) == Some("committed");
            let delivery = stream.event(if intersects && committed {
                Duration::from_secs(2)
            } else {
                Duration::from_millis(250)
            });
            if intersects && committed {
                let expected_seq = body.get("seq").and_then(Json::as_u64);
                if delivery
                    .as_ref()
                    .ok()
                    .and_then(|value| value.get("seq"))
                    .and_then(Json::as_u64)
                    != expected_seq
                {
                    failures.push(json!({ "query": query_name, "mutation": mutation_name, "expectedSeq": expected_seq, "delivery": delivery.ok() }));
                }
            } else if delivery.is_ok() {
                failures.push(json!({ "query": query_name, "mutation": mutation_name, "error": "disjoint/rejected mutation delivered" }));
            }
        }
    }
    result_check(
        "invalidation",
        started,
        failures,
        json!({ "probes": probes, "transport": "SSE" }),
    )
}

fn check_replay(owner: &OwnerInfo, compiled: &CompiledProject, seed: &SeedData) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut probes = 0_u64;
    let persona = seed.personas.first().map(String::as_str).unwrap_or("alice");
    for (index, (name, (program, _))) in compiled.generation.programs.iter().enumerate() {
        if program.kind != ProgramKind::Mutation {
            continue;
        }
        probes += 1;
        let _ = client::control(owner, "POST", "/control/reset", json!({}));
        let mut forks = Vec::new();
        for side in ["a", "b"] {
            let response = client::control(
                owner,
                "POST",
                "/control/fork",
                json!({ "name": format!("replay-{index}-{side}") }),
            );
            match response {
                Ok(response) if response.status < 400 => {
                    forks.push(
                        owner
                            .project
                            .join(".snapback/forks")
                            .join(format!("replay-{index}-{side}.sqlite")),
                    );
                }
                Ok(response) => {
                    failures.push(json!({ "op": name, "side": side, "response": response.body }))
                }
                Err(error) => failures.push(json!({ "op": name, "side": side, "error": error })),
            }
        }
        let runs = forks
            .iter()
            .map(|path| replay_fork(path, &compiled.generation, program, seed, persona, index))
            .collect::<Result<Vec<_>, _>>();
        match runs {
            Ok(runs) if runs.len() == 2 && runs[0] != runs[1] => {
                failures.push(json!({ "op": name, "left": runs[0], "right": runs[1] }));
            }
            Ok(_) => {}
            Err(error) => failures.push(json!({ "op": name, "error": error })),
        }
    }
    result_check(
        "replay",
        started,
        failures,
        json!({ "probes": probes, "forks": probes * 2, "clock": "1700000000000 + mutation index", "newIds": "replay-<mutation>-<ordinal>", "comparison": "byte-identical execution + authoritative trace" }),
    )
}

fn replay_fork(
    path: &Path,
    generation: &Generation,
    program: &Program,
    seed: &SeedData,
    persona: &str,
    index: usize,
) -> Result<Json, Refusal> {
    let store = Store::open(path).map_err(|error| Refusal::from_runtime(&error))?;
    let mut runtime = Runtime::open(store, generation.clone())
        .map_err(|error| Refusal::from_successor(&error))?;
    let generated = generated_args(program, seed);
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
    serde_json::to_value(execution).map_err(|error| {
        Refusal::owner(
            "E_OWNER_TEST_REPLAY",
            format!("cannot serialize replay execution: {error}"),
            "rerun snapback2 test",
        )
    })
}

fn check_effects(owner: &OwnerInfo, compiled: &CompiledProject) -> CheckReceipt {
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
        CheckReceipt::pass(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({ "engine": engine, "declarations": [] }),
        )
    } else if engine == "none" {
        CheckReceipt::blocked(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({ "reason": "no engine in this build", "declarations": compiled.generation.effects.keys().collect::<Vec<_>>() }),
        )
    } else {
        CheckReceipt::pass(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({ "engine": engine, "declarations": compiled.generation.effects.keys().collect::<Vec<_>>() }),
        )
    }
}

fn run_journeys(root: &Path, owner: &OwnerInfo) -> Vec<CheckReceipt> {
    let files = journey_files(root);
    if files.is_empty() {
        return vec![CheckReceipt::fail(
            "journeys",
            "journey",
            0,
            json!({ "error": "zero journey files; add snapback/tests/*.test.ts" }),
        )];
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
    let mut args = Map::new();
    for (name, kind) in &program.args {
        let value = match kind {
            ArgType::List { .. } => json!([]),
            ArgType::Enum { variants } => variants
                .first()
                .cloned()
                .map(Json::String)
                .unwrap_or(Json::Null),
            ArgType::Decimal { .. } | ArgType::Money { .. } => json!(100),
            ArgType::Scalar => scalar_arg(name, seed),
        };
        args.insert(name.clone(), value);
    }
    Json::Object(args)
}

fn scalar_arg(name: &str, seed: &SeedData) -> Json {
    if name == "result" {
        return json!({ "providerId": "provider-test" });
    }
    if name == "effect" {
        return json!("notify");
    }
    if name == "conversationId" {
        return seed_id(seed, "conversations", 0).unwrap_or_else(|| json!("conversation-1"));
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

fn journey_files(root: &Path) -> Vec<PathBuf> {
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
