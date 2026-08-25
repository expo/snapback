#[cfg(not(feature = "cli-owner"))]
use super::AuthConstructionFailure;
#[cfg(not(feature = "cli-owner"))]
use super::mint_secret_read_via_http;
use super::{
    AdminArgs, AdminCommand, AdminLinkReadyFile, Args, AssetsCommand, AuthCommand,
    AuthCoordinatorReadinessReceipt, AuthPasswordCommand, AuthProgramConstructionReceipts,
    AuthRecoveryCommand, AuthorityCommand, BEFORE_STARTUP_TARGET_RESERVATION, Cli, ConfigCommand,
    ConnectionsCommand, ConsoleClaimMintCliResponse, ConsoleCredentialCliResponse, ControlsCommand,
    CronCommand, DataCommand, DataPatchArgs, DebugCommand, EphemeralCommand, ErrorsCommand,
    ForkCommand, GUIDE_SEARCH_SCHEMA_VERSION, HostCommand, JobsCommand, ManagedPath,
    NetworkProfileCommand, ReadyFileTarget, ResolvedHttpTarget, SessionCommand, StoreCommand,
    TargetArgs, TelemetryCommand, automatic_reap_before_create, bind_first_available,
    bind_listener, console_claim_fragment_url, console_fragment_url, console_launch_handoff_with,
    controls_list_text, fork_secret_disposition, managed_startup_paths, parse_fork_ttl,
    parse_network_profile_selection, parse_port_range, parse_run_args, path_segment_escape,
    prepare_database_path, prepare_database_path_for_startup, quiet_stop_fork,
    reject_misdirected_serve_flags, render_guide_command, resolve_http_target,
    resolve_http_target_for_operation, resolve_startup_nonce, runtime_auth_program_readiness,
    search_guide_sections_in, validate_path_disjointness, validated_console_origin,
    validated_secret_read_root_path, write_ready_file_atomic, write_ready_file_atomic_protected,
};
use crate::guide::EmbeddedGuideFile;
use crate::instance_lock::TargetInstanceReservation;
#[cfg(not(feature = "cli-owner"))]
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;
use crate::store_state::path_with_filename_suffix;
use clap::{CommandFactory, Parser};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::net::TcpListener;

#[test]
fn authority_projection_plan_and_guarded_backfill_parse_as_one_surface() {
    let parsed = Cli::try_parse_from([
        "snapback",
        "authority",
        "plan",
        "--db",
        "app.sqlite",
        "--schema",
        "schema.manifest.json",
        "--profile",
        "eventMembers",
        "--mirror-table",
        "conversationMembers",
        "--json",
    ])
    .expect("authority plan parses");
    let Some(HostCommand::Authority { command }) = parsed.command else {
        panic!("expected authority command");
    };
    let AuthorityCommand::Plan {
        profile,
        mirror_table,
        json,
        ..
    } = command
    else {
        panic!("expected authority plan");
    };
    assert_eq!(profile, "eventMembers");
    assert_eq!(mirror_table, "conversationMembers");
    assert!(json);

    let refusal = super::authority_command(AuthorityCommand::Backfill {
        db: PathBuf::from("app.sqlite"),
        profile: "eventMembers".to_owned(),
        apply: true,
        confirm: None,
    })
    .expect_err("backfill requires the exact partial-coverage acknowledgement");
    assert!(
        refusal
            .to_string()
            .contains("authority backfill requires --apply --confirm authorization-facts-only")
    );
}

#[test]
fn settled_pin_repair_names_whole_store_preservation_and_guarded_reset() {
    let database = PathBuf::from("/tmp/example/.snapback/dev.sqlite3");
    let error = crate::diagnostic::SnapbackError::error(
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
        "auth-mode",
        "startup artifacts do not match the settled deployment",
    )
    .with_details(json!({
        "expectedDeployment": { "bundleHash": "old" },
        "observedDeployment": { "bundleHash": "new" },
    }));

    let repaired = super::with_settled_pin_repair(error, &database);
    let reseed = repaired.diagnostic.details["repair"]["reseedFresh"]
        .as_str()
        .unwrap();
    assert!(reseed.contains("snapback store export --db '/tmp/example/.snapback/dev.sqlite3'"));
    assert!(
        reseed.contains("snapback reset --dev-fresh --db '/tmp/example/.snapback/dev.sqlite3'")
    );
    assert!(reseed.contains("discard the managed whole store"));
    assert!(reseed.contains("preserve the complete durable-state set"));
    assert!(reseed.contains(super::DEV_FRESH_RESET_ARTIFACTS));
    assert!(reseed.contains("custody keyrings/configuration and asset blobs"));
    assert!(reseed.contains("refusing custom, shared, or symlink-ambiguous paths"));
    assert!(!reseed.contains("move or delete the database file"));
    let safety = repaired.diagnostic.details["repair"]["safety"]
        .as_str()
        .unwrap();
    assert!(safety.contains("deployment identity stored in the selected database"));
    assert!(safety.contains("not from keyrings participating in this comparison"));
}

#[test]
fn fresh_admin_token_is_visible_only_on_interactive_stdout() {
    let minted = crate::admin::ResolvedAdminToken {
        token: "sbat_secret_that_must_not_reach_logs".to_owned(),
        minted: true,
        fresh: true,
        file: Some(PathBuf::from("/tmp/snapback.sqlite3.admin-token")),
    };

    let interactive = super::minted_admin_token_handoff_lines(&minted, true).join("\n");
    assert!(interactive.contains(&minted.token), "{interactive}");
    assert!(interactive.contains("admin token file:"), "{interactive}");

    let captured = super::minted_admin_token_handoff_lines(&minted, false).join("\n");
    assert!(!captured.contains(&minted.token), "{captured}");
    assert!(
        captured.contains("suppressed on non-TTY stdout"),
        "{captured}"
    );
    assert!(
        captured.contains("owner-only token file below"),
        "{captured}"
    );
    assert!(captured.contains("admin token file:"), "{captured}");
}

#[test]
fn captured_memory_only_admin_token_names_safe_recovery() {
    let minted = crate::admin::ResolvedAdminToken {
        token: "sbat_memory_only_secret".to_owned(),
        minted: true,
        fresh: true,
        file: None,
    };

    let captured = super::minted_admin_token_handoff_lines(&minted, false).join("\n");
    assert!(!captured.contains(&minted.token), "{captured}");
    assert!(captured.contains("restart from a TTY"), "{captured}");
    assert!(captured.contains("SNAPBACK_ADMIN_TOKEN"), "{captured}");
}

#[test]
fn packaged_store_receipt_cli_parses_and_dates_manifest_fields() {
    let cli = Cli::parse_from([
        "snapback",
        "packaged-store-qualification-receipt",
        "--closure-manifest",
        "closure.json",
        "--suite-result",
        "suite.json",
        "--out",
        "receipt.json",
    ]);
    match cli.command {
        Some(HostCommand::PackagedStoreQualificationReceipt {
            closure_manifest,
            suite_result,
            out,
        }) => {
            assert_eq!(closure_manifest, PathBuf::from("closure.json"));
            assert_eq!(suite_result, PathBuf::from("suite.json"));
            assert_eq!(out, PathBuf::from("receipt.json"));
        }
        _ => panic!("expected packaged-store receipt command"),
    }
    assert_eq!(super::utc_date_from_unix_seconds(0), "1970-01-01");
    assert_eq!(
        super::utc_date_from_unix_seconds(1_775_174_400),
        "2026-04-03",
    );
}

#[test]
fn guide_cli_parses_multiword_queries_and_root_help_names_both_channels() {
    let cli = Cli::parse_from(["snapback", "guide", "live", "query", "--slice", "2"]);
    match cli.command {
        Some(HostCommand::Guide { query, slice, json }) => {
            assert_eq!(query, ["live", "query"]);
            assert_eq!(slice, 2);
            assert!(!json);
        }
        _ => panic!("expected guide command"),
    }

    let help = Cli::command().render_long_help().to_string();
    assert!(help.contains("snapback guide [QUERY]"), "{help}");
    assert!(help.contains("snapback mcp"), "{help}");
    assert_eq!(
        Cli::command().get_version(),
        Some(env!("CARGO_PKG_VERSION"))
    );
    assert!(help.contains("SNAPBACK_NETWORK_PROFILE"), "{help}");
    assert!(
        help.contains("SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS"),
        "{help}"
    );
    assert!(help.contains("snapback mcp-control"), "{help}");
    assert!(
        help.contains("snapback agent setup --print <client> --server mcp-control"),
        "{help}"
    );
}

