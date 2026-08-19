use libc::{c_char, c_int, size_t};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use snapback_types::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use std::env;
use std::ffi::CString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr;
use std::sync::{Arc, Mutex as StdMutex, OnceLock, PoisonError};
use std::time::Instant;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub canonical_engine: String,
    pub ibex_submodule: IbexSubmoduleCapability,
    pub ibex_cli: IbexCliCapability,
    pub host_plan_runtime: bool,
    pub ibex_ctx_db_host_bridge: CapabilityState,
    pub async_handler_completion: CapabilityState,
    pub sqlite_lock_held_across_async: CapabilityState,
    /// `function.explain` kind `mutationDryRun` is served for queries'
    /// sibling tier pair — HostPlan (IR) and IbexModule mutations
    /// (LLP 0051 D8 / Increment 4). The per-function `dryRunSupported`
    /// catalog bit (LLP 0024 §Catalog) rides LLP 0042's generated catalog;
    /// until that lands this capability is the honest wire marker.
    pub mutation_dry_run: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexSubmoduleCapability {
    pub present: bool,
    pub path: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexCliCapability {
    pub available: bool,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CapabilityState {
    Available,
    Unavailable,
    NotYetWired,
}

#[derive(Clone, Debug)]
pub struct RuntimeManager {
    capabilities: RuntimeCapabilities,
}

impl RuntimeManager {
    pub fn detect() -> Self {
        // @ref LLP 0002#decision — local dev reports Ibex as the canonical engine.
        // @ref LLP 0009#runtime-boundary — Ibex availability is a runtime capability, not an implicit fallback.
        Self {
            capabilities: RuntimeCapabilities {
                canonical_engine: "ibex".to_owned(),
                ibex_submodule: detect_ibex_submodule(),
                ibex_cli: detect_ibex_cli(),
                host_plan_runtime: true,
                ibex_ctx_db_host_bridge: CapabilityState::Available,
                async_handler_completion: CapabilityState::Available,
                sqlite_lock_held_across_async: CapabilityState::Unavailable,
                mutation_dry_run: true,
            },
        }
    }

    pub fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }

    /// Diagnostics observed while detecting the runtime itself. Capability
    /// availability is projected separately by [`Self::capabilities`].
    ///
    /// @ref LLP 0010#capability-reports — passive capability gaps are facts;
    /// diagnostics begin when an operation actually requests missing power.
    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        Vec::new()
    }

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn force_ibex_cli_unavailable_for_test(&mut self) {
        self.capabilities.ibex_cli = IbexCliCapability {
            available: false,
            path: None,
            version: None,
        };
    }
}

// `SNAPBACK_IBEX_CLI_UNAVAILABLE` is retired as a produced diagnostic: external
// Ibex CLI absence is now reported only as a runtime capability fact, and no
// currently supported operation requires that executable. The code itself stays
// reserved for historical records in the two projections that actually carry the
// stable vocabulary — `guide/reference/diagnostics-registry.json` and the client
// `diagnostic-codes.d.mts` union — so it is deliberately not re-declared here.

#[repr(C)]
#[doc(hidden)]
pub struct HermesRuntimeOpaque {
    _private: [u8; 0],
}

#[derive(Clone, Copy)]
#[repr(C)]
pub struct HermesValueHandle {
    pub runtime_nonce: u64,
    pub handle_id: u64,
}

#[repr(C)]
pub struct HermesOwnedBytes {
    pub data: *mut u8,
    pub length: usize,
}

#[repr(C)]
pub struct HermesAsyncFailureEvent {
    pub abi_version: u32,
    pub struct_size: u32,
    kind: u32,
    principal_status: u32,
    pub value: HermesValueHandle,
    host_context_id: u64,
    owning_principal_id: u64,
    event_id: u64,
    associated_evaluation: u64,
    pub dropped_count: u64,
}

impl HermesAsyncFailureEvent {
    pub fn current() -> Self {
        Self {
            abi_version: 1,
            struct_size: std::mem::size_of::<Self>() as u32,
            kind: 0,
            principal_status: 0,
            value: HermesValueHandle {
                runtime_nonce: 0,
                handle_id: 0,
            },
            host_context_id: 0,
            owning_principal_id: 0,
            event_id: 0,
            associated_evaluation: 0,
            dropped_count: 0,
        }
    }
}

