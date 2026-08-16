# LLP 0262 Lane A — Stage 1 server report

Date: 2026-08-16
Branch: `impl0262-a-server`
Merge-base used for inherited-failure verification: `51157f37e638314e1fa902697dc41efa69eb2230`

## Scope and result

Implemented Stage 1 only: per-boot `sbdev_` mint/custody/distribution, verification when the dedicated header is presented at app-plane ClientAsserted installation and `/connection/open`, connection-grant witnessing for dev socket frames, once-per-boot compatibility warning for capability-less dev assertions, and the closed `SNAPBACK_EXPOSURE` contract. No absent-capability enforcement refusal and no D3 admin-read change were introduced. Admin-token-gated `function.run` / `auth.mintSession` authority was not gated.

The focused implementation tests pass. Of the four s5_d10 tests, three pass. `s5_d10_production_diagnostic_inventory_cannot_drift` fails on 18 unrelated, already-unclassified diagnostic literals. Replaying that exact test against the merge-base produced the identical 18-code list, proving the red is inherited. No full suite was run, and `DYLD_FRAMEWORK_PATH` was not set.

## Implementation commits

- `e450f14d7` — `feat: mint and custody dev identity capability`
- `68a5bbaf0` — `feat: witness dev identity authority installation`
- `458d1f52d` — `feat: apply declared exposure semantics`
- `b2e184483` — `docs: repair LLP 0262 reference anchors`

## Verification output

The blocks below are the verbatim merged stdout/stderr captured from each command. An empty block means the command produced no output.

### Mint, custody, cleanup, prod refusal, connection witness

Command: `cargo test --lib dev_identity -- --nocapture`
Exit status: `0`

```text
   Compiling ibex-runtime v0.1.0 (/Users/ccheever/projects/snapback/.claude/worktrees/impl0262-a-server/vendor/ibex)
   Compiling snapback v0.1.0 (/Users/ccheever/projects/snapback/.claude/worktrees/impl0262-a-server)
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2m 29s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 7 tests
test dev_identity::tests::anchor_ladder_suffix_is_identical_for_database_and_ready_anchors ... ok
SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING: accepted one legacy developer identity assertion without x-snapback-dev-identity; configure the client to read /tmp/app.sqlite3.dev-identity
test dev_identity::tests::unwitnessed_assertion_warning_is_once_per_registry_boot ... ok
test dev_identity::tests::capability_is_startup_bound_redacted_and_constant_time_verified ... ok
test dev_identity::tests::production_refuses_any_present_sidecar_and_names_it_locally ... ok
test dev_identity::tests::database_sidecar_overwrites_each_boot_is_owner_only_and_unlinks_on_drop ... ok
test cli::tests::dev_identity_ready_sidecar_rotates_and_follows_descriptor_custody ... ok
SNAPBACK_DEV_IDENTITY_REFUSED: presented developer identity capability did not verify; read the current capability from /operator/app.sqlite3.dev-identity
test server::tests::connection_open_binds_only_a_verified_dev_identity_witness ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 2776 filtered out; finished in 0.11s

```

### App-plane ClientAsserted verification, absent warning, wrong-presented refusal

Command: `cargo test --lib dev_client_asserted_capability_verifies_when_present_and_warns_when_absent -- --nocapture`
Exit status: `0`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.64s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 1 test
SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING: accepted one legacy developer identity assertion without x-snapback-dev-identity; configure the client to read /operator/app.sqlite3.dev-identity
SNAPBACK_DEV_IDENTITY_REFUSED: presented developer identity capability did not verify; read the current capability from /operator/app.sqlite3.dev-identity
test server::tests::dev_client_asserted_capability_verifies_when_present_and_warns_when_absent ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2782 filtered out; finished in 0.06s