#[test]
fn native_inventory_and_exit_taxonomy_are_machine_stable() {
    let command = Cli::command();
    let inventory = super::native_command_inventory_entry(&command, &[]);
    assert_eq!(inventory["name"], "snapback");
    let subcommands = inventory["subcommands"].as_array().unwrap();
    assert!(subcommands.iter().any(|entry| entry["name"] == "admin"));
    assert!(
        !subcommands
            .iter()
            .any(|entry| entry["name"] == "command-inventory")
    );
    assert_eq!(
        [
            super::EXIT_OK,
            super::EXIT_USAGE,
            super::EXIT_AUTH_REFUSED,
            super::EXIT_FUNCTION_NOT_FOUND,
            super::EXIT_FUNCTION_ERROR,
            super::EXIT_TRANSPORT_FAILED,
            super::EXIT_ARTIFACT_IDENTITY_MISMATCH,
            super::EXIT_VERSION_MISMATCH,
            super::EXIT_TIMEOUT,
            super::EXIT_SCRIPT_ERROR,
            super::EXIT_RESOURCE_EXCEEDED,
        ],
        [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    );
}

#[test]
fn guide_search_returns_matching_sections_with_stable_markdown_anchors() {
    let files = [
            EmbeddedGuideFile {
                path: "backend/example.md",
                bytes: b"---\ntitle: Example\n---\n# Example page\nIntro.\n## Live queries\nUse the live query handle.\n## Live queries\nSecond live query spelling.\n",
                content_type: "text/markdown; charset=utf-8",
            },
            EmbeddedGuideFile {
                path: crate::guide::FLAT_PATH,
                bytes: b"# Duplicate projection\nlive query handle\n",
                content_type: "text/markdown; charset=utf-8",
            },
        ];

    let matches = search_guide_sections_in(&files, "live query");
    assert_eq!(
        matches,
        [
            super::GuideSectionMatch {
                path: "backend/example.md".to_owned(),
                heading: "Live queries".to_owned(),
                anchor: "live-queries".to_owned(),
            },
            super::GuideSectionMatch {
                path: "backend/example.md".to_owned(),
                heading: "Live queries".to_owned(),
                anchor: "live-queries-1".to_owned(),
            },
        ]
    );
}

#[test]
fn guide_section_search_json_exposes_the_control_tool_shape() {
    let output = render_guide_command(&["network condition profiles".to_owned()], 1, true).unwrap();
    let result: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(result["schemaVersion"], "snapback.guide-search.v1");
    assert_eq!(result["mode"], "section-search");
    assert!(result["count"].as_u64().unwrap() > 0);
    assert!(
        result["matches"][0]["url"]
            .as_str()
            .unwrap()
            .starts_with(super::DEFAULT_SERVED_GUIDE_URL)
    );
}

#[test]
fn guide_channel_output_starts_with_start_packets_and_names_flat_and_mcp() {
    // @ref LLP 0259#1-first-read-contract — start packets lead the channel
    // listing; the capability index stays a lookup channel below them.
    let output = render_guide_command(&[], 1, false).unwrap();
    let start_packets = output.find("/start/index.md").unwrap();
    let capability = output.find("/capabilities.md").unwrap();
    let browse = output.find("Browse the Guide").unwrap();
    assert!(start_packets < capability, "{output}");
    assert!(capability < browse, "{output}");
    assert!(output.contains("lookup, not a linear read"), "{output}");
    assert!(output.contains("/_snapback/guide/flat.md"), "{output}");
    assert!(
        output.contains("/_snapback/guide/reference/index.md"),
        "{output}"
    );
    assert!(
        output.contains("/_snapback/guide/reference/registry.json"),
        "{output}"
    );
    assert!(
        output.contains("/_snapback/guide/reference/diagnostics.md"),
        "{output}"
    );
    assert!(output.contains("snapback mcp"), "{output}");
    assert!(output.contains("snapback mcp-control"), "{output}");
    assert!(
        output.contains("snapback agent setup --print <client> --server mcp-control"),
        "{output}"
    );
}

#[test]
fn guide_exact_member_lookup_precedes_markdown_search() {
    let output = render_guide_command(&["SnapbackClient.query".to_owned()], 1, false).unwrap();
    assert!(
        output.starts_with("SnapbackClient.query — member\n"),
        "{output}"
    );
    assert!(output.contains("guide "), "{output}");
    assert!(output.contains("registry sha256:"), "{output}");
    assert!(
        output.contains("readonly args?: FunctionArgs<Ref>"),
        "{output}"
    );
    assert!(
        !output.contains("Embedded Guide sections matching"),
        "{output}"
    );
}

#[test]
fn guide_exact_diagnostic_lookup_precedes_markdown_search() {
    let output =
        render_guide_command(&["SNAPBACK_AUTH_SESSION_EXPIRED".to_owned()], 1, false).unwrap();
    assert!(
        output.starts_with("SNAPBACK_AUTH_SESSION_EXPIRED — diagnostic\n"),
        "{output}"
    );
    assert!(output.contains("auth · HTTP 401"), "{output}");
    assert!(output.contains("Emitting sites:"), "{output}");
    assert!(
        !output.contains("Embedded Guide sections matching"),
        "{output}"
    );
}

#[test]
fn guide_exact_lookup_json_exposes_the_shared_schema() {
    let output = render_guide_command(&["SnapbackClient.query".to_owned()], 1, true).unwrap();
    let result: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(result["schemaVersion"], GUIDE_SEARCH_SCHEMA_VERSION);
    assert_eq!(result["mode"], "exact-symbol");
    assert_eq!(result["query"], "SnapbackClient.query");
    assert_eq!(
        result["result"]["schemaVersion"],
        crate::guide_reference::LOOKUP_SCHEMA_VERSION
    );
    assert_eq!(result["result"]["match"], "member");
}

#[test]
fn guide_json_is_total_for_channels_fuzzy_and_zero_match() {
    let channels: Value =
        serde_json::from_str(&render_guide_command(&[], 1, true).unwrap()).unwrap();
    assert_eq!(channels["schemaVersion"], GUIDE_SEARCH_SCHEMA_VERSION);
    assert_eq!(channels["mode"], "channels");
    assert_eq!(channels["count"], 0);

    let fuzzy: Value =
        serde_json::from_str(&render_guide_command(&["live query".to_owned()], 1, true).unwrap())
            .unwrap();
    assert_eq!(fuzzy["mode"], "section-search");
    assert!(fuzzy["count"].as_u64().unwrap() > 0);

    let zero: Value = serde_json::from_str(
        &render_guide_command(&["no-such-guide-needle-6f8614".to_owned()], 1, true).unwrap(),
    )
    .unwrap();
    assert_eq!(zero["mode"], "section-search");
    assert_eq!(zero["count"], 0);
    assert_eq!(zero["result"]["matched"], false);
}

#[test]
fn guide_large_symbol_uses_requested_bounded_slice() {
    let first = render_guide_command(&["SnapbackClient".to_owned()], 1, false).unwrap();
    let second = render_guide_command(&["SnapbackClient".to_owned()], 2, false).unwrap();
    assert!(first.contains("SnapbackClient — symbol-slice"), "{first}");
    assert!(first.contains("TRUNCATED:"), "{first}");
    assert!(
        first.contains("Next: snapback guide SnapbackClient --slice 2"),
        "{first}"
    );
    assert!(second.contains("members 1-8:"), "{second}");
    assert_ne!(first, second);
}

#[test]
fn controls_cli_parses_offline_list_and_describe_json_forms() {
    let list = Cli::parse_from([
        "snapback",
        "controls",
        "list",
        "--intent",
        "network profile",
        "--json",
    ]);
    assert!(matches!(
        list.command,
        Some(HostCommand::Controls {
            command: ControlsCommand::List {
                intent: Some(intent),
                json: true,
            }
        }) if intent == "network profile"
    ));

    let describe = Cli::parse_from([
        "snapback",
        "controls",
        "describe",
        "debug.networkProfileSet",
        "--json",
    ]);
    assert!(matches!(
        describe.command,
        Some(HostCommand::Controls {
            command: ControlsCommand::Describe { operation, json: true }
        }) if operation == "debug.networkProfileSet"
    ));
}

#[test]
fn controls_list_text_includes_discovery_title_and_cli_projection() {
    let output = controls_list_text(crate::control_catalog::build_catalog());
    assert!(output.starts_with("OPERATION\tTITLE\tSURFACE\tOPERABILITY\tSTATUS\tCLI\n"));
    assert!(output.lines().any(|line| {
        line.starts_with("host.restart\tRestart the local Snapback server\t")
            && line.ends_with("\tsnapback restart --ready-file <path>")
    }));
}

#[test]
fn fork_cli_pins_finite_ttl_and_explicit_secret_opt_in() {
    assert_eq!(parse_fork_ttl("2h").unwrap(), 7_200_000);
    assert!(parse_fork_ttl("0m").is_err());
    assert!(parse_fork_ttl("forever").is_err());
    let cli = Cli::parse_from([
        "snapback",
        "fork",
        "create",
        "--from",
        "parent.ready.json",
        "--ttl",
        "45m",
        "--with-secrets",
        "--app-root",
        "demo",
    ]);
    match cli.command {
        Some(HostCommand::Fork {
            command:
                ForkCommand::Create {
                    from,
                    ttl,
                    with_secrets,
                    app_root,
                    ..
                },
        }) => {
            assert_eq!(from, Some(PathBuf::from("parent.ready.json")));
            assert_eq!(ttl, "45m");
            assert!(with_secrets);
            assert_eq!(app_root, PathBuf::from("demo"));
        }
        _ => panic!("expected fork create"),
    }
}

#[test]
fn fork_help_exposes_one_coherent_lifecycle_and_scalar_formats() {
    let fork_help = Cli::command()
        .find_subcommand_mut("fork")
        .expect("fork command")
        .render_long_help()
        .to_string();
    for lifecycle_word in [
        "create", "inspect", "list", "diff", "renew", "drop", "reap", "recover",
    ] {
        assert!(
            fork_help.contains(lifecycle_word),
            "{lifecycle_word}: {fork_help}"
        );
    }

    let cli = Cli::parse_from([
        "snapback",
        "fork",
        "inspect",
        "019fd4b0-f093-7a30-835e-0c4e9ae7c7a1",
        "--format",
        "admin-token-path",
    ]);
    assert!(matches!(
        cli.command,
        Some(HostCommand::Fork {
            command: ForkCommand::Inspect {
                format: super::ForkOutputFormat::AdminTokenPath,
                ..
            }
        })
    ));
}

#[cfg(unix)]
#[test]
fn detached_child_configuration_closes_an_inherited_descriptor_on_exec() {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::fs::OpenOptionsExt as _;

    const CHILD_ENV: &str = "SNAPBACK_TEST_DETACHED_CHILD_FD_CHILD";
    if std::env::var_os(CHILD_ENV).is_none() {
        // The fixture deliberately creates one non-CLOEXEC descriptor in
        // its process. Isolate it so no parallel test spawn can inherit
        // the descriptor before this assertion owns the cleanup.
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cli::tests::detached_child_configuration_closes_an_inherited_descriptor_on_exec",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .expect("run isolated descriptor child");
        assert!(
            output.status.success(),
            "isolated descriptor child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }

    let directory = tempfile::tempdir().unwrap();
    let lease_path = directory.path().join("caller-descriptor.lock");
    let lease = std::fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(&lease_path)
        .unwrap();
    assert_eq!(unsafe { libc::flock(lease.as_raw_fd(), libc::LOCK_EX) }, 0);
    let lease_fd = lease.as_raw_fd();
    const INHERITED_CALLER_FD: i32 = 198;
    assert_eq!(
        unsafe { libc::dup2(lease_fd, INHERITED_CALLER_FD) },
        INHERITED_CALLER_FD
    );

    let mut command = std::process::Command::new("/bin/sleep");
    command.arg("5");
    super::configure_detached_child(&mut command);
    let mut child = command.spawn().unwrap();
    assert_eq!(unsafe { libc::close(INHERITED_CALLER_FD) }, 0);
    drop(lease);

    let probe = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(&lease_path)
        .unwrap();
    let probe_result = unsafe { libc::flock(probe.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    let probe_error = (probe_result != 0).then(std::io::Error::last_os_error);
    let _ = child.kill();
    let _ = child.wait();
    assert_eq!(
        probe_result, 0,
        "the exec'd detached child retained the caller descriptor: {probe_error:?}"
    );
}

#[test]
fn fork_create_refuses_when_automatic_sweep_cannot_prove_stop() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("parent.sqlite3");
    let database = crate::storage::LocalDatabase::open(&source).unwrap();
    drop(database);
    let root = directory.path().join("forks");
    std::fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let expected = crate::instance_fork::ensure_expected_app(&root, "app-a").unwrap();
    let receipt = crate::instance_fork::publish_managed(
        &source,
        &destination,
        &expected,
        "parent-a",
        100,
        200,
        false,
    )
    .unwrap();
    let expected = crate::instance_fork::load_expected_app(&root).unwrap();
    let ready = destination.join("fork.ready.json");
    std::fs::write(&ready, b"{}").unwrap();
    crate::instance_fork::record_managed_runtime(
        &root,
        &receipt.lineage.fork_id,
        &ready,
        &expected,
    )
    .unwrap();

    let error = automatic_reap_before_create(&root, &expected, 200).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_FORK_EXPIRED_REAP_FAILED"),
        "{error}"
    );
    let snapback_error = error
        .downcast_ref::<crate::diagnostic::SnapbackError>()
        .expect("typed refusal");
    assert!(
        snapback_error.diagnostic.details["cause"]
            .as_str()
            .is_some_and(|cause| cause.contains("SNAPBACK_FORK_READY_INVALID")),
        "the refusal carries the exact per-fork cause, got {:?}",
        snapback_error.diagnostic.details
    );
    assert!(destination.is_dir(), "failed sweep must fail closed");
}

#[test]
fn fork_secret_disposition_reports_an_absent_opted_in_source_honestly() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("fork.sqlite3");
    std::fs::write(&database, []).unwrap();
    assert_eq!(
        fork_secret_disposition(true, &database),
        "copy-requested-source-absent"
    );
    assert_eq!(fork_secret_disposition(false, &database), "scrubbed");
    crate::secure_file::write_owner_only(
        &crate::config::ConfigStore::path_for_database(&database),
        br#"{"formatVersion":1,"entries":{}}"#,
    )
    .unwrap();
    assert_eq!(
        fork_secret_disposition(true, &database),
        "copied-explicitly"
    );
}

#[test]
fn fork_stop_keeps_unverifiable_ready_file_while_pid_may_exist() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("fork.sqlite3");
    std::fs::write(&database, []).unwrap();
    let database = std::fs::canonicalize(database).unwrap();
    let ready = directory.path().join("fork.ready.json");
    let mut descriptor = stop_descriptor(Some("nonce-a"));
    descriptor.pid = std::process::id();
    descriptor.server_url = "http://127.0.0.1:1".to_owned();
    descriptor.database = crate::host_ops::HostReadyDatabase {
        mode: "file".to_owned(),
        path: Some(database.display().to_string()),
    };
    crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
        .unwrap();
    let error = quiet_stop_fork(&ready, &database).unwrap_err();
    assert!(error.to_string().contains("SNAPBACK_FORK_STOP_UNVERIFIED"));
    assert!(ready.is_file());
}

fn telemetry_target_descriptor(environment_id: &str) -> crate::deploy::TargetDescriptor {
    crate::deploy::TargetDescriptor {
        schema_version: crate::deploy::TargetDescriptorVersion::V1,
        target_id: "target-cli-telemetry".to_owned(),
        project_id: "project-cli-telemetry".to_owned(),
        environment_id: environment_id.to_owned(),
        deployment_id: "deployment-cli-telemetry".to_owned(),
        database_id: "database-cli-telemetry".to_owned(),
        stream_incarnation: "stream-cli-telemetry".to_owned(),
        target_profile_id: "profile-cli-telemetry".to_owned(),
        production_class: crate::deploy::TargetProductionClass::Preview,
        adapter: crate::deploy::VmAdapterDescriptor {
            kind: crate::deploy::VmAdapterKind::SingleInstanceContainerVm,
            version: "1.0.0".to_owned(),
            driver_path: "/trusted/adapter".to_owned(),
            driver_sha256: "00".repeat(32),
            provider: "provider-cli-telemetry".to_owned(),
            account_fingerprint: "account-cli-telemetry".to_owned(),
            region: "region-cli-telemetry".to_owned(),
            public_origin: "https://cli-telemetry.example".to_owned(),
            credential_ref: "credential-cli-telemetry".to_owned(),
            state_store_ref: "state-cli-telemetry".to_owned(),
        },
        created_at_ms: 1,
    }
}

#[test]
fn production_readiness_exposes_item7_before_item8() {
    let mut snapback = crate::local::LocalSnapback::memory().unwrap();
    let runtime = crate::auth::runtime::AuthRuntime::inspect(
        &mut snapback,
        None,
        crate::contract_types::AuthProviderProfile::Test,
    )
    .unwrap();
    let connection = crate::server::connection_binding_construction_receipt();
    let revocation = runtime.two_phase_revocation_construction_receipt();
    let coordinator = runtime.auth_coordinator_construction_receipt();
    let receipts = AuthProgramConstructionReceipts {
        connection_binding: Some(&connection),
        two_phase_revocation: Some(&revocation),
        auth_coordinator: Some(AuthCoordinatorReadinessReceipt::Construction(&coordinator)),
    };
    let before_invalidation = runtime_auth_program_readiness(true, &receipts, false, false);
    assert!(before_invalidation.session_activation_ready);
    assert!(before_invalidation.authority_descriptor);
    assert!(!before_invalidation.authorization_invalidation);
    assert!(!before_invalidation.authorized_lease);

    let after_invalidation = runtime_auth_program_readiness(true, &receipts, true, false);
    assert!(after_invalidation.authority_descriptor);
    assert!(after_invalidation.authorization_invalidation);
    assert!(!after_invalidation.authorized_lease);

    let after_lease_install = runtime_auth_program_readiness(true, &receipts, true, true);
    assert!(after_lease_install.authority_descriptor);
    assert!(after_lease_install.authorization_invalidation);
    assert!(after_lease_install.authorized_lease);
}

#[test]
fn admin_cli_pins_launch_and_terminal_approval_shapes() {
    let launch = Cli::parse_from([
        "snapback",
        "admin",
        "--no-open",
        "--ready-file",
        "ready.json",
    ]);
    match launch.command {
        Some(HostCommand::Admin(AdminArgs {
            no_open,
            json,
            target,
            command: None,
        })) => {
            assert!(no_open);
            assert!(!json);
            assert_eq!(target.ready_file, Some(PathBuf::from("ready.json")));
        }
        other => panic!("expected admin launch command, got {other:?}"),
    }

    let approval = Cli::parse_from([
        "snapback",
        "admin",
        "approve",
        "ABCD-1234",
        "--ready-file",
        "ready.json",
    ]);
    match approval.command {
        Some(HostCommand::Admin(AdminArgs {
            command: Some(AdminCommand::Approve { code, target }),
            ..
        })) => {
            assert_eq!(code, "ABCD-1234");
            assert_eq!(target.ready_file, Some(PathBuf::from("ready.json")));
        }
        other => panic!("expected admin approval command, got {other:?}"),
    }

    let link = Cli::parse_from([
        "snapback",
        "admin",
        "link",
        "--ready-file",
        "ready.json",
        "--url-base",
        "https://console.example",
        "--no-wait",
    ]);
    match link.command {
        Some(HostCommand::Admin(AdminArgs {
            command:
                Some(AdminCommand::Link {
                    target,
                    no_wait,
                    url_base,
                    status: None,
                    revoke: None,
                    qr: false,
                    tailscale: false,
                    lan: None,
                    link_ready_file: None,
                }),
            ..
        })) => {
            assert!(no_wait);
            assert_eq!(target.ready_file, Some(PathBuf::from("ready.json")));
            assert_eq!(url_base.as_deref(), Some("https://console.example"));
        }
        other => panic!("expected admin claim-link command, got {other:?}"),
    }

    let lan_link = Cli::parse_from([
        "snapback",
        "admin",
        "link",
        "--lan",
        "--qr",
        "--ready-file",
        "ready.json",
    ]);
    assert!(matches!(
        lan_link.command,
        Some(HostCommand::Admin(AdminArgs {
            command: Some(AdminCommand::Link {
                lan: Some(selector),
                qr: true,
                tailscale: false,
                ..
            }),
            ..
        })) if selector.is_empty()
    ));

    let observed_link = Cli::parse_from([
        "snapback",
        "admin",
        "link",
        "--json",
        "--link-ready-file",
        "link.ready.json",
        "--ready-file",
        "server.ready.json",
    ]);
    assert!(matches!(
        observed_link.command,
        Some(HostCommand::Admin(AdminArgs {
            json: true,
            command: Some(AdminCommand::Link {
                link_ready_file: Some(path),
                ..
            }),
            ..
        })) if path == Path::new("link.ready.json")
    ));

    let status = Cli::parse_from([
        "snapback",
        "admin",
        "link",
        "--status",
        "sbcl_0123456789abcdef0123456789abcdef",
        "--ready-file",
        "ready.json",
    ]);
    assert!(matches!(
        status.command,
        Some(HostCommand::Admin(AdminArgs {
            command: Some(AdminCommand::Link {
                status: Some(_),
                ..
            }),
            ..
        }))
    ));

    let url = console_fragment_url("http://127.0.0.1:4287", "sbcc_abc123", 42);
    assert_eq!(
        url,
        "http://127.0.0.1:4287/_snapback/admin/#credential=sbcc_abc123&expiresAtMs=42"
    );
    assert!(!url.contains('?'));

    assert_eq!(
        validated_console_origin("https://console.example/").unwrap(),
        "https://console.example"
    );
    for invalid in [
        "console.example",
        "ftp://console.example",
        "https://user@console.example",
        "https://console.example/path",
        "https://console.example?claim=secret",
        "https://console.example/#fragment",
    ] {
        assert!(validated_console_origin(invalid).is_err(), "{invalid}");
    }
    let claim_url = console_claim_fragment_url(
        "https://console.example",
        "sbcl_0123456789abcdef0123456789abcdef",
    );
    assert_eq!(
        claim_url,
        "https://console.example/_snapback/admin/#claim=sbcl_0123456789abcdef0123456789abcdef"
    );
    assert!(!claim_url.contains('?'));
}

#[test]
fn admin_browser_handoff_uses_claim_while_no_open_prints_credential() {
    let browser = console_launch_handoff_with(
        "http://127.0.0.1:4287",
        false,
        || panic!("browser handoff must not mint the live credential in the CLI"),
        || {
            Ok(ConsoleClaimMintCliResponse {
                claim_code: "sbcl_0123456789abcdef0123456789abcdef".to_owned(),
                expires_at_ms: 1_000,
                expires_in: 30,
            })
        },
    )
    .unwrap();
    assert!(browser.url.contains("#claim=sbcl_"), "{}", browser.url);
    assert!(!browser.url.contains("sbcc_"), "{}", browser.url);

    let printed = console_launch_handoff_with(
        "http://127.0.0.1:4287",
        true,
        || {
            Ok(ConsoleCredentialCliResponse {
                credential: "sbcc_stdout_only".to_owned(),
                expires_at_ms: 2_000,
            })
        },
        || panic!("--no-open must not mint a claim that no page will redeem"),
    )
    .unwrap();
    assert!(printed.url.contains("#credential=sbcc_stdout_only"));
    assert_eq!(printed.expires_at_ms, 2_000);
}

#[test]
fn admin_link_ready_file_is_owner_lifecycle_bound() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("link.ready.json");
    let claim = ConsoleClaimMintCliResponse {
        claim_code: "sbcl_0123456789abcdef0123456789abcdef".to_owned(),
        expires_at_ms: 1234,
        expires_in: 30,
    };
    let guard = AdminLinkReadyFile::publish(
        &path,
        "https://console.example/_snapback/admin/#claim=sbcl_0123456789abcdef0123456789abcdef",
        &claim,
        "https://console.example",
    )
    .unwrap();
    let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["schemaVersion"], "snapback.admin-link-ready.v1");
    assert_eq!(value["ready"], true);
    drop(guard);
    assert!(!path.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[cfg(not(feature = "cli-owner"))]
async fn typed_target_runner_threads_descriptor_environment_into_store_meta() {
    let directory = tempfile::tempdir().expect("typed target runner fixture");
    let database = directory.path().join("app.sqlite3");
    let ready = directory.path().join("ready.json");
    let environment_id = "environment-from-target-descriptor";
    let target = telemetry_target_descriptor(environment_id);
    let server = tokio::spawn(super::run_for_target(
        Args {
            host: "127.0.0.1".to_owned(),
            port: Some(0),
            db: database.clone(),
            ready_file: Some(ready.clone()),
            ..Args::default()
        },
        target,
    ));
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !ready.exists() {
        if server.is_finished() {
            let outcome = server.await;
            panic!("typed target startup exited before readiness: {outcome:?}");
        }
        assert!(
            std::time::Instant::now() < deadline,
            "typed target startup never reached readiness"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let telemetry = crate::telemetry::Telemetry::path_for_database(&database);
    while !telemetry.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "typed target telemetry store was never materialized"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    // @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
    //   the sibling inode can precede the transaction that commits its
    //   authoritative telemetry_meta identity, so observe the row rather
    //   than treating file existence as store readiness.
    let (app_id, environment): (String, String) = loop {
        if let Some(identity) =
            crate::telemetry::Telemetry::durable_meta_for_database_for_test(&database)
                .expect("typed target telemetry identity probe")
        {
            break (
                identity.app_id.expect("typed target app identity"),
                identity
                    .environment
                    .expect("typed target environment identity"),
            );
        }
        if server.is_finished() {
            let outcome = server.await;
            panic!("typed target startup exited before telemetry identity: {outcome:?}");
        }
        assert!(
            std::time::Instant::now() < deadline,
            "typed target telemetry identity was never committed"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    };
    assert_eq!(app_id, crate::manifest::SchemaManifest::default().app_id);
    assert_eq!(environment, environment_id);
    server.abort();
    let _ = server.await;
}

fn stop_descriptor(startup_nonce: Option<&str>) -> crate::host_ops::HostReadyDescriptor {
    crate::host_ops::HostReadyDescriptor {
        schema_version: crate::manifest::SNAPBACK_SCHEMA_VERSION.to_owned(),
        descriptor_kind: crate::host_ops::HOST_READY_DESCRIPTOR_KIND.to_owned(),
        startup_id: "srt_test".to_owned(),
        ready: true,
        server_url: "http://127.0.0.1:4287".to_owned(),
        host: "127.0.0.1".to_owned(),
        port: 4287,
        pid: 4242,
        startup_nonce: startup_nonce.map(str::to_owned),
        target: crate::host_ops::HostOpsTarget {
            app_id: "app_test".to_owned(),
            app_root: None,
            target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            server_url: Some("http://127.0.0.1:4287".to_owned()),
        },
        database: crate::host_ops::HostReadyDatabase {
            mode: "memory".to_owned(),
            path: None,
        },
        started_at_ms: 0,
        admin_gated: false,
        admin_token_file: None,
        secret_read_root_file: None,
        impersonation_capability_file: None,
        dev_identity_capability_file: None,
        diagnostics: Vec::new(),
    }
}

fn health_with_nonce(nonce: &str) -> serde_json::Value {
    json!({ "ok": true, "binary": { "startupNonce": nonce } })
}

fn read_http_request(stream: &mut std::net::TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let count = stream.read(&mut chunk).expect("read HTTP request");
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
        let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
            assert!(bytes.len() < 64 * 1024);
            continue;
        };
        let header_len = header_end + 4;
        let headers = String::from_utf8_lossy(&bytes[..header_len]);
        let content_len = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        if bytes.len() >= header_len + content_len {
            break;
        }
    }
    String::from_utf8(bytes).expect("HTTP request is UTF-8")
}

fn write_http_json(stream: &mut std::net::TcpStream, body: &serde_json::Value) {
    let body = body.to_string();
    write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
}

#[test]
fn stop_signals_only_a_nonce_verified_server() {
    let descriptor = stop_descriptor(Some("nonce-a"));
    let verdict = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-a")));
    assert!(verdict.is_ok());
}

#[test]
fn stop_refuses_when_the_server_is_a_different_process() {
    let descriptor = stop_descriptor(Some("nonce-a"));
    let diagnostic = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-b")))
        .expect_err("a restarted server must not be signaled via the old descriptor");
    assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR");
}

#[test]
fn stop_refuses_when_the_server_no_longer_answers() {
    let descriptor = stop_descriptor(Some("nonce-a"));
    let diagnostic = super::verify_stop_target(&descriptor, &Err("connection refused".to_owned()))
        .expect_err("a dead server means the pid may be reused; never signal it");
    assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR");
    assert_eq!(diagnostic.details["reason"], json!("connection refused"));
}

#[test]
fn stop_refuses_a_descriptor_without_a_nonce() {
    let descriptor = stop_descriptor(None);
    let diagnostic = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-a")))
        .expect_err("an unverifiable descriptor must be refused");
    assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_UNVERIFIABLE");
}

#[test]
fn stop_refuses_when_the_responder_reports_no_snapback_identity() {
    let descriptor = stop_descriptor(Some("nonce-a"));
    let diagnostic = super::verify_stop_target(&descriptor, &Ok(json!({ "hello": "world" })))
        .expect_err("a non-Snapback responder must not vouch for the pid");
    assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_UNVERIFIABLE");
}

#[test]
fn serve_argument_defaults_remain_available_to_explicit_start() {
    let args = Args::parse_from(["snapback"]);
    assert_eq!(args.host, "127.0.0.1");
    assert_eq!(args.port, None);
    assert_eq!(args.db, PathBuf::from(".snapback/dev.sqlite3"));
    assert!(!args.memory);
    assert!(!args.cron_disabled);
    let cli = Cli::parse_from(["snapback"]);
    assert!(cli.command.is_none(), "bare invocation selects root help");
    assert_eq!(cli.serve, Args::default());
}

#[test]
fn cron_disabled_flag_parses() {
    assert!(Args::parse_from(["snapback", "--cron-disabled"]).cron_disabled);
}

#[test]
fn hosted_journey_verifier_requires_explicit_receipt_and_artifact_map() {
    let cli = Cli::parse_from([
        "snapback",
        "hosted-journey-verify",
        "journey.json",
        "--artifacts",
        "artifacts.json",
    ]);
    assert!(matches!(
        cli.command,
        Some(HostCommand::HostedJourneyVerify {
            receipt,
            artifacts: Some(artifacts),
        }) if receipt == Path::new("journey.json")
            && artifacts == Path::new("artifacts.json")
    ));
}

#[test]
fn background_roots_start_only_after_all_fallible_publications() {
    let source = include_str!("../cli.rs");
    let sidecar = source
        .find("operator\n                .publish_with")
        .expect("impersonation sidecar publication remains explicit");
    let ready = source
        .find("target\n            .write_atomic_protected")
        .expect("ready descriptor publication remains explicit");
    let cron = source
        .find("server::spawn_cron_scheduler(state.clone(), cron_autonomy_disabled)")
        .expect("cron scheduler spawn remains explicit");
    let maintenance = source
        .find("server::spawn_maintenance_worker(app_state.clone())")
        .expect("maintenance spawn remains explicit");
    let auth_gc = source
        .find("app_state.spawn_auth_gc_worker")
        .expect("auth GC spawn remains explicit");
    assert!(sidecar < cron && ready < cron);
    assert!(sidecar < maintenance && ready < maintenance);
    assert!(sidecar < auth_gc && ready < auth_gc);
}

#[test]
fn serve_path_installs_insecure_dev_auth_override_into_app_state() {
    // The request-path transport fence reads
    // `AppState.allow_insecure_dev_auth`, not the CLI args, so the serve
    // path must install the flag between AppState construction and app
    // build. Without this the flag validates pre-bind and is then
    // silently dropped: every app-data route on a non-loopback bind
    // refuses with SNAPBACK_AUTH_TRANSPORT_INSECURE (found by the first
    // remote drill target).
    let source = include_str!("../cli.rs");
    let constructed = source
        .find("AppState::try_new_for_server_startup(\n        state.clone(),")
        .expect("serve-path AppState construction remains explicit");
    let installed = source
        .find(".with_insecure_dev_auth_override(args.allow_insecure_dev_auth)")
        .expect("serve path installs the CLI override into request-path state");
    let built = source
        .find("connection_binding_receipt.build(app_state.clone())")
        .expect("app build from AppState remains explicit");
    assert!(constructed < installed && installed < built);
}

#[test]
fn port_and_storage_can_be_overridden() {
    let args = Args::parse_from([
        "snapback",
        "--host",
        "0.0.0.0",
        "--port",
        "9000",
        "--db",
        "tmp/dev.sqlite3",
        "--memory",
    ]);
    assert_eq!(args.host, "0.0.0.0");
    assert_eq!(args.port, Some(9000));
    assert_eq!(args.db, PathBuf::from("tmp/dev.sqlite3"));
    assert!(args.memory);
}

#[test]
fn detached_start_refusal_has_stable_code_and_repair() {
    let error = super::ready_descriptor_required_error();
    assert_eq!(error.diagnostic.code, "SNAPBACK_READY_DESCRIPTOR_REQUIRED");
    assert_eq!(
        error.diagnostic.details["next"][0]["command"],
        "snapback start --ready-file <owner-only-path> ..."
    );
}

#[test]
fn parent_serve_flags_with_subcommands_are_rejected() {
    let cli = Cli::parse_from(["snapback", "--memory", "start"]);

    let error = reject_misdirected_serve_flags(&cli).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("require the explicit `start` command"),
        "{error}"
    );
}

#[test]
fn start_subcommand_accepts_serve_flags_after_subcommand() {
    let cli = Cli::parse_from(["snapback", "start", "--memory", "--port", "9000"]);

    reject_misdirected_serve_flags(&cli).unwrap();
    match cli.command {
        Some(HostCommand::Start(args)) => {
            assert!(args.memory);
            assert_eq!(args.port, Some(9000));
        }
        other => panic!("expected start command, got {other:?}"),
    }
}

#[test]
fn restart_subcommand_requires_ready_file_and_parses_reason() {
    let cli = Cli::parse_from([
        "snapback",
        "restart",
        "--ready-file",
        ".snapback/dev.ready.json",
        "--reason",
        "reload native module",
    ]);
    assert!(matches!(
        cli.command,
        Some(HostCommand::Restart { ready_file, reason })
            if ready_file == Path::new(".snapback/dev.ready.json")
                && reason == "reload native module"
    ));
    assert!(Cli::try_parse_from(["snapback", "restart"]).is_err());
}

#[test]
fn restart_start_argv_reuses_descriptor_target_without_authority() {
    let mut descriptor = stop_descriptor(Some("old-startup"));
    descriptor.database.mode = "file".to_owned();
    descriptor.database.path = Some("/tmp/restart.sqlite3".to_owned());
    descriptor.admin_token_file = Some("/tmp/restart.sqlite3.admin-token".to_owned());
    let argv = super::restart_start_argv(Path::new("/tmp/restart.ready.json"), &descriptor)
        .unwrap()
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        argv,
        [
            "start",
            "--ready-file",
            "/tmp/restart.ready.json",
            "--db",
            "/tmp/restart.sqlite3",
        ]
    );
    assert!(
        argv.iter().all(|arg| !arg.contains("admin-token")),
        "authority carriers never enter the replacement argv"
    );
}