unsafe extern "C" {
    fn ex_hermes_create_no_eval() -> *mut HermesRuntimeOpaque;
    fn ex_hermes_destroy(runtime: *mut HermesRuntimeOpaque);
    fn ex_hermes_runtime_nonce(runtime: *mut HermesRuntimeOpaque) -> u64;
    fn ex_hermes_eval(
        runtime: *mut HermesRuntimeOpaque,
        data: *const u8,
        len: size_t,
        source_url: *const c_char,
        is_bytecode: c_int,
        out_value: *mut *mut c_char,
    ) -> c_int;
    fn ex_hermes_watch_time_limit(runtime: *mut HermesRuntimeOpaque, timeout_ms: u32) -> c_int;
    fn ex_hermes_unwatch_time_limit(runtime: *mut HermesRuntimeOpaque);
    fn ex_hermes_interrupt_eval(runtime: *mut HermesRuntimeOpaque, runtime_nonce: u64) -> c_int;
    pub fn ex_hermes_take_async_failure_event(
        runtime: *mut HermesRuntimeOpaque,
        event: *mut HermesAsyncFailureEvent,
    ) -> u32;
    pub fn ex_hermes_value_kind(
        runtime: *mut HermesRuntimeOpaque,
        handle: HermesValueHandle,
    ) -> u32;
    pub fn ex_hermes_value_stage1_text(
        runtime: *mut HermesRuntimeOpaque,
        handle: HermesValueHandle,
        out_data: *mut *mut u8,
        out_length: *mut usize,
        out_truncated: *mut u32,
    ) -> u32;
    pub fn ex_hermes_value_safe_throw_metadata(
        runtime: *mut HermesRuntimeOpaque,
        handle: HermesValueHandle,
        metadata_fields: *mut u32,
        error_class: *mut u32,
        message: *mut HermesOwnedBytes,
        stack: *mut HermesOwnedBytes,
    ) -> u32;
    pub fn ex_hermes_value_release(
        runtime: *mut HermesRuntimeOpaque,
        handle: HermesValueHandle,
    ) -> u32;
    pub fn ex_hermes_free_string(value: *mut c_char);
    fn ex_hermes_set_host_call(runtime: *mut HermesRuntimeOpaque, callback: HermesHostCall);
}

/// The one host-call callback installed into a Hermes runtime.
///
/// The callback supplies host behavior; it does not carry admission or commit
/// authority. The higher engine retains those capabilities in its private
/// invocation context.
pub type HermesHostCall = extern "C" fn(*const c_char, *const c_char) -> *mut c_char;

extern "C" fn unavailable_host_call(_op: *const c_char, _args_json: *const c_char) -> *mut c_char {
    ptr::null_mut()
}

#[doc(hidden)]
pub struct RuntimeGuard {
    runtime: *mut HermesRuntimeOpaque,
    interrupt: Arc<RuntimeInterrupt>,
    /// The strict capability context this VM claimed at construction. Retained
    /// so posture regressions can prove the claim actually happened; the
    /// accessor below is exercised only by those tests, so a non-test build
    /// sees the field as unread.
    #[cfg_attr(not(test), allow(dead_code))]
    host_context_id: u64,
}

struct RuntimeInterrupt {
    runtime: StdMutex<Option<(usize, u64)>>,
}

impl RuntimeInterrupt {
    fn signal(&self) {
        let runtime = self.runtime.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((runtime, runtime_nonce)) = *runtime {
            // Hermes documents watchTimeLimit as owner-thread-only. Cancellation
            // can arrive from another thread, so carry the generation captured
            // while this runtime was live and use Ibex's authenticated
            // any-thread async-break seam.
            // @ref LLP 0009#resource-limits
            unsafe {
                ex_hermes_interrupt_eval(runtime as *mut HermesRuntimeOpaque, runtime_nonce);
            }
        }
    }
}

/// The process-global Ibex host is a fixed capability *policy* (strict, plus a
/// coarse `network:fetch` grant when outbound actions are enabled), not
/// per-invocation state. Building it on every invocation was pure overhead —
/// and, per M1, per-invocation VM cost dominates the whole system. Build it
/// exactly once per process; clones share the same `Arc` capability manager,
/// so every armed context carries the identical policy. The per-invocation
/// *context* (reads/writes) stays thread-local and separate.
///
/// @ref LLP 0009#invocation-isolation — DK-4 cheapest safe step: cache what
/// carries no per-invocation user state.
/// @ref LLP 0032#phase-4--measurement — M2.
fn strict_host() -> &'static ibex_runtime::host::Host {
    static HOST: std::sync::OnceLock<ibex_runtime::host::Host> = std::sync::OnceLock::new();
    HOST.get_or_init(|| {
        // @ref LLP 0009#capability-model — static checks are defense-in-depth;
        // the runtime host itself must deny ambient powers. The coarse
        // network:fetch gate is opened only when outbound actions are enabled;
        // the JS ambient layer still restricts fetch to the action class.
        let host = ibex_runtime::host::Host::strict();
        if outbound_actions_enabled() {
            host.capabilities().grant("*", "network:fetch", None);
        }
        host
    })
}

/// Arm the strict Host for *this thread's next* Hermes construction and return
/// the armed context id.
///
/// `install_host` publishes the Host globally but the strict capability context
/// it arms is a single-use, thread-bound token that `ex_hermes_create_no_eval`
/// claims and zeroes. Installing once per process therefore handed the only
/// Enforce-mode context to the first VM on the installing thread; every later
/// VM — and every VM on every other thread — found no pending token and fell
/// back to a fresh `SecurityMode::Audit` context, where a denied capability is
/// logged but proceeds. Re-arming per construction gives each VM its own
/// Enforce-mode context. Claimed contexts are released when their runtime is
/// destroyed, exactly as the first VM's always was.
///
/// @ref LLP 0009#capability-model — the Ibex capability gate is honest
/// defense-in-depth only when every VM actually holds it.
fn arm_strict_host_context() -> u64 {
    ibex_runtime::host::abi::install_host(strict_host().clone())
}

