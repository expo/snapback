//! Boot-run-exit verification against a fresh owner and isolated store.
// @ref LLP 1002#7-test-and-the-receipt — derived probes and journeys share one receipt-backed owner.

use self::test_bounds::engine_failure;
use self::test_seed_ids::{arg_is_id, named_id_table, seed_id_arg};
use self::test_sse::SseProbe;
use crate::client;
use crate::owner::{self, OwnerInfo};
use crate::project::{self, CompiledProject, CompilerWorker, SeedData, locate_root};
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
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitCode, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[path = "test_bounds.rs"]
mod test_bounds;
#[path = "test_policy.rs"]
mod test_policy;
#[path = "test_seed_ids.rs"]
mod test_seed_ids;
#[path = "test_sse.rs"]
mod test_sse;

#[cfg(test)]
use self::test_policy::rule_id_sets_match;
use self::test_policy::{check_invalidation, check_rules};

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
    let checked = match journey_files(&root) {
        Ok(_) => None,
        Err(_) => match project::compile_once(&root) {
            Ok(compiled) => Some(compiled),
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
        },
    };
    let (compiled, seed) = match compile(&root, checked) {
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
        checks.extend(run_journeys(&isolated.info.project, &isolated.info));
    }
    isolated.stop();
    finish(
        &root,
        stamp,
        TestReceipt::new(compiled.generation.hash, commands, checks),
        json_output,
    )
}