#[test]
fn restart_composition_keeps_one_request_id_and_one_envelope() {
    let descriptor = stop_descriptor(Some("old-startup"));
    let previous = super::lifecycle_result(
        "hop_fixed",
        "host.stop",
        descriptor.target.clone(),
        true,
        json!({ "stoppedPid": descriptor.pid, "exited": true }),
        Vec::new(),
    );
    let current = super::lifecycle_result(
        "hop_fixed",
        "host.start",
        descriptor.target,
        true,
        json!({ "pid": 5252, "runtimeState": { "ready": true } }),
        Vec::new(),
    );
    let restart =
        super::compose_restart_result("hop_fixed", "acceptance restart", &previous, &current);
    assert!(restart.ok);
    assert_eq!(restart.operation, "host.restart");
    assert_eq!(restart.request_id, "hop_fixed");
    assert_eq!(restart.data["restartReason"], "acceptance restart");
    assert_eq!(restart.data["previous"]["stoppedPid"], 4242);
    assert_eq!(restart.data["current"]["pid"], 5252);
}

#[test]
fn staged_auth_mode_startup_flags_have_closed_spellings() {
    let cli = Cli::parse_from([
        "snapback",
        "start",
        "--startup-artifacts",
        "deployment.auth.json",
        "--allow-auth-downgrade",
        "--allow-insecure-dev-auth",
        "--auth-deployment",
        "hosted",
    ]);
    match cli.command {
        Some(HostCommand::Start(args)) => {
            assert_eq!(
                args.startup_artifacts,
                Some(PathBuf::from("deployment.auth.json"))
            );
            assert!(args.allow_auth_downgrade);
            assert!(!args.clear_desired_auth_mode);
            assert!(args.allow_insecure_dev_auth);
            assert_eq!(
                args.auth_deployment,
                crate::auth::deployment::AuthDeploymentTarget::Hosted
            );
        }
        other => panic!("expected start command, got {other:?}"),
    }

    assert!(
        Cli::try_parse_from([
            "snapback",
            "start",
            "--clear-desired-auth-mode",
            "--allow-auth-downgrade",
        ])
        .is_err(),
        "unstage and downgrade-consume authority are mutually exclusive"
    );
}

#[tokio::test]
async fn hosted_auth_request_refuses_before_database_creation() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("must-not-exist.sqlite3");
    let error = super::run(Args {
        db: database.clone(),
        ready_file: Some(directory.path().join("server.ready.json")),
        auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Hosted,
        ..Args::default()
    })
    .await
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED"),
        "{error:#}"
    );
    assert!(
        !database.exists(),
        "hosted refusal must precede target creation or mutation"
    );
}

#[cfg(unix)]
#[test]
fn startup_artifact_carrier_is_bounded_closed_and_versioned() {
    use std::os::unix::fs::PermissionsExt as _;

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("deployment.auth.json");
    let valid = json!({
        "formatVersion": 1,
        "schema": crate::manifest::SchemaManifest::default(),
        "functions": crate::manifest::FunctionManifest::default(),
        "seed": null,
    });
    std::fs::write(&path, serde_json::to_vec(&valid).unwrap()).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    let parsed = super::read_auth_startup_artifacts(&path).unwrap();
    assert_eq!(parsed.format_version, 1);
    assert!(parsed.seed.is_none());

    let mut unknown = valid.clone();
    unknown["secondCarrier"] = json!(true);
    std::fs::write(&path, serde_json::to_vec(&unknown).unwrap()).unwrap();
    let error = super::read_auth_startup_artifacts(&path).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH")
    );

    let mut unsupported = valid;
    unsupported["formatVersion"] = json!(2);
    std::fs::write(&path, serde_json::to_vec(&unsupported).unwrap()).unwrap();
    let error = super::read_auth_startup_artifacts(&path).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH")
    );
}

#[cfg(unix)]
fn sessions_startup_carrier(path: &Path) {
    sessions_startup_carrier_with_functions(path, Vec::new());
}

#[cfg(unix)]
fn sessions_startup_carrier_with_functions(
    path: &Path,
    declared_functions: Vec<crate::manifest::FunctionDefinition>,
) {
    use crate::auth::mode::{FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX};
    use crate::manifest::{
        AuthManifest, AuthMode, FunctionManifest, SNAPBACK_SESSIONS_SCHEMA_VERSION, SchemaManifest,
        TargetCapabilityId,
    };
    use std::os::unix::fs::PermissionsExt as _;

    let digest = |prefix: &str, nibble: char| format!("{prefix}{}", nibble.to_string().repeat(64));
    let inputs = digest(INPUTS_V1_PREFIX, 'c');
    let schema = SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: "startup-auth-test".to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: None,
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        schema_hash: Some(digest(SCHEMA_V1_PREFIX, 'a')),
        inputs_hash: Some(inputs.clone()),
        ..SchemaManifest::default()
    };
    let functions = FunctionManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: "startup-auth-test".to_owned(),
        bundle_hash: Some(digest(FUNCTION_V1_PREFIX, 'b')),
        inputs_hash: Some(inputs),
        functions: declared_functions,
        ..FunctionManifest::default()
    };
    std::fs::write(
        path,
        serde_json::to_vec(&json!({
            "formatVersion": 1,
            "schema": schema,
            "functions": functions,
            "seed": null,
        }))
        .unwrap(),
    )
    .unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn fresh_sessions_startup_stages_then_quarantines_before_item_five() {
    use crate::auth::mode::{AppDataAvailability, AuthModeStatus, AuthProgramReadiness};
    use crate::contract_types::{AuthProviderProfile, ServerProfile};
    use crate::local::LocalSnapback;
    use crate::manifest::AuthMode;

    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let carrier = directory.path().join("startup.json");
    sessions_startup_carrier(&carrier);
    let args = Args {
        db: database.clone(),
        startup_artifacts: Some(carrier),
        ..Args::default()
    };
    let mut snapback = LocalSnapback::open(&database).unwrap();
    let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
        &mut snapback,
        Some(&database),
        AuthProviderProfile::Test,
    )
    .unwrap();
    let readiness = AuthProgramReadiness::item4(true);

    let state = super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
        .await
        .unwrap();
    assert_eq!(state.active, AuthMode::Dev);
    assert_eq!(state.desired, AuthMode::Sessions);
    assert_eq!(state.mode_state, AuthModeStatus::Quarantined);
    assert_eq!(
        state.app_data_availability,
        AppDataAvailability::RefusedPending
    );
    assert_eq!(
        state.quarantine.as_ref().map(|value| value.code.as_str()),
        Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
    );
    assert!(!runtime.catalog_ready());
    assert!(
        !crate::auth::keyring::AuthKeyringStore::keyring_path(&database).exists(),
        "the item-5 readiness fence must run before keyring/catalog effects"
    );
    super::validate_auth_transport(
        "127.0.0.1".parse().unwrap(),
        ServerProfile::Test,
        &state,
        false,
    )
    .unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn omitted_construction_receipts_prevent_sessions_from_binding() {
    use crate::auth::mode::{AppDataAvailability, AuthModeStatus};
    use crate::contract_types::AuthProviderProfile;
    use crate::local::LocalSnapback;
    use crate::manifest::AuthMode;

    for missing in [
        "connection-binding",
        "two-phase-revocation",
        "auth-coordinator",
    ] {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let carrier = directory.path().join("startup.json");
        sessions_startup_carrier(&carrier);
        let args = Args {
            db: database.clone(),
            startup_artifacts: Some(carrier),
            ..Args::default()
        };
        let mut snapback = LocalSnapback::open(&database).unwrap();
        let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
            &mut snapback,
            Some(&database),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let connection = crate::server::connection_binding_construction_receipt();
        let revocation = runtime.two_phase_revocation_construction_receipt();
        let coordinator = runtime.auth_coordinator_construction_receipt();
        let receipts = AuthProgramConstructionReceipts {
            connection_binding: (missing != "connection-binding").then_some(&connection),
            two_phase_revocation: (missing != "two-phase-revocation").then_some(&revocation),
            auth_coordinator: (missing != "auth-coordinator")
                .then_some(AuthCoordinatorReadinessReceipt::Construction(&coordinator)),
        };
        let readiness = runtime_auth_program_readiness(true, &receipts, false, false);

        let state =
            super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap();
        assert_eq!(state.active, AuthMode::Dev, "missing {missing}");
        assert_eq!(state.desired, AuthMode::Sessions, "missing {missing}");
        assert_eq!(
            state.mode_state,
            AuthModeStatus::Quarantined,
            "missing {missing}"
        );
        assert_eq!(
            state.app_data_availability,
            AppDataAvailability::RefusedPending,
            "missing {missing}"
        );
        assert_eq!(
            state.quarantine.as_ref().map(|value| value.code.as_str()),
            Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE"),
            "missing {missing}"
        );
        assert!(!runtime.catalog_ready(), "missing {missing}");
    }
}

#[tokio::test]
#[cfg(not(feature = "cli-owner"))]
async fn coordinator_and_worker_construction_fail_before_socket_bind() {
    let directory = tempfile::tempdir().unwrap();
    for failure in [
        AuthConstructionFailure::Coordinator,
        AuthConstructionFailure::ExpiryWorker,
    ] {
        let reservation = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = reservation.local_addr().unwrap().port();

        let error = super::run(Args {
            port: Some(port),
            memory: true,
            ready_file: Some(directory.path().join(format!("{failure:?}.ready.json"))),
            auth_construction_failure: Some(failure),
            ..Args::default()
        })
        .await
        .expect_err("the injected construction edge must abort startup");
        assert!(
            format!("{error:#}").contains("SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"),
            "unexpected {failure:?} failure: {error:#}",
        );
        // Keeping this sentinel listener alive makes an accidental bind
        // attempt fail with EADDRINUSE instead of the construction code.
        drop(reservation);
    }
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sessions_startup_offloads_sqlite_and_ibex_from_async_workers() {
    use crate::auth::mode::AuthProgramReadiness;
    use crate::contract_types::AuthProviderProfile;
    use crate::local::LocalSnapback;
    use crate::manifest::{
        AuthMode, FunctionDefinition, FunctionKind, FunctionRuntime, IbexModule,
    };

    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let carrier = directory.path().join("startup.json");
    sessions_startup_carrier_with_functions(
        &carrier,
        vec![FunctionDefinition::new(
            "startupProbe",
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = { startupProbe() { return null; } };"
                    .to_owned(),
                export: "startupProbe".to_owned(),
            }),
        )],
    );
    let args = Args {
        db: database.clone(),
        startup_artifacts: Some(carrier),
        ..Args::default()
    };
    let mut snapback = super::startup_blocking(|| LocalSnapback::open(&database)).unwrap();
    let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
        &mut snapback,
        Some(&database),
        AuthProviderProfile::Test,
    )
    .unwrap();
    let readiness = AuthProgramReadiness::new(true, true, true, true, false, false, false);

    let state = super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
        .await
        .unwrap();
    assert_eq!(state.active, AuthMode::Sessions);
    assert!(runtime.catalog_ready());

    // A settled sessions restart takes a separate preflight branch. It
    // must keep Hermes module preparation behind the same blocking
    // boundary as the initial stage/consume path.
    let restarted =
        super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
            .await
            .unwrap();
    assert_eq!(restarted.active, AuthMode::Sessions);
}

/// issues/closed/20260805-doc-comment-artifact-mismatch-no-successor-migration.md:
/// a comment-only source edit rotates only the functions bundle identity.
/// Ordinary startup keeps refusing with named repair paths, while the managed
/// loop's explicit native opt-in activates that complete successor without
/// replacing the database. An incoherent successor remains nonmutating.
#[cfg(unix)]
#[cfg(not(feature = "cli-owner"))]
#[tokio::test]
async fn settled_sessions_pin_refusal_names_supported_repair_paths() {
    use crate::auth::mode::{AuthProgramReadiness, FUNCTION_V1_PREFIX};
    use crate::contract_types::AuthProviderProfile;
    use crate::local::LocalSnapback;
    use crate::manifest::AuthMode;

    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let carrier = directory.path().join("startup.json");
    sessions_startup_carrier(&carrier);
    let mut initial: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&carrier).unwrap()).unwrap();
    initial["schema"]["tables"] = json!([{
        "name": "products",
        "fields": [{
            "name": "name",
            "field_type": "String",
            "optional": false
        }],
        "indexes": [],
        "syncable": true
    }]);
    initial["seed"] = json!({
        "tables": {
            "products": [{ "name": "preserve me" }]
        }
    });
    std::fs::write(&carrier, serde_json::to_vec(&initial).unwrap()).unwrap();
    let args = Args {
        db: database.clone(),
        startup_artifacts: Some(carrier.clone()),
        ..Args::default()
    };
    let mut snapback = LocalSnapback::open(&database).unwrap();
    let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
        &mut snapback,
        Some(&database),
        AuthProviderProfile::Test,
    )
    .unwrap();
    let readiness = AuthProgramReadiness::new(true, true, true, true, false, false, false);
    let settled = super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
        .await
        .unwrap();
    assert_eq!(settled.active, AuthMode::Sessions);
    let persisted_product_count = || {
        crate::storage::LocalDatabase::open(&database)
            .unwrap()
            .table_row_count_for_test("products")
            .unwrap()
    };
    assert_eq!(persisted_product_count(), 1);

    // The doc-comment edit case: only the functions bundle identity moved.
    let mut regenerated: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&carrier).unwrap()).unwrap();
    regenerated["functions"]["bundleHash"] =
        json!(format!("{FUNCTION_V1_PREFIX}{}", "d".repeat(64)));
    regenerated["seed"] = serde_json::Value::Null;
    std::fs::write(&carrier, serde_json::to_vec(&regenerated).unwrap()).unwrap();

    let error = super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
        .await
        .unwrap_err();
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH"
    );
    let details = &error.diagnostic.details;
    assert_ne!(
        details["expectedDeployment"]["bundleHash"], details["observedDeployment"]["bundleHash"],
        "the refusal still carries both exact deployment identities"
    );
    let repair = &details["repair"];
    let keep_data = repair["keepData"].as_str().unwrap();
    assert!(
        keep_data.contains("running server") && keep_data.contains("watch reload"),
        "keepData names the live-evolution migration path: {keep_data}"
    );
    let reseed = repair["reseedFresh"].as_str().unwrap();
    assert!(
        reseed.contains("snapback store export --db")
            && reseed.contains(&database.display().to_string())
            && reseed.contains("snapback reset --dev-fresh --db")
            && reseed.contains("managed whole store")
            && reseed.contains(super::DEV_FRESH_RESET_ARTIFACTS),
        "reseedFresh names the exact whole-store preservation and reset boundaries: {reseed}"
    );
    assert!(
        reseed.contains("custody keyrings/configuration and asset blobs"),
        "{reseed}"
    );
    assert!(
        repair["safety"]
            .as_str()
            .unwrap()
            .contains("deployment identity stored in the selected database"),
        "safety attributes the pin to database deployment state"
    );
    assert!(
        repair["safety"]
            .as_str()
            .unwrap()
            .contains("not from keyrings participating in this comparison")
    );

    let activation_args = Args {
        activate_startup_successor: true,
        ..args.clone()
    };
    let activated =
        super::compose_auth_mode_startup(&activation_args, &mut snapback, &mut runtime, &readiness)
            .await
            .unwrap();
    assert_eq!(activated.active, AuthMode::Sessions);
    assert_eq!(
        activated.active_deployment.as_ref().unwrap().bundle_hash,
        regenerated["functions"]["bundleHash"].as_str().unwrap()
    );
    assert_eq!(
        persisted_product_count(),
        1,
        "the startup successor activation preserves existing application rows"
    );

    // A complete, pair-valid successor can still be unsafe for the existing
    // store. Adding a required field without a backfill must roll back and
    // retain the settled successor pin and product row.
    let mut invalid = regenerated;
    invalid["schema"]["tables"][0]["fields"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "name": "category",
            "field_type": "String",
            "optional": false
        }));
    invalid["schema"]["schemaHash"] = json!(format!(
        "{}{}",
        crate::auth::mode::SCHEMA_V1_PREFIX,
        "f".repeat(64)
    ));
    let invalid_inputs = format!("{}{}", crate::auth::mode::INPUTS_V1_PREFIX, "e".repeat(64));
    invalid["schema"]["inputsHash"] = json!(&invalid_inputs);
    invalid["functions"]["inputsHash"] = json!(invalid_inputs);
    std::fs::write(&carrier, serde_json::to_vec(&invalid).unwrap()).unwrap();
    let invalid_error =
        super::compose_auth_mode_startup(&activation_args, &mut snapback, &mut runtime, &readiness)
            .await
            .unwrap_err();
    assert_eq!(
        invalid_error.diagnostic.code,
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH"
    );
    assert_eq!(
        invalid_error.diagnostic.details["activationFailure"]["code"],
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED"
    );
    assert_eq!(persisted_product_count(), 1);
    let after_invalid = snapback
        .remainder_auth_database_mut()
        .auth_mode_snapshot()
        .unwrap();
    assert_eq!(
        after_invalid.state.active_deployment, activated.active_deployment,
        "an invalid schema successor does not move the durable deployment pin"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn pending_missing_carrier_quarantines_and_explicit_clear_restores_dev() {
    use crate::auth::mode::{AuthModeStatus, AuthProgramReadiness};
    use crate::contract_types::AuthProviderProfile;
    use crate::local::LocalSnapback;
    use crate::manifest::AuthMode;

    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let carrier = directory.path().join("startup.json");
    sessions_startup_carrier(&carrier);
    let mut snapback = LocalSnapback::open(&database).unwrap();
    let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
        &mut snapback,
        Some(&database),
        AuthProviderProfile::Test,
    )
    .unwrap();
    let readiness = AuthProgramReadiness::item4(true);
    let stage = Args {
        db: database.clone(),
        startup_artifacts: Some(carrier),
        ..Args::default()
    };
    super::compose_auth_mode_startup(&stage, &mut snapback, &mut runtime, &readiness)
        .await
        .unwrap();

    let missing = Args {
        db: database.clone(),
        ..Args::default()
    };
    let missing_state =
        super::compose_auth_mode_startup(&missing, &mut snapback, &mut runtime, &readiness)
            .await
            .unwrap();
    assert_eq!(missing_state.mode_state, AuthModeStatus::Quarantined);
    assert_eq!(
        missing_state
            .quarantine
            .as_ref()
            .map(|value| value.code.as_str()),
        Some("SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED")
    );

    let clear = Args {
        db: database,
        clear_desired_auth_mode: true,
        ..Args::default()
    };
    let settled = super::compose_auth_mode_startup(&clear, &mut snapback, &mut runtime, &readiness)
        .await
        .unwrap();
    assert_eq!(settled.active, AuthMode::Dev);
    assert_eq!(settled.desired, AuthMode::Dev);
    assert_eq!(settled.mode_state, AuthModeStatus::Settled);
    assert!(settled.requested_deployment.is_none());
    assert!(settled.quarantine.is_none());
}

#[test]
fn auth_transport_matrix_has_no_sessions_plaintext_override() {
    use crate::auth::mode::AuthModeStateRecord;
    use crate::contract_types::ServerProfile;
    use crate::manifest::AuthMode;

    let dev = AuthModeStateRecord::initial_dev(None);
    let remote = "192.0.2.10".parse().unwrap();
    let refused =
        super::validate_auth_transport(remote, ServerProfile::Dev, &dev, false).unwrap_err();
    assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_TRANSPORT_INSECURE");
    super::validate_auth_transport(remote, ServerProfile::Dev, &dev, true).unwrap();
    assert!(super::validate_auth_transport(remote, ServerProfile::Prod, &dev, true).is_err());
    super::validate_auth_transport(
        "127.0.0.1".parse().unwrap(),
        ServerProfile::Prod,
        &dev,
        false,
    )
    .unwrap();

    let mut active_sessions = dev.clone();
    active_sessions.active = AuthMode::Sessions;
    active_sessions.desired = AuthMode::Sessions;
    let refused =
        super::validate_auth_transport(remote, ServerProfile::Test, &active_sessions, true)
            .unwrap_err();
    assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_TRANSPORT_INSECURE");

    let mut desired_sessions = dev;
    desired_sessions.desired = AuthMode::Sessions;
    let refused =
        super::validate_auth_transport(remote, ServerProfile::Demo, &desired_sessions, true)
            .unwrap_err();
    assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_TRANSPORT_INSECURE");

    // This proves only the local listener rule. LLP 0060 deliberately does
    // not infer anything about a reverse proxy from a loopback address.
    super::validate_auth_transport(
        "::1".parse().unwrap(),
        ServerProfile::Prod,
        &active_sessions,
        false,
    )
    .unwrap();
}