impl RuntimeGuard {
    /// Construct one restricted handler VM with the higher engine's host-call
    /// implementation. The callback is behavior, not an authority assertion:
    /// admitted invocation state remains private to the engine adapter.
    pub fn create(host_call: HermesHostCall) -> SnapbackResult<Self> {
        let host_context_id = arm_strict_host_context();
        // @ref LLP 0009#supply-chain-and-generated-bundles — application code
        // is exactly the selected manifest bundle; fetched or constructed
        // strings must not become additional code with the handler's ambient
        // ctx/secrets authority.
        let runtime = unsafe { ex_hermes_create_no_eval() };
        if runtime.is_null() {
            return Err(SnapbackError::error(
                "SNAPBACK_RUNTIME_CREATE_FAILED",
                "runtime",
                "Ibex runtime could not be created",
            ));
        }
        let runtime_nonce = unsafe { ex_hermes_runtime_nonce(runtime) };
        if runtime_nonce == 0 {
            unsafe { ex_hermes_destroy(runtime) };
            return Err(SnapbackError::error(
                "SNAPBACK_RUNTIME_CREATE_FAILED",
                "runtime",
                "Ibex runtime identity could not be captured",
            ));
        }
        unsafe { ex_hermes_set_host_call(runtime, host_call) };
        Ok(Self {
            runtime,
            interrupt: Arc::new(RuntimeInterrupt {
                runtime: StdMutex::new(Some((runtime as usize, runtime_nonce))),
            }),
            host_context_id,
        })
    }

    /// The armed strict context id this VM claimed, for posture regressions.
    #[cfg(test)]
    pub(crate) fn host_context_id(&self) -> u64 {
        self.host_context_id
    }

    pub fn ptr(&self) -> *mut HermesRuntimeOpaque {
        self.runtime
    }

    pub fn watch_until(&self, deadline: Instant) -> SnapbackResult<RuntimeTimeLimit<'_>> {
        let timeout_ms = remaining_deadline_ms(deadline)?;
        let status = unsafe { ex_hermes_watch_time_limit(self.runtime, timeout_ms) };
        if status != 0 {
            return Err(SnapbackError::error(
                "SNAPBACK_ACTION_TIMEOUT_SETUP_FAILED",
                "runtime",
                "Ibex could not arm the action execution time limit",
            ));
        }
        Ok(RuntimeTimeLimit { runtime: self })
    }

    /// Return a callback that can interrupt only this runtime generation.
    /// The opaque closure preserves the pointer-plus-nonce fence.
    pub fn cancellation_hook(&self) -> impl Fn() + Send + Sync + 'static {
        let interrupt = self.interrupt.clone();
        move || interrupt.signal()
    }
}

#[doc(hidden)]
pub struct RuntimeTimeLimit<'a> {
    runtime: &'a RuntimeGuard,
}

impl Drop for RuntimeTimeLimit<'_> {
    fn drop(&mut self) {
        unsafe { ex_hermes_unwatch_time_limit(self.runtime.runtime) };
    }
}

impl Drop for RuntimeGuard {
    fn drop(&mut self) {
        let runtime = self
            .interrupt
            .runtime
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some((runtime, _runtime_nonce)) = runtime {
            unsafe { ex_hermes_destroy(runtime as *mut HermesRuntimeOpaque) };
        }
    }
}

/// Bootstrap-facing readiness probe: prove the restricted no-eval handler VM —
/// the exact constructor `RuntimeGuard::create` uses per invocation, including
/// the Hermes promise-rejection checkpoint prerequisite — can be created and
/// destroyed in this process. Two cycles so a destroy-path defect cannot pass
/// as ready. Dyld symbol resolution and a bare process launch cannot detect a
/// Hermes framework whose runtime behavior contract mismatches the linked
/// glue; this is the smallest probe that can.
pub fn qualify_handler_vm() -> SnapbackResult<()> {
    for _ in 0..2 {
        RuntimeGuard::create(unavailable_host_call).map(drop)?;
    }
    Ok(())
}

/// Mean microseconds to create + destroy a runtime (`ex_hermes_create` +
/// host-call wiring + drop), with the host install already cached. Lets the M1
/// harness attribute the per-invocation VM cost to *creation* (which a warm VM
/// would avoid) versus *eval* (the handler run itself).
///
/// @ref LLP 0032#phase-4--measurement — M2 VM-cost decomposition.
pub fn bench_runtime_create_us(iterations: usize) -> f64 {
    for _ in 0..4 {
        let _ = RuntimeGuard::create(unavailable_host_call);
    }
    let start = Instant::now();
    for _ in 0..iterations {
        let _guard = RuntimeGuard::create(unavailable_host_call);
    }
    start.elapsed().as_micros() as f64 / iterations.max(1) as f64
}

