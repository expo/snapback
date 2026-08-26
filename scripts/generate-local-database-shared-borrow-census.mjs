#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_REF = "df2f32400";
const EXPECTED_BASELINE_COUNT = 111;
const OUTPUT = "tests/acceptance/kernel-authorization-closure-round4-shared-borrow-census.md";
const SOURCE_PREFIX = "crates/snapback-kernel/src";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env:
      command === "cargo"
        ? { ...process.env, CARGO_TARGET_DIR: path.join(root, "target/security-gates-rust") }
        : process.env,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

function astMethods(sourceRoot, publicOnly) {
  const args = [
    "run",
    "--quiet",
    "--manifest-path",
    "scripts/security-gates-rust/Cargo.toml",
    "--",
    "local-shared-methods",
    "--source-root",
    sourceRoot,
  ];
  if (publicOnly) args.push("--public-only");
  return JSON.parse(run("cargo", args));
}

function baselineSource() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "snapback-local-shared-census-"));
  const files = run("git", [
    "ls-tree",
    "-r",
    "--name-only",
    BASE_REF,
    "--",
    SOURCE_PREFIX,
  ])
    .trim()
    .split("\n")
    .filter((file) => file.endsWith(".rs"));
  for (const file of files) {
    const relative = path.relative(SOURCE_PREFIX, file);
    const destination = path.join(temporary, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, run("git", ["show", `${BASE_REF}:${file}`], { encoding: null }));
  }
  return temporary;
}

const dispositions = new Map();

function classify(methods, disposition, reason) {
  for (const method of methods) {
    if (dispositions.has(method)) throw new Error(`duplicate disposition for ${method}`);
    dispositions.set(method, { disposition, reason });
  }
}

classify(
  [
    "api_envelope_read",
    "jobs_read",
    "settlement_read",
    "query_reads_read",
  ],
  "unprivileged",
  "Returns a typed read carrier whose public methods were separately audited as SELECT/read-snapshot only; it exposes no connection, mutable database, or writer-opening runtime.",
);

classify(
  ["auth_catalog_read"],
  "unprivileged",
  "Returns the READ variant of `AuthCatalogKernel`. Its public `&self` methods use SELECT/read-snapshot paths; the carrier also has public `&mut self` mutators, but every one enters `write_db()` and panics on the READ variant before database access. It exposes no connection, database, or writer-opening runtime.",
);

classify(
  ["detached_read_snapshot"],
  "unprivileged",
  "Returns a distinct non-adoptable `DetachedReadSnapshot`. Its private database can only be shared through `as_database`; every public shared-borrow method reachable there is a retained row in this same complete census.",
);

classify(
  ["binding"],
  "unprivileged",
  "Returns identity-only `DatabaseBinding`; it has no public fact-assertion or write operation and its five accepting methods require `&mut LocalDatabase` plus exact identity equality.",
);

classify(
  ["schema"],
  "unprivileged",
  "Borrows immutable manifest data only; the returned manifest has no database or writer capability.",
);

classify(
  ["database_path"],
  "unprivileged",
  "Borrows the configured pathname only. Direct filesystem/SQLite-file custody is explicitly outside LLP 0285's authorization threat boundary; no kernel authority is returned.",
);

classify(
  ["generate_id"],
  "unprivileged",
  "Pure UUIDv7 generation; it does not read or mutate database or process-authority state.",
);

classify(
  ["attempt_unmediated_app_insert_for_test"],
  "contained",
  "Demoted to `pub(crate)` on `LocalDatabase`; the connection authorizer is state-dependent and an ordinary unarmed database permits this fixed INSERT. The only public bridge requires `&mut ServingDatabase`, so it is not inherited through shared-borrow `Deref`.",
);

classify(
  ["backup_auth_catalog_into", "backup_database_image_into"],
  "unprivileged",
  "Reads the source snapshot and writes only the caller-owned staging file descriptor; it neither mutates the serving database nor returns a database/write carrier.",
);

