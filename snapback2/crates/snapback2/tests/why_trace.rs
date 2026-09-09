mod common;

use common::{OwnerGuard, Project, json_stdout};
use std::fs;

#[test]
fn why_has_per_row_verdicts_and_trace_has_the_emitted_outbox_row() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    let messages = project.path.join("snapback/messages.q");
    let source = fs::read_to_string(&messages).unwrap()
        + r#"

mutation maybeNotify(shouldNotify: bool):
  if shouldNotify:
    emit notify { to: 'nobody@example.com', body: 'conditional' }
  return null
"#;
    fs::write(&messages, source).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());
    let _owner = OwnerGuard::start(&project);
    let skipped = project.run(&[
        "run",
        "messages.maybeNotify",
        r#"{"shouldNotify":false}"#,
        "--as",
        "alice",
        "--json",
    ]);
    assert!(skipped.status.success());
    let skipped_trace = project.run(&["trace", "latest", "--json"]);
    assert!(skipped_trace.status.success());
    assert!(
        json_stdout(&skipped_trace)["outboxRows"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let mutation = project.run(&[
        "run",
        "messages.send",
        r#"{"conversationId":"conversation-1","recipientId":"profile-bob","body":"trace test"}"#,
        "--as",
        "alice",
        "--json",
    ]);
    assert!(mutation.status.success());
    let why = project.run(&[
        "why",
        "messages.thread",
        r#"{"conversationId":"conversation-1","c":null}"#,
        "--as",
        "alice",
        "--json",
    ]);
    assert!(why.status.success());
    let why = json_stdout(&why);
    assert!(
        why["rowVerdicts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["verdict"] == "allow")
    );
    assert!(!why["ruleInputs"].as_array().unwrap().is_empty());

    let trace = project.run(&["trace", "latest", "--json"]);
    assert!(trace.status.success());
    let trace = json_stdout(&trace);
    assert_eq!(trace["commit"]["program"], "messages.send");
    assert_eq!(trace["outboxRows"][0]["effect"], "delivery.notify");
    assert_eq!(trace["outboxRows"][0]["state"], "queued");
}

#[test]
fn why_keeps_rule_admission_separate_from_the_page_cut() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/schema.q"),
        "use identity\n\ntable items:\n  label: text <=20\n  public 'public'\n  insert <- allow\n  update <- allow\n  delete <- allow\n",
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/todos.q"),
        "query list():\n  return items[] first 1 by byId\n",
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/seed.ts"),
        r#"import { seed } from "snapback2";
export default seed({ personas: ["alice"], rows: { items: [
  { id: "item-1", label: "one" },
  { id: "item-2", label: "two" },
  { id: "item-3", label: "three" },
] } });
"#,
    )
    .unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());
    let _owner = OwnerGuard::start(&project);

    let why = project.run(&["why", "todos.list", "--as", "alice", "--json"]);
    assert!(
        why.status.success(),
        "{}",
        String::from_utf8_lossy(&why.stderr)
    );
    let verdicts = json_stdout(&why)["rowVerdicts"].as_array().unwrap().clone();
    assert_eq!(verdicts.len(), 3, "{verdicts:?}");
    assert!(verdicts.iter().all(|row| row["verdict"] == "allow"));
    assert_eq!(
        verdicts.iter().filter(|row| row["cut"] == true).count(),
        2,
        "{verdicts:?}"
    );
}

#[test]
fn trace_marks_pre_restart_commit_ledgers_unavailable() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let committed_seq = {
        let _owner = OwnerGuard::start(&project);
        let mutation = project.run(&[
            "run",
            "todos.add",
            r#"{"title":"before restart"}"#,
            "--as",
            "alice",
            "--json",
        ]);
        assert!(mutation.status.success());
        json_stdout(&mutation)["seq"].as_u64().unwrap()
    };

    let _restarted = OwnerGuard::start(&project);
    let trace = project.run(&["trace", &committed_seq.to_string(), "--json"]);
    assert!(trace.status.success());
    let trace = json_stdout(&trace);
    assert!(
        trace["ledger"]
            .as_str()
            .is_some_and(|value| value.starts_with("unavailable (owner restarted at ")),
        "{trace}"
    );
    assert!(trace.get("invalidated").is_none(), "{trace}");
    assert!(trace.get("deliveries").is_none(), "{trace}");
}

