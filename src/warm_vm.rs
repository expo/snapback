//! Warm VM pool for the trusted-local target — the DK-4 leg of LLP 0009.
//!
//! A fresh Hermes VM per invocation costs ~3.6–4.4 ms release (~55 % pure
//! `ex_hermes_create`, the rest eval including module re-parse) and is the
//! dominant compute cost in the whole system (LLP 0035). This module reuses a
//! VM across invocations of the *same module source* for queries and
//! mutations only, gated on the per-invocation reset installed by
//! [`RESET_INSTALL_SOURCE`]: after every invocation the reset sweeps
//! `globalThis`, the dispatch table, and a fixed list of intrinsic roots back
//! to the post-setup baseline, and the VM is pooled only on a verified-ok
//! verdict — anything else burns the VM and the next invocation pays a fresh
//! create. Actions never pool; hosted/untrusted posture is untouched.
//!
//! @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
//! the as-built design this file implements: keying, threading, reset, fences.

use crate::diagnostic::SnapbackResult;
use crate::runtime::{HermesRuntimeOpaque, RuntimeGuard, eval};
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

/// Total warm VMs pooled per instance, across all bundle keys. A Hermes heap
/// is MB-scale and the common case is one bundle shared by every function of
/// an app, so the bound is small; beyond-bound check-ins destroy the VM.
///
/// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — pool bound.
const WARM_VM_POOL_CAP: usize = 4;

pub(crate) const WARM_SETUP_SOURCE_URL: &str = "snapback-warm-setup.js";
const WARM_RESET_SOURCE_URL: &str = "snapback-warm-reset.js";

/// Per-invocation reset trigger. The installed function returns a JSON
/// verdict string; [`WarmVmPool::reset_and_check_in`] pools the VM only on a
/// parsed `ok: true`.
const RESET_CALL_SOURCE: &str = "globalThis.__snapbackReset()";

/// One warmed (or warming) VM, exclusively owned by the current invocation
/// between checkout and check-in. Dropping it destroys the runtime ("burn").
pub(crate) struct WarmVm {
    guard: RuntimeGuard,
    /// The exact module source this VM was (or will be) set up with. The map
    /// buckets by a precomputed hash to keep the pool mutex cheap, but checkout
    /// still compares this exact text before reuse — no digest-only keying.
    key: String,
    source_hash: u64,
    /// Whether the setup eval (ambient + module + bootstrap + reset install)
    /// has completed. Setup runs inside the invocation's host-context window
    /// so first-invocation module top-level host calls match the fresh path.
    set_up: bool,
    /// The pool generation this VM was checked out under. `clear()` bumps the
    /// generation; a check-in whose generation is stale is dropped, not
    /// pooled — this closes the read-lane race where an in-flight lock-free
    /// query, holding a VM checked out before a `load_functions`/`reset`,
    /// would otherwise return a pre-clear VM (with pre-reload module state)
    /// into the freshly-cleared pool.
    ///
    /// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — generation guard.
    generation: u64,
    last_pooled_at: u64,
}

// SAFETY: a WarmVm is moved between OS threads (tokio blocking-pool threads
// have ephemeral assignment) but is never used by two threads at once: the
// pool's Mutex hands out exclusive ownership by move, and the mutex
// release/acquire provides the happens-before edge between successive owning
// threads. The vendored JSI contract requires exactly this — non-concurrent
// use, with "using a mutex" a sanctioned strategy — not thread affinity; the
// only thread-identity capture in the Ibex layer guards a WebSocket teardown
// path that warm classes (queries/mutations, WebSocket denied) can never
// reach.
//
// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — threading.
unsafe impl Send for WarmVm {}

impl WarmVm {
    pub(crate) fn runtime(&self) -> *mut HermesRuntimeOpaque {
        self.guard.ptr()
    }

    pub(crate) fn is_set_up(&self) -> bool {
        self.set_up
    }