/// Process-monotonic invocation epoch. Every invocation (fresh or warm) gets
/// a unique one; it is baked into that invocation's JS `ctx` closures and
/// carried on every host call so a continuation from a *prior* invocation —
/// firing during a *later* one on the same warm VM — is rejected instead of
/// silently routed to the current invocation's context (cross-user write
/// injection). See [`snapback_host_call`].
///
/// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — stale-continuation guard.
static NEXT_INVOCATION_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn invocation_epoch_exhausted() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_INVOCATION_EPOCH_EXHAUSTED",
        "runtime",
        "handler invocation identities are exhausted; restart the process before running more handlers",
    )
}

/// Allocate a never-reused non-zero invocation identity. Zero is the terminal
/// sentinel: the final `u64::MAX` identity is returned once while atomically
/// moving the allocator to zero, and every later invocation is refused before
/// application code can run.
fn allocate_invocation_epoch(next: &std::sync::atomic::AtomicU64) -> SnapbackResult<u64> {
    use std::sync::atomic::Ordering as AtomicOrdering;

    let mut current = next.load(AtomicOrdering::Relaxed);
    loop {
        if current == 0 {
            return Err(invocation_epoch_exhausted());
        }
        let successor = current.checked_add(1).unwrap_or(0);
        match next.compare_exchange_weak(
            current,
            successor,
            AtomicOrdering::Relaxed,
            AtomicOrdering::Relaxed,
        ) {
            Ok(_) => return Ok(current),
            Err(observed) => current = observed,
        }
    }
}

pub fn next_invocation_epoch() -> SnapbackResult<u64> {
    allocate_invocation_epoch(&NEXT_INVOCATION_EPOCH)
}

pub fn media_process_epoch() -> &'static str {
    static EPOCH: OnceLock<String> = OnceLock::new();
    EPOCH.get_or_init(|| uuid::Uuid::now_v7().to_string())
}

/// Every handler VM must hold its own Enforce-mode Ibex capability context.
///
/// The armed context is a single-use, thread-bound token: a VM that claims it
/// is recorded `claimed`, and a VM that finds none silently constructs a fresh
/// `SecurityMode::Audit` context instead — the rollout mode where a denied
/// capability is logged but proceeds. `ex_host_enter_context` answers exactly
/// the question that distinguishes the two: it refuses (`u64::MAX`) for any id
/// that is absent or unclaimed, so a VM whose armed context enters successfully
/// provably claimed the strict token rather than falling back.
///
/// @ref LLP 0009#capability-model
#[cfg(test)]
mod strict_host_context_tests {
    use super::{RuntimeGuard, unavailable_host_call};

    fn claimed(context_id: u64) -> bool {
        assert_ne!(context_id, 0, "creation must arm a strict context");
        let previous = ibex_runtime::host::abi::ex_host_enter_context(context_id);
        if previous == u64::MAX {
            return false;
        }
        ibex_runtime::host::abi::ex_host_restore_context(previous);
        true
    }

    #[test]
    fn every_vm_claims_its_own_strict_context() {
        let first = RuntimeGuard::create(unavailable_host_call).expect("first VM");
        let second = RuntimeGuard::create(unavailable_host_call).expect("second VM");

        assert_ne!(
            first.host_context_id(),
            second.host_context_id(),
            "each creation arms a distinct context"
        );
        assert!(claimed(first.host_context_id()), "first VM claimed strict");
        assert!(
            claimed(second.host_context_id()),
            "second VM fell back to an Audit context instead of claiming strict"
        );

        // A thread that never ran the process's first creation used to have no
        // armed token at all, so its VMs were Audit-fallback from the start.
        let across_threads = std::thread::spawn(|| {
            let guard = RuntimeGuard::create(unavailable_host_call).expect("VM on a fresh thread");
            claimed(guard.host_context_id())
        })
        .join()
        .expect("thread joined");
        assert!(
            across_threads,
            "a VM created on another thread must claim its own strict context"
        );
    }
}

#[cfg(test)]
mod invocation_epoch_tests {
    use super::allocate_invocation_epoch;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn final_invocation_identity_is_unique_then_allocator_is_terminal() {
        let next = AtomicU64::new(u64::MAX - 1);

        assert_eq!(
            allocate_invocation_epoch(&next).expect("penultimate identity"),
            u64::MAX - 1
        );
        assert_eq!(
            allocate_invocation_epoch(&next).expect("final identity"),
            u64::MAX
        );
        let error = allocate_invocation_epoch(&next)
            .expect_err("an exhausted identity allocator must never wrap");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_INVOCATION_EPOCH_EXHAUSTED"
        );
        assert_eq!(next.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn terminal_invocation_allocator_stays_terminal() {
        let next = AtomicU64::new(0);
        for _ in 0..2 {
            let error = allocate_invocation_epoch(&next)
                .expect_err("zero is a permanent terminal sentinel");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_HANDLER_INVOCATION_EPOCH_EXHAUSTED"
            );
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IbexInvocationMode {
    Query,
    Mutation,
    Action,
}

pub fn remaining_deadline_ms(deadline: Instant) -> SnapbackResult<u32> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ACTION_TIMEOUT",
                "runtime",
                "action execution deadline elapsed before the handler could run",
            )
        })?;
    let rounded_up_ms = remaining
        .as_millis()
        .saturating_add(u128::from(remaining.subsec_nanos() % 1_000_000 != 0));
    Ok(rounded_up_ms.clamp(1, u128::from(u32::MAX)) as u32)
}