#[test]
fn auth_logical_transfer_backup_restore_and_declared_startup_have_closed_cli_spellings() {
    let export = Cli::parse_from([
        "snapback",
        "auth",
        "export",
        "--db",
        "app.sqlite3",
        "--output",
        "auth-logical.json",
    ]);
    assert!(matches!(
        export.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Export { .. }
        })
    ));

    let import = Cli::parse_from([
        "snapback",
        "auth",
        "import",
        "--from",
        "auth-logical.json",
        "--db",
        "fresh.sqlite3",
    ]);
    assert!(matches!(
        import.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Import { .. }
        })
    ));

    let backup = Cli::parse_from([
        "snapback",
        "auth",
        "backup",
        "--db",
        "app.sqlite3",
        "--output",
        "backup",
    ]);
    assert!(matches!(
        backup.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Backup { .. }
        })
    ));

    let restore = Cli::parse_from([
        "snapback",
        "auth",
        "restore",
        "--from",
        "backup",
        "--db",
        "restored/app.sqlite3",
    ]);
    assert!(matches!(
        restore.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Restore { .. }
        })
    ));

    let start = Cli::parse_from([
        "snapback",
        "start",
        "--db",
        "restored/app.sqlite3",
        "--restored-from-backup",
        "019b0000-0000-7000-8000-000000000000",
    ]);
    assert!(matches!(
        start.command,
        Some(HostCommand::Start(Args {
            restored_from_backup: Some(_),
            ..
        }))
    ));
    assert!(
        Cli::try_parse_from([
            "snapback",
            "start",
            "--memory",
            "--restored-from-backup",
            "019b0000-0000-7000-8000-000000000000",
        ])
        .is_err()
    );
}

#[test]
fn password_auth_cli_has_only_non_argv_password_and_session_carriers() {
    let stdin_argv = [
        "snapback",
        "auth",
        "password",
        "signup",
        "--url",
        "http://127.0.0.1:4287",
        "--email",
        "person@example.com",
        "--password-stdin",
    ];
    let submitted_password = "password-read-only-from-stdin";
    assert!(
        stdin_argv
            .iter()
            .all(|argument| !argument.contains(submitted_password))
    );
    let parsed = Cli::parse_from(stdin_argv);
    assert!(matches!(
        parsed.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Password {
                command: AuthPasswordCommand::Signup { password, .. }
            }
        }) if password.password_stdin && password.password_fd.is_none()
    ));
    let values = super::read_auth_secret_lines(
        std::io::Cursor::new(format!("{submitted_password}\n")),
        1,
        "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID",
        "password carrier",
    )
    .expect("stdin password carrier");
    assert_eq!(values[0].as_str(), submitted_password);

    let descriptor = Cli::parse_from([
        "snapback",
        "auth",
        "password",
        "signin",
        "--url",
        "http://127.0.0.1:4287",
        "--email",
        "person@example.com",
        "--password-fd",
        "9",
    ]);
    assert!(matches!(
        descriptor.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Password {
                command: AuthPasswordCommand::Signin { password, .. }
            }
        }) if !password.password_stdin && password.password_fd == Some(9)
    ));

    let change = Cli::parse_from([
        "snapback",
        "auth",
        "password",
        "change",
        "--url",
        "http://127.0.0.1:4287",
        "--session-token-stdin",
        "--password-stdin",
    ]);
    assert!(matches!(
        change.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Password {
                command: AuthPasswordCommand::Change {
                    session,
                    password,
                    ..
                }
            }
        }) if session.session_token_stdin && password.password_stdin
    ));
    let combined = super::read_auth_secret_lines(
        std::io::Cursor::new("sbs_session\ncurrent-password\nnew-password\n"),
        3,
        "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID",
        "combined session-token/password carrier",
    )
    .expect("combined stdin carrier");
    assert_eq!(combined[0].as_str(), "sbs_session");
    assert_eq!(combined[1].as_str(), "current-password");
    assert_eq!(combined[2].as_str(), "new-password");

    let argv_password = Cli::try_parse_from([
        "snapback",
        "auth",
        "password",
        "signup",
        "--url",
        "http://127.0.0.1:4287",
        "--email",
        "person@example.com",
        "--password",
        submitted_password,
    ])
    .expect_err("password argv flag must not exist");
    assert_eq!(
        argv_password.kind(),
        clap::error::ErrorKind::UnknownArgument
    );

    let missing_carrier = Cli::try_parse_from([
        "snapback",
        "auth",
        "password",
        "signup",
        "--url",
        "http://127.0.0.1:4287",
        "--email",
        "person@example.com",
    ])
    .expect_err("password carrier must be required by clap");
    assert_eq!(
        missing_carrier.kind(),
        clap::error::ErrorKind::MissingRequiredArgument
    );

    let environment_argv = super::password_environment_carrier_argv(
        [
            "snapback",
            "auth",
            "password",
            "signup",
            "--url",
            "http://127.0.0.1:4287",
            "--email",
            "person@example.com",
        ]
        .into_iter()
        .map(OsString::from)
        .collect(),
        true,
    );
    assert!(
        environment_argv
            .iter()
            .all(|argument| argument != submitted_password)
    );
    let environment = Cli::try_parse_from(environment_argv)
        .expect("dev/test environment carrier marker satisfies the closed clap group");
    assert!(matches!(
        environment.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Password {
                command: AuthPasswordCommand::Signup { password, .. }
            }
        }) if password.password_environment
            && !password.password_stdin
            && password.password_fd.is_none()
    ));
}

#[test]
fn password_auth_cli_spells_reset_recovery_and_admin_unlock_exactly() {
    let reset = Cli::parse_from([
        "snapback",
        "auth",
        "password",
        "reset",
        "--url",
        "http://127.0.0.1:4287",
        "--challenge-id",
        "sbc_challenge",
        "--code",
        "123456",
        "--password-stdin",
    ]);
    assert!(matches!(
        reset.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Password {
                command: AuthPasswordCommand::Reset { .. }
            }
        })
    ));

    let consume = Cli::parse_from([
        "snapback",
        "auth",
        "recovery",
        "consume",
        "--url",
        "http://127.0.0.1:4287",
        "--email",
        "person@example.com",
        "--code",
        "sbrv1_recovery",
    ]);
    assert!(matches!(
        consume.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Recovery {
                command: AuthRecoveryCommand::Consume { .. }
            }
        })
    ));

    let rotate = Cli::parse_from([
        "snapback",
        "auth",
        "recovery",
        "rotate",
        "--url",
        "http://127.0.0.1:4287",
        "--session-token-file",
        "session-token.txt",
    ]);
    assert!(matches!(
        rotate.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Recovery {
                command: AuthRecoveryCommand::Rotate { session, .. }
            }
        }) if session.session_token_file == Some(PathBuf::from("session-token.txt"))
    ));

    let unlock = Cli::parse_from([
        "snapback",
        "auth",
        "password",
        "unlock",
        "--url",
        "http://127.0.0.1:4287",
        "--email",
        "person@example.com",
    ]);
    assert!(matches!(
        unlock.command,
        Some(HostCommand::Auth {
            command: AuthCommand::Password {
                command: AuthPasswordCommand::Unlock { .. }
            }
        })
    ));
}

#[test]
fn password_environment_is_dev_test_only_with_typed_profile_refusal() {
    for profile in [Some("dev"), Some("test")] {
        super::password_non_stdin_profile_allowed(
            profile,
            "https://remote.example",
            "SNAPBACK_PASSWORD",
        )
        .expect("dev/test env password carrier");
    }
    super::password_non_stdin_profile_allowed(None, "http://127.0.0.1:4287", "SNAPBACK_PASSWORD")
        .expect("zero-config loopback is dev");
    for profile in [Some("demo"), Some("prod"), Some("production")] {
        let error = super::password_non_stdin_profile_allowed(
            profile,
            "http://127.0.0.1:4287",
            "SNAPBACK_PASSWORD",
        )
        .expect_err("non-dev/test profile must refuse SNAPBACK_PASSWORD");
        assert!(error.to_string().starts_with("SNAPBACK_PROFILE_FORBIDS:"));
    }
    let remote_default = super::password_non_stdin_profile_allowed(
        None,
        "https://remote.example",
        "SNAPBACK_PASSWORD",
    )
    .expect_err("remote default is production");
    assert!(
        remote_default
            .to_string()
            .starts_with("SNAPBACK_PROFILE_FORBIDS:")
    );
    let descriptor = super::password_non_stdin_profile_allowed(
        Some("production"),
        "http://127.0.0.1:4287",
        "--password-fd",
    )
    .expect_err("stdin must be the only production password carrier");
    assert!(
        descriptor
            .to_string()
            .starts_with("SNAPBACK_PROFILE_FORBIDS:")
    );
}

#[test]
fn password_signup_cli_renders_recovery_codes_exactly_once() {
    let codes = (0..8)
        .map(|index| format!("sbrv1_{index:02}{}", "A".repeat(25)))
        .collect::<Vec<_>>();
    let response = json!({
        "tokenType": "Bearer",
        "token": "sbs_success",
        "refreshAfter": 1,
        "session": { "id": "ses_1" },
        "authorityDescriptor": { "authorityInstanceId": "aut_1" },
        "recoveryCodes": codes,
    });
    let rendered = super::render_auth_cli_success(&response).expect("render signup response");
    assert!(rendered.starts_with("Store these recovery codes now; they cannot be shown again.\n"));
    for code in response["recoveryCodes"].as_array().unwrap() {
        assert_eq!(rendered.matches(code.as_str().unwrap()).count(), 1);
    }
}

#[test]
#[cfg(not(feature = "cli-owner"))]
fn auth_logical_cli_moves_identity_facts_between_file_databases() {
    let directory = tempfile::tempdir().unwrap();
    let source_path = directory.path().join("source.sqlite3");
    let target_path = directory.path().join("target.sqlite3");
    let artifact_path = directory.path().join("auth-logical.json");

    {
        let mut source = crate::storage::LocalDatabase::open(&source_path).unwrap();
        source.activate_current_auth_catalog().unwrap();
    }
    let mut source = crate::storage::LocalDatabase::open(&source_path).unwrap();
    source
        .insert_logical_email_identity_for_test("cli-human", "cli-identity", "cli@example.com", 2)
        .unwrap();
    drop(source);
    {
        let mut target = crate::storage::LocalDatabase::open(&target_path).unwrap();
        target.activate_current_auth_catalog().unwrap();
    }

    super::auth_logical_export(&source_path, &artifact_path).unwrap();
    super::auth_logical_import(&artifact_path, &target_path).unwrap();

    let artifact = crate::auth::logical_transfer::read_artifact(&artifact_path).unwrap();
    let target = crate::storage::LocalDatabase::open(&target_path).unwrap();
    assert_eq!(target.auth_logical_export().unwrap(), artifact);
}

#[test]
fn store_describe_and_export_have_closed_cli_spellings() {
    let describe = Cli::parse_from(["snapback", "store", "describe", "--db", "app.sqlite3"]);
    assert!(matches!(
        describe.command,
        Some(HostCommand::Store {
            command: StoreCommand::Describe { .. }
        })
    ));

    let export = Cli::parse_from([
        "snapback",
        "store",
        "export",
        "--db",
        "app.sqlite3",
        "--output",
        "copy",
    ]);
    assert!(matches!(
        export.command,
        Some(HostCommand::Store {
            command: StoreCommand::Export { .. }
        })
    ));
}

#[test]
#[cfg(not(feature = "cli-owner"))]
fn declared_restore_telemetry_rotates_only_for_applied_and_preserves_replay_boot_evidence() {
    let directory = tempfile::tempdir().unwrap();
    let database_path = directory.path().join("app.sqlite3");
    let mut snapback = crate::local::LocalSnapback::open(&database_path).unwrap();
    let telemetry = snapback.telemetry();
    telemetry.force_flush().unwrap();
    let generation_before = telemetry.durable_meta_for_test().unwrap().generation;
    telemetry.point(
        "lifecycle",
        "current_boot_replay_witness",
        Some(200),
        None,
        None,
        None,
        crate::telemetry::Priority::Reserved,
    );
    let boot_depth = telemetry.diagnostics().depth;

    super::apply_declared_restore_telemetry_outcome(
        &mut snapback,
        crate::auth::lifecycle::DeclaredRestoreOutcome::AlreadyApplied,
    )
    .unwrap();
    assert_eq!(
        telemetry.diagnostics().depth,
        boot_depth,
        "idempotent replay must not clear this boot's process evidence"
    );
    telemetry.force_flush().unwrap();
    let generation_after_replay = telemetry.durable_meta_for_test().unwrap().generation;
    assert_eq!(generation_after_replay, generation_before);
    assert_eq!(
        telemetry.event_count_for_test("lifecycle", "process_start", "point"),
        1,
        "the replayed start keeps the current boot marker visible"
    );
    assert_eq!(
        telemetry.event_count_for_test("lifecycle", "current_boot_replay_witness", "point",),
        1,
        "the replay leaves already-admitted current-boot evidence buffered"
    );
    assert_eq!(
        telemetry.event_count_for_test("lifecycle", "restore_generation_rotation", "point",),
        0,
        "AlreadyApplied emits no restore rotation marker"
    );

    super::apply_declared_restore_telemetry_outcome(
        &mut snapback,
        crate::auth::lifecycle::DeclaredRestoreOutcome::Applied {
            sessions_revoked: 0,
            challenges_deleted: 0,
        },
    )
    .unwrap();
    telemetry.force_flush().unwrap();
    let generation_after_apply = telemetry.durable_meta_for_test().unwrap().generation;
    assert_ne!(generation_after_apply, generation_before);
    assert_eq!(
        telemetry.event_count_for_test("lifecycle", "restore_generation_rotation", "point",),
        1,
        "only Applied rotates and emits the restore marker"
    );
}

#[tokio::test]
#[cfg(not(feature = "cli-owner"))]
async fn physical_restore_is_quarantined_until_exact_prebind_declaration() {
    let directory = tempfile::tempdir().unwrap();
    let source_database = directory.path().join("source.sqlite3");
    let mut database = crate::storage::LocalDatabase::open(&source_database).unwrap();
    let keyring = crate::auth::keyring::AuthKeyringStore::file_for_database(&source_database);
    crate::auth::lifecycle::activate_catalog(
        &mut database,
        &keyring,
        1_700_000_000_000,
        &crate::auth::crypto::OsRandom,
    )
    .unwrap();
    let key_id = keyring
        .with_active_key(
            1_700_000_000_000,
            &crate::auth::crypto::OsRandom,
            |id, _| id.as_str().to_owned(),
        )
        .unwrap();
    let user_id = uuid::Uuid::now_v7().to_string();
    let identity_id = uuid::Uuid::now_v7().to_string();
    let session_id = uuid::Uuid::now_v7().to_string();
    let authority_instance_id = uuid::Uuid::now_v7().to_string();
    database
        .auth_catalog()
        .insert_restore_cli_fixture_for_test(
            &user_id,
            &identity_id,
            &session_id,
            &authority_instance_id,
            &key_id,
        )
        .unwrap();
    drop(database);

    let backup = directory.path().join("backup");
    super::auth_backup(&source_database, &backup).await.unwrap();
    let restored_database = directory.path().join("restored").join("app.sqlite3");
    let competing_restore =
        TargetInstanceReservation::acquire(&restored_database).expect("reserve restore target");
    let reserved = super::auth_restore(&backup, &restored_database)
        .expect_err("concurrent restore reservation must fail before publication");
    assert!(
        reserved
            .to_string()
            .contains("target instance is already reserved")
    );
    assert!(!restored_database.parent().unwrap().exists());
    drop(competing_restore);
    super::auth_restore(&backup, &restored_database).unwrap();
    let declaration_path = restored_database
        .parent()
        .unwrap()
        .join(crate::auth::lifecycle::RESTORE_DECLARATION_FILE);
    let declaration = crate::auth::lifecycle::RestoreDeclaration::parse(
        &crate::secure_file::read_owner_only(&declaration_path).unwrap(),
    )
    .unwrap();

    let ready = directory.path().join("restored.ready.json");
    let missing = super::run(Args {
        host: "127.0.0.1".to_owned(),
        port: Some(0),
        db: restored_database.clone(),
        memory: false,
        hosted_edge: None,
        hosted_admission: None,
        ready_file: Some(ready.clone()),
        restored_from_backup: None,
        startup_artifacts: None,
        activate_startup_successor: false,
        derived_fork_arm_writer_coverage: false,
        trusted_composition_activation: None,
        clear_desired_auth_mode: false,
        allow_auth_downgrade: false,
        allow_insecure_dev_auth: false,
        cron_disabled: false,
        auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
        auth_construction_failure: None,
    })
    .await
    .expect_err("restored rows must not reach a listener without declaration authority");
    assert!(missing.to_string().contains("--restored-from-backup"));
    assert!(!ready.exists());

    let declaration_id = declaration.declaration_id().to_owned();
    let server = tokio::spawn(super::run(Args {
        host: "127.0.0.1".to_owned(),
        port: Some(0),
        db: restored_database.clone(),
        memory: false,
        ready_file: Some(ready.clone()),
        restored_from_backup: Some(declaration_id),
        hosted_edge: None,
        hosted_admission: None,
        startup_artifacts: None,
        activate_startup_successor: false,
        derived_fork_arm_writer_coverage: false,
        trusted_composition_activation: None,
        clear_desired_auth_mode: false,
        allow_auth_downgrade: false,
        allow_insecure_dev_auth: false,
        cron_disabled: false,
        auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
        auth_construction_failure: None,
    }));
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !ready.exists() {
        if server.is_finished() {
            let outcome = server.await;
            panic!("declared restore startup exited before readiness: {outcome:?}");
        }
        assert!(
            std::time::Instant::now() < deadline,
            "declared restore never reached readiness"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    server.abort();
    let _ = server.await;
    assert!(!declaration_path.exists());

    let restored = crate::storage::LocalDatabase::open(&restored_database).unwrap();
    let facts = restored
        .auth_catalog_read()
        .restored_counts_for_test(&session_id)
        .unwrap();
    assert_eq!(facts, (0, 0));
}

#[test]
fn secret_read_mint_is_structurally_ready_file_only() {
    assert!(
        Cli::try_parse_from([
            "snapback",
            "secret-read-mint",
            "--url",
            "http://127.0.0.1:4287",
            "--admin-inspect",
        ])
        .is_err()
    );
    assert!(
        Cli::try_parse_from([
            "snapback",
            "secret-read-mint",
            "--ready-file",
            "ready.json",
            "--admin-inspect",
        ])
        .is_ok()
    );
}

#[test]
fn asset_gc_sweep_cli_requires_and_preserves_the_injected_clock() {
    let parsed = Cli::parse_from([
        "snapback",
        "assets",
        "gc-sweep",
        "--now-ms",
        "1785484800000",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    match parsed.command {
        Some(HostCommand::Assets {
            command: AssetsCommand::GcSweep { target, now_ms },
        }) => {
            assert_eq!(now_ms, 1_785_484_800_000);
            assert_eq!(target.url.as_deref(), Some("http://127.0.0.1:4287"));
        }
        other => panic!("expected asset gc-sweep command, got {other:?}"),
    }
    assert!(
        Cli::try_parse_from([
            "snapback",
            "assets",
            "gc-sweep",
            "--url",
            "http://127.0.0.1:4287",
        ])
        .is_err(),
        "gc-sweep must never fall back to the ambient wall clock"
    );
}

#[test]
fn session_mint_cli_calls_host_op_with_closed_email_args_and_capability() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("ready.json");
    let canonical_ready = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("ready.json");
    let sidecar =
        crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
    let (_registry, operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce-session-mint".to_owned(),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    operator
        .publish_with(&canonical_ready, |path, bytes| {
            crate::secure_file::write_owner_only(path, bytes)
        })
        .unwrap();
    let expected_capability = std::fs::read_to_string(&sidecar).unwrap();

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for index in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            let body = if index == 0 {
                health_with_nonce("nonce-session-mint")
            } else {
                json!({
                    "ok": true,
                    "operation": "auth.mintSession",
                    "data": { "tokenType": "Bearer", "token": "sbss_ordinary" },
                })
            };
            write_http_json(&mut stream, &body);
            requests.push(request);
        }
        requests
    });

    let mut descriptor = stop_descriptor(Some("nonce-session-mint"));
    descriptor.server_url = format!("http://{address}");
    descriptor.target.server_url = Some(descriptor.server_url.clone());
    descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
    crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
        .unwrap();

    let parsed = Cli::parse_from([
        "snapback",
        "session",
        "mint",
        "--email",
        "x@example.com",
        "--ready-file",
        ready.to_str().unwrap(),
    ]);
    let (target, email) = match parsed.command {
        Some(HostCommand::Session {
            command: SessionCommand::Mint { target, email },
        }) => (target, email),
        other => panic!("expected session mint command, got {other:?}"),
    };
    super::post_host_op(&target, super::mint_session_request(email)).unwrap();

    let requests = server.join().unwrap();
    assert!(requests[0].starts_with("GET /health "));
    assert!(requests[1].starts_with("POST /_snapback/api/host-ops "));
    assert!(requests[1].lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.eq_ignore_ascii_case(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
            && value.trim() == expected_capability
    }));
    let (_, body) = requests[1].split_once("\r\n\r\n").unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(body).unwrap(),
        json!({
            "operation": "auth.mintSession",
            "args": { "email": "x@example.com" },
        })
    );
}