    pub(crate) fn mark_set_up(&mut self) {
        self.set_up = true;
    }
}

#[derive(Default)]
struct PoolInner {
    vms: HashMap<u64, Vec<WarmVm>>,
    pooled: usize,
    /// Bumped by `clear()`; a VM checked out under an older generation is
    /// dropped on check-in rather than pooled.
    generation: u64,
    next_lru_tick: u64,
}

/// The per-instance warm VM pool. One per `LocalSnapback` — two local app
/// instances must never share loaded code state (LLP 0009 §Validation
/// Requirements; LLP 0018), and module-level state would bleed through a
/// process-global pool.
pub(crate) struct WarmVmPool {
    inner: Mutex<PoolInner>,
    enabled: AtomicBool,
}

impl WarmVmPool {
    /// Build the pool, sampling the `SNAPBACK_FRESH_VM` opt-out once at
    /// instance construction (env-static, like the outbound-actions flag).
    pub(crate) fn from_env() -> Self {
        let fresh_forced = matches!(
            std::env::var("SNAPBACK_FRESH_VM").ok().as_deref(),
            Some("1") | Some("true") | Some("TRUE")
        );
        Self {
            inner: Mutex::new(PoolInner::default()),
            enabled: AtomicBool::new(!fresh_forced),
        }
    }

    /// Whether the warm path is active. When false every invocation takes the
    /// fresh path — the honest value surfaces as `vmLifecycle` in the
    /// capability manifest.
    pub(crate) fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Force the fresh path (bench `vm_cost_us` keeps its fresh-create
    /// definition; tests exercise opt-out semantics without env mutation).
    pub(crate) fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        if !enabled {
            self.clear();
        }
    }

    /// Check out a VM for `module_source`, creating a new (not yet set up)
    /// one on miss. The pool mutex covers only the map operation — VM
    /// creation (~ms) runs unlocked, and the returned VM is exclusively owned
    /// until check-in or drop.
    pub(crate) fn checkout(&self, module_source: &str) -> SnapbackResult<WarmVm> {
        let source_hash = module_source_hash(module_source);
        let generation = {
            let mut inner = self
                .inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut remove_bucket = false;
            let mut checkout = None;
            if let Some(vms) = inner.vms.get_mut(&source_hash)
                && let Some(index) = vms.iter().rposition(|vm| vm.key == module_source)
            {
                checkout = Some(vms.remove(index));
                remove_bucket = vms.is_empty();
            }
            if remove_bucket {
                inner.vms.remove(&source_hash);
            }
            if let Some(vm) = checkout {
                inner.pooled -= 1;
                return Ok(vm);
            }
            inner.generation
        };
        Ok(WarmVm {
            guard: RuntimeGuard::create()?,
            key: module_source.to_owned(),
            source_hash,
            set_up: false,
            generation,
            last_pooled_at: 0,
        })
    }

    /// Run the per-invocation reset and pool the VM only on a verified-ok
    /// verdict; any eval error, sweep error, or unparseable verdict burns it.
    /// Runs at check-in so pooled VMs are clean at rest and a poisoned VM
    /// never waits in the pool.
    ///
    /// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — fail-closed pooling.
    pub(crate) fn reset_and_check_in(&self, vm: WarmVm) {
        if !self.enabled() || !vm.set_up {
            return; // drop = burn
        }
        match eval(vm.runtime(), WARM_RESET_SOURCE_URL, RESET_CALL_SOURCE) {
            Ok(verdict) if reset_verdict_ok(&verdict) => self.check_in(vm),
            _ => {} // drop = burn; next invocation creates fresh
        }
    }