pub const IBEX_EVAL_OUTPUT_MAX_BYTES: usize = 8 * 1024 * 1024;

fn take_ibex_eval_output(out: *mut c_char) -> SnapbackResult<String> {
    if out.is_null() {
        return Ok(String::new());
    }
    let length = unsafe { libc::strnlen(out, IBEX_EVAL_OUTPUT_MAX_BYTES + 1) };
    if length > IBEX_EVAL_OUTPUT_MAX_BYTES {
        unsafe { ex_hermes_free_string(out) };
        return Err(SnapbackError::error(
            "SNAPBACK_HANDLER_EVAL_OUTPUT_TOO_LARGE",
            "runtime",
            "JavaScript handler evaluation output exceeded the bounded carrier",
        )
        .with_details(json!({
            "maximumBytes": IBEX_EVAL_OUTPUT_MAX_BYTES,
            "observedAtLeastBytes": IBEX_EVAL_OUTPUT_MAX_BYTES + 1,
        })));
    }
    let copied = unsafe { std::slice::from_raw_parts(out.cast::<u8>(), length) };
    let output = std::str::from_utf8(copied).map(str::to_owned).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_HANDLER_FAILED",
            "runtime",
            "JavaScript handler evaluation returned invalid UTF-8",
        )
    });
    unsafe { ex_hermes_free_string(out) };
    output
}

pub fn eval(
    runtime: *mut HermesRuntimeOpaque,
    source_url: &str,
    source: &str,
) -> SnapbackResult<String> {
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7: a Hermes
    // eval is synchronous FFI for the whole handler run and must never occupy
    // a tokio async worker.
    snapback_types::exec_guard::debug_assert_off_async_worker("ex_hermes_eval");
    let source_url =
        CString::new(source_url).unwrap_or_else(|_| CString::new("handler.js").unwrap());
    let mut out: *mut c_char = ptr::null_mut();
    let status = unsafe {
        ex_hermes_eval(
            runtime,
            source.as_ptr(),
            source.len(),
            source_url.as_ptr(),
            0,
            &mut out,
        )
    };
    let output = take_ibex_eval_output(out)?;
    if status == 0 {
        return Ok(output);
    }

    let code = if output.contains("Javascript execution has timed out")
        || output.contains("SNAPBACK_ACTION_TIMEOUT")
    {
        "SNAPBACK_ACTION_TIMEOUT"
    } else if output.contains("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED") {
        "SNAPBACK_HANDLER_CAPABILITY_DENIED"
    } else if output.contains("SNAPBACK_HANDLER_EXPORT_MISSING") {
        "SNAPBACK_HANDLER_EXPORT_MISSING"
    } else if output.contains("SNAPBACK_HANDLER_STALE_CONTINUATION") {
        // A stale continuation's host call threw and propagated to the
        // handler top level (the synchronous-fire case). Surface it distinctly
        // so it is diagnosable rather than a generic failure.
        "SNAPBACK_HANDLER_STALE_CONTINUATION"
    } else if output.contains("SNAPBACK_CONFIG_UNDECLARED") {
        // @ref LLP 0036#declared-configuration-in-the-manifest — D8: access
        // outside the `uses` grant is its own diagnostic, distinct from a
        // declared-but-unset entry.
        "SNAPBACK_CONFIG_UNDECLARED"
    } else if output.contains("SNAPBACK_CONFIG_MISSING") {
        "SNAPBACK_CONFIG_MISSING"
    } else if output.contains("SNAPBACK_HANDLER_RESULT_INVALID") {
        // The invoke IIFE throws this for non-JSON-serializable returns
        // (function/symbol), which only JS can still distinguish from a
        // pending promise (ENG-23430).
        "SNAPBACK_HANDLER_RESULT_INVALID"
    } else {
        "SNAPBACK_HANDLER_FAILED"
    };
    Err(
        SnapbackError::error(code, "runtime", "JavaScript handler failed").with_details(json!({
            "message": first_line(&output),
        })),
    )
}

/// The additive half of the Workers-dialect allowlist (LLP 0048
/// §Handler-visible API surface): single-sourced with the workerd leg, where
/// the same file evaluates as a side-effect module. It runs before the module
/// source so top-level handler code observes the same surface on both
/// engines.
pub fn allowlist_install_source() -> &'static str {
    include_str!("../../../packages/snapback-harness/allowlist-install.js")
}

