//! The fetch prelude's streaming-body adaptation, at the factory: the
//! engine's response accessors are stubbed so what the factory does with a
//! record — when it releases it, how it counts its reads — is observed
//! exactly, which the real engine's idempotent release would hide. Its own
//! file for the reason `ibex_tests.rs` is one: the 1,500-line cap.

use super::*;
use serde_json::Value;

/// A runtime with the real bindings installed and the response accessors
/// replaced by `stubs`, which define `__ibex2_response_field`,
/// `__ibex2_response_read`, and `__ibex2_fetch_control` as the factory
/// captures them, plus a `released` list every field-8 call appends to. The
/// factory's value is left in `globalThis.factory`.
fn stubbed(stubs: &str) -> Hermes {
    let mut runtime = Hermes::new(DynamicCode::Closed).unwrap();
    assert!(runtime.install_stdlib());
    runtime.eval(SAVE_FETCH_ACCESSORS).unwrap();
    runtime.install_bindings().unwrap();
    runtime
        .eval(&format!(
            r#"
      globalThis.__ibex2_text_decode = __sb_saved.decode;
      globalThis.released = [];
      globalThis.__ibex2_fetch_control = function (action) {{ return action === 0 ? 1 : undefined; }};
      {stubs}
    "#
        ))
        .unwrap();
    runtime
        .eval(&format!("globalThis.factory = {FETCH_FACTORY};"))
        .unwrap();
    runtime
}

/// Run `program`, an async IIFE, to its settlement: what it resolved to, or
/// `{ rejected: <message> }`.
fn settle(runtime: &mut Hermes, program: &str) -> Value {
    runtime
        .eval(&format!(
            "globalThis.result = 'pending'; ({program}).then(
               function (value) {{ result = JSON.stringify(value); }},
               function (error) {{ result = JSON.stringify({{ rejected: String(error && error.message ? error.message : error) }}); }}
             );"
        ))
        .unwrap();
    runtime.pump().unwrap();
    serde_json::from_str(&runtime.eval("result").unwrap()).unwrap()
}

/// HEAD → 302 with a Location → 200. The hop's record has no body, so it is
/// released when the response is built; the follow-redirect loop then leaves
/// the hop behind, which is the other reason to release it. Once, not twice.
#[test]
fn a_bodiless_redirect_hop_is_released_exactly_once() {
    let mut runtime = stubbed(
        r#"
      globalThis.__ibex2_response_read = function () { return Promise.resolve(null); };
      globalThis.__ibex2_response_field = function (handle, field) {
        if (field === 8) { released.push(handle); return undefined; }
        if (field === 0) return handle === 302 ? 302 : 200;
        if (field === 1) return handle !== 302;
        if (field === 2) return handle === 302 ? 'http://127.0.0.1/start' : 'http://127.0.0.1/end';
        if (field === 7) return handle === 302 ? '[["location","/end"]]' : '[]';
        return false;
      };
    "#,
    );
    let result = settle(
        &mut runtime,
        r#"(async function () {
          let hop = 0;
          const fetch = factory(
            function () { return Promise.resolve(++hop === 1 ? 302 : 200); },
            function (error) { return error; },
            function () {}
          );
          const response = await fetch('http://127.0.0.1/start', { method: 'HEAD' });
          const text = await response.text();
          return { status: response.status, redirected: response.redirected, url: response.url, text, released };
        })()"#,
    );
    assert_eq!(
        result,
        json!({
            "status": 200,
            "redirected": true,
            "url": "http://127.0.0.1/end",
            "text": "",
            "released": [302, 200]
        })
    );
}

/// A body read that throws — synchronously, before it returns a promise —
/// rejects the consumer with the throw, and the job's pending I/O count
/// comes back down and the record is released all the same. A count left
/// high would keep the host waiting for I/O that is not coming, and report
/// the throw as the timeout.
#[test]
fn a_body_read_that_throws_settles_the_pending_count_and_rejects_with_the_throw() {
    let mut runtime = stubbed(
        r#"
      globalThis.__ibex2_response_read = function () { throw new Error('read broke'); };
      globalThis.__ibex2_response_field = function (handle, field) {
        if (field === 8) { released.push(handle); return undefined; }
        if (field === 0) return 200;
        if (field === 1) return true;
        if (field === 2) return 'http://127.0.0.1/body';
        if (field === 7) return '[]';
        return false;
      };
    "#,
    );
    let result = settle(
        &mut runtime,
        r#"(async function () {
          let pending = 0;
          const fetch = factory(
            function () { return Promise.resolve(7); },
            function (error) { return error; },
            function (delta) { pending += delta; }
          );
          const response = await fetch('http://127.0.0.1/body');
          let rejected = null;
          try { await response.text(); } catch (error) { rejected = error.message; }
          return { rejected, pending, released, bodyUsed: response.bodyUsed };
        })()"#,
    );
    assert_eq!(
        result,
        json!({ "rejected": "read broke", "pending": 0, "released": [7], "bodyUsed": true })
    );
}