#[test]
fn why_refuses_missing_corrupt_and_incomplete_certificates_as_stale() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let certificate_path = project.path.join(".snapback/build/certificates.json");
    let valid = fs::read(&certificate_path).unwrap();
    let _owner = OwnerGuard::start(&project);

    let corruptions = [
        None,
        Some(b"{not json".to_vec()),
        Some(serde_json::to_vec(&serde_json::json!({})).unwrap()),
        Some({
            let mut stale: serde_json::Value = serde_json::from_slice(&valid).unwrap();
            stale["todos.list"]["plan_hash"] = serde_json::json!("predecessor-plan");
            serde_json::to_vec(&stale).unwrap()
        }),
        Some({
            let mut stale: serde_json::Value = serde_json::from_slice(&valid).unwrap();
            stale["todos.list"]["schema_hash"] = serde_json::json!("unapplied-schema");
            serde_json::to_vec(&stale).unwrap()
        }),
    ];
    for bytes in corruptions {
        match bytes {
            Some(bytes) => fs::write(&certificate_path, bytes).unwrap(),
            None => fs::remove_file(&certificate_path).unwrap(),
        }
        for persona in ["alice", "system"] {
            let why = project.run(&["why", "todos.list", "--as", persona, "--json"]);
            assert_eq!(
                why.status.code(),
                Some(1),
                "{}",
                String::from_utf8_lossy(&why.stdout)
            );
            let refusal = json_stdout(&why);
            assert_eq!(refusal["code"], "E_WHY_STALE", "{refusal}");
            assert!(refusal["rewrite"].as_str().unwrap().contains("snapback2 dev --status --json"), "{refusal}");
        }
        fs::write(&certificate_path, &valid).unwrap();
    }
}