/// The per-invocation tail of the eval source: the async IIFE that passes one
/// serialized payload to the captured-intrinsic `__snapbackDispatch` helper.
/// The live Ibex path appends it to ambient + allowlist + bootstrap + module
/// and evaluates that full source afresh for every invocation. Warm reuse is
/// disabled; no live path currently evaluates this tail by itself.
pub const INVOCATION_IIFE_PAYLOAD_SLOT: &str = "\"\n__SNAPBACK_INVOCATION_JSON__\n\"";

/// Outbound action egress is opt-in and off by default. When enabled, an ACTION
/// (only) keeps `fetch` + timers and is granted `network:fetch`; queries and
/// mutations stay fully denied. This is the [LLP 0027#external-data-and-action-egress]
/// seam — sandbox-policy territory owned by [LLP 0009], so the default posture is
/// unchanged (everything denied, strict).
pub fn outbound_actions_enabled() -> bool {
    matches!(
        std::env::var("SNAPBACK_OUTBOUND_ACTIONS").ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE")
    )
}

// @ref LLP 0027#external-data-and-action-egress — un-deny fetch for the action
//   execution class only; the transactional query/mutation path never gets network.
// @ref LLP 0009#capability-model — the JS ambient layer gates ambient powers by
//   handler kind; the coarse Ibex network:fetch grant is opened only for egress.
/// Ambient names an egress-enabled ACTION still denies (ENG-23581). Egress
/// actions keep the wide compute-plus-fetch surface they always had (the
/// all-aboard 511.org poller uses fetch/URL/Headers/AbortController/crypto):
/// the LLP 0048 data-driven denial applies only to queries and mutations,
/// while egress actions restore the pre-0048 posture — deny exactly the
/// process/require introspection pair, WebSocket, dynamic evaluation, and
/// WebAssembly. Egress changes which services an action may call; it does not
/// let fetched bytes become code outside the authenticated bundle identity.
/// In particular, `fetch`
/// must never be pre-shadowed here: Ibex installs it lazily as a
/// *configurable* property, and a non-configurable deny stub in its slot
/// makes the installer itself throw.
const EGRESS_DENIED_AMBIENT: [&str; 5] = ["process", "require", "WebSocket", "eval", "WebAssembly"];

/// Banned names shadowed as plain `undefined` rather than a denier function:
/// host/introspection objects where "absent" is the truthful surface (and the
/// historical behavior for `process`/`require`).
const UNDEFINED_SHADOWED_AMBIENT: [&str; 3] = ["process", "require", "HermesInternal"];