    fn check_in(&self, vm: WarmVm) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // A VM checked out before a `clear()` carries a stale generation; drop
        // it rather than return pre-reload module state to the cleared pool.
        if vm.generation != inner.generation {
            return;
        }
        if inner.pooled >= WARM_VM_POOL_CAP {
            evict_oldest_locked(&mut inner);
        }
        if inner.pooled >= WARM_VM_POOL_CAP {
            return; // cap is zero or eviction found nothing; drop = burn
        }
        let mut vm = vm;
        vm.last_pooled_at = inner.next_lru_tick;
        inner.next_lru_tick = inner.next_lru_tick.wrapping_add(1);
        inner.pooled += 1;
        inner.vms.entry(vm.source_hash).or_default().push(vm);
    }

    /// Drop every pooled VM and advance the generation. Called on
    /// `load_functions` and app `reset`. Content keying already prevents
    /// reuse across a *changed* source; the generation bump additionally
    /// closes the identical-source-reload race with an in-flight lock-free
    /// read holding a pre-clear VM.
    pub(crate) fn clear(&self) {
        let drained = {
            let mut inner = self
                .inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner.pooled = 0;
            inner.generation = inner.generation.wrapping_add(1);
            std::mem::take(&mut inner.vms)
        };
        drop(drained); // destroy outside the lock
    }

    #[cfg(test)]
    pub(crate) fn pooled_count(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pooled
    }
}

fn module_source_hash(module_source: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    module_source.hash(&mut hasher);
    hasher.finish()
}

fn evict_oldest_locked(inner: &mut PoolInner) {
    let mut oldest: Option<(u64, usize, u64)> = None;
    for (source_hash, vms) in &inner.vms {
        for (index, vm) in vms.iter().enumerate() {
            if oldest
                .map(|(_, _, tick)| vm.last_pooled_at < tick)
                .unwrap_or(true)
            {
                oldest = Some((*source_hash, index, vm.last_pooled_at));
            }
        }
    }
    let Some((source_hash, index, _)) = oldest else {
        return;
    };
    let mut remove_bucket = false;
    if let Some(vms) = inner.vms.get_mut(&source_hash)
        && index < vms.len()
    {
        vms.remove(index);
        remove_bucket = vms.is_empty();
        inner.pooled = inner.pooled.saturating_sub(1);
    }
    if remove_bucket {
        inner.vms.remove(&source_hash);
    }
}