#[test]
fn session_mint_ready_file_attaches_file_database_minted_admin_token() {
    let ready_dir = tempfile::tempdir().unwrap();
    let database_dir = tempfile::tempdir().unwrap();
    let ready = ready_dir.path().join("ready.json");
    let canonical_ready = std::fs::canonicalize(ready_dir.path())
        .unwrap()
        .join("ready.json");
    let database = std::fs::canonicalize(database_dir.path())
        .unwrap()
        .join("app.sqlite3");
    let admin_token_file = crate::admin::admin_token_sibling(&database);
    let minted_admin_token = "sbat_file_database_session_mint";
    crate::secure_file::write_owner_only(&admin_token_file, minted_admin_token.as_bytes()).unwrap();

    let sidecar =
        crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
    let (_registry, operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce-file-session-mint".to_owned(),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    operator
        .publish_with(&canonical_ready, |path, bytes| {
            crate::secure_file::write_owner_only(path, bytes)
        })
        .unwrap();

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for index in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            let body = if index == 0 {
                health_with_nonce("nonce-file-session-mint")
            } else {
                json!({
                    "ok": true,
                    "operation": "auth.mintSession",
                    "data": { "tokenType": "Bearer", "token": "sbss_ordinary" },
                })
            };
            write_http_json(&mut stream, &body);
            requests.push(request);
        }
        requests
    });

    let mut descriptor = stop_descriptor(Some("nonce-file-session-mint"));
    descriptor.server_url = format!("http://{address}");
    descriptor.target.server_url = Some(descriptor.server_url.clone());
    descriptor.database.mode = "file".to_owned();
    descriptor.database.path = Some(database.display().to_string());
    descriptor.admin_token_file = Some(admin_token_file.display().to_string());
    descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
    crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
        .unwrap();

    let target = TargetArgs {
        url: None,
        ready_file: Some(ready),
        token: None,
        impersonation_capability_stdin: false,
    };
    super::post_host_op(
        &target,
        super::mint_session_request("x@example.com".to_owned()),
    )
    .unwrap();

    let expected_admin_token = std::env::var("SNAPBACK_ADMIN_TOKEN")
        .ok()
        .filter(|token| !token.is_empty())
        .unwrap_or_else(|| minted_admin_token.to_owned());
    let requests = server.join().unwrap();
    assert!(requests[0].starts_with("GET /health "));
    assert!(requests[1].starts_with("POST /_snapback/api/host-ops "));
    assert!(requests[1].lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.eq_ignore_ascii_case("x-snapback-admin-token") && value.trim() == expected_admin_token
    }));
}

#[test]
fn session_mint_cli_output_is_only_the_host_op_session_json() {
    let impersonation_capability = "sbic_operator_capability_must_not_be_printed";
    let session_result = json!({
        "schemaVersion": "snapback.v0",
        "resultKind": "hostOpsResult",
        "operation": "auth.mintSession",
        "ok": true,
        "data": {
            "tokenType": "Bearer",
            "token": "sbss_ordinary_session",
            "session": { "userId": "user_x" },
        },
        "diagnostics": [],
    });
    let mut output = Vec::new();

    assert!(super::write_envelope_to(&session_result, &mut output).unwrap());

    let output = String::from_utf8(output).unwrap();
    assert_eq!(
        output,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&session_result).unwrap()
        )
    );
    assert!(!output.contains(impersonation_capability));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&output).unwrap(),
        session_result
    );
}

#[test]
fn session_mint_cli_requires_email() {
    let error = Cli::try_parse_from([
        "snapback",
        "session",
        "mint",
        "--url",
        "http://127.0.0.1:4287",
    ])
    .expect_err("session mint without --email must be refused");

    assert_eq!(
        error.kind(),
        clap::error::ErrorKind::MissingRequiredArgument
    );
    assert!(error.to_string().contains("--email"));
}

#[test]
fn run_args_must_be_json_object() {
    assert!(parse_run_args(Some(r#"{"title":"hello"}"#.to_owned())).is_ok());

    let error = parse_run_args(Some(r#"["hello"]"#.to_owned())).unwrap_err();
    assert!(error.to_string().contains("--args must be a JSON object"));
}

#[test]
fn network_profile_cli_maps_get_and_set_without_reinterpreting_profiles() {
    let get = Cli::parse_from([
        "snapback",
        "network-profile",
        "get",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        get.command,
        Some(HostCommand::NetworkProfile {
            command: NetworkProfileCommand::Get { .. }
        })
    ));

    let set = Cli::parse_from([
        "snapback",
        "network-profile",
        "set",
        "optimistic",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        set.command,
        Some(HostCommand::NetworkProfile {
            command: NetworkProfileCommand::Set { profile, .. }
        }) if profile == "optimistic"
    ));
    assert_eq!(
        parse_network_profile_selection("optimistic").unwrap(),
        json!("optimistic")
    );
    assert_eq!(
            parse_network_profile_selection(
                r#"{"name":"tiny","mutationAckDelayMs":1,"liveDeltaDelayMs":2,"queryResponseDelayMs":3}"#
            )
            .unwrap()["name"],
            "tiny"
        );
}

// @ref LLP 0184#project-the-shipped-long-tail — parse coverage for the
// Phase 2 P1 read/diagnose and P2 controlled-mutation CLI projections.
// These only assert clap wiring; HTTP behavior is covered by
// mcp-control.test.mjs's real-server acceptance because the equivalent
// MCP tools share the same served routes.
#[test]
fn data_scan_cli_parses_table_bounds_and_target() {
    let parsed = Cli::parse_from([
        "snapback",
        "data",
        "scan",
        "messages",
        "--limit",
        "20",
        "--offset",
        "40",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        parsed.command,
        Some(HostCommand::Data {
            command: DataCommand::Scan {
                table,
                limit: 20,
                offset: 40,
                ..
            }
        }) if table == "messages"
    ));
}

#[test]
fn config_read_and_verify_cli_verbs_parse() {
    let status = Cli::parse_from([
        "snapback",
        "config",
        "status",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        status.command,
        Some(HostCommand::Config {
            command: ConfigCommand::Status { .. }
        })
    ));

    let plan = Cli::parse_from([
        "snapback",
        "config",
        "plan",
        "--entry",
        "stripe.secretKey",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        plan.command,
        Some(HostCommand::Config {
            command: ConfigCommand::Plan { entry: Some(entry), .. }
        }) if entry == "stripe.secretKey"
    ));

    let verify = Cli::parse_from([
        "snapback",
        "config",
        "verify",
        "stripe.secretKey",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        verify.command,
        Some(HostCommand::Config {
            command: ConfigCommand::Verify { entry, .. }
        }) if entry == "stripe.secretKey"
    ));
}

#[test]
fn config_set_cli_requires_exactly_one_non_argv_carrier() {
    let stdin = Cli::parse_from([
        "snapback",
        "config",
        "set",
        "--entry",
        "stripe.secretKey",
        "--value-stdin",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        stdin.command,
        Some(HostCommand::Config {
            command: ConfigCommand::Set {
                entry,
                value_stdin: true,
                value_fd: None,
                append: false,
                ..
            }
        }) if entry == "stripe.secretKey"
    ));

    let descriptor = Cli::parse_from([
        "snapback",
        "config",
        "set",
        "--entry",
        "stripe.secretKey",
        "--value-fd",
        "9",
        "--append",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        descriptor.command,
        Some(HostCommand::Config {
            command: ConfigCommand::Set {
                value_stdin: false,
                value_fd: Some(9),
                append: true,
                ..
            }
        })
    ));

    assert!(
        Cli::try_parse_from([
            "snapback",
            "config",
            "set",
            "--entry",
            "stripe.secretKey",
            "--url",
            "http://127.0.0.1:4287",
        ])
        .is_err()
    );
    assert!(
        Cli::try_parse_from([
            "snapback",
            "config",
            "set",
            "--entry",
            "stripe.secretKey",
            "--value-stdin",
            "--value-fd",
            "9",
        ])
        .is_err()
    );
}

#[test]
fn jobs_list_and_show_cli_verbs_parse() {
    let list = Cli::parse_from(["snapback", "jobs", "list", "--url", "http://127.0.0.1:4287"]);
    assert!(matches!(
        list.command,
        Some(HostCommand::Jobs {
            command: JobsCommand::List { .. }
        })
    ));

    let show = Cli::parse_from([
        "snapback",
        "jobs",
        "show",
        "job_01h8x2",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        show.command,
        Some(HostCommand::Jobs {
            command: JobsCommand::Show { id, .. }
        }) if id == "job_01h8x2"
    ));
}

#[test]
fn config_unset_cli_parses_entry_and_target() {
    let parsed = Cli::parse_from([
        "snapback",
        "config",
        "unset",
        "--entry",
        "stripe.secretKey",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        parsed.command,
        Some(HostCommand::Config {
            command: ConfigCommand::Unset { entry, .. }
        }) if entry == "stripe.secretKey"
    ));
}

#[test]
fn cron_cli_parses_list_tick_and_run() {
    let list = Cli::parse_from(["snapback", "cron", "list", "--url", "http://127.0.0.1:4287"]);
    assert!(matches!(
        list.command,
        Some(HostCommand::Cron {
            command: CronCommand::List { .. }
        })
    ));

    let tick = Cli::parse_from(["snapback", "cron", "tick", "--url", "http://127.0.0.1:4287"]);
    assert!(matches!(
        tick.command,
        Some(HostCommand::Cron {
            command: CronCommand::Tick { .. }
        })
    ));

    let run = Cli::parse_from([
        "snapback",
        "cron",
        "run",
        "nightly-digest",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        run.command,
        Some(HostCommand::Cron {
            command: CronCommand::Run { name, .. }
        }) if name == "nightly-digest"
    ));
}

#[test]
fn ephemeral_cleanup_cli_requires_cutoff_mode_and_bound() {
    let preview = Cli::parse_from([
        "snapback",
        "ephemeral",
        "cleanup",
        "--older-than-ms",
        "60000",
        "--dry-run",
        "--max-entries",
        "25",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        preview.command,
        Some(HostCommand::Ephemeral {
            command: EphemeralCommand::Cleanup {
                older_than_ms: Some(60_000),
                dry_run: true,
                max_entries: 25,
                ..
            }
        })
    ));

    let apply = Cli::parse_from([
        "snapback",
        "ephemeral",
        "cleanup",
        "--cutoff-timestamp-ms",
        "1700000000000",
        "--apply",
    ]);
    assert!(matches!(
        apply.command,
        Some(HostCommand::Ephemeral {
            command: EphemeralCommand::Cleanup {
                cutoff_timestamp_ms: Some(1_700_000_000_000),
                apply: true,
                max_entries: 1_000,
                ..
            }
        })
    ));

    assert!(
        Cli::try_parse_from(["snapback", "ephemeral", "cleanup", "--older-than-ms", "0",]).is_err(),
        "cleanup must explicitly select preview or apply"
    );
}

#[test]
fn jobs_drain_cli_parses_injected_clock_and_waves() {
    let parsed = Cli::parse_from([
        "snapback",
        "jobs",
        "drain",
        "--url",
        "http://127.0.0.1:4287",
        "--now-ms",
        "1700000000000",
        "--max-waves",
        "3",
    ]);
    assert!(matches!(
        parsed.command,
        Some(HostCommand::Jobs {
            command: JobsCommand::Drain {
                now_ms: Some(1_700_000_000_000),
                max_waves: Some(3),
                ..
            }
        })
    ));
}

#[test]
fn connections_disconnect_cli_requires_a_reason() {
    let parsed = Cli::parse_from([
        "snapback",
        "connections",
        "disconnect",
        "conn_abc123",
        "--reason",
        "stuck presence repair",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        parsed.command,
        Some(HostCommand::Connections {
            command: ConnectionsCommand::Disconnect { connection_id, reason, .. }
        }) if connection_id == "conn_abc123" && reason == "stuck presence repair"
    ));

    let missing_reason = Cli::try_parse_from([
        "snapback",
        "connections",
        "disconnect",
        "conn_abc123",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(missing_reason.is_err());
}

/// @ref LLP 0184#b-forced-live-resync--add-now — `snapback debug
/// force-resync` parses connection id, subscription id, reason, and
/// the optional `--clear-retained`/`--startup-nonce` flags; a missing
/// reason (a required closed operator/test disclosure, matching
/// `connections disconnect`'s precedent) is refused at parse time.
#[test]
fn debug_force_resync_cli_parses_required_and_optional_fields() {
    let parsed = Cli::parse_from([
        "snapback",
        "debug",
        "force-resync",
        "--connection-id",
        "conn_abc123",
        "--subscription-id",
        "sub_def456",
        "--reason",
        "acceptance test",
        "--clear-retained",
        "--startup-nonce",
        "explicit-nonce",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        parsed.command,
        Some(HostCommand::Debug {
            command: DebugCommand::ForceResync {
                ref connection_id,
                ref subscription_id,
                ref reason,
                clear_retained: true,
                startup_nonce: Some(ref startup_nonce),
                ..
            }
        }) if connection_id == "conn_abc123"
            && subscription_id == "sub_def456"
            && reason == "acceptance test"
            && startup_nonce == "explicit-nonce"
    ));

    let missing_reason = Cli::try_parse_from([
        "snapback",
        "debug",
        "force-resync",
        "--connection-id",
        "conn_abc123",
        "--subscription-id",
        "sub_def456",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(missing_reason.is_err());
}

/// `resolve_startup_nonce` reads the nonce straight from the ready
/// file's own readiness descriptor when the caller does not supply one
/// explicitly, and refuses when neither is available (`--url` alone).
#[test]
fn resolve_startup_nonce_reads_ready_file_descriptor_or_refuses() {
    assert_eq!(
        resolve_startup_nonce(
            &TargetArgs {
                url: Some("http://127.0.0.1:4287".to_owned()),
                ready_file: None,
                token: None,
                impersonation_capability_stdin: false,
            },
            Some("explicit".to_owned()),
        )
        .unwrap(),
        "explicit",
    );

    let dir = tempfile::tempdir().unwrap();
    let ready_file = dir.path().join("ready.json");
    crate::secure_file::write_owner_only(
        &ready_file,
        serde_json::to_string(&stop_descriptor(Some("descriptor-nonce")))
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    assert_eq!(
        resolve_startup_nonce(
            &TargetArgs {
                url: None,
                ready_file: Some(ready_file),
                token: None,
                impersonation_capability_stdin: false,
            },
            None,
        )
        .unwrap(),
        "descriptor-nonce",
    );

    let no_source = resolve_startup_nonce(
        &TargetArgs {
            url: Some("http://127.0.0.1:4287".to_owned()),
            ready_file: None,
            token: None,
            impersonation_capability_stdin: false,
        },
        None,
    );
    assert!(no_source.is_err());
}

#[test]
fn ephemeral_operator_delete_cli_parses_both_fences_and_reason() {
    let parsed = Cli::parse_from([
        "snapback",
        "ephemeral",
        "operator-delete",
        "--ready-file",
        "/tmp/snapback-ready.json",
        "--collection",
        "boardCursors",
        "--scope-json",
        r#"{"boardId":"board-1"}"#,
        "--entry-key",
        "conn_owner",
        "--expected-scope-epoch",
        "7",
        "--expected-entry-generation",
        "1",
        "--reason",
        "stuck presence repair",
    ]);
    assert!(matches!(
        parsed.command,
        Some(HostCommand::Ephemeral {
            command: EphemeralCommand::OperatorDelete {
                collection,
                scope_json,
                entry_key,
                expected_scope_epoch: 7,
                expected_entry_generation: 1,
                reason,
                ..
            }
        }) if collection == "boardCursors"
            && scope_json == r#"{"boardId":"board-1"}"#
            && entry_key == "conn_owner"
            && reason == "stuck presence repair"
    ));

    let missing_epoch = Cli::try_parse_from([
        "snapback",
        "ephemeral",
        "operator-delete",
        "--ready-file",
        "/tmp/snapback-ready.json",
        "--collection",
        "boardCursors",
        "--scope-json",
        r#"{"boardId":"board-1"}"#,
        "--entry-key",
        "conn_owner",
        "--expected-entry-generation",
        "1",
        "--reason",
        "stuck presence repair",
    ]);
    assert!(missing_epoch.is_err());
}

#[test]
fn path_segment_escape_encodes_reserved_bytes() {
    assert_eq!(path_segment_escape("nightly-digest"), "nightly-digest");
    assert_eq!(path_segment_escape("a/b c"), "a%2Fb%20c");
}

#[test]
fn data_patch_cli_requires_one_intent_and_file_or_stdin_json() {
    let preview = Cli::parse_from([
        "snapback",
        "data",
        "patch",
        "--preview",
        "--input",
        "preview.json",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        preview.command,
        Some(HostCommand::Data {
            command: DataCommand::Patch(DataPatchArgs {
                preview: true,
                apply: false,
                ..
            })
        })
    ));

    let apply = Cli::parse_from([
        "snapback",
        "data",
        "patch",
        "--apply",
        "--input",
        "-",
        "--ready-file",
        "server.ready.json",
    ]);
    assert!(matches!(
        apply.command,
        Some(HostCommand::Data {
            command: DataCommand::Patch(DataPatchArgs {
                preview: false,
                apply: true,
                ..
            })
        })
    ));

    let missing_intent = Cli::try_parse_from([
        "snapback",
        "data",
        "patch",
        "--input",
        "patch.json",
        "--url",
        "http://127.0.0.1:4287",
    ])
    .unwrap_err();
    assert_eq!(
        missing_intent.kind(),
        clap::error::ErrorKind::MissingRequiredArgument
    );

    let both = Cli::try_parse_from([
        "snapback",
        "data",
        "patch",
        "--preview",
        "--apply",
        "--input",
        "patch.json",
        "--url",
        "http://127.0.0.1:4287",
    ])
    .unwrap_err();
    assert_eq!(both.kind(), clap::error::ErrorKind::ArgumentConflict);

    let token_in_argv = Cli::try_parse_from([
        "snapback",
        "data",
        "patch",
        "--apply",
        "--input",
        "patch.json",
        "--apply-token",
        "must-not-be-an-argv-carrier",
        "--url",
        "http://127.0.0.1:4287",
    ])
    .unwrap_err();
    assert_eq!(
        token_in_argv.kind(),
        clap::error::ErrorKind::UnknownArgument
    );
}

#[test]
fn secret_read_root_path_substitution_is_refused_before_file_or_network_access() {
    let dir = tempfile::tempdir().unwrap();
    let ready = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("server.json");
    let attacker_root = dir.path().join("attacker-root");
    crate::secure_file::write_owner_only(&attacker_root, b"sbrk_deadbeef\n").unwrap();
    let mut descriptor = stop_descriptor(Some("startup-a"));
    descriptor.secret_read_root_file = Some(attacker_root.display().to_string());
    let error = validated_secret_read_root_path(&ready, &descriptor).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_ADMIN_SECRET_READ_ROOT_PATH_INVALID")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[cfg(not(feature = "cli-owner"))]
async fn ready_file_cli_mints_a_derived_lease_without_exposing_the_root() {
    let dir = tempfile::tempdir().unwrap();
    let ready = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("server.json");
    let root_path = crate::admin_secret_read::secret_read_root_sibling(&ready);
    let server_root = crate::admin_secret_read::resolve_secret_read_proof_root_with_io(
        &root_path,
        crate::secure_file::read_owner_only,
        crate::secure_file::write_owner_only,
    )
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mut context =
        crate::admin::ServerContext::new(address.ip().to_string(), address.port(), true);
    context.admin_token = Some("ordinary-admin".to_owned());
    let (state, operator) = crate::admin::AppState::try_from_snapback_with_secret_read_operator(
        crate::local::LocalSnapback::memory().unwrap(),
        context,
    )
    .expect("CLI secret read app state");
    let startup_nonce = crate::identity::binary_identity().startup_nonce;
    let app = crate::server::app(state.with_secret_read_mint_bridge(
        crate::admin_secret_read::SecretReadMintBridge::new(
            operator,
            server_root,
            startup_nonce.clone(),
        ),
    ));
    let server = tokio::spawn(async move {
        app.bind(listener).unwrap().serve().await.unwrap();
    });

    let mut descriptor = stop_descriptor(Some(&startup_nonce));
    descriptor.server_url = format!("http://{address}");
    descriptor.host = address.ip().to_string();
    descriptor.port = address.port();
    descriptor.secret_read_root_file = Some(root_path.display().to_string());
    crate::secure_file::write_owner_only(
        &ready,
        serde_json::to_string(&descriptor).unwrap().as_bytes(),
    )
    .unwrap();
    let response = tokio::task::spawn_blocking(move || {
        mint_secret_read_via_http(
            &ready,
            Some("ordinary-admin".to_owned()),
            crate::admin_secret_read::SecretReadMintSpec {
                scopes: std::collections::BTreeSet::from([
                    crate::admin_secret_read::SecretReadScope::AdminInspect,
                ]),
                ttl_ms: 60_000,
                row_budget: 10,
                byte_budget: 1_000,
            },
        )
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response.as_object().unwrap().len(), 1);
    assert!(response["lease"].as_str().unwrap().starts_with("sbrl_"));
    assert!(!serde_json::to_string(&response).unwrap().contains("sbrk_"));
    server.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[cfg(not(feature = "cli-owner"))]
async fn stale_ready_descriptor_sends_adversarial_server_no_admin_or_proof_material() {
    use axum::body::Bytes;
    use axum::http::HeaderMap;
    use axum::routing::{get, post};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};

    let observed = Arc::new(StdMutex::new(Vec::<u8>::new()));
    let mint_calls = Arc::new(AtomicUsize::new(0));
    let health_observed = observed.clone();
    let mint_observed = observed.clone();
    let mint_calls_handler = mint_calls.clone();
    let attacker = axum::Router::new()
        .route(
            "/health",
            get(move |headers: HeaderMap| {
                let observed = health_observed.clone();
                async move {
                    let mut observed = observed.lock().unwrap();
                    for (name, value) in &headers {
                        observed.extend_from_slice(name.as_str().as_bytes());
                        observed.extend_from_slice(value.as_bytes());
                    }
                    axum::Json(json!({
                        "ok": true,
                        "binary": { "startupNonce": "attacker-startup" }
                    }))
                }
            }),
        )
        .route(
            "/_snapback/api/admin-secret-read/mint",
            post(move |headers: HeaderMap, body: Bytes| {
                let observed = mint_observed.clone();
                let mint_calls = mint_calls_handler.clone();
                async move {
                    mint_calls.fetch_add(1, Ordering::SeqCst);
                    let mut observed = observed.lock().unwrap();
                    for (name, value) in &headers {
                        observed.extend_from_slice(name.as_str().as_bytes());
                        observed.extend_from_slice(value.as_bytes());
                    }
                    observed.extend_from_slice(&body);
                    axum::Json(json!({ "lease": "attacker" }))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, attacker).await.unwrap();
    });

    let dir = tempfile::tempdir().unwrap();
    let ready = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("server.json");
    let root_path = crate::admin_secret_read::secret_read_root_sibling(&ready);
    // If the CLI tries to read the root before checking /health this
    // non-regular path fails with a different error, making ordering part
    // of the acceptance rather than an unobservable implementation detail.
    std::fs::create_dir(&root_path).unwrap();
    let mut descriptor = stop_descriptor(Some("trusted-startup"));
    descriptor.server_url = format!("http://{address}");
    descriptor.host = address.ip().to_string();
    descriptor.port = address.port();
    descriptor.secret_read_root_file = Some(root_path.display().to_string());
    crate::secure_file::write_owner_only(
        &ready,
        serde_json::to_string(&descriptor).unwrap().as_bytes(),
    )
    .unwrap();
    let error = tokio::task::spawn_blocking(move || {
        mint_secret_read_via_http(
            &ready,
            Some("DURABLE_ADMIN_SENTINEL".to_owned()),
            crate::admin_secret_read::SecretReadMintSpec {
                scopes: std::collections::BTreeSet::from([
                    crate::admin_secret_read::SecretReadScope::AdminInspect,
                ]),
                ttl_ms: 60_000,
                row_budget: 10,
                byte_budget: 1_000,
            },
        )
    })
    .await
    .unwrap()
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_HOST_STOP_STALE_DESCRIPTOR"),
        "{error:#}"
    );
    assert_eq!(mint_calls.load(Ordering::SeqCst), 0);
    let observed = String::from_utf8_lossy(&observed.lock().unwrap()).into_owned();
    assert!(!observed.contains("DURABLE_ADMIN_SENTINEL"));
    assert!(!observed.contains("sbrk_"));
    assert!(!observed.contains("\"proof\""));
    server.abort();
}

#[test]
fn credential_bearing_cli_debug_never_exposes_token_material() {
    const SENTINEL: &str = "CLI_CREDENTIAL_SENTINEL_MUST_NOT_ESCAPE";
    let target = TargetArgs {
        url: Some("http://127.0.0.1:4287".to_owned()),
        ready_file: None,
        token: Some(SENTINEL.to_owned()),
        impersonation_capability_stdin: false,
    };
    let target_debug = format!("{target:?}");
    assert!(!target_debug.contains(SENTINEL), "{target_debug}");
    assert!(target_debug.contains("[REDACTED]"), "{target_debug}");

    let command = HostCommand::Inspect(target);
    let command_debug = format!("{command:?}");
    assert!(!command_debug.contains(SENTINEL), "{command_debug}");
    assert!(command_debug.contains("[REDACTED]"), "{command_debug}");

    let mint_command = HostCommand::SecretReadMint {
        ready_file: PathBuf::from("ready.json"),
        admin_inspect: true,
        receipts: false,
        table: Vec::new(),
        function: Vec::new(),
        explain_function: Vec::new(),
        telemetry_events: false,
        telemetry_export: false,
        errors_issue: false,
        ttl_seconds: 60,
        row_budget: 10,
        byte_budget: 1_000,
    };
    let mint_debug = format!("{mint_command:?}");
    assert!(!mint_debug.contains(SENTINEL), "{mint_debug}");

    let cli = Cli::parse_from([
        "snapback",
        "inspect",
        "--url",
        "http://127.0.0.1:4287",
        "--token",
        SENTINEL,
    ]);
    let cli_debug = format!("{cli:?}");
    assert!(!cli_debug.contains(SENTINEL), "{cli_debug}");

    let resolved = ResolvedHttpTarget {
        server_url: "http://127.0.0.1:4287".to_owned(),
        minted_token: Some(SENTINEL.to_owned()),
        impersonation_capability: None,
        agent_destroy_capability: None,
    };
    let resolved_debug = format!("{resolved:?}");
    assert!(!resolved_debug.contains(SENTINEL), "{resolved_debug}");
    assert!(resolved_debug.contains("[REDACTED]"), "{resolved_debug}");
}

#[test]
fn telemetry_cli_pins_all_verbs_and_since_until_export_spelling() {
    let stats = Cli::parse_from([
        "snapback",
        "telemetry",
        "stats",
        "--url",
        "http://127.0.0.1:4287",
        "--kind",
        "http_request",
    ]);
    assert!(matches!(
        stats.command,
        Some(HostCommand::Telemetry {
            command: TelemetryCommand::Stats { .. }
        })
    ));

    let events = Cli::parse_from([
        "snapback",
        "telemetry",
        "events",
        "--url",
        "http://127.0.0.1:4287",
        "--secret-read-lease",
        "sbrl_test",
        "--limit",
        "7",
    ]);
    assert!(matches!(
        events.command,
        Some(HostCommand::Telemetry {
            command: TelemetryCommand::Events { limit: 7, .. }
        })
    ));

    let export = Cli::parse_from([
        "snapback",
        "telemetry",
        "export",
        "--url",
        "http://127.0.0.1:4287",
        "--secret-read-lease",
        "sbrl_test",
        "--since",
        "100",
        "--until",
        "200",
    ]);
    match export.command {
        Some(HostCommand::Telemetry {
            command: TelemetryCommand::Export { filter, .. },
        }) => {
            assert_eq!(filter.from_ms, Some(100));
            assert_eq!(filter.to_ms, Some(200));
            assert_eq!(
                filter.query_pairs(false),
                vec![("fromMs", "100".to_owned()), ("toMs", "200".to_owned())]
            );
        }
        _ => panic!("telemetry export command did not parse"),
    }

    let query = Cli::parse_from([
        "snapback",
        "telemetry",
        "query",
        "SELECT count(*) FROM telemetry_events_visible",
        "--db",
        "state.sqlite3",
    ]);
    assert!(matches!(
        query.command,
        Some(HostCommand::Telemetry {
            command: TelemetryCommand::Query { .. }
        })
    ));
}

#[test]
fn errors_cli_pins_agent_views_raw_detail_cas_and_deploy_resolve() {
    let issues = Cli::parse_from([
        "snapback",
        "errors",
        "issues",
        "--url",
        "http://127.0.0.1:4287",
        "--since",
        "release-a",
        "--order",
        "count",
        "--limit",
        "7",
    ]);
    assert!(matches!(
        issues.command,
        Some(HostCommand::Errors {
            command: ErrorsCommand::Issues {
                since: Some(ref release),
                limit: 7,
                ..
            }
        }) if release == "release-a"
    ));

    let issue = Cli::parse_from([
        "snapback",
        "errors",
        "issue",
        "iss_00000000000000000000000000",
        "--url",
        "http://127.0.0.1:4287",
        "--secret-read-lease",
        "sbrl_test",
    ]);
    assert!(matches!(
        issue.command,
        Some(HostCommand::Errors {
            command: ErrorsCommand::Issue { .. }
        })
    ));

    let transition = Cli::parse_from([
        "snapback",
        "errors",
        "transition",
        "iss_00000000000000000000000000",
        "--to",
        "ignored",
        "--expect-seq",
        "3",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        transition.command,
        Some(HostCommand::Errors {
            command: ErrorsCommand::Transition { expect_seq: 3, .. }
        })
    ));

    let resolve = Cli::parse_from([
        "snapback",
        "errors",
        "resolve",
        "--open-before",
        "release-a",
        "--url",
        "http://127.0.0.1:4287",
    ]);
    assert!(matches!(
        resolve.command,
        Some(HostCommand::Errors {
            command: ErrorsCommand::Resolve { ref open_before, .. }
        }) if open_before == "release-a"
    ));
}

#[test]
fn ready_file_write_publishes_final_content() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("ready.json");

    write_ready_file_atomic(&path, "{\"ready\":true}\n").unwrap();

    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "{\"ready\":true}\n"
    );
    let leftovers = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
        .count();
    assert_eq!(leftovers, 0, "temporary ready files should be cleaned up");
}

#[test]
fn ready_file_must_be_identity_disjoint_from_every_managed_artifact() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("app.sqlite3");
    std::fs::write(&db, b"database").unwrap();

    for ready in [
        db.clone(),
        crate::instance_lock::lock_path_for_database(&db).unwrap(),
        crate::config::ConfigStore::path_for_database(&db),
        crate::admin::admin_token_sibling(&db),
        path_with_filename_suffix(&db, "-wal").unwrap(),
        dir.path()
            .join("missing-parent")
            .join("..")
            .join("app.sqlite3-wal"),
    ] {
        let error =
            validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&ready)).unwrap())
                .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION"),
            "{error:#}"
        );
    }

    let distinct = dir.path().join("server.ready.json");
    validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&distinct)).unwrap())
        .unwrap();

    for colliding_db in [
        dir.path().join("operator.ready.secret-read-root"),
        dir.path().join("operator.ready.impersonation"),
    ] {
        let colliding_ready = dir.path().join("operator.ready");
        let error = validate_path_disjointness(
            &managed_startup_paths(Some(&colliding_db), Some(&colliding_ready)).unwrap(),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
        );
    }
}

#[test]
fn ready_file_cannot_create_a_parent_at_a_managed_sidecar_path() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("app.sqlite3");
    let lock = crate::instance_lock::lock_path_for_database(&db).unwrap();
    let nested_ready = lock.join("ready.json");
    let error =
        validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&nested_ready)).unwrap())
            .expect_err("a ready parent cannot occupy the database lock path");
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_READY_FILE_PATH_COLLISION"),
        "{error:#}"
    );
    assert!(
        !lock.exists(),
        "preflight must reject before creating the colliding parent"
    );

    let wal = path_with_filename_suffix(&db, "-wal").unwrap();
    let dotdot_ready = wal.join("transient").join("..").join("ready.json");
    assert!(
        validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&dotdot_ready)).unwrap())
            .is_err(),
        "normalized .. spelling must not bypass the ancestor collision"
    );
    assert!(!wal.exists());
}