```

### Live socket connection witness and Stage-1 warning posture

Command: `cargo test --lib dev_live_identity_frames_record_connection_witness_and_warn_once_when_unwitnessed -- --nocapture`
Exit status: `0`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.22s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 1 test
SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING: accepted one legacy developer identity assertion without x-snapback-dev-identity; configure the client to read /operator/app.sqlite3.dev-identity
SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING: accepted one legacy developer identity assertion without x-snapback-dev-identity; configure the client to read /operator/app.sqlite3.dev-identity
test server::tests::dev_live_identity_frames_record_connection_witness_and_warn_once_when_unwitnessed ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2782 filtered out; finished in 0.03s

```

### Credential prefix registry

Command: `cargo test --lib auth::crypto::tests::every_crc_bearer_class_rejects_every_other_class -- --nocapture`
Exit status: `0`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.21s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 1 test
test auth::crypto::tests::every_crc_bearer_class_rejects_every_other_class ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2782 filtered out; finished in 0.00s

```

### OQ2 host-operation non-gating regression

Command: `cargo test --lib host_ops_inspect_projects_recent_invocations_ring -- --nocapture`
Exit status: `0`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.20s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 1 test
test server::tests::host_ops_inspect_projects_recent_invocations_ring ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2782 filtered out; finished in 0.11s

```

### Per-process TTY disclosure seam

Command: `cargo test --lib terminal_emission_seam_consumes_one_operator_and_frames_one_line -- --nocapture`
Exit status: `0`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.22s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 1 test
test cli::tests::terminal_emission_seam_consumes_one_operator_and_frames_one_line ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2782 filtered out; finished in 0.00s

```

### Memory + ready-file advertisement and shutdown unlink

Command: `cargo test --test host_ops_v0 p6_ready_file_descriptor_is_written_and_validates -- --nocapture`
Exit status: `0`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
   Compiling snapback v0.1.0 (/Users/ccheever/projects/snapback/.claude/worktrees/impl0262-a-server)
warning: methods `has_committed_generation_record`, `awaits_committed_generation_reload`, and `awaiting_generation_high_water` are never used
     --> src/local.rs:21443:19
      |
 3960 | impl LocalSnapback {
      | ------------------ methods in this implementation
...
21443 |     pub(crate) fn has_committed_generation_record(&self) -> bool {
      |                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
21452 |     pub(crate) fn awaits_committed_generation_reload(&self) -> bool {
      |                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
21461 |     pub(crate) fn awaiting_generation_high_water(&self) -> Option<u64> {
      |                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      |
      = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `snapback` (lib) generated 1 warning
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (bin "snapback-schemagen") generated 1 warning
warning: `snapback` (bin "snapback-local") generated 1 warning (1 duplicate)
warning: `snapback` (bin "snapback") generated 1 warning (1 duplicate)
warning: `snapback` (test "host_ops_v0") generated 1 warning (1 duplicate)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1m 04s
     Running tests/host_ops_v0.rs (target/debug/deps/host_ops_v0-6f3fdedce7331b49)

running 1 test
ready file: /var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/.tmpvQQFvw/ready.json
snapback listening on http://127.0.0.1:59610
admin console: http://127.0.0.1:59610/_snapback/admin
admin: writes require the minted local admin token (SNAPBACK_ADMIN_TOKEN unset)
admin token: suppressed on non-TTY stdout; read the owner-only token file below
admin token file: /private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/.tmpvQQFvw/ready.json.admin-token
test p6_ready_file_descriptor_is_written_and_validates ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.10s

```

### Exposure and profile truth table (exact requested command)