fn compile(
    root: &Path,
    checked: Option<CompiledProject>,
) -> Result<(CompiledProject, SeedData), Vec<Refusal>> {
    let mut worker = CompilerWorker::spawn().map_err(|error| vec![error])?;
    let compiled = match checked {
        Some(compiled) => compiled,
        None => worker.compile(root)?,
    };
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
        let build = root.join(".snapback/build");
        if build.is_dir() {
            copy_tree(&build, &project.join(".snapback/build"))?;
        }
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

fn check_bounds(owner: &OwnerInfo, compiled: &CompiledProject, seed: &SeedData) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let mut executions = Vec::new();
    let mut probes = 0_u64;
    for (name, (program, certificate)) in &compiled.generation.programs {
        if program.kind != ProgramKind::Query {
            continue;
        }
        let generated = match generated_args(program, seed) {
            Ok(generated) => generated,
            Err(reason) => {
                blocked.push(json!({ "op": name, "reason": reason }));
                continue;
            }
        };
        for persona in &seed.personas {
            probes += 1;
            let response = client::control(
                owner,
                "POST",
                "/control/why",
                json!({ "op": name, "args": generated, "as": persona }),
            );
            match response {
                Ok(response) if response.status < 400 => {
                    let trace = response
                        .body
                        .get("trace")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    let read_sites = certificate
                        .read_sites
                        .iter()
                        .map(|site| {
                            let range_calls = trace
                                .get("ranges")
                                .and_then(Json::as_array)
                                .into_iter()
                                .flatten()
                                .filter(|range| range.get("site").and_then(Json::as_str) == Some(site.site.as_str()))
                                .count() as u64;
                            let point_calls = trace
                                .get("points")
                                .and_then(Json::as_array)
                                .into_iter()
                                .flatten()
                                .filter(|point| point.get("site").and_then(Json::as_str) == Some(site.site.as_str()))
                                .count() as u64;
                            json!({
                                "site": site.site,
                                "calls": { "actual": range_calls + point_calls, "ceiling": site.max_calls },
                                "take": site.take,
                            })
                        })
                        .collect::<Vec<_>>();
                    executions.push(json!({
                        "op": name,
                        "as": persona,
                        "examined": {
                            "actual": trace.get("examined").and_then(Json::as_u64).unwrap_or(0),
                            "ceiling": certificate.max_examined,
                        },
                        "ruleProbes": {
                            "actual": trace.get("rule_probes").or_else(|| trace.get("ruleProbes")).and_then(Json::as_u64).unwrap_or(0),
                            "ceiling": certificate.max_rule_probes,
                        },
                        "steps": {
                            "actual": trace.get("steps").and_then(Json::as_u64).unwrap_or(0),
                            "ceiling": certificate.max_steps,
                        },
                        "readSites": read_sites,
                    }));
                }
                Ok(response) => {
                    failures.push(engine_failure(name, persona, response.body));
                }
                Err(error) => {
                    failures.push(
                        json!({ "op": name, "as": persona, "source": "engine", "error": error }),
                    );
                }
            }
        }
    }
    let detail = json!({
        "probes": probes,
        "enforcedBy": "engine",
        "executions": executions,
        "blocked": blocked,
    });
    if !failures.is_empty() {
        CheckReceipt::fail(
            "bounds",
            "derived",
            elapsed_ms(started),
            json!({ "failures": failures, "summary": detail }),
        )
    } else if !blocked.is_empty() {
        CheckReceipt::blocked("bounds", "derived", elapsed_ms(started), detail)
    } else {
        CheckReceipt::pass("bounds", "derived", elapsed_ms(started), detail)
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
        let candidates = match probe_candidates(program, seed) {
            Ok(candidates) => candidates,
            Err(reason) => {
                blocked.push(json!({ "op": name, "reason": reason }));
                continue;
            }
        };
        let mut committed_probe = false;
        for (candidate_index, (persona, args)) in candidates.into_iter().enumerate() {
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
    for (name, kind) in &program.args {
        let value = generated.get(name).cloned().unwrap_or(Json::Null);
        let value = if arg_is_id(kind) && value.as_str().is_some() {
            Value::Id(value.as_str().unwrap_or_default().to_owned())
        } else {
            json_to_value(&value)?
        };
        args.insert(name.clone(), value);
    }
    let is_effect_then = generation
        .effects
        .values()
        .any(|effect| effect.then.as_deref() == Some(program.name.as_str()));
    let mut context = if is_effect_then {
        let mut context = Context::system();
        context.args = args;
        context
    } else {
        let mut context = Context::query(format!("dev:{persona}"), args);
        context.principal_kind = "persona".to_owned();
        context
    };
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

fn generated_args(program: &Program, seed: &SeedData) -> Result<Json, String> {
    generated_args_at(program, seed, 0)
}

fn generated_args_at(program: &Program, seed: &SeedData, sample: usize) -> Result<Json, String> {
    let mut args = Map::new();
    for (name, kind) in &program.args {
        let value = generated_arg(&program.name, name, kind, seed, sample)?;
        args.insert(name.clone(), value);
    }
    Ok(Json::Object(args))
}

fn generated_arg(
    op: &str,
    name: &str,
    kind: &ArgType,
    seed: &SeedData,
    sample: usize,
) -> Result<Json, String> {
    let value = match kind {
        ArgType::Id => seed_id_arg(op, name, named_id_table(name, seed), seed, sample)?,
        ArgType::Ref { table } => seed_id_arg(op, name, Some(table.as_str()), seed, sample)?,
        ArgType::Scalar | ArgType::Json { .. } => scalar_arg(name),
        ArgType::Text { .. } => {
            let candidate = scalar_arg(name);
            candidate
                .as_str()
                .map(|value| json!(value))
                .unwrap_or_else(|| json!("derived test"))
        }
        ArgType::Int | ArgType::Time => json!(1),
        ArgType::Bool => json!(false),
        ArgType::Optional(inner) => return generated_arg(op, name, inner, seed, sample),
        ArgType::List { .. } => json!([]),
        ArgType::Enum { variants } => variants
            .first()
            .cloned()
            .map(Json::String)
            .unwrap_or(Json::Null),
        ArgType::Decimal { .. } | ArgType::Money { .. } => json!(100),
    };
    Ok(value)
}

fn scalar_arg(name: &str) -> Json {
    if name == "result" {
        return json!({ "providerId": "provider-test" });
    }
    if name == "effect" {
        return json!("notify");
    }
    if matches!(name, "body" | "title" | "note" | "label") {
        return json!("derived test");
    }
    if name.starts_with("is") || name == "done" {
        return json!(false);
    }
    json!(1)
}

fn probe_candidates(program: &Program, seed: &SeedData) -> Result<Vec<(String, Json)>, String> {
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
        let args = generated_args_at(program, seed, sample)?;
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
    Ok(candidates)
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
#[path = "test_unit.rs"]
mod unit_tests;

#[cfg(test)]
#[path = "test_derived.rs"]
mod derived_tests;