#[cfg(unix)]
#[test]
fn ready_file_rejects_symlink_and_hardlink_aliases() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("app.sqlite3");
    std::fs::write(&db, b"database").unwrap();

    let symlink = dir.path().join("symlink.ready");
    std::os::unix::fs::symlink(&db, &symlink).unwrap();
    let error =
        validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&symlink)).unwrap())
            .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
    );

    let hardlink = dir.path().join("hardlink.ready");
    std::fs::hard_link(&db, &hardlink).unwrap();
    let error =
        validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&hardlink)).unwrap())
            .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
    );
}

#[cfg(unix)]
#[test]
fn ready_file_parent_swap_cannot_redirect_publish_or_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let database_parent = dir.path().join("database");
    let ready_parent = dir.path().join("ready");
    std::fs::create_dir_all(&database_parent).unwrap();
    std::fs::create_dir_all(&ready_parent).unwrap();
    let database = database_parent.join("app.sqlite3");
    std::fs::write(&database, b"live database").unwrap();

    let mutable_parent = dir.path().join("mutable-parent");
    std::os::unix::fs::symlink(&ready_parent, &mutable_parent).unwrap();
    let requested = mutable_parent.join("app.sqlite3");
    let mut target = ReadyFileTarget::open(&requested).unwrap();
    let temporary = super::ready_file_temp_path(target.pinned_path()).unwrap();
    let protected = managed_startup_paths(Some(&database), Some(target.pinned_path())).unwrap();
    let pinned_token = ready_parent.join("app.sqlite3.admin-token");
    let database_token = database_parent.join("app.sqlite3.admin-token");
    std::fs::write(&pinned_token, b"ephemeral token").unwrap();
    std::fs::write(&database_token, b"database-side sentinel").unwrap();
    let token_identity = super::existing_file_identity(&pinned_token).unwrap();

    std::fs::remove_file(&mutable_parent).unwrap();
    std::os::unix::fs::symlink(&database_parent, &mutable_parent).unwrap();
    target
        .write_atomic_protected("ready", &protected, &temporary)
        .unwrap();

    assert_eq!(std::fs::read(&database).unwrap(), b"live database");
    assert_eq!(
        std::fs::read(ready_parent.join("app.sqlite3")).unwrap(),
        b"ready"
    );
    target.remove_published().unwrap();
    target
        .remove_sibling_if_identity(&pinned_token, token_identity)
        .unwrap();
    assert_eq!(std::fs::read(&database).unwrap(), b"live database");
    assert_eq!(
        std::fs::read(&database_token).unwrap(),
        b"database-side sentinel"
    );
    assert!(!ready_parent.join("app.sqlite3").exists());
    assert!(!pinned_token.exists());
}

// 0137 G1: the secret-read proof root is descriptor-scoped custody. It is
// removed with the descriptor — but only the adopted inode, never a
// foreign replacement at the same path.
#[cfg(unix)]
#[test]
#[cfg(not(feature = "cli-owner"))]
fn secret_read_root_cleanup_removes_only_the_adopted_identity() {
    let dir = tempfile::tempdir().unwrap();
    let mut target = ReadyFileTarget::open(&dir.path().join("dev.ready.json")).unwrap();
    let root = crate::admin_secret_read::secret_read_root_sibling(target.pinned_path());
    let resolve = |target: &ReadyFileTarget| {
        crate::admin_secret_read::resolve_secret_read_proof_root_with_io(
            &root,
            |path| target.read_owner_only_sibling(path),
            |path, bytes| target.write_owner_only_sibling(path, bytes),
        )
        .unwrap()
    };
    resolve(&target);
    target.adopt_secret_read_root_sibling(&root).unwrap();

    // A replaced inode is not this serve's sidecar: identity-guarded
    // removal must leave it alone.
    std::fs::remove_file(&root).unwrap();
    std::fs::write(&root, b"unrelated replacement").unwrap();
    target.remove_secret_read_root().unwrap();
    assert!(
        root.exists(),
        "a foreign inode at the sidecar path must survive"
    );

    std::fs::remove_file(&root).unwrap();
    resolve(&target);
    target.adopt_secret_read_root_sibling(&root).unwrap();
    target.remove_secret_read_root().unwrap();
    assert!(
        !root.exists(),
        "the adopted sidecar is removed with descriptor custody"
    );
}

#[cfg(unix)]
#[test]
fn attach_parent_swap_cannot_splice_a_different_impersonation_sidecar() {
    let dir = tempfile::tempdir().unwrap();
    let trusted_parent = dir.path().join("trusted");
    let attacker_parent = dir.path().join("attacker");
    std::fs::create_dir(&trusted_parent).unwrap();
    std::fs::create_dir(&attacker_parent).unwrap();
    let trusted_ready = std::fs::canonicalize(&trusted_parent)
        .unwrap()
        .join("server.ready.json");
    let attacker_ready = std::fs::canonicalize(&attacker_parent)
        .unwrap()
        .join("server.ready.json");
    crate::secure_file::write_owner_only(&trusted_ready, b"trusted-descriptor").unwrap();
    crate::secure_file::write_owner_only(&attacker_ready, b"attacker-descriptor").unwrap();

    let publish = |ready: &Path, nonce: &str| {
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                nonce.to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        let path = operator
            .publish_with(ready, |path, bytes| {
                crate::secure_file::write_owner_only(path, bytes)
            })
            .unwrap();
        (path.clone(), std::fs::read(path).unwrap())
    };
    let (trusted_sidecar, trusted_bytes) = publish(&trusted_ready, "trusted");
    let (_attacker_sidecar, attacker_bytes) = publish(&attacker_ready, "attacker");
    assert_ne!(trusted_bytes, attacker_bytes);

    let mutable_parent = dir.path().join("mutable");
    std::os::unix::fs::symlink(&trusted_parent, &mutable_parent).unwrap();
    let target = ReadyFileTarget::open_existing(&mutable_parent.join("server.ready.json"))
        .expect("pin trusted attach parent");
    assert_eq!(
        target
            .read_owner_only_sibling(target.pinned_path())
            .unwrap(),
        b"trusted-descriptor"
    );

    std::fs::remove_file(&mutable_parent).unwrap();
    std::os::unix::fs::symlink(&attacker_parent, &mutable_parent).unwrap();
    assert_eq!(target.pinned_path(), trusted_ready);
    assert_eq!(
        target
            .read_strict_owner_only_sibling(
                &trusted_sidecar,
                crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES,
            )
            .unwrap(),
        trusted_bytes,
        "the attach must keep reading beneath the parent pinned before descriptor validation"
    );
}

#[cfg(unix)]
#[test]
fn replaced_canonical_ready_parent_cannot_split_the_token_handoff() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = tempfile::tempdir().unwrap();
    let ready_parent = dir.path().join("ready");
    let moved_parent = dir.path().join("ready-moved");
    std::fs::create_dir(&ready_parent).unwrap();
    let target = ReadyFileTarget::open(&ready_parent.join("server.json")).unwrap();
    let token_path = crate::admin::admin_token_sibling(target.pinned_path());

    std::fs::rename(&ready_parent, &moved_parent).unwrap();
    std::fs::create_dir(&ready_parent).unwrap();
    let replacement_token = ready_parent.join("server.json.admin-token");
    std::fs::write(&replacement_token, b"another-instance-token\n").unwrap();
    std::fs::set_permissions(&replacement_token, std::fs::Permissions::from_mode(0o600)).unwrap();

    let error = crate::admin::resolve_serve_admin_token_with_io(
        None,
        Some(token_path),
        |path| target.read_owner_only_sibling(path),
        |path, bytes| target.write_owner_only_sibling(path, bytes),
    )
    .expect_err("a renamed/replaced advertised parent must fail closed");
    assert!(
        format!("{error:#}").contains("parent identity changed"),
        "{error:#}"
    );
    assert_eq!(
        std::fs::read(&replacement_token).unwrap(),
        b"another-instance-token\n",
        "the replacement directory's capability must never be adopted or rewritten"
    );
    assert!(!moved_parent.join("server.json.admin-token").exists());
}

#[cfg(unix)]
#[test]
fn ready_publication_refuses_a_precreated_temp_hardlink_without_truncation() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("server.ready.json");
    let tmp = dir.path().join(".server.ready.json.injected-temp");
    let managed = dir.path().join("managed-artifact");
    std::fs::write(&managed, b"do-not-touch").unwrap();
    std::fs::hard_link(&managed, &tmp).unwrap();
    let protected = [
        ManagedPath {
            label: "ready file",
            path: ready.clone(),
        },
        ManagedPath {
            label: "ready-file temporary artifact",
            path: tmp.clone(),
        },
    ];

    write_ready_file_atomic_protected(&ready, "replacement", &protected, &tmp)
        .expect_err("an existing temp inode must never be opened or truncated");
    assert_eq!(std::fs::read(managed).unwrap(), b"do-not-touch");
    assert!(!ready.exists());
}