fn reset_verdict_ok(verdict: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(verdict)
        .ok()
        .and_then(|value| value.get("ok").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

/// The reset installer, appended to the warm setup eval *after* the module
/// and ctx bootstrap ran, so module-level polyfills are part of the app's own
/// baseline rather than a leak. It captures own-property descriptors (string
/// and symbol keys) of `globalThis`, the `__snapbackHandlers` dispatch table
/// (one level deep), and a fixed list of intrinsic roots, then installs a
/// frozen `__snapbackReset` that deletes additions and redefines drifted
/// descriptors back to the baseline, returning a JSON verdict.
///
/// Hygiene: every primitive the sweep uses is captured here at install time
/// (including `Reflect.apply` and the `Map` method references), so a handler
/// overwriting the global copies cannot blind the sweep — and the overwritten
/// globals themselves get restored. Deliberate subversion (proxying an
/// intrinsic to lie) is outside the trusted-local threat model.
///
/// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — reset technique.
pub(crate) const RESET_INSTALL_SOURCE: &str = r#"
(function(g) {
  "use strict";
  var gopn = Object.getOwnPropertyNames;
  var gops = Object.getOwnPropertySymbols;
  var gopd = Object.getOwnPropertyDescriptor;
  var defineProp = Object.defineProperty;
  var getProto = Object.getPrototypeOf;
  var sameValue = Object.is;
  var stringify = JSON.stringify;
  var apply = Reflect.apply;
  var MapCtor = Map;
  var mapSet = Map.prototype.set;
  var mapHas = Map.prototype.has;
  var mapForEach = Map.prototype.forEach;

  function ownKeys(obj) {
    var names = gopn(obj);
    var syms = gops(obj);
    var all = [];
    var n = 0;
    for (var i = 0; i < names.length; i++) all[n++] = names[i];
    for (var j = 0; j < syms.length; j++) all[n++] = syms[j];
    return all;
  }

  function snapshotOf(obj) {
    var baseline = new MapCtor();
    var keys = ownKeys(obj);
    for (var i = 0; i < keys.length; i++) {
      apply(mapSet, baseline, [keys[i], gopd(obj, keys[i])]);
    }
    return baseline;
  }

  function descriptorChanged(saved, current) {
    if (!current) return true;
    if (saved.configurable !== current.configurable) return true;
    if (saved.enumerable !== current.enumerable) return true;
    var savedAccessor = saved.get !== undefined || saved.set !== undefined;
    var currentAccessor = current.get !== undefined || current.set !== undefined;
    if (savedAccessor !== currentAccessor) return true;
    if (savedAccessor) {
      return saved.get !== current.get || saved.set !== current.set;
    }
    if (saved.writable !== current.writable) return true;
    return !sameValue(saved.value, current.value);
  }

  function restoreObject(obj, baseline) {
    var restored = 0;
    var keys = ownKeys(obj);
    for (var i = 0; i < keys.length; i++) {
      if (!apply(mapHas, baseline, [keys[i]])) {
        // Strict mode: deleting a non-configurable addition throws, which
        // the caller reports as not-ok and the host burns the VM.
        delete obj[keys[i]];
        restored++;
      }
    }
    apply(mapForEach, baseline, [function (saved, key) {
      var current = gopd(obj, key);
      if (descriptorChanged(saved, current)) {
        defineProp(obj, key, saved);
        restored++;
      }
    }]);
    return restored;
  }

  // Intrinsic pollution roots. The sweep restores each root's *own*
  // properties to the post-setup baseline; anything deeper (a value stored
  // inside a root's property) is module-state territory per the DK-4 limits.
  // The set is broad on purpose: every constructor *and* its prototype, the
  // iterator/generator prototypes reached reflectively (a poisoned
  // %ArrayIteratorPrototype%.next would otherwise break the next
  // invocation's for-of), and the host namespaces. Restore-or-burn: if any
  // watched root drifted un-restorably, __snapbackReset throws and the VM is
  // burned. Deduplicated by identity so shared objects are snapshotted once.
  var roots = [];
  var seen = new MapCtor();
  function pushRoot(obj) {
    if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) return;
    if (apply(mapHas, seen, [obj])) return;
    apply(mapSet, seen, [obj, true]);
    roots[roots.length] = obj;
  }
  function pushCtor(ctor) {
    if (typeof ctor !== "function") return;
    pushRoot(ctor);
    pushRoot(ctor.prototype);
  }
  // Fundamental + wrappers + well-known.
  pushCtor(Object); pushCtor(Function); pushCtor(Array);
  pushCtor(String); pushCtor(Number); pushCtor(Boolean);
  pushCtor(Symbol); pushCtor(Date); pushCtor(RegExp);
  pushCtor(Promise);
  if (typeof BigInt !== "undefined") pushCtor(BigInt);
  // Errors: constructors *and* prototypes (only prototypes were covered before).
  pushCtor(Error); pushCtor(TypeError); pushCtor(RangeError);
  pushCtor(SyntaxError); pushCtor(ReferenceError); pushCtor(EvalError);
  pushCtor(URIError);
  if (typeof AggregateError !== "undefined") pushCtor(AggregateError);
  // Collections, including the weak family's constructors.
  pushCtor(Map); pushCtor(Set); pushCtor(WeakMap); pushCtor(WeakSet);
  if (typeof WeakRef !== "undefined") pushCtor(WeakRef);
  if (typeof FinalizationRegistry !== "undefined") pushCtor(FinalizationRegistry);
  // Binary: ArrayBuffer/DataView/TypedArray constructors + the shared base.
  pushCtor(ArrayBuffer); pushCtor(DataView);
  if (typeof SharedArrayBuffer !== "undefined") pushCtor(SharedArrayBuffer);
  var typedArrayNames = [
    "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array"
  ];
  for (var t = 0; t < typedArrayNames.length; t++) {
    var TA = g[typedArrayNames[t]];
    if (typeof TA === "function") {
      pushCtor(TA);
      pushRoot(getProto(TA));            // %TypedArray%
      if (TA.prototype) pushRoot(getProto(TA.prototype)); // %TypedArray%.prototype
    }
  }
  // Reflection / meta namespaces and the Proxy constructor.
  pushRoot(JSON); pushRoot(Math); pushRoot(Reflect);
  if (typeof Proxy === "function") pushRoot(Proxy);
  if (typeof Intl !== "undefined") pushRoot(Intl);
  if (typeof Atomics !== "undefined") pushRoot(Atomics);
  if (typeof WebAssembly !== "undefined") pushRoot(WebAssembly);
  // Iterator/generator prototypes — not reachable as named globals, but a
  // poisoned .next/.return here silently corrupts for-of/yield in the next
  // invocation. Reach them reflectively; guard each in case the engine lacks
  // a form. %IteratorPrototype% is the parent of all of them.
  try { pushRoot(getProto([][Symbol.iterator]())); pushRoot(getProto(getProto([][Symbol.iterator]()))); } catch (_) {}
  try { pushRoot(getProto(""[Symbol.iterator]())); } catch (_) {}
  try { pushRoot(getProto(new MapCtor()[Symbol.iterator]())); } catch (_) {}
  try { pushRoot(getProto(new Set()[Symbol.iterator]())); } catch (_) {}
  try {
    var genFnProto = getProto(function* () {}); // %Generator% (GeneratorFunction.prototype)
    pushRoot(genFnProto);
    if (genFnProto && genFnProto.prototype) pushRoot(genFnProto.prototype); // %GeneratorPrototype%
  } catch (_) {}
  // (Async generators are not a Hermes syntax form, so %AsyncGeneratorPrototype%
  // is not reachable/pollutable by app code; nothing to sweep.)
  // Host-provided globals commonly monkeypatched (console, crypto, encoders).
  if (typeof console !== "undefined") pushRoot(console);
  if (typeof crypto !== "undefined") pushRoot(crypto);
  if (typeof TextEncoder === "function") pushCtor(TextEncoder);
  if (typeof TextDecoder === "function") pushCtor(TextDecoder);
  // The dispatch table itself (one level: replacing/adding a handler must not survive).
  var handlers = g.__snapbackHandlers;
  if (handlers !== null && (typeof handlers === "object" || typeof handlers === "function")) {
    pushRoot(handlers);
  }

  var rootBaselines = [];
  for (var i = 0; i < roots.length; i++) {
    rootBaselines[i] = snapshotOf(roots[i]);
  }

  // Install the reset *before* snapshotting globalThis so it is part of its
  // own baseline (otherwise every sweep would try to delete it and fail).
  defineProp(g, "__snapbackReset", {
    value: function () {
      try {
        var restored = restoreObject(g, globalBaseline);
        for (var i = 0; i < roots.length; i++) {
          restored += restoreObject(roots[i], rootBaselines[i]);
        }
        return stringify({ ok: true, restored: restored });
      } catch (error) {
        try {
          return stringify({ ok: false, error: "" + (error && error.message || error) });
        } catch (_) {
          return "{\"ok\":false}";
        }
      }
    },
    writable: false,
    enumerable: false,
    configurable: false
  });

  var globalBaseline = snapshotOf(g);
})(globalThis);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local::LocalSnapback;
    use crate::manifest::{
        AuthInput, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
        HandlerInput, IbexModule,
    };
    use serde_json::json;

    fn counter_manifest(source_tag: &str) -> FunctionManifest {
        let source = format!(
            r#"
let moduleCounter = 0; // {source_tag}
globalThis.__snapbackHandlers = {{
  async count(ctx) {{ moduleCounter += 1; return [{{ n: moduleCounter }}]; }}
}};
"#
        );
        FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "count",
                FunctionKind::Query,
                FunctionRuntime::IbexModule(IbexModule {
                    source,
                    export: "count".to_owned(),
                }),
            )],
            ..FunctionManifest::default()
        }
    }

    fn input() -> HandlerInput {
        HandlerInput {
            args: json!({}),
            auth: AuthInput::default(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,        }
    }

    fn count(snapback: &LocalSnapback) -> u64 {
        snapback
            .invoke_query("count", input())
            .expect("count query")
            .rows[0]["n"]
            .as_u64()
            .expect("counter value")
    }

    /// DK-4 opt-out semantics: with the pool disabled (what
    /// `SNAPBACK_FRESH_VM=1` samples into at construction), every invocation
    /// is a fresh VM, so module-level state never persists.
    #[test]
    fn dk4_disabled_pool_forces_fresh_vm_semantics() {
        let mut snapback = LocalSnapback::memory().expect("snapback");
        snapback.load_functions(counter_manifest("disabled"));
        snapback.set_warm_vms_enabled(false);
        assert_eq!(count(&snapback), 1);
        assert_eq!(
            count(&snapback),
            1,
            "fresh path must not retain module state"
        );
    }

    /// DK-4 pool bound: check-ins beyond the cap destroy the VM instead of
    /// growing the pool.
    #[test]
    fn dk4_pool_is_bounded() {
        let pool = WarmVmPool::from_env();
        pool.set_enabled(true);
        let mut vms = Vec::new();
        for n in 0..(WARM_VM_POOL_CAP + 2) {
            vms.push(pool.checkout(&format!("// bundle {n}")).expect("checkout"));
        }
        for mut vm in vms {
            // Bypass reset (these VMs are not set up); exercise the bound
            // through the raw check-in the reset path uses.
            vm.mark_set_up();
            pool.check_in(vm);
        }
        assert_eq!(pool.pooled_count(), WARM_VM_POOL_CAP);
    }

    /// DK-4 global cap eviction: an active fifth bundle must be able to reuse
    /// its VM instead of being dropped forever behind four older idle bundles.
    #[test]
    fn dk4_pool_evicts_oldest_idle_vm_for_new_active_bundle() {
        let pool = WarmVmPool::from_env();
        pool.set_enabled(true);
        for n in 0..WARM_VM_POOL_CAP {
            let mut vm = pool
                .checkout(&format!("// idle bundle {n}"))
                .expect("checkout");
            vm.mark_set_up();
            pool.check_in(vm);
        }
        assert_eq!(pool.pooled_count(), WARM_VM_POOL_CAP);

        let active_source = "// active fifth bundle";
        let mut active = pool.checkout(active_source).expect("active checkout");
        active.mark_set_up();
        pool.check_in(active);
        assert_eq!(pool.pooled_count(), WARM_VM_POOL_CAP);

        let active_again = pool.checkout(active_source).expect("active reuse");
        assert!(
            active_again.is_set_up(),
            "active fifth bundle should evict an idle VM and remain pooled"
        );
        let oldest_again = pool.checkout("// idle bundle 0").expect("oldest checkout");
        assert!(
            !oldest_again.is_set_up(),
            "oldest idle bundle should have been evicted to make room"
        );
    }

    /// DK-4 keying soundness: queries and mutations share one warm VM per
    /// bundle, which is only sound while their ambient deny sets are the same
    /// text. If this fails, the pool key must grow a mode dimension.
    #[test]
    fn dk4_query_and_mutation_share_one_ambient_restriction() {
        for outbound in [false, true] {
            assert_eq!(
                crate::runtime::ambient_restriction_source_for_tests(false, outbound),
                crate::runtime::ambient_restriction_source_for_tests(true, outbound),
                "query and mutation ambient restrictions diverged (outbound={outbound}); \
                 re-key the warm VM pool by mode before shipping this change"
            );
        }
    }
}