/// The Ibex leg's ambient denial list is generated from the same
/// `allowlist.json` data the V8 strip consumes (LLP 0048 §Handler-visible API
/// surface): banned-everywhere globals are denied here, so surface parity is
/// data-driven rather than two hand-maintained lists.
fn banned_ambient_globals() -> &'static Vec<String> {
    static BANNED: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    BANNED.get_or_init(|| {
        let allowlist: Value = serde_json::from_str(include_str!(
            "../../../packages/snapback-harness/allowlist.json"
        ))
        .expect("packages/snapback-harness/allowlist.json parses");
        allowlist
            .get("bannedEverywhere")
            .and_then(|banned| banned.get("globals"))
            .and_then(Value::as_array)
            .map(|names| {
                names
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .expect("allowlist bannedEverywhere.globals is a string array")
    })
}

/// The deterministic-member denial list, single-sourced from the same
/// allowlist `members` list the V8 strip consumes (LLP 0051 D1 / Increment 2:
/// the Ibex deterministic-member gap is closed at runtime for the
/// deterministic tier, not just by the LLP 0009 codegen ban).
fn banned_ambient_members() -> &'static Vec<String> {
    static BANNED: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    BANNED.get_or_init(|| {
        let allowlist: Value = serde_json::from_str(include_str!(
            "../../../packages/snapback-harness/allowlist.json"
        ))
        .expect("packages/snapback-harness/allowlist.json parses");
        allowlist
            .get("bannedEverywhere")
            .and_then(|banned| banned.get("members"))
            .and_then(Value::as_array)
            .map(|names| {
                names
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .expect("allowlist bannedEverywhere.members is a string array")
    })
}

/// The zero-arg `Date`-constructor denial (ENG-23588), `workerd/strip.mjs`'s
/// shape ported to the Ibex leg: zero-arg `new Date()` and `Date()` as a
/// function read the ambient wall clock and are denied; explicit-timestamp
/// construction and the static parsers are pure functions of their arguments
/// and stay. This is a constructor wrapper, not a `members` entry — a
/// members-only port would silently miss it.
const DATE_CONSTRUCTOR_DENY_SOURCE: &str = r#"  var NativeDate = g.Date;
  try {
    var WrappedDate = function Date() {
      if (!new.target) {
        throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", "Date()");
      }
      if (arguments.length === 0) {
        throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", "new Date()");
      }
      return Reflect.construct(NativeDate, arguments, new.target);
    };
    WrappedDate.prototype = NativeDate.prototype;
    WrappedDate.parse = NativeDate.parse;
    WrappedDate.UTC = NativeDate.UTC;
    WrappedDate.now = deny("Date.now");
    Object.defineProperty(NativeDate.prototype, "constructor", { value: WrappedDate });
    Object.defineProperty(g, "Date", { value: WrappedDate, configurable: false, writable: false });
  } catch (_) {}
"#;

pub fn ambient_restriction_source(mode: IbexInvocationMode, outbound_enabled: bool) -> String {
    let egress = outbound_enabled && matches!(mode, IbexInvocationMode::Action);
    let mut denials = String::new();
    // Names installed as callable deny stubs, collected for the post-install
    // probe below (ENG-23590): every one of them must be unreachable after
    // this source evaluates, or the invocation fails instead of running with
    // a survivor.
    let mut probed: Vec<&str> = Vec::new();
    let denied: Vec<&str> = if egress {
        EGRESS_DENIED_AMBIENT.to_vec()
    } else {
        banned_ambient_globals()
            .iter()
            .map(String::as_str)
            .collect()
    };
    for name in denied {
        if UNDEFINED_SHADOWED_AMBIENT.contains(&name) {
            // Some engine-provided globals (HermesInternal) are
            // non-configurable, so defineProperty throws; fall through
            // delete -> defineProperty -> plain assignment until one sticks.
            denials.push_str(&format!(
                "  try {{ delete g[\"{name}\"]; }} catch (_) {{}}\n  if (g[\"{name}\"] !== undefined) {{ try {{ Object.defineProperty(g, \"{name}\", {{ value: undefined, configurable: false, writable: false }}); }} catch (_) {{}} }}\n  if (g[\"{name}\"] !== undefined) {{ try {{ g[\"{name}\"] = undefined; }} catch (_) {{}} }}\n"
            ));
            // HermesInternal is non-configurable AND non-writable on the
            // vendored engine — a declared engine fact pinned by
            // tests/workerd_twin_v0.rs — so it is the one shadow the probe
            // must tolerate surviving.
            if name != "HermesInternal" {
                probed.push(name);
            }
        } else {
            denials.push_str(&format!(
                "  try {{ Object.defineProperty(g, \"{name}\", {{ value: deny(\"{name}\"), configurable: false, writable: false }}); }} catch (_) {{}}\n"
            ));
            // Current Ibex seals the engine-provided eval global before the
            // restricted consumer constructor returns, so Snapback cannot
            // always replace that property with its own denier. The fixed
            // dynamic-code corpus below executes valid source through both
            // direct and indirect eval instead; either survivor fails closed.
            if name != "eval" {
                probed.push(name);
            }
        }
    }
    // The deterministic tier (queries/mutations) additionally denies the
    // allowlist's `members` list at runtime — the same list the V8 strip
    // consumes — plus the zero-arg `Date`-constructor rule, which is a
    // constructor wrapper, not a `members` entry (LLP 0051 D1 / Increment 2,
    // ENG-23588). Actions keep today's surface: they are the
    // ambient-powered, non-deterministic class, and the wall-clock watchdog
    // busy-waits are action behavior by design.
    let deterministic_tier = !matches!(mode, IbexInvocationMode::Action);
    let mut member_denials = String::new();
    let mut member_probe = String::new();
    if deterministic_tier {
        for member in banned_ambient_members() {
            let Some((holder, prop)) = member.split_once('.') else {
                continue;
            };
            member_denials.push_str(&format!(
                "  try {{ Object.defineProperty(g[\"{holder}\"], \"{prop}\", {{ value: deny(\"{member}\"), configurable: false, writable: false }}); }} catch (_) {{}}\n"
            ));
        }
        member_denials.push_str(DATE_CONSTRUCTOR_DENY_SOURCE);
        let member_list = banned_ambient_members()
            .iter()
            .map(|member| format!("\"{member}\""))
            .collect::<Vec<_>>()
            .join(", ");
        member_probe = format!(
            "  [{member_list}].forEach(function(member) {{\n    var parts = member.split(\".\");\n    var target = g[parts[0]];\n    var value = target ? target[parts[1]] : undefined;\n    if (typeof value !== \"function\") {{ __snapbackDenySurvivors.push(member); return; }}\n    try {{ value.call(target); __snapbackDenySurvivors.push(member); }} catch (error) {{\n      if (String((error && error.message) || \"\").indexOf(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\") !== 0) {{ __snapbackDenySurvivors.push(member); }}\n    }}\n  }});\n  try {{ new g.Date(); __snapbackDenySurvivors.push(\"new Date()\"); }} catch (error) {{\n    if (String((error && error.message) || \"\").indexOf(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\") !== 0) {{ __snapbackDenySurvivors.push(\"new Date()\"); }}\n  }}\n  try {{ if (new g.Date(0).getTime() !== 0) {{ __snapbackDenySurvivors.push(\"new Date(ms) broke\"); }} }} catch (_) {{ __snapbackDenySurvivors.push(\"new Date(ms) broke\"); }}\n"
        );
    }
    // Symmetric to the V8 strip's init self-check (ENG-23590): the denial
    // loop above swallows defineProperty failures, so verify every denied
    // name actually became unreachable and fail the eval — and with it the
    // invocation — on any survivor.
    let probe_list = probed
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(", ");
    // Hermes RuntimeConfig is the real dynamic-code boundary. Probe every
    // constructor route before application source evaluates so a stale engine
    // artifact, including the historical `Function("return this")` fast path,
    // fails invocation setup rather than exposing a compiler to the handler.
    let dynamic_code_probe = r#"  [
    ["direct eval", function() { return eval("1"); }],
    ["indirect eval", function() { return (0, eval)("1"); }],
    ["Function", function() { return g.Function("return 1"); }],
    ["Function(return this)", function() { return g.Function("return this"); }],
    ["Function(return this whitespace)", function() { return g.Function("  return this;  "); }],
    ["Object.constructor.constructor", function() { return g.Object.prototype.constructor.constructor("return this"); }],
    ["Reflect.apply(Function)", function() { return g.Reflect.apply(g.Function, undefined, ["return this"]); }],
    ["Reflect.construct(Function)", function() { return g.Reflect.construct(g.Function, ["return this"]); }],
    ["AsyncFunction", function() { return (async function() {}).constructor("return 1"); }],
    ["GeneratorFunction", function() { return (function*() {}).constructor("return 1"); }]
  ].forEach(function(entry) {
    try { entry[1](); __snapbackDenySurvivors.push(entry[0]); } catch (_) {}
  });
"#;
    let probe = format!(
        "  var __snapbackDenySurvivors = [];\n  [{probe_list}].forEach(function(name) {{\n    var value;\n    try {{ value = g[name]; }} catch (_) {{ return; }}\n    if (value === undefined || value === null) {{ return; }}\n    if (typeof value === \"function\") {{\n      try {{ value(); }} catch (error) {{\n        if (String((error && error.message) || \"\").indexOf(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\") === 0) {{ return; }}\n      }}\n    }}\n    __snapbackDenySurvivors.push(name);\n  }});\n{member_probe}{dynamic_code_probe}  if (__snapbackDenySurvivors.length > 0) {{\n    throw snapbackError(\"SNAPBACK_IBEX_GLOBAL_DENY_INCOMPLETE\", \"banned globals or dynamic-code paths survived the ambient denial: \" + __snapbackDenySurvivors.join(\", \"));\n  }}\n"
    );
    format!(
        "\"use strict\";\n(function(g) {{\n  function snapbackError(code, message) {{\n    var error = new Error(code + \": \" + message);\n    try {{ Object.defineProperty(error, \"__snapbackCode\", {{ value: code }}); }} catch (_) {{ error.__snapbackCode = code; }}\n    return error;\n  }}\n  function deny(name) {{\n    return function() {{ throw snapbackError(\"SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED\", name); }};\n  }}\n{denials}{member_denials}{probe}}})(globalThis);\n"
    )
}

pub fn ctx_bootstrap_source() -> &'static str {
    // @ref LLP 0048#architecture — the ctx bootstrap is the single-sourced
    // handler harness core, shared byte-for-byte with the workerd/V8 leg and
    // the LLP 0040 deploy template.
    include_str!("../../../packages/snapback-harness/ctx-bootstrap.js")
}

