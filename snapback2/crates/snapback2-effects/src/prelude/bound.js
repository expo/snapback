// The bound-only transport of a `test` owner. Installed by the host between
// Ibex's raw fetch binding and the prelude that captures it, so the prelude,
// the factory, and every effect see one raw binding whichever transport is
// behind it. It exists only when a job carries a binding table; a dev or
// serve owner never evaluates it.
//
// Order on every request and on every redirect hop (the factory calls the
// raw binding once per hop, with the hop's logical URL):
//   1. the grant, on the logical origin, refused with the engine's own
//      denial text so the prelude tags it `E_EFFECT_GRANT` exactly as in
//      production;
//   2. the binding: an origin the journey did not bind is `E_EFFECT_UNBOUND`
//      and reaches no transport;
//   3. substitution: the bound loopback origin replaces the logical one and
//      the request goes to Ibex's binding, whose own grants admit nothing but
//      the bound loopback origins.
// Origins compare as `new URL(...).origin`: lowercase scheme and host, the
// scheme's default port elided, the same equivalence Ibex's grant uses.
// @ref LLP 1021#3-a-provider-stand-in-and-nothing-else-answers — grants first, on the logical origin; nothing else answers.
(function (raw, grants, bindings, effect) {
  "use strict";
  var granted = [];
  for (var i = 0; i < grants.length; i++) {
    try { granted.push(new URL(grants[i]).origin); } catch (_) {}
  }
  var targets = Object.create(null);
  var names = Object.keys(bindings);
  for (var j = 0; j < names.length; j++) {
    try { targets[new URL(names[j]).origin] = String(bindings[names[j]]); } catch (_) {}
  }
  globalThis.__ibex2_fetch = function (target) {
    var url;
    try { url = new URL(String(target)); } catch (error) { return Promise.reject(error); }
    if (granted.indexOf(url.origin) === -1) {
      return Promise.reject(new Error("denied: net.fetch"));
    }
    var to = targets[url.origin];
    if (to === undefined) {
      var unbound = new Error(
        "E_EFFECT_UNBOUND: no journey provider is bound for " + url.origin
        + "; declare effects.provider('" + url.origin + "', handler) in the journey that emits " + effect
      );
      unbound.code = "E_EFFECT_UNBOUND";
      unbound.origin = url.origin;
      return Promise.reject(unbound);
    }
    var args = Array.prototype.slice.call(arguments);
    args[0] = to + url.pathname + url.search;
    return raw.apply(undefined, args);
  };
})(globalThis.__ibex2_fetch, __SNAPBACK_GRANTS__, __SNAPBACK_BINDINGS__, __SNAPBACK_EFFECT_NAME__);
