//! The fetch prelude's streaming-body adaptation, at the factory: the
//! engine's response accessors are stubbed so what the factory does with a
//! record — when it releases it, how it counts its reads — is observed
//! exactly, which the real engine's idempotent release would hide. Its own
//! file for the reason `ibex_tests.rs` is one: the 1,500-line cap.

use super::*;
use serde_json::Value;

/// A PURE runtime plus a fake bootstrap object whose response operations are
/// replaced by `stubs`. `released` records every field-8 call; header releases
/// are irrelevant to these response-lifecycle tests. The context follows the
/// runtime so the runtime is dropped first.
struct Stubbed {
    runtime: Hermes,
    _context: Context,
}

impl std::ops::Deref for Stubbed {
    type Target = Hermes;

    fn deref(&self) -> &Self::Target {
        &self.runtime
    }
}

impl std::ops::DerefMut for Stubbed {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.runtime
    }
}

fn stubbed(stubs: &str) -> Stubbed {
    let mut runtime = Hermes::new(DynamicCode::Closed).unwrap();
    let context = Context::new(GrantSet::none());
    runtime
        .install_with(Groups::PURE, &context, InstallOptions::default())
        .unwrap();
    runtime
        .eval(&format!(
            r#"
      globalThis.released = [];
      globalThis.__ibex2_fetch_control = function (action) {{ return action === 0 ? 1 : undefined; }};
      {stubs}
      globalThis.__snapback_ibex2_fetch_primitives = Object.freeze({{
        fetch: function () {{ throw new Error('raw fetch is supplied by the test'); }},
        responseField: globalThis.__ibex2_response_field,
        responseRead: globalThis.__ibex2_response_read,
        fetchControl: globalThis.__ibex2_fetch_control,
        textEncode: function (text) {{ return new TextEncoder().encode(text).buffer; }},
        textDecode: function (bytes) {{ return new TextDecoder().decode(bytes); }},
        textEncodeInto: function () {{ throw new Error('unused'); }},
        headersFree: function () {{}},
      }});
    "#
        ))
        .unwrap();
    runtime
        .eval(&format!("globalThis.factory = {FETCH_FACTORY};"))
        .unwrap();
    Stubbed {
        runtime,
        _context: context,
    }
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
/// comes back down. The primitive operation owns terminal-error release, so
/// the wrapper must not issue a second field-8 drop. A count left high would
/// keep the host waiting for I/O that is not coming, and report the throw as
/// the timeout.
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
        json!({ "rejected": "read broke", "pending": 0, "released": [], "bodyUsed": true })
    );
}
