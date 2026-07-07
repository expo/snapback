// Additive half of the Workers-dialect allowlist (LLP 0048 §Handler-visible
// API surface): where an allowlisted API is missing it is installed with
// Workers-observable semantics; where it exists natively it is left alone
// (workerd) — except `console`, which is diagnostics-routed on both engines
// by contract, so it is always replaced. This file is engine-neutral on
// purpose: it evaluates as a plain script on Ibex and as a side-effect ES
// module on workerd, and it is the single source for both.
//
// Slice 1 (proposed to Charlie in LLP 0048): TextEncoder/TextDecoder (utf-8),
// atob/btoa, diagnostics-routed console. URL/URLSearchParams and
// structuredClone/crypto.subtle.digest are deferred to slice 2 and are
// unreachable on both engines until then.
(function (g) {
  function snapbackError(code, message) {
    var error = new Error(code + ": " + message);
    try {
      Object.defineProperty(error, "__snapbackCode", { value: code });
    } catch (_) {
      error.__snapbackCode = code;
    }
    return error;
  }

  // --- TextEncoder / TextDecoder (utf-8 only in slice 1) -------------------
  if (typeof g.TextEncoder !== "function") {
    var utf8Encode = function (text) {
      text = String(text === undefined ? "" : text);
      var bytes = [];
      for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
          var next = text.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
            i++;
          } else {
            code = 0xfffd;
          }
        } else if (code >= 0xd800 && code <= 0xdfff) {
          code = 0xfffd;
        }
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
          bytes.push(
            0xe0 | (code >> 12),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          );
        } else {
          bytes.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          );
        }
      }
      return new Uint8Array(bytes);
    };
    var TextEncoderPolyfill = function TextEncoder() {
      if (!(this instanceof TextEncoderPolyfill)) {
        throw new TypeError("Constructor TextEncoder requires 'new'");
      }
      this.encoding = "utf-8";
    };
    TextEncoderPolyfill.prototype.encode = function (text) {
      return utf8Encode(text);
    };
    g.TextEncoder = TextEncoderPolyfill;
  }
  if (typeof g.TextDecoder !== "function") {
    var TextDecoderPolyfill = function TextDecoder(label) {
      if (!(this instanceof TextDecoderPolyfill)) {
        throw new TypeError("Constructor TextDecoder requires 'new'");
      }
      var normalized = String(label === undefined ? "utf-8" : label).toLowerCase();
      if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
        throw new RangeError("TextDecoder label " + normalized + " is not supported in allowlist slice 1");
      }
      this.encoding = "utf-8";
      this.fatal = false;
      this.ignoreBOM = false;
    };
    TextDecoderPolyfill.prototype.decode = function (input) {
      if (input === undefined) return "";
      var bytes =
        input instanceof Uint8Array
          ? input
          : new Uint8Array(input.buffer !== undefined ? input.buffer : input);
      var out = "";
      var i = 0;
      while (i < bytes.length) {
        var byte1 = bytes[i++];
        var codePoint;
        if (byte1 < 0x80) {
          codePoint = byte1;
        } else if (byte1 >= 0xc0 && byte1 < 0xe0) {
          codePoint = ((byte1 & 0x1f) << 6) | (bytes[i++] & 0x3f);
        } else if (byte1 >= 0xe0 && byte1 < 0xf0) {
          codePoint =
            ((byte1 & 0x0f) << 12) |
            ((bytes[i++] & 0x3f) << 6) |
            (bytes[i++] & 0x3f);
        } else if (byte1 >= 0xf0) {
          codePoint =
            ((byte1 & 0x07) << 18) |
            ((bytes[i++] & 0x3f) << 12) |
            ((bytes[i++] & 0x3f) << 6) |
            (bytes[i++] & 0x3f);
        } else {
          codePoint = 0xfffd;
        }
        if (codePoint > 0xffff) {
          codePoint -= 0x10000;
          out += String.fromCharCode(0xd800 + (codePoint >> 10));
          out += String.fromCharCode(0xdc00 + (codePoint & 0x3ff));
        } else {
          out += String.fromCharCode(codePoint);
        }
      }
      return out;
    };
    g.TextDecoder = TextDecoderPolyfill;
  }

  // --- atob / btoa ----------------------------------------------------------
  // Native implementations are kept for their semantics but wrapped so the
  // failure shape is Snapback-owned on both engines: a malformed input is
  // SNAPBACK_HANDLER_INVALID_CHARACTER everywhere, never an engine-flavored
  // DOMException (which the conformance diff would flag as divergence).
  var nativeBtoa = typeof g.btoa === "function" ? g.btoa.bind(g) : null;
  var nativeAtob = typeof g.atob === "function" ? g.atob.bind(g) : null;
  var B64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (nativeBtoa) {
    g.btoa = function (input) {
      try {
        return nativeBtoa(String(input));
      } catch (_) {
        throw snapbackError(
          "SNAPBACK_HANDLER_INVALID_CHARACTER",
          "btoa: the string to be encoded contains characters outside of the Latin1 range"
        );
      }
    };
  } else {
    g.btoa = function (input) {
      var text = String(input);
      var out = "";
      for (var i = 0; i < text.length; i += 3) {
        var c1 = text.charCodeAt(i);
        var c2 = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN;
        var c3 = i + 2 < text.length ? text.charCodeAt(i + 2) : NaN;
        if (c1 > 0xff || c2 > 0xff || c3 > 0xff) {
          throw snapbackError(
            "SNAPBACK_HANDLER_INVALID_CHARACTER",
            "btoa: the string to be encoded contains characters outside of the Latin1 range"
          );
        }
        var triplet = (c1 << 16) | ((c2 || 0) << 8) | (c3 || 0);
        out += B64_ALPHABET.charAt((triplet >> 18) & 0x3f);
        out += B64_ALPHABET.charAt((triplet >> 12) & 0x3f);
        out += isNaN(c2) ? "=" : B64_ALPHABET.charAt((triplet >> 6) & 0x3f);
        out += isNaN(c3) ? "=" : B64_ALPHABET.charAt(triplet & 0x3f);
      }
      return out;
    };
  }
  if (nativeAtob) {
    g.atob = function (input) {
      try {
        return nativeAtob(String(input));
      } catch (_) {
        throw snapbackError(
          "SNAPBACK_HANDLER_INVALID_CHARACTER",
          "atob: the string to be decoded is not correctly encoded"
        );
      }
    };
  } else {
    g.atob = function (input) {
      var text = String(input).replace(/[\t\n\f\r ]+/g, "");
      if (text.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(text.replace(/=+$/, "")) || /=[^=]/.test(text)) {
        throw snapbackError(
          "SNAPBACK_HANDLER_INVALID_CHARACTER",
          "atob: the string to be decoded is not correctly encoded"
        );
      }
      text = text.replace(/=+$/, "");
      var out = "";
      var buffer = 0;
      var bits = 0;
      for (var i = 0; i < text.length; i++) {
        var value = B64_ALPHABET.indexOf(text.charAt(i));
        if (value < 0) {
          throw snapbackError(
            "SNAPBACK_HANDLER_INVALID_CHARACTER",
            "atob: the string to be decoded is not correctly encoded"
          );
        }
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          out += String.fromCharCode((buffer >> bits) & 0xff);
        }
      }
      return out;
    };
  }

  // --- diagnostics-routed console (replaced on both engines, by contract) ---
  var routed = function (level) {
    return function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        try {
          parts.push(String(arguments[i]));
        } catch (_) {
          parts.push("[unstringifiable]");
        }
      }
      try {
        var sink = g.__snapbackConsoleSink;
        if (typeof sink === "function") {
          sink(level, parts);
        }
      } catch (_) {
        // console is diagnostics, never control flow: sink failures are dropped
      }
    };
  };
  var routedConsole = {
    log: routed("log"),
    info: routed("info"),
    warn: routed("warn"),
    error: routed("error"),
    debug: routed("debug"),
  };
  try {
    Object.defineProperty(g, "console", {
      value: routedConsole,
      configurable: false,
      writable: false,
    });
  } catch (_) {
    g.console = routedConsole;
  }
})(globalThis);