fn first_line(value: &str) -> String {
    value.lines().next().unwrap_or(value).to_owned()
}

fn detect_ibex_cli() -> IbexCliCapability {
    let path = env::var_os("SNAPBACK_IBEX")
        .map(PathBuf::from)
        .or_else(find_vendored_ibex_cli)
        .or_else(|| find_on_path("ibex"));
    let Some(path) = path else {
        return IbexCliCapability {
            available: false,
            path: None,
            version: None,
        };
    };

    let version = Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty());

    IbexCliCapability {
        available: true,
        path: Some(path),
        version,
    }
}

fn detect_ibex_submodule() -> IbexSubmoduleCapability {
    let path = snapback_root().join("vendor").join("ibex");
    let present = path.join("Cargo.toml").is_file();
    IbexSubmoduleCapability {
        present,
        path: present.then_some(path),
    }
}

fn find_vendored_ibex_cli() -> Option<PathBuf> {
    let root = snapback_root();
    let binary = if cfg!(windows) { "ibex.exe" } else { "ibex" };
    [
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("debug")
            .join(binary),
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("release")
            .join(binary),
    ]
    .into_iter()
    .find(|path| is_executable(path))
}

fn snapback_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn find_on_path(binary: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    env::split_paths(&paths)
        .map(|path| path.join(binary))
        .find(|path| is_executable(path))
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod runtime_capability_diagnostic_tests {
    use super::*;

    #[test]
    fn missing_external_ibex_cli_is_a_capability_fact_not_a_diagnostic() {
        let mut runtime = RuntimeManager::detect();
        runtime.force_ibex_cli_unavailable_for_test();

        assert_eq!(
            runtime.capabilities().ibex_cli,
            IbexCliCapability {
                available: false,
                path: None,
                version: None,
            }
        );
        assert!(runtime.diagnostics().is_empty());
    }
}
