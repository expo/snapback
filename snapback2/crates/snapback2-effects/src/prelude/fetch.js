// Adapted from expo/ibex at revision ae72807aeaef7a2215d3f0dcf5f4e548ffc4c218:
// crates/ibex2/src/bindings/fetch.js. Snapback follows redirects through the
// grant-bound raw binding one hop at a time so a denial retains the attempted
// hop's origin instead of being mislabeled with the initial request.
// fetch and Response.
//
// A response crosses the boundary as an integer handle into a runtime-wide
// table, and the accessor that reads a handle's fields was a GLOBAL — so any
// module could read any other module's in-flight response by guessing small
// integers, granted or not. The accessor is captured here and removed from
// the global object; the handle lives in a WeakMap behind a Response object;
// and the only way to get a Response is the fetch a module was handed. The
// handle is never observable and cannot be forged.
//
// This script's VALUE is the fetch factory. It defines no global: the engine
// side stores the completion value and calls it once per grant set, so a
// module never sees a function that would wrap an integer of its choosing.
(function (global) {
  "use strict";

  var field = global.__ibex2_response_field;
  var decode = global.__ibex2_text_decode;
  var Headers = global.Headers;
  var freeHeaders = global.__sb_saved.freeHeaders;
  delete global.__ibex2_response_field;
  // Pure helpers nothing outside the bindings needs: the engine provides
  // TextEncoder and TextDecoder itself.
  delete global.__ibex2_text_encode;
  delete global.__ibex2_text_decode;
  delete global.__ibex2_text_encode_into;

  var handles = new WeakMap(); // Response -> { handle, used, status, ok, url, redirected, headers }

  function own(response) {
    var r = handles.get(response);
    if (!r) throw new TypeError("not a Response");
    return r;
  }

  function Response() {
    throw new TypeError("Response is not constructible; it comes from fetch");
  }

  // The metadata is read once here, because consuming the body releases the
  // record on the Rust side — and the web keeps status, url, and headers
  // readable after the body is gone. The headers become a real Headers.
  function response(handle, redirected) {
    var r = Object.create(Response.prototype);
    handles.set(r, {
      handle: handle,
      used: false,
      status: field(handle, 0),
      ok: field(handle, 1),
      url: field(handle, 2),
      redirected: redirected === undefined ? field(handle, 5) : redirected,
      headers: new Headers(JSON.parse(field(handle, 7))),
    });
    return r;
  }

  function define(name, get) {
    Object.defineProperty(Response.prototype, name, { get: get, enumerable: true, configurable: true });
  }
  define("status", function () { return own(this).status; });
  define("ok", function () { return own(this).ok; });
  define("url", function () { return own(this).url; });
  define("redirected", function () { return own(this).redirected; });
  define("bodyUsed", function () { return own(this).used; });
  define("headers", function () { return own(this).headers; });

  function consume(response) {
    var r = own(response);
    if (r.used) return Promise.reject(new TypeError("body already consumed"));
    r.used = true;
    try {
      return Promise.resolve(field(r.handle, 4));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  Response.prototype.arrayBuffer = function () { return consume(this); };
  Response.prototype.text = function () {
    return consume(this).then(function (bytes) { return decode(bytes); });
  };
  Response.prototype.json = function () {
    return this.text().then(function (text) { return JSON.parse(text); });
  };
  Object.defineProperty(Response.prototype, Symbol.toStringTag, { value: "Response", configurable: true });
  Object.freeze(Response.prototype);

  function copyInit(init) {
    var copy = {};
    if (init !== undefined && init !== null) {
      var names = Object.keys(Object(init));
      for (var i = 0; i < names.length; i++) copy[names[i]] = init[names[i]];
    }
    return copy;
  }

  function isRedirect(status) {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
  }

  function invokeRaw(raw, url, init, redirectMode, tagRawError) {
    var headers;
    try {
      var method = init.method !== undefined ? String(init.method) : "";
      var body = init.body;
      var target = String(url);
      // @ref LLP 1003#3-the-runtime-snapback2-effects — each hop owns a validated snapshot; only raw rejections can carry a grant denial.
      headers = new Headers(init.headers);
      if (typeof body === "string") {
        if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
        body = new TextEncoder().encode(body);
      }
      // Lowercase pairs survive redirects independently of the caller's record,
      // iterable, or Headers. The fifth raw argument is Ibex's validated handle.
      init.headers = Array.from(headers);
      return raw(target, method, body, redirectMode, headers._handle).then(
        function (handle) { freeHeaders(headers._handle); return handle; },
        function (error) { freeHeaders(headers._handle); throw tagRawError(error, target); }
      );
    } catch (error) {
      if (headers) freeHeaders(headers._handle);
      return Promise.reject(error);
    }
  }

  function dropHeaders(init, names) {
    init.headers = init.headers.filter(function (pair) { return names.indexOf(pair[0]) === -1; });
  }

  // The factory. `raw` is the engine's async binding for one grant set; it
  // resolves to a handle, and this is the only place a handle becomes an
  // object. Default redirect following is kept on this side of the binding so
  // each denied hop remains attributable without widening Ibex's capability.
  return function makeFetch(raw, tagRawError) {
    return function fetch(input, init) {
      var currentInit = copyInit(init);
      var redirectMode = currentInit.redirect !== undefined ? String(currentInit.redirect) : "follow";
      // Ibex treats unknown modes as follow; never let that bypass our hop rules.
      if (redirectMode !== "follow" && redirectMode !== "manual" && redirectMode !== "error") {
        return Promise.reject(new TypeError("Invalid redirect mode"));
      }
      if (redirectMode !== "follow") {
        return invokeRaw(raw, input, currentInit, redirectMode, tagRawError)
          .then(function (handle) { return response(handle); });
      }

      var currentUrl = String(input);
      currentInit.redirect = "manual";
      var redirects = 0;

      function next() {
        return invokeRaw(raw, currentUrl, currentInit, "manual", tagRawError).then(function (handle) {
          var value = response(handle, redirects > 0);
          if (!isRedirect(value.status)) return value;
          var location = value.headers.get("location");
          if (location === null) return value;
          redirects++;
          if (redirects > 20) throw new TypeError("TypeError: Failed to fetch — too many redirects");

          var method = currentInit.method === undefined ? "GET" : String(currentInit.method).toUpperCase();
          // @ref LLP 1003#1-authoring — Fetch method rewrites discard body headers; cross-origin hops discard credentials.
          if ((value.status === 303 && method !== "GET" && method !== "HEAD") ||
              ((value.status === 301 || value.status === 302) && method === "POST")) {
            currentInit.method = "GET";
            delete currentInit.body;
            dropHeaders(currentInit, ["content-type", "content-length", "content-encoding", "content-language", "content-location"]);
          }
          var nextUrl = new URL(String(location), currentUrl);
          if (nextUrl.origin !== new URL(currentUrl).origin) {
            dropHeaders(currentInit, ["authorization", "proxy-authorization", "cookie"]);
          }
          currentUrl = nextUrl.toString();
          return next();
        });
      }

      return next();
    };
  };
})(globalThis);