#[test]
fn auth_recipe_executes_scoped_admin_reads_and_diagnoses_owner_only_absence() {
    for scoped_roster in [false, true] {
        let project = Project::new();
        assert!(project.init("chat", "none").status.success());
        let guide = json_stdout(&project.run(&["guide", "auth", "--json"]));
        let content = guide["content"].as_str().unwrap();
        assert!(content.len() <= 4_096);
        assert!(!content.contains("```ts"));
        let snippets = content
            .split("```q\n")
            .skip(1)
            .map(|part| part.split("\n```").next().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(snippets.len(), 4);

        let schema_path = project.path.join("snapback/schema.q");
        let schema = fs::read_to_string(&schema_path).unwrap();
        let rest = schema.split("table conversations:").nth(1).unwrap();
        let mut schema = format!(
            "{}\n\n{}\n\ntable conversations:{}",
            snippets[0], snippets[1], rest
        );
        let membership_start = schema.find("table memberships:").unwrap();
        let membership_end = schema.find("table messages:").unwrap();
        let membership = schema[membership_start..membership_end].to_owned();
        assert!(membership.contains(snippets[2]));
        let read_rule = if scoped_roster {
            snippets[2]
        } else {
            "  read <- .principal = viewer"
        };
        schema.replace_range(
            membership_start..membership_end,
            &membership.replace(snippets[2], read_rule),
        );
        fs::write(&schema_path, schema).unwrap();
        // Compile and execute the shipped promotion snippet, not a copied fixture.
        fs::write(project.path.join("snapback/groups.q"), format!(
            "fn isAdmin from access\n\n{}\n\nquery inspectMembership(membershipId: memberships):\n  return memberships[membershipId]\n", snippets[3]
        )).unwrap();
        // This fixture changes roster visibility; remove unrelated delivery fanout
        // operations that require the template's uniform roster read policy.
        fs::remove_file(project.path.join("snapback/messages.q")).unwrap();
        fs::remove_file(project.path.join("snapback/deliveries.q")).unwrap();
        fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
        let checked = project.run(&["check", "--json"]);
        assert!(
            checked.status.success(),
            "{}{}",
            String::from_utf8_lossy(&checked.stdout),
            String::from_utf8_lossy(&checked.stderr)
        );
        let _owner = OwnerGuard::start(&project);
        let run = |op: &str, args: &str, persona: &str| {
            json_stdout(&project.run(&["run", op, args, "--as", persona, "--json"]))
        };
        let bob_args = r#"{"conversationId":"conversation-1","membershipId":"membership-2"}"#;
        let ordinary = run(
            "groups.inspectMembership",
            r#"{"membershipId":"membership-2"}"#,
            "alice",
        );
        let why = json_stdout(&project.run(&[
            "why",
            "groups.inspectMembership",
            r#"{"membershipId":"membership-2"}"#,
            "--as",
            "alice",
            "--json",
        ]));
        let mutation_why = project.run(&[
            "why",
            "groups.memberPromote",
            bob_args,
            "--as",
            "alice",
            "--json",
        ]);
        assert_eq!(mutation_why.status.code(), Some(1));
        let refusal = json_stdout(&mutation_why);
        assert_eq!(refusal["code"], "E_OP_KIND");
        assert_eq!(refusal["family"], "op");
        assert_eq!(refusal["site"], "groups.memberPromote");
        assert_eq!(refusal["guide"], "auth");
        let after_why = run(
            "groups.inspectMembership",
            r#"{"membershipId":"membership-2"}"#,
            "alice",
        );
        assert_eq!(
            after_why, ordinary,
            "why must not mutate rows or advance commit seq"
        );
        let promoted = run("groups.memberPromote", bob_args, "alice");
        if scoped_roster {
            assert_eq!(ordinary["data"]["principal"], "dev:bob");
            assert!(why["diagnostics"].as_array().unwrap().is_empty());
            assert_eq!(promoted["state"], "committed", "{promoted}");
            let bob = run(
                "groups.inspectMembership",
                r#"{"membershipId":"membership-2"}"#,
                "alice",
            );
            assert_eq!(bob["data"]["role"], "admin");
            let cross_scope = run(
                "groups.memberPromote",
                r#"{"conversationId":"conversation-1","membershipId":"membership-4"}"#,
                "alice",
            );
            assert_eq!(cross_scope["code"], "MEMBERSHIP_SCOPE_REQUIRED");
            let outsider = run("groups.memberPromote", bob_args, "charlie");
            assert_eq!(outsider["code"], "ADMIN_REQUIRED");
        } else {
            let missing = run(
                "groups.inspectMembership",
                r#"{"membershipId":"absent"}"#,
                "alice",
            );
            assert_eq!(
                ordinary, missing,
                "ordinary reads must not reveal hidden-row existence"
            );
            assert_eq!(promoted["code"], "MEMBERSHIP_REQUIRED", "{promoted}");
            let missing = run(
                "groups.memberPromote",
                r#"{"conversationId":"conversation-1","membershipId":"absent"}"#,
                "alice",
            );
            assert_eq!(
                promoted, missing,
                "mutation refusals must not reveal hidden-row existence"
            );
            assert!(promoted.get("diagnostics").is_none());
            let diagnostic = &why["diagnostics"][0];
            assert_eq!(diagnostic["code"], "E_RULE");
            assert_eq!(diagnostic["family"], "rule");
            assert_eq!(diagnostic["guide"], "auth");
            assert_eq!(diagnostic["table"], "memberships");
            assert!(
                diagnostic["site"]
                    .as_str()
                    .is_some_and(|site| !site.is_empty())
            );
            assert!(
                diagnostic["rewrite"]
                    .as_str()
                    .unwrap()
                    .contains("snapback2 guide auth")
            );
            let missing_why = json_stdout(&project.run(&[
                "why",
                "groups.inspectMembership",
                r#"{"membershipId":"absent"}"#,
                "--as",
                "alice",
                "--json",
            ]));
            assert!(missing_why["diagnostics"].as_array().unwrap().is_empty());
            let bob = run(
                "groups.inspectMembership",
                r#"{"membershipId":"membership-2"}"#,
                "bob",
            );
            assert_eq!(
                bob["data"]["role"], "member",
                "failed promotion must not write"
            );
        }
    }
}

fn prose_project() -> Project {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    fs::write(project.path.join("snapback/explain.q"), "fn isMember from access\n\nquery thread(conversationId: conversations):\n  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED\n  return deliveries[viewer, conversationId, 'message'] last 50 by byRecipientConversationKindAt\n").unwrap();
    assert!(project.run(&["check", "--json"]).status.success());
    project
}

#[test]
fn why_prose_explains_denied_chat_guard_at_its_call_site() {
    let project = prose_project();
    let _owner = OwnerGuard::start(&project);
    let why = project.run(&[
        "why",
        "explain.thread",
        r#"{"conversationId":"conversation-1"}"#,
        "--as",
        "charlie",
    ]);
    assert!(
        why.status.success(),
        "{}",
        String::from_utf8_lossy(&why.stderr)
    );
    assert_eq!(
        String::from_utf8(why.stdout.clone()).unwrap(),
        concat!(
            "explain.thread as charlie — denied (MEMBERSHIP_REQUIRED)\n",
            "  explain.q:4   require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED\n",
            "    memberships[conversation-1, dev:charlie]   absent   (byConversationPrincipal)\n",
        )
    );
    // A failed edit must not replace the source snapshot attached to the active certificate.
    fs::write(
        project.path.join("snapback/explain.q"),
        "this is not a valid module\n",
    )
    .unwrap();
    assert!(!project.run(&["check", "--json"]).status.success());
    let still_active = project.run(&[
        "why",
        "explain.thread",
        r#"{"conversationId":"conversation-1"}"#,
        "--as",
        "charlie",
    ]);
    assert!(still_active.status.success());
    assert_eq!(still_active.stdout, why.stdout);
}

#[test]
fn why_prose_explains_admitted_chat_reads_bounds_rules_and_subscriptions() {
    let project = prose_project();
    let _owner = OwnerGuard::start(&project);
    let why = project.run(&[
        "why",
        "explain.thread",
        r#"{"conversationId":"conversation-1"}"#,
        "--as",
        "alice",
    ]);
    assert!(
        why.status.success(),
        "{}",
        String::from_utf8_lossy(&why.stderr)
    );
    assert_eq!(
        String::from_utf8(why.stdout).unwrap(),
        concat!(
            "explain.thread as alice — complete\n",
            "  explain.q:4   require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED\n",
            "    memberships[conversation-1, dev:alice]   1 row examined, 1 visible\n",
            "    point by byConversationPrincipal — complete\n",
            "    admitted by: read <- exists memberships[.conversationId, viewer]\n",
            "  explain.q:5   return deliveries[viewer, conversationId, 'message'] last 50 by byRecipientConversationKindAt\n",
            "    deliveries[dev:alice, conversation-1, message]   1 row examined, 1 visible\n",
            "    last 50 by byRecipientConversationKindAt — complete\n",
            "    admitted by: read <- .recipient = viewer\n",
            "  subscriptions:\n",
            "    memberships byConversationPrincipal [conversation-1, dev:alice]\n",
            "    deliveries byRecipientConversationKindAt [dev:alice, conversation-1, message]\n",
        )
    );
}


#[test]
fn why_keeps_failed_assertions_locals_and_ambiguous_branches_honest() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(project.path.join("snapback/explain.q"), r#"query assertion(id: todos):
  require true else MISSING
  return todos[id] ! else MISSING
query local(id: todos):
  p = todos[id]
  require p != null else MISSING
  return p
query branches(id: todos, flag: bool):
  if flag:
    require true else MISSING
  else:
    require exists todos[id] else MISSING
  return null
query nested(id: todos):
  require (todos[id] ! else MISSING).title != '' else MISSING
  return null
query assertionOnly(id: todos):
  return todos[id] ! else MISSING
"#).unwrap();
    let seed = project.path.join("snapback/seed.ts");
    fs::write(&seed, fs::read_to_string(&seed).unwrap().replace("ownerId: \"dev:alice\"", "ownerId: \"dev:bob\"" )).unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(checked.status.success(), "{}", String::from_utf8_lossy(&checked.stdout));
    let _owner = OwnerGuard::start(&project);
    let mut failures = Vec::new();
    for op in ["assertion", "local", "branches", "nested", "assertionOnly"] {
        for id in ["missing", "todo-1"] {
            let args = format!(r#"{{"id":"{id}"{}}}"#, if op == "branches" { r#", "flag":false"# } else { "" });
            let output = project.run(&["why", &format!("explain.{op}"), &args, "--as", "alice"]);
            let text = String::from_utf8(output.stdout).unwrap();
            let visibility = if id == "missing" { "absent" } else { "hidden" };
            if !output.status.success() || !text.contains("denied (MISSING)")
                || text.contains("require true") || !text.contains(&format!("todos[{id}]   {visibility}"))
                || (matches!(op, "assertion" | "branches" | "nested") && !text.contains("ambiguous"))
                || (matches!(op, "local" | "assertionOnly") && text.contains("ambiguous"))
                || (op == "local" && !text.contains("explain.q:6   require p != null else MISSING"))
                || (op == "assertionOnly" && !text.contains("explain.q:18   return todos[id] ! else MISSING")) {
                failures.push(text);
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn operation_typos_offer_declared_names_in_run_and_why() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    assert!(project.run(&["check", "--json"]).status.success());
    let _owner = OwnerGuard::start(&project);
    let mut failures = Vec::new();
    for verb in ["run", "why"] {
        for persona in ["alice", "system"] {
            for (op, expected) in [("todos.lits", "did you mean `todos.list`?"), ("TODOS.LIST", "did you mean `todos.list`?"), ("unrelated", "todos.list")] {
                let output = project.run(&[verb, op, "--as", persona, "--json"]);
                let refusal = json_stdout(&output);
                if output.status.success() || refusal["code"] != "E_OP_UNKNOWN"
                    || !refusal["rewrite"].as_str().unwrap_or_default().contains(expected) {
                    failures.push(format!("{verb} {op} as {persona}: {refusal}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}


#[test]
fn why_prose_includes_real_capped_reads_absences_and_constraint_dependencies() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(project.path.join("snapback/schema.q"), "use identity\ntable items:\n  ownerId: principal\n  group: principal\n  label: text <=20\n  read <- .ownerId = viewer\nmaintain itemCounts = count items by group:\n  read <- allow\n").unwrap();
    fs::write(project.path.join("snapback/todos.q"), "query list():\n  return { page: items[] first 2 by byId, total: #itemCounts[viewer] }\n").unwrap();
    fs::write(project.path.join("snapback/seed.ts"), r#"import { seed } from "snapback2";
export default seed({ personas: ["alice"], rows: { items: [
  { id: "1", ownerId: "dev:bob", group: "dev:bob", label: "hidden" },
  { id: "2", ownerId: "dev:alice", group: "dev:bob", label: "visible" },
  { id: "3", ownerId: "dev:alice", group: "dev:bob", label: "cut" },
], itemCounts: [] } });"#).unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(checked.status.success(), "{}", String::from_utf8_lossy(&checked.stdout));
    let _owner = OwnerGuard::start(&project);
    let json = json_stdout(&project.run(&["why", "todos.list", "--as", "alice", "--json"]));
    let trace = &json["authoritativeTrace"];
    let range = &trace["ranges"][0];
    assert_eq!(range["stop"], "Limit", "{json}");
    assert_eq!(range["examined_ids"].as_array().unwrap().len(), 3);
    assert_eq!(range["visible_ids"].as_array().unwrap().len(), 2);
    assert!(!trace["absences"].as_array().unwrap().is_empty(), "{json}");
    assert!(!trace["constraint_inputs"].as_array().unwrap().is_empty(), "{json}");
    let printed = project.run(&["why", "todos.list", "--as", "alice"]);
    assert!(printed.status.success());
    let text = String::from_utf8(printed.stdout).unwrap();
    assert!(text.contains("3 rows examined, 2 visible"), "{text}");
    assert!(text.contains("first 2 by byId — capped"), "{text}");
    assert!(text.contains("itemCounts byGroup [dev:alice]"), "{text}");
    assert!(text.contains("itemCounts byId ["), "{text}");
    assert!(text.contains("itemCounts (whole table; constraint input)"), "{text}");
    let cache = project.path.join(".snapback/build/certificates.json");
    let mut certificates: serde_json::Value = serde_json::from_slice(&fs::read(&cache).unwrap()).unwrap();
    certificates["todos.list"].as_object_mut().unwrap().remove("sources");
    fs::write(&cache, serde_json::to_vec(&certificates).unwrap()).unwrap();
    let fallback = project.run(&["why", "todos.list", "--as", "alice"]);
    let fallback = String::from_utf8(fallback.stdout).unwrap();
    assert!(fallback.contains(range["site"].as_str().unwrap()), "{fallback}");
    assert!(fallback.contains("3 rows examined, 2 visible"), "{fallback}");
    assert!(fallback.contains("itemCounts (whole table; constraint input)"), "{fallback}");
}

#[test]
fn why_does_not_quote_a_valid_but_unapplied_schema() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let schema_path = project.path.join("snapback/schema.q");
    let original = fs::read_to_string(&schema_path).unwrap();
    fs::write(&schema_path, original.replace("table todos:", "table todos:\n  legacy: text <=10 ?")).unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(checked.status.success(), "{}", String::from_utf8_lossy(&checked.stdout));
    let _owner = OwnerGuard::start(&project);
    // Removing the unused legacy column makes this valid rule edit destructive.
    fs::write(&schema_path, original.replace("read <- .ownerId = viewer", "read <- deny")).unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(checked.status.success(), "{}", String::from_utf8_lossy(&checked.stdout));
    let why = project.run(&["why", "todos.list", "--as", "alice", "--json"]);
    assert!(!why.status.success(), "{}", String::from_utf8_lossy(&why.stdout));
    let refusal = json_stdout(&why);
    assert_eq!(refusal["code"], "E_WHY_STALE");
    let rewrite = refusal["rewrite"].as_str().unwrap();
    assert!(rewrite.contains("snapback2 dev --status --json") && rewrite.contains("refused")
        && rewrite.contains("applyCommand") && rewrite.contains("revert"), "{refusal}");
    // Follow the revert recovery: restore the accepted schema, then refresh the cache.
    fs::write(&schema_path, original.replace("table todos:", "table todos:\n  legacy: text <=10 ?")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());
    let recovered = project.run(&["why", "todos.list", "--as", "alice"]);
    assert!(recovered.status.success(), "{}", String::from_utf8_lossy(&recovered.stdout));
    let text = String::from_utf8(recovered.stdout).unwrap();
    assert!(text.contains("admitted by: read <- .ownerId = viewer"), "{text}");
    assert!(!text.contains("read <- deny"), "{text}");
}