#[test]
fn terminal_emission_seam_consumes_one_operator_and_frames_one_line() {
    let (_registry, operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce-terminal".to_owned(),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    let mut output = Vec::new();
    super::emit_impersonation_capability_to_writer(operator, &mut output).unwrap();
    let output = String::from_utf8(output).unwrap();
    assert!(output.starts_with("impersonation capability: sbic_"));
    assert_eq!(output.lines().count(), 1);
    assert!(output.ends_with('\n'));

    let (_registry, operator) = crate::dev_identity::DevIdentityCapabilityRegistry::generate(
        "nonce-dev-identity-terminal".to_owned(),
        None,
        &crate::auth::crypto::OsRandom,
    )
    .unwrap();
    let mut output = Vec::new();
    super::emit_dev_identity_capability_to_writer(operator, &mut output).unwrap();
    let output = String::from_utf8(output).unwrap();
    assert!(output.starts_with("developer identity capability: sbdev_"));
    assert_eq!(output.lines().count(), 1);
    assert!(output.ends_with('\n'));
}

#[cfg(unix)]
#[test]
fn dev_identity_ready_sidecar_rotates_and_follows_descriptor_custody() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("server.ready.json");
    let mut target = ReadyFileTarget::open(&ready).unwrap();
    let pinned_ready = target.pinned_path().to_path_buf();
    let sidecar = crate::dev_identity::dev_identity_capability_sibling(&pinned_ready).unwrap();
    let temporary = super::ready_file_temp_path(&sidecar).unwrap();
    let (_old_registry, old_operator) =
        crate::dev_identity::DevIdentityCapabilityRegistry::generate(
            "nonce-dev-ready-old".to_owned(),
            Some(sidecar.clone()),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    old_operator
        .publish_with(&pinned_ready, crate::secure_file::write_owner_only)
        .unwrap();

    let (registry, operator) = crate::dev_identity::DevIdentityCapabilityRegistry::generate(
        "nonce-dev-ready".to_owned(),
        Some(sidecar.clone()),
        &crate::auth::crypto::OsRandom,
    )
    .unwrap();
    operator
        .publish_with(&pinned_ready, |path, bytes| {
            target.publish_owner_only_sibling_atomic(path, &temporary, bytes)
        })
        .unwrap();
    let bearer = crate::dev_identity::parse_dev_identity_capability_file(zeroize::Zeroizing::new(
        std::fs::read(&sidecar).unwrap(),
    ))
    .unwrap();
    assert!(registry.authorize(Some(bearer.expose_secret())).is_ok());
    assert_eq!(
        std::fs::metadata(&sidecar).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(!temporary.exists());
    drop(target);
    assert!(!sidecar.exists());
}

#[cfg(unix)]
#[test]
fn impersonation_sidecar_is_exact_owner_only_and_replaces_a_valid_crash_remnant() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("server.ready.json");
    let mut target = ReadyFileTarget::open(&ready).unwrap();
    let pinned_ready = target.pinned_path().to_path_buf();
    let sidecar =
        crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready).unwrap();
    let temporary = super::ready_file_temp_path(&sidecar).unwrap();

    let (_old_registry, old_operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce-old".to_owned(),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    old_operator
        .publish_with(&pinned_ready, |path, bytes| {
            crate::secure_file::write_owner_only(path, bytes)
        })
        .unwrap();
    let old_bytes = std::fs::read(&sidecar).unwrap();

    let (_new_registry, new_operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce-new".to_owned(),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    let published = new_operator
        .publish_with(&pinned_ready, |path, bytes| {
            target.publish_owner_only_sibling_atomic(path, &temporary, bytes)
        })
        .unwrap();
    let new_bytes = std::fs::read(&published).unwrap();

    assert_ne!(
        new_bytes, old_bytes,
        "restart must replace the stale bearer"
    );
    assert!(!new_bytes.contains(&b'\n'));
    assert_eq!(
        std::fs::metadata(&published).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(!temporary.exists());
    drop(target);
    assert!(!sidecar.exists(), "the process-owned sidecar is cleaned up");
}

#[cfg(unix)]
#[test]
fn impersonation_sidecar_refuses_symlink_and_hardlink_destinations() {
    use std::os::unix::fs::PermissionsExt as _;

    for hard_link in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("server.ready.json");
        let mut target = ReadyFileTarget::open(&ready).unwrap();
        let pinned_ready = target.pinned_path().to_path_buf();
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready).unwrap();
        let temporary = super::ready_file_temp_path(&sidecar).unwrap();
        let sentinel = dir.path().join("attacker-owned");
        std::fs::write(&sentinel, b"do-not-touch").unwrap();
        std::fs::set_permissions(&sentinel, std::fs::Permissions::from_mode(0o600)).unwrap();
        if hard_link {
            std::fs::hard_link(&sentinel, &sidecar).unwrap();
        } else {
            std::os::unix::fs::symlink(&sentinel, &sidecar).unwrap();
        }
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        operator
            .publish_with(&pinned_ready, |path, bytes| {
                target.publish_owner_only_sibling_atomic(path, &temporary, bytes)
            })
            .expect_err("an aliasing destination must be refused");
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"do-not-touch");
        assert!(!temporary.exists());
    }
}

#[cfg(unix)]
#[test]
fn descriptor_publication_failure_rolls_back_the_published_sidecar() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("server.ready.json");
    let mut target = ReadyFileTarget::open(&ready).unwrap();
    let pinned_ready = target.pinned_path().to_path_buf();
    let descriptor_temp = super::ready_file_temp_path(&pinned_ready).unwrap();
    let sidecar =
        crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready).unwrap();
    let sidecar_temp = super::ready_file_temp_path(&sidecar).unwrap();
    let (_registry, operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce".to_owned(),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    operator
        .publish_with(&pinned_ready, |path, bytes| {
            target.publish_owner_only_sibling_atomic(path, &sidecar_temp, bytes)
        })
        .unwrap();
    assert!(sidecar.exists());

    std::fs::write(&descriptor_temp, b"attacker-temp").unwrap();
    let protected = managed_startup_paths(None, Some(&pinned_ready)).unwrap();
    target
        .write_atomic_protected("descriptor", &protected, &descriptor_temp)
        .expect_err("pre-created descriptor temporary must fail publication");
    drop(target);

    assert!(
        !sidecar.exists(),
        "sidecar must not outlive failed readiness"
    );
    assert_eq!(std::fs::read(&descriptor_temp).unwrap(), b"attacker-temp");
}

#[cfg(unix)]
#[test]
fn ready_file_is_owner_only_even_under_zero_umask() {
    use std::os::unix::fs::PermissionsExt as _;

    const CHILD_ENV: &str = "SNAPBACK_TEST_READY_FILE_ZERO_UMASK_CHILD";
    if std::env::var_os(CHILD_ENV).is_none() {
        // umask is process-global. Re-run only this test in a subprocess so
        // the adversarial setting cannot weaken files created by parallel
        // tests in this binary.
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cli::tests::ready_file_is_owner_only_even_under_zero_umask",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .expect("run isolated zero-umask readiness test");
        assert!(
            output.status.success(),
            "zero-umask readiness child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }

    // SAFETY: this is the isolated child process described above.
    let previous = unsafe { libc::umask(0) };
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("ready.json");
    let result = write_ready_file_atomic(&path, "{\"ready\":true}\n");
    let mode = result
        .as_ref()
        .ok()
        .and_then(|()| std::fs::metadata(&path).ok())
        .map(|metadata| metadata.permissions().mode() & 0o777);
    // SAFETY: restore the child's process-global mask before asserting.
    unsafe { libc::umask(previous) };

    result.expect("publish readiness descriptor under zero umask");
    assert_eq!(mode, Some(0o600));
}

#[cfg(unix)]
#[test]
fn ready_file_is_readable_owner_only_under_restrictive_umask() {
    use std::os::unix::fs::PermissionsExt as _;

    const CHILD_ENV: &str = "SNAPBACK_TEST_READY_FILE_RESTRICTIVE_UMASK_CHILD";
    if std::env::var_os(CHILD_ENV).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cli::tests::ready_file_is_readable_owner_only_under_restrictive_umask",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .expect("run isolated restrictive-umask readiness test");
        assert!(
            output.status.success(),
            "restrictive-umask readiness child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("ready.json");
    // SAFETY: this is the isolated child process described above. Create
    // the parent first so the test isolates the ready file's exact mode,
    // not tempfile's own directory creation policy.
    let previous = unsafe { libc::umask(0o777) };
    let result = write_ready_file_atomic(&path, "{\"ready\":true}\n");
    let mode = result
        .as_ref()
        .ok()
        .and_then(|()| std::fs::metadata(&path).ok())
        .map(|metadata| metadata.permissions().mode() & 0o777);
    let contents = std::fs::read_to_string(&path);
    // SAFETY: restore the child's process-global mask before asserting.
    unsafe { libc::umask(previous) };

    result.expect("publish readiness under restrictive umask");
    assert_eq!(mode, Some(0o600));
    assert_eq!(contents.unwrap(), "{\"ready\":true}\n");
}

#[cfg(unix)]
#[test]
fn ordinary_manifest_reads_do_not_change_shared_source_permissions() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = tempfile::tempdir().unwrap();
    let manifest = dir.path().join("schema.manifest.json");
    std::fs::write(&manifest, b"{\"schemaVersion\":\"snapback.dev/v1\"}").unwrap();
    std::fs::set_permissions(&manifest, std::fs::Permissions::from_mode(0o644)).unwrap();

    assert!(super::read_json_file(&manifest).is_ok());
    assert_eq!(
        std::fs::metadata(manifest).unwrap().permissions().mode() & 0o777,
        0o644,
        "ordinary CLI inputs are data, not local capability files"
    );
}

#[test]
fn remote_url_never_selects_a_local_token_file() {
    let dir = tempfile::tempdir().unwrap();
    let chosen_by_attacker = dir.path().join("local-secret");
    std::fs::write(&chosen_by_attacker, b"must-not-leave-host").unwrap();
    let target = TargetArgs {
        url: Some("http://127.0.0.1:4400".to_owned()),
        ready_file: None,
        token: None,
        impersonation_capability_stdin: false,
    };

    let resolved = resolve_http_target(&target).expect("resolve remote target");
    assert_eq!(resolved.minted_token, None);
    assert_eq!(resolved.server_url, "http://127.0.0.1:4400");
}

#[test]
fn ordinary_ready_file_host_op_never_reads_or_attaches_impersonation_sidecar() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("ready.json");
    let canonical_ready = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("ready.json");
    let sidecar =
        crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
    // If the ordinary path accidentally tries discovery this deliberately
    // invalid content will fail before the request reaches the server.
    std::fs::write(&sidecar, b"attacker-chosen-not-a-capability").unwrap();

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_http_request(&mut stream);
        write_http_json(&mut stream, &json!({"ok": true}));
        request
    });

    let mut descriptor = stop_descriptor(Some("nonce-unused"));
    descriptor.server_url = format!("http://{address}");
    descriptor.target.server_url = Some(descriptor.server_url.clone());
    descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
    crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
        .unwrap();
    let target = TargetArgs {
        url: None,
        ready_file: Some(ready),
        token: None,
        impersonation_capability_stdin: false,
    };
    let response = super::post_host_op(&target, json!({"operation": "app.inspect"})).unwrap();
    assert_eq!(response["ok"], json!(true));
    let request = server.join().unwrap();
    assert!(request.starts_with("POST /_snapback/api/host-ops "));
    assert!(
        !request
            .to_ascii_lowercase()
            .contains(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER),
        "ordinary operations must not attach the independent effect capability"
    );
}

#[test]
fn registered_impersonation_host_op_live_checks_then_attaches_exact_sidecar() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("ready.json");
    let canonical_ready = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("ready.json");
    let sidecar =
        crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
    let (_registry, operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce-live".to_owned(),
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
    operator
        .publish_with(&canonical_ready, |path, bytes| {
            crate::secure_file::write_owner_only(path, bytes)
        })
        .unwrap();
    let expected = std::fs::read_to_string(&sidecar).unwrap();

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for index in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            let body = if index == 0 {
                health_with_nonce("nonce-live")
            } else {
                json!({"ok": true})
            };
            write_http_json(&mut stream, &body);
            requests.push(request);
        }
        requests
    });

    let mut descriptor = stop_descriptor(Some("nonce-live"));
    descriptor.server_url = format!("http://{address}");
    descriptor.target.server_url = Some(descriptor.server_url.clone());
    descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
    crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
        .unwrap();
    let target = TargetArgs {
        url: None,
        ready_file: Some(ready),
        token: None,
        impersonation_capability_stdin: false,
    };
    super::post_host_op(
        &target,
        json!({"operation": "auth.mintSession", "args": {}}),
    )
    .unwrap();
    let requests = server.join().unwrap();
    assert!(requests[0].starts_with("GET /health "));
    assert!(requests[1].starts_with("POST /_snapback/api/host-ops "));
    assert!(requests[1].lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.eq_ignore_ascii_case(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
            && value.trim() == expected
    }));
}

#[test]
fn remote_url_impersonation_request_never_selects_a_local_sidecar() {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_http_request(&mut stream);
        write_http_json(&mut stream, &json!({"ok": false}));
        request
    });
    let target = TargetArgs {
        url: Some(format!("http://{address}")),
        ready_file: None,
        token: None,
        impersonation_capability_stdin: false,
    };
    super::post_host_op(
        &target,
        json!({"operation": "auth.mintSession", "args": {}}),
    )
    .unwrap();
    let request = server.join().unwrap();
    assert!(request.starts_with("POST /_snapback/api/host-ops "));
    assert!(
        !request
            .to_ascii_lowercase()
            .contains(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
    );
}

#[test]
fn adversarial_remote_server_cannot_make_cli_transmit_a_local_file() {
    const CHILD_ENV: &str = "SNAPBACK_TEST_REMOTE_TOKEN_EXFIL_CHILD";
    if std::env::var_os(CHILD_ENV).is_none() {
        // The ambient token is process-global. Isolate this network-boundary
        // regression so it proves the no-explicit-token path even when a
        // developer running the suite has SNAPBACK_ADMIN_TOKEN configured.
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cli::tests::adversarial_remote_server_cannot_make_cli_transmit_a_local_file",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .env_remove("SNAPBACK_ADMIN_TOKEN")
            .output()
            .expect("run isolated remote-token exfiltration test");
        assert!(
            output.status.success(),
            "remote-token exfiltration child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }

    use std::io::{Read as _, Write as _};
    use std::net::TcpListener as StdTcpListener;
    use std::time::Duration;

    fn read_request(stream: &mut std::net::TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let count = stream.read(&mut chunk).expect("read attacker request");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..count]);
            let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                assert!(
                    bytes.len() < 64 * 1024,
                    "request headers are unexpectedly large"
                );
                continue;
            };
            let header_len = header_end + 4;
            let headers = String::from_utf8_lossy(&bytes[..header_len]);
            let content_len = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if bytes.len() >= header_len + content_len {
                break;
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    let dir = tempfile::tempdir().unwrap();
    let chosen_path = dir.path().join("chosen-local-file");
    let chosen_contents = "chosen-local-file-contents-must-not-cross-network";
    std::fs::write(&chosen_path, chosen_contents).unwrap();

    let listener = StdTcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let malicious_path = chosen_path.display().to_string();
    let attacker = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept CLI request");
            let request = read_request(&mut stream);
            let offered_path = request.starts_with("GET /_snapback/api/inspect ");
            let body = if offered_path {
                serde_json::json!({"admin": {"tokenFile": malicious_path}}).to_string()
            } else {
                serde_json::json!({"ok": true}).to_string()
            };
            write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .expect("answer CLI request");
            requests.push(request);
            if !offered_path {
                break;
            }
        }
        requests
    });

    let target = TargetArgs {
        url: Some(format!("http://{address}")),
        ready_file: None,
        token: None,
        impersonation_capability_stdin: false,
    };
    let envelope = super::post_host_op(&target, json!({"operation": "app.inspect"}))
        .expect("host operation reaches adversarial server");
    assert_eq!(envelope["ok"], json!(true));

    let requests = attacker.join().expect("attacker server joins");
    assert_eq!(
        requests.len(),
        1,
        "a remote URL must be contacted only for the requested host operation"
    );
    assert!(requests[0].starts_with("POST /_snapback/api/host-ops "));
    assert!(
        !requests
            .iter()
            .any(|request| request.contains(chosen_contents)),
        "the attacker-chosen local file contents crossed the network"
    );
}

#[test]
fn mixed_url_and_ready_file_never_sends_the_local_ready_token() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("ready.json");
    let sibling = crate::admin::admin_token_sibling(&ready);
    std::fs::write(&sibling, b"sbat_local_only\n").unwrap();
    let mut descriptor = stop_descriptor(Some("nonce"));
    descriptor.admin_token_file = Some(sibling.display().to_string());
    std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();

    let mixed = TargetArgs {
        url: Some("http://attacker.invalid".to_owned()),
        ready_file: Some(ready),
        token: None,
        impersonation_capability_stdin: false,
    };
    assert_eq!(
        resolve_http_target(&mixed)
            .expect("explicit URL wins in directly-constructed args")
            .minted_token,
        None
    );

    let parse = Cli::try_parse_from([
        "snapback",
        "inspect",
        "--url",
        "http://attacker.invalid",
        "--ready-file",
        "ready.json",
    ]);
    assert!(
        parse.is_err(),
        "the CLI must reject ambiguous mixed targets"
    );
}

fn resolve_ready_file_minted_token(
    ready: &Path,
    descriptor: &crate::host_ops::HostReadyDescriptor,
) -> Option<String> {
    crate::secure_file::write_owner_only(ready, &serde_json::to_vec(descriptor).unwrap()).unwrap();
    let target = TargetArgs {
        url: None,
        ready_file: Some(ready.to_path_buf()),
        token: None,
        impersonation_capability_stdin: false,
    };
    resolve_http_target_for_operation(&target, false, false)
        .unwrap()
        .minted_token
}

#[test]
fn minted_token_discovery_uses_file_database_sibling_across_and_within_directories() {
    let ready_dir = tempfile::tempdir().unwrap();
    let database_dir = tempfile::tempdir().unwrap();
    let ready = std::fs::canonicalize(ready_dir.path())
        .unwrap()
        .join("ready.json");
    let database = std::fs::canonicalize(database_dir.path())
        .unwrap()
        .join("app.sqlite3");
    let token_file = crate::admin::admin_token_sibling(&database);
    crate::secure_file::write_owner_only(&token_file, b"sbat_different_directory\n").unwrap();

    let mut descriptor = stop_descriptor(Some("nonce"));
    descriptor.database.mode = "file".to_owned();
    descriptor.database.path = Some(database.display().to_string());
    descriptor.admin_token_file = Some(token_file.display().to_string());
    assert_eq!(
        resolve_ready_file_minted_token(&ready, &descriptor).as_deref(),
        Some("sbat_different_directory")
    );

    let same_directory_database = ready.parent().unwrap().join("same-directory.sqlite3");
    let same_directory_token = crate::admin::admin_token_sibling(&same_directory_database);
    crate::secure_file::write_owner_only(&same_directory_token, b"sbat_same_directory\n").unwrap();
    descriptor.database.path = Some(same_directory_database.display().to_string());
    descriptor.admin_token_file = Some(same_directory_token.display().to_string());
    assert_eq!(
        resolve_ready_file_minted_token(&ready, &descriptor).as_deref(),
        Some("sbat_same_directory")
    );
}

#[cfg(unix)]
#[test]
fn minted_token_discovery_refuses_world_readable_file_database_sibling() {
    use std::os::unix::fs::PermissionsExt as _;

    let ready_dir = tempfile::tempdir().unwrap();
    let database_dir = tempfile::tempdir().unwrap();
    let ready = std::fs::canonicalize(ready_dir.path())
        .unwrap()
        .join("ready.json");
    let database = std::fs::canonicalize(database_dir.path())
        .unwrap()
        .join("app.sqlite3");
    let token_file = crate::admin::admin_token_sibling(&database);
    std::fs::write(&token_file, b"sbat_world_readable\n").unwrap();
    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o644)).unwrap();

    let mut descriptor = stop_descriptor(Some("nonce"));
    descriptor.database.mode = "file".to_owned();
    descriptor.database.path = Some(database.display().to_string());
    descriptor.admin_token_file = Some(token_file.display().to_string());
    assert_eq!(resolve_ready_file_minted_token(&ready, &descriptor), None);
    assert_eq!(
        std::fs::metadata(token_file).unwrap().permissions().mode() & 0o777,
        0o644,
        "refused discovery must not expose or repair a permissive token file"
    );
}

#[test]
fn minted_token_discovery_refuses_nonmechanical_file_database_path() {
    let ready_dir = tempfile::tempdir().unwrap();
    let database_dir = tempfile::tempdir().unwrap();
    let ready = std::fs::canonicalize(ready_dir.path())
        .unwrap()
        .join("ready.json");
    let database = std::fs::canonicalize(database_dir.path())
        .unwrap()
        .join("app.sqlite3");
    let unrelated = database_dir.path().join("unrelated.admin-token");
    crate::secure_file::write_owner_only(&unrelated, b"sbat_unrelated\n").unwrap();

    let mut descriptor = stop_descriptor(Some("nonce"));
    descriptor.database.mode = "file".to_owned();
    descriptor.database.path = Some(database.display().to_string());
    descriptor.admin_token_file = Some(unrelated.display().to_string());
    assert_eq!(resolve_ready_file_minted_token(&ready, &descriptor), None);
}

#[test]
fn minted_token_discovery_keeps_memory_ready_file_sibling() {
    let ready_dir = tempfile::tempdir().unwrap();
    let ready = std::fs::canonicalize(ready_dir.path())
        .unwrap()
        .join("ready.json");
    let token_file = crate::admin::admin_token_sibling(&ready);
    crate::secure_file::write_owner_only(&token_file, b"sbat_memory\n").unwrap();

    let mut descriptor = stop_descriptor(Some("nonce"));
    descriptor.admin_token_file = Some(token_file.display().to_string());
    assert_eq!(
        resolve_ready_file_minted_token(&ready, &descriptor).as_deref(),
        Some("sbat_memory")
    );
}

#[test]
fn ready_file_token_discovery_accepts_only_its_owner_only_sibling() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("ready.json");
    let canonical_ready = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("ready.json");
    let sibling = crate::admin::admin_token_sibling(&canonical_ready);
    let arbitrary = dir.path().join("arbitrary-secret");
    crate::secure_file::write_owner_only(&sibling, b"sbat_expected\n").unwrap();
    crate::secure_file::write_owner_only(&arbitrary, b"sbat_attacker_chosen\n").unwrap();

    let target = TargetArgs {
        url: None,
        ready_file: Some(ready.clone()),
        token: None,
        impersonation_capability_stdin: false,
    };
    let mut descriptor = stop_descriptor(Some("nonce"));
    descriptor.admin_token_file = Some(arbitrary.display().to_string());
    std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();
    assert_eq!(resolve_http_target(&target).unwrap().minted_token, None);

    descriptor.admin_token_file = Some(sibling.display().to_string());
    std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();
    assert_eq!(
        resolve_http_target(&target)
            .unwrap()
            .minted_token
            .as_deref(),
        Some("sbat_expected")
    );
}

