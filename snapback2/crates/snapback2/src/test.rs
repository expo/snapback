//! Boot-run-exit verification against a fresh owner and isolated store.
// @ref LLP 1002#7-test-and-the-receipt — derived probes and journeys share one receipt-backed owner.

use self::test_bounds::engine_failure;
use self::test_invalidation::{replay_arg_value, specialize_probe_args, unwrap_optional};
use self::test_seed_ids::{named_id_table, seed_id_arg};
use crate::client;
use crate::owner::{self, OwnerInfo};
use crate::project::{self, CompiledProject, CompilerWorker, SeedData, locate_root};
use crate::protocol::Refusal;
use crate::receipt::{CheckReceipt, TestReceipt};
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use snapback2_core::{
    Actor, ArgType, Context, ExecutionState, Generation, Program, ProgramKind, Runtime, Store,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitCode, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[path = "test_authority.rs"]
mod test_authority;
#[path = "test_bounds.rs"]
mod test_bounds;
#[path = "test_invalidation.rs"]
mod test_invalidation;
#[path = "test_policy.rs"]
mod test_policy;
#[path = "test_seed_ids.rs"]
mod test_seed_ids;
#[path = "test_sse.rs"]
mod test_sse;

use self::test_policy::check_rules;
#[cfg(test)]
use self::test_policy::rule_id_sets_match;

pub(crate) const VALUE_FLAGS: &[&str] = &["--blocked", "--project", "--journey"];

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
        VALUE_FLAGS,
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
    let selected_journey = options.value("--journey");
    if selected_journey.is_some_and(|name| name.trim().is_empty())
        || (selected_journey.is_some()
            && (options.has("--derived-only") || options.value("--blocked").is_some()))
    {
        return usage();
    }
    let finish_selected = |root: &Path, stamp, mut receipt: TestReceipt, json_output| {
        receipt.scope.journey = selected_journey.map(str::to_owned);
        finish(root, stamp, receipt, json_output)
    };
    if let Some(reason) = options.value("--blocked") {
        let receipt = TestReceipt::explicitly_blocked(reason);
        return finish_selected(&root, stamp, receipt, json_output);
    }
    let journeys_only = options.has("--journeys-only") || selected_journey.is_some();
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
                return finish_selected(
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
            return finish_selected(
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
            json!({ "operations": compiled.generation.programs().len() }),
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
            return finish_selected(
                &root,
                stamp,
                TestReceipt::new(
                    compiled.generation.hash(),
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
        if let Some(name) = selected_journey {
            format!("snapback2 test --journey='{}'", name.replace('\'', "'\\''"))
        } else if journeys_only {
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
        checks.push(test_invalidation::check(&isolated.info, &compiled, &seed));
        checks.push(check_replay(&isolated.info, &compiled, &seed));
        checks.extend(test_authority::checks(&isolated.info, &compiled, &seed));
        if let Some(effects) = check_effects(&isolated.info, &compiled) {
            checks.push(effects);
        }
    }
    if !derived_only {
        checks.extend(run_journeys(
            &isolated.info.project,
            &isolated.info,
            selected_journey,
        ));
    }
    let mut receipt = TestReceipt::new(compiled.generation.hash(), commands, checks);
    if !compiled.generation.schema().schedules.is_empty() {
        let status = client::control(&isolated.info, "GET", "/control/status", json!({}))
            .ok()
            .filter(|response| response.status < 400)
            .map(|response| response.body);
        attach_schedule_receipt(&mut receipt, status);
    }
    isolated.stop();
    finish_selected(&root, stamp, receipt, json_output)
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
        Self::start_with(
            root,
            stamp,
            link_store,
            || std::env::current_exe().map_err(test_io),
            |executable, project| {
                Command::new(executable)
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
                    .map_err(test_io)
            },
        )
    }

    fn start_with(
        root: &Path,
        stamp: u128,
        link: impl FnOnce(&Path, &Path) -> Result<(), Refusal>,
        executable: impl FnOnce() -> Result<PathBuf, Refusal>,
        spawn: impl FnOnce(&Path, &Path) -> Result<Child, Refusal>,
    ) -> Result<Self, Refusal> {
        let scratch = root.join(format!(".snapback/test-run-{stamp}"));
        let store = root.join(format!(".snapback/test-{stamp}.sqlite"));
        // Cleanup owns both paths before the first fallible mutation. The child
        // is attached later, if spawn succeeds.
        let mut cleanup = OwnerCleanup {
            child: None,
            scratch,
            store,
        };
        let project = cleanup.scratch.join("project");
        copy_tree(&root.join("snapback"), &project.join("snapback"))?;
        fs::create_dir_all(project.join(".snapback")).map_err(test_io)?;
        let build = root.join(".snapback/build");
        if build.is_dir() {
            copy_tree(&build, &project.join(".snapback/build"))?;
        }
        let owner_store = project.join(".snapback/store.sqlite");
        link(&cleanup.store, &owner_store)?;
        let executable = executable()?;
        cleanup.child = Some(spawn(&executable, &project)?);
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
        // A child may print a structured startup refusal instead of ready.
        // Preserve its diagnostic before trying to read the absent owner file.
        if let Ok(refusal) = serde_json::from_str::<Refusal>(&line) {
            return Err(refusal);
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
    for (name, (program, certificate)) in compiled.generation.programs() {
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
    let mut skipped = Vec::new();
    let mut probes = 0_u64;
    let mut attempts = 0_u64;
    let mut forks_count = 0_u64;
    // Replay executes only on forks; the owner remains the same seeded
    // snapshot for every candidate, so reseeding it per fork adds no evidence.
    match client::control(owner, "POST", "/control/reset", json!({})) {
        Ok(response) if response.status < 400 => {}
        response => {
            return CheckReceipt::fail(
                "replay",
                "derived",
                elapsed_ms(started),
                json!({ "error": format!("replay seed reset failed: {response:?}") }),
            );
        }
    }
    for (index, (name, (program, _))) in compiled.generation.programs().iter().enumerate() {
        if program.kind != ProgramKind::Mutation {
            continue;
        }
        if compiled
            .generation
            .effects()
            .values()
            .any(|effect| effect.then.as_deref() == Some(name.as_str()))
        {
            continue;
        }
        if program_has_asset_arguments(program) {
            skipped.push(asset_probe_skip(name));
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
        "skipped": skipped,
        "candidateLimit": 12,
        "candidateSelection": "first two seed scopes and first six personas; exhaustion blocks",
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
        let value = replay_arg_value(kind, &value)?;
        args.insert(name.clone(), value);
    }
    let mut context = Context::query(Actor::persona(persona).expect("derived persona"), args);
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
    if compiled.generation.effects().is_empty() {
        None
    } else if engine == "none" {
        Some(CheckReceipt::blocked(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({ "reason": "no engine in this build", "declarations": compiled.generation.effects().keys().collect::<Vec<_>>() }),
        ))
    } else {
        Some(CheckReceipt::pass(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({ "engine": engine, "declarations": compiled.generation.effects().keys().collect::<Vec<_>>() }),
        ))
    }
}

fn run_journeys(root: &Path, owner: &OwnerInfo, selected: Option<&str>) -> Vec<CheckReceipt> {
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
    if files.is_empty() && selected.is_none() {
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
    let mut checks = Vec::new();
    let mut available = Vec::new();
    let mut matched = false;
    for file in files {
        let mut list = journey_command(&runner, owner);
        list.arg("--list");
        if selected.is_some() {
            list.arg("--identify");
        }
        list.arg("--").arg(&file);
        let listed = match supervise_journey_runner(list) {
            Ok(output) => output,
            Err(error) => {
                checks.push(CheckReceipt::fail(
                    "journey runner",
                    "journey",
                    0,
                    json!({ "error": error.to_string() }),
                ));
                continue;
            }
        };
        if let Some(name) = listed.timeout_name.as_deref() {
            checks.push(journey_host_failure(
                name,
                &listed,
                "host deadline exceeded while loading journeys",
            ));
            continue;
        }
        let discovery = listed
            .lines
            .iter()
            .filter_map(|line| serde_json::from_str::<Json>(line).ok())
            .find(|value| value.get("runner").and_then(Json::as_str) == Some("list"))
            .unwrap_or(Json::Null);
        let names = discovery
            .get("journeys")
            .and_then(Json::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|name| name.as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        if listed.capped || names.is_empty() {
            let parsed = journey_receipts(&listed);
            if parsed.is_empty() {
                checks.push(journey_host_failure(
                    "journey runner",
                    &listed,
                    if listed.capped {
                        "runner output exceeded its cap"
                    } else {
                        "runner listed zero journeys"
                    },
                ));
            } else {
                checks.extend(parsed);
            }
            continue;
        }
        if listed.failed_exit() {
            checks.push(journey_host_failure(
                "journey runner",
                &listed,
                "journey discovery exited unsuccessfully",
            ));
            continue;
        }
        available.extend(names.iter().cloned());
        // @ref LLP 1002#7-test-and-the-receipt — focused receipts bind discovery to execution, including duplicate registrations.
        let identity = discovery.get("registrationId").and_then(Json::as_str);
        if selected.is_some() && identity.is_none() {
            checks.push(journey_host_failure(
                "journey runner",
                &listed,
                "journey discovery omitted registration identity",
            ));
            continue;
        }
        let expected_identity = selected.and(identity);
        for (index, name) in names.into_iter().enumerate() {
            if selected.is_some_and(|selected| selected != name) {
                continue;
            }
            matched = true;
            let mut command = journey_command(&runner, owner);
            command.arg("--journey-index").arg(index.to_string());
            if let Some(expected) = expected_identity {
                command.arg("--expected-journeys").arg(expected);
            }
            command.arg("--").arg(&file);
            let output = match supervise_journey_runner(command) {
                Ok(output) => output,
                Err(error) => {
                    checks.push(CheckReceipt::fail(
                        &name,
                        "journey",
                        0,
                        json!({ "error": error.to_string() }),
                    ));
                    continue;
                }
            };
            if output.timeout_name.is_some() {
                checks.push(journey_host_failure(
                    &name,
                    &output,
                    "journey exceeded the 5000 ms host deadline",
                ));
                continue;
            }
            let parsed = journey_receipts(&output);
            if output.capped || parsed.is_empty() {
                checks.push(journey_host_failure(
                    &name,
                    &output,
                    if output.capped {
                        "runner output exceeded its cap"
                    } else {
                        "runner produced no journey receipt"
                    },
                ));
            } else {
                let reported_failure = parsed
                    .iter()
                    .any(|check| matches!(check.verdict.as_str(), "fail" | "blocked"));
                checks.extend(parsed);
                if output.failed_exit() && !reported_failure {
                    checks.push(journey_host_failure(
                        &name,
                        &output,
                        "journey runner exited unsuccessfully after its receipt",
                    ));
                }
            }
        }
    }
    if let Some(requested) = selected
        && !matched
    {
        checks.push(CheckReceipt::fail(
            "journey selection",
            "journey",
            0,
            json!({ "requested": requested, "available": available,
                "error": "no journey has this exact name",
                "rewrite": "use a listed journey name, or run snapback2 test for the full suite" }),
        ));
    }
    checks
}

const JOURNEY_DEADLINE: Duration = Duration::from_secs(5);
const JOURNEY_EXIT_GRACE: Duration = Duration::from_millis(250);
const JOURNEY_OUTPUT_LIMIT: usize = 256 * 1024;

struct JourneyRunnerOutput {
    status: Option<i32>,
    lines: Vec<String>,
    stderr: String,
    timeout_name: Option<String>,
    capped: bool,
    grace_terminated: bool,
}

impl JourneyRunnerOutput {
    fn failed_exit(&self) -> bool {
        // A natural nonzero exit still fails if it races grace cleanup.
        self.status.map_or(!self.grace_terminated, |code| code != 0)
    }
}

fn journey_command(runner: &Path, owner: &OwnerInfo) -> Command {
    let mut command = Command::new("node");
    command
        .arg(runner)
        .arg("--url")
        .arg(&owner.url)
        .arg("--secret")
        .arg(&owner.secret)
        .arg("--store-root")
        .arg(
            owner
                .project
                .join(".snapback")
                .join(format!("test-{}", owner.started_at)),
        );
    command
}

fn supervise_journey_runner(mut command: Command) -> Result<JourneyRunnerOutput, std::io::Error> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("piped journey stdout");
    let stderr = child.stderr.take().expect("piped journey stderr");
    let (send, receive) = mpsc::channel();
    let stdout_thread = thread::spawn(move || {
        let mut reader = BufReader::new(stdout.take((JOURNEY_OUTPUT_LIMIT + 1) as u64));
        let mut total = 0_usize;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(bytes) => {
                    total = total.saturating_add(bytes);
                    if total > JOURNEY_OUTPUT_LIMIT {
                        let _ = send.send(None);
                        break;
                    }
                    let _ = send.send(Some(line));
                }
                Err(_) => break,
            }
        }
    });
    let stderr_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr
            .take((JOURNEY_OUTPUT_LIMIT + 1) as u64)
            .read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes[..bytes.len().min(JOURNEY_OUTPUT_LIMIT)]).into_owned()
    });

    let mut deadline = Instant::now() + JOURNEY_DEADLINE;
    let mut current = None;
    let mut completed = false;
    let mut lines = Vec::new();
    let mut capped = false;
    let mut timeout_name = None;
    let mut grace_terminated = false;
    let status = loop {
        if let Some(exit) = child.try_wait()? {
            while let Ok(event) = receive.try_recv() {
                match event {
                    Some(line) => lines.push(line),
                    None => capped = true,
                }
            }
            break exit.code();
        }
        let now = Instant::now();
        if now >= deadline {
            grace_terminated = completed;
            terminate_journey_runner(&mut child);
            if !completed {
                timeout_name = Some(current.unwrap_or_else(|| "journey runner".to_owned()));
            }
            break child.wait().ok().and_then(|exit| exit.code());
        }
        let wait = deadline
            .saturating_duration_since(now)
            .min(Duration::from_millis(25));
        match receive.recv_timeout(wait) {
            Ok(Some(line)) => {
                if let Ok(event) = serde_json::from_str::<Json>(&line) {
                    if event.get("runner").and_then(Json::as_str) == Some("start") {
                        current = event
                            .get("name")
                            .and_then(Json::as_str)
                            .map(ToOwned::to_owned);
                        deadline = Instant::now() + JOURNEY_DEADLINE;
                    } else if event.get("verdict").and_then(Json::as_str).is_some() {
                        completed = true;
                        deadline = Instant::now() + JOURNEY_EXIT_GRACE;
                    }
                }
                lines.push(line);
            }
            Ok(None) => {
                capped = true;
                terminate_journey_runner(&mut child);
                break child.wait().ok().and_then(|exit| exit.code());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
    };
    let _ = stdout_thread.join();
    let stderr = stderr_thread.join().unwrap_or_default();
    while let Ok(event) = receive.try_recv() {
        match event {
            Some(line) => lines.push(line),
            None => capped = true,
        }
    }
    Ok(JourneyRunnerOutput {
        status,
        lines,
        stderr,
        timeout_name,
        capped,
        grace_terminated,
    })
}

fn terminate_journey_runner(child: &mut Child) {
    #[cfg(unix)]
    if unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) } != 0 {
        let _ = child.kill();
    }
    #[cfg(not(unix))]
    let _ = child.kill();
}

fn journey_receipts(output: &JourneyRunnerOutput) -> Vec<CheckReceipt> {
    output
        .lines
        .iter()
        .filter_map(|line| serde_json::from_str::<CheckReceipt>(line).ok())
        .collect()
}

fn journey_host_failure(name: &str, output: &JourneyRunnerOutput, message: &str) -> CheckReceipt {
    CheckReceipt::fail(
        name,
        "journey",
        0,
        json!({
            "error": message,
            "status": output.status,
            "stdout": output.lines.join(""),
            "stderr": output.stderr,
        }),
    )
}

fn generated_args(program: &Program, seed: &SeedData) -> Result<Json, String> {
    generated_args_at(program, seed, 0)
}

const ASSET_PROBE_SKIP_CODE: &str = "E_ASSET_PROBE_NEEDS_UPLOAD";
const ASSET_PROBE_SKIP_NOTE: &str =
    "asset-typed arguments are proven by an upload journey, not the generic prover";

fn program_has_asset_arguments(program: &Program) -> bool {
    program.args.values().any(arg_type_has_asset)
}

fn arg_type_has_asset(kind: &ArgType) -> bool {
    match kind {
        ArgType::Image { .. } | ArgType::Video { .. } => true,
        ArgType::Optional(inner) => arg_type_has_asset(inner),
        ArgType::List {
            of: Some(inner), ..
        } => arg_type_has_asset(inner),
        _ => false,
    }
}

fn asset_probe_skip(op: &str) -> Json {
    json!({
        "op": op,
        "reason": ASSET_PROBE_SKIP_CODE,
        "note": ASSET_PROBE_SKIP_NOTE,
    })
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
        ArgType::Cursor => Json::Null,
        ArgType::Id => seed_id_arg(op, name, named_id_table(name, seed), seed, sample)?,
        ArgType::Principal => json!(format!(
            "dev:{}",
            seed.personas.first().map_or("alice", String::as_str)
        )),
        ArgType::Ref { table } => seed_id_arg(op, name, Some(table.as_str()), seed, sample)?,
        ArgType::Scalar | ArgType::Json { .. } => scalar_arg(name),
        ArgType::Text { .. } => match name {
            "handle" => json!("derived_handle"),
            "avatarUrl" => json!("https://example.com/derived-avatar.png"),
            "link" => json!("https://example.com/derived"),
            _ => {
                let candidate = scalar_arg(name);
                candidate
                    .as_str()
                    .map(|value| json!(value))
                    .unwrap_or_else(|| json!("derived test"))
            }
        },
        ArgType::Bytes { .. } => json!({ "Bytes": "00" }),
        ArgType::Image { .. } => json!({
            "id": "s2id-00000000000000000000000000000001-0000000000000001",
            "width": 1,
            "height": 1,
        }),
        ArgType::Video { .. } => json!({
            "id": "s2id-00000000000000000000000000000001-0000000000000002",
            "width": 1,
            "height": 1,
            "duration": 1,
        }),
        ArgType::Int | ArgType::Time => json!(1),
        ArgType::Bool => json!(false),
        ArgType::Optional(inner) => return generated_arg(op, name, inner, seed, sample),
        ArgType::List { of: Some(of), .. } if matches!(unwrap_optional(of), ArgType::Principal) => {
            json!([format!(
                "dev:{}",
                seed.personas.first().map_or("alice", String::as_str)
            )])
        }
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
        seed.personas.iter().take(6).cloned().collect()
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
    for sample in 0..samples.min(2) {
        let args = generated_args_at(program, seed, sample)?;
        for persona in &personas {
            let mut args = args.clone();
            specialize_probe_args(program, seed, sample, persona, &mut args)?;
            let identity = format!(
                "{persona}:{}",
                serde_json::to_string(&args).unwrap_or_default()
            );
            if seen.insert(identity) {
                candidates.push((persona.clone(), args));
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
        "usage: snapback2 test [--blocked reason] [--journeys-only|--derived-only|--journey name] [--json]"
    );
    ExitCode::from(2)
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — a project that
// declares a schedule owes the receipt its `{ fired, late, rejected }`; an owner that cannot
// report them fails the receipt closed rather than shipping a receipt with no schedule line.
fn attach_schedule_receipt(receipt: &mut TestReceipt, status: Option<Json>) {
    match status {
        Some(status) if status.get("schedules").is_some_and(Json::is_object) => {
            receipt.schedules = Some(status["schedules"].clone());
        }
        _ => {
            receipt.verdict = "fail".into();
            receipt.checks.push(CheckReceipt::fail(
                "schedule receipt",
                "schedule",
                0,
                json!({"message":"owner schedule counts unavailable"}),
            ));
        }
    }
}

#[cfg(test)]
#[path = "test_unit.rs"]
mod unit_tests;

#[cfg(test)]
#[path = "test_derived.rs"]
mod derived_tests;
