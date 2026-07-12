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
    // WHATWG encodeInto (the allowlist declares it; workerd has it natively —
    // ENG-23593 review finding): encode whole code points while they fit,
    // reporting UTF-16 units read and bytes written.
    TextEncoderPolyfill.prototype.encodeInto = function (source, destination) {
      if (!(destination instanceof Uint8Array)) {
        throw new TypeError("TextEncoder.encodeInto requires a Uint8Array destination");
      }
      var text = String(source === undefined ? "" : source);
      var read = 0;
      var written = 0;
      var i = 0;
      while (i < text.length) {
        var units = 1;
        var code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
          var next = text.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) units = 2;
        }
        var encoded = utf8Encode(text.slice(i, i + units));
        if (written + encoded.length > destination.length) break;
        destination.set(encoded, written);
        written += encoded.length;
        read += units;
        i += units;
      }
      return { read: read, written: written };
    };
    g.TextEncoder = TextEncoderPolyfill;
  }
  if (typeof g.TextDecoder !== "function") {
    // WHATWG-faithful UTF-8 decode (ENG-23593 / ENG-24375): honors any ArrayBufferView's
    // byteOffset/byteLength window, emits U+FFFD per the maximal-subpart rule
    // on invalid or flushed-truncated sequences (or throws when `fatal`),
    // carries incomplete 2/3/4-byte sequences across `{stream:true}` calls,
    // and strips one leading BOM per decode stream unless `ignoreBOM`.
    var toDecodeBytes = function (input) {
      if (input === undefined) return new Uint8Array(0);
      if (input instanceof Uint8Array) return input;
      if (typeof ArrayBuffer !== "undefined") {
        if (typeof ArrayBuffer.isView === "function" && ArrayBuffer.isView(input)) {
          return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        }
        if (input instanceof ArrayBuffer) {
          return new Uint8Array(input);
        }
      }
      throw new TypeError("TextDecoder.decode requires an ArrayBuffer or ArrayBufferView");
    };
    var decoderStates = new WeakMap();
    var TextDecoderPolyfill = function TextDecoder(label, options) {
      if (!(this instanceof TextDecoderPolyfill)) {
        throw new TypeError("Constructor TextDecoder requires 'new'");
      }
      // WHATWG label matching strips only Infra's ASCII whitespace set. Do not
      // use String.prototype.trim(), which also accepts non-ASCII whitespace.
      var normalized = String(label === undefined ? "utf-8" : label)
        .replace(/^[\u0009\u000A\u000C\u000D\u0020]+|[\u0009\u000A\u000C\u000D\u0020]+$/g, "")
        .toLowerCase();
      if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
        throw new RangeError("TextDecoder label " + normalized + " is not supported in allowlist slice 1");
      }
      this.encoding = "utf-8";
      this.fatal = !!(options && options.fatal);
      this.ignoreBOM = !!(options && options.ignoreBOM);
      decoderStates.set(this, { pending: [], streaming: false, bomSeen: false });
    };
    TextDecoderPolyfill.prototype.decode = function (input, options) {
      var state = decoderStates.get(this);
      if (!state) throw new TypeError("TextDecoder.decode called on an incompatible receiver");
      var stream = !!(options && options.stream);
      if (!state.streaming) {
        state.pending = [];
        state.bomSeen = false;
      }
      var inputBytes = toDecodeBytes(input);
      var bytes = inputBytes;
      if (state.pending.length) {
        bytes = new Uint8Array(state.pending.length + inputBytes.length);
        for (var p = 0; p < state.pending.length; p++) bytes[p] = state.pending[p];
        bytes.set(inputBytes, state.pending.length);
      }
      state.pending = [];
      var fatal = this.fatal;
      var ignoreBOM = this.ignoreBOM;
      var out = "";
      var i = 0;
      var reset = function () {
        state.pending = [];
        state.streaming = false;
        state.bomSeen = false;
      };
      var emit = function (codePoint) {
        if (!state.bomSeen) {
          state.bomSeen = true;
          if (!ignoreBOM && codePoint === 0xfeff) return;
        }
        if (codePoint > 0xffff) {
          codePoint -= 0x10000;
          out += String.fromCharCode(0xd800 + (codePoint >> 10));
          out += String.fromCharCode(0xdc00 + (codePoint & 0x3ff));
        } else {
          out += String.fromCharCode(codePoint);
        }
      };
      var fail = function () {
        if (fatal) {
          throw new TypeError("TextDecoder.decode: the encoded data was not valid utf-8");
        }
        emit(0xfffd);
      };
      try {
        while (i < bytes.length) {
          var sequenceStart = i;
          var byte1 = bytes[i];
          if (byte1 <= 0x7f) {
            emit(byte1);
            i++;
            continue;
          }
          var needed, codePoint, lower, upper;
          if (byte1 >= 0xc2 && byte1 <= 0xdf) {
            needed = 1; codePoint = byte1 & 0x1f; lower = 0x80; upper = 0xbf;
          } else if (byte1 >= 0xe0 && byte1 <= 0xef) {
            needed = 2; codePoint = byte1 & 0x0f;
            lower = byte1 === 0xe0 ? 0xa0 : 0x80;
            upper = byte1 === 0xed ? 0x9f : 0xbf;
          } else if (byte1 >= 0xf0 && byte1 <= 0xf4) {
            needed = 3; codePoint = byte1 & 0x07;
            lower = byte1 === 0xf0 ? 0x90 : 0x80;
            upper = byte1 === 0xf4 ? 0x8f : 0xbf;
          } else {
            // 0x80–0xC1 and 0xF5–0xFF can never start a sequence.
            fail();
            i++;
            continue;
          }
          i++;
          var ok = true;
          var incomplete = false;
          for (var k = 0; k < needed; k++) {
            if (i >= bytes.length) {
              ok = false;
              incomplete = true;
              break;
            }
            var cont = bytes[i];
            var lo = k === 0 ? lower : 0x80;
            var hi = k === 0 ? upper : 0xbf;
            if (cont < lo || cont > hi) {
              // Maximal subpart: the offending byte is NOT consumed; decoding
              // restarts at it.
              ok = false;
              break;
            }
            codePoint = (codePoint << 6) | (cont & 0x3f);
            i++;
          }
          if (!ok) {
            if (incomplete && stream) {
              for (var pendingIndex = sequenceStart; pendingIndex < bytes.length; pendingIndex++) {
                state.pending.push(bytes[pendingIndex]);
              }
              i = bytes.length;
              break;
            }
            fail();
            continue;
          }
          emit(codePoint);
        }
      } catch (error) {
        reset();
        throw error;
      }
      if (stream) {
        state.streaming = true;
      } else {
        reset();
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
      // WHATWG forgiving-base64 decode: whitespace is removed first; only
      // canonical trailing padding on a multiple-of-four input is discarded.
      // Arbitrary extra padding ("====", "YQ===", "YQ=") stays invalid.
      var text = String(input).replace(/[\t\n\f\r ]+/g, "");
      if (text.length % 4 === 0) {
        if (/==$/.test(text)) text = text.slice(0, -2);
        else if (/=$/.test(text)) text = text.slice(0, -1);
      }
      if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) {
        throw snapbackError(
          "SNAPBACK_HANDLER_INVALID_CHARACTER",
          "atob: the string to be decoded is not correctly encoded"
        );
      }
      var out = "";
      var buffer = 0;
      var bits = 0;
      for (var i = 0; i < text.length; i++) {
        var value = B64_ALPHABET.indexOf(text.charAt(i));
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