#[test]
fn ready_descriptor_swap_cannot_mix_an_attacker_url_with_a_trusted_token() {
    let dir = tempfile::tempdir().unwrap();
    let ready = dir.path().join("ready.json");
    let sibling = crate::admin::admin_token_sibling(&ready);
    std::fs::write(&sibling, b"sbat_must_not_be_exfiltrated\n").unwrap();

    let target = TargetArgs {
        url: None,
        ready_file: Some(ready.clone()),
        token: None,
        impersonation_capability_stdin: false,
    };
    let mut attacker = stop_descriptor(Some("attacker"));
    attacker.server_url = "http://attacker.invalid".to_owned();
    attacker.target.server_url = Some(attacker.server_url.clone());
    attacker.admin_token_file = None;
    std::fs::write(&ready, serde_json::to_vec(&attacker).unwrap()).unwrap();

    // Resolve the complete request authority from the attacker snapshot.
    // Swapping in a trusted descriptor afterwards must not trigger a
    // second descriptor read that adds its local capability to that URL.
    let resolved = resolve_http_target(&target).unwrap();
    let mut trusted = stop_descriptor(Some("trusted"));
    trusted.admin_token_file = Some(sibling.display().to_string());
    std::fs::write(&ready, serde_json::to_vec(&trusted).unwrap()).unwrap();

    assert_eq!(resolved.server_url, "http://attacker.invalid");
    assert_eq!(
        resolved.minted_token, None,
        "a later trusted descriptor must not donate its token to the already-resolved attacker URL"
    );
}

#[tokio::test]
async fn requested_port_range_scans_ascending_past_an_occupied_port() {
    let mut pair = None;
    for base in 20_000..60_000u16 {
        let Ok(low) = TcpListener::bind(("127.0.0.1", base)).await else {
            continue;
        };
        let Ok(busy) = TcpListener::bind(("127.0.0.1", base + 1)).await else {
            drop(low);
            continue;
        };
        drop(low);
        pair = Some((base, busy));
        break;
    }
    let (low_port, _busy_high) = pair.expect("a free adjacent loopback port pair");

    let listener = bind_first_available("127.0.0.1", low_port..=low_port + 1)
        .await
        .unwrap();

    assert_eq!(listener.local_addr().unwrap().port(), low_port);
}

#[tokio::test]
async fn explicit_port_zero_uses_os_assigned_port() {
    let listener = bind_listener("127.0.0.1", Some(0), None).await.unwrap();

    assert_ne!(listener.local_addr().unwrap().port(), 0);
}

#[test]
fn port_range_parser_accepts_valid_and_refuses_reversed_malformed_and_zero() {
    assert_eq!(parse_port_range("48100-48199").unwrap(), 48_100..=48_199);
    assert!(parse_port_range("48199-48100").is_err());
    assert!(parse_port_range("48100:48199").is_err());
    assert!(parse_port_range("0-48199").is_err());
    assert!(
        Args::try_parse_from(["snapback", "--port", "48100", "--port-range", "48100-48199",])
            .is_err()
    );
}

#[test]
fn database_path_is_absolute_after_parent_creation() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("nested").join("snapback.db");

    let resolved = prepare_database_path(&db_path).unwrap();

    assert!(resolved.is_absolute());
    assert_eq!(resolved.file_name().unwrap(), "snapback.db");
    assert!(db_path.parent().unwrap().exists());
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
#[test]
fn stale_startup_reservation_reaches_the_projected_cli_diagnostic() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("stale-instance").join("snapback.db");
    let lock_path = crate::instance_lock::target_reservation_path_for_database(&db_path).unwrap();
    std::fs::write(&lock_path, b"pre-rework reservation\n").unwrap();
    std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o644)).unwrap();

    let error = prepare_database_path_for_startup(&db_path)
        .expect_err("startup must report the recovered legacy reservation");
    assert!(
        format!("{error:#}")
            .starts_with("database target could not be reserved and pinned before startup"),
        "the projection witness must include the real startup context wrapper: {error:#}"
    );
    let (_exit, envelope) = super::project_cli_failure(&error);
    assert_eq!(
        envelope["diagnostics"][0]["code"], "SNAPBACK_TARGET_INSTANCE_RESERVATION_STALE",
        "the real projected failure must preserve the typed stale code: {envelope}"
    );
    assert_ne!(envelope["diagnostics"][0]["code"], "SNAPBACK_CLI_FAILED");
    assert!(
        !lock_path.exists(),
        "the projected diagnostic follows identity-checked stale removal"
    );
    assert!(
        !db_path.parent().unwrap().exists(),
        "stale recovery must still precede target-instance creation"
    );
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
#[test]
fn startup_creation_participates_in_the_restore_target_reservation() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("new-instance").join("snapback.db");
    let restore = TargetInstanceReservation::acquire(&db_path).unwrap();

    let error = prepare_database_path_for_startup(&db_path)
        .expect_err("startup must not create through a restore reservation");
    assert!(format!("{error:#}").contains("already reserved"));
    assert!(!db_path.parent().unwrap().exists());
    drop(restore);

    let (resolved, startup) = prepare_database_path_for_startup(&db_path).unwrap();
    let startup = startup.expect("absent instance creation holds the outer reservation");
    assert!(resolved.parent().unwrap().is_dir());
    let _inner = crate::instance_lock::DatabaseInstanceLock::acquire(&resolved).unwrap();
    drop(startup);

    let restore_after_start = TargetInstanceReservation::acquire(&resolved).unwrap();
    assert!(restore_after_start.ensure_target_absent().is_err());
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
#[test]
fn startup_with_missing_outer_parents_creates_only_then_reserves_the_outer_parent() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir
        .path()
        .join("missing")
        .join("outer")
        .join("instance")
        .join("snapback.db");

    let (resolved, reservation) = prepare_database_path_for_startup(&db_path).unwrap();
    let reservation = reservation.expect("supported startup always holds a reservation");
    reservation.ensure_valid().unwrap();
    let expected = std::fs::canonicalize(db_path.parent().unwrap().parent().unwrap())
        .unwrap()
        .join("instance/snapback.db");
    assert_eq!(resolved, expected);
    assert!(db_path.parent().unwrap().is_dir());
    assert!(
        crate::instance_lock::target_reservation_path_for_database(&resolved)
            .unwrap()
            .is_file()
    );
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
#[test]
fn existing_instance_restart_is_reserved_and_protects_the_persistent_sidecar() {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("existing-instance");
    std::fs::create_dir(&instance).unwrap();
    let db_path = instance.join("snapback.db");
    std::fs::write(&db_path, b"").unwrap();

    let (resolved, reservation) = prepare_database_path_for_startup(&db_path).unwrap();
    let reservation = reservation.expect("existing instances also retain the reservation");
    reservation.ensure_valid().unwrap();
    let lock_path = crate::instance_lock::target_reservation_path_for_database(&resolved).unwrap();
    assert!(lock_path.is_file());
    let error = validate_path_disjointness(
        &managed_startup_paths(Some(&resolved), Some(&lock_path)).unwrap(),
    )
    .expect_err("a ready file may not overwrite the persistent reservation record");
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
    );
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
#[test]
fn startup_target_replacement_invalidates_the_inner_lock_handoff() {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("replaceable-instance");
    std::fs::create_dir(&instance).unwrap();
    let db_path = instance.join("snapback.db");
    let (_resolved, reservation) = prepare_database_path_for_startup(&db_path).unwrap();
    let reservation = reservation.unwrap();
    let moved = dir.path().join("prepared-instance-moved");

    std::fs::rename(&instance, &moved).unwrap();
    std::fs::create_dir(&instance).unwrap();
    std::fs::write(instance.join("foreign-sentinel"), b"survive").unwrap();

    let error = reservation
        .ensure_valid()
        .expect_err("the pathname must still name the pinned target inode");
    assert!(error.to_string().contains("identity changed"));
    drop(reservation);
    assert_eq!(
        std::fs::read(instance.join("foreign-sentinel")).unwrap(),
        b"survive"
    );
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
#[test]
fn startup_probe_remove_race_still_contends_on_the_restore_reservation() {
    use std::cell::RefCell;
    use std::rc::Rc;

    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("initially-existing");
    std::fs::create_dir(&instance).unwrap();
    let db_path = instance.join("snapback.db");
    let competing = Rc::new(RefCell::new(None));
    let competing_for_hook = Rc::clone(&competing);
    let instance_for_hook = instance.clone();
    BEFORE_STARTUP_TARGET_RESERVATION.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(move |resolved| {
            std::fs::remove_dir(&instance_for_hook).unwrap();
            *competing_for_hook.borrow_mut() =
                Some(TargetInstanceReservation::acquire(resolved).unwrap());
        }));
    });

    let error = prepare_database_path_for_startup(&db_path)
        .expect_err("startup may not fall back to unreserved create_dir_all");
    assert!(error.to_string().contains("could not be reserved"));
    assert!(!instance.exists());
    assert!(competing.borrow().is_some());
}

#[cfg(unix)]
#[test]
fn existing_database_symlink_resolves_to_target() {
    let dir = tempfile::tempdir().expect("tempdir");
    let real_db = dir.path().join("real.sqlite3");
    let link_db = dir.path().join("link.sqlite3");
    std::fs::write(&real_db, b"").expect("write db placeholder");
    std::os::unix::fs::symlink(&real_db, &link_db).expect("symlink db");

    let resolved = super::resolve_database_path(&link_db).unwrap();

    assert_eq!(resolved, std::fs::canonicalize(&real_db).unwrap());
}

#[cfg(all(unix, any(target_vendor = "apple", target_os = "linux")))]
#[test]
fn startup_reservation_follows_existing_instance_and_database_symlinks() {
    let dir = tempfile::tempdir().unwrap();
    let real_instance = dir.path().join("real-instance");
    let instance_alias = dir.path().join("instance-alias");
    std::fs::create_dir(&real_instance).unwrap();
    std::os::unix::fs::symlink(&real_instance, &instance_alias).unwrap();
    let real_db = real_instance.join("real.sqlite3");
    let database_alias = real_instance.join("alias.sqlite3");
    std::fs::write(&real_db, b"").unwrap();
    std::os::unix::fs::symlink(&real_db, &database_alias).unwrap();

    let requested = instance_alias.join("alias.sqlite3");
    let (resolved, reservation) = prepare_database_path_for_startup(&requested).unwrap();
    let reservation = reservation.expect("canonical instance remains reserved");

    assert_eq!(resolved, std::fs::canonicalize(&real_db).unwrap());
    reservation.ensure_valid().unwrap();
    assert!(
        crate::instance_lock::target_reservation_path_for_database(&resolved)
            .unwrap()
            .is_file()
    );
}

#[test]
fn rehearsal_carrier_has_only_the_bounded_stdin_attachment_surface() {
    assert!(
        Cli::try_parse_from([
            "snapback",
            "auth",
            "rehearse",
            "exercise",
            "--url",
            "http://127.0.0.1:4287",
            "--input",
            "request.json",
            "--rehearsal-capability-stdin",
        ])
        .is_ok()
    );
    let argv_carrier = Cli::try_parse_from([
        "snapback",
        "auth",
        "rehearse",
        "exercise",
        "--url",
        "http://127.0.0.1:4287",
        "--input",
        "request.json",
        "--rehearsal-capability",
        "sbrc_must-not-be-an-argv-carrier",
    ])
    .unwrap_err();
    assert_eq!(argv_carrier.kind(), clap::error::ErrorKind::UnknownArgument);
    assert!(!include_str!("../cli.rs").contains("SNAPBACK_AUTH_REHEARSAL_CAPABILITY="));
}

#[cfg(unix)]
#[test]
fn rehearsal_sidecar_is_new_owner_only_and_never_overwrites() {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    let directory = tempfile::tempdir().expect("rehearsal sidecar directory");
    let sidecar = directory.path().join("server.ready.json.rehearsal");
    super::write_rehearsal_capability_sidecar(&sidecar, b"first-secret")
        .expect("publish first rehearsal carrier");
    let metadata = std::fs::symlink_metadata(&sidecar).expect("sidecar metadata");
    assert!(metadata.file_type().is_file());
    assert!(!metadata.file_type().is_symlink());
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
    assert_eq!(metadata.nlink(), 1);
    assert_eq!(std::fs::read(&sidecar).unwrap(), b"first-secret");
    assert!(super::write_rehearsal_capability_sidecar(&sidecar, b"replacement").is_err());
    assert_eq!(std::fs::read(&sidecar).unwrap(), b"first-secret");
}

#[test]
fn migrate_json_and_digest_acknowledgement_parse_as_one_surface() {
    let parsed = Cli::try_parse_from([
        "snapback",
        "migrate",
        "--json",
        "approve",
        "preview.json",
        "--db",
        "app.sqlite",
        "--out",
        "approved.json",
        "--acknowledge-digests",
        "plan:observation",
    ])
    .expect("migrate machine mode parses");
    let Some(HostCommand::Migrate { json, command }) = parsed.command else {
        panic!("expected migrate command");
    };
    assert!(json);
    let super::MigrateCommand::Approve {
        acknowledge_digests,
        ..
    } = command
    else {
        panic!("expected approve command");
    };
    assert_eq!(acknowledge_digests.as_deref(), Some("plan:observation"));
}

#[test]
fn migrate_approval_authorization_is_exact_and_fail_closed() {
    let expected = "plan-digest:observation-digest";
    assert!(super::validate_approval_authorization(expected, Some(expected), None).is_ok());
    assert!(super::validate_approval_authorization(expected, None, Some("approve\n")).is_ok());
    for refused in [
        super::validate_approval_authorization(expected, Some("plan-digest"), None),
        super::validate_approval_authorization(expected, None, Some("yes")),
        super::validate_approval_authorization(expected, None, None),
    ] {
        let error = refused.expect_err("anything but exact authorization refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_APPROVAL_REQUIRED"
        );
    }
}

// The `migrate rehearse` verb is a thin file-IO wrapper over
// `migrate_rehearse_artifact` — this witnesses verb parity: the same
// binding refusal and the same marked, released receipt the library
// path produces (`restore_derived_rehearsal_gates_production_apply` in
// src/local.rs owns the semantic matrix).
#[test]
fn migrate_rehearse_verb_matches_the_library_path() {
    use super::{MigrateCommand, migrate_command};
    use crate::manifest::SchemaManifest;
    use crate::migration::{
        CompatibilityPosture, MIGRATION_APPROVAL_SCHEMA_VERSION, MIGRATION_PLAN_SCHEMA_VERSION,
        MigrationApprovalV1, MigrationAudienceV1, MigrationBackupRequirement, MigrationCeilings,
        MigrationConstants, MigrationExecutionStrategy, MigrationExpectedOutput,
        MigrationPlanArtifactV1, MigrationPlanBody, MigrationProof, MigrationProofMethod,
        MigrationRehearsalBindingV1, MigrationRehearsalPlanV1, RetainedWorkPosture, derive_intents,
        derive_plan_steps, new_operation_id,
    };

    let field = |name: &str, optional: bool| crate::manifest::FieldManifest {
        name: name.to_owned(),
        field_type: crate::manifest::FieldType::String,
        optional,
    };
    let schema_of = |fields: Vec<crate::manifest::FieldManifest>| SchemaManifest {
        tables: vec![crate::manifest::TableManifest {
            name: "notes".to_owned(),
            fields,
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    };
    let predecessor = schema_of(vec![field("body", false), field("extra", true)]);
    let successor = schema_of(vec![field("body", false)]);
    let identity = |schema: &SchemaManifest| {
        crate::storage::migration_executor::schema_identity(schema).expect("identity")
    };

    fn approve_for(
        snapback: &mut crate::local::LocalSnapback,
        artifact: &MigrationPlanArtifactV1,
    ) -> MigrationApprovalV1 {
        let resolved = snapback.migrate_resolved_audience().expect("audience");
        MigrationApprovalV1 {
            schema_version: MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
            plan_digest: artifact.plan_digest.clone(),
            observation_digest: "0".repeat(64),
            policy_digest: "local-operator-policy-v1".to_owned(),
            audience: MigrationAudienceV1 {
                project_id: None,
                target_id: None,
                environment_id: None,
                deployment_id: None,
                release_id: None,
                database_id: resolved.database_id,
                stream_incarnation: resolved.stream_incarnation,
                activation_generation: resolved.activation_generation,
                target_profile_id: resolved.target_profile_id,
            },
            approver: "cli-witness-operator".to_owned(),
            generator_is_approver: true,
            issued_at_ms: super::wall_clock_now_ms(),
            expires_at_ms: super::wall_clock_now_ms() + 86_400_000,
            operation_id: new_operation_id(),
        }
    }

    let directory = tempfile::tempdir().unwrap();
    let db = directory.path().join("isolated.sqlite");
    let (artifact, approval, rehearsal) = {
        let mut isolated = crate::local::LocalSnapback::open(&db).expect("open isolated");
        isolated
            .apply_schema(predecessor.clone())
            .expect("apply schema");
        let intents = derive_intents(&predecessor, &successor).expect("derive intents");
        let steps = derive_plan_steps(&predecessor, &successor, &intents).expect("derive steps");
        let artifact = MigrationPlanArtifactV1::seal(MigrationPlanBody {
            schema_version: MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
            app: isolated.migrate_app_id(),
            instance: "cli-rehearse-witness".to_owned(),
            target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            predecessor_schema_hash: identity(&predecessor),
            successor_schema_hash: identity(&successor),
            predecessor_generation: 1,
            steps,
            execution_strategy: MigrationExecutionStrategy::SingleTransaction,
            proof: MigrationProof {
                method: MigrationProofMethod::Full,
                bound: None,
            },
            ceilings: MigrationCeilings {
                max_affected_rows: 100,
                max_bytes: 1024 * 1024,
                max_writes: 100,
                max_barrier_downtime_ms: 60_000,
            },
            compatibility_posture: CompatibilityPosture::SuccessorOnly,
            retained_work_posture: RetainedWorkPosture::Empty,
            backup: MigrationBackupRequirement {
                required: false,
                checkpoint_label: None,
                rehearsal_required: true,
            },
            expected_output: MigrationExpectedOutput {
                schema_hash: identity(&successor),
                projection_generations: std::collections::BTreeMap::new(),
            },
            constants: MigrationConstants {
                publication_timestamp_ms: 2_000_000_000_000,
                rollback_timestamp_ms: None,
                values: std::collections::BTreeMap::new(),
            },
            boundaries: Default::default(),
        })
        .expect("seal plan");
        let approval = approve_for(&mut isolated, &artifact);
        let rehearsal = MigrationRehearsalPlanV1::seal(
            artifact.plan_digest.clone(),
            MigrationRehearsalBindingV1 {
                source_backup_identity: "backup-cli-witness-1".to_owned(),
                isolated_database_id: approval.audience.database_id.clone(),
                restore_epoch_ms: 1_000,
                target_profile_id: approval.audience.target_profile_id.clone(),
            },
        )
        .expect("seal rehearsal");
        (artifact, approval, rehearsal)
    };

    let write = |name: &str, value: serde_json::Value| {
        let path = directory.path().join(name);
        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap()).unwrap();
        path
    };
    let observation = crate::migration::MigrationPreviewObservationV1 {
        schema_version: "migration-observation-v1".to_owned(),
        plan_digest: artifact.plan_digest.clone(),
        target_head_version: 1,
        observed_at_ms: super::wall_clock_now_ms(),
        precondition_rows: std::collections::BTreeMap::new(),
        capability_health: std::collections::BTreeMap::new(),
    };
    let approved_path = write(
        "approved.json",
        json!({ "artifact": artifact, "observation": observation, "approval": approval }),
    );
    let schema_path = write("successor.json", serde_json::to_value(&successor).unwrap());
    let rehearsal_path = write("rehearsal.json", serde_json::to_value(&rehearsal).unwrap());

    // (a) Binding refusal parity: the verb delegates to
    // `migrate_rehearse_artifact` before any receipt write, and a
    // refused invocation exits the process with the diagnostic envelope
    // (`migrate_emit`'s CLI contract), so the refusal semantics are
    // asserted at the exact boundary the verb wraps — a database that
    // is not the bound restore-derived target refuses and nothing is
    // written.
    let other_db = directory.path().join("other.sqlite");
    {
        let mut other = crate::local::LocalSnapback::open(&other_db).expect("open other");
        other
            .apply_schema(predecessor.clone())
            .expect("apply schema");
        let other_approval = approve_for(&mut other, &artifact);
        let error = other
            .migrate_rehearse_artifact(&artifact, &other_approval, &successor, &rehearsal)
            .expect_err("a rehearsal must not execute off its bound target");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_REHEARSAL_INVALID"
        );
    }

    // (b) Against the bound isolated target the verb writes the same
    // marked, released receipt the library path produces.
    let out = directory.path().join("rehearsal-receipt.json");
    migrate_command(
        MigrateCommand::Rehearse {
            approved: approved_path,
            schema: schema_path,
            rehearsal_plan: rehearsal_path,
            db: db.clone(),
            out: out.clone(),
        },
        true,
    )
    .expect("rehearse verb runs");
    let receipt: crate::storage::migration_executor::MigrationReceiptV1 =
        serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    assert!(receipt.rehearsal, "the receipt is marked rehearsal");
    assert_eq!(receipt.state.kind(), "released");
    assert_eq!(receipt.plan_digest, artifact.plan_digest);
}