classify(
  [
    "reconcile_ambiguous_service_terminal",
    "make_sender_proof_replay_unavailable_for_test",
    "make_authentication_throttle_unavailable_for_test",
  ],
  "contained",
  "Demoted to `pub(crate)` on `LocalDatabase`; it is no longer reachable through public `ServingDatabase::Deref`. The two outage probes cross only exclusive serving-owner test methods; ambiguous settlement remains kernel-internal after operation-specific durable rereads.",
);

classify(
  [
    "committed_promotion_contention_rows_for_bench",
    "info",
    "operation_lane_covered",
    "agent_safe_exact_operation_coverage_active",
    "derived_fork_exact_app_row_journal_coverage_active",
    "current_data_version_stream",
    "validate_order_field_bounds",
    "validate_sequence_scope_activation",
    "validate_sequence_declaration_preflight",
    "sequence_scope_enrollment_count",
    "inspect_vector_rebuild",
    "vector_generation_status_for_test",
    "room_permission_projection_granted",
    "membership_creation_provenance",
    "membership_transition_log",
    "inspect_auth_catalog",
    "auth_catalog_ready",
    "auth_password_identifier_mode",
    "auth_password_provider_readiness",
    "password_attempt_for_test",
    "auth_session_clock_floor",
    "auth_key_is_referenced",
    "auth_retained_key_ids",
    "plan_agent_credential_rotation_service_terminal",
    "plan_agent_credential_family_service_terminal",
    "plan_integration_credential_family_service_terminal",
    "plan_integration_principal_service_terminal",
    "plan_scoped_token_service_terminal",
    "plan_scoped_token_release",
    "plan_pairing_scoped_token_service_terminal",
    "retained_service_authority_is_live_readonly",
    "plan_expired_service_authority_terminal",
    "agent_owner",
    "agent_is_deactivated",
    "require_agent_not_deactivated",
    "asset_callbacks_service_principal_is_live",
    "plan_grant_revocation_service_terminal",
    "plan_bulk_grant_revocation_service_terminal",
    "password_attempt_matches",
    "password_set_planning",
    "password_change_planning",
    "guest_claim_predecessor",
    "recovery_code_predecessor",
    "password_snapshot",
    "password_authentication_predecessor",
    "password_reset_predecessor",
    "password_attempt_admin_projection",
    "password_hash_facts_for_test",
    "identity_id_for_provider_subject_for_test",
    "displacement_facts_for_test",
    "identity_claims",
    "oauth_bundle_names_for_grant",
    "require_active_integration_if_present",
    "integration_record_if_present",
    "list_integrations",
    "integration_record_for_test",
    "integration_grant_revoked_for_test",
    "oauth_registration_facts_for_test",
    "invalidation_retry_episode_count",
    "total_row_changes_for_test",
    "auth_logical_export",
    "auth_mode_snapshot",
    "auth_rehearsal_state_present_at_open",
    "auth_rehearsal_status",
    "auth_rehearsal_window_for_contact",
    "auth_rehearsal_window_for_challenge",
    "auth_rehearsal_require_production_eligible",
    "current_auth_scope_basis",
    "authorization_stream_incarnation",
    "authorization_version",
    "authorization_reservation_snapshot",
    "authorized_lease_reservation_count",
    "resolve_capability_link",
    "capability_link_effect_origin",
    "function_generation_record",
    "migration_rollback_receipt",
    "ensure_migration_lane_open",
    "migration_receipt",
    "migration_journal",
    "migration_aggregate_lookup",
    "migration_fence",
    "migration_verify_receipt",
    "migration_keyset_scan_batch",
    "migration_preview_observation_facts",
    "projection_rebuild_receipt",
    "push_registry_inspection",
    "schema_transition_events",
    "latest_schema_transition",
    "stream_transcript",
    "list_watches_for_owner",
    "watch_for_owner",
    "active_watches",
    "watch_for_execution",
    "watch_owner_is_active",
    "webhook_delivery_for_test",
  ],
  "unprivileged",
  "Audited read, validation, or planning path: it performs only pure work or SELECT/read-snapshot work against the serving database, returns owned/immutable facts, and exposes neither `&LocalDatabase`, a raw connection, nor a cloneable writer-opening runtime.",
);