Command: `cargo test resolve_profile`
Exit status: `0`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: methods `has_committed_generation_record`, `awaits_committed_generation_reload`, and `awaiting_generation_high_water` are never used
     --> src/local.rs:21443:19
      |
 3960 | impl LocalSnapback {
      | ------------------ methods in this implementation
...
21443 |     pub(crate) fn has_committed_generation_record(&self) -> bool {
      |                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
21452 |     pub(crate) fn awaits_committed_generation_reload(&self) -> bool {
      |                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
...
21461 |     pub(crate) fn awaiting_generation_high_water(&self) -> Option<u64> {
      |                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      |
      = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `snapback` (lib) generated 1 warning
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (bin "snapback-local") generated 1 warning
warning: `snapback` (bin "snapback-schemagen") generated 1 warning (1 duplicate)
warning: `snapback` (bin "snapback") generated 1 warning (1 duplicate)
   Compiling snapback v0.1.0 (/Users/ccheever/projects/snapback/.claude/worktrees/impl0262-a-server)
warning: `snapback` (test "host_ops_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "admin_secret_read_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "offline_replay_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "operational_readiness_v1") generated 1 warning (1 duplicate)
warning: `snapback` (test "concurrency_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "action_watchdog_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "served_guide_v1") generated 1 warning (1 duplicate)
warning: `snapback` (test "live_scheduler_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "control_catalog_registry_export") generated 1 warning (1 duplicate)
warning: `snapback` (test "auth_bypass_v1") generated 1 warning (1 duplicate)
warning: `snapback` (test "admin_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "config_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "action_stream_envelope_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "route_policy_v1") generated 1 warning (1 duplicate)
warning: `snapback` (test "agent_safe_router_v1") generated 1 warning (1 duplicate)
warning: `snapback` (test "dry_run_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "data_patch_v1") generated 1 warning (1 duplicate)
warning: `snapback` (test "ensure_auth_v1") generated 1 warning (1 duplicate)
warning: `snapback` (lib test) generated 1 warning (1 duplicate)
warning: `snapback` (test "network_profile_v1") generated 1 warning (1 duplicate)
warning: `snapback` (test "server_unknown_route") generated 1 warning (1 duplicate)
warning: `snapback` (test "rqs_routes_manifest_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "rqs_bundle_v0") generated 1 warning (1 duplicate)
warning: `snapback` (test "artifact_schemas_v0") generated 1 warning (1 duplicate)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 25.41s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 2 tests
test admin::tests::resolve_profile_fails_closed_on_unrecognized_values ... ok
test admin::tests::resolve_profile_exposure_truth_table_is_closed_and_fail_closed ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 2781 filtered out; finished in 0.01s

     Running unittests src/main.rs (target/debug/deps/snapback-0c29f4549561f28c)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-agent-safe-candidate.rs (target/debug/deps/snapback_agent_safe_candidate-576ddf15abd0cd81)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-agent-safe-paired.rs (target/debug/deps/snapback_agent_safe_paired-baddb8bdcaa33c27)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-agent-safe-step0.rs (target/debug/deps/snapback_agent_safe_step0-cf59c4b17e93fdfa)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-bench.rs (target/debug/deps/snapback_bench-5de10606128bf429)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-cf-manifest.rs (target/debug/deps/snapback_cf_manifest-23ebe548b6403cd3)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-conformance-twin.rs (target/debug/deps/snapback_conformance_twin-6e0671be4c15a53f)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-fork-promotion-bench.rs (target/debug/deps/snapback_fork_promotion_bench-b5dd148330b2ac43)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-hosted-admission.rs (target/debug/deps/snapback_hosted_admission-17ae6a28b9d35658)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-local.rs (target/debug/deps/snapback_local-c30d0af2ca363b82)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-sbsb2-vectors.rs (target/debug/deps/snapback_sbsb2_vectors-bc956f22a0158892)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/snapback-schemagen.rs (target/debug/deps/snapback_schemagen-028076b66790dcee)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/action_denial_witness_v0.rs (target/debug/deps/action_denial_witness_v0-e6f1fe7c4475df10)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/action_stream_envelope_v0.rs (target/debug/deps/action_stream_envelope_v0-017317e527e77880)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s

     Running tests/action_watchdog_v0.rs (target/debug/deps/action_watchdog_v0-c218e66e4cff535a)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 0.00s

     Running tests/admin_claim_link_v0.rs (target/debug/deps/admin_claim_link_v0-ece9a561ff2c14e4)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/admin_reachability_v0.rs (target/debug/deps/admin_reachability_v0-383fc1ea2f68d22d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/admin_secret_read_v0.rs (target/debug/deps/admin_secret_read_v0-15628f1a89bb1317)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s

     Running tests/admin_tailscale_v0.rs (target/debug/deps/admin_tailscale_v0-cd1e00e5154749ad)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/admin_v0.rs (target/debug/deps/admin_v0-8143b3ba5cc6a40e)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 47 filtered out; finished in 0.00s

     Running tests/agent_safe_router_v1.rs (target/debug/deps/agent_safe_router_v1-4a6fa4f7adbf4770)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/artifact_schemas_v0.rs (target/debug/deps/artifact_schemas_v0-3dff79efa84e489d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 36 filtered out; finished in 0.00s

     Running tests/auth_artifacts_v1.rs (target/debug/deps/auth_artifacts_v1-0d0638ab44b7cf3d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s

     Running tests/auth_bypass_v1.rs (target/debug/deps/auth_bypass_v1-d92e64b0a31dd970)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/auth_invocation_v1.rs (target/debug/deps/auth_invocation_v1-5b319f8adb896451)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/capability_v0.rs (target/debug/deps/capability_v0-f4eb75d6c36754b9)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s

     Running tests/concurrency_v0.rs (target/debug/deps/concurrency_v0-f693cadfb348f983)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.00s

     Running tests/config_set_cli_v0.rs (target/debug/deps/config_set_cli_v0-eef7fb0f49318d40)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/config_v0.rs (target/debug/deps/config_v0-f118d48df59eea0a)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s

     Running tests/conformance_v0.rs (target/debug/deps/conformance_v0-4c773762043750ae)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.00s

     Running tests/control_catalog_registry_export.rs (target/debug/deps/control_catalog_registry_export-c53eff1271a26ebd)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/ctx_ledger_v0.rs (target/debug/deps/ctx_ledger_v0-3b71460e6387d6c7)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s

     Running tests/data_patch_v1.rs (target/debug/deps/data_patch_v1-524dfca4f3a4f097)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.00s

     Running tests/data_tier_corpus_v0.rs (target/debug/deps/data_tier_corpus_v0-8a375b2ce7832e40)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/dry_run_v0.rs (target/debug/deps/dry_run_v0-bea12812a59bcf48)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s

     Running tests/egress_ambient_v0.rs (target/debug/deps/egress_ambient_v0-985944bd07a25fc1)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/embeddable_library_v0.rs (target/debug/deps/embeddable_library_v0-c4b8e5007688f81c)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/ensure_auth_v1.rs (target/debug/deps/ensure_auth_v1-a0094988cc081bd1)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s

     Running tests/guide_mcp_v1.rs (target/debug/deps/guide_mcp_v1-457ce38572c10f94)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/handler_harness_security_v0.rs (target/debug/deps/handler_harness_security_v0-2f084e206109bf90)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/handler_settlement_v0.rs (target/debug/deps/handler_settlement_v0-acebbf038f6094ce)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.00s

     Running tests/host_ops_v0.rs (target/debug/deps/host_ops_v0-6f3fdedce7331b49)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 14 filtered out; finished in 0.00s

     Running tests/inspect_casing_v0.rs (target/debug/deps/inspect_casing_v0-3648a23f90d713a4)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/instance_fork_bench_v1.rs (target/debug/deps/instance_fork_bench_v1-0334a8bfef1a573b)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/instance_fork_cli_v1.rs (target/debug/deps/instance_fork_cli_v1-2c6b736315139721)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s

     Running tests/instance_fork_disk_pressure_v1.rs (target/debug/deps/instance_fork_disk_pressure_v1-3feeaa90184cc8d5)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/instance_fork_replication_wal_v0.rs (target/debug/deps/instance_fork_replication_wal_v0-e75d48306cedaaac)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/instance_fork_vm_egress_v1.rs (target/debug/deps/instance_fork_vm_egress_v1-a1599e50b645b176)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/live_coalesce_v0.rs (target/debug/deps/live_coalesce_v0-80dd1c2569720280)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 0.00s

     Running tests/live_delta_v0.rs (target/debug/deps/live_delta_v0-07fff8b117f66dc7)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.00s

     Running tests/live_scheduler_v0.rs (target/debug/deps/live_scheduler_v0-5ab2178ee8d41e31)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s

     Running tests/local_v0.rs (target/debug/deps/local_v0-152bb39a627f6b61)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 100 filtered out; finished in 0.00s

     Running tests/membership_authoring_v0.rs (target/debug/deps/membership_authoring_v0-33df27d5547c14d6)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/membership_principal_addressed_v0.rs (target/debug/deps/membership_principal_addressed_v0-f74fc42a1b72151e)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/membership_schema_v0.rs (target/debug/deps/membership_schema_v0-f493f34d1a023da6)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 23 filtered out; finished in 0.00s

     Running tests/migration_cli_presentation_v1.rs (target/debug/deps/migration_cli_presentation_v1-c9a87ff21fa3002f)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/migration_corpus_v0.rs (target/debug/deps/migration_corpus_v0-de4e8a481a8c09e1)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/mutation_settlement_identity_v0.rs (target/debug/deps/mutation_settlement_identity_v0-accba00502975dc5)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.00s

     Running tests/name_keying_guard.rs (target/debug/deps/name_keying_guard-6861364073a5bf58)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/network_profile_v1.rs (target/debug/deps/network_profile_v1-513a3cb65c56e28d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s

     Running tests/offline_replay_v0.rs (target/debug/deps/offline_replay_v0-f45f5090dd4e0abf)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.00s

     Running tests/operational_readiness_v1.rs (target/debug/deps/operational_readiness_v1-2f1cb0fb4c98dfbf)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/protected_query_profile_v1.rs (target/debug/deps/protected_query_profile_v1-e63d1c693799b848)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s

     Running tests/relational_corpus_v0.rs (target/debug/deps/relational_corpus_v0-ebe27b919cfd96bb)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/relational_migration_coupled_suite_v0.rs (target/debug/deps/relational_migration_coupled_suite_v0-84f898692aa5f9fe)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/remediation_registry_v1.rs (target/debug/deps/remediation_registry_v1-a5b2c6730f818da4)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/replication_sustained_v0.rs (target/debug/deps/replication_sustained_v0-ae4730bfe3c62e0d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/result_transform_corpus_v1.rs (target/debug/deps/result_transform_corpus_v1-7e35ad7f1f0db4f5)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/retainability_profile_v1.rs (target/debug/deps/retainability_profile_v1-28842ade31357cdc)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s

     Running tests/route_policy_v1.rs (target/debug/deps/route_policy_v1-e60b597fbcf13111)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 32 filtered out; finished in 0.00s

     Running tests/rqs_bundle_v0.rs (target/debug/deps/rqs_bundle_v0-53115155384cd464)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s

     Running tests/rqs_digest_parity_v0.rs (target/debug/deps/rqs_digest_parity_v0-53a2ca77f0e0bfb3)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.00s

     Running tests/rqs_routes_manifest_v0.rs (target/debug/deps/rqs_routes_manifest_v0-67bd364f527938aa)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s

     Running tests/runtime_qualify_posture_v0.rs (target/debug/deps/runtime_qualify_posture_v0-0d61153088d9dce6)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/sender_proof_cross_language.rs (target/debug/deps/sender_proof_cross_language-4917475a38d362c7)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/served_guide_v1.rs (target/debug/deps/served_guide_v1-15a8aa5a8fb7ffea)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s

     Running tests/server_unknown_route.rs (target/debug/deps/server_unknown_route-3e59f8ee1e7e17a1)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s

     Running tests/shutdown_wal_checkpoint_v0.rs (target/debug/deps/shutdown_wal_checkpoint_v0-74e4f919428f532b)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/structural_validation_v0.rs (target/debug/deps/structural_validation_v0-7c759ca8751547bb)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/telemetry_projection_fixtures_v1.rs (target/debug/deps/telemetry_projection_fixtures_v1-0bd94f750f30ff3d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s

     Running tests/unhandled_rejection_v0.rs (target/debug/deps/unhandled_rejection_v0-6120de58d01db77f)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 30 filtered out; finished in 0.00s

     Running tests/wait_cli_v1.rs (target/debug/deps/wait_cli_v1-04e9db388841cf60)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s

     Running tests/warm_vm_dk4.rs (target/debug/deps/warm_vm_dk4-837ccea1e4246fb7)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s

     Running tests/wire_fixtures_v1.rs (target/debug/deps/wire_fixtures_v1-25c982ae0c876949)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s

     Running tests/workerd_config_v0.rs (target/debug/deps/workerd_config_v0-5076165adfb59a15)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s

     Running tests/workerd_twin_v0.rs (target/debug/deps/workerd_twin_v0-4ca13d465b5f3f91)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 33 filtered out; finished in 0.00s

```

### Four s5_d10 diagnostic classification tests

Command: `cargo test --lib s5_d10_ -- --nocapture`
Exit status: `101`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.78s
     Running unittests src/lib.rs (target/debug/deps/snapback-a1868e2d4d380acd)

running 4 tests
test server::tests::s5_d10_vector_diagnostics_pin_http_and_retry_posture ... ok
test server::tests::s5_d10_all_emitted_diagnostics_have_reviewed_http_status ... ok
test server::tests::s5_d10_stale_artifact_diagnostics_are_bad_requests ... ok

thread 'server::tests::s5_d10_production_diagnostic_inventory_cannot_drift' (33001398) panicked at src/server/tests.rs:22949:5:
production diagnostics and the reviewed HTTP table drifted; unclassified=["SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID", "SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY", "SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED", "SNAPBACK_MEDIA_ASSET_NOT_FINALIZED", "SNAPBACK_MEDIA_KIND_NOT_ADMITTED", "SNAPBACK_MEDIA_PROJECTION_INTEGRITY", "SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE", "SNAPBACK_MEDIA_PROJECTION_TOKEN_EXHAUSTED", "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED", "SNAPBACK_MEDIA_WRITE_FORGED_KIND", "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH", "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION", "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID"]; stale=[]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test server::tests::s5_d10_production_diagnostic_inventory_cannot_drift ... FAILED

failures:

failures:
    server::tests::s5_d10_production_diagnostic_inventory_cannot_drift

test result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured; 2779 filtered out; finished in 3.91s

error: test failed, to rerun pass `--lib`
```

### Inherited s5_d10 failure replay at merge-base

Command: `CARGO_TARGET_DIR=/Users/ccheever/projects/snapback/.claude/worktrees/impl0262-a-server/target cargo test --lib s5_d10_production_diagnostic_inventory_cannot_drift -- --nocapture`
Exit status: `101`

```text
warning: type `SourceGraphRecordV1` is more private than the item `CommittedPublicationAdmissionV1::records`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3380:5
     |
3380 |     pub(crate) records: BTreeMap<SourceId, SourceGraphRecordV1>,
     |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ field `CommittedPublicationAdmissionV1::records` is reachable at visibility `pub(crate)`
     |
note: but type `SourceGraphRecordV1` is only usable at visibility `pub(self)`
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:266:1
     |
 266 | struct SourceGraphRecordV1 {
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^
     = note: `#[warn(private_interfaces)]` on by default

warning: fields `hbc_carrier_count` and `javascript_carrier_count` are never read
    --> vendor/ibex/src/module_loader/runner_pipeline.rs:3386:16
     |
3378 | pub(crate) struct CommittedPublicationAdmissionV1 {
     |                   ------------------------------- fields in this struct
...
3386 |     pub(crate) hbc_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^
3387 |     /// Carriers admitted under `javascript-factory-table`.
3388 |     pub(crate) javascript_carrier_count: usize,
     |                ^^^^^^^^^^^^^^^^^^^^^^^^
     |
     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: associated function `unmappable_link` is never used
   --> vendor/ibex/src/vfs/mod.rs:251:8
    |
124 | impl VfsError {
    | ------------- associated function in this implementation
...
251 |     fn unmappable_link(operation: &str, path: Arc<str>) -> Self {
    |        ^^^^^^^^^^^^^^^

warning: variant `Directory` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2286:5
     |
2284 | enum RetainedFinalAccess {
     |      ------------------- variant in this enum
2285 |     AppendOnly,
2286 |     Directory,
     |     ^^^^^^^^^
     |
     = note: `RetainedFinalAccess` has a derived impl for the trait `Clone`, but this is intentionally ignored during dead code analysis

warning: variant `MalformedBytes` is never constructed
    --> vendor/ibex/src/vfs/mod.rs:2775:5
     |
2773 | pub(crate) enum AuthenticatedDirectoryEntry {
     |                 --------------------------- variant in this enum
2774 |     Utf8(String),
2775 |     MalformedBytes(Vec<u8>),
     |     ^^^^^^^^^^^^^^
     |
     = note: `AuthenticatedDirectoryEntry` has a derived impl for the trait `Debug`, but this is intentionally ignored during dead code analysis

warning: method `commit_directory_no_follow` is never used
    --> vendor/ibex/src/vfs/mod.rs:4310:8
     |
2879 | impl VirtualFileSystem {
     | ---------------------- method in this implementation
...
4310 |     fn commit_directory_no_follow(
     |        ^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: `ibex-runtime` (lib) generated 6 warnings
   Compiling snapback v0.1.0 (/private/tmp/snapback-0262-baseline.3MSUeC)
warning: linker stderr: ld: __eh_frame section too large (max 16MB) to encode dwarf unwind offsets in compact unwind table, performance of exception handling might be affected
  |
  = note: `#[warn(linker_messages)]` on by default

warning: `snapback` (lib test) generated 1 warning
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2m 16s
     Running unittests src/lib.rs (/Users/ccheever/projects/snapback/.claude/worktrees/impl0262-a-server/target/debug/deps/snapback-a1868e2d4d380acd)

running 1 test

thread 'server::tests::s5_d10_production_diagnostic_inventory_cannot_drift' (32569779) panicked at src/server/tests.rs:22787:5:
production diagnostics and the reviewed HTTP table drifted; unclassified=["SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID", "SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY", "SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED", "SNAPBACK_MEDIA_ASSET_NOT_FINALIZED", "SNAPBACK_MEDIA_KIND_NOT_ADMITTED", "SNAPBACK_MEDIA_PROJECTION_INTEGRITY", "SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE", "SNAPBACK_MEDIA_PROJECTION_TOKEN_EXHAUSTED", "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED", "SNAPBACK_MEDIA_WRITE_FORGED_KIND", "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH", "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION", "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY", "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID"]; stale=[]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test server::tests::s5_d10_production_diagnostic_inventory_cannot_drift ... FAILED

failures:

failures:
    server::tests::s5_d10_production_diagnostic_inventory_cannot_drift

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 2772 filtered out; finished in 4.10s

error: test failed, to rerun pass `--lib`
```

### LLP reference validation

Command: `./ref-check --verbose`
Exit status: `0`

```text
ref-check: ok — 267 LLP docs, 5556 refs in 10300 files, 0 errors, 0 unchecked
```

### Whitespace/error-marker validation

Command: `git diff --check`
Exit status: `0`

```text
```