function key(method) {
  return `${method.file}::${method.method}`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function render() {
  const baselineRoot = baselineSource();
  try {
    const baseline = astMethods(baselineRoot, true);
    const currentPublic = astMethods(path.join(root, SOURCE_PREFIX), true);
    const currentAll = astMethods(path.join(root, SOURCE_PREFIX), false);
    if (baseline.length !== EXPECTED_BASELINE_COUNT) {
      throw new Error(
        `expected ${EXPECTED_BASELINE_COUNT} baseline public shared methods, found ${baseline.length}`,
      );
    }

    const baselineKeys = new Set(baseline.map(key));
    const currentByKey = new Map(currentPublic.map((method) => [key(method), method]));
    const currentAllByKey = new Map(currentAll.map((method) => [key(method), method]));
    const additions = currentPublic.filter((method) => !baselineKeys.has(key(method)));
    if (additions.length > 0) {
      throw new Error(`unreviewed new public shared methods: ${additions.map(key).join(", ")}`);
    }

    const names = new Set(baseline.map((method) => method.method));
    const missingDispositions = [...names].filter((name) => !dispositions.has(name));
    const staleDispositions = [...dispositions.keys()].filter((name) => !names.has(name));
    if (missingDispositions.length || staleDispositions.length) {
      throw new Error(
        `disposition mismatch; missing=[${missingDispositions.join(", ")}], stale=[${staleDispositions.join(", ")}]`,
      );
    }

    const rows = baseline.map((base, index) => {
      const disposition = dispositions.get(base.method);
      const present = currentByKey.get(key(base));
      const current = present ?? currentAllByKey.get(key(base));
      if (!current) throw new Error(`baseline method disappeared instead of being contained: ${key(base)}`);
      if (disposition.disposition === "unprivileged" && !present) {
        throw new Error(`audited unprivileged method is no longer public: ${key(base)}`);
      }
      if (disposition.disposition === "contained" && present) {
        throw new Error(`contained method remains public: ${key(base)}`);
      }
      const cfg = base.cfg.length ? base.cfg.join(" ") : "all configurations";
      return `| ${index + 1} | \`${escapeCell(base.method)}\` | \`${escapeCell(base.file)}:${base.line}\` → \`${escapeCell(current.file)}:${current.line}\` | ${escapeCell(cfg)} | ${escapeCell(current.visibility)} | **${disposition.disposition}** — ${escapeCell(disposition.reason)} |`;
    });

    const contained = baseline.filter(
      (method) => dispositions.get(method.method).disposition === "contained",
    ).length;
    const retained = baseline.length - contained;
    return `# LLP 0285 round 4 — complete public shared-borrow \`LocalDatabase\` census

Generated by \`node scripts/generate-local-database-shared-borrow-census.mjs\`.
The AST helper parses every \`.rs\` file under \`${SOURCE_PREFIX}\` and deliberately
does **not** evaluate \`cfg\` attributes, so the result is the union across test,
\`test-support\`, and every other feature/configuration combination. The generator
compares the pinned round-4 base \`${BASE_REF}\` with the current tree, rejects a
new public shared-borrow method, rejects a missing disposition, and rejects a
"contained" method that remains public.

This is a **direct-method syntactic census**, not a transitive-reachability proof
or semantic ratchet. It cannot see macro-expanded methods, generated or included
sources, trait or blanket-impl methods, downstream Deref carriers, or new
privileged behavior added inside a method whose name is already classified. Its
configuration column records only attributes attached directly to the function;
it does not fold enclosing module or impl cfg attributes into that row.

## Result

- Base: **${baseline.length}** public inherent \`LocalDatabase\` methods taking a shared receiver.
- Final: **${retained}** retained public and audited unprivileged; **${contained}** demoted to \`pub(crate)\`; **0** unclassified; **0** new public methods.
- \`DetachedReadSnapshot::as_database\` is accounted for: it reaches exactly the
  ${retained} retained public rows below, and the wrapper cannot be adopted into a
  serving authority graph.
- Within those limits, this records the LLP 0285 risk-6 \`Deref\` shared-borrow
  containment result for this tree; it is evidence to review, not proof.
  It does **not** claim that LLP 0283 F-1, LLP 0285 defects 1–4, or the
  caller-fact forgery half are closed; the remaining public
  \`ServingDatabase\` bridges are custody narrowing unless and until the kernel
  re-derives their facts.

## Cumulative-range correction

- Correction to the earlier \`8c686052d\` commit message: the cumulative range
  \`29923c4cd..8c686052d\` did modify
  \`crates/snapback-engine/src/push/authority_tests.rs\`. That commit replaced
  two tests' direct \`LocalDatabase::claim_kernel_commit_authority\` use with
  \`ServingDatabase::adopt\`, then passed the unique serving owner to push
  admission and ledger-projection helpers after their receiver changed from
  \`KernelCommitAuthority\` to \`ServingDatabase\`. The adaptation was
  appropriate to preserve those tests while removing their direct route to the
  kernel-private root; the statement that the prohibited set was untouched was
  nevertheless false. The historical cumulative range had no net change to
  \`test_support\`; Landing B subsequently retired \`remainder-tests\`.

## Runtime-guard-dependent dispositions

All ${baseline.length} rows were re-audited for justifications that depend on
runtime state rather than visibility or pure SELECT/read-snapshot behavior. The
sub-list is **row 2, \`auth_catalog_read\`, only**: its READ carrier contains public
mutator methods, and containment depends on \`write_db()\` panicking before database
access. Former row-15 reasoning is deliberately absent: its SQLite authorizer is
not always armed, so that method is contained by \`pub(crate)\` visibility and its
public owner bridge requires \`&mut ServingDatabase\`.

## Complete generated table

| # | Method | Base → final site | Configuration union | Final exposure | Disposition |
| ---: | --- | --- | --- | --- | --- |
${rows.join("\n")}

## Adjacent owner-surface checks

- \`ServingDatabase::membership_plans_read\` was removed; the kernel-private
  \`LocalDatabase::membership_plans_read\` has no cross-kernel constructor path.
- \`BranchOpsReadKernel\` no longer returns \`&DerivedForkRuntime\` or
  \`&InAppBranchRuntime\`. It projects immutable lineage and applies the exact
  boot-derived egress mediation operation without lending cloneable runtimes.
- The sender-proof and authentication-throttle outage probes now require
  exclusive serving-owner access in test-support builds. Their destructive
  \`LocalDatabase(&self)\` forms are kernel-private.
- The fixed unmediated-insert probe is kernel-private on \`LocalDatabase\` and is
  exposed only as an explicit \`ServingDatabase(&mut self)\` test operation. The
  ordinary-unarmed regression proves the insert succeeds when no coverage
  manifest exists; no containment claim rests on the authorizer always refusing.
- LLP 0284 compile-fail attacks separately prove a shared \`&ServingDatabase\`
  cannot call the bridge and cannot reach the kernel-private method through
  \`Deref\`; receiver or visibility reversion makes the corresponding attack
  compile and fails the gate.
`;
  } finally {
    fs.rmSync(baselineRoot, { recursive: true, force: true });
  }
}

const rendered = render();
const outputPath = path.join(root, OUTPUT);
if (process.argv.includes("--write")) {
  fs.writeFileSync(outputPath, rendered);
  process.stdout.write(`${OUTPUT}\n`);
} else if (process.argv.includes("--check")) {
  const existing = fs.readFileSync(outputPath, "utf8");
  if (existing !== rendered) {
    throw new Error(`${OUTPUT} is stale; regenerate with --write`);
  }
  process.stdout.write(`LOCAL_DATABASE_SHARED_BORROW_CENSUS_OK ${EXPECTED_BASELINE_COUNT}\n`);
} else {
  process.stdout.write(rendered);
}
